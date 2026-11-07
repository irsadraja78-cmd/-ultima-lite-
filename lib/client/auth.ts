import { supabase } from "@/lib/supabase";

export async function signOutAndClearSession() {
  try {
    await supabase.auth.signOut();
  } finally {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("ultima_login");
      sessionStorage.removeItem("ultima_signup");
      sessionStorage.removeItem("ultima_password_reset");
    }
  }
}
