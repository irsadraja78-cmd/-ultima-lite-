"use client";

import Link from "next/link";
import { useState } from "react";

const mainItems = [
  ["Dashboard", "/dashboard"],
  ["Files", "/files"],
  ["Workspace", "/workspace"],
  ["Work History", "/work-history"],
  ["Messages", "/messages"],
  ["Notifications", "/notifications"],
] as const;

export default function AppSidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed left-3 top-3 z-50 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xl text-white shadow-lg"
        aria-label="Open sidebar"
      >
        ☰
      </button>

      {open && (
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/50"
        />
      )}

      <aside
        className={`fixed left-0 top-0 z-50 h-screen w-72 overflow-y-auto border-r border-slate-800 bg-slate-950 p-5 text-white shadow-2xl transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="text-lg font-bold">Ultima Lite</div>
            <div className="text-xs text-slate-400">
              Navigation & Settings
            </div>
          </div>

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg px-2 py-1 text-lg text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Close sidebar"
          >
            ✕
          </button>
        </div>

        <nav className="space-y-1">
          <div className="mb-2 mt-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Main
          </div>

          {mainItems.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2.5 text-sm text-slate-200 transition hover:bg-slate-800 hover:text-white"
            >
              {label}
            </Link>
          ))}

          <div className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Settings
          </div>

          <Link
            href="/profile"
            onClick={() => setOpen(false)}
            className="block rounded-lg px-3 py-2.5 text-sm text-slate-200 transition hover:bg-slate-800 hover:text-white"
          >
            👤 My Profile
          </Link>

          <Link
            href="/devices"
            onClick={() => setOpen(false)}
            className="block rounded-lg px-3 py-2.5 text-sm text-slate-200 transition hover:bg-slate-800 hover:text-white"
          >
            📱 Mobile & Devices
          </Link>

          <Link
            href="/devices#security"
            onClick={() => setOpen(false)}
            className="block rounded-lg px-3 py-2.5 text-sm text-slate-200 transition hover:bg-slate-800 hover:text-white"
          >
            🔐 Security
          </Link>

          <Link
            href="/files"
            onClick={() => setOpen(false)}
            className="block rounded-lg px-3 py-2.5 text-sm text-slate-200 transition hover:bg-slate-800 hover:text-white"
          >
            📁 File Access / Download
          </Link>
        </nav>

        <div className="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs leading-5 text-slate-400">
          File opening and downloading remain protected by the existing
          File Access OTP system.
        </div>
      </aside>
    </>
  );
}
