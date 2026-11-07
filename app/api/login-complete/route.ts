import { NextResponse } from "next/server";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { writeSecurityLog } from "@/lib/server/security-log";

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
    const admin = getAdminClient();

    const cookieHeader = request.headers.get("cookie") || "";

    const challengeMatch = cookieHeader.match(
      /(?:^|;\s*)ultima_login_challenge=([^;]+)/
    );

    const accessMatch = cookieHeader.match(
      /(?:^|;\s*)ultima_login_access_token=([^;]+)/
    );

    const refreshMatch = cookieHeader.match(
      /(?:^|;\s*)ultima_login_refresh_token=([^;]+)/
    );

    const proofMatch = cookieHeader.match(
      /(?:^|;\s*)ultima_login_otp_proof=([^;]+)/
    );

    const challengeToken = challengeMatch?.[1];
    const accessToken = accessMatch?.[1];
    const refreshToken = refreshMatch?.[1];
    const otpProof = proofMatch?.[1];

    if (!challengeToken || !accessToken || !refreshToken || !otpProof) {
      return NextResponse.json(
        { error: "Login session expired. Please sign in again." },
        { status: 401 }
      );
    }

    const challengeHash = createHash("sha256")
      .update(challengeToken)
      .digest("hex");

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceRoleKey) {
      throw new Error("Missing Supabase server configuration");
    }

    const expectedProof = createHmac("sha256", serviceRoleKey)
      .update(challengeToken)
      .digest("hex");

    const proofBuffer = Buffer.from(otpProof, "utf8");
    const expectedProofBuffer = Buffer.from(expectedProof, "utf8");

    if (
      proofBuffer.length !== expectedProofBuffer.length ||
      !timingSafeEqual(proofBuffer, expectedProofBuffer)
    ) {
      await writeSecurityLog({
        eventType: "login",
        action: "otp_proof_invalid",
        success: false,
        request,
        metadata: {
          reason: "invalid_login_otp_proof",
        },
      });

      return NextResponse.json(
        { error: "Login verification is invalid. Please sign in again." },
        { status: 401 }
      );
    }

    const { data: challenge, error: challengeError } = await admin
      .from("login_challenges")
      .select("id, user_id, email, expires_at, verified")
      .eq("challenge_hash", challengeHash)
      .eq("purpose", "login")
      .eq("verified", false)
      .maybeSingle();

    if (challengeError) {
      console.error(
        "LOGIN CHALLENGE LOOKUP ERROR:",
        JSON.stringify({
          message: challengeError.message,
          code: challengeError.code,
          details: challengeError.details,
          hint: challengeError.hint,
        })
      );

      return NextResponse.json(
        { error: "Unable to complete secure login." },
        { status: 500 }
      );
    }

    if (!challenge) {
      return NextResponse.json(
        { error: "Login verification expired. Please sign in again." },
        { status: 401 }
      );
    }

    if (new Date(challenge.expires_at).getTime() <= Date.now()) {
      await admin
        .from("login_challenges")
        .update({ verified: true })
        .eq("id", challenge.id)
        .eq("verified", false);

      return NextResponse.json(
        { error: "Login verification expired. Please sign in again." },
        { status: 401 }
      );
    }

    const { data: sessionData, error: sessionError } =
      await admin.auth.getUser(accessToken);

    if (sessionError || !sessionData.user) {
      return NextResponse.json(
        { error: "Login session is invalid. Please sign in again." },
        { status: 401 }
      );
    }

    if (sessionData.user.id !== challenge.user_id) {
      return NextResponse.json(
        { error: "Login verification mismatch. Please sign in again." },
        { status: 401 }
      );
    }

    const { data: consumedChallenge, error: consumeError } = await admin
      .from("login_challenges")
      .update({ verified: true })
      .eq("id", challenge.id)
      .eq("user_id", challenge.user_id)
      .eq("challenge_hash", challengeHash)
      .eq("verified", false)
      .select("id")
      .maybeSingle();

    if (consumeError) {
      console.error(
        "LOGIN CHALLENGE CONSUME ERROR:",
        JSON.stringify({
          message: consumeError.message,
          code: consumeError.code,
          details: consumeError.details,
          hint: consumeError.hint,
        })
      );

      return NextResponse.json(
        { error: "Unable to complete secure login." },
        { status: 500 }
      );
    }

    if (!consumedChallenge) {
      await writeSecurityLog({
        userId: challenge.user_id,
        eventType: "login",
        action: "challenge_replay_blocked",
        success: false,
        request,
        metadata: {
          reason: "challenge_already_consumed",
        },
      });

      return NextResponse.json(
        { error: "Login verification has already been used." },
        { status: 401 }
      );
    }

    await writeSecurityLog({
      userId: challenge.user_id,
      eventType: "login",
      action: "challenge_completed",
      success: true,
      request,
      metadata: {
        email: challenge.email,
        otp_verified: true,
      },
    });

    const cookieStore = await cookies();

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Missing Supabase environment variables");
    }

    const response = NextResponse.json({
      success: true,
      userId: challenge.user_id,
      email: challenge.email,
    });

    const browserSession = createServerClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    const { error: setSessionError } =
      await browserSession.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

    if (setSessionError) {
      console.error("LOGIN SESSION HANDOFF ERROR:", {
        message: setSessionError.message,
      });

      return NextResponse.json(
        { error: "Secure login session could not be established." },
        { status: 500 }
      );
    }

    response.cookies.delete("ultima_login_challenge");
    response.cookies.delete("ultima_login_access_token");
    response.cookies.delete("ultima_login_refresh_token");
    response.cookies.delete("ultima_login_otp_proof");

    return response;
  } catch (error) {
    console.error("LOGIN COMPLETE ERROR:", error);

    await writeSecurityLog({
      eventType: "login",
      action: "challenge_completed",
      success: false,
      request,
      metadata: {
        reason: "server_error",
      },
    });

    return NextResponse.json(
      { error: "Unable to complete login." },
      { status: 500 }
    );
  }
}
