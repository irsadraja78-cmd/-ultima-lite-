import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { isValidEmail, VALIDATION_LIMITS } from "@/lib/server/validation";
import { writeSecurityLog } from "@/lib/server/security-log";
import { consumeApiRateLimit } from "@/lib/server/api-rate-limit";
import { handleHoneypot } from "@/lib/server/honeypot";

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase server configuration");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (await handleHoneypot(request, body)) {
      return NextResponse.json(
        { error: "Invalid request." },
        { status: 400 }
      );
    }

    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (
      !isValidEmail(email) ||
      password.length === 0 ||
      password.length > VALIDATION_LIMITS.password
    ) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 400 }
      );
    }

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 }
      );
    }

    const ipLimit = await consumeApiRateLimit(
      request,
      "login-ip",
      10,
      300
    );

    const accountLimit = await consumeApiRateLimit(
      request,
      "login-account",
      5,
      300,
      email
    );

    if (!ipLimit.allowed || !accountLimit.allowed) {
      await writeSecurityLog({
        eventType: "login",
        action: "rate_limit",
        success: false,
        request,
        metadata: {
          email,
          reason: "login_rate_limit",
        },
      });

      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        { status: 429 }
      );
    }

    /*
     * IMPORTANT:
     * Keep password authentication and privileged database access
     * on separate Supabase clients.
     *
     * signInWithPassword() establishes a user session on its client.
     * Reusing that same client for login_challenges can make subsequent
     * database requests run as the authenticated user instead of the
     * server secret/service role.
     */

    const authClient = getAdminClient();

    const { data, error } = await authClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user || !data.session) {
      await writeSecurityLog({
        eventType: "login",
        action: "password_check",
        success: false,
        request,
        metadata: {
          reason: "invalid_credentials",
          email,
        },
      });

      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    /*
     * Create a completely fresh privileged client AFTER authentication.
     * This client must never receive the user's session token.
     */
    const admin = getAdminClient();

    const challengeToken = randomBytes(32).toString("hex");
    const challengeHash = createHash("sha256")
      .update(challengeToken)
      .digest("hex");

    const { error: invalidateError } = await admin
      .from("login_challenges")
      .update({ verified: true })
      .eq("user_id", data.user.id)
      .eq("purpose", "login")
      .eq("verified", false);

    if (invalidateError) {
      console.error(
        "LOGIN CHALLENGE INVALIDATION ERROR:",
        JSON.stringify({
          message: invalidateError.message,
          code: invalidateError.code,
          details: invalidateError.details,
          hint: invalidateError.hint,
        })
      );

      return NextResponse.json(
        { error: "Unable to start secure login." },
        { status: 500 }
      );
    }

    const expiresAt = new Date(
      Date.now() + 10 * 60 * 1000
    ).toISOString();

    const { error: challengeError } = await admin
      .from("login_challenges")
      .insert({
        user_id: data.user.id,
        email,
        purpose: "login",
        challenge_hash: challengeHash,
        expires_at: expiresAt,
        verified: false,
      });

    if (challengeError) {
      console.error(
        "LOGIN CHALLENGE CREATE ERROR:",
        JSON.stringify({
          message: challengeError.message,
          code: challengeError.code,
          details: challengeError.details,
          hint: challengeError.hint,
        })
      );

      return NextResponse.json(
        { error: "Unable to start secure login." },
        { status: 500 }
      );
    }

    await writeSecurityLog({
      userId: data.user.id,
      eventType: "login",
      action: "password_check",
      success: true,
      request,
      metadata: {
        email,
        challenge_created: true,
      },
    });

    const response = NextResponse.json({
      success: true,
      userId: data.user.id,
    });

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict" as const,
      path: "/",
      maxAge: 10 * 60,
    };

    response.cookies.set({
      name: "ultima_login_challenge",
      value: challengeToken,
      ...cookieOptions,
    });

    response.cookies.set({
      name: "ultima_login_access_token",
      value: data.session.access_token,
      ...cookieOptions,
    });

    response.cookies.set({
      name: "ultima_login_refresh_token",
      value: data.session.refresh_token,
      ...cookieOptions,
    });

    return response;
  } catch (error) {
    console.error("LOGIN CHECK ERROR:", error);

    await writeSecurityLog({
      eventType: "login",
      action: "password_check",
      success: false,
      request,
      metadata: {
        reason: "server_error",
      },
    });

    return NextResponse.json(
      { error: "Unable to process login." },
      { status: 500 }
    );
  }
}
