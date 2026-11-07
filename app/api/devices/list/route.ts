import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function GET(request: NextRequest) {
  try {
    const supabaseAdmin = getAdminClient();

    const authHeader = request.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const accessToken = authHeader.slice(7).trim();

    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(accessToken);

    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: "Invalid session" },
        { status: 401 }
      );
    }

    const { data: devices, error } = await supabaseAdmin
      .from("user_devices")
      .select(
        "id,device_fingerprint,device_name,device_type,browser,operating_system,first_ip_address,last_ip_address,first_seen_at,last_seen_at,is_trusted,is_active,trusted_at,revoked_at,created_at,updated_at"
      )
      .eq("user_id", user.id)
      .order("last_seen_at", { ascending: false });

    if (error) {
      console.error("DEVICE_LIST_ERROR", error);

      return NextResponse.json(
        { success: false, error: "Unable to load devices" },
        { status: 500 }
      );
    }

    await supabaseAdmin.from("security_logs").insert({
      user_id: user.id,
      event_type: "device_management",
      ip_address: getClientIp(request),
      user_agent: request.headers.get("user-agent") || "unknown",
      metadata: {
        action: "device_list_viewed",
        device_count: devices?.length || 0,
      },
    });

    return NextResponse.json({
      success: true,
      devices: devices || [],
    });
  } catch (error) {
    console.error("DEVICE_LIST_UNEXPECTED_ERROR", error);

    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
