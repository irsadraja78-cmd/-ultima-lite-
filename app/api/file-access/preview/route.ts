import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isValidUUID } from "@/lib/server/validation";
import { verifyLockerAccess } from "@/lib/server/locker-access";

export async function GET(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: "Server configuration is missing." }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(authHeader.slice(7));

    if (userError || !user) {
      return NextResponse.json({ error: "Invalid authentication session." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const fileId = String(searchParams.get("fileId") || "").trim();

    if (!isValidUUID(fileId)) {
      return NextResponse.json({ error: "Invalid file ID." }, { status: 400 });
    }

    const { data: file, error: fileError } = await admin
      .from("user_files")
      .select("id, file_name, mime_type, storage_path, category")
      .eq("id", fileId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (fileError) {
      return NextResponse.json({ error: "Unable to verify file ownership." }, { status: 500 });
    }

    if (!file) {
      return NextResponse.json({ error: "File not found." }, { status: 404 });
    }

    if (!(await verifyLockerAccess(
      user.id,
      "uploaded",
      file.category,
    ))) {
      return NextResponse.json(
        {
          error: "Uploaded Files Locker is locked.",
          code: "UPLOADED_LOCKER_LOCKED",
        },
        { status: 403 }
      );
    }

    const { data: signed, error: signedError } = await admin.storage
      .from("ultima-files")
      .createSignedUrl(file.storage_path, 60);

    if (signedError || !signed?.signedUrl) {
      return NextResponse.json({ error: "Unable to create file preview." }, { status: 500 });
    }

    const upstream = await fetch(signed.signedUrl);

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: "Unable to load file preview." }, { status: 502 });
    }

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": file.mime_type || "application/octet-stream",
        "Content-Disposition": `inline; filename="${encodeURIComponent(file.file_name)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("FILE PREVIEW ERROR:", error);
    return NextResponse.json({ error: "Unable to preview file." }, { status: 500 });
  }
}
