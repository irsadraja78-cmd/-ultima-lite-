import { handleHoneypot } from "@/lib/server/honeypot";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isValidUUID, isValidOTP } from "@/lib/server/validation";
import {
  evaluateSecurityRisk,
  writeSecurityRiskLog,
} from "@/lib/server/risk-engine";

const MAX_ATTEMPTS = 5;

async function writeDeleteLog(
  admin: SupabaseClient,
  payload: {
    user_id: string;
    file_id: string;
    action: string;
    success: boolean;
    metadata?: Record<string, unknown>;
  }
) {
  const { error } = await admin
    .from("file_access_logs")
    .insert(payload);

  if (error) {
    console.error("DELETE AUDIT LOG ERROR:", error);
  }
}

export async function POST(request: Request) {
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

    const authHeader =
      request.headers.get("authorization");

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

    if (userError || !user || !user.email) {
      return NextResponse.json(
        { error: "Invalid authentication session." },
        { status: 401 }
      );
    }

    const body = await request.json();



    if (await handleHoneypot(request, body)) {

      return NextResponse.json(

        { error: "Invalid request." },

        { status: 400 }

      );

    }
    const fileId = String(body?.fileId || "");
    const resourceType =
      body?.resourceType === "work_file"
        ? "work_file"
        : "user_file";
    const otp = String(body?.otp || "").trim();

    if (!isValidUUID(fileId)) {
      return NextResponse.json({ error: "Invalid file ID." }, { status: 400 });
    }

    if (!fileId) {
      return NextResponse.json(
        { error: "File ID is required." },
        { status: 400 }
      );
    }

    if (!isValidOTP(otp)) {
      return NextResponse.json(
        { error: "A valid 6-digit Delete OTP is required." },
        { status: 400 }
      );
    }

    const risk = await evaluateSecurityRisk(
      user.id,
      request
    );

    await writeSecurityRiskLog(
      user.id,
      request,
      risk,
      "file_delete_otp_verify"
    );

    if (
      risk.decision === "blocked" ||
      risk.riskLevel === "critical"
    ) {
      await writeDeleteLog(admin, {
        user_id: user.id,
        file_id: fileId,
        action: "delete_risk_blocked",
        success: false,
        metadata: {
          resource_type: resourceType,
          risk_score: risk.riskScore,
          risk_level: risk.riskLevel,
          decision: risk.decision,
        },
      });

      return NextResponse.json(
        {
          error:
            "File deletion has been blocked by the security system.",
        },
        { status: 403 }
      );
    }

    if (
      risk.decision === "reauthentication_required" ||
      risk.riskLevel === "high"
    ) {
      return NextResponse.json(
        {
          error:
            "Additional security verification is required before deletion.",
        },
        { status: 403 }
      );
    }

    const { data: challenge, error: challengeError } =
      await admin
        .from("file_access_otps")
        .select(
          "id, user_id, file_id, email, otp, expires_at, verified, attempts"
        )
        .eq("user_id", user.id)
        .eq("file_id", fileId)
        .eq("purpose", "delete")
        .eq("verified", false)
        .order("created_at", {
          ascending: false,
        })
        .limit(1)
        .maybeSingle();

    if (challengeError) {
      console.error(
        "DELETE OTP LOOKUP ERROR:",
        challengeError
      );

      return NextResponse.json(
        { error: "Unable to verify Delete OTP." },
        { status: 500 }
      );
    }

    if (!challenge) {
      await writeDeleteLog(admin, {
        user_id: user.id,
        file_id: fileId,
        action: "delete_otp_verify",
        success: false,
        metadata: {
          resource_type: resourceType,
          reason: "otp_not_found",
        },
      });

      return NextResponse.json(
        { error: "Delete OTP is invalid or expired." },
        { status: 400 }
      );
    }

    if (challenge.email !== user.email) {
      return NextResponse.json(
        { error: "Delete OTP is invalid." },
        { status: 400 }
      );
    }

    const attempts = Number(
      challenge.attempts || 0
    );

    if (attempts >= MAX_ATTEMPTS) {
      return NextResponse.json(
        {
          error:
            "Maximum Delete OTP attempts exceeded. Please request a new OTP.",
        },
        { status: 429 }
      );
    }

    const expired =
      new Date(challenge.expires_at).getTime() <=
      Date.now();

    if (expired) {
      await admin
        .from("file_access_otps")
        .update({ verified: true })
        .eq("id", challenge.id)
        .eq("verified", false);

      return NextResponse.json(
        { error: "Delete OTP has expired. Please request a new OTP." },
        { status: 400 }
      );
    }

    if (challenge.otp !== otp) {
      const { error: rpcError } = await admin.rpc(
        "increment_file_access_otp_attempt",
        {
          p_id: challenge.id,
          p_max_attempts: MAX_ATTEMPTS,
        }
      );

      if (rpcError) {
        console.error(
          "DELETE OTP ATTEMPT RPC ERROR:",
          rpcError
        );
      }

      await writeDeleteLog(admin, {
        user_id: user.id,
        file_id: fileId,
        action: "delete_otp_verify",
        success: false,
        metadata: {
          resource_type: resourceType,
          reason: "invalid_otp",
          attempt_number: attempts + 1,
        },
      });

      return NextResponse.json(
        { error: "Invalid Delete OTP." },
        { status: 400 }
      );
    }

    /*
     * Consume the OTP BEFORE the irreversible delete operation.
     * This prevents replay if deletion succeeds but a second request
     * arrives immediately afterward.
     */
    const { data: consumed, error: consumeError } =
      await admin
        .from("file_access_otps")
        .update({ verified: true })
        .eq("id", challenge.id)
        .eq("verified", false)
        .select("id")
        .maybeSingle();

    if (consumeError || !consumed) {
      await writeDeleteLog(admin, {
        user_id: user.id,
        file_id: fileId,
        action: "delete_otp_consume_failed",
        success: false,
        metadata: {
          resource_type: resourceType,
        },
      });

      return NextResponse.json(
        { error: "Delete verification could not be completed." },
        { status: 409 }
      );
    }

    if (resourceType === "work_file") {
      const { data: workFile, error: workFileError } =
        await admin
          .from("work_files")
          .select("id, file_name")
          .eq("id", fileId)
          .eq("user_id", user.id)
          .maybeSingle();

      if (workFileError) {
        await writeDeleteLog(admin, {
          user_id: user.id,
          file_id: fileId,
          action: "delete_failed",
          success: false,
          metadata: {
            resource_type: resourceType,
            reason: "work_file_lookup_failed",
          },
        });

        return NextResponse.json(
          { error: "Unable to locate Work File." },
          { status: 500 }
        );
      }

      if (!workFile) {
        return NextResponse.json(
          { error: "Work File not found." },
          { status: 404 }
        );
      }

      const { error: deleteError } = await admin
        .from("work_files")
        .delete()
        .eq("id", fileId)
        .eq("user_id", user.id);

      if (deleteError) {
        console.error(
          "WORK FILE DELETE ERROR:",
          deleteError
        );

        await writeDeleteLog(admin, {
          user_id: user.id,
          file_id: fileId,
          action: "delete_failed",
          success: false,
          metadata: {
            resource_type: resourceType,
            reason: "database_delete_failed",
            error: deleteError.message,
          },
        });

        return NextResponse.json(
          { error: "Unable to delete Work File." },
          { status: 500 }
        );
      }

      await writeDeleteLog(admin, {
        user_id: user.id,
        file_id: fileId,
        action: "delete_success",
        success: true,
        metadata: {
          resource_type: resourceType,
          file_name: workFile.file_name,
        },
      });

      return NextResponse.json({
        success: true,
        message: "Work File deleted successfully.",
      });
    }

    const { data: file, error: fileError } =
      await admin
        .from("user_files")
        .select(
          "id, file_name, storage_path"
        )
        .eq("id", fileId)
        .eq("user_id", user.id)
        .maybeSingle();

    if (fileError) {
      await writeDeleteLog(admin, {
        user_id: user.id,
        file_id: fileId,
        action: "delete_failed",
        success: false,
        metadata: {
          resource_type: resourceType,
          reason: "file_lookup_failed",
        },
      });

      return NextResponse.json(
        { error: "Unable to locate uploaded file." },
        { status: 500 }
      );
    }

    if (!file) {
      return NextResponse.json(
        { error: "Uploaded file not found." },
        { status: 404 }
      );
    }

    const { error: deleteDbError } =
      await admin
        .from("user_files")
        .delete()
        .eq("id", fileId)
        .eq("user_id", user.id);

    if (deleteDbError) {
      console.error(
        "USER FILE DB DELETE ERROR:",
        deleteDbError
      );

      await writeDeleteLog(admin, {
        user_id: user.id,
        file_id: fileId,
        action: "delete_failed",
        success: false,
        metadata: {
          resource_type: resourceType,
          reason: "database_delete_failed",
          error: deleteDbError.message,
        },
      });

      return NextResponse.json(
        { error: "Unable to delete uploaded file." },
        { status: 500 }
      );
    }

    if (file.storage_path) {
      const { error: storageError } =
        await admin.storage
          .from("ultima-files")
          .remove([file.storage_path]);

      if (storageError) {
        console.error(
          "STORAGE DELETE ERROR:",
          storageError
        );

        await writeDeleteLog(admin, {
          user_id: user.id,
          file_id: fileId,
          action: "delete_storage_cleanup_failed",
          success: false,
          metadata: {
            resource_type: resourceType,
            storage_path: file.storage_path,
            error: storageError.message,
          },
        });

        return NextResponse.json({
          success: true,
          message:
            "Uploaded file record deleted. Storage cleanup is pending.",
          cleanup_pending: true,
        });
      }
    }

    await writeDeleteLog(admin, {
      user_id: user.id,
      file_id: fileId,
      action: "delete_success",
      success: true,
      metadata: {
        resource_type: resourceType,
        file_name: file.file_name,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Uploaded file deleted successfully.",
    });
  } catch (error) {
    console.error(
      "DELETE OTP VERIFY ERROR:",
      error
    );

    return NextResponse.json(
      { error: "Unable to complete file deletion." },
      { status: 500 }
    );
  }
}
