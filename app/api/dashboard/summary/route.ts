import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSubscription } from "@/lib/server/subscription";

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
    const admin = getAdminClient();

    const authHeader = request.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      );
    }

    const accessToken = authHeader.slice(7);

    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(accessToken);

    if (userError || !user) {
      return NextResponse.json(
        { error: "Invalid authentication session." },
        { status: 401 }
      );
    }

    const access = await requireSubscription(user.id);

    if (!access.allowed) {
      return NextResponse.json(
        {
          error: "Subscription required.",
          code: "SUBSCRIPTION_REQUIRED",
          reason: access.reason,
          expires_at: access.expiresAt,
        },
        { status: 403 }
      );
    }

    const [userFilesResult, workFilesResult, historyResult] =
      await Promise.all([
        admin
          .from("user_files")
          .select(
            "id, file_name, category, status, file_size, mime_type, updated_at"
          )
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false }),

        admin
          .from("work_files")
          .select(
            "id, file_name, category, status, updated_at"
          )
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false }),

        admin
          .from("work_history")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);

    if (userFilesResult.error) {
      console.error("DASHBOARD USER FILES ERROR:", userFilesResult.error);

      return NextResponse.json(
        { error: "Unable to load dashboard files." },
        { status: 500 }
      );
    }

    if (workFilesResult.error) {
      console.error("DASHBOARD WORK FILES ERROR:", workFilesResult.error);

      return NextResponse.json(
        { error: "Unable to load dashboard work files." },
        { status: 500 }
      );
    }

    if (historyResult.error) {
      console.error("DASHBOARD HISTORY ERROR:", historyResult.error);

      return NextResponse.json(
        { error: "Unable to load dashboard history." },
        { status: 500 }
      );
    }

    const userFiles = userFilesResult.data || [];
    const workFiles = workFilesResult.data || [];
    const history = historyResult.data || [];

    const files = [
      ...userFiles.map((file) => ({
        ...file,
        source: "user_file" as const,
      })),
      ...workFiles.map((file) => ({
        ...file,
        file_size: null,
        mime_type: null,
        source: "work_file" as const,
      })),
    ].sort(
      (a, b) =>
        new Date(b.updated_at).getTime() -
        new Date(a.updated_at).getTime()
    );

    const normalizeStatus = (value: unknown) =>
      String(value ?? "").trim().toLowerCase();

    const activeFiles = files.filter((file) =>
      ["active", "in_progress", "working", "pending"].includes(
        normalizeStatus(file.status)
      )
    ).length;

    const completedFiles = files.filter((file) =>
      ["completed", "complete", "done"].includes(
        normalizeStatus(file.status)
      )
    ).length;

    const savedFiles = files.filter((file) =>
      ["saved", "draft"].includes(normalizeStatus(file.status))
    ).length;

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email || "",
      },
      stats: {
        active: activeFiles,
        completed: completedFiles,
        saved: savedFiles,
        total: files.length,
      },
      recentFiles: files.slice(0, 8),
      recentHistory: history,
    });
  } catch (error) {
    console.error("DASHBOARD SUMMARY ERROR:", error);

    return NextResponse.json(
      { error: "Unable to load dashboard summary." },
      { status: 500 }
    );
  }
}
