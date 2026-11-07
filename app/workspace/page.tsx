"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const workspaceCategories = [
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

type WorkFile = {
  id: string;
  file_name: string;
  category: string;
  status: string | null;
  updated_at: string;
};

export default function Workspace() {
  const router = useRouter();

  const [authChecking, setAuthChecking] = useState(true);
  const [userEmail, setUserEmail] = useState("");
  const [workFiles, setWorkFiles] = useState<WorkFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadWorkspace() {
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
        const response = await fetch("/api/files/list", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          cache: "no-store",
        });

        const data = await response.json();

        if (!mounted) return;

        if (!response.ok) {
          setLoadError(data?.error || "Unable to load work files.");
          return;
        }

        const files = Array.isArray(data?.files)
          ? data.files
          : [];

        const ownWorkFiles = files
          .filter(
            (file: WorkFile & { source?: string }) =>
              file.source === "work_file" &&
              file.status !== "Working"
          )
          .map((file: WorkFile & { source?: string }) => ({
            id: file.id,
            file_name: file.file_name,
            category: file.category,
            status: file.status,
            updated_at: file.updated_at,
          }));

        setWorkFiles(ownWorkFiles);
      } catch {
        if (mounted) {
          setLoadError("Unable to load work files.");
        }
      } finally {
        if (mounted) {
          setLoadingFiles(false);
          setAuthChecking(false);
        }
      }
    }

    void loadWorkspace();

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

  const workingCount = workFiles.filter(
    (file) => file.status === "Working"
  ).length;

  const savedCount = workFiles.filter(
    (file) => file.status === "Saved"
  ).length;

  const completedCount = workFiles.filter(
    (file) => file.status === "Completed"
  ).length;

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
    <main className="min-h-screen bg-slate-950 p-6 text-white md:p-10">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/dashboard"
            className="text-sm text-cyan-400 hover:text-cyan-300"
          >
            ← Dashboard
          </Link>

          <div className="text-xs text-slate-500">
            {userEmail}
          </div>
        </div>

        <section className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">Workspace</h1>
              <p className="mt-2 text-slate-400">
                Your secure work area for creating and continuing data-entry work.
              </p>
            </div>

            <Link
              href="/files?new=1"
              className="rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
            >
              + New Work File
            </Link>
          </div>
        </section>

        <section className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm text-slate-400">Working</div>
            <div className="mt-2 text-3xl font-bold">
              {workingCount}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm text-slate-400">Saved</div>
            <div className="mt-2 text-3xl font-bold">
              {savedCount}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm text-slate-400">Completed</div>
            <div className="mt-2 text-3xl font-bold">
              {completedCount}
            </div>
          </div>
        </section>

        <section className="mt-10">
          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.04] p-6">
            <div className="text-lg font-semibold">
              Work Files are protected by Category Lockers
            </div>
            <p className="mt-2 text-sm text-slate-500">
              Open a category below, unlock its Work Files Locker, and continue your work there.
            </p>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-semibold">
            Start Work by Category
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Select a category to view its files or create new work.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workspaceCategories.map((category) => (
              <Link
                key={category}
                href={`/files?category=${encodeURIComponent(category)}`}
                className="group rounded-2xl border border-white/10 bg-white/5 p-5 transition hover:border-cyan-400/40 hover:bg-white/[0.07]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-lg font-semibold">
                      {category}
                    </div>

                    <div className="mt-2 text-sm text-slate-500">
                      Open files and continue work
                    </div>
                  </div>

                  <span className="text-cyan-400 transition group-hover:translate-x-1">
                    →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-10 grid gap-4 md:grid-cols-2">
          <Link
            href="/files"
            className="rounded-2xl border border-white/10 bg-white/5 p-6 transition hover:border-cyan-400/40"
          >
            <div className="text-lg font-semibold">All Work Files</div>
            <div className="mt-2 text-sm text-slate-500">
              View source files and work files together.
            </div>
          </Link>

          <Link
            href="/work-history"
            className="rounded-2xl border border-white/10 bg-white/5 p-6 transition hover:border-cyan-400/40"
          >
            <div className="text-lg font-semibold">Work History</div>
            <div className="mt-2 text-sm text-slate-500">
              Review your previous work activity.
            </div>
          </Link>
        </section>
      </div>
    </main>
  );
}
