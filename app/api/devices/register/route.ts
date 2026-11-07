import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

function getClientIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");

  return (
    forwardedFor?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null
  );
}

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization");
    const accessToken = authorization?.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    if (!accessToken) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      );
    }

    const body = await request.json();

    const fingerprint = String(body.fingerprint || "").trim();
    const deviceName = String(body.deviceName || "").trim().slice(0, 120);
    const deviceType = String(body.deviceType || "").trim().slice(0, 40);
    const browser = String(body.browser || "").trim().slice(0, 80);
    const operatingSystem = String(body.operatingSystem || "")
      .trim()
      .slice(0, 80);

    if (!/^[a-f0-9]{64}$/i.test(fingerprint)) {
      return NextResponse.json(
        { error: "Invalid device fingerprint." },
        { status: 400 }
      );
    }

    const admin = getAdminClient();

    const {
      data: userData,
      error: userError,
    } = await admin.auth.getUser(accessToken);

    if (userError || !userData.user) {
      return NextResponse.json(
        { error: "Invalid or expired session." },
        { status: 401 }
      );
    }

    const userId = userData.user.id;
    const ipAddress = getClientIp(request);
    const userAgent = request.headers.get("user-agent");

    const { data: existing, error: existingError } = await admin
      .from("user_devices")
      .select(
        "id,user_id,device_fingerprint,device_name,device_type,browser,operating_system,is_trusted,is_active,first_seen_at,last_seen_at"
      )
      .eq("user_id", userId)
      .eq("device_fingerprint", fingerprint)
      .maybeSingle();

    if (existingError) {
      console.error("DEVICE LOOKUP ERROR:", existingError);

      return NextResponse.json(
        { error: "Unable to check device." },
        { status: 500 }
      );
    }

    if (existing) {
      if (!existing.is_active) {
        await writeSecurityLog({
          userId,
          eventType: "device_security",
          action: "revoked_device_login_blocked",
          success: false,
          request,
          metadata: {
            deviceId: existing.id,
            fingerprint,
          },
        });

        return NextResponse.json(
          {
            error: "This device has been revoked.",
            deviceBlocked: true,
          },
          { status: 403 }
        );
      }

      const { error: updateError } = await admin
        .from("user_devices")
        .update({
          device_name: deviceName || existing.device_name,
          device_type: deviceType || existing.device_type,
          browser: browser || existing.browser,
          operating_system:
            operatingSystem || existing.operating_system,
          last_ip_address: ipAddress,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (updateError) {
        console.error("DEVICE UPDATE ERROR:", updateError);
      }

      await admin.from("device_security_events").insert({
        user_id: userId,
        device_id: existing.id,
        event_type: "device_security",
        action: "known_device_login",
        success: true,
        ip_address: ipAddress,
        user_agent: userAgent,
        metadata: {
          fingerprint,
          trusted: existing.is_trusted,
        },
      });

      await writeSecurityLog({
        userId,
        eventType: "device_security",
        action: "known_device_login",
        success: true,
        request,
        metadata: {
          deviceId: existing.id,
          fingerprint,
          trusted: existing.is_trusted,
        },
      });

      return NextResponse.json({
        success: true,
        deviceId: existing.id,
        isTrusted: existing.is_trusted,
        isNewDevice: false,
      });
    }

    const { count, error: countError } = await admin
      .from("user_devices")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    if (countError) {
      console.error("DEVICE COUNT ERROR:", countError);

      return NextResponse.json(
        { error: "Unable to register device." },
        { status: 500 }
      );
    }

    const firstDevice = (count || 0) === 0;

    const { data: inserted, error: insertError } = await admin
      .from("user_devices")
      .insert({
        user_id: userId,
        device_fingerprint: fingerprint,
        device_name: deviceName || "Unknown device",
        device_type: deviceType || "unknown",
        browser: browser || "Unknown",
        operating_system: operatingSystem || "Unknown",
        first_ip_address: ipAddress,
        last_ip_address: ipAddress,
        is_trusted: firstDevice,
        is_active: true,
        trusted_at: firstDevice
          ? new Date().toISOString()
          : null,
        metadata: {
          registered_after_login_otp: true,
          first_device: firstDevice,
          requires_trust_review: !firstDevice,
        },
      })
      .select(
        "id,user_id,device_fingerprint,is_trusted,is_active,first_seen_at"
      )
      .single();

    if (insertError || !inserted) {
      console.error("DEVICE INSERT ERROR:", insertError);

      return NextResponse.json(
        { error: "Unable to register device." },
        { status: 500 }
      );
    }

    await admin.from("device_security_events").insert({
      user_id: userId,
      device_id: inserted.id,
      event_type: "device_security",
      action: firstDevice
        ? "first_device_registered"
        : "new_device_registered",
      success: true,
      ip_address: ipAddress,
      user_agent: userAgent,
      metadata: {
        fingerprint,
        firstDevice,
        trusted: firstDevice,
        requiresTrustReview: !firstDevice,
      },
    });

    await writeSecurityLog({
      userId,
      eventType: "device_security",
      action: firstDevice
        ? "first_device_registered"
        : "new_device_registered",
      success: true,
      request,
      metadata: {
        deviceId: inserted.id,
        fingerprint,
        firstDevice,
        trusted: firstDevice,
        requiresTrustReview: !firstDevice,
      },
    });

    return NextResponse.json({
      success: true,
      deviceId: inserted.id,
      isTrusted: firstDevice,
      isNewDevice: true,
    });
  } catch (error) {
    console.error("DEVICE REGISTER ERROR:", error);

    return NextResponse.json(
      { error: "Unable to register device." },
      { status: 500 }
    );
  }
}
