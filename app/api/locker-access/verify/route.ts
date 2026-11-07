import { handleHoneypot } from "@/lib/server/honeypot";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isValidOTP } from "@/lib/server/validation";
import {
  createLockerProof,
  getLockerCookieName,
  getLockerPurpose,
  normalizeLockerCategory,
} from "@/lib/server/locker-access";
import {
  evaluateSecurityRisk,
  writeSecurityRiskLog,
} from "@/lib/server/risk-engine";

const MAX_ATTEMPTS = 5;
const SESSION_TTL_SECONDS = 10 * 60;

type LockerType = "uploaded" | "work";

function normalizeLocker(value: unknown): LockerType | null {
  if (value === "uploaded" || value === "work") return value;
  return null;
}

async function writeLockerLog(
  admin: SupabaseClient,
  payload: {
    user_id: string;
    action: string;
    success: boolean;
    metadata?: Record<string, unknown>;
  }
) {
  const { error } = await admin
    .from("file_access_logs")
    .insert({
      user_id: payload.user_id,
      file_id: null,
      action: payload.action,
      success: payload.success,
      metadata: payload.metadata || {},
    });

  if (error) {
    console.error("LOCKER ACCESS AUDIT LOG ERROR:", error);
  }
}

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
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
    const otp = String(body?.otp || "").trim();

    if (!locker || !category || !isValidOTP(otp)) {
      return NextResponse.json(
        { error: "A valid locker and 6-digit OTP are required." },
        { status: 400 }
      );
    }

    const risk = await evaluateSecurityRisk(user.id, request);

    await writeSecurityRiskLog(
      user.id,
      request,
      risk,
      "locker_access_otp_verify"
    );

    if (
      risk.decision === "blocked" ||
      risk.riskLevel === "critical"
    ) {
      await writeLockerLog(admin, {
        user_id: user.id,
        action: "locker_access_risk_blocked",
        success: false,
        metadata: {
          locker,
          risk_score: risk.riskScore,
          risk_level: risk.riskLevel,
          decision: risk.decision,
        },
      });

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
      await writeLockerLog(admin, {
        user_id: user.id,
        action: "locker_reauthentication_required",
        success: false,
        metadata: {
          locker,
          risk_score: risk.riskScore,
          risk_level: risk.riskLevel,
          decision: risk.decision,
        },
      });

      return NextResponse.json(
        {
          error:
            "Additional security verification is required before opening this locker.",
        },
        { status: 403 }
      );
    }

    const purpose = getLockerPurpose(locker, category);

    const { data: challenge, error: challengeError } =
      await admin
        .from("file_access_otps")
        .select(
          "id, user_id, email, otp, expires_at, verified, attempts"
        )
        .eq("user_id", user.id)
        .eq("email", user.email)
        .eq("purpose", purpose)
        .eq("verified", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (challengeError) {
      return NextResponse.json(
        { error: "Unable to verify locker access request." },
        { status: 500 }
      );
    }

    if (!challenge) {
      await writeLockerLog(admin, {
        user_id: user.id,
        action: "locker_otp_verify",
        success: false,
        metadata: { locker, reason: "no_active_otp" },
      });

      return NextResponse.json(
        { error: "No active locker access OTP found." },
        { status: 400 }
      );
    }

    if (
      new Date(challenge.expires_at).getTime() <= Date.now()
    ) {
      await writeLockerLog(admin, {
        user_id: user.id,
        action: "locker_otp_expired",
        success: false,
        metadata: { locker },
      });

      return NextResponse.json(
        { error: "OTP has expired. Please request a new one." },
        { status: 400 }
      );
    }

    const attempts = Number(challenge.attempts || 0);

    if (attempts >= MAX_ATTEMPTS) {
      return NextResponse.json(
        {
          error:
            "Too many incorrect attempts. Please request a new OTP.",
        },
        { status: 429 }
      );
    }

    if (challenge.otp !== otp) {
      const { data: newAttempts, error: attemptError } =
        await admin.rpc(
          "increment_file_access_otp_attempt",
          {
            p_id: challenge.id,
            p_max_attempts: MAX_ATTEMPTS,
          }
        );

      if (
        attemptError ||
        typeof newAttempts !== "number" ||
        newAttempts < 0
      ) {
        console.error(
          "Failed to increment locker OTP attempts:",
          attemptError
        );

        return NextResponse.json(
          { error: "Unable to process OTP attempt." },
          { status: 500 }
        );
      }

      await writeLockerLog(admin, {
        user_id: user.id,
        action: "locker_otp_verify",
        success: false,
        metadata: {
          locker,
          remaining_attempts: Math.max(
            0,
            MAX_ATTEMPTS - newAttempts
          ),
        },
      });

      return NextResponse.json(
        {
          error: `Incorrect OTP. ${Math.max(
            0,
            MAX_ATTEMPTS - newAttempts
          )} attempt(s) remaining.`,
        },
        { status: 400 }
      );
    }

    const { data: consumed, error: consumeError } =
      await admin
        .from("file_access_otps")
        .update({ verified: true })
        .eq("id", challenge.id)
        .eq("verified", false)
        .select("id")
        .maybeSingle();

    if (consumeError) {
      return NextResponse.json(
        { error: "Unable to complete locker verification." },
        { status: 500 }
      );
    }

    if (!consumed) {
      return NextResponse.json(
        { error: "This locker access OTP has already been used." },
        { status: 400 }
      );
    }

      const proof = createLockerProof(
        user.id,
        locker,
        category,
        serviceRoleKey
      );
      const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;

    await writeLockerLog(admin, {
      user_id: user.id,
      action: "locker_open",
      success: true,
      metadata: {
        locker,
          category,
        access_proof_ttl_seconds: SESSION_TTL_SECONDS,
        risk_score: risk.riskScore,
        risk_level: risk.riskLevel,
        decision: risk.decision,
      },
    });

      const cookieName = getLockerCookieName(locker, category);

    const response = NextResponse.json({
      success: true,
      locker,
      expires_in: Math.max(
        0,
        Math.floor((expiresAt - Date.now()) / 1000)
      ),
    });

    response.cookies.set(cookieName, proof, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });

    return response;
  } catch (error) {
    console.error("LOCKER ACCESS VERIFY ERROR:", error);

    return NextResponse.json(
      { error: "Unable to verify locker access." },
      { status: 500 }
    );
  }
}
