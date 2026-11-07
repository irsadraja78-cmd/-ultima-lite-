import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { handleHoneypot } from "@/lib/server/honeypot";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (await handleHoneypot(request, body)) {
      return NextResponse.json(
        { error: "Invalid request." },
        { status: 400 }
      );
    }

    const { email, otp, password } = body;

    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanOtp = String(otp || "").trim();
    const cleanPassword = String(password || "");

    if (!cleanEmail || !cleanOtp || !cleanPassword) {
      return NextResponse.json(
        { error: "Email, OTP and password are required." },
        { status: 400 }
      );
    }

    if (cleanOtp.length !== 6) {
      return NextResponse.json(
        { error: "Please enter the 6-digit OTP." },
        { status: 400 }
      );
    }

    if (cleanPassword.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters." },
        { status: 400 }
      );
    }

    if (cleanPassword.length > 72) {
      return NextResponse.json(
        { error: "Password is too long." },
        { status: 400 }
      );
    }

    /*
     * IMPORTANT:
     * Do not query email_otps here.
     * The existing /api/verify-otp route already handles
     * OTP lookup, expiry and verification.
     */
    const origin =
      request.headers.get("origin") ||
      new URL(request.url).origin;

    const otpResponse = await fetch(
      `${origin}/api/verify-otp`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: cleanEmail,
          otp: cleanOtp,
          purpose: "password_reset",
        }),
        cache: "no-store",
      }
    );

    const otpData = await otpResponse.json();

    if (!otpResponse.ok) {
      return NextResponse.json(
        { error: otpData?.error || "Invalid OTP." },
        { status: otpResponse.status }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Supabase server configuration is missing." },
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

    let user = null;
    let page = 1;
    const perPage = 1000;

    while (!user && page <= 100) {
      const { data: usersData, error: usersError } =
        await admin.auth.admin.listUsers({
          page,
          perPage,
        });

      if (usersError) {
        console.error("RESET PASSWORD USER LOOKUP ERROR:", usersError);

        return NextResponse.json(
          { error: "Unable to locate the account." },
          { status: 500 }
        );
      }

      user =
        usersData.users.find(
          (item) =>
            item.email?.trim().toLowerCase() === cleanEmail
        ) ?? null;

      if (usersData.users.length < perPage) {
        break;
      }

      page += 1;
    }

    if (!user) {
      return NextResponse.json(
        { error: "No account was found for this email." },
        { status: 404 }
      );
    }

    const { error: updateError } =
      await admin.auth.admin.updateUserById(user.id, {
        password: cleanPassword,
      });

    if (updateError) {
      return NextResponse.json(
        { error: `Password update failed: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Password updated successfully.",
    });
  } catch (error) {
    console.error("RESET PASSWORD ERROR:", error);

    return NextResponse.json(
      { error: "Unable to reset password." },
      { status: 500 }
    );
  }
}
