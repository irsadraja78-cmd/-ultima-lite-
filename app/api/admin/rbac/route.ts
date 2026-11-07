import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/rbac-auth";

export async function GET(request: Request) {
  const auth = await requireRole(request, [
    "Super Admin",
    "Admin",
  ]);

  if (auth.response) {
    return auth.response;
  }

  return NextResponse.json({
    success: true,
    authorized: true,
    role: auth.role,
    userId: auth.user!.id,
  });
}
