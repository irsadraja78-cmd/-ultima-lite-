import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";

const COOKIE_NAME = "ultima_admin_passkey";
const SESSION_SECONDS = 600;

function secret() {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return value;
}

function signature(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function setAdminPasskeySession(
  response: NextResponse,
  userId: string,
  request: Request,
) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = `${userId}.${expires}`;
  const token = `${payload}.${signature(payload)}`;
  const secure =
    new URL(request.url).protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https";

  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/api/admin",
    maxAge: SESSION_SECONDS,
  });
}

export function hasAdminPasskeySession(request: Request, userId: string) {
  try {
    const raw = request.headers.get("cookie") ?? "";
    const item = raw.split(";").map((s) => s.trim())
      .find((s) => s.startsWith(`${COOKIE_NAME}=`));
    if (!item) return false;

    const token = decodeURIComponent(item.slice(COOKIE_NAME.length + 1));
    const parts = token.split(".");
    if (parts.length !== 3) return false;

    const [uid, expiresText, supplied] = parts;
    const expires = Number(expiresText);
    if (uid !== userId || !Number.isSafeInteger(expires) ||
        expires <= Math.floor(Date.now() / 1000)) return false;

    const expected = Buffer.from(signature(`${uid}.${expiresText}`));
    const actual = Buffer.from(supplied);
    return expected.length === actual.length &&
      timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
