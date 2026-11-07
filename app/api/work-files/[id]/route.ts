import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { requireSubscription } from "@/lib/server/subscription";
import { createClient } from "@supabase/supabase-js";
import { isValidUUID, VALIDATION_LIMITS } from "@/lib/server/validation";
import { extractReferenceScope } from "@/lib/server/reference-scope";


async function getAdminAndUser(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return { error: "Server configuration is missing." };
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
    return { error: "Authentication required." };
  }

  const accessToken = authHeader.slice(7);

  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(accessToken);

  if (userError || !user) {
    return { error: "Invalid authentication session." };
  }

  const access = await requireSubscription(user.id);

  if (!access.allowed) {
    return {
      admin,
      user,
      subscriptionError: {
        error: "Subscription required.",
        code: "SUBSCRIPTION_REQUIRED",
        reason: access.reason,
        expires_at: access.expiresAt,
      },
    };
  }

  return { admin, user };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAdminAndUser(request);

    if ("error" in auth) {
      return NextResponse.json(
        { error: auth.error },
        { status: 401 }
      );
    }

    if ("subscriptionError" in auth) {
      return NextResponse.json(auth.subscriptionError, { status: 403 });
    }

    const { id } = await context.params;

    const { verifyLockerAccess } = await import("@/lib/server/locker-access");

    const workFileId = String(id || "").trim();

    if (!isValidUUID(workFileId)) {
      return NextResponse.json({ error: "Invalid work file ID." }, { status: 400 });
    }

    if (!workFileId) {
      return NextResponse.json(
        { error: "Work file ID is required." },
        { status: 400 }
      );
    }

    const { data: workFile, error: workFileError } =
      await auth.admin
        .from("work_files")
        .select(
          "id, user_id, category, file_name, content, status, source_file_id, created_at, updated_at"
        )
        .eq("id", workFileId)
        .eq("user_id", auth.user.id)
        .maybeSingle();

    if (workFileError) {
      console.error("WORK FILE LOOKUP ERROR:", workFileError);

      return NextResponse.json(
        {
          error: `Work file lookup failed: ${workFileError.message}`,
        },
        { status: 500 }
      );
    }

    if (!workFile) {
      return NextResponse.json(
        { error: "Work file not found." },
        { status: 404 }
      );
    }

    // Workboard access after Start Work is authorized by the
    // source/uploaded locker flow. Do not require a second
    // Work Files Locker OTP here.

    let sourceFile = null;

    if (workFile.source_file_id) {
      const { data: source, error: sourceError } =
        await auth.admin
          .from("user_files")
          .select(
            "id, file_name, category, mime_type, storage_path"
          )
          .eq("id", workFile.source_file_id)
          .eq("user_id", auth.user.id)
          .maybeSingle();

      if (sourceError) {
        console.error(
          "WORK FILE SOURCE LOOKUP ERROR:",
          sourceError
        );
      } else if (source) {
        sourceFile = {
          id: source.id,
          file_name: source.file_name,
          category: source.category,
          mime_type: source.mime_type,
          preview_url: null as string | null,
        };

        const { data: signed } =
          await auth.admin.storage
            .from("ultima-files")
            .createSignedUrl(
              source.storage_path,
              10 * 60
            );

        if (signed?.signedUrl) {
          sourceFile.preview_url = signed.signedUrl;
        }
      }
    }

    return NextResponse.json({
      success: true,
      workFile: {
        ...workFile,
        sourceFile,
      },
    });
  } catch (error) {
    console.error("WORK FILE GET ERROR:", error);

    return NextResponse.json(
      { error: "Unable to load work file." },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAdminAndUser(request);

    if ("error" in auth) {
      return NextResponse.json(
        { error: auth.error },
        { status: 401 }
      );
    }

    const { id } = await context.params;

    const { verifyLockerAccess } = await import("@/lib/server/locker-access");

    const body = await request.json();

    const logHistory = body.logHistory !== false;

    const content =
      typeof body.content === "string"
        ? body.content
        : "";

    if (content.length > VALIDATION_LIMITS.workFileContent) {
      return NextResponse.json(
        { error: "Work file content is too large." },
        { status: 413 }
      );
    }

    const allowedStatuses = [
      "Working",
      "Saved",
      "Completed",
    ] as const;

    const status = allowedStatuses.includes(body.status)
      ? body.status
      : "Working";

    /*
     * COMPLETION GATE
     *
     * "Saved" and "Completed" require server-side scope validation.
     *
     * The reference file provides only the runtime work scope.
     * No domain-specific rule, automatic checker, correction engine,
     * or exact source/value comparison is used here.
     *
     * The source and worker grid may use different formats.
     */
    if (status === "Saved" || status === "Completed") {
      const { data: currentWorkFile, error: currentWorkFileError } =
        await auth.admin
          .from("work_files")
          .select("id, source_file_id")
          .eq("id", id)
          .eq("user_id", auth.user.id)
          .maybeSingle();

      if (currentWorkFileError || !currentWorkFile) {
        return NextResponse.json(
          { error: "Work file not found." },
          { status: 404 }
        );
      }

      if (!currentWorkFile.source_file_id) {
        return NextResponse.json(
          {
            error:
              "Completion blocked: this work file has no reference file.",
          },
          { status: 400 }
        );
      }

      const { data: referenceFile, error: referenceFileError } =
        await auth.admin
          .from("user_files")
          .select("id, file_name, mime_type, storage_path")
          .eq("id", currentWorkFile.source_file_id)
          .eq("user_id", auth.user.id)
          .maybeSingle();

      if (referenceFileError || !referenceFile) {
        return NextResponse.json(
          {
            error:
              "Completion blocked: reference file was not found.",
          },
          { status: 404 }
        );
      }

      if (!referenceFile.storage_path) {
        return NextResponse.json(
          {
            error:
              "Completion blocked: reference file storage path is missing.",
          },
          { status: 500 }
        );
      }

      const { data: referenceBlob, error: referenceDownloadError } =
        await auth.admin.storage
          .from("ultima-files")
          .download(referenceFile.storage_path);

      if (referenceDownloadError || !referenceBlob) {
        return NextResponse.json(
          {
            error:
              "Completion blocked: unable to read the reference file.",
          },
          { status: 502 }
        );
      }

      const referenceBuffer = Buffer.from(
        await referenceBlob.arrayBuffer()
      );

      const referenceScope = await extractReferenceScope(
        referenceBuffer,
        referenceFile.file_name,
        referenceFile.mime_type
      );

      if (referenceScope.workUnits <= 0) {
        return NextResponse.json(
          {
            error:
              "Completion blocked: no work units could be detected from the reference file.",
            completion: {
              requiredWorkUnits: 0,
              completedWorkUnits: 0,
              sourceType: referenceScope.sourceType,
            },
          },
          { status: 400 }
        );
      }

      let submittedGrid: unknown = null;

      try {
        const parsed = JSON.parse(content);

        if (
          parsed &&
          (parsed.version === 1 || parsed.version === 2) &&
          Array.isArray(parsed.gridRows)
        ) {
          submittedGrid = parsed.gridRows;
        }
      } catch {
        submittedGrid = null;
      }

      if (!Array.isArray(submittedGrid)) {
        return NextResponse.json(
          {
            error:
              "Completion blocked: the work grid is empty or invalid.",
            completion: {
              requiredWorkUnits: referenceScope.workUnits,
              completedWorkUnits: 0,
              sourceType: referenceScope.sourceType,
            },
          },
          { status: 400 }
        );
      }

      const completedWorkUnits = submittedGrid.filter(
        (row) =>
          Array.isArray(row) &&
          row.some(
            (cell) =>
              String(cell ?? "").trim().length > 0
          )
      ).length;

      if (completedWorkUnits < referenceScope.workUnits) {
        return NextResponse.json(
          {
            error:
              "Completion blocked: the work file is incomplete.",
            completion: {
              requiredWorkUnits: referenceScope.workUnits,
              completedWorkUnits,
              remainingWorkUnits:
                referenceScope.workUnits - completedWorkUnits,
              sourceType: referenceScope.sourceType,
            },
          },
          { status: 400 }
        );
      }
    }

    const { data, error } = await auth.admin
      .from("work_files")
      .update({
        content,
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .select(
        "id, user_id, category, file_name, content, status, source_file_id, created_at, updated_at"
      )
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: `Work file save failed: ${error.message}` },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Work file not found." },
        { status: 404 }
      );
    }

    /*
     * WORK HISTORY
     *
     * Every successful Save / Complete
     * creates a history record for the authenticated user.
     *
     * History logging is intentionally non-blocking:
     * if history logging fails, the actual work-file save
     * still succeeds.
     */
    if (logHistory) {
      const { error: historyError } = await auth.admin
        .from("work_history")
        .insert({
          user_id: auth.user.id,
          work_file_id: data.id,
          category: data.category,
          file_name: data.file_name,
          status: data.status,
        });

      if (historyError) {
        console.error(
          "WORK HISTORY LOG ERROR:",
          historyError
        );
      }
    }

    return NextResponse.json({
      success: true,
      workFile: data,
    });
  } catch (error) {
    console.error("WORK FILE PATCH ERROR:", error);

    return NextResponse.json(
      { error: "Unable to save work file." },
      { status: 500 }
    );
  }
}
