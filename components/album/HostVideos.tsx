"use client";
import { useEffect, useRef, useState } from "react";
import { api, Lotus, Message, say, size, when } from "./shared";

type HostVideo = {
  id: string;
  name: string;
  title: string;
  mime: string;
  bytes: number;
  status: "uploading" | "ready";
  published: number;
  created: number;
  link: string | null;
};
type Progress = { name: string; sent: number; total: number; error?: string; done?: boolean };
const accepted = ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"];

function guessType(file: File) {
  if (accepted.includes(file.type)) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext === "mov" ? "video/quicktime" : ext === "webm" ? "video/webm" : ext === "m4v" ? "video/x-m4v" : ext === "mp4" ? "video/mp4" : "";
}

async function sendPart(id: string, n: number, chunk: Blob) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch("/api/host/videos/" + id + "/part?n=" + n, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: chunk,
    }).catch(() => null);
    const result = r && (await r.json().catch(() => ({}))) as { etag?: string; error?: string };
    if (r?.ok && result?.etag) return { partNumber: n, etag: result.etag };
    if (attempt >= 3) throw new Error(result?.error || "The upload was interrupted. Please try again.");
    await new Promise((done) => setTimeout(done, 1500 * attempt));
  }
}

export default function HostVideos() {
  const [videos, setVideos] = useState<HostVideo[]>([]),
    [busy, setBusy] = useState(true),
    [uploads, setUploads] = useState<Progress[]>([]),
    [confirm, setConfirm] = useState(""),
    [editing, setEditing] = useState<{ id: string; title: string } | null>(null),
    [note, setNote] = useState("");
  const uploadingNow = useRef(false);

  async function load() {
    setBusy(true);
    try {
      setVideos((await api<{ items: HostVideo[] }>("host/videos")).items);
      setNote("");
    } catch (e) {
      setNote(say(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!uploads.some((u) => !u.done && !u.error)) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [uploads]);

  async function upload(files: File[]) {
    if (uploadingNow.current || !files.length) return;
    uploadingNow.current = true;
    const queue = files.map((f) => ({ name: f.name, sent: 0, total: f.size }));
    setUploads(queue);
    const update = (i: number, change: Partial<Progress>) =>
      setUploads((list) => list.map((u, j) => (j === i ? { ...u, ...change } : u)));
    for (const [i, file] of files.entries()) {
      try {
        const mime = guessType(file);
        if (!mime) throw new Error("This file isn't an MP4, MOV or WebM video.");
        const { id, partSize } = await api<{ id: string; partSize: number }>("host/videos/start", {
          name: file.name,
          mime,
          bytes: file.size,
        });
        const parts = [];
        for (let n = 1, at = 0; at < file.size; n++, at += partSize) {
          parts.push(await sendPart(id, n, file.slice(at, at + partSize)));
          update(i, { sent: Math.min(file.size, at + partSize) });
        }
        await api("host/videos/" + id + "/finish", { parts });
        update(i, { done: true, sent: file.size });
      } catch (e) {
        update(i, { error: say(e) });
      }
    }
    uploadingNow.current = false;
    await load();
  }

  async function change(id: string, data: Record<string, unknown>, action = "update") {
    setBusy(true);
    try {
      await api("host/videos/" + id + "/" + action, data);
      await load();
    } catch (e) {
      setNote(say(e));
      setBusy(false);
    }
  }

  const active = uploads.some((u) => !u.done && !u.error);
  return (
    <>
      <div className="actionPanel videoUpload">
        <h3>Add videos</h3>
        <p>
          Choose MP4 or MOV videos from your phone or computer, up to 4 GB each. They appear in the
          guests’ Videos tab as soon as they finish uploading. Keep this page open while they upload.
        </p>
        <label className={"button" + (active ? " disabledLabel" : "")}>
          {active ? "Uploading…" : "Choose videos"}
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.m4v,.webm"
            multiple
            hidden
            disabled={active}
            onChange={(e) => {
              void upload(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
        </label>
        {uploads.length > 0 && (
          <ul className="uploadList">
            {uploads.map((u, i) => (
              <li key={i}>
                <span>{u.name}</span>
                <progress max={u.total} value={u.sent} />
                <small>
                  {u.error ? u.error : u.done ? "Uploaded" : Math.floor((u.sent / u.total) * 100) + "% of " + size(u.total)}
                </small>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Message value={note} />
      {videos.length ? (
        <div className="videoList">
          {videos.map((v) => (
            <figure className="videoCard" key={v.id}>
              <div className="videoFrame">
                {v.link ? (
                  <video src={v.link} controls preload="metadata" playsInline />
                ) : (
                  <div className="noPreview">
                    <span>Upload didn’t finish</span>
                  </div>
                )}
              </div>
              <figcaption className="hostVideoMeta">
                {editing?.id === v.id ? (
                  <form
                    className="titleEdit"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setEditing(null);
                      void change(v.id, { title: editing.title });
                    }}
                  >
                    <input
                      value={editing.title}
                      maxLength={120}
                      autoFocus
                      onChange={(e) => setEditing({ id: v.id, title: e.target.value })}
                    />
                    <button className="textButton" type="submit">Save</button>
                    <button className="textButton" type="button" onClick={() => setEditing(null)}>Cancel</button>
                  </form>
                ) : (
                  <b>{v.title}</b>
                )}
                <small>
                  {size(v.bytes)} · {v.status === "uploading" ? "Incomplete" : v.published ? "Shown to guests" : "Hidden"} ·{" "}
                  {when(v.created)}
                </small>
                <div className="actions">
                  {v.status === "ready" && (
                    <>
                      <button
                        className="button light"
                        type="button"
                        disabled={busy}
                        onClick={() => void change(v.id, { published: !v.published })}
                      >
                        {v.published ? "Hide from guests" : "Show to guests"}
                      </button>
                      <button
                        className="textButton"
                        type="button"
                        disabled={busy}
                        onClick={() => setEditing({ id: v.id, title: v.title })}
                      >
                        Rename
                      </button>
                    </>
                  )}
                  <button
                    className="textButton deleteGuest"
                    type="button"
                    disabled={busy}
                    onBlur={() => setConfirm((c) => (c === v.id ? "" : c))}
                    onClick={() => {
                      if (confirm !== v.id) return setConfirm(v.id);
                      setConfirm("");
                      void change(v.id, {}, "delete");
                    }}
                  >
                    {confirm === v.id ? "Tap again to delete" : "Delete"}
                  </button>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        !busy && (
          <div className="empty">
            <Lotus />
            <h3>No videos yet</h3>
            <p>Videos you upload here appear in the guests’ Videos tab.</p>
          </div>
        )
      )}
    </>
  );
}
