"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Signup() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

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
                CREATE ACCOUNT
              </p>
              <h1 className="mt-2 text-2xl font-bold">Join Ultima Lite</h1>
              <p className="mt-2 text-sm text-slate-400">
                Create your private workspace account.
              </p>
            </div>

            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();

                const form = e.currentTarget;
                const formData = new FormData(form);

                const username =
                  String(formData.get("username") || "").trim();
                const password =
                  String(formData.get("password") || "");
                const confirmPassword =
                  String(formData.get("confirmPassword") || "");

                if (!username || !email || !password) {
                  setMessage("Please complete all required fields.");
                  return;
                }

                if (password !== confirmPassword) {
                  setMessage("Passwords do not match.");
                  return;
                }

                const normalizedEmail = email.trim().toLowerCase();

                setLoading(true);
                setMessage("");

                try {
                  const response = await fetch("/api/check-email", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      email: normalizedEmail,
                    }),
                  });

                  const data = await response.json();

                  if (!response.ok) {
                    setMessage(
                      data.error || "Unable to check email address."
                    );
                    return;
                  }

                  if (data.exists) {
                    setMessage(
                      "This email is already registered. Please sign in instead."
                    );
                    return;
                  }

                  sessionStorage.setItem(
                  "ultima_signup",
                  JSON.stringify({
                    username,
                    email: normalizedEmail,
                    password,
                  })
                );

                  router.push(
                    "/verify-otp?email=" +
                      encodeURIComponent(normalizedEmail)
                  );
                } catch (error) {
                  console.error("EMAIL CHECK ERROR:", error);
                  setMessage("Unable to check email address.");
                } finally {
                  setLoading(false);
                }
              }}
            >
              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  Username
                </label>
                <input
                  type="text"
                  name="username"
                  placeholder="Choose a username"
                  className="h-12 w-full rounded-xl border border-white/10 bg-slate-900 px-4 text-sm outline-none placeholder:text-slate-600 focus:border-cyan-400/60"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  Email address
                </label>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 w-full rounded-xl border border-white/10 bg-slate-900 px-4 text-sm outline-none placeholder:text-slate-600 focus:border-cyan-400/60"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    name="password"
                    placeholder="Create a password"
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

              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  Confirm password
                </label>
                <input
                  type="password"
                  name="confirmPassword"
                  placeholder="Confirm your password"
                  className="h-12 w-full rounded-xl border border-white/10 bg-slate-900 px-4 text-sm outline-none placeholder:text-slate-600 focus:border-cyan-400/60"
                />
              </div>

              {message && (
                <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-center text-sm text-red-300">
                  {message}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="mt-2 h-12 w-full rounded-xl bg-cyan-400 font-semibold text-slate-950 transition hover:bg-cyan-300"
              >
                {loading ? "Checking..." : "Create Account"}
              </button>
            </form>

            <div className="my-6 flex items-center gap-3">
              <div className="h-px flex-1 bg-white/10" />
              <span className="text-xs text-slate-600">OR</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>

            <div className="space-y-3 text-center text-sm">
              <div className="text-slate-400">
                Already have an account?{" "}
                <Link
                  href="/"
                  className="font-medium text-cyan-400 hover:text-cyan-300"
                >
                  Sign in
                </Link>
              </div>

              <Link
                href="/forgot-password"
                className="inline-block text-xs text-slate-500 hover:text-cyan-400"
              >
                Forgot password?
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
