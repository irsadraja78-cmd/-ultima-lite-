import { NextResponse } from "next/server";
import { randomInt } from "node:crypto";
import { writeSecurityLog } from "@/lib/server/security-log";
import { createClient } from "@supabase/supabase-js";
import { consumeApiRateLimit } from "@/lib/server/api-rate-limit";
import { handleHoneypot } from "@/lib/server/honeypot";

function generateOtp() {
  return randomInt(100000, 1000000).toString();
}

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

export async function POST(request: Request) {
  const admin = getAdminClient();
  try {
    const body = await request.json();

    if (await handleHoneypot(request, body)) {
      return NextResponse.json(
        { error: "Invalid request." },
        { status: 400 }
      );
    }

    const { email, purpose } = body;

    if (!email || !purpose) {
      return NextResponse.json(
        { error: "Email and OTP purpose are required." },
        { status: 400 }
      );
    }

    if (!["signup", "login", "password_reset"].includes(purpose)) {
      return NextResponse.json(
        { error: "Invalid OTP purpose." },
        { status: 400 }
      );
    }

    const recipientEmail = String(email).trim().toLowerCase();

    console.log("OTP SEND START");

    const ipLimit = await consumeApiRateLimit(
      request,
      "otp-send-ip",
      20,
      600
    );

    const emailLimit = await consumeApiRateLimit(
      request,
      "otp-send-email",
      5,
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
          reason: "otp_send_rate_limit",
        },
      });

      return NextResponse.json(
        { error: "Too many OTP requests. Please try again later." },
        { status: 429 }
      );
    }

    const apiKey = process.env.RESEND_API_KEY;

 
    if (!apiKey) {
      console.error("RESEND API KEY IS NOT CONFIGURED");

      return NextResponse.json(
        { error: "OTP service is temporarily unavailable." },
        { status: 500 }
      );
    }

    const now = Date.now();
    const tenMinutesAgo = new Date(now - 10 * 60 * 1000).toISOString();

    // Resend cooldown: one OTP per email/purpose every 60 seconds.
    const { data: recentOtp, error: recentError } = await admin
      .from("email_otps")
      .select("id, created_at")
      .eq("email", recipientEmail)
      .eq("purpose", purpose)
      .gte("created_at", new Date(now - 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentError) {
      console.error("OTP RATE LIMIT ERROR:", {
        code: recentError.code,
        details: recentError.details,
        hint: recentError.hint,
      });

      return NextResponse.json(
        { error: "Unable to check OTP request limit." },
        { status: 500 }
      );
    }

    if (recentOtp) {
      return NextResponse.json(
        { error: "Please wait 60 seconds before requesting another OTP." },
        { status: 429 }
      );
    }

    // Maximum 5 OTP requests per email/purpose in 10 minutes.
    const { count: recentCount, error: countError } = await admin
      .from("email_otps")
      .select("id", { count: "exact", head: true })
      .eq("email", recipientEmail)
      .eq("purpose", purpose)
      .gte("created_at", tenMinutesAgo);

    if (countError) {
      return NextResponse.json(
        { error: "Unable to check OTP request limit." },
        { status: 500 }
      );
    }

    if ((recentCount ?? 0) >= 5) {
      return NextResponse.json(
        { error: "Too many OTP requests. Please try again later." },
        { status: 429 }
      );
    }

    // Invalidate previous unused OTPs for this email/purpose.
    const { error: invalidateError } = await admin
      .from("email_otps")
      .update({ verified: true })
      .eq("email", recipientEmail)
      .eq("purpose", purpose)
      .eq("verified", false);

    if (invalidateError) {
      return NextResponse.json(
        { error: "Unable to prepare a new OTP." },
        { status: 500 }
      );
    }

    const otp = generateOtp();
    const expiresAt = new Date(
      now + 10 * 60 * 1000
    ).toISOString();

 
    const { data: insertedOtp, error: dbError } = await admin
      .from("email_otps")
      .insert({
        email: recipientEmail,
        otp,
        purpose,
        expires_at: expiresAt,
        verified: false,
        attempts: 0,
        last_attempt_at: null,
      })
      .select("id")
      .single();

    if (dbError || !insertedOtp?.id) {
      if (dbError) {
        console.error("OTP DATABASE ERROR:", {
          code: dbError.code,
          details: dbError.details,
          hint: dbError.hint,
        });
      }

      if (dbError?.code === "23505") {
        return NextResponse.json(
          { error: "An OTP request is already being processed. Please try again shortly." },
          { status: 429 }
        );
      }

      return NextResponse.json(
        { error: "Unable to create OTP. Please try again." },
        { status: 500 }
      );
    }

    const insertedOtpId = insertedOtp.id;

 
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Ultima Lite <onboarding@resend.dev>",
        to: [recipientEmail],
        subject:
          purpose === "signup"
            ? "Ultima Lite — Email Verification OTP"
            : purpose === "login"
              ? "Ultima Lite — Login OTP"
              : "Ultima Lite — Password Reset OTP",
        html: `
          <div style="font-family:Arial,sans-serif;padding:30px">
            <h2>Ultima Lite</h2>
            <p>Your verification code is:</p>
            <div style="font-size:32px;font-weight:bold;letter-spacing:8px">
              ${otp}
            </div>
            <p>This OTP expires in 10 minutes.</p>
          </div>
        `,
      }),
    });

    const data = await response.json();

 
    if (!response.ok) {
      console.error("RESEND OTP DELIVERY FAILED:", {
        status: response.status,
        name: data?.name,
        message: data?.message,
        code: data?.code,
      });

      const { error: cleanupError } = await admin
        .from("email_otps")
        .update({ verified: true })
        .eq("id", insertedOtpId)
        .eq("verified", false);

      if (cleanupError) {
        console.error("OTP FAILED-SEND CLEANUP ERROR:", {
          code: cleanupError.code,
          details: cleanupError.details,
          hint: cleanupError.hint,
        });
      }

      await writeSecurityLog({
        eventType: "otp",
        action: "send_failed",
        success: false,
        request,
        metadata: {
          purpose,
          reason: "resend_delivery_failed",
          provider_status: response.status,
        },
      });

      return NextResponse.json(
        { error: "Unable to send OTP. Please try again later." },
        { status: 502 }
      );
    }

    await writeSecurityLog({
      eventType: "otp",
      action: "send",
      success: true,
      request,
      metadata: {
        purpose,
      },
    });

    return NextResponse.json({
      success: true,
      message: "OTP sent successfully.",
    });
  } catch (error) {
    console.error("SEND OTP ERROR:", error);

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid request." },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Unable to process OTP request." },
      { status: 500 }
    );
  }
}
