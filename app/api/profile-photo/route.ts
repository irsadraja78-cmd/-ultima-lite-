import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) throw new Error("Missing Supabase configuration");

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function getUser(request: Request) {
  const header = request.headers.get("authorization");

  if (!header?.startsWith("Bearer ")) return null;

  const token = header.slice(7).trim();
  if (!token) return null;

  const admin = getAdmin();

  const {
    data: { user },
    error,
  } = await admin.auth.getUser(token);

  if (error || !user) return null;

  return { admin, user };
}

export async function GET(request: Request) {
  try {
    const auth = await getUser(request);

    if (!auth) {
      return NextResponse.json(
        { success: false, error: "Authentication required." },
        { status: 401 },
      );
    }

    const { admin, user } = auth;

    const { data, error } = await admin
      .from("user_profiles")
      .select("current_photo_path")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { success: false, error: "Unable to load profile photo." },
        { status: 500 },
      );
    }

    if (!data?.current_photo_path) {
      return NextResponse.json({
        success: true,
        photo_url: null,
      });
    }

    const { data: signed, error: signedError } = await admin.storage
      .from("profile-photos")
      .createSignedUrl(data.current_photo_path, 300);

    if (signedError) {
      return NextResponse.json({
        success: true,
        photo_url: null,
      });
    }

    return NextResponse.json({
      success: true,
      photo_url: signed.signedUrl,
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "Unable to load profile photo." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await getUser(request);

    if (!auth) {
      return NextResponse.json(
        { success: false, error: "Authentication required." },
        { status: 401 },
      );
    }

    const { admin, user } = auth;
    const formData = await request.formData();
    const file = formData.get("photo");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "Profile photo is required." },
        { status: 400 },
      );
    }

    const allowedTypes = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);

    if (!allowedTypes.has(file.type)) {
      return NextResponse.json(
        { success: false, error: "Use JPG, PNG or WebP image." },
        { status: 400 },
      );
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: "Profile photo must be 5 MB or smaller." },
        { status: 400 },
      );
    }

    const extension =
      file.type === "image/png"
        ? "png"
        : file.type === "image/webp"
          ? "webp"
          : "jpg";

    const path = `${user.id}/current-profile-photo.${extension}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { data: oldProfile } = await admin
      .from("user_profiles")
      .select("current_photo_path")
      .eq("user_id", user.id)
      .maybeSingle();

    const { error: uploadError } = await admin.storage
      .from("profile-photos")
      .upload(path, buffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      console.error("PROFILE PHOTO UPLOAD ERROR:", uploadError);

      return NextResponse.json(
        { success: false, error: "Unable to upload profile photo." },
        { status: 500 },
      );
    }

    const { error: profileError } = await admin
      .from("user_profiles")
      .upsert(
        {
          user_id: user.id,
          current_photo_path: path,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

    if (profileError) {
      await admin.storage.from("profile-photos").remove([path]);

      return NextResponse.json(
        { success: false, error: "Unable to save profile photo." },
        { status: 500 },
      );
    }

    if (oldProfile?.current_photo_path && oldProfile.current_photo_path !== path) {
      await admin.storage
        .from("profile-photos")
        .remove([oldProfile.current_photo_path]);
    }

    return NextResponse.json({
      success: true,
      message: "Current profile photo saved.",
    });
  } catch (error) {
    console.error("PROFILE PHOTO ERROR:", error);

    return NextResponse.json(
      { success: false, error: "Unable to save profile photo." },
      { status: 500 },
    );
  }
}
