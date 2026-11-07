import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const DEV_SUBSCRIPTION_BYPASS = process.env.ULTIMA_DEV_SUBSCRIPTION_BYPASS === "true";

const PUBLIC_PATHS = new Set([
  "/",
  "/signup",
  "/verify-otp",
  "/forgot-password",
  "/forgot-password/verify",
  "/login-otp",
]);

function isPublicPath(pathname: string) {
  if (PUBLIC_PATHS.has(pathname)) {
    return true;
  }

  return pathname.startsWith("/api/");
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  if (!DEV_SUBSCRIPTION_BYPASS && !isPublicPath(pathname) && !user) {
    const loginUrl = new URL("/", request.url);
    loginUrl.searchParams.set("redirect", pathname);

    return NextResponse.redirect(loginUrl);
  }

  if (user && (pathname === "/" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  /*
   * Subscription / Trial Gate
   *
   * Public authentication pages and APIs remain available.
   * Authenticated application pages require either:
   * - an active 48-hour trial, or
   * - an active subscription.
   *
   * The database remains the source of truth.
   */
  if (
    !DEV_SUBSCRIPTION_BYPASS &&
    user &&
    !pathname.startsWith("/api/") &&
    pathname !== "/subscription-required"
  ) {
    const { data: trial } = await supabase
      .from("trial_accounts")
      .select("status,trial_expires_at")
      .eq("user_id", user.id)
      .maybeSingle();

    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("status,current_period_end")
      .eq("user_id", user.id)
      .in("status", ["active", "past_due"])
      .order("current_period_end", { ascending: false })
      .limit(1)
      .maybeSingle();

    const now = Date.now();

    const trialActive =
      trial?.status === "active" &&
      !!trial.trial_expires_at &&
      new Date(trial.trial_expires_at).getTime() > now;

    const subscriptionActive =
      !!subscription &&
      (
        subscription.status === "active" ||
        subscription.status === "past_due"
      ) &&
      (
        !subscription.current_period_end ||
        new Date(subscription.current_period_end).getTime() > now
      );

    if (!trialActive && !subscriptionActive) {
      return NextResponse.redirect(
        new URL("/subscription-required", request.url)
      );
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
  ],
};
