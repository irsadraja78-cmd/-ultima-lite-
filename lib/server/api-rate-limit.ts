import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";

type RateLimitResult = {
  allowed: boolean;
};

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

function getClientAddress(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");

  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  return (
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

function hashKey(value: string) {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

export async function consumeApiRateLimit(
  request: Request,
  bucket: string,
  maxRequests: number,
  windowSeconds: number,
  extraKey = ""
): Promise<RateLimitResult> {
  const address = getClientAddress(request);

  const rawKey = [
    bucket,
    address,
    extraKey.trim().toLowerCase(),
  ].join(":");

  const keyHash = hashKey(rawKey);

  const admin = getAdminClient();

  const { data, error } = await admin.rpc(
    "consume_api_rate_limit",
    {
      p_bucket: bucket,
      p_key_hash: keyHash,
      p_window_seconds: windowSeconds,
      p_max_requests: maxRequests,
    }
  );

  if (error) {
    console.error("API RATE LIMIT ERROR:", error);

    return { allowed: false };
  }

  return {
    allowed: Boolean(data),
  };
}
