import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  evaluateIpRisk,
  getRequestIp,
  writeIpRiskLog,
} from "@/lib/server/ip-security";

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

export async function GET(request: NextRequest) {
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
      error,
    } = await supabaseAdmin.auth.getUser(accessToken);

    if (error || !user) {
      return NextResponse.json(
        { success: false, error: "Invalid session" },
        { status: 401 }
      );
    }

    const ip = getRequestIp(request);
    const result = await evaluateIpRisk(user.id, ip);

    await writeIpRiskLog(
      user.id,
      request,
      result,
      "ip_security_check"
    );

    return NextResponse.json({
      success: true,
      ip: result.ip,
      risk: {
        score: result.riskScore,
        level: result.riskLevel,
      },
      indicators: {
        newIp: result.isNewIp,
        recentIpCount: result.recentIpCount,
        rapidIpSwitch: result.rapidIpSwitch,
      },
    });
  } catch (error) {
    console.error("IP_SECURITY_CHECK_ERROR", error);

    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
