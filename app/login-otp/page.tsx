"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getDeviceInfo } from "@/lib/client/device";

function LoginOtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";

  const [otp, setOtp] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

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
          purpose: "login",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "Invalid OTP.");
        return;
      }

      const completeResponse = await fetch("/api/login-complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const completeData = await completeResponse.json();

      if (!completeResponse.ok || !completeData.success) {
        setMessage(
          completeData.error ||
            "Secure login session could not be established. Please sign in again."
        );
        return;
      }

      sessionStorage.removeItem("ultima_login");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setMessage("Login session could not be established.");
        return;
      }

      const device = await getDeviceInfo();

      const deviceResponse = await fetch("/api/devices/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          fingerprint: device.fingerprint,
          deviceName: device.deviceName,
          deviceType: device.deviceType,
          browser: device.browser,
          operatingSystem: device.operatingSystem,
        }),
      });

      const deviceData = await deviceResponse.json();

      if (!deviceResponse.ok) {
        await supabase.auth.signOut({ scope: "local" });
        setMessage(
          deviceData.error ||
            "This device could not be verified. Please contact security."
        );
        return;
      }

      setMessage("Security risk check in progress...");

      const riskResponse = await fetch("/api/security/risk-check", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const riskData = await riskResponse.json();

      if (!riskResponse.ok || !riskData.success) {
        await supabase.auth.signOut({ scope: "local" });
        setMessage(
          "Security verification could not be completed. Please sign in again."
        );
        return;
      }

      const riskLevel = riskData.risk?.level;
      const decision = riskData.risk?.decision;

      if (decision === "blocked" || riskLevel === "critical") {
        await supabase.auth.signOut({ scope: "local" });
        setMessage(
          "Security verification blocked this login. Please try again later or contact security."
        );
        return;
      }

      if (
        decision === "reauthentication_required" ||
        riskLevel === "high"
      ) {
        await supabase.auth.signOut({ scope: "local" });
        setMessage(
          "Additional security verification is required before this login can continue."
        );
        return;
      }

      if (
        decision === "additional_verification" ||
        riskLevel === "medium"
      ) {
        setMessage(
          "Login verified. Additional security monitoring is active. Opening dashboard..."
        );
      } else if (deviceData.isNewDevice) {
        setMessage(
          "Login verified. Device registered. Opening dashboard..."
        );
      } else {
        setMessage(
          "Login verified. Device recognized. Opening dashboard..."
        );
      }

      setTimeout(() => {
        router.push("/dashboard");
      }, 500);
    } catch {
      setMessage("Unable to complete login.");
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
            <p className="mt-2 text-sm text-slate-500">
              Series 01 · Private Workspace
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 md:p-8">
            <p className="text-xs tracking-widest text-cyan-400">
              LOGIN VERIFICATION
            </p>

            <h1 className="mt-2 text-2xl font-bold">
              Verify your login
            </h1>

            <p className="mt-2 text-sm text-slate-400">
              Enter the 6-digit OTP sent to
              <span className="mt-1 block text-slate-200">
                {email}
              </span>
            </p>

            <form onSubmit={verifyOtp} className="mt-7 space-y-5">
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otp}
                onChange={(e) =>
                  setOtp(e.target.value.replace(/\D/g, ""))
                }
                placeholder="000000"
                className="h-14 w-full rounded-xl border border-white/10 bg-slate-900 px-4 text-center text-2xl font-semibold tracking-[0.5em] outline-none"
              />

              {message && (
                <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-center text-sm text-slate-300">
                  {message}
                </div>
              )}

              <button
                disabled={loading}
                className="h-12 w-full rounded-xl bg-cyan-400 font-semibold text-slate-950 disabled:opacity-50"
              >
                {loading ? "Verifying..." : "Verify Login OTP"}
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

export default function LoginOtp() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
          Loading...
        </main>
      }
    >
      <LoginOtpForm />
    </Suspense>
  );
}
