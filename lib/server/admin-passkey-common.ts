import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireRole } from "./rbac-auth";

export const PASSKEY_TTL_SECONDS = 120;

export function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase server environment variables");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function adminUser(request: Request) {
  const result = await requireRole(request, ["Super Admin", "Admin"]);
  if (result.response) return { user: null, response: result.response };
  return { user: result.user, response: null };
}

export function requestOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  try {
    const parsed = new URL(origin);
    const requestUrl = new URL(request.url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" &&
        parsed.hostname !== "127.0.0.1") return null;
    if (parsed.host !== requestUrl.host &&
        request.headers.get("x-forwarded-host") !== parsed.host) return null;
    return { origin: parsed.origin, rpID: parsed.hostname };
  } catch {
    return null;
  }
}

export async function getChallenge(
  userId: string,
  purpose: "register" | "login",
) {
  const db = adminDb();
  const { data, error } = await db.from("admin_passkey_challenges")
    .select("id,challenge")
    .eq("user_id", userId)
    .eq("purpose", purpose)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function storeChallenge(
  userId: string,
  purpose: "register" | "login",
  challenge: string,
) {
  const db = adminDb();
  const { error: deleteError } = await db.from("admin_passkey_challenges")
    .delete().eq("user_id", userId).eq("purpose", purpose);

  if (deleteError) throw deleteError;

  const expiresAt = new Date(Date.now() + PASSKEY_TTL_SECONDS * 1000).toISOString();
  const { error } = await db.from("admin_passkey_challenges")
    .insert({ user_id: userId, purpose, challenge, expires_at: expiresAt });
  if (error) throw error;
}

export async function consumeChallenge(id: number): Promise<boolean> {
  const { data, error } = await adminDb()
    .from("admin_passkey_challenges")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) throw error;
  return Array.isArray(data) && data.length === 1;
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}
