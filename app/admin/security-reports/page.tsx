"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type EventRow = {
  createdAt: string | null;
  eventType: string;
  action: string;
  success: boolean | null;
  riskLevel: unknown;
  decision: unknown;
  riskScore: unknown;
};

type Report = {
  generatedAt: string;
  stats: {
    total: number;
    failures: number;
    otpFailures: number;
    honeypotEvents: number;
    riskEvaluations: number;
  };
  events: EventRow[];
};

function dateLabel(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export default function AdminSecurityReportsPage() {
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/");
        return;
      }

      const response = await fetch("/api/admin/security-reports?limit=50", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const result = await response.json();

      if (response.status === 401) {
        router.replace("/");
        return;
      }
      if (response.status === 403) {
        setError("यह पेज केवल अधिकृत Admin के लिए है।");
        return;
      }
      if (!response.ok || !result.success) {
        throw new Error(result.error || "रिपोर्ट लोड नहीं हो सकी।");
      }

      setReport(result as Report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "रिपोर्ट लोड नहीं हो सकी।");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const cards = report ? [
    ["कुल सिक्योरिटी रिकॉर्ड", report.stats.total],
    ["Failure रिकॉर्ड", report.stats.failures],
    ["OTP Failure", report.stats.otpFailures],
    ["Honeypot घटनाएँ", report.stats.honeypotEvents],
    ["Risk Evaluations", report.stats.riskEvaluations],
  ] as const : [];

  return (
    <main className="mx-auto min-h-screen max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-gray-500">Ultima Lite · Admin</p>
          <h1 className="text-2xl font-bold">Security Reports</h1>
          <p className="mt-1 text-sm text-gray-600">
            मौजूदा सुरक्षा लॉग और हाल की घटनाएँ।
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/dashboard" className="rounded-lg border px-4 py-2">
            Dashboard
          </Link>
          <button
            onClick={() => void loadReport()}
            disabled={loading}
            className="rounded-lg bg-black px-4 py-2 text-white disabled:opacity-50"
          >
            {loading ? "लोड हो रहा है…" : "Refresh"}
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-red-300 p-4 text-red-700">
          {error}
        </p>
      )}
      {loading && <p>रिपोर्ट लोड हो रही है…</p>}

      {!loading && report && (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map(([label, value]) => (
              <article key={label} className="rounded-xl border p-4">
                <p className="text-sm text-gray-500">{label}</p>
                <p className="mt-2 text-3xl font-semibold tabular-nums">
                  {value.toLocaleString()}
                </p>
              </article>
            ))}
          </section>

          <section className="overflow-hidden rounded-xl border">
            <div className="border-b p-4">
              <h2 className="font-semibold">हाल की घटनाएँ</h2>
              <p className="mt-1 text-xs text-gray-500">
                अपडेट: {dateLabel(report.generatedAt)}
              </p>
            </div>
            {report.events.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">कोई रिकॉर्ड नहीं मिला।</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-left text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="p-3">समय</th>
                      <th className="p-3">घटना</th>
                      <th className="p-3">Action</th>
                      <th className="p-3">स्थिति</th>
                      <th className="p-3">Risk</th>
                      <th className="p-3">Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.events.map((event, index) => (
                      <tr key={`${event.createdAt}-${index}`} className="border-t">
                        <td className="whitespace-nowrap p-3">
                          {dateLabel(event.createdAt)}
                        </td>
                        <td className="p-3">{event.eventType || "—"}</td>
                        <td className="p-3">{event.action || "—"}</td>
                        <td className="p-3">
                          {event.success === true ? "Success" :
                            event.success === false ? "Failure" : "Unknown"}
                        </td>
                        <td className="p-3">
                          {String(event.riskLevel ?? event.riskScore ?? "—")}
                        </td>
                        <td className="p-3">{String(event.decision ?? "—")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <p className="text-xs text-gray-500">
            Failure रिकॉर्ड अपने-आप में हमलों की संख्या नहीं बताते।
          </p>
        </>
      )}
    </main>
  );
}
