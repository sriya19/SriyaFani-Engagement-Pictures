"use client";
import { useEffect, useState } from "react";
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
    error?: string;
  };
  if (!r.ok) throw Error(result.error || "Upload failed.");
  return result;
}
export function Upload({ done }: { done: () => void }) {
  const [busy, setBusy] = useState(false),
    [note, setNote] = useState("");
  async function run(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    const errors: string[] = [];
    let count = 0;
    for (const file of files) {
      setNote("Uploading " + file.name + "…");
      try {
        const { id } = await put("host/upload", file, {
          "X-Photo-Name": encodeURIComponent(file.name),
        });
        count++;
        const preview = await makePreview(file);
        if (preview) await put("host/preview/" + id, preview, {});
      } catch (e) {
        errors.push(file.name + " — " + say(e));
      }
    }
    setNote(
      count +
        " original" +
        (count === 1 ? "" : "s") +
        " added to drafts." +
        (errors.length ? " " + errors.join(" ") : ""),
    );
    setBusy(false);
    done();
  }
  return (
    <div className="actionPanel">
      <h3>Upload originals</h3>
      <p>
        Select photos from your device or a synced Google Drive folder. Each
        original arrives as a draft.
      </p>
      <label className={"button light fileButton" + (busy ? " disabled" : "")}>
        <Icon name="photo" />
        {busy ? "Uploading…" : "Choose photos"}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,image/tiff,.heic,.heif"
          multiple
          disabled={busy}
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            void run(files);
          }}
        />
      </label>
      <Message value={note} />
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
