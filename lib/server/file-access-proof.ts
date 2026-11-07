import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_MS = 10 * 60 * 1000;

function getCookieName(fileId: string) {
  return `ultima_file_access_${fileId}`;
}

export function createFileAccessProof(
  userId: string,
  fileId: string,
  secret: string,
) {
  const expiresAt = Date.now() + TTL_MS;
  const payload = `${userId}:${fileId}:${expiresAt}`;
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");

  return Buffer.from(
    `${payload}:${signature}`,
    "utf8",
  ).toString("base64url");
}

export async function verifyFileAccessProof(
  userId: string,
  fileId: string,
): Promise<boolean> {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return false;

  const proof = (await cookies()).get(getCookieName(fileId))?.value;
  if (!proof) return false;

  try {
    const decoded = Buffer.from(proof, "base64url").toString("utf8");
    const parts = decoded.split(":");

    if (parts.length !== 4) return false;

    const [proofUserId, proofFileId, expiryText, signature] = parts;

    if (proofUserId !== userId || proofFileId !== fileId) {
      return false;
    }

    const expiresAt = Number(expiryText);

    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return false;
    }

    const payload =
      `${proofUserId}:${proofFileId}:${expiresAt}`;

    const expected = createHmac("sha256", secret)
      .update(payload)
      .digest("base64url");

    const actualBuffer = Buffer.from(signature, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");

    if (actualBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(actualBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

export function setFileAccessProofCookie(
  response: Response,
  userId: string,
  fileId: string,
  secret: string,
) {
  const proof = createFileAccessProof(
    userId,
    fileId,
    secret,
  );

  response.headers.append(
    "Set-Cookie",
    [
      `${getCookieName(fileId)}=${encodeURIComponent(proof)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      "Max-Age=600",
      process.env.NODE_ENV === "production" ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; "),
  );
}
