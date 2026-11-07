import { NextResponse } from "next/server";
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

async function getAuthenticatedUser(request: Request) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const accessToken = authorization.slice(7).trim();

  if (!accessToken) {
    return null;
  }

  const admin = getAdminClient();

  const {
    data: { user },
    error,
  } = await admin.auth.getUser(accessToken);

  if (error || !user) {
    return null;
  }

  return { admin, user };
}

const DEFAULT_SETTINGS = {
  timing_locker_enabled: true,
  timing_timeout_minutes: 10,
  screen_light_locker_enabled: false,
  person_detection_enabled: false,
  second_person_lock_enabled: true,
  screen_lock_delay_seconds: 0,
  unlock_method: "password",
};

export async function GET(request: Request) {
  try {
    const auth = await getAuthenticatedUser(request);

    if (!auth) {
      return NextResponse.json(
        { success: false, error: "Authentication required." },
        { status: 401 },
      );
    }

    const { admin, user } = auth;

    const { data, error } = await admin
      .from("security_locker_settings")
      .select(
        "timing_locker_enabled,timing_timeout_minutes,screen_light_locker_enabled,person_detection_enabled,second_person_lock_enabled,screen_lock_delay_seconds,unlock_method",
      )
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("LOCKER SETTINGS GET ERROR:", error);

      return NextResponse.json(
        { success: false, error: "Unable to load security settings." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      settings: data || DEFAULT_SETTINGS,
    });
  } catch (error) {
    console.error("LOCKER SETTINGS GET UNEXPECTED ERROR:", error);

    return NextResponse.json(
      { success: false, error: "Unable to load security settings." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await getAuthenticatedUser(request);

    if (!auth) {
      return NextResponse.json(
        { success: false, error: "Authentication required." },
        { status: 401 },
      );
    }

    const { admin, user } = auth;
    const body = await request.json();

    const timingLockerEnabled =
      typeof body.timing_locker_enabled === "boolean"
        ? body.timing_locker_enabled
        : DEFAULT_SETTINGS.timing_locker_enabled;

    const timeoutMinutes = Number(body.timing_timeout_minutes);

    const screenLightEnabled =
      typeof body.screen_light_locker_enabled === "boolean"
        ? body.screen_light_locker_enabled
        : DEFAULT_SETTINGS.screen_light_locker_enabled;

    const personDetectionEnabled =
      typeof body.person_detection_enabled === "boolean"
        ? body.person_detection_enabled
        : DEFAULT_SETTINGS.person_detection_enabled;

    if (screenLightEnabled || personDetectionEnabled) {
      const { data: profile } = await admin
        .from("user_profiles")
        .select("current_photo_path")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!profile?.current_photo_path) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Upload your Current Profile Photo before enabling Screen Light Locker or Person Detection.",
            code: "CURRENT_PROFILE_PHOTO_REQUIRED",
          },
          { status: 400 },
        );
      }
    }

    const secondPersonLockEnabled =
      typeof body.second_person_lock_enabled === "boolean"
        ? body.second_person_lock_enabled
        : DEFAULT_SETTINGS.second_person_lock_enabled;

    const delaySeconds = Number(body.screen_lock_delay_seconds);

    const unlockMethod =
      body.unlock_method === "pin" ? "pin" : "password";

    if (
      !Number.isInteger(timeoutMinutes) ||
      timeoutMinutes < 1 ||
      timeoutMinutes > 60
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Timing Locker timeout must be between 1 and 60 minutes.",
        },
        { status: 400 },
      );
    }

    if (
      !Number.isInteger(delaySeconds) ||
      delaySeconds < 0 ||
      delaySeconds > 60
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Screen lock delay must be between 0 and 60 seconds.",
        },
        { status: 400 },
      );
    }

    const settings = {
      user_id: user.id,
      timing_locker_enabled: timingLockerEnabled,
      timing_timeout_minutes: timeoutMinutes,
      screen_light_locker_enabled: screenLightEnabled,
      person_detection_enabled: personDetectionEnabled,
      second_person_lock_enabled: secondPersonLockEnabled,
      screen_lock_delay_seconds: delaySeconds,
      unlock_method: unlockMethod,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await admin
      .from("security_locker_settings")
      .upsert(settings, { onConflict: "user_id" })
      .select(
        "timing_locker_enabled,timing_timeout_minutes,screen_light_locker_enabled,person_detection_enabled,second_person_lock_enabled,screen_lock_delay_seconds,unlock_method",
      )
      .single();

    if (error) {
      console.error("LOCKER SETTINGS UPDATE ERROR:", error);

      return NextResponse.json(
        { success: false, error: "Unable to save security settings." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      settings: data,
    });
  } catch (error) {
    console.error("LOCKER SETTINGS PATCH UNEXPECTED ERROR:", error);

    return NextResponse.json(
      { success: false, error: "Unable to save security settings." },
      { status: 500 },
    );
  }
}
