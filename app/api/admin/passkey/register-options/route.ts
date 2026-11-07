import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import {
  adminDb, adminUser, fail, requestOrigin, storeChallenge,
} from "@/lib/server/admin-passkey-common";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { user, response } = await adminUser(request);
    if (response || !user) return response ?? fail("Unauthorized", 401);

    const site = requestOrigin(request);
    if (!site) return fail("इस origin पर Passkey setup की अनुमति नहीं है।", 403);

    const db = adminDb();
    const { data: existing, error } = await db.from("admin_passkeys")
      .select("credential_id,transports").eq("user_id", user.id);
    if (error) throw error;

    const options = await generateRegistrationOptions({
      rpName: "Ultima Lite Admin",
      rpID: site.rpID,
      userID: new TextEncoder().encode(user.id),
      userName: user.email ?? user.id,
      userDisplayName: user.email ?? "Ultima Lite Admin",
      attestationType: "none",
      excludeCredentials: (existing ?? []).map((c) => ({
        id: c.credential_id,
        transports: c.transports,
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
    });

    await storeChallenge(user.id, "register", options.challenge);
    return NextResponse.json({ success: true, options });
  } catch (error) {
    console.error("Admin passkey registration options failed:", error);
    return fail("Passkey setup options नहीं बन सके।", 500);
  }
}
