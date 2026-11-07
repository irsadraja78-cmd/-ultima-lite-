"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { signOutAndClearSession } from "@/lib/client/auth";

const categories = [
  "Basic Data Entry",
  "Excel Data Entry",
  "Copy & Paste",
  "Web Research",
  "PDF Data Entry",
  "Image Data Entry",
  "Document Processing",
  "Medical Data Entry",
  "Product Data Entry",
  "Data Cleaning",
  "Data Conversion",
  "AI Assisted Data Entry",
];



export default function Dashboard() {
  const router = useRouter();

  const [authChecking, setAuthChecking] = useState(true);
  const [userEmail, setUserEmail] = useState("");
  const [activeCategory, setActiveCategory] = useState(categories[0]);
  const [dashboardStats, setDashboardStats] = useState({
    active: 0,
    completed: 0,
    saved: 0,
    total: 0,
  });
  const [recentFiles, setRecentFiles] = useState<
    Array<{
      id: string;
      file_name: string;
      category: string;
      status: string | null;
      updated_at: string;
    }>
  >([]);
  const [dashboardLoading, setDashboardLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function checkAuth() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;

      if (!session) {
        router.replace("/");
        return;
      }

      setUserEmail(session.user.email || "");

      try {
        const response = await fetch("/api/dashboard/summary", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          cache: "no-store",
        });

        const result = await response.json();

        if (mounted && response.ok && result.success) {
          setDashboardStats({
            active: Number(result.stats?.active || 0),
            completed: Number(result.stats?.completed || 0),
            saved: Number(result.stats?.saved || 0),
            total: Number(result.stats?.total || 0),
          });

          setRecentFiles(
            Array.isArray(result.recentFiles) ? result.recentFiles : []
          );
        }
      } catch (error) {
        console.error("DASHBOARD SUMMARY LOAD ERROR:", error);
      } finally {
        if (mounted) {
          setDashboardLoading(false);
          setAuthChecking(false);
        }
      }
    }

    void checkAuth();

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
        <div className="rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-sm text-slate-400">
          Verifying secure session...
        </div>
      </main>
    );
  }

  const stats = [
    {
      label: "Active",
      value: dashboardLoading ? "—" : String(dashboardStats.active),
      icon: "⚡",
    },
    {
      label: "Completed",
      value: dashboardLoading ? "—" : String(dashboardStats.completed),
      icon: "✓",
    },
    {
      label: "Saved Files",
      value: dashboardLoading ? "—" : String(dashboardStats.saved),
      icon: "▣",
    },
    {
      label: "Total Files",
      value: dashboardLoading ? "—" : String(dashboardStats.total),
      icon: "↗",
    },
  ];

  const selectedIndex = categories.indexOf(activeCategory);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      {/* HEADER */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              aria-label="Go back"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-lg text-slate-300 hover:bg-white/10 hover:text-white"
            >
              ←
            </button>

            <div>
              <div className="text-base font-bold tracking-tight">
                Ultima<span className="text-cyan-400"> Lite</span>
              </div>
              <div className="hidden text-[10px] uppercase tracking-[0.18em] text-slate-600 sm:block">
                Series 01 · Workspace
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/notifications"
              aria-label="Notifications"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm text-slate-300 hover:bg-white/10"
            >
              ♢
            </Link>

            <div className="hidden max-w-48 truncate rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-400 sm:block">
              {userEmail || "Authenticated user"}
            </div>

            <button
              type="button"
              onClick={async () => {
                await signOutAndClearSession();
                router.replace("/");
              }}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 hover:border-red-400/30 hover:bg-red-400/10 hover:text-red-300"
            >
              Sign out
            </button>

            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-400 text-sm font-bold text-slate-950">
              {(userEmail || "U").charAt(0).toUpperCase()}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8">
        {/* WELCOME */}
        <section>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-400">
            Welcome back
          </div>

          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
            Your Workspace
          </h1>

          <p className="mt-1 max-w-xl text-sm text-slate-500">
            Manage your data-entry work from one place.
          </p>
        </section>

        {/* COMPACT STATS */}
        <section className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-3 sm:px-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500">
                  {stat.label}
                </span>
                <span className="text-xs text-cyan-400">{stat.icon}</span>
              </div>

              <div className="mt-1 text-xl font-bold sm:text-2xl">
                {stat.value}
              </div>
            </div>
          ))}
        </section>

        {/* CATEGORY SHORTCUTS */}
        <section className="mt-6">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-lg font-semibold">Work Categories</h2>
              <p className="mt-1 text-xs text-slate-500">
                Choose a category to open its protected lockers.
              </p>
            </div>

            <span className="text-[10px] uppercase tracking-wider text-slate-600">
              12 categories
            </span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {categories.map((category, index) => {
              const selected = category === activeCategory;

              return (
                <Link
                  key={category}
                  href={`/files?category=${encodeURIComponent(category)}`}
                  className="rounded-xl border border-white/10 bg-white/[0.025] p-3 text-left transition hover:border-cyan-400/30 hover:bg-cyan-400/[0.05]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold text-slate-600">
                      {String(index + 1).padStart(2, "0")}
                    </span>

                    <span className="text-xs text-slate-700">
                      →
                    </span>
                  </div>

                  <div className="mt-2 text-xs font-medium leading-4 text-slate-300">
                    {category}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

      </div>
            <div className="mt-6 flex justify-center">
          <a
            href="/profile"
            className="rounded-lg border border-white/10 bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-800"
          >
            My Profile · Current Photo
          </a>
        </div>
</main>
  );
}
