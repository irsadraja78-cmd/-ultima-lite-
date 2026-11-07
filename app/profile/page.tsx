"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function ProfilePage() {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [selectedPreview, setSelectedPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  async function loadPhoto() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setLoading(false);
      return;
    }

    const response = await fetch("/api/profile-photo", {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      cache: "no-store",
    });

    const data = await response.json();

    if (response.ok && data.success) {
      setPhotoUrl(data.photo_url || null);
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadPhoto(); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] || null;

    setFile(selected);
    setMessage("");

    if (!selected) {
      setSelectedPreview(null);
      return;
    }

    const previewUrl = URL.createObjectURL(selected);
    setSelectedPreview((oldUrl) => {
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      return previewUrl;
    });
  }

  async function uploadPhoto() {
    if (!file || uploading) return;

    setUploading(true);
    setMessage("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setMessage("Please sign in again.");
        return;
      }

      const formData = new FormData();
      formData.append("photo", file);

      const response = await fetch("/api/profile-photo", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setMessage(data.error || "Unable to save photo.");
        return;
      }

      setFile(null);

      setSelectedPreview((oldUrl) => {
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        return null;
      });

      setMessage("Current Profile Photo saved.");
      await loadPhoto();
    } catch {
      setMessage("Unable to upload photo.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="min-h-screen bg-black px-5 py-10 text-white">
      <div className="mx-auto max-w-xl">
        <a
          href="/dashboard"
          className="text-sm text-white/60 hover:text-white"
        >
          ← Dashboard
        </a>

        <div className="mt-8 rounded-2xl border border-white/10 bg-slate-950 p-6">
          <h1 className="text-2xl font-semibold">My Profile</h1>

          <p className="mt-2 text-sm text-white/60">
            Add your Current Profile Photo before enabling person detection.
          </p>

          <div className="mt-8 flex flex-col items-center">
            <div className="flex h-40 w-40 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-slate-900">
              {selectedPreview || photoUrl ? (
                <img
                  src={selectedPreview || photoUrl || ""}
                  alt="Current Profile Photo"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="px-4 text-center text-sm text-white/40">
                  No profile photo
                </span>
              )}
            </div>

            <label className="mt-6 cursor-pointer rounded-lg border border-white/20 px-5 py-3 text-sm font-medium hover:bg-white/10">
              {photoUrl ? "Change Current Photo" : "Upload Current Photo"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={selectPhoto}
                className="hidden"
              />
            </label>

            {file && (
              <p className="mt-3 text-sm text-white/60">
                Selected: {file.name}
              </p>
            )}

            <button
              type="button"
              onClick={uploadPhoto}
              disabled={!file || uploading}
              className="mt-4 rounded-lg bg-white px-6 py-3 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              {uploading ? "Saving..." : "Save Current Photo"}
            </button>

            {message && (
              <p className="mt-4 text-center text-sm text-white/70">
                {message}
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
