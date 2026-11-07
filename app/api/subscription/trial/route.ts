import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { writeSecurityLog } from "@/lib/server/security-log";

export const runtime = "nodejs";

const TRIAL_HOURS = 48;
const PROOF_MAX_AGE_MS = 10 * 60 * 1000;

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

function hmac(value: string) {
  return createHmac("sha256", serviceRoleKey!)
    .update(value, "utf8")
    .digest("hex");
}

function getClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function verifySignupProof(request: Request) {
  if (!serviceRoleKey) return null;

  const cookieHeader = request.headers.get("cookie") || "";
  const match = cookieHeader.match(
    /(?:^|;\s*)ultima_signup_trial_proof=([^;]+)/
  );

  if (!match?.[1]) return null;

  try {
    const decoded = Buffer.from(match[1], "base64url").toString("utf8");
    const parts = decoded.split(":");

    if (parts.length !== 3) return null;

    const email = parts[0];
    const issuedAt = Number(parts[1]);
    const signature = parts[2];

    if (!email || !Number.isFinite(issuedAt) || !signature) {
      return null;
    }

    if (Date.now() - issuedAt > PROOF_MAX_AGE_MS) {
      return null;
    }

    const payload = `${email}:${issuedAt}`;
    const expected = createHmac("sha256", serviceRoleKey)
      .update(payload, "utf8")
      .digest("base64url");

    const actualBuffer = Buffer.from(signature, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");

    if (actualBuffer.length !== expectedBuffer.length) {
      return null;
    }

    if (!timingSafeEqual(actualBuffer, expectedBuffer)) {
      return null;
    }

    return email;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const admin = getAdminClient();

    const verifiedEmail = verifySignupProof(request);

    if (!verifiedEmail) {
      return NextResponse.json(
        {
          error: "Verified signup session is required.",
          code: "TRIAL_PROOF_REQUIRED",
        },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));

    const deviceSignal = String(body?.device_signal || "")
      .trim()
      .slice(0, 1000);

    if (!deviceSignal) {
      return NextResponse.json(
        {
          error: "Device security signal is required.",
          code: "DEVICE_SIGNAL_REQUIRED",
        },
        { status: 400 }
      );
    }

    const emailHash = hmac(`email:${verifiedEmail}`);
    const deviceHash = hmac(`device:${deviceSignal}`);
    const ip = getClientIp(request);
    const networkHash = hmac(`network:${ip}`);

    const { data: userPage, error: userError } =
      await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });

    if (userError) {
      console.error("TRIAL USER LOOKUP ERROR:", userError);
      return NextResponse.json(
        { error: "Unable to verify trial account." },
        { status: 500 }
      );
    }

    const user = userPage.users.find(
      (item) => item.email?.trim().toLowerCase() === verifiedEmail
    );

    if (!user) {
      return NextResponse.json(
        {
          error: "Account is not ready for trial activation.",
          code: "ACCOUNT_NOT_FOUND",
        },
        { status: 400 }
      );
    }

    const { data: existingByEmail, error: emailError } = await admin
      .from("trial_accounts")
      .select("id,user_id,status")
      .eq("email_hash", emailHash)
      .limit(1);

    if (emailError) throw emailError;

    if (existingByEmail?.length) {
      return NextResponse.json(
        {
          error: "A free trial has already been used for this email.",
          code: "TRIAL_ALREADY_USED",
        },
        { status: 403 }
      );
    }

    const { data: existingByDevice, error: deviceError } = await admin
      .from("trial_accounts")
      .select("id,user_id,status")
      .eq("device_hash", deviceHash)
      .limit(1);

    if (deviceError) throw deviceError;

    const { data: existingByNetwork, error: networkError } = await admin
      .from("trial_accounts")
      .select("id,user_id,status")
      .eq("network_hash", networkHash)
      .limit(1);

    if (networkError) throw networkError;

    const deviceSeen = Boolean(existingByDevice?.length);
    const networkSeen = Boolean(existingByNetwork?.length);

    /*
     * Exact device + network reuse is treated as a blocked
     * trial signal. A network match by itself is not enough,
     * because multiple legitimate users can share a network.
     */
    if (deviceSeen && networkSeen) {
      await writeSecurityLog({
        eventType: "subscription",
        action: "trial_denied",
        success: false,
        request,
        metadata: {
          reason: "device_and_network_reuse",
          user_id: user.id,
        },
      });

      return NextResponse.json(
        {
          error:
            "This account is not eligible for another free trial on this device/network.",
          code: "TRIAL_NOT_ELIGIBLE",
        },
        { status: 403 }
      );
    }

    const now = new Date();
    const expires = new Date(
      now.getTime() + TRIAL_HOURS * 60 * 60 * 1000
    );

    const { data: trial, error: trialError } = await admin
      .from("trial_accounts")
      .insert({
        user_id: user.id,
        trial_started_at: now.toISOString(),
        trial_expires_at: expires.toISOString(),
        status: "active",
        eligibility_status: "eligible",
        device_hash: deviceHash,
        network_hash: networkHash,
        email_hash: emailHash,
        risk_level: deviceSeen || networkSeen ? "medium" : "low",
        restriction_reason: null,
      })
      .select(
        "id,trial_started_at,trial_expires_at,status,eligibility_status,risk_level"
      )
      .single();

    if (trialError) {
      if (trialError.code === "23505") {
        return NextResponse.json(
          {
            error: "A trial already exists for this account.",
            code: "TRIAL_ALREADY_EXISTS",
          },
          { status: 409 }
        );
      }

      throw trialError;
    }

    await writeSecurityLog({
      eventType: "subscription",
      action: "trial_started",
      success: true,
      request,
      metadata: {
        user_id: user.id,
        trial_id: trial.id,
        duration_hours: TRIAL_HOURS,
        risk_level: trial.risk_level,
      },
    });

    const response = NextResponse.json({
      success: true,
      trial: {
        status: trial.status,
        started_at: trial.trial_started_at,
        expires_at: trial.trial_expires_at,
        duration_hours: TRIAL_HOURS,
      },
    });

    response.cookies.set({
      name: "ultima_signup_trial_proof",
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    });

    return response;
  } catch (error) {
    console.error("TRIAL ACTIVATION ERROR:", error);

    return NextResponse.json(
      { error: "Unable to activate free trial." },
      { status: 500 }
    );
  }
}
