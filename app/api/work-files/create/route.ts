import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSubscription } from "@/lib/server/subscription";
import { isSafeFileName, isValidUUID } from "@/lib/server/validation";
import { handleHoneypot } from "@/lib/server/honeypot";

const categories = [
  "Work Editor",
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

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (await handleHoneypot(request, body)) {
      return NextResponse.json(
        { error: "Invalid request." },
        { status: 400 }
      );
    }

    const { category, fileName, sourceFileId } = body;

    if (!category || !fileName) {
      return NextResponse.json(
        { error: "Category and file name are required." },
        { status: 400 }
      );
    }

    if (!categories.includes(category)) {
      return NextResponse.json(
        { error: "Invalid work file category." },
        { status: 400 }
      );
    }

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

    const { verifyLockerAccess } = await import("@/lib/server/locker-access");

    if (sourceFileId) {
      if (!(await verifyLockerAccess(user.id, "uploaded", category))) {
        return NextResponse.json(
          {
            error: "Uploaded Files Locker is locked.",
            code: "UPLOADED_LOCKER_LOCKED",
          },
          { status: 403 }
        );
      }
    } else {
      if (!(await verifyLockerAccess(user.id, "work", category))) {
        return NextResponse.json(
          {
            error: "Work Files Locker is locked.",
            code: "WORK_LOCKER_LOCKED",
          },
          { status: 403 }
        );
      }
    }

    const cleanName = String(fileName).trim();

    if (!isSafeFileName(cleanName)) {
      return NextResponse.json({ error: "Invalid file name." }, { status: 400 });
    }

    if (!cleanName) {
      return NextResponse.json(
        { error: "Work file name cannot be empty." },
        { status: 400 }
      );
    }

    /*
     * OPTIONAL SOURCE FILE
     *
     * A Work File created from an uploaded file keeps a permanent
     * reference to that original file.
     *
     * Direct New Work File creation has no source file and therefore
     * stores NULL.
     *
     * The source file must belong to the authenticated user.
     */
    let cleanSourceFileId: string | null = null;

    if (sourceFileId !== undefined && sourceFileId !== null && String(sourceFileId).trim()) {
      cleanSourceFileId = String(sourceFileId).trim();
      if (!isValidUUID(cleanSourceFileId)) {
        return NextResponse.json({ error: "Invalid source file ID." }, { status: 400 });
      }

      const { data: sourceFile, error: sourceFileError } = await admin
        .from("user_files")
        .select("id, user_id, category")
        .eq("id", cleanSourceFileId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (sourceFileError) {
        console.error("SOURCE FILE LOOKUP ERROR:", sourceFileError);

        return NextResponse.json(
          { error: "Unable to verify the source file." },
          { status: 500 }
        );
      }

      if (!sourceFile) {
        return NextResponse.json(
          { error: "Source uploaded file was not found." },
          { status: 404 }
        );
      }

      if (sourceFile.category !== category) {
        return NextResponse.json(
          { error: "Source file category does not match the work file category." },
          { status: 400 }
        );
      }
    }

    const { data, error } = await admin
      .from("work_files")
      .insert({
        user_id: user.id,
        category,
        file_name: cleanName,
        content: "",
        status: "Working",
        source_file_id: cleanSourceFileId,
      })
      .select(
        "id, user_id, category, file_name, content, status, source_file_id, created_at, updated_at"
      )
      .single();

    if (error) {
      console.error("WORK FILE CREATE ERROR:", error);

      return NextResponse.json(
        { error: `Work file creation failed: ${error.message}` },
        { status: 500 }
      );
    }

    /*
     * WORK HISTORY
     *
     * Record the initial creation of the work file.
     * The history row is scoped to the authenticated user.
     *
     * History logging is intentionally non-blocking:
     * if the history insert fails, the work file itself
     * has already been created successfully.
     */
    const { error: historyError } = await admin
      .from("work_history")
      .insert({
        user_id: user.id,
        work_file_id: data.id,
        category: data.category,
        file_name: data.file_name,
        status: data.status,
      });

    if (historyError) {
      console.error(
        "WORK HISTORY CREATE LOG ERROR:",
        historyError
      );
    }

    return NextResponse.json({
      success: true,
      workFile: data,
    });
  } catch (error) {
    console.error("CREATE WORK FILE ERROR:", error);

    return NextResponse.json(
      { error: "Unable to create work file." },
      { status: 500 }
    );
  }
}
