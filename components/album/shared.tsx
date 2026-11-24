"use client";
import { useEffect, useRef, useState } from "react";
import { acceptGuestResponse, albumFetch, isGuestWebsite } from "./transport";
export type Me = {
  role: "visitor" | "guest" | "host";
  status?: string;
  name?: string;
  smsEnabled?: boolean;
};
export type Photo = {
  id: string;
  name: string;
  bytes: number;
  preview: string | null;
  favorite?: number;
  published?: number;
};
export type Page<T> = { items: T[]; next: number | null };
export async function api<T = any>(url: string, data?: unknown): Promise<T> {
  const r = await albumFetch(url, {
    method: data === undefined ? "GET" : "POST",
    ...(data === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }),
  });
  if (!r.headers.get("Content-Type")?.includes("application/json"))
    throw new Error("The album is temporarily unavailable. Please try again.");
  const result = (await r.json().catch(() => ({}))) as T & { error?: string; challenge?: string; session?: string };
  if (!r.ok) throw new Error(result.error || "Please try again.");
  acceptGuestResponse(url, result);
  return result;
}
export function say(e: unknown) {
  return e instanceof Error ? e.message : "Please try again.";
}
export function size(n: number) {
  return n >= 1024 * 1024
    ? (n / (1024 * 1024)).toFixed(1) + " MB"
    : Math.max(1, Math.round(n / 1024)) + " KB";
}
export function when(t: number) {
  return new Date(t).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
export function Lotus({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 50"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M32 41C20 33 19 19 32 5c12 15 12 28 0 36Z" />
      <path d="M31 41C16 41 8 30 9 16c14 2 22 12 23 24m1 1c15 0 23-11 22-25-14 2-22 12-23 24" />
      <path d="M13 29C8 26 5 26 2 27c4 13 16 17 29 14m20-12c5-3 8-3 11-2-4 13-16 17-29 14M24 46h16" />
    </svg>
  );
}
export function Kolam({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 120 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.15"
      aria-hidden="true"
    >
      <path d="m7 32 11-11q6-6 12 0l24 24q6 6 12 0l24-24q6-6 12 0l11 11-11 11q-6 6-12 0L66 19q-6-6-12 0L30 43q-6 6-12 0L7 32Z" />
      <path d="m32 32 22-22q6-6 12 0l22 22-22 22q-6 6-12 0L32 32Z" />
      {[24, 42, 60, 78, 96].map((x) => (
        <circle
          key={x}
          cx={x}
          cy="32"
          r="1.6"
          fill="currentColor"
          stroke="none"
        />
      ))}
      <circle cx="60" cy="16" r="1.6" fill="currentColor" />
      <circle cx="60" cy="48" r="1.6" fill="currentColor" />
    </svg>
  );
}
export function Icon({
  name,
  className = "",
}: {
  name:
    | "lock"
    | "album"
    | "close"
    | "heart"
    | "download"
    | "photo"
    | "flower"
    | "leaf";
  className?: string;
}) {
  const shapes = {
    lock: (
      <>
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v2" />
      </>
    ),
    album: (
      <>
        <rect x="4" y="4.5" width="16" height="15" rx="2" />
        <path d="M8 4.5v15m3-4 2-2.5 1.5 1.7 2.5-3.2" />
      </>
    ),
    close: <path d="m5 5 14 14M19 5 5 19" />,
    heart: (
      <path d="M20.5 6.4c-2.3-2.5-6-1.7-8.5 1-2.5-2.7-6.2-3.5-8.5-1-3.6 4.4 1 8.2 8.5 14 7.5-5.8 12.1-9.6 8.5-14Z" />
    ),
    download: (
      <>
        <path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4" />
      </>
    ),
    photo: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="9" cy="9" r="1.4" />
        <path d="m5 17 4.5-4 3 2.4 4-5L20 15" />
      </>
    ),
    flower: (
      <>
        <path d="M12 5c-4-7-8 2-5 4-8 0-4 8 1 7-2 7 8 7 8 0 6 2 9-7 2-7 3-5-4-9-6-4Z" />
        <circle cx="12" cy="12" r="2" />
      </>
    ),
    leaf: (
      <>
        <path d="M20 3C9 2 3 7 4 14c2 9 16 7 16-11Z" />
        <path d="M4 21c1-4 4-9 11-13" />
      </>
    ),
  };
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="19"
      height="19"
      stroke="currentColor"
      strokeWidth="1.5"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes[name]}
    </svg>
  );
}
export function Modal({
  children,
  title,
  close,
  wide = false,
}: {
  children: React.ReactNode;
  title: string;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      d?.close();
      document.body.style.overflow = previous;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={"modal" + (wide ? " wide" : "")}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) {
          const rect = ref.current.getBoundingClientRect();
          if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          )
            close();
        }
      }}
    >
      <button
        className="iconButton closeButton"
        aria-label="Close"
        onClick={close}
      >
        <Icon name="close" />
      </button>
      {children}
    </dialog>
  );
}
export function Message({ value }: { value: string }) {
  return value ? (
    <p role="status" className="message">
      {value}
    </p>
  ) : null;
}
async function mediaBlob(photo: Photo, action: "original" | "preview", signal: AbortSignal) {
  const response = await albumFetch("photos/" + photo.id + "/" + action, {
    method: action === "original" ? "POST" : "GET", signal,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(detail?.error || "Could not open this photo.");
  }
  return response.blob();
}
// Phones get a "Save to Photos" button that opens the system save sheet
// (Save Image / Save to Files on iPhone, Photos or Files apps on Android).
function canSaveToPhotos() {
  try {
    return (
      typeof navigator.canShare === "function" &&
      matchMedia("(pointer: coarse)").matches &&
      navigator.canShare({
        files: [new File([new Uint8Array(1)], "photo.jpg", { type: "image/jpeg" })],
      })
    );
  } catch {
    return false;
  }
}
const imageTypes: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  heic: "image/heic", heif: "image/heif", tif: "image/tiff", tiff: "image/tiff", avif: "image/avif",
};
// Phones only offer "Save Image" for files labelled as images.
function imageType(name: string, served: string) {
  if (served.startsWith("image/")) return served;
  return imageTypes[name.split(".").pop()?.toLowerCase() || ""] || served || "application/octet-stream";
}
function saveFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export function Download({ photo }: { photo: Photo }) {
  return <SaveButtons key={photo.id} photo={photo} />;
}
function SaveButtons({ photo }: { photo: Photo }) {
  const [share] = useState(canSaveToPhotos);
  const [busy, setBusy] = useState<"" | "photos" | "file">("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const original = useRef<File | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function fetchOriginal() {
    if (original.current) return original.current;
    const controller = new AbortController();
    request.current = controller;
    const blob = await mediaBlob(photo, "original", controller.signal);
    original.current = new File([blob], photo.name, {
      type: imageType(photo.name, blob.type),
    });
    return original.current;
  }
  async function run(kind: "photos" | "file") {
    if (busy) return;
    setBusy(kind);
    setError("");
    setReady(false);
    try {
      const file = await fetchOriginal();
      if (kind === "photos" && navigator.canShare?.({ files: [file] }))
        await navigator.share({ files: [file], title: photo.name });
      else saveFile(file);
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === "AbortError") {
        /* The guest closed the save sheet. */
      } else if (name === "NotAllowedError" && kind === "photos") {
        // Large originals can take longer than the phone allows between the
        // tap and the save sheet. The file is ready now, so one more tap opens it.
        setReady(true);
      } else setError(say(e));
    } finally {
      if (!request.current?.signal.aborted) setBusy("");
    }
  }
  const plainForm = !share && !isGuestWebsite();
  return <>
    {share && (
      <button className="button" disabled={Boolean(busy)} onClick={() => run("photos")}>
        <Icon name="photo" />
        {busy === "photos" ? "Preparing…" : ready ? "Ready · tap to save" : "Save to Photos"}
      </button>
    )}
    {plainForm ? (
      <form method="post" action={"/api/photos/" + photo.id + "/original"}>
        <button className="button" type="submit">
          <Icon name="download" />
          Download original
        </button>
      </form>
    ) : (
      <button
        className={"button" + (share ? " light" : "")}
        disabled={Boolean(busy)}
        onClick={() => run("file")}
      >
        <Icon name="download" />
        {busy === "file" ? "Preparing…" : share ? "Download" : "Download original"}
      </button>
    )}
    <Message value={error} />
  </>;
}
// Previews are shared by the grid and the full-screen viewer, so a photo that
// is already on screen opens instantly instead of downloading a second time.
const previewRequests = new Map<string, Promise<string>>();
const previewUrls = new Map<string, string>();
function loadPreview(photo: Photo) {
  let pending = previewRequests.get(photo.id);
  if (!pending) {
    pending = mediaBlob(photo, "preview", new AbortController().signal).then((blob) => {
      const url = URL.createObjectURL(blob);
      previewUrls.set(photo.id, url);
      return url;
    });
    previewRequests.set(photo.id, pending);
    pending.catch(() => previewRequests.delete(photo.id));
  }
  return pending;
}
function GuestPreview({ photo, eager }: { photo: Photo; eager: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState(() => previewUrls.get(photo.id) || "");
  const [error, setError] = useState(false);
  useEffect(() => {
    if (url) return;
    let live = true;
    const load = () =>
      loadPreview(photo).then(
        (value) => { if (live) setUrl(value); },
        () => { if (live) setError(true); },
      );
    let observer: IntersectionObserver | undefined;
    if (!eager && ref.current && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer?.disconnect();
          void load();
        }
      }, { rootMargin: "400px" });
      observer.observe(ref.current);
    } else void load();
    return () => {
      live = false;
      observer?.disconnect();
    };
  }, [photo.id, eager, url]);
  return url ? <img src={url} alt={photo.name} decoding="async" draggable={false} /> :
    <div ref={ref} className="noPreview"><Icon name="photo" /><span>{error ? "Preview unavailable" : "Loading photo…"}</span></div>;
}
export function Cover({ photo, eager = false }: { photo: Photo; eager?: boolean }) {
  if (photo.preview && isGuestWebsite()) return <GuestPreview key={photo.id} photo={photo} eager={eager} />;
  return photo.preview ? (
    <img
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      src={"/api/photos/" + photo.id + "/preview"}
      alt={photo.name}
    />
  ) : (
    <div className="noPreview">
      <Icon name="photo" />
      <span>Original photo</span>
    </div>
  );
}
