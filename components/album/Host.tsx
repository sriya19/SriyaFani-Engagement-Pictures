"use client";
import { useEffect, useRef, useState } from "react";
import {
  api,
  Cover,
  Download,
  Lotus,
  Message,
  Page,
  Photo,
  say,
  size,
  when,
} from "./shared";
import Notifications from "./Notifications";
import { DrivePicker, Setup, Upload } from "./Import";
type Guest = {
  id: string;
  name: string;
  phone: string;
  status: string;
  created: number;
};
type EventRow = {
  id: number;
  guest: string;
  phone: string;
  photo: string;
  action: string;
  created: number;
};
type Note = {
  id: number;
  body: string;
  created: number;
  guest: string;
  phone: string;
};
const labels: { [key: string]: string } = {
  download: "Original download requested",
  favorite: "Added to favorites",
  unfavorite: "Removed from favorites",
};
export default function Host() {
  const [tab, setTab] = useState("photos"),
    [setup, setSetup] = useState<Setup | null>(null),
    [photos, setPhotos] = useState<Photo[]>([]),
    [guests, setGuests] = useState<Guest[]>([]),
    [confirmDelete, setConfirmDelete] = useState(""),
    [events, setEvents] = useState<EventRow[]>([]),
    [notes, setNotes] = useState<Note[]>([]),
    [next, setNext] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState("");
  const [pending, setPending] = useState(0);
  const [totals, setTotals] = useState({ total: 0, published: 0 });
  const outstanding = useRef(new Set<string>());
  const [changing, setChanging] = useState<Set<string>>(new Set());
  const [photoErrors, setPhotoErrors] = useState<Record<string, string>>({});
  async function load(target = tab, start = 0) {
    setBusy(true);
    setNote("");
    try {
      const r = await api<Page<any> & { total: number; published: number }>("host/" + target + "?offset=" + start);
      if (target === "photos") {
        setPhotos((v) => (start ? [...v, ...r.items] : r.items));
        setTotals({ total: r.total, published: r.published });
      }
      if (target === "guests")
        setGuests((v) => (start ? [...v, ...r.items] : r.items));
      if (target === "messages")
        setNotes((v) => (start ? [...v, ...r.items] : r.items));
      if (target === "activity")
        setEvents((v) => (start ? [...v, ...r.items] : r.items));
      setNext(r.next);
    } catch (e) {
      setNote(say(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (new URLSearchParams(location.search).get("tab") === "guests") setTab("guests");
  }, []);
  useEffect(() => {
    let active = true;
    async function check() {
      if (document.visibilityState !== "visible") return;
      try {
        const n = await api<{pending:number}>("host/requests-count");
        if (!active) return;
        setPending(n.pending);
        if (tab === "guests") {
          const page = await api<Page<Guest>>("host/guests");
          if (active) {
            setGuests(current => [...page.items, ...current.slice(60).filter(g => !page.items.some(item => item.id === g.id))]);
          }
        }
      } catch { /* The manual refresh remains available. */ }
    }
    void check();
    const timer = window.setInterval(check, 15000);
    window.addEventListener("focus", check);
    return () => { active=false; clearInterval(timer); window.removeEventListener("focus",check); };
  }, [tab]);
  useEffect(() => {
    api<Setup>("host/status")
      .then(setSetup)
      .catch((e) => setNote(say(e)));
  }, []);
  useEffect(() => {
    if (tab !== "import") void load(tab);
    else {
      setNext(null);
      setNote("");
    }
  }, [tab]);
  async function change(endpoint: string, data: unknown) {
    setBusy(true);
    try {
      await api("host/" + endpoint, data);
      await load();
      if (endpoint.startsWith("guest")) setPending((await api<{pending:number}>("host/requests-count")).pending);
    } catch (e) {
      setNote(say(e));
      setBusy(false);
    }
  }
  async function publish(photo: Photo) {
    if (outstanding.current.has(photo.id)) return;
    outstanding.current.add(photo.id);
    setChanging(new Set(outstanding.current));
    setPhotoErrors((old) => ({ ...old, [photo.id]: "" }));
    const published = !photo.published;
    try {
      await api("host/publish", { id: photo.id, published });
      setPhotos((current) => current.map((p) => p.id === photo.id ? { ...p, published: Number(published) } : p));
      setTotals((v) => ({ ...v, published: v.published + (published ? 1 : -1) }));
    } catch (e) {
      setPhotoErrors((old) => ({ ...old, [photo.id]: say(e) }));
    } finally {
      outstanding.current.delete(photo.id);
      setChanging(new Set(outstanding.current));
    }
  }
  return (
    <section className="content">
      <p className="eyebrow">Sriya &amp; Fani</p>
      <h1>Host studio</h1>
      <div className="tabs">
        {[
          ["photos", "Photos"],
          ["import", "Add photos"],
          ["guests", pending ? "Guest requests (" + pending + ")" : "Guest requests"],
          ["messages", "Messages"],
          ["activity", "Activity"],
        ].map(([v, t]) => (
          <button
            type="button"
            disabled={busy || changing.size > 0}
            key={v}
            aria-pressed={tab === v}
            onClick={() => setTab(v)}
          >
            {t}
          </button>
        ))}
      </div>
      {pending > 0 && tab !== "guests" && <p role="status" className="message">
        {pending === 1 ? "One guest is waiting for approval." : pending + " guests are waiting for approval."}{" "}
        <button type="button" className="textButton" onClick={() => setTab("guests")}>Review requests</button>
      </p>}
      <Message value={note} />
      {setup && (
        <div hidden={tab !== "import"}>
          <div className="setupLine">

            <span>
              Drive {setup.drive ? "connected" : "awaiting credentials"}
            </span>
            <span>Email alerts {setup.email ? "connected" : "off"}</span>
          </div>
          <Upload viewPhotos={() => setTab("photos")} />
          <DrivePicker
            setup={setup}
            update={(folder) => setSetup({ ...setup, folder })}
            done={() => {}}
          />
        </div>
      )}
      {tab === "photos" && (
        <>
          {totals.total > 0 && <p className="photoCount" aria-live="polite">{totals.total} originals · {totals.published} published · {totals.total - totals.published} drafts. Showing {photos.length} of {totals.total}.</p>}
          {!photos.length && !busy && (
            <div className="empty">
              <Lotus />
              <h3>Your album starts here</h3>
              <p>
                Add the photographs you want to share. You can review each draft
                before it appears in the guest album.
              </p>
              <button className="button" onClick={() => setTab("import")}>
                Add photos
              </button>
            </div>
          )}
          <div className="photos">
            {photos.map((p) => (
              <article key={p.id} className="photoCard">
                <Cover photo={p} />
                <div className="cardBody">
                  <b>{p.name}</b>
                  <p>
                    {size(p.bytes)} · {p.published ? "Published" : "Draft"}
                  </p>
                  <div className="actions">
                    <button
                      className="button light"
                      type="button"
                      disabled={busy || changing.has(p.id)}
                      aria-busy={changing.has(p.id)}
                      onClick={() => void publish(p)}
                    >
                      {p.published ? "Unpublish" : "Publish"}
                    </button>
                    <Download photo={p} />
                  </div>
                  <Message value={photoErrors[p.id] || ""} />
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {tab === "guests" && (
        <>
          <Notifications host registered />
          {guests.length ? (
            <div className="records">
              {guests.map((g) => (
                <article className="record" key={g.id}>
                  <div>
                    <strong>{g.name}</strong>
                    <span>
                      {g.phone} · {g.status}
                    </span>
                    <small>{when(g.created)}</small>
                  </div>
                  <div className="actions">
                    {g.status !== "approved" && (
                      <button
                        className="button light"
                        disabled={busy}
                        onClick={() =>
                          change("guest", { id: g.id, status: "approved" })
                        }
                      >
                        Approve
                      </button>
                    )}
                    {g.status === "pending" && (
                      <button
                        className="textButton"
                        disabled={busy}
                        onClick={() =>
                          change("guest", { id: g.id, status: "denied" })
                        }
                      >
                        Decline
                      </button>
                    )}
                    {g.status === "approved" && (
                      <button
                        className="textButton"
                        disabled={busy}
                        onClick={() =>
                          change("guest", { id: g.id, status: "revoked" })
                        }
                      >
                        Revoke access
                      </button>
                    )}
                    {g.status !== "approved" && (
                      <button
                        className="textButton deleteGuest"
                        disabled={busy}
                        onClick={() => {
                          if (confirmDelete !== g.id) return setConfirmDelete(g.id);
                          setConfirmDelete("");
                          void change("guest/delete", { id: g.id });
                        }}
                        onBlur={() => setConfirmDelete((c) => (c === g.id ? "" : c))}
                      >
                        {confirmDelete === g.id ? "Tap again to delete" : "Delete"}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            !busy && (
              <div className="empty">
                <h3>No guest requests yet</h3>
                <p>
                  New requests appear here when guests submit their name and mobile number.
                </p>
              </div>
            )
          )}
        </>
      )}
      {tab === "messages" && (
        <>
          {notes.length ? (
            <div className="notes">
              {notes.map((n) => (
                <article className="noteCard" key={n.id}>
                  <p>{n.body}</p>
                  <footer>
                    <span>
                      <strong>{n.guest}</strong>
                      <small>{n.phone} · {when(n.created)}</small>
                    </span>
                    <button
                      className="textButton deleteGuest"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (confirmDelete !== "note" + n.id) return setConfirmDelete("note" + n.id);
                        setConfirmDelete("");
                        void change("messages/delete", { id: n.id });
                      }}
                      onBlur={() => setConfirmDelete((c) => (c === "note" + n.id ? "" : c))}
                    >
                      {confirmDelete === "note" + n.id ? "Tap again to delete" : "Delete"}
                    </button>
                  </footer>
                </article>
              ))}
            </div>
          ) : (
            !busy && (
              <div className="empty">
                <Lotus />
                <h3>No notes yet</h3>
                <p>Notes guests leave at the end of the album appear here. Only hosts can read them.</p>
              </div>
            )
          )}
        </>
      )}
      {tab === "activity" && (
        <>
          {events.length ? (
            <div className="records">
              {events.map((e) => (
                <article className="record" key={e.id}>
                  <div>
                    <strong>{labels[e.action]}</strong>
                    <span>{e.photo}</span>
                    <small>
                      {e.guest} · {e.phone}
                    </small>
                  </div>
                  <small>{when(e.created)}</small>
                </article>
              ))}
            </div>
          ) : (
            !busy && (
              <div className="empty">
                <h3>No activity yet</h3>
                <p>
                  Guest favorites and original download requests appear here
                  with the photo, guest and time.
                </p>
              </div>
            )
          )}
        </>
      )}
      {tab !== "import" && (
        <div className="actions">
          <button type="button" className="textButton" disabled={busy || changing.size > 0} onClick={() => load()}>
            {busy ? "Loading…" : "Refresh"}
          </button>
          {next !== null && (
            <button
              className="button light"
              type="button"
              disabled={busy || changing.size > 0}
              onClick={() => load(tab, next)}
            >
              Show more
            </button>
          )}
        </div>
      )}
    </section>
  );
}
