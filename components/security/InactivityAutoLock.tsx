"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type InactivityAutoLockProps = {
  timeoutMs?: number;
  warningMs?: number;
  onLock?: () => void;
};

type LockerSettings = {
  timing_locker_enabled: boolean;
  timing_timeout_minutes: number;
};

export default function InactivityAutoLock({
  timeoutMs,
  warningMs = 30 * 1000,
  onLock,
}: InactivityAutoLockProps) {
  const [settings, setSettings] = useState<LockerSettings | null>(null);
  const [locked, setLocked] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState("");
  const lastActivityRef = useRef(0);
  const lockedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.access_token) return;

        const response = await fetch("/api/security/locker-settings", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });

        if (!response.ok) return;

        const data = await response.json();

        if (!cancelled && data?.success && data?.settings) {
          setSettings({
            timing_locker_enabled:
              data.settings.timing_locker_enabled === true,
            timing_timeout_minutes:
              Number(data.settings.timing_timeout_minutes) || 10,
          });
        }
      } catch {
        if (!cancelled) {
          setSettings({
            timing_locker_enabled: true,
            timing_timeout_minutes: 10,
          });
        }
      }
    };

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (settings === null || !settings.timing_locker_enabled) return;

    const effectiveTimeoutMs =
      timeoutMs ?? settings.timing_timeout_minutes * 60 * 1000;

    lastActivityRef.current = Date.now();

    const markActivity = () => {
      if (lockedRef.current) return;
      lastActivityRef.current = Date.now();
      setShowWarning(false);
    };

    const events = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "touchmove",
      "scroll",
      "pointermove",
    ] as const;

    events.forEach((event) =>
      window.addEventListener(event, markActivity, { passive: true }),
    );

    const timer = window.setInterval(() => {
      if (lockedRef.current) return;

      const idleFor = Date.now() - lastActivityRef.current;

      if (idleFor >= effectiveTimeoutMs) {
        lockedRef.current = true;
        setShowWarning(false);
        setLocked(true);
        setUnlockError("");
        setPassword("");
        onLock?.();

        void (async () => {
          const {
            data: { session },
          } = await supabase.auth.getSession();

          if (session?.access_token) {
            try {
              await fetch("/api/security/inactivity-lock", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${session.access_token}`,
                },
              });
            } catch {
              // Local lock continues if audit logging fails.
            }
          }
        })();

        return;
      }

      setShowWarning(
        idleFor >= Math.max(0, effectiveTimeoutMs - warningMs),
      );
    }, 1000);

    return () => {
      window.clearInterval(timer);
      events.forEach((event) =>
        window.removeEventListener(event, markActivity),
      );
    };
  }, [settings, timeoutMs, warningMs, onLock]);

  async function unlockScreen(event: React.FormEvent) {
    event.preventDefault();

    if (!password || unlocking) return;

    setUnlocking(true);
    setUnlockError("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setUnlockError("Session expired. Please sign in again.");
        return;
      }

      const response = await fetch("/api/security/locker-unlock", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (!response.ok || !data?.success) {
        setUnlockError(data?.error || "Incorrect password.");
        setPassword("");
        return;
      }

      lockedRef.current = false;
      lastActivityRef.current = Date.now();
      setPassword("");
      setUnlockError("");
      setLocked(false);
      setShowWarning(false);
    } catch {
      setUnlockError("Unable to unlock screen.");
    } finally {
      setUnlocking(false);
    }
  }

  if (!locked && !showWarning) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black"
      role="dialog"
      aria-modal="true"
      aria-label={locked ? "Screen locked" : "Inactivity warning"}
    >
      <div className="mx-4 w-full max-w-md rounded-2xl border border-white/10 bg-slate-950 p-6 text-center text-white shadow-2xl">
        {locked ? (
          <>
            <h2 className="text-xl font-semibold">Screen Locked</h2>

            <p className="mt-2 text-sm text-white/70">
              Your screen was locked because of inactivity.
            </p>

            <form onSubmit={unlockScreen} className="mt-5 space-y-3">
              <input
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                className="h-12 w-full rounded-lg border border-white/10 bg-slate-900 px-4 text-center text-white outline-none"
              />

              {unlockError && (
                <p className="text-sm text-red-400">{unlockError}</p>
              )}

              <button
                type="submit"
                disabled={!password || unlocking}
                className="h-12 w-full rounded-lg bg-white px-5 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
              >
                {unlocking ? "Unlocking..." : "Unlock Screen"}
              </button>
            </form>
          </>
        ) : (
          <>
            <h2 className="text-xl font-semibold">Inactivity Warning</h2>
            <p className="mt-2 text-sm text-white/70">
              Your screen will lock shortly due to inactivity.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
