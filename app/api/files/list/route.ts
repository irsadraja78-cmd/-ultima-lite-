import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSubscription } from "@/lib/server/subscription";

const categories = [
  "Basic Data Entry",
  "Excel Data Entry",
  "Copy & Paste",
  "Web Research",
  "PDF Data Entry",
  "Image Data Entry",
  "Document Processing",
  "Medical Data Entry",
  "Product Data Entry",
  "Data Cleaning",
  "Data Conversion",
  "AI Assisted Data Entry",
];

export async function GET(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Server configuration is missing." },
        { status: 500 }
      );
    }

    const admin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

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

    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") || "";

    if (!categories.includes(category)) {
      return NextResponse.json(
        { error: "Invalid file category." },
        { status: 400 }
      );
    }

    const { data, error } = await admin
      .from("user_files")
      .select(
        "id, file_name, category, storage_path, mime_type, file_size, status, updated_at"
      )
      .eq("user_id", user.id)
      .eq("category", category)
      .order("updated_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: `File lookup failed: ${error.message}` },
        { status: 500 }
      );
    }

    const userFiles = (data || []).map((file) => ({
      id: file.id,
      file_name: file.file_name,
      category: file.category,
      file_size: file.file_size,
      mime_type: file.mime_type,
      status: file.status,
      updated_at: file.updated_at,
      preview_url: null,
      source: "user_file" as const,
    }));

    const { data: workFiles, error: workFilesError } = await admin
      .from("work_files")
      .select(
        "id, file_name, category, status, created_at, updated_at"
      )
      .eq("user_id", user.id)
      .eq("category", category)
      .order("updated_at", { ascending: false });

    if (workFilesError) {
      console.error(
        "WORK FILE LIST ERROR:",
        workFilesError
      );

      return NextResponse.json(
        { error: `Work file lookup failed: ${workFilesError.message}` },
        { status: 500 }
      );
    }

    const editorFiles = (workFiles || []).map((file) => ({
      id: file.id,
      file_name: file.file_name,
      category: file.category,
      file_size: null,
      mime_type: null,
      status: file.status,
      updated_at: file.updated_at,
      preview_url: null,
      source: "work_file" as const,
    }));

    const files = [...userFiles, ...editorFiles].sort(
      (a, b) =>
        new Date(b.updated_at).getTime() -
        new Date(a.updated_at).getTime()
    );

    return NextResponse.json({
      success: true,
      files,
      uploadedFiles: userFiles,
      workFiles: editorFiles,
    });
  } catch (error) {
    console.error("FILE LIST ERROR:", error);

    return NextResponse.json(
      { error: "Unable to load files." },
      { status: 500 }
    );
  }
}
