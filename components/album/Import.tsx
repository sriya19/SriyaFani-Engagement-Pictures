"use client";
import { useEffect, useRef, useState } from "react";
import { planUpload } from "../../album/upload-files.js";
import { api, Icon, Message, say, size } from "./shared";
export type Setup = {
  folder: string;
  drive: boolean;
  sms: boolean;
  email: boolean;
};
type DriveItem = { id: string; name: string; folder: boolean; bytes: number };
async function makePreview(file: File): Promise<Blob | null> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = objectUrl;
    await img.decode();
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height)),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#f4f0e4";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((done) =>
      canvas.toBlob(done, "image/jpeg", 0.82),
    );
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
async function put(
  url: string,
  payload: Blob,
  headers: Record<string, string>,
) {
  const r = await fetch("/api/" + url, {
    method: "POST",
    headers: {
      "Content-Type": payload.type,
      "X-Photo-Bytes": String(payload.size),
      ...headers,
    },
    body: payload,
  });
  const result = (await r.json().catch(() => ({}))) as {
    id: string;
    existing?: boolean;
    preview?: string;
    error?: string;
  };
  if (!r.ok || !r.headers.get("Content-Type")?.includes("application/json"))
    throw Error(result.error || "Upload failed. Reopen the host studio and retry this selection.");
  return result;
}
type UploadProgress = {
  total: number; processed: number; added: number; existing: number; issues: string[];
};
const initialUpload: UploadProgress = { total: 0, processed: 0, added: 0, existing: 0, issues: [] };
export function Upload({ viewPhotos }: { viewPhotos: () => void }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [current, setCurrent] = useState("");
  const running = useRef(false);
  async function run(files: File[]) {
    if (!files.length || running.current) return;
    running.current = true;
    setBusy(true);
    setProgress(null);
    setCurrent("Reading your selection…");
    const state = { ...initialUpload, issues: [] as string[] };
    let batch: Awaited<ReturnType<typeof planUpload>> | undefined;
    try {
      batch = await planUpload(files);
      state.total = batch.photos.length;
      state.issues.push(...batch.skipped);
      setProgress({ ...state });
      for (const item of batch.photos) {
        setCurrent(item.label);
        try {
          const file = await item.read();
          const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
          const digest = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
          let saved = await api<{ id: string; existing?: boolean; preview?: string }>("host/upload-match", { name: file.name, bytes: file.size, digest });
          if (!saved.existing) saved = await put("host/upload", file, {
            "X-Photo-Name": encodeURIComponent(file.name), "X-Photo-SHA256": digest,
          });
          if (saved.existing) state.existing++;
          else state.added++;
          if (!saved.preview) {
            try {
              const preview = await makePreview(file);
              if (preview) await put("host/preview/" + saved.id, preview, {});
              else state.issues.push(item.label + " — original saved. This browser could not make a preview.");
            } catch (e) {
              state.issues.push(item.label + " — original saved. Preview failed: " + say(e));
            }
          }
        } catch (e) {
          state.issues.push(item.label + " — " + say(e));
        }
        state.processed++;
        setProgress({ ...state, issues: [...state.issues] });
      }
    } catch (e) {
      state.issues.push(say(e));
    } finally {
      try { await batch?.close(); } finally {
        setCurrent("");
        setProgress({ ...state, issues: [...state.issues] });
        setBusy(false);
        running.current = false;
      }
    }
  }
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    void run(files);
  };
  return (
    <div className="actionPanel">
      <h3>Upload originals</h3>
      <p>Select photos, a Google Drive ZIP, or an extracted folder. New originals become private drafts. You can select the same files again to finish a partial upload.</p>
      <div className="actions">
        <label className={"button light fileButton" + (busy ? " disabled" : "")}>
          <Icon name="photo" /> Choose photos or ZIPs
          <input type="file" accept="image/*,.heic,.heif,.tif,.tiff,.zip,application/zip" multiple disabled={busy} onChange={pick} />
        </label>
        <label className={"button light fileButton" + (busy ? " disabled" : "")}>
          Choose a folder
          <input type="file" multiple ref={(input) => { input?.setAttribute("webkitdirectory", ""); }} disabled={busy} onChange={pick} />
        </label>
      </div>
      {busy && <p role="status">{progress?.total ? (progress.processed + 1) + " of " + progress.total + " · " : ""}{current}</p>}
      {progress && <div className="uploadResult">
        <p role="status"><strong>{busy ? "Upload progress" : "Upload complete"}</strong> · {progress.added} added · {progress.existing} already in album · {progress.issues.length} to review</p>
        {!!progress.issues.length && <details><summary>View file details</summary>
          <ul>{progress.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>
        </details>}
        {!busy && <button type="button" className="button light" onClick={viewPhotos}>View album photos</button>}
      </div>}
    </div>
  );
}
export function DrivePicker({
  setup,
  done,
  update,
}: {
  setup: Setup;
  done: () => void;
  update: (f: string) => void;
}) {
  const [link, setLink] = useState(
      setup.folder
        ? "https://drive.google.com/drive/folders/" + setup.folder
        : "",
    ),
    [path, setPath] = useState<{ id: string; name: string }[]>([]),
    [files, setFiles] = useState<DriveItem[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [next, setNext] = useState(""),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState("");
  const folder = path.at(-1)?.id || setup.folder;
  async function load(page = "", append = false) {
    if (!setup.drive || !folder) return;
    setBusy(true);
    setNote("");
    try {
      const q = new URLSearchParams({ folder, page });
      const r = await api("host/drive?" + q);
      setFiles((old) => (append ? [...old, ...r.files] : r.files));
      setNext(r.next);
      if (!append && !r.files.length)
        setNote("There are no supported photos in this folder.");
    } catch (e) {
      setNote(say(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setSelected([]);
    setFiles([]);
    setNext("");
    void load();
  }, [folder, setup.drive]);
  async function add() {
    setBusy(true);
    let count = 0;
    const failed: string[] = [];
    const problems: string[] = [];
    for (const id of selected) {
      try {
        await api("host/import", { file: id });
        count++;
      } catch (e) {
        failed.push(id);
        problems.push(
          (files.find((f) => f.id === id)?.name || "Photo") + " — " + say(e),
        );
      }
    }
    setSelected(failed);
    setNote(
      count +
        " selection" +
        (count === 1 ? "" : "s") +
        " in drafts or already in the album. " +
        problems.join(" "),
    );
    setBusy(false);
    done();
  }
  return (
    <div className="actionPanel">
      <h3>Choose from Google Drive</h3>
      <form
        className="inlineForm"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await api("host/folder", { folder: link });
            setPath([]);
            setLink("https://drive.google.com/drive/folders/" + r.folder);
            update(r.folder);
            setNote("Source folder saved.");
          } catch (err) {
            setNote(say(err));
          }
        }}
      >
        <label>
          Source folder
          <input
            type="url"
            value={link}
            placeholder="https://drive.google.com/drive/folders/…"
            required
            onChange={(e) => setLink(e.target.value)}
          />
        </label>
        <button className="button light" disabled={busy}>
          Save folder
        </button>
      </form>
      {setup.folder && (
        <a
          className="textButton"
          href={"https://drive.google.com/drive/folders/" + setup.folder}
          target="_blank"
          rel="noreferrer"
        >
          Open source folder in Drive
        </a>
      )}
      {!setup.drive && (
        <p className="subtle">
          For direct imports, add the Google service account in hosting settings
          and give it Viewer access to your chosen folder. You can upload
          original files now.
        </p>
      )}
      {setup.drive && folder && (
        <>
          <div className="actions">
            <button
              className="textButton"
              disabled={busy || !path.length}
              onClick={() => setPath((p) => p.slice(0, -1))}
            >
              Back to parent
            </button>
            <strong>{path.at(-1)?.name || "Source folder"}</strong>
          </div>
          <div className="driveItems">
            {files.map((f) =>
              f.folder ? (
                <button
                  key={f.id}
                  disabled={busy}
                  className="folderLink"
                  onClick={() =>
                    setPath((old) => [...old, { id: f.id, name: f.name }])
                  }
                >
                  {f.name} · Folder
                </button>
              ) : (
                <label key={f.id} className="driveItem">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={selected.includes(f.id)}
                    onChange={(e) =>
                      setSelected((old) =>
                        e.target.checked
                          ? [...old, f.id]
                          : old.filter((x) => x !== f.id),
                      )
                    }
                  />
                  <img
                    alt=""
                    loading="lazy"
                    src={
                      "/api/host/drive-preview?file=" + encodeURIComponent(f.id)
                    }
                    onError={(e) => {
                      e.currentTarget.hidden = true;
                    }}
                  />
                  <span>
                    {f.name}
                    <small>{size(f.bytes)}</small>
                  </span>
                </label>
              ),
            )}
          </div>
          <div className="actions">
            {next && (
              <button
                className="textButton"
                disabled={busy}
                onClick={() => load(next, true)}
              >
                More from Drive
              </button>
            )}
            <button
              className="button"
              disabled={!selected.length || busy}
              onClick={add}
            >
              Import selected
              {selected.length ? " (" + selected.length + ")" : ""}
            </button>
          </div>
        </>
      )}
      <Message value={note} />
    </div>
  );
}
