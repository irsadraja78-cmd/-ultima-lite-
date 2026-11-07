import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = String(body?.email || "").trim().toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("CHECK EMAIL: missing server configuration");
      return NextResponse.json(
        { error: "Unable to check account status." },
        { status: 500 }
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data, error } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    if (error) {
      console.error("CHECK EMAIL ERROR:", error);
      return NextResponse.json(
        { error: "Unable to check account status." },
        { status: 500 }
      );
    }

    const exists = data.users.some(
      (user) => user.email?.trim().toLowerCase() === email
    );

    return NextResponse.json({ exists });
  } catch (error) {
    console.error("CHECK EMAIL SERVER ERROR:", error);

    return NextResponse.json(
      { error: "Unable to check account status." },
      { status: 500 }
    );
  }
}
