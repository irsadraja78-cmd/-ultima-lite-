"use client";

import { useRouter } from "next/navigation";

export default function SubscriptionRequiredPage() {
  const router = useRouter();

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-white">
      <div className="mx-auto flex min-h-[80vh] max-w-xl items-center justify-center">
        <div className="w-full rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center shadow-2xl">
          <div className="text-3xl font-bold">
            Ultima<span className="text-cyan-400"> Lite</span>
          </div>

          <div className="mt-8 text-xs font-medium tracking-[0.25em] text-cyan-400">
            SUBSCRIPTION REQUIRED
          </div>

          <h1 className="mt-3 text-2xl font-bold">
            Your free trial has ended
          </h1>

          <p className="mt-3 text-sm leading-6 text-slate-400">
            Your 48-hour free trial is no longer active. A subscription will
            be required to continue using the Ultima Lite workspace.
          </p>

          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="mt-7 rounded-xl border border-white/10 bg-white/10 px-5 py-3 text-sm font-semibold hover:bg-white/15"
          >
            Check Account
          </button>
        </div>
      </div>
    </main>
  );
}
