import { cookies } from "next/headers";
import { createHash, createHmac, timingSafeEqual } from "crypto";

export type LockerType = "uploaded" | "work";

export const LOCKER_CATEGORIES = [
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
] as const;

export type LockerCategory = typeof LOCKER_CATEGORIES[number];

export function normalizeLockerCategory(
  value: unknown,
): LockerCategory | null {
  const category = String(value ?? "").trim();
  return (LOCKER_CATEGORIES as readonly string[]).includes(category)
    ? (category as LockerCategory)
    : null;
}

export function getLockerPurpose(
  locker: LockerType,
  category: LockerCategory,
) {
  return `locker_${locker}__${category}`;
}

function getCookieName(
  locker: LockerType,
  category: LockerCategory,
) {
  const categoryHash = createHash("sha256")
    .update(category, "utf8")
    .digest("hex")
    .slice(0, 16);

  return `ultima_${locker}_locker_access_${categoryHash}`;
}

export function createLockerProof(
  userId: string,
  locker: LockerType,
  category: LockerCategory,
  secret: string,
) {
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const payload = `${userId}:${locker}:${category}:${expiresAt}`;

  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");

  return Buffer.from(
    `${payload}:${signature}`,
    "utf8",
  ).toString("base64url");
}

export async function verifyLockerAccess(
  userId: string,
  locker: LockerType,
  category: LockerCategory,
): Promise<boolean> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) return false;

  const cookieStore = await cookies();
  const proof = cookieStore.get(
    getCookieName(locker, category),
  )?.value;

  if (!proof) return false;

  try {
    const decoded = Buffer.from(proof, "base64url").toString("utf8");
    const parts = decoded.split(":");

    if (parts.length !== 5) return false;

   
    const [
      proofUserId,
      proofLocker,
      proofCategory,
      expiryText,
      signature,
    ] = parts;

    if (proofUserId !== userId) return false;
    if (proofLocker !== locker) return false;
    if (proofCategory !== category) return false;

    const expiresAt = Number(expiryText);

    if (!Number.isFinite(expiresAt)) return false;
    if (expiresAt <= Date.now()) return false;

    const payload =
      `${proofUserId}:${proofLocker}:${proofCategory}:${expiresAt}`;

    const expected = createHmac("sha256", serviceRoleKey)
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

export function getLockerCookieName(
  locker: LockerType,
  category: LockerCategory,
) {
  return getCookieName(locker, category);
}
