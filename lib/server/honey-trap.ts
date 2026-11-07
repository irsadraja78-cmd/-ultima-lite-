import { createClient } from "@supabase/supabase-js";
import {
  evaluateSecurityRisk,
  type SecurityRiskResult,
} from "./risk-engine";
import { writeSecurityLog } from "./security-log";

type HoneyTrapSeverity =
  | "normal"
  | "elevated"
  | "high"
  | "critical";

type HoneyTrapResult = {
  triggered: boolean;
  reason: string | null;
  severity: HoneyTrapSeverity;
  recentHits: number;
  riskScore: number | null;
  riskDecision: string | null;
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

function getRequestIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();

    if (firstIp) {
      return firstIp;
    }
  }

  return request.headers.get("x-real-ip")?.trim() || null;
}

function getSeverity(hitCount: number): HoneyTrapSeverity {
  if (hitCount >= 10) return "critical";
  if (hitCount >= 5) return "high";
  if (hitCount >= 3) return "elevated";
  return "normal";
}

export async function handleHoneyTrap(
  request: Request,
  userId?: string | null,
  reason = "decoy_endpoint_access"
): Promise<HoneyTrapResult> {
  const admin = getAdminClient();

  const ip = getRequestIp(request);
  const userAgent = request.headers.get("user-agent") || null;
  const method = request.method;
  const path = new URL(request.url).pathname;

  const since = new Date(
    Date.now() - 15 * 60 * 1000
  ).toISOString();

  let recentHits = 1;
  let countQueryError: string | null = null;

  /*
   * Count previous Honey Trap events from the same IP.
   * We deliberately fetch the row IDs and count them locally.
   * This avoids relying on Supabase head/count response behavior.
   */
  if (ip) {
    try {
      const { data, error } = await admin
        .from("security_logs")
        .select("id")
        .eq("event_type", "honey_trap")
        .eq("ip_address", ip)
        .gte("created_at", since)
        .limit(200);

      if (error) {
        countQueryError = JSON.stringify(error);
        console.error(
          "HONEY TRAP COUNT QUERY ERROR:",
          countQueryError
        );
        recentHits = 1;
      } else {
        recentHits = (data?.length ?? 0) + 1;
      }
    } catch (error) {
      countQueryError =
        error instanceof Error ? error.message : String(error);

      console.error(
        "HONEY TRAP COUNT EXCEPTION:",
        countQueryError
      );

      recentHits = 1;
    }
  }


  const severity = getSeverity(recentHits);

  let riskResult: SecurityRiskResult | null = null;

  /*
   * Authenticated Honey Trap hits also enter the unified
   * security risk engine. Anonymous hits are still tracked
   * and escalated by IP.
   */
  if (userId) {
    try {
      riskResult = await evaluateSecurityRisk(userId, request);
    } catch {
      riskResult = null;
    }
  }

  await writeSecurityLog({
    userId: userId ?? null,
    eventType: "honey_trap",
    action: "honey_trap_triggered",
    success: false,
    request,
    metadata: {
      detection: "backend_honey_trap",
      reason,
      method,
      path,
      ip,
      user_agent: userAgent,
      recent_hits_15m: recentHits,
      count_query_error: countQueryError,
      severity,
      risk_score: riskResult?.riskScore ?? null,
      risk_level: riskResult?.riskLevel ?? null,
      risk_decision: riskResult?.decision ?? null,
    },
  });

  /*
   * Correlate authenticated Honey Trap activity with the
   * unified risk engine so repeated probing contributes to
   * the central security audit trail.
   */
  if (userId && riskResult) {
    try {
      const { writeSecurityRiskLog } = await import("./risk-engine");

      await writeSecurityRiskLog(
        userId,
        request,
        riskResult,
        "honey_trap_risk_correlated"
      );
    } catch {
      // Risk correlation must never break the detector.
    }
  }

  /*
   * Escalation is recorded separately so monitoring can
   * distinguish a single accidental hit from repeated probing.
   */
  if (severity !== "normal") {
    await writeSecurityLog({
      userId: userId ?? null,
      eventType: "honey_trap_escalation",
      action: `honey_trap_${severity}`,
      success: false,
      request,
      metadata: {
        detection: "repeated_honey_trap",
        reason,
        method,
        path,
        ip,
        recent_hits_15m: recentHits,
        severity,
        risk_score: riskResult?.riskScore ?? null,
        risk_level: riskResult?.riskLevel ?? null,
        risk_decision: riskResult?.decision ?? null,
      },
    });
  }

  return {
    triggered: true,
    reason,
    severity,
    recentHits,
    riskScore: riskResult?.riskScore ?? null,
    riskDecision: riskResult?.decision ?? null,
  };
}
