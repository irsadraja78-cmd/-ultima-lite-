import { NextResponse } from "next/server";
import { handleHoneyTrap } from "@/lib/server/honey-trap";

export async function GET(request: Request) {
  await handleHoneyTrap(request, null, "decoy_get_access");

  return NextResponse.json(
    {
      error: "Resource unavailable.",
    },
    { status: 404 }
  );
}

export async function POST(request: Request) {
  await handleHoneyTrap(request, null, "decoy_post_access");

  return NextResponse.json(
    {
      error: "Resource unavailable.",
    },
    { status: 404 }
  );
}

export async function PUT(request: Request) {
  await handleHoneyTrap(request, null, "decoy_put_access");

  return NextResponse.json(
    {
      error: "Resource unavailable.",
    },
    { status: 404 }
  );
}

export async function DELETE(request: Request) {
  await handleHoneyTrap(request, null, "decoy_delete_access");

  return NextResponse.json(
    {
      error: "Resource unavailable.",
    },
    { status: 404 }
  );
}
