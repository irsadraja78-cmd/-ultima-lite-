import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  evaluateSecurityRisk,
  writeSecurityRiskLog,
} from "@/lib/server/risk-engine";

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

export async function GET(request: Request) {
  try {
    const supabaseAdmin = getAdminClient();

    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const accessToken = authorization.slice("Bearer ".length).trim();

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(accessToken);

    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: "Invalid session" },
        { status: 401 }
      );
    }

    const risk = await evaluateSecurityRisk(user.id, request);

    await writeSecurityRiskLog(
      user.id,
      request,
      risk,
      "risk_check_requested"
    );

    return NextResponse.json({
      success: true,
      risk: {
        score: risk.riskScore,
        level: risk.riskLevel,
        decision: risk.decision,
      },
      factors: risk.factors,
    });
  } catch (error) {
    console.error("Unified risk check error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Unable to evaluate security risk",
      },
      { status: 500 }
    );
  }
}
