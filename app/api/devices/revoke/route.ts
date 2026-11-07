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

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const deviceId =
      typeof body?.deviceId === "string" ? body.deviceId.trim() : "";

    if (!deviceId) {
      return NextResponse.json(
        { success: false, error: "deviceId is required" },
        { status: 400 }
      );
    }

    const { data: device, error: deviceError } = await supabaseAdmin
      .from("user_devices")
      .select(
        "id,user_id,device_name,device_type,browser,operating_system,is_active,is_trusted,revoked_at"
      )
      .eq("id", deviceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (deviceError) {
      console.error("DEVICE_LOOKUP_ERROR", deviceError);

      return NextResponse.json(
        { success: false, error: "Unable to find device" },
        { status: 500 }
      );
    }

    if (!device) {
      return NextResponse.json(
        { success: false, error: "Device not found" },
        { status: 404 }
      );
    }

    if (!device.is_active || device.revoked_at) {
      return NextResponse.json({
        success: true,
        alreadyRevoked: true,
        message: "Device is already revoked",
      });
    }

    const now = new Date().toISOString();

    const { error: updateError } = await supabaseAdmin
      .from("user_devices")
      .update({
        is_active: false,
        is_trusted: false,
        revoked_at: now,
        updated_at: now,
      })
      .eq("id", device.id)
      .eq("user_id", user.id);

    if (updateError) {
      console.error("DEVICE_REVOKE_ERROR", updateError);

      return NextResponse.json(
        { success: false, error: "Unable to revoke device" },
        { status: 500 }
      );
    }

    const ip = getClientIp(request);
    const userAgent = request.headers.get("user-agent") || "unknown";

    await supabaseAdmin.from("device_security_events").insert({
      user_id: user.id,
      device_id: device.id,
      event_type: "device_revocation",
      action: "device_revoked",
      success: true,
      ip_address: ip,
      user_agent: userAgent,
      metadata: {
        device_name: device.device_name,
        device_type: device.device_type,
        browser: device.browser,
        operating_system: device.operating_system,
      },
    });

    await supabaseAdmin.from("security_logs").insert({
      user_id: user.id,
      event_type: "device_security",
      ip_address: ip,
      user_agent: userAgent,
      metadata: {
        action: "device_revoked",
        device_id: device.id,
        device_name: device.device_name,
        device_type: device.device_type,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Device revoked successfully",
      deviceId: device.id,
    });
  } catch (error) {
    console.error("DEVICE_REVOKE_UNEXPECTED_ERROR", error);

    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
