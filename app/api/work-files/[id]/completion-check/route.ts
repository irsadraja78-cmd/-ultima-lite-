import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSubscription } from "@/lib/server/subscription";
import { extractReferenceScope } from "@/lib/server/reference-scope";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL;

    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Server configuration error." },
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

    const authorization =
      request.headers.get("authorization") || "";

    if (!authorization.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      );
    }

    const token = authorization.slice(7).trim();

    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(token);

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

    const { id } = await context.params;

    if (!id) {
      return NextResponse.json(
        { error: "Work file ID is required." },
        { status: 400 }
      );
    }

    const { data: workFile, error: workFileError } =
      await admin
        .from("work_files")
        .select(
          "id, category, source_file_id"
        )
        .eq("id", id)
        .eq("user_id", user.id)
        .maybeSingle();

    if (workFileError || !workFile) {
      return NextResponse.json(
        { error: "Work file not found." },
        { status: 404 }
      );
    }

    if (!workFile.source_file_id) {
      return NextResponse.json(
        {
          error:
            "This work file has no reference file.",
        },
        { status: 400 }
      );
    }

    const { data: sourceFile, error: sourceError } =
      await admin
        .from("user_files")
        .select(
          "id, file_name, mime_type, storage_path"
        )
        .eq("id", workFile.source_file_id)
        .eq("user_id", user.id)
        .maybeSingle();

    if (sourceError || !sourceFile) {
      return NextResponse.json(
        { error: "Reference file not found." },
        { status: 404 }
      );
    }

    if (!sourceFile.storage_path) {
      return NextResponse.json(
        {
          error:
            "Reference file storage path is missing.",
        },
        { status: 500 }
      );
    }

    const { data: fileData, error: downloadError } =
      await admin.storage
        .from("ultima-files")
        .download(sourceFile.storage_path);

    if (downloadError || !fileData) {
      return NextResponse.json(
        {
          error:
            "Unable to read the reference file.",
        },
        { status: 502 }
      );
    }

    const buffer = Buffer.from(
      await fileData.arrayBuffer()
    );

    const scope =
      await extractReferenceScope(
        buffer,
        sourceFile.file_name,
        sourceFile.mime_type
      );

    return NextResponse.json({
      success: true,
      workFileId: workFile.id,
      sourceFile: {
        id: sourceFile.id,
        file_name: sourceFile.file_name,
        mime_type: sourceFile.mime_type,
      },
      scope: {
        sourceType: scope.sourceType,
        workUnits: scope.workUnits,
        detectedColumns:
          scope.detectedColumns,
        confidence: scope.confidence,
      },
    });
  } catch (error) {
    console.error(
      "Completion scope extraction error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Unable to analyze the reference file.",
      },
      { status: 500 }
    );
  }
}
