import { NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import {
  adminDb, adminUser, consumeChallenge, fail, getChallenge, requestOrigin,
} from "@/lib/server/admin-passkey-common";
import { setAdminPasskeySession } from "@/lib/server/admin-passkey-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { user, response } = await adminUser(request);
    if (response || !user) return response ?? fail("Unauthorized", 401);

    const site = requestOrigin(request);
    if (!site) return fail("Invalid origin", 403);

    const challenge = await getChallenge(user.id, "register");
    if (!challenge) return fail("Passkey challenge समाप्त हो गया। फिर कोशिश करें।", 400);

    const body = await request.json();
    const verification = await verifyRegistrationResponse({
      response: body.credential,
      expectedChallenge: challenge.challenge,
      expectedOrigin: site.origin,
      expectedRPID: site.rpID,
      requireUserVerification: true,
    });

    const challengeConsumed = await consumeChallenge(challenge.id);
    if (!challengeConsumed) {
      return fail("यह Passkey challenge पहले इस्तेमाल हो चुका है। फिर कोशिश करें।", 409);
    }
    if (!verification.verified || !verification.registrationInfo) {
      return fail("Passkey verification सफल नहीं हुआ।", 400);
    }

    const credential = verification.registrationInfo.credential;
    const db = adminDb();
    const { error } = await db.from("admin_passkeys").insert({
      user_id: user.id,
      credential_id: credential.id,
      public_key: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: credential.transports ?? [],
    });
    if (error) throw error;

    const result = NextResponse.json({
      success: true,
      message: "Admin Passkey सफलतापूर्वक register हो गई।",
    });
    setAdminPasskeySession(result, user.id, request);
    return result;
  } catch (error) {
    console.error("Admin passkey registration verification failed:", error);
    return fail("Passkey register नहीं हो सकी। यदि यह पहले से जुड़ी है, तो Login इस्तेमाल करें।", 400);
  }
}
