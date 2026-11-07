"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail || !password) {
      setMessage("Enter your email and password.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/login-check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: normalizedEmail,
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "Invalid email or password.");
        return;
      }

      const otpResponse = await fetch("/api/send-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: normalizedEmail,
          purpose: "login",
        }),
      });

      const otpData = await otpResponse.json();

      if (!otpResponse.ok) {
        setMessage(otpData.error || "Failed to send login OTP.");
        return;
      }

      sessionStorage.setItem(
        "ultima_login",
        JSON.stringify({
          email: normalizedEmail,
          password,
        })
      );

      router.push(
        "/login-otp?email=" + encodeURIComponent(normalizedEmail)
      );
    } catch {
      setMessage("Unable to complete login.");
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
            <div className="mb-7">
              <p className="text-xs font-medium tracking-widest text-cyan-400">
                SECURE ACCESS
              </p>
              <h1 className="mt-2 text-2xl font-bold">Welcome back</h1>
              <p className="mt-2 text-sm text-slate-400">
                Sign in to your Ultima Lite workspace.
              </p>
            </div>

            <form className="space-y-5" onSubmit={handleLogin}>
              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  Email address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="h-12 w-full rounded-xl border border-white/10 bg-slate-900 px-4 text-sm outline-none placeholder:text-slate-600 focus:border-cyan-400/60"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm text-slate-300">Password</label>
                  <Link
                    href="/forgot-password"
                    className="text-xs text-cyan-400 hover:text-cyan-300"
                  >
                    Forgot password?
                  </Link>
                </div>

                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="h-12 w-full rounded-xl border border-white/10 bg-slate-900 px-4 pr-16 text-sm outline-none placeholder:text-slate-600 focus:border-cyan-400/60"
                  />

                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              {message && (
                <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-center text-sm text-red-300">
                  {message}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="h-12 w-full rounded-xl bg-cyan-400 font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-50"
              >
                {loading ? "Signing in..." : "Sign In"}
              </button>
            </form>

            <div className="my-6 flex items-center gap-3">
              <div className="h-px flex-1 bg-white/10" />
              <span className="text-xs text-slate-600">OR</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>

            <div className="text-center text-sm text-slate-400">
              Don&apos;t have an account?{" "}
              <Link
                href="/signup"
                className="font-medium text-cyan-400 hover:text-cyan-300"
              >
                Create account
              </Link>
            </div>
          </div>

          <div className="mt-6 text-center text-xs text-slate-600">
            Protected private workspace · Ultima Lite
          </div>
        </div>
      </div>
    </main>
  );
}
