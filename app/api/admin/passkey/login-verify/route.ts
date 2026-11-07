import { NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
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

    const challenge = await getChallenge(user.id, "login");
    if (!challenge) return fail("Login challenge समाप्त हो गया। फिर कोशिश करें।", 400);

    const body = await request.json();
    const credentialId = body.credential?.id;
    if (typeof credentialId !== "string") return fail("Invalid credential", 400);

    const db = adminDb();
    const { data: saved, error } = await db.from("admin_passkeys")
      .select("id,credential_id,public_key,counter,transports")
      .eq("user_id", user.id).eq("credential_id", credentialId).maybeSingle();
    if (error) throw error;
    if (!saved) return fail("यह Passkey इस Admin खाते से जुड़ी नहीं है।", 403);

    const verification = await verifyAuthenticationResponse({
      response: body.credential,
      expectedChallenge: challenge.challenge,
      expectedOrigin: site.origin,
      expectedRPID: site.rpID,
      credential: {
        id: saved.credential_id,
        publicKey: new Uint8Array(Buffer.from(saved.public_key, "base64url")),
        counter: Number(saved.counter),
        transports: saved.transports,
      },
      requireUserVerification: true,
    });

    const challengeConsumed = await consumeChallenge(challenge.id);
    if (!challengeConsumed) {
      return fail("यह Passkey challenge पहले इस्तेमाल हो चुका है। फिर कोशिश करें।", 409);
    }
    if (!verification.verified) return fail("Passkey verification असफल।", 401);

    const { error: updateError } = await db.from("admin_passkeys")
      .update({ counter: verification.authenticationInfo.newCounter })
      .eq("id", saved.id).eq("user_id", user.id);
    if (updateError) throw updateError;

    const result = NextResponse.json({
      success: true,
      message: "Admin Passkey verification सफल।",
    });
    setAdminPasskeySession(result, user.id, request);
    return result;
  } catch (error) {
    console.error("Admin passkey login verification failed:", error);
    return fail("Passkey login verify नहीं हो सका।", 400);
  }
}
