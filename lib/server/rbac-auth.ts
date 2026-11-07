import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  AppRole,
  getUserRole,
  hasRequiredRole,
} from "./rbac";
import { hasAdminPasskeySession } from "./admin-passkey-session";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Missing Supabase server environment variables");
  }

  return createClient(url, serviceRoleKey);
}

export async function getAuthenticatedUser(request: Request) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice(7).trim();

  if (!token) {
    return null;
  }

  const supabaseAdmin = getAdminClient();

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return null;
  }

  return user;
}

export async function requireRole(
  request: Request,
  allowedRoles: AppRole[]
) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return {
      user: null,
      role: null,
      response: NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      ),
    };
  }

  const role = await getUserRole(user.id);

  if (!hasRequiredRole(role, allowedRoles)) {
    return {
      user,
      role,
      response: NextResponse.json(
        { success: false, error: "Forbidden" },
        { status: 403 }
      ),
    };
  }

  const pathname = new URL(request.url).pathname;
  const isAdminApi = pathname.startsWith("/api/admin/");
  const isPasskeyEndpoint = pathname.startsWith("/api/admin/passkey/");
  const isAdminRole = role === "Super Admin" || role === "Admin";

  if (
    isAdminApi &&
    !isPasskeyEndpoint &&
    isAdminRole &&
    !hasAdminPasskeySession(request, user.id)
  ) {
    return {
      user,
      role,
      response: NextResponse.json(
        {
          success: false,
          error: "Admin Passkey verification required",
          code: "ADMIN_PASSKEY_REQUIRED",
        },
        { status: 403 }
      ),
    };
  }

  return {
    user,
    role,
    response: null,
  };
}
