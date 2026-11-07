import { handleHoneypot } from "@/lib/server/honeypot";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomInt } from "crypto";
import { isValidUUID } from "@/lib/server/validation";
import {
  evaluateSecurityRisk,
  writeSecurityRiskLog,
} from "@/lib/server/risk-engine";
import {
  verifyLockerAccess,
  type LockerType,
} from "@/lib/server/locker-access";

const FILE_ACCESS_OTP_TTL_SECONDS = 120;
const MAX_ATTEMPTS = 5;

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const resendApiKey = process.env.RESEND_API_KEY;

    if (!supabaseUrl || !serviceRoleKey || !resendApiKey) {
      return NextResponse.json(
        { error: "Server configuration is missing." },
        { status: 500 },
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    }

    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(authHeader.slice(7));

    if (userError || !user || !user.email) {
      return NextResponse.json(
        { error: "Invalid authentication session." },
        { status: 401 },
      );
    }

    const body = await request.json();

    if (await handleHoneypot(request, body)) {
      return NextResponse.json(
        { error: "Invalid request." },
        { status: 400 },
      );
    }

    const fileId = String(body?.fileId || "").trim();
    const resourceType =
      body?.resourceType === "work_file" ? "work_file" : "user_file";

    const locker: LockerType =
      resourceType === "work_file" ? "work" : "uploaded";

    if (!isValidUUID(fileId)) {
      return NextResponse.json(
        { error: "Invalid file ID." },
        { status: 400 },
      );
    }

    const risk = await evaluateSecurityRisk(user.id, request);
    await writeSecurityRiskLog(
      user.id,
      request,
      risk,
      "file_access_otp_request",
    );

    if (risk.decision === "blocked" || risk.riskLevel === "critical") {
      return NextResponse.json(
        { error: "File access has been blocked by the security system." },
        { status: 403 },
      );
    }

    if (
      risk.decision === "reauthentication_required" ||
      risk.riskLevel === "high"
    ) {
      return NextResponse.json(
        {
          error:
            "Additional security verification is required before file access can continue.",
        },
        { status: 403 },
      );
    }

    const table =
      resourceType === "work_file" ? "work_files" : "user_files";

    const select =
      resourceType === "work_file"
        ? "id, file_name, category"
        : "id, file_name, category";

    const { data: file, error: fileError } = await admin
      .from(table)
      .select(select)
      .eq("id", fileId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (fileError) {
      return NextResponse.json(
        { error: "Unable to verify file ownership." },
        { status: 500 },
      );
    }

    if (!file) {
      return NextResponse.json(
        { error: "File not found." },
        { status: 404 },
      );
    }

    const category = String(file.category || "").trim();

    if (
      !(await verifyLockerAccess(
        user.id,
        locker,
        category as Parameters<typeof verifyLockerAccess>[2],
      ))
    ) {
      return NextResponse.json(
        { error: "Unlock the required locker first." },
        { status: 403 },
      );
    }

    const { data: existing } = await admin
      .from("file_access_otps")
      .select("id, created_at, expires_at, attempts")
      .eq("user_id", user.id)
      .eq("file_id", fileId)
      .eq("purpose", "file_access")
      .eq("verified", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      const expired =
        new Date(existing.expires_at).getTime() <= Date.now();

      const exhausted =
        Number(existing.attempts || 0) >= MAX_ATTEMPTS;

      if (!expired && !exhausted) {
        return NextResponse.json(
          {
            error:
              "A File Access OTP is already active. Please use the existing OTP.",
            retry_after: Math.max(
              1,
              Math.ceil(
                (new Date(existing.expires_at).getTime() -
                  Date.now()) /
                  1000,
              ),
            ),
          },
          { status: 429 },
        );
      }

      await admin
        .from("file_access_otps")
        .update({ verified: true })
        .eq("id", existing.id)
        .eq("verified", false);
    }

    const otp = String(randomInt(100000, 1000000));

    const expiresAt = new Date(
      Date.now() + FILE_ACCESS_OTP_TTL_SECONDS * 1000,
    ).toISOString();

    const { error: insertError } = await admin
      .from("file_access_otps")
      .insert({
        user_id: user.id,
        file_id: fileId,
        email: user.email,
        otp,
        purpose: "file_access",
        expires_at: expiresAt,
        verified: false,
        attempts: 0,
      });

    if (insertError) {
      console.error("FILE ACCESS OTP INSERT ERROR:", insertError);

      return NextResponse.json(
        { error: "Unable to create File Access OTP." },
        { status: 500 },
      );
    }

    const resendResponse = await fetch(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Ultima Lite <onboarding@resend.dev>",
          to: [user.email],
          subject: "Ultima Lite — File Access OTP",
          html: `
            <div style="font-family:Arial,sans-serif">
              <h2>Ultima Lite File Access Verification</h2>
              <p>You requested access to:</p>
              <p><strong>${String(file.file_name || "File")}</strong></p>
              <p>Your File Access OTP is:</p>
              <h1 style="letter-spacing:8px">${otp}</h1>
              <p>This OTP expires in <strong>120 seconds</strong>.</p>
              <p>If you did not request this access, do not use this OTP.</p>
            </div>
          `,
        }),
      },
    );

    if (!resendResponse.ok) {
      const resendErrorText = await resendResponse.text().catch(() => "");
      console.error(
        "FILE ACCESS OTP RESEND ERROR:",
        resendResponse.status,
        resendErrorText,
      );

      await admin
        .from("file_access_otps")
        .update({ verified: true })
        .eq("user_id", user.id)
        .eq("file_id", fileId)
        .eq("purpose", "file_access")
        .eq("otp", otp)
        .eq("verified", false);

      return NextResponse.json(
        { error: "Unable to send File Access OTP." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      locker,
      file: {
        id: file.id,
        file_name: file.file_name,
        category,
      },
      expires_in: FILE_ACCESS_OTP_TTL_SECONDS,
    });
  } catch (error) {
    console.error("FILE ACCESS REQUEST ERROR:", error);

    return NextResponse.json(
      { error: "Unable to send File Access OTP." },
      { status: 500 },
    );
  }
}
