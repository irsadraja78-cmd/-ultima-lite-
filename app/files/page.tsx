"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import { supabase } from "@/lib/supabase";

GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

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

type FileStatus = "Working" | "Saved" | "Completed";

type UserFile = {
  id: string;
  file_name: string;
  category: string;
  file_size: number | null;
  mime_type: string | null;
  status: FileStatus;
  updated_at: string;
  preview_url: string | null;
  source?: "user_file" | "work_file";
};

function PdfInlineViewer({
  url,
  fileName,
}: {
  url: string;
  fileName: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function renderPdf() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error("Unable to load PDF.");
        }

        const pdfData = await response.arrayBuffer();
        const pdf = await getDocument({ data: pdfData }).promise;

        if (cancelled || !containerRef.current) return;

        const container = containerRef.current;
        container.innerHTML = "";

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          if (cancelled) return;

          const page = await pdf.getPage(pageNumber);
          const baseViewport = page.getViewport({ scale: 1 });

          const availableWidth = Math.max(
            1,
            container.clientWidth - 24
          );

          const scale = Math.min(
            2,
            availableWidth / baseViewport.width
          );

          const viewport = page.getViewport({ scale });

          const wrapper = document.createElement("div");
          wrapper.className =
            "mb-4 flex justify-center overflow-hidden rounded-lg bg-white shadow-lg";

          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");

          if (!context) continue;

          const deviceScale = Math.min(
            window.devicePixelRatio || 1,
            2.5
          );

          canvas.width = Math.floor(viewport.width * deviceScale);
          canvas.height = Math.floor(viewport.height * deviceScale);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;

          context.setTransform(
            deviceScale,
            0,
            0,
            deviceScale,
            0,
            0
          );

          wrapper.appendChild(canvas);
          container.appendChild(wrapper);

          await page.render({
            canvas,
            canvasContext: context,
            viewport,
          }).promise;
        }

        if (!cancelled) setLoading(false);
      } catch (err) {
        console.error("PDF INLINE VIEWER ERROR:", err);

        if (!cancelled) {
          setLoading(false);
          setError(
            "PDF preview could not be displayed inside Ultima Lite."
          );
        }
      }
    }

    void renderPdf();

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) {
    return (
      <div className="flex min-h-[420px] items-center justify-center p-6 text-center">
        <div>
          <h3 className="font-semibold">PDF Preview Error</h3>
          <p className="mt-2 text-sm text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-[420px] bg-slate-200 p-3">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/80 text-sm text-white">
          Loading PDF inside Ultima Lite...
        </div>
      )}

      <div
        ref={containerRef}
        aria-label={`PDF preview: ${fileName}`}
        className="mx-auto max-w-full"
      />
    </div>
  );
}

function FilesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const requestedCategory = searchParams.get("category");

  const initialCategory =
    requestedCategory && categories.includes(requestedCategory)
      ? requestedCategory
      : categories[0];

  const [authChecking, setAuthChecking] = useState(true);
  const [activeCategory, setActiveCategory] = useState(initialCategory);
  const [categoryWorkspaceOpen, setCategoryWorkspaceOpen] = useState(
    Boolean(requestedCategory)
  );
  const [files, setFiles] = useState<UserFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<UserFile | null>(null);

  const [loadingFiles, setLoadingFiles] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [creatingWorkFile, setCreatingWorkFile] = useState(false);
  const [showLockerOtpModal, setShowLockerOtpModal] = useState(false);
  const [lockerType, setLockerType] = useState<"uploaded" | "work">("uploaded");
  const [lockerOtp, setLockerOtp] = useState("");
  const [lockerOtpBusy, setLockerOtpBusy] = useState(false);
  const [lockerOtpError, setLockerOtpError] = useState("");
  const [lockerOtpMessage, setLockerOtpMessage] = useState("");
  const [uploadedLockerUnlocked, setUploadedLockerUnlocked] = useState(false);
  const [workLockerUnlocked, setWorkLockerUnlocked] = useState(false);
  const [embeddedPreviewUrl, setEmbeddedPreviewUrl] = useState<string | null>(null);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteFile, setDeleteFile] = useState<UserFile | null>(null);
  const [deleteResourceType, setDeleteResourceType] = useState<"user_file" | "work_file" | null>(null);
  const [deleteOtp, setDeleteOtp] = useState("");
  const [deleteOtpBusy, setDeleteOtpBusy] = useState(false);
  const [deleteOtpError, setDeleteOtpError] = useState("");
  const [deleteOtpMessage, setDeleteOtpMessage] = useState("");

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

      setAuthChecking(false);
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

  const loadFiles = useCallback(async () => {
    setLoadingFiles(true);
    setMessage("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setFiles([]);
        setMessage("Please sign in again.");
        return;
      }

      const response = await fetch(
        `/api/files/list?category=${encodeURIComponent(activeCategory)}`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setMessage(data?.error || "Unable to load files.");
        return;
      }

      const listedFiles = Array.isArray(data?.files)
        ? data.files
        : [];

      setFiles(listedFiles as UserFile[]);
    } catch {
      setMessage("Unable to load files.");
    } finally {
      setLoadingFiles(false);
    }
  }, [activeCategory]);

  useEffect(() => {
    if (authChecking) {
      return;
    }

    const timer = window.setTimeout(() => {
      void loadFiles();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [authChecking, loadFiles]);

  async function uploadFile(file: File) {
    setUploading(true);
    setMessage("Uploading file...");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setMessage("Please sign in again.");
        return;
      }

      const formData = new FormData();

      formData.append("file", file);
      formData.append("category", activeCategory);

      const response = await fetch("/api/files/upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data?.error || "File upload failed.");
        return;
      }

      setMessage("File uploaded successfully.");
      await loadFiles();
    } catch {
      setMessage("Unable to upload file.");
    } finally {
      setUploading(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function handleFileChange(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];

    if (!file) return;

    void uploadFile(file);
  }

    const openDeleteModal = (
    file: UserFile,
    resourceType: "user_file" | "work_file",
  ) => {
    setDeleteFile(file);
    setDeleteResourceType(resourceType);
    setDeleteOtp("");
    setDeleteOtpError("");
    setDeleteOtpMessage("");
    setShowDeleteModal(true);
  };

  const closeDeleteModal = () => {
    if (deleteOtpBusy) return;
    setShowDeleteModal(false);
    setDeleteFile(null);
    setDeleteResourceType(null);
    setDeleteOtp("");
    setDeleteOtpError("");
    setDeleteOtpMessage("");
  };

  const requestDeleteOtp = async () => {
    if (!deleteFile || !deleteResourceType) return;

    setDeleteOtpBusy(true);
    setDeleteOtpError("");
    setDeleteOtpMessage("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Authentication session expired. Please login again.");
      }

      const response = await fetch("/api/file-delete/request", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileId: deleteFile.id,
          resourceType: deleteResourceType,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data?.error ||
            (response.status === 429
              ? "A delete OTP is already active. Please wait before requesting another."
              : "Unable to send delete OTP."),
        );
      }

      setDeleteOtpMessage(
        "Delete OTP sent. It expires in 120 seconds.",
      );
    } catch (error) {
      setDeleteOtpError(
        error instanceof Error ? error.message : "Unable to send delete OTP.",
      );
    } finally {
      setDeleteOtpBusy(false);
    }
  };

  const verifyAndDelete = async () => {
    if (!deleteFile || !deleteResourceType) return;

    const otp = deleteOtp.trim();

    if (!/^\d{6}$/.test(otp)) {
      setDeleteOtpError("Enter the 6-digit delete OTP.");
      return;
    }

    setDeleteOtpBusy(true);
    setDeleteOtpError("");
    setDeleteOtpMessage("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Authentication session expired. Please login again.");
      }

      const response = await fetch("/api/file-delete/verify", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileId: deleteFile.id,
          resourceType: deleteResourceType,
          otp,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || "Delete verification failed.");
      }

      setFiles((current) =>
        current.filter(
          (item) =>
            !(
              item.id === deleteFile.id &&
              item.source === deleteResourceType
            ),
        ),
      );

      setMessage(
        deleteResourceType === "user_file"
          ? "Original uploaded file deleted successfully."
          : "Working file deleted successfully.",
      );

      closeDeleteModal();
    } catch (error) {
      setDeleteOtpError(
        error instanceof Error ? error.message : "Delete verification failed.",
      );
    } finally {
      setDeleteOtpBusy(false);
    }
  };

  const startWorkFromUploadedFile = async (file: UserFile) => {
    if (!uploadedLockerUnlocked) {
      openLockerModal("uploaded");
      return;
    }

    try {
      setMessage("");
      setCreatingWorkFile(true);

      const cleanName =
        `Work - ${file.file_name.replace(/\.[^/.]+$/, "")}`.trim();

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Authentication session expired. Please login again.");
      }

      const response = await fetch("/api/work-files/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          category: file.category,
          fileName: cleanName || `Work ${file.category}`,
          sourceFileId: file.id,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data?.workFile?.id) {
        throw new Error(
          data?.error || "Unable to create work file."
        );
      }

      try {
      sessionStorage.setItem(
        "ultima_work_source_file",
        JSON.stringify({
          id: file.id,
          file_name: file.file_name,
          category: file.category,
          mime_type: file.mime_type,
          preview_url: file.preview_url,
        })
      );
    } catch {}

    router.push(
      `/work-files/${data.workFile.id}?sourceFileId=${encodeURIComponent(file.id)}`
    );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to start work."
      );
    } finally {
      setCreatingWorkFile(false);
    }
  };

async function createWorkFile() {
    if (!workLockerUnlocked) {
      openLockerModal("work");
      return;
    }

    const cleanName = newFileName.trim();

    if (!cleanName) {
      setMessage("Please enter a work file name.");
      return;
    }

    setCreatingWorkFile(true);
    setMessage("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setMessage("Please sign in again.");
        return;
      }

      const response = await fetch("/api/work-files/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          category: activeCategory,
          fileName: cleanName,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(
          data?.error || "Unable to create work file."
        );
        return;
      }

      setShowNewFileModal(false);
      setNewFileName("");

      if (data?.workFile?.id) {
        router.push(`/work-files/${data.workFile.id}`);
      }
    } catch {
      setMessage("Unable to create work file.");
    } finally {
      setCreatingWorkFile(false);
    }
  }

  function formatSize(size: number | null) {
    if (!size) return "Unknown size";

    if (size < 1024) {
      return `${size} B`;
    }

    if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    }

    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function requestLockerAccess(
    locker: "uploaded" | "work",
  ) {
    setLockerType(locker);
    setLockerOtp("");
    setLockerOtpError("");
    setLockerOtpMessage("");
    setShowLockerOtpModal(true);
    setLockerOtpBusy(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setLockerOtpError("Please sign in again.");
        return;
      }

      const response = await fetch("/api/locker-access/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ locker, category: activeCategory }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setLockerOtpError(
          data?.error || "Unable to send locker access OTP.",
        );
        return;
      }

      setLockerOtpMessage(
        data?.message ||
          `${locker === "uploaded" ? "Uploaded Files" : "Work Files"} locker OTP sent.`,
      );
    } catch {
      setLockerOtpError("Unable to request locker access OTP.");
    } finally {
      setLockerOtpBusy(false);
    }
  }

  async function verifyLockerAccess() {
    const cleanOtp = lockerOtp.trim();

    if (!/^\d{6}$/.test(cleanOtp)) {
      setLockerOtpError("Enter the 6-digit OTP.");
      return;
    }

    setLockerOtpBusy(true);
    setLockerOtpError("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setLockerOtpError("Please sign in again.");
        return;
      }

      const response = await fetch("/api/locker-access/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          locker: lockerType,
          category: activeCategory,
          otp: cleanOtp,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setLockerOtpError(
          data?.error || "Invalid locker access OTP.",
        );
        return;
      }

      if (lockerType === "uploaded") {
        setUploadedLockerUnlocked(true);
      } else {
        setWorkLockerUnlocked(true);
      }

      setShowLockerOtpModal(false);
      setLockerOtp("");
      setLockerOtpError("");
      setLockerOtpMessage("");

      setMessage(
        `${lockerType === "uploaded" ? "Uploaded Files" : "Work Files"} locker unlocked.`,
      );

      await loadFiles();
    } catch {
      setLockerOtpError("Unable to verify locker access OTP.");
    } finally {
      setLockerOtpBusy(false);
    }
  }

  function openLockerModal(locker: "uploaded" | "work") {
    void requestLockerAccess(locker);
  }

  async function openFile(file: UserFile) {
    const requiredLocker =
      file.source === "work_file" ? "work" : "uploaded";

    const unlocked =
      requiredLocker === "work"
        ? workLockerUnlocked
        : uploadedLockerUnlocked;

    if (!unlocked) {
      openLockerModal(requiredLocker);
      return;
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setMessage("Please sign in again.");
        return;
      }

      if (file.source === "work_file") {
        router.push(`/work-files/${file.id}?mode=view`);
        return;
      }

      setMessage("");

      const response = await fetch(
        `/api/file-access/preview?fileId=${encodeURIComponent(file.id)}`,
        {
          method: "GET",
          credentials: "include",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setMessage(data?.error || "Unable to open file.");
        return;
      }

      const blob = await response.blob();
      const previewUrl = URL.createObjectURL(blob);

      setSelectedFile({
        ...file,
        preview_url: previewUrl,
      });
    } catch {
      setMessage("Unable to open file.");
    }
  }

  async function downloadOpenedFile() {
    if (!selectedFile) return;

    try {
      if (selectedFile.source === "work_file") {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          setMessage("Please sign in again.");
          return;
        }

        const response = await fetch(
          `/api/work-files/${selectedFile.id}?download=1`,
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          }
        );

        if (!response.ok) {
          const data = await response.json().catch(() => null);
          setMessage(
            data?.error || "Unable to download work file."
          );
          return;
        }

        const data = await response.json();
        const content =
          typeof data?.workFile?.content === "string"
            ? data.workFile.content
            : typeof data?.content === "string"
              ? data.content
              : "";

        if (!content) {
          setMessage("Work file content is empty.");
          return;
        }

        const blob = new Blob([content], {
          type: "text/plain;charset=utf-8",
        });

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download =
          selectedFile.file_name || "work-file.txt";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);

        setMessage("Work file downloaded.");
        return;
      }

      const url = selectedFile.preview_url;

      if (!url) {
        setMessage("Secure download URL is unavailable.");
        return;
      }

      const response = await fetch(url);

      if (!response.ok) {
        setMessage("Unable to download the file.");
        return;
      }

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = downloadUrl;
      link.download = selectedFile.file_name;
      document.body.appendChild(link);
      link.click();
      link.remove();

      URL.revokeObjectURL(downloadUrl);

      setMessage("File downloaded.");
    } catch {
      setMessage("Download failed. Please try again.");
    }
  }

  function closeViewer() {
    if (embeddedPreviewUrl) {
      URL.revokeObjectURL(embeddedPreviewUrl);
      setEmbeddedPreviewUrl(null);
    }

    setSelectedFile(null);
  }

  const workingCount = files.filter(
    (file) => file.status === "Working"
  ).length;

  const savedCount = files.filter(
    (file) => file.status === "Saved"
  ).length;

  const completedCount = files.filter(
    (file) => file.status === "Completed"
  ).length;

  function renderPreview() {
    if (!selectedFile) return null;

    const url = selectedFile.preview_url;

    if (!url) {
      return (
        <div className="flex h-full min-h-[420px] items-center justify-center p-6 text-center">
          <div>
            <div className="text-4xl">□</div>
            <h3 className="mt-4 font-semibold">
              Preview unavailable
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              The file is stored securely, but a preview URL
              could not be generated.
            </p>
          </div>
        </div>
      );
    }

    const mime = selectedFile.mime_type || "";

    if (mime.startsWith("image/")) {
      return (
        <div className="flex min-h-[420px] items-center justify-center bg-black/20 p-4">
          {/* Dynamic Supabase preview URL; native img is intentional here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={selectedFile.file_name}
            className="max-h-[70vh] max-w-full rounded-xl object-contain"
          />
        </div>
      );
    }

    if (mime === "application/pdf" || selectedFile.file_name.toLowerCase().endsWith(".pdf")) {
      return (
        <PdfInlineViewer
          url={embeddedPreviewUrl || url}
          fileName={selectedFile.file_name}
        />
      );
    }

    if (
      mime.startsWith("text/") ||
      selectedFile.file_name.toLowerCase().endsWith(".txt") ||
      selectedFile.file_name.toLowerCase().endsWith(".csv")
    ) {
      return (
        <iframe
          src={url}
          title={selectedFile.file_name}
          className="h-[65vh] min-h-[420px] w-full rounded-xl bg-white"
        />
      );
    }

    return (
      <div className="flex min-h-[420px] items-center justify-center p-6 text-center">
        <div>
          <div className="text-4xl">📄</div>

          <h3 className="mt-4 font-semibold">
            {selectedFile.file_name}
          </h3>

          <p className="mt-2 text-sm text-slate-500">
            This file type may not support inline preview.
          </p>

          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950"
          >
            Open File
          </a>
        </div>
      </div>
    );
  }

  if (authChecking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-sm text-slate-400">
          Verifying secure session...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              aria-label="Go back"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-lg text-slate-300 hover:bg-white/10"
            >
              ←
            </button>

            <div className="min-w-0">
              <div className="truncate text-base font-bold">
                Ultima<span className="text-cyan-400"> Lite</span>
              </div>

              <div className="hidden text-[10px] uppercase tracking-[0.18em] text-slate-600 sm:block">
                Secure File Workspace
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/notifications"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm text-slate-300"
              aria-label="Notifications"
            >
              ♢
            </Link>
          </div>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8">
        {!categoryWorkspaceOpen ? (
          <>
            {/* CATEGORY LIST */}
            <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-6">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-400">
                  File Workspace
                </div>
                <h1 className="mt-1 text-xl font-bold sm:text-2xl">
                  Categories
                </h1>
                <p className="mt-1 text-xs text-slate-500">
                  Select a category to access its private lockers.
                </p>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {categories.map((category, index) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => {
                      setActiveCategory(category);
                      setUploadedLockerUnlocked(false);
                      setWorkLockerUnlocked(false);
                      setMessage("");
                      setCategoryWorkspaceOpen(true);
                    }}
                    className="group rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-left transition hover:border-cyan-400/30 hover:bg-cyan-400/[0.04]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-400/10 text-sm font-bold text-cyan-300">
                        {String(index + 1).padStart(2, "0")}
                      </div>

                      <span className="text-lg text-slate-600 transition group-hover:text-cyan-400">
                        →
                      </span>
                    </div>

                    <div className="mt-4 font-semibold text-white">
                      {category}
                    </div>

                    <div className="mt-1 text-xs text-slate-500">
                      Open category lockers
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <div className="mt-4">
              <Link
                href="/dashboard"
                className="block rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-center text-sm text-slate-300 hover:bg-white/[0.06]"
              >
                ← Dashboard
              </Link>
            </div>
          </>
        ) : (
          <>
            {/* CATEGORY WORKSPACE */}
            <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setCategoryWorkspaceOpen(false);
                      setUploadedLockerUnlocked(false);
                      setWorkLockerUnlocked(false);
                    }}
                    className="mb-3 text-xs text-slate-400 hover:text-cyan-300"
                  >
                    ← All Categories
                  </button>

                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-400">
                    File Workspace
                  </div>

                  <h1 className="mt-1 text-xl font-bold sm:text-2xl">
                    {activeCategory}
                  </h1>

                  <p className="mt-1 text-xs text-slate-500">
                    This category has its own separate file lockers.
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-white/[0.035] p-3">
                  <div className="text-[10px] text-slate-500">Working</div>
                  <div className="mt-1 text-lg font-bold">{workingCount}</div>
                </div>

                <div className="rounded-xl bg-white/[0.035] p-3">
                  <div className="text-[10px] text-slate-500">Saved</div>
                  <div className="mt-1 text-lg font-bold">{savedCount}</div>
                </div>

                <div className="rounded-xl bg-white/[0.035] p-3">
                  <div className="text-[10px] text-slate-500">Completed</div>
                  <div className="mt-1 text-lg font-bold">{completedCount}</div>
                </div>
              </div>
            </section>

            {message && (
              <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
                {message}
              </div>
            )}

            {/* CATEGORY LOCKERS */}
            <section className="mt-6">
              <div className="mb-4">
                <h2 className="text-lg font-semibold">Category Lockers</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Only files belonging to {activeCategory} are shown here.
                </p>
              </div>

              {/* UPLOADED FILES LOCKER */}
              <section className="mb-5 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.025] p-4">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="font-semibold text-cyan-300">
                      🔐 Uploaded Files Locker
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Original files uploaded for this category.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-slate-500">
                      {files.filter((f) => f.source === "user_file").length}
                    </span>

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="rounded-xl bg-cyan-400 px-3 py-2 text-[11px] font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-50"
                    >
                      {uploading ? "Uploading..." : "+ Upload File"}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (uploadedLockerUnlocked) {
                          setUploadedLockerUnlocked(false);
                          setMessage("Uploaded Files locker locked.");
                        } else {
                          openLockerModal("uploaded");
                        }
                      }}
                      className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-[11px] font-semibold text-cyan-300"
                    >
                      {uploadedLockerUnlocked ? "🔓 Unlocked" : "🔐 Unlock"}
                    </button>
                  </div>
                </div>

                {!uploadedLockerUnlocked ? (
                  <div className="rounded-xl border border-dashed border-cyan-400/20 p-6 text-center">
                    <div className="text-sm font-medium text-slate-300">
                      Uploaded Files Locker is locked
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Unlock this category locker to view its files.
                    </div>
                  </div>
                ) : files.filter((f) => f.source === "user_file").length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-500">
                    No uploaded files in this category.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {files
                      .filter((f) => f.source === "user_file")
                      .map((file) => (
                        <div
                          key={`uploaded-${file.id}`}
                          className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold">
                                {file.file_name}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                {formatSize(file.file_size)} · Original File
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => openFile(file)}
                                className="rounded-xl bg-cyan-400 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
                              >
                                Open
                              </button>

                              <button
                                type="button"
                                disabled={creatingWorkFile}
                                onClick={() => void startWorkFromUploadedFile(file)}
                                className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-400/20 disabled:opacity-50"
                              >
                                {creatingWorkFile ? "Starting..." : "Start Work"}
                              </button>

                              <button
                                type="button"
                                onClick={() => openDeleteModal(file, "user_file")}
                                className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-2 text-xs font-semibold text-red-300 hover:bg-red-400/20"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </section>

              {/* WORK FILES LOCKER */}
              <section className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.025] p-4">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="font-semibold text-emerald-300">
                      🔐 Work Files Locker
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Work files created for this category.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-slate-500">
                      {files.filter((f) => f.source === "work_file").length}
                    </span>

                    <button
                      type="button"
                      onClick={() => {
                        if (workLockerUnlocked) {
                          setWorkLockerUnlocked(false);
                          setMessage("Work Files locker locked.");
                        } else {
                          openLockerModal("work");
                        }
                      }}
                      className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-[11px] font-semibold text-emerald-300"
                    >
                      {workLockerUnlocked ? "🔓 Unlocked" : "🔐 Unlock"}
                    </button>
                  </div>
                </div>

                {!workLockerUnlocked ? (
                  <div className="rounded-xl border border-dashed border-emerald-400/20 p-6 text-center">
                    <div className="text-sm font-medium text-slate-300">
                      Work Files Locker is locked
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Unlock this category locker to view its work files.
                    </div>
                  </div>
                ) : files.filter((f) => f.source === "work_file").length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-500">
                    No working files in this category.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {files
                      .filter((f) => f.source === "work_file")
                      .map((file) => (
                        <div
                          key={`work-${file.id}`}
                          className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold">
                                {file.file_name}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                Working File · {file.status}
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-white/10 px-3 py-1 text-[10px] text-slate-400">
                                {file.status}
                              </span>

                              <button
                                type="button"
                                onClick={() => openFile(file)}
                                className="rounded-xl bg-cyan-400 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
                              >
                                Open
                              </button>

                              <button
                                type="button"
                                onClick={() => openDeleteModal(file, "work_file")}
                                className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-2 text-xs font-semibold text-red-300 hover:bg-red-400/20"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </section>
            </section>

            {/* CATEGORY ACTIONS */}
            <section className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
            </section>
          </>
        )}
      </div>

      {/* TWO-PANE FILE WORKSPACE */}
      {selectedFile && (
        <section className="fixed inset-0 z-50 flex flex-col bg-slate-950">
          <header className="flex min-h-16 shrink-0 items-center justify-between border-b border-white/10 bg-slate-950 px-4">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={closeViewer}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-lg"
                aria-label="Close file workspace"
              >
                ←
              </button>

              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {selectedFile.file_name}
                </div>

                <div className="text-[10px] text-slate-500">
                  {activeCategory} · {selectedFile.status}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void downloadOpenedFile()}
                className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-300 hover:bg-cyan-400/20"
              >
                Download
              </button>

            {selectedFile.source === "work_file" ? (
              <button
                type="button"
                onClick={() => {
                  router.push(`/work-files/${selectedFile.id}`);
                }}
                className="rounded-lg border px-4 py-2 text-sm font-medium"
              >
                Edit
              </button>
            ) : (
              <button
                type="button"
                disabled={creatingWorkFile}
                onClick={() => void startWorkFromUploadedFile(selectedFile)}
                className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-400/20 disabled:opacity-50"
              >
                {creatingWorkFile ? "Starting..." : "Start Work"}
              </button>
            )}

            </div>
          </header>

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto lg:grid-cols-2">
            {/* SOURCE */}
            <div className="min-h-[520px] border-b border-white/10 lg:border-b-0 lg:border-r">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-400">
                    01 · Source File
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Original uploaded file
                  </div>
                </div>
              </div>

              <div className="p-3">
                {renderPreview()}
              </div>
            </div>

            {/* WORK */}
            <div className="min-h-[520px]">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-400">
                    02 · Work Area
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Enter and manage your work
                  </div>
                </div>
              </div>

              <div className="flex min-h-[470px] items-center justify-center p-6 text-center">
                <div className="max-w-sm">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-400/10 text-2xl">
                    ✎
                  </div>

                  <h3 className="mt-4 font-semibold">
                    Work Area Ready
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Open the full editor to continue working on
                    this work file. Your existing grid, undo and
                    redo system remains available there.
                  </p>

                  
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* LOCKER ACCESS OTP MODAL */}
      {showLockerOtpModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-400">
                  Secure Locker Access
                </div>

                <h2 className="mt-1 text-lg font-semibold">
                  Unlock {lockerType === "uploaded" ? "Uploaded Files" : "Work Files"}
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  One OTP unlocks this locker temporarily. Files inside it do
                  not require a separate access OTP.
                </p>
              </div>

              <button
                type="button"
                disabled={lockerOtpBusy}
                onClick={() => {
                  setShowLockerOtpModal(false);
                  setLockerOtp("");
                  setLockerOtpError("");
                  setLockerOtpMessage("");
                }}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-400 disabled:opacity-50"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {lockerOtpBusy && !lockerOtpMessage ? (
              <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4 text-center text-sm text-slate-400">
                Sending secure locker OTP...
              </div>
            ) : (
              <>
                {lockerOtpMessage && (
                  <div className="mt-5 rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-3 text-sm text-cyan-300">
                    {lockerOtpMessage}
                  </div>
                )}

                {lockerOtpError && (
                  <div className="mt-3 rounded-xl border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-300">
                    {lockerOtpError}
                  </div>
                )}

                <label className="mt-5 block text-xs text-slate-500">
                  6-digit OTP
                </label>

                <input
                  value={lockerOtp}
                  onChange={(event) =>
                    setLockerOtp(
                      event.target.value.replace(/\D/g, "").slice(0, 6),
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void verifyLockerAccess();
                    }
                  }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  autoFocus
                  className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-slate-950 px-4 text-center text-lg tracking-[0.35em] outline-none focus:border-cyan-400/50"
                  placeholder="000000"
                />

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={lockerOtpBusy}
                    onClick={() => {
                      setShowLockerOtpModal(false);
                      setLockerOtp("");
                      setLockerOtpError("");
                      setLockerOtpMessage("");
                    }}
                    className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300 disabled:opacity-50"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    disabled={lockerOtpBusy || lockerOtp.length !== 6}
                    onClick={() => void verifyLockerAccess()}
                    className="rounded-xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50"
                  >
                    {lockerOtpBusy ? "Verifying..." : "Unlock Locker"}
                  </button>
                </div>

                <p className="mt-4 text-center text-[11px] leading-5 text-slate-600">
                  Locker access is temporary. Delete operations still use
                  their separate secure confirmation.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {showDeleteModal && deleteFile && deleteResourceType && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-red-400/20 bg-slate-950 p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-red-300">
              🔐 Secure Delete
            </h3>

            <p className="mt-2 text-sm text-slate-300">
              {deleteResourceType === "user_file"
                ? "Delete the original uploaded file?"
                : "Delete this working file?"}
            </p>

            <p className="mt-3 break-all rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-400">
              {deleteFile.file_name}
            </p>

            <p className="mt-3 text-xs text-slate-500">
              {deleteResourceType === "user_file"
                ? "Only the original uploaded file will be deleted. Any Working File remains unchanged."
                : "Only this Working File will be deleted. The original uploaded file remains unchanged."}
            </p>

            {deleteOtpMessage && (
              <div className="mt-3 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-xs text-emerald-300">
                {deleteOtpMessage}
              </div>
            )}

            {deleteOtpError && (
              <div className="mt-3 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-xs text-red-300">
                {deleteOtpError}
              </div>
            )}

            <label className="mt-4 mb-2 block text-xs text-slate-400">
              Delete OTP
            </label>

            <input
              value={deleteOtp}
              onChange={(event) =>
                setDeleteOtp(
                  event.target.value.replace(/\D/g, "").slice(0, 6),
                )
              }
              inputMode="numeric"
              maxLength={6}
              placeholder="6-digit OTP"
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-center text-lg tracking-[0.35em] text-white outline-none focus:border-red-400/40"
            />

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={deleteOtpBusy}
                onClick={closeDeleteModal}
                className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-white/[0.05] disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={deleteOtpBusy}
                onClick={() => void requestDeleteOtp()}
                className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-400/20 disabled:opacity-50"
              >
                {deleteOtpBusy ? "Please wait..." : "Send Delete OTP"}
              </button>

              <button
                type="button"
                disabled={deleteOtpBusy || deleteOtp.length !== 6}
                onClick={() => void verifyAndDelete()}
                className="rounded-xl bg-red-500 px-4 py-2 text-xs font-semibold text-white hover:bg-red-400 disabled:opacity-50"
              >
                {deleteOtpBusy ? "Deleting..." : "Verify & Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NEW WORK FILE MODAL */}
      {showNewFileModal && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-3 sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-400">
                  New Work File
                </div>

                <h2 className="mt-1 text-lg font-semibold">
                  Create work area
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  Category: {activeCategory}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowNewFileModal(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-400"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <label className="mt-5 block text-xs text-slate-500">
              Work file name
            </label>

            <input
              value={newFileName}
              onChange={(event) =>
                setNewFileName(event.target.value)
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void createWorkFile();
                }
              }}
              autoFocus
              className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-slate-950 px-4 text-sm outline-none focus:border-cyan-400/50"
              placeholder="Enter work file name"
            />

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setShowNewFileModal(false)}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={creatingWorkFile}
                onClick={() => void createWorkFile()}
                className="rounded-xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50"
              >
                {creatingWorkFile
                  ? "Creating..."
                  : "Create & Open"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function Files() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
          <div className="text-sm text-slate-500">
            Loading Files...
          </div>
        </main>
      }
    >
      <FilesContent />
    </Suspense>
  );
}
