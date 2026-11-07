"use client";

import { useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export default function AdminPasskeyLoginPage() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function verifyPasskey() {
    setBusy(true);
    setMessage("");
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setMessage("पहले Ultima Lite में लॉगिन और OTP सत्यापन करें, फिर यहाँ लौटें।");
        return;
      }

      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };

      const optionsResponse = await fetch("/api/admin/passkey/login-options", {
        method: "POST",
        headers,
      });
      const optionsData = await optionsResponse.json();
      if (!optionsResponse.ok) throw new Error(optionsData.error || "Passkey विकल्प नहीं मिले।");

      const credential = await startAuthentication({ optionsJSON: optionsData.options });

      const verifyResponse = await fetch("/api/admin/passkey/login-verify", {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({ credential }),
      });
      const verifyData = await verifyResponse.json();
      if (!verifyResponse.ok) throw new Error(verifyData.error || "Passkey verification असफल।");

      window.location.href = "/admin";
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Passkey login असफल।");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-5">
      <section className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-7">
        <h1 className="text-2xl font-bold">Ultima Lite Admin Login</h1>
        <p className="mt-3 text-sm text-slate-300">
          पहले मौजूदा खाते से लॉगिन और OTP पूरा करें। उसके बाद Passkey verification करें।
          Admin भूमिका और Passkey दोनों सत्यापित होने चाहिए।
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={verifyPasskey}
          className="mt-6 w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold disabled:opacity-50"
        >
          {busy ? "सत्यापन जारी है…" : "Passkey से Verify करें"}
        </button>
        {message && <p role="status" className="mt-4 break-words text-sm">{message}</p>}
        <Link className="mt-5 inline-block text-blue-300 underline" href="/admin/signup">
          पहली बार Passkey Register करें
        </Link>
        <p className="mt-3 text-sm text-slate-400">
          <Link className="underline" href="/">Ultima Lite Login पर जाएँ</Link>
        </p>
      </section>
    </main>
  );
}
