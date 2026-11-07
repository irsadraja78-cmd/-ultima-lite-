"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";

type ScreenLightSettings = {
  screen_light_locker_enabled: boolean;
  person_detection_enabled: boolean;
  second_person_lock_enabled: boolean;
  screen_lock_delay_seconds: number;
};

export default function ScreenLightLocker() {
  const [settings, setSettings] = useState<ScreenLightSettings | null>(null);
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lockTimerRef = useRef<number | null>(null);
  const detectorRef = useRef<FaceDetector | null>(null);

  function lockScreen() {
    setPassword("");
    setError("");
    setLocked(true);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
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

        if (!response.ok) return;

        const data = await response.json();

        if (!cancelled && data?.success && data?.settings) {
          setSettings({
            screen_light_locker_enabled:
              data.settings.screen_light_locker_enabled === true,
            person_detection_enabled:
              data.settings.person_detection_enabled === true,
            second_person_lock_enabled:
              data.settings.second_person_lock_enabled !== false,
            screen_lock_delay_seconds:
              Number(data.settings.screen_lock_delay_seconds) || 0,
          });
        }
      } catch {
        // Screen Light Locker remains disabled if settings cannot be loaded.
      }
    }

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (
      !settings?.screen_light_locker_enabled ||
      !settings.person_detection_enabled
    ) {
      return;
    }

    let cancelled = false;

    async function startCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) return;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        // Camera permission/detection availability must not break the workboard.
      }
    }

    void startCamera();

    return () => {
      cancelled = true;

      if (lockTimerRef.current !== null) {
        window.clearTimeout(lockTimerRef.current);
        lockTimerRef.current = null;
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [settings]);

  useEffect(() => {
    if (
      !settings?.screen_light_locker_enabled ||
      !settings.person_detection_enabled
    ) {
      return;
    }

    let cancelled = false;
    let animationFrame = 0;

    async function startDetection() {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm"
        );

        const detector = await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "/models/face_detector.tflite",
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          minDetectionConfidence: 0.5,
        });

        if (cancelled) {
          detector.close();
          return;
        }

        detectorRef.current = detector;
        const detectionSettings = settings ?? {
          second_person_lock_enabled: true,
          screen_lock_delay_seconds: 0,
        };

        const checkFrame = () => {
          if (cancelled) return;

          const video = videoRef.current;

          if (
            video &&
            video.readyState >= 2 &&
            video.videoWidth > 0 &&
            video.videoHeight > 0
          ) {
            const result = detector.detectForVideo(video, performance.now());
            const faceCount = result.detections?.length ?? 0;

            const shouldLock =
              faceCount === 0 ||
              (detectionSettings.second_person_lock_enabled && faceCount >= 2);

            if (shouldLock) {
              if (lockTimerRef.current === null) {
                const delay =
                  Math.max(0, detectionSettings.screen_lock_delay_seconds) * 1000;

                if (delay === 0) {
                  lockScreen();
                } else {
                  lockTimerRef.current = window.setTimeout(() => {
                    lockTimerRef.current = null;
                    lockScreen();
                  }, delay);
                }
              }
            } else if (lockTimerRef.current !== null) {
              window.clearTimeout(lockTimerRef.current);
              lockTimerRef.current = null;
            }
          }

          animationFrame = window.requestAnimationFrame(checkFrame);
        };

        animationFrame = window.requestAnimationFrame(checkFrame);
      } catch (error) {
        console.error("SCREEN LIGHT FACE DETECTION ERROR:", error);
      }
    }

    void startDetection();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);

      if (lockTimerRef.current !== null) {
        window.clearTimeout(lockTimerRef.current);
        lockTimerRef.current = null;
      }

      detectorRef.current?.close();
      detectorRef.current = null;
    };
  }, [settings]);

  useEffect(() => {
    if (!settings?.screen_light_locker_enabled) return;

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        lockScreen();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [settings]);

  async function unlockScreen(event: React.FormEvent) {
    event.preventDefault();

    if (!password || unlocking) return;

    setUnlocking(true);
    setError("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setError("Session expired. Please sign in again.");
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
        setError(data?.error || "Incorrect password.");
        setPassword("");
        return;
      }

      setLocked(false);
      setPassword("");
      setError("");
    } catch {
      setError("Unable to unlock screen.");
    } finally {
      setUnlocking(false);
    }
  }

  if (!settings?.screen_light_locker_enabled && !locked) {
    return null;
  }

  return (
    <>
      <video
        ref={videoRef}
        muted
        playsInline
        aria-hidden="true"
        className="pointer-events-none fixed -left-[9999px] top-0 h-px w-px opacity-0"
      />

      {locked && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black"
          role="dialog"
          aria-modal="true"
          aria-label="Screen locked"
        >
          <div className="mx-4 w-full max-w-md rounded-2xl border border-white/10 bg-slate-950 p-6 text-center text-white shadow-2xl">
            <h2 className="text-xl font-semibold">Screen Locked</h2>

            <p className="mt-2 text-sm text-white/70">
              Screen Light Locker detected that the screen was left or
              visibility changed.
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

              {error && (
                <p className="text-sm text-red-400">{error}</p>
              )}

              <button
                type="submit"
                disabled={!password || unlocking}
                className="h-12 w-full rounded-lg bg-white px-5 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
              >
                {unlocking ? "Unlocking..." : "Unlock Screen"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
