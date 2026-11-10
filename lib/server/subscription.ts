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

export async function getSubscriptionAccess(
  _userId: string
): Promise<SubscriptionAccess> {
  return {
    allowed: true,
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
