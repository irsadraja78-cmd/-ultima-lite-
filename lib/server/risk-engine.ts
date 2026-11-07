import { createClient } from "@supabase/supabase-js";
import {
  evaluateIpRisk,
  getRequestIp,
  type IpRiskResult,
  type IpRiskLevel,
} from "./ip-security";

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

export type SecurityRiskLevel =
  | "normal"
  | "low"
  | "medium"
  | "high"
  | "critical";

export type SecurityDecision =
  | "allow"
  | "allow_and_log"
  | "additional_verification"
  | "reauthentication_required"
  | "blocked";

export type SecurityRiskResult = {
  riskScore: number;
  riskLevel: SecurityRiskLevel;
  decision: SecurityDecision;
  factors: {
    ipScore: number;
    ipLevel: IpRiskLevel;
    newIp: boolean;
    recentIpCount: number;
    rapidIpSwitch: boolean;
    activeDeviceCount: number;
    trustedDeviceCount: number;
    recentFailureCount: number;
    recentOtpFailureCount: number;
    recentLoginFailureCount: number;
    recentFileAccessFailureCount: number;
    recentSecurityFailureCount: number;
    recentInactivityLocks: number;
  };
};

function getRiskLevel(score: number): SecurityRiskLevel {
  if (score >= 85) return "critical";
  if (score >= 65) return "high";
  if (score >= 40) return "medium";
  if (score >= 15) return "low";
  return "normal";
}

function getDecision(level: SecurityRiskLevel): SecurityDecision {
  switch (level) {
    case "critical":
      return "blocked";
    case "high":
      return "reauthentication_required";
    case "medium":
      return "additional_verification";
    case "low":
      return "allow_and_log";
    default:
      return "allow";
  }
}

function failureEvent(
  eventType: unknown,
  action: unknown
): boolean {
  return /fail|failed|blocked|denied|invalid|suspicious|revoked|expired/i.test(
    `${String(eventType ?? "")} ${String(action ?? "")}`
  );
}

export async function evaluateSecurityRisk(
  userId: string,
  request: Request
): Promise<SecurityRiskResult> {
  const supabaseAdmin = getAdminClient();

  const ip = getRequestIp(request);
  const ipRisk: IpRiskResult = await evaluateIpRisk(userId, ip);

  const since = new Date(
    Date.now() - 15 * 60 * 1000
  ).toISOString();

  const [securityLogsResult, fileLogsResult, devicesResult] =
    await Promise.all([
      supabaseAdmin
        .from("security_logs")
        .select("event_type,action,metadata,created_at")
        .eq("user_id", userId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(200),

      supabaseAdmin
        .from("file_access_logs")
        .select("action,access_granted,accessed_at")
        .eq("user_id", userId)
        .gte("accessed_at", since)
        .order("accessed_at", { ascending: false })
        .limit(100),

      supabaseAdmin
        .from("user_devices")
        .select("id,is_active,is_trusted")
        .eq("user_id", userId),
    ]);

  const securityLogs = securityLogsResult.data || [];
  const fileLogs = fileLogsResult.data || [];
  const devices = devicesResult.data || [];

  const recentFailures = securityLogs.filter((log) =>
    failureEvent(log.event_type, log.action)
  );

  const recentOtpFailureCount = securityLogs.filter((log) =>
    /otp/i.test(log.event_type || "") &&
    failureEvent(log.event_type, log.action)
  ).length;

  const recentLoginFailureCount = securityLogs.filter((log) =>
    /login|auth|password/i.test(log.event_type || "") &&
    failureEvent(log.event_type, log.action)
  ).length;

  const recentSecurityFailureCount = securityLogs.filter((log) =>
    /security|suspicious|blocked|denied|revoked/i.test(
      log.event_type || ""
    ) &&
    failureEvent(log.event_type, log.action)
  ).length;

  const recentInactivityLocks = securityLogs.filter((log) =>
    /inactivity_lock/i.test(log.event_type || "")
  ).length;

  const recentFileAccessFailureCount = fileLogs.filter(
    (log) => log.access_granted === false
  ).length;

  const activeDeviceCount = devices.filter(
    (device) => device.is_active
  ).length;

  const trustedDeviceCount = devices.filter(
    (device) => device.is_active && device.is_trusted
  ).length;

  let score = 0;

  /*
   * IP risk is deliberately capped.
   * Mobile networks can legitimately change IP addresses.
   */
  score += Math.min(ipRisk.riskScore, 35);

  score += Math.min(recentOtpFailureCount * 8, 24);
  score += Math.min(recentLoginFailureCount * 7, 21);
  score += Math.min(recentFileAccessFailureCount * 6, 18);
  score += Math.min(recentSecurityFailureCount * 8, 24);

  if (recentInactivityLocks > 0) {
    score += Math.min(recentInactivityLocks * 5, 10);
  }

  /*
   * Having no active device is mildly suspicious,
   * but it is not an automatic block.
   */
  if (activeDeviceCount === 0) {
    score += 10;
  }

  /*
   * A user with active trusted devices receives no penalty.
   * New devices are already registered after successful login OTP.
   */
  if (activeDeviceCount > 0 && trustedDeviceCount === 0) {
    score += 5;
  }

  score = Math.min(score, 100);

  const riskLevel = getRiskLevel(score);
  const decision = getDecision(riskLevel);

  return {
    riskScore: score,
    riskLevel,
    decision,
    factors: {
      ipScore: ipRisk.riskScore,
      ipLevel: ipRisk.riskLevel,
      newIp: ipRisk.isNewIp,
      recentIpCount: ipRisk.recentIpCount,
      rapidIpSwitch: ipRisk.rapidIpSwitch,
      activeDeviceCount,
      trustedDeviceCount,
      recentFailureCount: recentFailures.length,
      recentOtpFailureCount,
      recentLoginFailureCount,
      recentFileAccessFailureCount,
      recentSecurityFailureCount,
      recentInactivityLocks,
    },
  };
}

export async function writeSecurityRiskLog(
  userId: string,
  request: Request,
  result: SecurityRiskResult,
  action = "unified_risk_evaluated"
) {
  const supabaseAdmin = getAdminClient();

  await supabaseAdmin.from("security_logs").insert({
    user_id: userId,
    event_type: "unified_risk_engine",
    ip_address: getRequestIp(request),
    user_agent: request.headers.get("user-agent") || "unknown",
    metadata: {
      action,
      risk_score: result.riskScore,
      risk_level: result.riskLevel,
      decision: result.decision,
      factors: result.factors,
    },
  });
}
