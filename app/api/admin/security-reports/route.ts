import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/server/rbac-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireRole(request, ["Super Admin", "Admin"]);
  if (auth.response) return auth.response;

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      return NextResponse.json(
        { success: false, error: "Server database configuration missing." },
        { status: 500 }
      );
    }

    const db = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const params = new URL(request.url).searchParams;
    const limit = Math.min(100, Math.max(10, Number(params.get("limit")) || 50));

    const [total, failures, otpFailures, traps, risks, recent] =
      await Promise.all([
        db.from("security_logs").select("id", { count: "exact", head: true }),
        db.from("security_logs").select("id", { count: "exact", head: true })
          .eq("success", false),
        db.from("security_logs").select("id", { count: "exact", head: true })
          .eq("event_type", "otp").eq("success", false),
        db.from("security_logs").select("id", { count: "exact", head: true })
          .ilike("event_type", "%honey_trap%"),
        db.from("security_logs").select("id", { count: "exact", head: true })
          .eq("event_type", "unified_risk_engine"),
        db.from("security_logs")
          .select("created_at,event_type,action,success,metadata")
          .order("created_at", { ascending: false })
          .limit(limit),
      ]);

    const queryError = total.error || failures.error || otpFailures.error ||
      traps.error || risks.error || recent.error;

    if (queryError) {
      console.error("ADMIN SECURITY REPORT QUERY ERROR:", queryError.message);
      return NextResponse.json(
        { success: false, error: "Could not read security logs." },
        { status: 500 }
      );
    }

    const events = (recent.data || []).map((row) => {
      const metadata =
        row.metadata && typeof row.metadata === "object" &&
        !Array.isArray(row.metadata)
          ? row.metadata as Record<string, unknown>
          : {};

      return {
        createdAt: row.created_at,
        eventType: row.event_type,
        action: row.action || metadata.action || "—",
        success: row.success,
        riskLevel: metadata.risk_level ?? null,
        decision: metadata.decision ?? null,
        riskScore: metadata.risk_score ?? null,
      };
    });

    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      stats: {
        total: total.count ?? 0,
        failures: failures.count ?? 0,
        otpFailures: otpFailures.count ?? 0,
        honeypotEvents: traps.count ?? 0,
        riskEvaluations: risks.count ?? 0,
      },
      events,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("ADMIN SECURITY REPORT ERROR:", error);
    return NextResponse.json(
      { success: false, error: "Unable to load security reports." },
      { status: 500 }
    );
  }
}
