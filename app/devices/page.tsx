"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getDeviceInfo } from "@/lib/client/device";

type Device = {
  id: string;
  device_fingerprint: string;
  device_name: string | null;
  device_type: string | null;
  browser: string | null;
  operating_system: string | null;
  first_ip_address: string | null;
  last_ip_address: string | null;
  first_seen_at: string;
  last_seen_at: string;
  is_trusted: boolean;
  is_active: boolean;
  trusted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

function formatDate(value: string | null) {
  if (!value) return "—";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function DevicesPage() {
  const router = useRouter();

  const [devices, setDevices] = useState<Device[]>([]);
  const [currentFingerprint, setCurrentFingerprint] = useState("");
  const [loading, setLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const [securitySettings, setSecuritySettings] = useState({
    timing_locker_enabled: true,
    timing_timeout_minutes: 10,
    screen_light_locker_enabled: false,
    person_detection_enabled: false,
    second_person_lock_enabled: true,
    screen_lock_delay_seconds: 0,
  });

  const [securitySaving, setSecuritySaving] = useState(false);
  const [securityMessage, setSecurityMessage] = useState("");

  const loadDevices = useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        router.push("/");
        return;
      }

      const deviceInfo = await getDeviceInfo();
      setCurrentFingerprint(deviceInfo.fingerprint);

      const response = await fetch("/api/devices/list", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setMessage(data.error || "Unable to load devices");
        return;
      }

      setDevices(data.devices || []);
    } catch (error) {
      console.error("LOAD_DEVICES_ERROR", error);
      setMessage("Unable to load trusted devices");
    } finally {
      setLoading(false);
    }
  }, [router]);

  async function revokeDevice(deviceId: string) {
    const confirmed = window.confirm(
      "Are you sure you want to revoke this device?"
    );

    if (!confirmed) return;

    setRevokingId(deviceId);
    setMessage("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        router.push("/");
        return;
      }

      const response = await fetch("/api/devices/revoke", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ deviceId }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setMessage(data.error || "Unable to revoke device");
        return;
      }

      setMessage("Device revoked successfully.");
      await loadDevices();
    } catch (error) {
      console.error("REVOKE_DEVICE_ERROR", error);
      setMessage("Unable to revoke device");
    } finally {
      setRevokingId(null);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDevices();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadDevices]);

  useEffect(() => {
    async function loadSecuritySettings() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.access_token) return;

        const response = await fetch("/api/security/locker-settings", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          cache: "no-store",
        });

        const data = await response.json();

        if (response.ok) {
          setSecuritySettings((current) => ({
            ...current,
            ...(data.settings || data),
          }));
        }
      } catch (error) {
        console.error("LOAD_SECURITY_SETTINGS_ERROR", error);
      }
    }

    void loadSecuritySettings();
  }, []);

  async function saveSecuritySettings() {
    setSecuritySaving(true);
    setSecurityMessage("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        router.push("/");
        return;
      }

      const response = await fetch("/api/security/locker-settings", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(securitySettings),
      });

      const data = await response.json();

      if (!response.ok) {
        setSecurityMessage(data.error || "Unable to save security settings.");
        return;
      }

      setSecuritySettings((current) => ({
        ...current,
        ...(data.settings || data),
      }));

      setSecurityMessage("Security settings saved.");
    } catch (error) {
      console.error("SAVE_SECURITY_SETTINGS_ERROR", error);
      setSecurityMessage("Unable to save security settings.");
    } finally {
      setSecuritySaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-blue-400">
              Security
            </p>

            <h1 className="mt-1 text-3xl font-bold">
              Trusted Devices
            </h1>

            <p className="mt-2 text-sm text-slate-400">
              Manage devices that have accessed your Ultima account.
            </p>
          </div>

          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-900"
          >
            Back to Dashboard
          </button>
        </div>

        {message && (
          <div className="mb-6 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-200">
            {message}
          </div>
        )}

        <section id="security" className="mb-8 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg">
          <div className="mb-5">
            <p className="text-sm font-medium text-blue-400">Settings</p>
            <h2 className="mt-1 text-2xl font-bold">Security & Mobile Access</h2>
            <p className="mt-2 text-sm text-slate-400">
              Manage device access and screen security from one place.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
              <h3 className="font-semibold">Timing Locker</h3>
              <p className="mt-1 text-xs text-slate-500">
                Lock the screen after inactivity.
              </p>

              <label className="mt-4 flex items-center justify-between gap-3 text-sm">
                <span>Enable Timing Locker</span>
                <input
                  type="checkbox"
                  checked={securitySettings.timing_locker_enabled}
                  onChange={(e) =>
                    setSecuritySettings((v) => ({
                      ...v,
                      timing_locker_enabled: e.target.checked,
                    }))
                  }
                  className="h-5 w-5"
                />
              </label>

              <label className="mt-4 block text-sm">
                Timeout
                <select
                  value={securitySettings.timing_timeout_minutes}
                  onChange={(e) =>
                    setSecuritySettings((v) => ({
                      ...v,
                      timing_timeout_minutes: Number(e.target.value),
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2"
                >
                  {[2, 3, 4, 5, 10, 15, 20, 30, 60].map((m) => (
                    <option key={m} value={m}>
                      {m} minutes
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
              <h3 className="font-semibold">Screen Light Locker</h3>
              <p className="mt-1 text-xs text-slate-500">
                Hide the screen when the configured security condition occurs.
              </p>

              <label className="mt-4 flex items-center justify-between gap-3 text-sm">
                <span>Enable Screen Light Locker</span>
                <input
                  type="checkbox"
                  checked={securitySettings.screen_light_locker_enabled}
                  onChange={(e) =>
                    setSecuritySettings((v) => ({
                      ...v,
                      screen_light_locker_enabled: e.target.checked,
                    }))
                  }
                  className="h-5 w-5"
                />
              </label>

              <label className="mt-4 flex items-center justify-between gap-3 text-sm">
                <span>Person Detection</span>
                <input
                  type="checkbox"
                  checked={securitySettings.person_detection_enabled}
                  onChange={(e) =>
                    setSecuritySettings((v) => ({
                      ...v,
                      person_detection_enabled: e.target.checked,
                    }))
                  }
                  className="h-5 w-5"
                />
              </label>

              <label className="mt-4 flex items-center justify-between gap-3 text-sm">
                <span>Lock for second person</span>
                <input
                  type="checkbox"
                  checked={securitySettings.second_person_lock_enabled}
                  onChange={(e) =>
                    setSecuritySettings((v) => ({
                      ...v,
                      second_person_lock_enabled: e.target.checked,
                    }))
                  }
                  className="h-5 w-5"
                />
              </label>

              <label className="mt-4 block text-sm">
                Lock delay
                <select
                  value={securitySettings.screen_lock_delay_seconds}
                  onChange={(e) =>
                    setSecuritySettings((v) => ({
                      ...v,
                      screen_lock_delay_seconds: Number(e.target.value),
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2"
                >
                  {[0, 1, 2, 3, 5, 10, 15, 30, 60].map((s) => (
                    <option key={s} value={s}>
                      {s === 0 ? "Immediate" : `${s} seconds`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={saveSecuritySettings}
              disabled={securitySaving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {securitySaving ? "Saving..." : "Save Security Settings"}
            </button>

            <button
              type="button"
              onClick={() => router.push("/profile")}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200"
            >
              Current Profile Photo
            </button>

            <button
              type="button"
              onClick={() => router.push("/files")}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200"
            >
              File Access / Download
            </button>
          </div>

          {securityMessage && (
            <p className="mt-3 text-sm text-slate-300">{securityMessage}</p>
          )}

          <p className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300">
            File opening and downloading continue to require the existing File
            Access OTP. These settings do not bypass File OTP security.
          </p>
        </section>


        {loading ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-8 text-center text-slate-400">
            Loading devices...
          </div>
        ) : devices.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-8 text-center text-slate-400">
            No registered devices found.
          </div>
        ) : (
          <div className="space-y-4">
            {devices.map((device) => {
              const isCurrent =
                !!currentFingerprint &&
                device.device_fingerprint === currentFingerprint;

              return (
                <section
                  key={device.id}
                  className="rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-lg"
                >
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold">
                          {device.device_name || "Unknown Device"}
                        </h2>

                        {isCurrent && (
                          <span className="rounded-full bg-blue-500/15 px-2.5 py-1 text-xs font-semibold text-blue-400">
                            Current Device
                          </span>
                        )}

                        {device.is_trusted && device.is_active && (
                          <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
                            Trusted
                          </span>
                        )}

                        {!device.is_active && (
                          <span className="rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-400">
                            Revoked
                          </span>
                        )}

                        {device.is_active && !device.is_trusted && (
                          <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-400">
                            Active
                          </span>
                        )}
                      </div>

                      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                        <div>
                          <p className="text-slate-500">Device Type</p>
                          <p className="text-slate-200">
                            {device.device_type || "—"}
                          </p>
                        </div>

                        <div>
                          <p className="text-slate-500">Browser</p>
                          <p className="text-slate-200">
                            {device.browser || "—"}
                          </p>
                        </div>

                        <div>
                          <p className="text-slate-500">Operating System</p>
                          <p className="text-slate-200">
                            {device.operating_system || "—"}
                          </p>
                        </div>

                        <div>
                          <p className="text-slate-500">Last IP</p>
                          <p className="break-all text-slate-200">
                            {device.last_ip_address || "—"}
                          </p>
                        </div>

                        <div>
                          <p className="text-slate-500">First Seen</p>
                          <p className="text-slate-200">
                            {formatDate(device.first_seen_at)}
                          </p>
                        </div>

                        <div>
                          <p className="text-slate-500">Last Seen</p>
                          <p className="text-slate-200">
                            {formatDate(device.last_seen_at)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0">
                      {device.is_active && !isCurrent ? (
                        <button
                          type="button"
                          disabled={revokingId === device.id}
                          onClick={() => revokeDevice(device.id)}
                          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-400 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {revokingId === device.id
                            ? "Revoking..."
                            : "Revoke Device"}
                        </button>
                      ) : isCurrent && device.is_active ? (
                        <span className="text-xs text-slate-500">
                          Current device
                        </span>
                      ) : null}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
