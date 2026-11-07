import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSubscription } from "@/lib/server/subscription";

import { handleHoneypot } from "@/lib/server/honeypot";
import { verifyLockerAccess } from "@/lib/server/locker-access";
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

    const formData = await request.formData();

    if (await handleHoneypot(request, Object.fromEntries(formData.entries()))) {
      return NextResponse.json(
        { error: "Invalid request." },
        { status: 400 }
      );
    }
    const file = formData.get("file");
    const category = String(formData.get("category") || "");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "File is required." },
        { status: 400 }
      );
    }

    if (!categories.includes(category)) {
      return NextResponse.json(
        { error: "Invalid file category." },
        { status: 400 }
      );
    }

    if (!(await verifyLockerAccess(
      user.id,
      "uploaded",
      category as Parameters<typeof verifyLockerAccess>[2],
    ))) {
      return NextResponse.json(
        {
          error: "Uploaded Files Locker is locked.",
          code: "UPLOADED_LOCKER_LOCKED",
        },
        { status: 403 },
      );
    }

    if (file.size <= 0) {
      return NextResponse.json(
        { error: "The selected file is empty." },
        { status: 400 }
      );
    }

    const maxSize = 25 * 1024 * 1024;

    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "Maximum file size is 25 MB." },
        { status: 400 }
      );
    }

    const safeName = file.name
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 180);

    const fileId = crypto.randomUUID();

    const storagePath =
      `${user.id}/${category}/${fileId}-${safeName}`;

    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await admin.storage
      .from("ultima-files")
      .upload(storagePath, buffer, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: `File upload failed: ${uploadError.message}` },
        { status: 500 }
      );
    }

    const { data: fileRecord, error: dbError } = await admin
      .from("user_files")
      .insert({
        id: fileId,
        user_id: user.id,
        category,
        file_name: file.name,
        storage_path: storagePath,
        mime_type: file.type || "application/octet-stream",
        file_size: file.size,
        status: "Working",
      })
      .select()
      .single();

    if (dbError) {
      await admin.storage
        .from("ultima-files")
        .remove([storagePath]);

      return NextResponse.json(
        { error: `File record failed: ${dbError.message}` },
        { status: 500 }
      );
    }

    await admin
      .from("file_access_logs")
      .insert({
        user_id: user.id,
        file_id: fileId,
        action: "upload",
        success: true,
      });

    return NextResponse.json({
      success: true,
      file: fileRecord,
    });
  } catch (error) {
    console.error("FILE UPLOAD ERROR:", error);

    return NextResponse.json(
      { error: "Unable to upload file." },
      { status: 500 }
    );
  }
}
