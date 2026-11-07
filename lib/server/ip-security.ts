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

export type IpRiskLevel =
  | "normal"
  | "low"
  | "medium"
  | "high"
  | "critical";

export type IpRiskResult = {
  ip: string;
  riskScore: number;
  riskLevel: IpRiskLevel;
  isNewIp: boolean;
  recentIpCount: number;
  rapidIpSwitch: boolean;
};

function normalizeIp(ip: string): string {
  const value = ip.trim();

  if (value.includes(",")) {
    return value.split(",")[0].trim();
  }

  return value;
}

export function getRequestIp(request: Request): string {
  return normalizeIp(
    request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      "unknown"
  );
}

function getRiskLevel(score: number): IpRiskLevel {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  if (score >= 15) return "low";
  return "normal";
}

export async function evaluateIpRisk(
  userId: string,
  ip: string
): Promise<IpRiskResult> {
  const normalizedIp = normalizeIp(ip);
  const supabaseAdmin = getAdminClient();

  if (!userId || normalizedIp === "unknown") {
    return {
      ip: normalizedIp,
      riskScore: 0,
      riskLevel: "normal",
      isNewIp: false,
      recentIpCount: 0,
      rapidIpSwitch: false,
    };
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: logs } = await supabaseAdmin
    .from("security_logs")
    .select("ip_address,created_at,event_type")
    .eq("user_id", userId)
    .gte("created_at", since)
    .not("ip_address", "is", null)
    .order("created_at", { ascending: false })
    .limit(100);

  const recentLogs = logs || [];

  const recentIps = Array.from(
    new Set(
      recentLogs
        .map((log) => log.ip_address)
        .filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0
        )
    )
  );

  const isNewIp = !recentIps.includes(normalizedIp);

  const recentSwitchIps = Array.from(
    new Set(
      recentLogs
        .filter(
          (log) =>
            typeof log.created_at === "string" &&
            Date.now() - new Date(log.created_at).getTime() <=
              15 * 60 * 1000
        )
        .map((log) => log.ip_address)
        .filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0
        )
    )
  );

  const rapidIpSwitch =
    recentSwitchIps.length >= 2 &&
    recentSwitchIps.includes(normalizedIp);

  let riskScore = 0;

  if (isNewIp) {
    riskScore += 15;
  }

  if (recentIps.length >= 3) {
    riskScore += 15;
  }

  if (recentIps.length >= 5) {
    riskScore += 15;
  }

  if (rapidIpSwitch) {
    riskScore += 30;
  }

  const recentSecurityEvents = recentLogs.filter(
    (log) =>
      typeof log.created_at === "string" &&
      Date.now() - new Date(log.created_at).getTime() <=
        15 * 60 * 1000
  );

  const recentFailures = recentSecurityEvents.filter((log) =>
    /fail|blocked|denied|suspicious|invalid|revoked/i.test(
      log.event_type || ""
    )
  ).length;

  riskScore += Math.min(recentFailures * 10, 30);

  riskScore = Math.min(riskScore, 100);

  return {
    ip: normalizedIp,
    riskScore,
    riskLevel: getRiskLevel(riskScore),
    isNewIp,
    recentIpCount: recentIps.length,
    rapidIpSwitch,
  };
}

export async function writeIpRiskLog(
  userId: string,
  request: Request,
  result: IpRiskResult,
  action = "ip_risk_evaluated"
) {
  const supabaseAdmin = getAdminClient();

  await supabaseAdmin.from("security_logs").insert({
    user_id: userId,
    event_type: "ip_security",
    ip_address: result.ip,
    user_agent: request.headers.get("user-agent") || "unknown",
    metadata: {
      action,
      risk_score: result.riskScore,
      risk_level: result.riskLevel,
      is_new_ip: result.isNewIp,
      recent_ip_count: result.recentIpCount,
      rapid_ip_switch: result.rapidIpSwitch,
    },
  });
}
