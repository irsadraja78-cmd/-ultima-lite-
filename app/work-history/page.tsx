"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type HistoryItem = Record<string, unknown>;

function textValue(
  item: HistoryItem,
  keys: string[],
  fallback = "—"
) {
  for (const key of keys) {
    const value = item[key];

    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ""
    ) {
      return String(value);
    }
  }

  return fallback;
}

export default function WorkHistory() {
  const router = useRouter();

  const [authChecking, setAuthChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadHistory() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!mounted) return;

        if (!session) {
          router.replace("/");
          return;
        }

        setAuthChecking(false);

        const response = await fetch("/api/work-history", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        const data = await response.json();

        if (!mounted) return;

        if (!response.ok) {
          setMessage(
            data?.error || "Unable to load work history."
          );
          setHistory([]);
          return;
        }

        setHistory(
          Array.isArray(data?.history)
            ? data.history
            : []
        );
      } catch {
        if (!mounted) return;

        setMessage("Unable to load work history.");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadHistory();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace("/");
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [router]);

  if (authChecking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="text-sm text-slate-400">
          Verifying secure session...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 p-5 text-white md:p-10">
      <div className="mx-auto max-w-6xl">

        <div className="flex items-center justify-between">
          <Link
            href="/dashboard"
            className="text-sm text-cyan-400 hover:text-cyan-300"
          >
            ← Dashboard
          </Link>

          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-400 font-semibold text-slate-950">
            U
          </div>
        </div>

        <div className="mt-8">
          <div className="text-xs font-semibold tracking-[0.2em] text-cyan-400">
            ACTIVITY
          </div>

          <h1 className="mt-2 text-3xl font-bold">
            Work History
          </h1>

          <p className="mt-2 text-sm text-slate-400">
            Your secure work activity and file history.
          </p>
        </div>

        {message && (
          <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-300">
            {message}
          </div>
        )}

        {loading ? (
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-slate-400">
            Loading work history...
          </div>
        ) : history.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
            <div className="text-3xl">◷</div>

            <h2 className="mt-4 text-lg font-semibold">
              No work history yet
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              Your completed and saved work activity will appear here.
            </p>

            <Link
              href="/files"
              className="mt-5 inline-flex rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950"
            >
              Open Files
            </Link>
          </div>
        ) : (
          <div className="mt-8 space-y-3">
            {history.map((item, index) => {
              const id = textValue(
                item,
                ["id"],
                String(index)
              );

              const title = textValue(
                item,
                [
                  "file_name",
                  "work_file_name",
                  "name",
                  "title",
                ],
                "Work File"
              );

              const category = textValue(
                item,
                ["category", "file_category"],
                "—"
              );

              const status = textValue(
                item,
                ["status", "action"],
                "Activity"
              );

              const createdAt = textValue(
                item,
                ["created_at", "completed_at", "updated_at"],
                ""
              );

              let dateText = "—";

              if (createdAt) {
                const date = new Date(createdAt);

                if (!Number.isNaN(date.getTime())) {
                  dateText = date.toLocaleString();
                } else {
                  dateText = createdAt;
                }
              }

              return (
                <div
                  key={id}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold">
                        {title}
                      </div>

                      <div className="mt-1 text-xs text-slate-500">
                        {category}
                      </div>

                      <div className="mt-2 text-xs text-slate-600">
                        {dateText}
                      </div>
                    </div>

                    <div className="shrink-0">
                      <span className="inline-flex rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-300">
                        {status}
                      </span>

                    </div>

                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </main>
  );
}
