import { NextResponse } from "next/server";
import { handleHoneyTrap } from "@/lib/server/honey-trap";

export async function GET(request: Request) {
  await handleHoneyTrap(request, null, "decoy_admin_probe");

  return NextResponse.json(
    { error: "Resource unavailable." },
    { status: 404 }
  );
}
