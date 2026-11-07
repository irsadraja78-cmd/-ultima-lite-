"use client";

import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export default function AdminPasskeySignupPage() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function setupPasskey() {
    setBusy(true);
    setMessage("");
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setMessage("पहले अपने अधिकृत Ultima Lite खाते से लॉगिन और OTP सत्यापन करें।");
        return;
      }

      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };

      const optionsResponse = await fetch("/api/admin/passkey/register-options", {
        method: "POST",
        headers,
      });
      const optionsData = await optionsResponse.json();
      if (!optionsResponse.ok) throw new Error(optionsData.error || "Passkey विकल्प नहीं मिले।");

      const credential = await startRegistration({ optionsJSON: optionsData.options });

      const verifyResponse = await fetch("/api/admin/passkey/register-verify", {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({ credential }),
      });
      const verifyData = await verifyResponse.json();
      if (!verifyResponse.ok) throw new Error(verifyData.error || "Passkey setup असफल।");

      setMessage("Passkey सफलतापूर्वक सेट हो गई। Admin Dashboard खोला जा रहा है।");
      window.location.href = "/admin";
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Passkey setup असफल।");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-5">
      <section className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-7">
        <h1 className="text-2xl font-bold">Admin Passkey Setup</h1>
        <p className="mt-3 text-sm text-slate-300">
          यह पेज केवल पहले से अधिकृत Admin खाते के लिए है। नया Admin role यहाँ से नहीं बनाया जाता।
          डिवाइस के अनुसार Passkey फिंगरप्रिंट, चेहरे की पहचान या डिवाइस PIN इस्तेमाल कर सकती है।
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={setupPasskey}
          className="mt-6 w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold disabled:opacity-50"
        >
          {busy ? "कृपया प्रतीक्षा करें…" : "Passkey Register करें"}
        </button>
        {message && <p role="status" className="mt-4 break-words text-sm">{message}</p>}
        <Link className="mt-5 inline-block text-blue-300 underline" href="/admin/login">
          Admin Login पर जाएँ
        </Link>
        <p className="mt-3 text-sm text-slate-400">
          पहले लॉगिन करना है? <Link className="underline" href="/">Ultima Lite Login</Link>
        </p>
      </section>
    </main>
  );
}
