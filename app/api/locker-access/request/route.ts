import { handleHoneypot } from "@/lib/server/honeypot";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomInt } from "crypto";
import {
  getLockerPurpose,
  normalizeLockerCategory,
} from "@/lib/server/locker-access";
import {
  evaluateSecurityRisk,
  writeSecurityRiskLog,
} from "@/lib/server/risk-engine";

const OTP_TTL_SECONDS = 120;
const MAX_ATTEMPTS = 5;

type LockerType = "uploaded" | "work";

function normalizeLocker(value: unknown): LockerType | null {
  if (value === "uploaded" || value === "work") return value;
  return null;
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

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const authHeader = request.headers.get("authorization");

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

    const locker = normalizeLocker(body?.locker);
      const category = normalizeLockerCategory(body?.category);

    if (!locker || !category) {
      return NextResponse.json(
        { error: "Invalid locker." },
        { status: 400 }
      );
    }

    const risk = await evaluateSecurityRisk(user.id, request);

    await writeSecurityRiskLog(
      user.id,
      request,
      risk,
      "locker_access_otp_request"
    );

    if (
      risk.decision === "blocked" ||
      risk.riskLevel === "critical"
    ) {
      return NextResponse.json(
        {
          error:
            "Locker access has been blocked by the security system.",
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
            "Additional security verification is required before opening this locker.",
        },
        { status: 403 }
      );
    }

      const purpose = getLockerPurpose(locker, category);

    const { data: existing } = await admin
      .from("file_access_otps")
      .select("id, created_at, expires_at, attempts")
      .eq("user_id", user.id)
      .eq("purpose", purpose)
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
        return NextResponse.json({
          success: true,
          message:
            "A locker access OTP has already been sent. Please check your email.",
          expires_in: Math.max(
            0,
            Math.floor(
              (new Date(existing.expires_at).getTime() -
                Date.now()) /
                1000
            )
          ),
        });
      }

      await admin
        .from("file_access_otps")
        .update({ verified: true })
        .eq("id", existing.id)
        .eq("verified", false);
    }

    const otp = String(randomInt(100000, 1000000));
    const expiresAt = new Date(
      Date.now() + OTP_TTL_SECONDS * 1000
    ).toISOString();

    const { error: insertError } = await admin
      .from("file_access_otps")
      .insert({
        user_id: user.id,
        file_id: null,
        email: user.email,
        otp,
        purpose,
        expires_at: expiresAt,
        verified: false,
        attempts: 0,
      });

    if (insertError) {
      console.error("LOCKER OTP INSERT ERROR:", insertError);

      return NextResponse.json(
        { error: "Unable to create locker access request." },
        { status: 500 }
      );
    }

    const lockerName =
      locker === "uploaded"
        ? "Uploaded Files Locker"
        : "Working Files Locker";

    const resendResponse = await fetch(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Ultima Lite <no-reply@ultimalite.com>",
          to: [user.email],
          subject: `Ultima Lite — ${lockerName} Access OTP`,
          text:
            `Your ${lockerName} access OTP is ${otp}.\n\n` +
            `This OTP expires in ${OTP_TTL_SECONDS} seconds.\n\n` +
            `Do not share this OTP with anyone.`,
        }),
      }
    );

    if (!resendResponse.ok) {
      await admin
        .from("file_access_otps")
        .update({ verified: true })
        .eq("user_id", user.id)
        .eq("purpose", purpose)
        .eq("otp", otp)
        .eq("verified", false);

      return NextResponse.json(
        { error: "Unable to send locker access OTP." },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      locker,
      message:
        "Locker access OTP sent to your registered email.",
      expires_in: OTP_TTL_SECONDS,
    });
  } catch (error) {
    console.error("LOCKER ACCESS REQUEST ERROR:", error);

    return NextResponse.json(
      { error: "Unable to request locker access." },
      { status: 500 }
    );
  }
}
