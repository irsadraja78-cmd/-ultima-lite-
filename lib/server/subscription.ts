import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SubscriptionAccess = {
  allowed: boolean;
  source: "trial" | "subscription" | "none";
  expiresAt: string | null;
  reason:
    | "trial_active"
    | "subscription_active"
    | "trial_expired"
    | "subscription_expired"
    | "no_entitlement";
};

function getAdminClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Server configuration is missing.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function getSubscriptionAccess(
  userId: string
): Promise<SubscriptionAccess> {
  if (process.env.ULTIMA_DEV_SUBSCRIPTION_BYPASS === "true") {
    return {
      allowed: true,
      source: "subscription",
      expiresAt: null,
      reason: "subscription_active",
    };
  }
  const admin = getAdminClient();
  const now = Date.now();

  const { data: trial, error: trialError } = await admin
    .from("trial_accounts")
    .select("status, trial_expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (trialError) {
    throw new Error(`Trial lookup failed: ${trialError.message}`);
  }

  if (
    trial?.status === "active" &&
    trial.trial_expires_at &&
    new Date(trial.trial_expires_at).getTime() > now
  ) {
    return {
      allowed: true,
      source: "trial",
      expiresAt: trial.trial_expires_at,
      reason: "trial_active",
    };
  }

  const { data: subscription, error: subscriptionError } = await admin
    .from("subscriptions")
    .select("status, current_period_end")
    .eq("user_id", userId)
    .in("status", ["active"])
    .order("current_period_end", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subscriptionError) {
    throw new Error(
      `Subscription lookup failed: ${subscriptionError.message}`
    );
  }

  if (
    subscription?.status === "active" &&
    (!subscription.current_period_end ||
      new Date(subscription.current_period_end).getTime() > now)
  ) {
    return {
      allowed: true,
      source: "subscription",
      expiresAt: subscription.current_period_end ?? null,
      reason: "subscription_active",
    };
  }

  if (trial) {
    return {
      allowed: false,
      source: "none",
      expiresAt: trial.trial_expires_at ?? null,
      reason: "trial_expired",
    };
  }

  if (subscription) {
    return {
      allowed: false,
      source: "none",
      expiresAt: subscription.current_period_end ?? null,
      reason: "subscription_expired",
    };
  }

  return {
    allowed: false,
    source: "none",
    expiresAt: null,
    reason: "no_entitlement",
  };
}

export async function requireSubscription(
  userId: string
): Promise<SubscriptionAccess> {
  return getSubscriptionAccess(userId);
}
