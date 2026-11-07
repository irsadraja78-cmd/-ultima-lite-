"use client";

import { usePathname } from "next/navigation";
import AppSidebar from "./AppSidebar";

const PUBLIC_PATHS = new Set([
  "/",
  "/signup",
  "/verify-otp",
  "/login-otp",
  "/forgot-password",
  "/forgot-password/verify",
]);

export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isPublic = PUBLIC_PATHS.has(pathname);
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");

  return (
    <>
      {!isPublic && !isAdmin && <AppSidebar />}
      {children}
    </>
  );
}
