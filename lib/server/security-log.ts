import { createClient } from "@supabase/supabase-js";

type SecurityLogInput = {
  userId?: string | null;
  eventType: string;
  action: string;
  success: boolean;
  request?: Request;
  metadata?: Record<string, unknown>;
};

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

export async function writeSecurityLog({
  userId,
  eventType,
  action,
  success,
  request,
  metadata = {},
}: SecurityLogInput) {
  try {
    const admin = getAdminClient();

    const forwardedFor = request?.headers.get("x-forwarded-for");
    const ipAddress =
      forwardedFor?.split(",")[0]?.trim() ||
      request?.headers.get("x-real-ip") ||
      null;

    const userAgent =
      request?.headers.get("user-agent") || null;

    const { error } = await admin
      .from("security_logs")
      .insert({
        user_id: userId || null,
        event_type: eventType,
        action,
        success,
        ip_address: ipAddress,
        user_agent: userAgent,
        metadata,
      });

    if (error) {
      console.error("SECURITY LOG WRITE ERROR:", error);
    }
  } catch (error) {
    console.error("SECURITY LOGGER ERROR:", error);
  }
}
