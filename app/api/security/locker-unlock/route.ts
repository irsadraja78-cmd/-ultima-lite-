import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { consumeApiRateLimit } from "@/lib/server/api-rate-limit";
import { writeSecurityLog } from "@/lib/server/security-log";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) throw new Error("Missing Supabase server configuration");

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, error: "Authentication required." },
        { status: 401 },
      );
    }

    const accessToken = authorization.slice(7).trim();
    const body = await request.json();
    const password = String(body?.password || "");

    if (!password || password.length > 1024) {
      return NextResponse.json(
        { success: false, error: "Password is required." },
        { status: 400 },
      );
    }

    const admin = getAdminClient();

    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(accessToken);

    if (userError || !user?.email) {
      return NextResponse.json(
        { success: false, error: "Session is invalid." },
        { status: 401 },
      );
    }

    const limit = await consumeApiRateLimit(
      request,
      "locker-unlock",
      5,
      300,
      user.email,
    );

    if (!limit.allowed) {
      await writeSecurityLog({
        userId: user.id,
        eventType: "session_security",
        action: "locker_unlock_rate_limit",
        success: false,
        request,
      });

      return NextResponse.json(
        { success: false, error: "Too many unlock attempts. Please try again later." },
        { status: 429 },
      );
    }

    const authClient = getAdminClient();

    const { data, error } = await authClient.auth.signInWithPassword({
      email: user.email,
      password,
    });

    if (error || !data.user || data.user.id !== user.id) {
      await writeSecurityLog({
        userId: user.id,
        eventType: "session_security",
        action: "locker_unlock_password",
        success: false,
        request,
        metadata: { reason: "invalid_password" },
      });

      return NextResponse.json(
        { success: false, error: "Incorrect password." },
        { status: 401 },
      );
    }

    await writeSecurityLog({
      userId: user.id,
      eventType: "session_security",
      action: "locker_unlock_password",
      success: true,
      request,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("LOCKER UNLOCK ERROR:", error);

    return NextResponse.json(
      { success: false, error: "Unable to unlock screen." },
      { status: 500 },
    );
  }
}
