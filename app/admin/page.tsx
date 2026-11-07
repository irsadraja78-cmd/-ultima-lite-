"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Stats = {
  users: number | null;
  usersNote: string | null;
  userFiles: number | null;
  workFiles: number | null;
  securityEvents: number | null;
};

type Overview = {
  success: boolean;
  role?: string;
  generatedAt?: string;
  stats?: Stats;
  unavailable?: string[];
  error?: string;
};

const tiles = [
  { key: "users", label: "रजिस्टर्ड यूज़र", icon: "👥" },
  { key: "userFiles", label: "अपलोड की गई फ़ाइलें", icon: "📁" },
  { key: "workFiles", label: "वर्क फ़ाइलें", icon: "🗂️" },
  { key: "securityEvents", label: "सिक्योरिटी इवेंट", icon: "🛡️" },
] as const;

function displayNumber(value: number | null | undefined) {
  return typeof value === "number" ? value.toLocaleString("en-IN") : "उपलब्ध नहीं";
}

export default function AdminPage() {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

      if (sessionError || !sessionData.session) {
        router.replace("/");
        return;
      }

      const response = await fetch("/api/admin/overview", {
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        cache: "no-store",
      });

      const result = (await response.json()) as Overview;

      if (response.status === 401) {
        router.replace("/");
        return;
      }

      if (response.status === 403) {
        setData(null);

        if ("code" in result && result.code === "ADMIN_PASSKEY_REQUIRED") {
          setError("Admin भूमिका सत्यापित है, लेकिन इस सत्र में Passkey verification आवश्यक है। नीचे Login या पहली बार Setup चुनें।");
        } else {
          setError("इस खाते को Admin Dashboard की अनुमति नहीं है। केवल अधिकृत Admin या Super Admin खाता ही आगे बढ़ सकता है।");
        }

        return;
      }

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Dashboard डेटा लोड नहीं हो पाया।");
      }

      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "डेटा लोड करने में त्रुटि हुई।");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-7 sm:py-9">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.24em] text-cyan-400">
              ULTIMA LITE · PRIVATE ADMIN
            </p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Admin Dashboard
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              प्रशासन, फ़ाइल आँकड़े और सुरक्षा की निगरानी
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading || refreshing}
            className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-semibold hover:border-cyan-500 disabled:opacity-50"
          >
            {refreshing ? "रिफ्रेश हो रहा है…" : "↻ रिफ्रेश"}
          </button>
        </header>

        {error && (
          <section role="alert" className="mb-6 rounded-2xl border border-rose-800 bg-rose-950/50 p-5">
            <h2 className="font-semibold text-rose-300">Admin एक्सेस / डेटा समस्या</h2>
            <p className="mt-2 text-sm text-slate-300">{error}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void load(true)}
                className="rounded-lg bg-rose-900 px-4 py-2 text-sm font-semibold"
              >
                दोबारा कोशिश करें
              </button>
              <Link
                href="/admin/login"
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold"
              >
                Admin Passkey Login
              </Link>
              <Link
                href="/admin/signup"
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold"
              >
                पहली बार Passkey Setup
              </Link>
            </div>
          </section>
        )}

        <section className="mb-7 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-slate-400">Admin Console</p>
              <h2 className="mt-1 text-xl font-semibold">सिस्टम ओवरव्यू</h2>
            </div>
            <span className="rounded-full border border-cyan-800 bg-cyan-950/60 px-3 py-1 text-xs font-semibold text-cyan-300">
              {data?.role ? `भूमिका: ${data.role}` : loading ? "जाँच जारी है…" : "सत्यापन आवश्यक"}
            </span>
          </div>
          <p className="mt-3 text-sm text-slate-400">
            आँकड़े सर्वर के डेटाबेस से लिए जाते हैं। उपलब्ध न होने वाला डेटा शून्य के बजाय स्पष्ट दिखाया जाएगा।
          </p>
        </section>

        <section aria-label="वास्तविक सिस्टम आँकड़े" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {tiles.map((tile) => (
            <article key={tile.key} className="rounded-2xl border border-slate-800 bg-slate-900 p-5 transition hover:border-slate-600">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">{tile.label}</span>
                <span className="text-2xl" aria-hidden="true">{tile.icon}</span>
              </div>
              <p className="mt-5 text-3xl font-bold tabular-nums">
                {loading ? "…" : displayNumber(data?.stats?.[tile.key])}
              </p>
              {tile.key === "users" && data?.stats?.usersNote && (
                <p className="mt-2 text-xs text-amber-300">{data.stats.usersNote}</p>
              )}
            </article>
          ))}
        </section>

        {data?.unavailable && data.unavailable.length > 0 && (
          <p className="mt-5 rounded-xl border border-amber-800 bg-amber-950/30 p-4 text-sm text-amber-200">
            कुछ आँकड़े उपलब्ध नहीं हैं: {data.unavailable.join(", ")}। बाकी उपलब्ध आँकड़े ऊपर दिखाए गए हैं।
          </p>
        )}

        <section className="mt-8">
          <h2 className="mb-4 text-xl font-semibold">Admin टूल्स</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Link
              href="/admin/security-reports"
              className="group rounded-2xl border border-slate-800 bg-slate-900 p-5 transition hover:border-cyan-700 hover:bg-slate-900/80"
            >
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-cyan-950 text-xl">🛡️</span>
                <div>
                  <h3 className="font-semibold group-hover:text-cyan-300">Security Reports</h3>
                  <p className="mt-1 text-sm text-slate-400">सुरक्षा लॉग, विफल प्रयास और जोखिम घटनाएँ</p>
                </div>
                <span className="ml-auto text-slate-500">→</span>
              </div>
            </Link>
          </div>
        </section>

        <footer className="mt-10 border-t border-slate-800 pt-4 text-xs text-slate-500">
          {data?.generatedAt
            ? `आख़िरी अपडेट: ${new Date(data.generatedAt).toLocaleString("en-IN")}`
            : "डेटा सर्वर से सत्यापित होने के बाद अपडेट का समय दिखेगा।"}
        </footer>
      </div>
    </main>
  );
}
