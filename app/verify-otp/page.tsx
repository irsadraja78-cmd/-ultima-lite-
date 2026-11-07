"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

function VerifyOtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";

  const [otp, setOtp] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendOtp() {
    const recipientEmail = String(email || "").trim().toLowerCase();

    if (!recipientEmail) {
      setMessage("Email address is missing.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const payload = {
        email: recipientEmail,
        purpose: "signup",
      };

      console.log("SIGNUP OTP REQUEST:", payload);

      const response = await fetch("/api/send-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      console.log("SIGNUP OTP RESPONSE:", {
        status: response.status,
        data,
      });

      if (!response.ok) {
        setMessage(data.error || "Failed to send OTP.");
        return;
      }

      setMessage("OTP sent successfully. Check your email.");
    } catch (error) {
      console.error("SIGNUP OTP CLIENT ERROR:", error);
      setMessage("Unable to send OTP.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();

    if (otp.length !== 6) {
      setMessage("Please enter the 6-digit OTP.");
      return;
    }

    setLoading(true);
    setMessage("Verifying OTP...");

    try {
      const response = await fetch("/api/verify-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          otp,
          purpose: "signup",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data?.error || "OTP verification failed.");
        return;
      }

      const savedSignup = sessionStorage.getItem("ultima_signup");

      if (!savedSignup) {
        setMessage(
          "OTP verified, but signup details were not found. Please start signup again."
        );
        return;
      }

      let signupData: {
        username?: string;
        fullName?: string;
        email?: string;
        password?: string;
      };

      try {
        signupData = JSON.parse(savedSignup);
      } catch {
        setMessage("Signup data is invalid. Please start signup again.");
        return;
      }

      const signupEmail = (signupData.email || email).trim().toLowerCase();
      const password = signupData.password || "";
      const username =
        signupData.username || signupData.fullName || "User";

      if (!signupEmail || !password) {
        setMessage(
          "Signup email or password is missing. Please start signup again."
        );
        return;
      }

      setMessage("OTP verified. Creating your account...");

      const { data: authData, error: signupError } =
        await supabase.auth.signUp({
          email: signupEmail,
          password,
          options: {
            data: {
              username,
            },
          },
        });

      if (signupError) {
        if (
          signupError.message.toLowerCase().includes("already registered") ||
          signupError.message.toLowerCase().includes("already exists")
        ) {
          setMessage(
            "This email is already registered. Please sign in instead."
          );
        } else {
          setMessage(`Account creation failed: ${signupError.message}`);
        }
        return;
      }

      if (!authData.user) {
        setMessage("Account creation failed. No user was returned.");
        return;
      }

      const deviceSignal = [
        navigator.userAgent,
        navigator.platform,
        navigator.language,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        `${window.screen.width}x${window.screen.height}`,
        `${window.screen.colorDepth}`,
      ].join("|");

      const trialResponse = await fetch("/api/subscription/trial", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          device_signal: deviceSignal,
        }),
      });

      const trialData = await trialResponse.json().catch(() => ({}));

      if (!trialResponse.ok) {
        setMessage(
          trialData?.error ||
            "Account created, but the free trial could not be activated."
        );
        return;
      }

      sessionStorage.removeItem("ultima_signup");

      setMessage("Account created. Your 48-hour free trial is active. Opening dashboard...");

      setTimeout(() => {
        router.push("/dashboard");
      }, 800);
    } catch (error) {
      console.error("VERIFY/ACCOUNT ERROR:", error);
      setMessage("Unable to complete account creation.");
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
              EMAIL VERIFICATION
            </p>

            <h1 className="mt-2 text-2xl font-bold">
              Verify your email
            </h1>

            <p className="mt-2 text-sm leading-6 text-slate-400">
              Enter the 6-digit OTP sent to
              {email ? (
                <span className="mt-1 block text-slate-200">
                  {email}
                </span>
              ) : (
                " your email address."
              )}
            </p>

            <form onSubmit={verifyOtp} className="mt-7 space-y-5">
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

              {message && (
                <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-center text-sm text-slate-300">
                  {message}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="h-12 w-full rounded-xl bg-cyan-400 font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-50"
              >
                {loading ? "Processing..." : "Verify OTP"}
              </button>
            </form>

            <div className="mt-6 flex items-center justify-between text-sm">
              <Link
                href="/signup"
                className="text-slate-500 hover:text-cyan-400"
              >
                ← Back to Signup
              </Link>

              <button
                type="button"
                onClick={sendOtp}
                disabled={loading}
                className="text-cyan-400 hover:text-cyan-300 disabled:opacity-50"
              >
                {loading ? "Sending..." : "Send OTP"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function VerifyOtp() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
          <div className="text-slate-400">Loading verification...</div>
        </main>
      }
    >
      <VerifyOtpForm />
    </Suspense>
  );
}
