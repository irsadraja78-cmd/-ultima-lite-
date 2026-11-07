import { NextResponse } from "next/server";
import { requireSubscription } from "@/lib/server/subscription";
import { createClient } from "@supabase/supabase-js";

async function getAdminAndUser(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return { error: "Server configuration is missing." };
  }

  const admin = createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return { error: "Authentication required." };
  }

  const accessToken = authHeader.slice(7);

  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(accessToken);

  if (userError || !user) {
    return { error: "Invalid authentication session." };
  }

  const access = await requireSubscription(user.id);

  if (!access.allowed) {
    return {
      admin,
      user,
      subscriptionError: {
        error: "Subscription required.",
        code: "SUBSCRIPTION_REQUIRED",
        reason: access.reason,
        expires_at: access.expiresAt,
      },
    };
  }

  return { admin, user };
}

export async function GET(request: Request) {
  try {
    const auth = await getAdminAndUser(request);

    if ("error" in auth) {
      return NextResponse.json(
        { error: auth.error },
        { status: 401 }
      );
    }

    if ("subscriptionError" in auth) {
      return NextResponse.json(auth.subscriptionError, { status: 403 });
    }

    const { data: historyData, error: historyError } =
      await auth.admin
        .from("work_history")
        .select("*")
        .eq("user_id", auth.user.id)
        .order("created_at", { ascending: false });

    if (historyError) {
      console.error("WORK HISTORY LOOKUP ERROR:", historyError);

      return NextResponse.json(
        {
          error: `Work history lookup failed: ${historyError.message}`,
        },
        { status: 500 }
      );
    }

    const history = (historyData || []).map((item) => ({
      ...item,
      work_file_id: item.work_file_id || null,
    }));

    return NextResponse.json({
      success: true,
      history,
    });
  } catch (error) {
    console.error("WORK HISTORY API ERROR:", error);

    return NextResponse.json(
      { error: "Unable to load work history." },
      { status: 500 }
    );
  }
}
