import { handleHoneypot } from "@/lib/server/honeypot";
import { NextResponse } from "next/server";
import { setFileAccessProofCookie } from "@/lib/server/file-access-proof";
import { createClient } from "@supabase/supabase-js";
import { isValidUUID } from "@/lib/server/validation";
import {
  evaluateSecurityRisk,
  writeSecurityRiskLog,
} from "@/lib/server/risk-engine";
import {
  verifyLockerAccess,
  type LockerType,
} from "@/lib/server/locker-access";

const MAX_ATTEMPTS = 5;

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
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
    const otp = String(body?.otp || "").trim();
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

    if (!/^\d{6}$/.test(otp)) {
      return NextResponse.json(
        { error: "Enter the 6-digit File Access OTP." },
        { status: 400 },
      );
    }

    const risk = await evaluateSecurityRisk(user.id, request);

    await writeSecurityRiskLog(
      user.id,
      request,
      risk,
      "file_access_otp_verify",
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
        ? "id, file_name, category, status"
        : "id, file_name, category, mime_type, storage_path, file_size, status";

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

    const fileRecord = file as unknown as {
      id: string;
      file_name: string;
      category?: string | null;
      status?: string | null;
      mime_type?: string | null;
      storage_path?: string | null;
      file_size?: number | null;
    };

    const category = String(fileRecord.category || "").trim();

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

    const { data: challenge, error: challengeError } = await admin
      .from("file_access_otps")
      .select(
        "id, user_id, file_id, email, otp, expires_at, verified, attempts",
      )
      .eq("user_id", user.id)
      .eq("file_id", fileId)
      .eq("purpose", "file_access")
      .eq("verified", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (challengeError) {
      console.error("FILE ACCESS OTP LOOKUP ERROR:", challengeError);

      return NextResponse.json(
        { error: "Unable to verify File Access OTP." },
        { status: 500 },
      );
    }

    if (!challenge) {
      return NextResponse.json(
        { error: "File Access OTP is invalid or expired." },
        { status: 400 },
      );
    }

    if (challenge.email !== user.email) {
      return NextResponse.json(
        { error: "File Access OTP is invalid." },
        { status: 400 },
      );
    }

    const attempts = Number(challenge.attempts || 0);

    if (attempts >= MAX_ATTEMPTS) {
      return NextResponse.json(
        {
          error:
            "Maximum File Access OTP attempts exceeded. Please request a new OTP.",
        },
        { status: 429 },
      );
    }

    const expired =
      new Date(challenge.expires_at).getTime() <= Date.now();

    if (expired) {
      await admin
        .from("file_access_otps")
        .update({ verified: true })
        .eq("id", challenge.id)
        .eq("verified", false);

      return NextResponse.json(
        {
          error:
            "File Access OTP has expired. Please request a new OTP.",
        },
        { status: 400 },
      );
    }

    if (challenge.otp !== otp) {
      const { error: rpcError } = await admin.rpc(
        "increment_file_access_otp_attempt",
        {
          p_id: challenge.id,
          p_max_attempts: MAX_ATTEMPTS,
        },
      );

      if (rpcError) {
        console.error(
          "FILE ACCESS OTP ATTEMPT RPC ERROR:",
          rpcError,
        );
      }

      return NextResponse.json(
        { error: "Invalid File Access OTP." },
        { status: 400 },
      );
    }

    const { data: consumed, error: consumeError } = await admin
      .from("file_access_otps")
      .update({ verified: true })
      .eq("id", challenge.id)
      .eq("verified", false)
      .select("id")
      .maybeSingle();

    if (consumeError || !consumed) {
      return NextResponse.json(
        { error: "File Access verification could not be completed." },
        { status: 409 },
      );
    }

    let previewUrl: string | null = null;

    if (resourceType === "user_file") {
      const storagePath = fileRecord.storage_path;

      if (storagePath) {
        const { data: signed } = await admin.storage
          .from("ultima-files")
          .createSignedUrl(storagePath, 60);

        previewUrl = signed?.signedUrl ?? null;
      }
    }

    const successResponse = NextResponse.json({
      success: true,
      locker,
      file,
      preview_url: previewUrl,
      expires_in: previewUrl ? 60 : null,
    });

    setFileAccessProofCookie(
      successResponse,
      user.id,
      fileRecord.id,
      serviceRoleKey,
    );

    return successResponse;
  } catch (error) {
    console.error("FILE ACCESS VERIFY ERROR:", error);

    return NextResponse.json(
      { error: "Unable to verify File Access OTP." },
      { status: 500 },
    );
  }
}
