import { handleHoneypot } from "@/lib/server/honeypot";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isValidUUID } from "@/lib/server/validation";
import { randomInt } from "crypto";
import {
  evaluateSecurityRisk,
  writeSecurityRiskLog,
} from "@/lib/server/risk-engine";

const DELETE_OTP_TTL_SECONDS = 120;
const MAX_ATTEMPTS = 5;

async function writeDeleteLog(
  admin: SupabaseClient,
  payload: {
    user_id: string;
    file_id: string;
    action: string;
    success: boolean;
    metadata?: Record<string, unknown>;
  }
) {
  const { error } = await admin
    .from("file_access_logs")
    .insert(payload);

  if (error) {
    console.error("DELETE AUDIT LOG ERROR:", error);
  }
}

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const resendApiKey = process.env.RESEND_API_KEY;

    if (!supabaseUrl || !serviceRoleKey || !resendApiKey) {
      return NextResponse.json(
        { error: "Server configuration is missing." },
        { status: 500 }
      );
    }

    const admin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const authHeader =
      request.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      );
    }

    const accessToken = authHeader.slice(7);

    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(accessToken);

    if (userError || !user || !user.email) {
      return NextResponse.json(
        { error: "Invalid authentication session." },
        { status: 401 }
      );
    }

    const body = await request.json();



    if (await handleHoneypot(request, body)) {

      return NextResponse.json(

        { error: "Invalid request." },

        { status: 400 }

      );

    }
    const fileId = String(body?.fileId || "").trim();
    const resourceType =
      body?.resourceType === "work_file"
        ? "work_file"
        : "user_file";

    if (!isValidUUID(fileId)) {
      return NextResponse.json({ error: "Invalid file ID." }, { status: 400 });
    }

    if (!fileId) {
      return NextResponse.json(
        { error: "File ID is required." },
        { status: 400 }
      );
    }

    let fileName = "";

    if (resourceType === "work_file") {
      const { data, error } = await admin
        .from("work_files")
        .select("id, file_name")
        .eq("id", fileId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        return NextResponse.json(
          { error: "Unable to verify work file ownership." },
          { status: 500 }
        );
      }

      if (!data) {
        return NextResponse.json(
          { error: "Work file not found." },
          { status: 404 }
        );
      }

      fileName = data.file_name;
    } else {
      const { data, error } = await admin
        .from("user_files")
        .select("id, file_name")
        .eq("id", fileId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        return NextResponse.json(
          { error: "Unable to verify file ownership." },
          { status: 500 }
        );
      }

      if (!data) {
        return NextResponse.json(
          { error: "File not found." },
          { status: 404 }
        );
      }

      fileName = data.file_name;
    }

    const risk = await evaluateSecurityRisk(
      user.id,
      request
    );

    await writeSecurityRiskLog(
      user.id,
      request,
      risk,
      "file_delete_otp_request"
    );

    if (
      risk.decision === "blocked" ||
      risk.riskLevel === "critical"
    ) {
      await writeDeleteLog(admin, {
        user_id: user.id,
        file_id: fileId,
        action: "delete_risk_blocked",
        success: false,
        metadata: {
          resource_type: resourceType,
          risk_score: risk.riskScore,
          risk_level: risk.riskLevel,
          decision: risk.decision,
        },
      });

      return NextResponse.json(
        {
          error:
            "File deletion has been blocked by the security system.",
        },
        { status: 403 }
      );
    }

    if (
      risk.decision === "reauthentication_required" ||
      risk.riskLevel === "high"
    ) {
      return NextResponse.json(
        {
          error:
            "Additional security verification is required before deletion.",
        },
        { status: 403 }
      );
    }

    const { data: existing } = await admin
      .from("file_access_otps")
      .select(
        "id, created_at, expires_at, attempts"
      )
      .eq("user_id", user.id)
      .eq("file_id", fileId)
      .eq("purpose", "delete")
      .eq("verified", false)
      .order("created_at", {
        ascending: false,
      })
      .limit(1)
      .maybeSingle();

    if (existing) {
      const expired =
        new Date(existing.expires_at).getTime() <=
        Date.now();

      const exhausted =
        Number(existing.attempts || 0) >= MAX_ATTEMPTS;

      if (!expired && !exhausted) {
        return NextResponse.json(
          {
            error:
              "A Delete OTP is already active. Please use the existing OTP.",
            retry_after: Math.max(
              1,
              Math.ceil(
                (
                  new Date(existing.expires_at).getTime() -
                  Date.now()
                ) / 1000
              )
            ),
          },
          { status: 429 }
        );
      }

      await admin
        .from("file_access_otps")
        .update({ verified: true })
        .eq("id", existing.id)
        .eq("verified", false);
    }

    const otp = String(
      randomInt(100000, 1000000)
    );

    const expiresAt = new Date(
      Date.now() +
        DELETE_OTP_TTL_SECONDS * 1000
    ).toISOString();

    const { error: insertError } = await admin
      .from("file_access_otps")
      .insert({
        user_id: user.id,
        file_id: fileId,
        email: user.email,
        otp,
        purpose: "delete",
        expires_at: expiresAt,
        verified: false,
        attempts: 0,
      });

    if (insertError) {
      console.error(
        "DELETE OTP INSERT ERROR:",
        insertError
      );

      return NextResponse.json(
        { error: "Unable to create Delete OTP." },
        { status: 500 }
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
          subject: "Ultima Lite — Delete OTP",
          html: `
            <div style="font-family:Arial,sans-serif">
              <h2>Ultima Lite Delete Verification</h2>
              <p>You requested deletion of:</p>
              <p><strong>${fileName}</strong></p>
              <p>Your Delete OTP is:</p>
              <h1 style="letter-spacing:8px">${otp}</h1>
              <p>This OTP expires in <strong>120 seconds</strong>.</p>
              <p>If you did not request this deletion, do not use this OTP.</p>
            </div>
          `,
        }),
      }
    );

    if (!resendResponse.ok) {
      const resendErrorText = await resendResponse.text().catch(() => "");
      console.error(
        "DELETE OTP RESEND ERROR:",
        resendResponse.status,
        resendErrorText
      );

      await admin
        .from("file_access_otps")
        .update({ verified: true })
        .eq("user_id", user.id)
        .eq("file_id", fileId)
        .eq("purpose", "delete")
        .eq("otp", otp)
        .eq("verified", false);

      await writeDeleteLog(admin, {
        user_id: user.id,
        file_id: fileId,
        action: "delete_otp_send_failed",
        success: false,
        metadata: {
          resource_type: resourceType,
        },
      });

      return NextResponse.json(
        { error: "Unable to send Delete OTP." },
        { status: 502 }
      );
    }

    await writeDeleteLog(admin, {
      user_id: user.id,
      file_id: fileId,
      action: "delete_otp_request",
      success: true,
      metadata: {
        resource_type: resourceType,
        expires_in: DELETE_OTP_TTL_SECONDS,
      },
    });

    return NextResponse.json({
      success: true,
      message:
        "Delete OTP sent successfully.",
      expires_in: DELETE_OTP_TTL_SECONDS,
    });
  } catch (error) {
    console.error(
      "DELETE OTP REQUEST ERROR:",
      error
    );

    return NextResponse.json(
      { error: "Unable to request Delete OTP." },
      { status: 500 }
    );
  }
}
