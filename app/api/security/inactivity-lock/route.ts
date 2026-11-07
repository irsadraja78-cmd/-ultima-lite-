import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { writeSecurityLog } from "@/lib/server/security-log";

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

    if (userError || !user) {
      return NextResponse.json(
        { error: "Invalid authentication session." },
        { status: 401 }
      );
    }

    await writeSecurityLog({
      userId: user.id,
      eventType: "session_security",
      action: "inactivity_lock",
      success: true,
      request,
      metadata: {
        source: "work_file_inactivity_lock",
      },
    });

    return NextResponse.json({
      success: true,
      action: "inactivity_lock_recorded",
    });
  } catch (error) {
    console.error("INACTIVITY LOCK ERROR:", error);

    return NextResponse.json(
      { error: "Unable to record inactivity lock." },
      { status: 500 }
    );
  }
}
