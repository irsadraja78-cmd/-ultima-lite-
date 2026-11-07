import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import {
  adminDb, adminUser, fail, requestOrigin, storeChallenge,
} from "@/lib/server/admin-passkey-common";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { user, response } = await adminUser(request);
    if (response || !user) return response ?? fail("Unauthorized", 401);

    const site = requestOrigin(request);
    if (!site) return fail("Invalid origin", 403);

    const { data: credentials, error } = await adminDb()
      .from("admin_passkeys")
      .select("credential_id,transports")
      .eq("user_id", user.id);
    if (error) throw error;
    if (!credentials?.length) return fail("इस Admin खाते में Passkey register नहीं है।", 404);

    const options = await generateAuthenticationOptions({
      rpID: site.rpID,
      userVerification: "required",
      allowCredentials: credentials.map((c) => ({
        id: c.credential_id,
        transports: c.transports,
      })),
    });

    await storeChallenge(user.id, "login", options.challenge);
    return NextResponse.json({ success: true, options });
  } catch (error) {
    console.error("Admin passkey login options failed:", error);
    return fail("Passkey login शुरू नहीं हो सका।", 500);
  }
}
