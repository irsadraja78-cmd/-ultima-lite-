import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/server/rbac-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await requireRole(request, ["Super Admin", "Admin"]);
    if (auth.response) return auth.response;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      return NextResponse.json(
        { success: false, error: "Server database configuration missing" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const db = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [files, workFiles, security, users] = await Promise.all([
      db.from("user_files").select("id", { count: "exact", head: true }),
      db.from("work_files").select("id", { count: "exact", head: true }),
      db.from("security_logs").select("id", { count: "exact", head: true }),
      db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);

    const errors = [
      files.error ? "user_files" : null,
      workFiles.error ? "work_files" : null,
      security.error ? "security_logs" : null,
      users.error ? "auth.users" : null,
    ].filter(Boolean);

    return NextResponse.json(
      {
        success: true,
        role: auth.role,
        generatedAt: new Date().toISOString(),
        stats: {
          users: users.error ? null : users.data.users.length,
          usersNote:
            !users.error && users.data.users.length === 1000
              ? "पहले 1000 खाते; कुल संख्या इससे अधिक हो सकती है"
              : null,
          userFiles: files.error ? null : files.count,
          workFiles: workFiles.error ? null : workFiles.count,
          securityEvents: security.error ? null : security.count,
        },
        unavailable: errors,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error) {
    console.error("Admin overview error:", error);
    return NextResponse.json(
      { success: false, error: "Admin overview load failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
