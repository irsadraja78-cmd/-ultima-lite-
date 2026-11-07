import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { writeSecurityLog } from "@/lib/server/security-log";
import { createClient } from "@supabase/supabase-js";
import { consumeApiRateLimit } from "@/lib/server/api-rate-limit";
import { handleHoneypot } from "@/lib/server/honeypot";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getAdminClient() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase server configuration is missing.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

const validPurposes = ["signup", "login", "password_reset"] as const;

export async function POST(request: Request) {
  try {
    const admin = getAdminClient();

    const body = await request.json();

    if (await handleHoneypot(request, body)) {
      return NextResponse.json(
        { error: "Invalid request." },
        { status: 400 }
      );
    }

    const { email, otp, purpose } = body;

    if (!email || !otp || !purpose) {
      return NextResponse.json(
        { error: "Email, OTP and purpose are required." },
        { status: 400 }
      );
    }

    if (!validPurposes.includes(purpose)) {
      return NextResponse.json(
        { error: "Invalid OTP purpose." },
        { status: 400 }
      );
    }

    const recipientEmail = String(email).trim().toLowerCase();
    const submittedOtp = String(otp).trim();

    const ipLimit = await consumeApiRateLimit(
      request,
      "otp-verify-ip",
      30,
      600
    );

    const emailLimit = await consumeApiRateLimit(
      request,
      "otp-verify-email",
      10,
      600,
      recipientEmail
    );

    if (!ipLimit.allowed || !emailLimit.allowed) {
      await writeSecurityLog({
        eventType: "otp",
        action: "rate_limit",
        success: false,
        request,
        metadata: {
          purpose,
          reason: "otp_verify_rate_limit",
        },
      });

      return NextResponse.json(
        { error: "Too many OTP verification attempts. Please try again later." },
        { status: 429 }
      );
    }

    if (!/^\d{6}$/.test(submittedOtp)) {
      return NextResponse.json(
        { error: "OTP must be a 6-digit code." },
        { status: 400 }
      );
    }

    /*
     * Find the latest active OTP for this email/purpose.
     * We intentionally do NOT filter by the submitted OTP here.
     * This allows incorrect attempts to be counted.
     */
    const { data, error } = await admin
      .from("email_otps")
      .select(
        "id, otp, expires_at, verified, attempts, last_attempt_at"
      )
      .eq("email", recipientEmail)
      .eq("purpose", purpose)
      .eq("verified", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("OTP LOOKUP ERROR:", error);

      return NextResponse.json(
        { error: "Unable to verify OTP." },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Invalid or expired OTP." },
        { status: 400 }
      );
    }

    if (new Date(data.expires_at).getTime() <= Date.now()) {
      await writeSecurityLog({
        eventType: "otp",
        action: "verify",
        success: false,
        request,
        metadata: {
          purpose,
          reason: "expired_otp",
        },
      });

      return NextResponse.json(
        { error: "OTP has expired. Please request a new OTP." },
        { status: 400 }
      );
    }

    const attempts = Number(data.attempts ?? 0);

    if (attempts >= 5) {
      return NextResponse.json(
        {
          error:
            "Too many incorrect attempts. Please request a new OTP.",
        },
        { status: 429 }
      );
    }

    /*
     * Wrong OTP:
     * increase attempts and keep OTP unverified.
     */
    if (data.otp !== submittedOtp) {
      const { data: nextAttempts, error: attemptError } =
        await admin.rpc("increment_email_otp_attempt", {
          p_id: data.id,
          p_max_attempts: 5,
        });

      if (attemptError) {
        console.error("OTP ATTEMPT UPDATE ERROR:", attemptError);

        return NextResponse.json(
          { error: "Unable to process OTP attempt." },
          { status: 500 }
        );
      }

      const updatedAttempts = Number(nextAttempts ?? -1);

      if (updatedAttempts < 1) {
        return NextResponse.json(
          { error: "Unable to process OTP attempt." },
          { status: 500 }
        );
      }

      if (updatedAttempts >= 5) {
        await writeSecurityLog({
          eventType: "otp",
          action: "verify_failed",
          success: false,
          request,
          metadata: {
            purpose,
            reason: "max_attempts_reached",
            attempts: updatedAttempts,
          },
        });

        return NextResponse.json(
          {
            error:
              "Too many incorrect attempts. Please request a new OTP.",
          },
          { status: 429 }
        );
      }

      await writeSecurityLog({
        eventType: "otp",
        action: "verify_failed",
        success: false,
        request,
        metadata: {
          purpose,
          reason: "invalid_otp",
          attempts: updatedAttempts,
          attempts_remaining: 5 - updatedAttempts,
        },
      });

      return NextResponse.json(
        {
          error: "Invalid OTP.",
          attemptsRemaining: 5 - updatedAttempts,
        },
        { status: 400 }
      );
    }

    /*
     * Correct OTP.
     *
     * Consume the OTP atomically. The submitted OTP and
     * verified=false are part of the same update condition.
     * If another request already consumed it, no row is returned.
     */
    const { data: consumedOtp, error: updateError } = await admin
      .from("email_otps")
      .update({
        verified: true,
        attempts: attempts + 1,
        last_attempt_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("otp", submittedOtp)
      .eq("verified", false)
      .select("id")
      .maybeSingle();

    if (updateError) {
      console.error("OTP VERIFY UPDATE ERROR:", updateError);

      return NextResponse.json(
        { error: "Unable to complete OTP verification." },
        { status: 500 }
      );
    }

    if (!consumedOtp?.id) {
      await writeSecurityLog({
        eventType: "otp",
        action: "replay_blocked",
        success: false,
        request,
        metadata: {
          purpose,
          reason: "otp_already_consumed",
        },
      });

      return NextResponse.json(
        { error: "Invalid or already-used OTP." },
        { status: 400 }
      );
    }

    await writeSecurityLog({
      eventType: "otp",
      action: "verify",
      success: true,
      request,
      metadata: {
        purpose,
      },
    });

    const response = NextResponse.json({
      success: true,
      message: "OTP verified successfully.",
    });

    if (purpose === "signup") {
      const normalizedEmail = String(email).trim().toLowerCase();
      const proofIssuedAt = Date.now();
      const proofPayload = `${normalizedEmail}:${proofIssuedAt}`;
      const proofSignature = createHmac("sha256", serviceRoleKey!)
        .update(proofPayload)
        .digest("base64url");

      response.cookies.set({
        name: "ultima_signup_trial_proof",
        value: Buffer.from(
          `${proofPayload}:${proofSignature}`,
          "utf8"
        ).toString("base64url"),
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 10 * 60,
      });
    }

    if (purpose === "login") {
      const cookieHeader = request.headers.get("cookie") || "";
      const challengeMatch = cookieHeader.match(
        /(?:^|;\s*)ultima_login_challenge=([^;]+)/
      );

      const challengeToken = challengeMatch?.[1];
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!challengeToken || !serviceRoleKey) {
        return NextResponse.json(
          { error: "Secure login session is unavailable. Please sign in again." },
          { status: 401 }
        );
      }

      const challengeHash = createHmac("sha256", serviceRoleKey)
        .update(challengeToken)
        .digest("hex");

      response.cookies.set({
        name: "ultima_login_otp_proof",
        value: challengeHash,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 10 * 60,
      });
    }

    return response;
  } catch (error) {
    console.error("VERIFY OTP ERROR:", error);

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid request." },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Unable to process OTP verification." },
      { status: 500 }
    );
  }
}
