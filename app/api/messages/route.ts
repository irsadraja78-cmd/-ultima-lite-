import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSubscription } from "@/lib/server/subscription";

export async function GET(request: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      return NextResponse.json(
        { error: "Server configuration is missing." },
        { status: 500 }
      );
    }

    const admin = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const authHeader = request.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      );
    }

    const token = authHeader.slice(7);

    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json(
        { error: "Invalid authentication session." },
        { status: 401 }
      );
    }

    const access = await requireSubscription(user.id);

    if (!access.allowed) {
      return NextResponse.json(
        {
          error: "Subscription required.",
          code: "SUBSCRIPTION_REQUIRED",
          reason: access.reason,
          expires_at: access.expiresAt,
        },
        { status: 403 }
      );
    }

    const { data, error } = await admin
      .from("messages")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("MESSAGES LOOKUP ERROR:", error);
      return NextResponse.json(
        { error: "Unable to load messages." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      messages: data || [],
    });
  } catch (error) {
    console.error("MESSAGES API ERROR:", error);

    return NextResponse.json(
      { error: "Unable to load messages." },
      { status: 500 }
    );
  }
}
