"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function VerifyRecoveryForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryEmail = searchParams.get("email") || "";

  const [email, setEmail] = useState(queryEmail);
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (queryEmail) {
      setEmail(queryEmail.trim().toLowerCase()); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }

    try {
      const saved = sessionStorage.getItem("ultima_password_reset");

      if (!saved) {
        return;
      }

      const parsed = JSON.parse(saved);
      const savedEmail =
        typeof parsed?.email === "string"
          ? parsed.email.trim().toLowerCase()
          : "";

      if (savedEmail) {
        setEmail(savedEmail);
      }
    } catch {
      // Ignore invalid recovery session data.
    }
  }, [queryEmail]);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();

    if (!email) {
      setMessage("Email address is missing.");
      return;
    }

    if (otp.length !== 6) {
      setMessage("Please enter the 6-digit OTP.");
      return;
    }

    if (password.length < 6) {
      setMessage("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    setLoading(true);
    setMessage("Verifying OTP...");

    try {
      const response = await fetch("/api/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          otp,
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data?.error || "Password reset failed.");
        return;
      }

      sessionStorage.removeItem("ultima_password_reset");

      setMessage("Password updated successfully. Redirecting to login...");

      setTimeout(() => {
        router.push("/");
      }, 1000);
    } catch {
      setMessage("Unable to complete password reset.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="flex min-h-screen items-center justify-center px-5 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <div className="text-3xl font-bold">
              Ultima<span className="text-cyan-400"> Lite</span>
            </div>

            <p className="mt-2 text-sm text-slate-500">
              Series 01 · Private Workspace
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl md:p-8">
            <p className="text-xs font-medium tracking-widest text-cyan-400">
              PASSWORD RECOVERY
            </p>

            <h1 className="mt-2 text-2xl font-bold">
              Reset your password
            </h1>

            <p className="mt-2 text-sm leading-6 text-slate-400">
              Enter the 6-digit OTP sent to
              <span className="mt-1 block text-slate-200">
                {email}
              </span>
            </p>

            <form onSubmit={handleReset} className="mt-7 space-y-4">
              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  Verification code
                </label>

                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otp}
                  onChange={(e) =>
                    setOtp(e.target.value.replace(/\D/g, ""))
                  }
                  placeholder="000000"
                  className="h-14 w-full rounded-xl border border-white/10 bg-slate-900 px-4 text-center text-2xl font-semibold tracking-[0.5em] outline-none placeholder:text-slate-700 focus:border-cyan-400/60"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  New password
                </label>

                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a new password"
                  className="h-12 w-full rounded-xl border border-white/10 bg-slate-900 px-4 text-sm outline-none placeholder:text-slate-600 focus:border-cyan-400/60"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  Confirm new password
                </label>

                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className="h-12 w-full rounded-xl border border-white/10 bg-slate-900 px-4 text-sm outline-none placeholder:text-slate-600 focus:border-cyan-400/60"
                />
              </div>

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
                {loading ? "Updating..." : "Reset Password"}
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

export default function VerifyRecovery() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
          Loading...
        </main>
      }
    >
      <VerifyRecoveryForm />
    </Suspense>
  );
}
