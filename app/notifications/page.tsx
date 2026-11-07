"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Notification = Record<string, unknown> & {
  id?: string;
  title?: string;
  message?: string;
  created_at?: string;
};

export default function Notifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadNotifications() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          if (mounted) window.location.href = "/";
          return;
        }

        const response = await fetch("/api/notifications", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          cache: "no-store",
        });

        const result = await response.json();

        if (mounted && response.ok && result.success) {
          setNotifications(
            Array.isArray(result.notifications) ? result.notifications : []
          );
        }
      } catch (error) {
        console.error("NOTIFICATIONS LOAD ERROR:", error);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void loadNotifications();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-white md:p-10">
      <div className="mx-auto max-w-6xl">
        <Link href="/dashboard" className="text-sm text-cyan-400">
          ← Dashboard
        </Link>

        <h1 className="mt-6 text-3xl font-bold">Notifications</h1>

        <div className="mt-8 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
          {loading ? (
            <div className="p-6 text-sm text-slate-500">
              Loading notifications...
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-6 text-slate-400">
              No notifications yet.
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {notifications.map((item, index) => (
                <div key={String(item.id ?? index)} className="p-5">
                  <div className="text-sm font-semibold text-white">
                    {String(item.title ?? "Notification")}
                  </div>

                  <div className="mt-1 text-sm text-slate-400">
                    {String(item.message ?? "")}
                  </div>

                  {item.created_at && (
                    <div className="mt-2 text-[11px] text-slate-600">
                      {new Date(item.created_at).toLocaleString()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
