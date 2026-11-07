import { createClient } from "@supabase/supabase-js";

export type AppRole =
  | "Super Admin"
  | "Admin"
  | "Team Leader"
  | "Reviewer"
  | "Freelancer";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Missing Supabase server environment variables");
  }

  return createClient(url, serviceRoleKey);
}

export async function getUserRole(
  userId: string
): Promise<AppRole | null> {
  if (!userId) {
    return null;
  }

  const supabaseAdmin = getAdminClient();

  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role_id, roles(name)")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const roleData = data as unknown as {
    roles:
      | { name?: string | null }
      | Array<{ name?: string | null }>
      | null;
  };

  const roleName = Array.isArray(roleData.roles)
    ? roleData.roles[0]?.name
    : roleData.roles?.name;

  const validRoles: AppRole[] = [
    "Super Admin",
    "Admin",
    "Team Leader",
    "Reviewer",
    "Freelancer",
  ];

  return validRoles.includes(roleName as AppRole)
    ? (roleName as AppRole)
    : null;
}

export function hasRequiredRole(
  userRole: AppRole | null,
  allowedRoles: AppRole[]
): boolean {
  if (!userRole) {
    return false;
  }

  return allowedRoles.includes(userRole);
}

export function isAdminRole(userRole: AppRole | null): boolean {
  return (
    userRole === "Super Admin" ||
    userRole === "Admin"
  );
}

export function isManagementRole(userRole: AppRole | null): boolean {
  return (
    userRole === "Super Admin" ||
    userRole === "Admin" ||
    userRole === "Team Leader"
  );
}

export function isReviewRole(userRole: AppRole | null): boolean {
  return (
    userRole === "Super Admin" ||
    userRole === "Admin" ||
    userRole === "Team Leader" ||
    userRole === "Reviewer"
  );
}
