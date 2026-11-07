"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ForgotPassword() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      setMessage("Enter your email address.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/send-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: cleanEmail,
          purpose: "password_reset",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data?.error || "Failed to send recovery OTP.");
        return;
      }

      sessionStorage.setItem(
        "ultima_password_reset",
        JSON.stringify({ email: cleanEmail })
      );

      router.push(
        "/forgot-password/verify?email=" +
          encodeURIComponent(cleanEmail)
      );
    } catch {
      setMessage("Unable to send recovery OTP.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="flex min-h-screen items-center justify-center px-5">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <div className="text-3xl font-bold">
              Ultima<span className="text-cyan-400"> Lite</span>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 md:p-8">
            <p className="text-xs tracking-widest text-cyan-400">
              ACCOUNT RECOVERY
            </p>

            <h1 className="mt-2 text-2xl font-bold">
              Forgot password?
            </h1>

            <p className="mt-2 text-sm text-slate-400">
              Enter your email and we&apos;ll send you a recovery OTP.
            </p>

            <form onSubmit={handleSubmit} className="mt-7 space-y-5">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="h-12 w-full rounded-xl border border-white/10 bg-slate-900 px-4 text-sm outline-none placeholder:text-slate-600 focus:border-cyan-400/60"
              />

              {message && (
                <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-center text-sm text-slate-300">
                  {message}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="h-12 w-full rounded-xl bg-cyan-400 font-semibold text-slate-950 disabled:opacity-50"
              >
                {loading ? "Sending..." : "Send Recovery Code"}
              </button>
            </form>

            <div className="mt-6 text-center text-sm">
              <Link href="/" className="text-cyan-400">
                ← Back to Login
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
