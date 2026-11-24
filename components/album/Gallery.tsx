"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  api,
  Cover,
  Download,
  Icon,
  Lotus,
  Me,
  Message,
  Page,
  Photo,
  say,
  size,
} from "./shared";

const VIEWER_STATE = "sfViewer";
const viewerInHistory = () =>
  Boolean((history.state as Record<string, unknown> | null)?.[VIEWER_STATE]);

export default function Gallery({ me }: { me: Me }) {
  const guest = me.role === "guest";
  const [items, setItems] = useState<Photo[]>([]),
    [next, setNext] = useState<number | null>(null),
    [saved, setSaved] = useState(false),
    [open, setOpen] = useState<number | null>(null),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    // Photos un-hearted on the favorites tab stay in the viewer until it closes,
    // so the picture doesn't vanish from under the guest's finger.
    [keep, setKeep] = useState<ReadonlySet<string>>(new Set()),
    [message, setMessage] = useState("");
  const request = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);

  async function get(start: number, only: boolean) {
    const ticket = ++request.current;
    setLoading(true);
    setMessage("");
    try {
      const data = await api<Page<Photo>>(
        "photos?offset=" + start + (only ? "&favorites=1" : ""),
      );
      if (ticket !== request.current) return;
      setItems((old) => {
        if (!start) return data.items;
        const seen = new Set(old.map((i) => i.id));
        return [...old, ...data.items.filter((i) => !seen.has(i.id))];
      });
      setNext(data.next);
    } catch (e) {
      if (ticket === request.current) setMessage(say(e));
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    setKeep(new Set());
    void get(0, saved);
  }, [saved]);

  const visible = saved
    ? items.filter((i) => i.favorite || keep.has(i.id))
    : items;

  function more() {
    if (next !== null && !loading) void get(next, saved);
  }
  const moreRef = useRef(more);
  moreRef.current = more;

  // Load the next page automatically as the guest scrolls toward the end.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || next === null || typeof IntersectionObserver === "undefined")
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) moreRef.current();
      },
      { rootMargin: "900px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [next, loading]);

  async function toggle(p: Photo) {
    if (saving) return;
    setSaving(true);
    try {
      const { favorite } = await api("photos/" + p.id + "/favorite", {
        on: !p.favorite,
      });
      setItems((old) =>
        old.map((i) =>
          i.id === p.id ? { ...i, favorite: favorite ? 1 : 0 } : i,
        ),
      );
      if (saved && !favorite) setKeep((k) => new Set(k).add(p.id));
    } catch (e) {
      setMessage(say(e));
    } finally {
      setSaving(false);
    }
  }

  // The phone's back button / back swipe closes the viewer instead of
  // leaving the album.
  function show(i: number) {
    setMessage("");
    setOpen(i);
    try {
      history.pushState({ ...(history.state || {}), [VIEWER_STATE]: true }, "");
    } catch {
      /* The close button still works without history support. */
    }
  }
  const lastId = useRef("");
  function finish() {
    setOpen(null);
    setKeep(new Set());
    const id = lastId.current;
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>('[data-photo="' + id + '"]')
        ?.scrollIntoView({ block: "center" }),
    );
  }
  function close() {
    if (viewerInHistory()) history.back();
    else finish();
  }
  const isOpen = open !== null;
  useEffect(() => {
    if (!isOpen) return;
    const onPop = () => {
      if (!viewerInHistory()) finish();
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [isOpen]);

  const at = open === null ? 0 : Math.min(open, visible.length - 1);
  if (open !== null && visible[at]) lastId.current = visible[at].id;

  return (
    <section className="content">
      <p className="eyebrow">Sriya &amp; Fani</p>
      <h1>The engagement album</h1>
      <div className="tabs">
        <button aria-pressed={!saved} onClick={() => setSaved(false)}>
          All photos
        </button>
        {guest && (
          <button aria-pressed={saved} onClick={() => setSaved(true)}>
            My favorites
          </button>
        )}
      </div>
      {visible.length > 0 && (
        <p className="galleryHint">
          Tap any photo to see it full screen, then swipe to browse.
        </p>
      )}
      {open === null && <Message value={message} />}
      {!visible.length && !loading && !message && (
        <div className="empty">
          <Lotus />
          <h3>{saved ? "Your favorites" : "The album is being prepared"}</h3>
          <p>
            {saved
              ? "Open a photo and tap the heart to save it here."
              : "Selected photographs will appear here when the hosts publish them."}
          </p>
        </div>
      )}
      <div className="galleryGrid">
        {visible.map((p, i) => (
          <button
            key={p.id}
            className="tile"
            data-photo={p.id}
            onClick={() => show(i)}
            aria-label={"View " + p.name + " full screen"}
          >
            <Cover photo={p} />
            {guest && p.favorite ? (
              <span className="tileHeart" aria-hidden="true">
                <Icon name="heart" />
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <div ref={sentinel} className="sentinel" aria-hidden="true" />
      {loading && <p role="status">Loading…</p>}
      {next !== null && !loading && (
        <button className="button light moreButton" onClick={more}>
          More photos
        </button>
      )}
      {open !== null && visible[at] && (
        <Viewer
          photos={visible}
          index={at}
          guest={guest}
          saving={saving}
          hasMore={next !== null}
          message={message}
          onIndex={setOpen}
          onToggle={toggle}
          onNearEnd={more}
          onClose={close}
        />
      )}
    </section>
  );
}

function Viewer({
  photos,
  index,
  guest,
  saving,
  hasMore,
  message,
  onIndex,
  onToggle,
  onNearEnd,
  onClose,
}: {
  photos: Photo[];
  index: number;
  guest: boolean;
  saving: boolean;
  hasMore: boolean;
  message: string;
  onIndex: (i: number) => void;
  onToggle: (p: Photo) => void;
  onNearEnd: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const indexRef = useRef(index);
  indexRef.current = index;
  const countRef = useRef(photos.length);
  countRef.current = photos.length;
  const [chrome, setChrome] = useState(true);
  const current = photos[index];

  useEffect(() => {
    const d = dialog.current;
    d?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      d?.close();
      document.body.style.overflow = previous;
      cancelAnimationFrame(frame.current);
    };
  }, []);

  // Start on the tapped photo, and stay on it when the phone rotates.
  useLayoutEffect(() => {
    const t = track.current;
    if (!t) return;
    let width = 0;
    const align = () => {
      if (t.clientWidth === width) return;
      width = t.clientWidth;
      t.scrollLeft = indexRef.current * width;
    };
    align();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(align);
    observer.observe(t);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (hasMore && index >= photos.length - 4) onNearEnd();
  }, [index, photos.length, hasMore]);

  function onScroll() {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const t = track.current;
      if (!t || !t.clientWidth) return;
      const i = Math.max(
        0,
        Math.min(countRef.current - 1, Math.round(t.scrollLeft / t.clientWidth)),
      );
      if (i !== indexRef.current) onIndex(i);
    });
  }
  function go(step: number) {
    const t = track.current;
    const target = indexRef.current + step;
    if (!t || target < 0 || target >= countRef.current) return;
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    t.scrollTo({ left: target * t.clientWidth, behavior: calm ? "auto" : "smooth" });
  }

  return (
    <dialog
      ref={dialog}
      className={"viewer" + (chrome ? "" : " bare")}
      aria-label={"Photo " + (index + 1) + " of " + photos.length}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(1);
        else if (e.key === "ArrowLeft") go(-1);
      }}
    >
      <div className="viewerTrack" ref={track} onScroll={onScroll}>
        {photos.map((p, i) => (
          <div
            key={p.id}
            className="viewerSlide"
            role="group"
            aria-roledescription="slide"
            aria-label={p.name}
            aria-hidden={i !== index}
            onClick={() => setChrome((c) => !c)}
          >
            {Math.abs(i - index) <= 2 ? <Cover photo={p} eager /> : null}
          </div>
        ))}
      </div>
      <div className="viewerBar viewerTop">
        <span className="viewerCount" aria-live="polite">
          {index + 1} / {photos.length}
          {hasMore ? "+" : ""}
        </span>
        <button
          className="viewerIcon"
          aria-label="Close photo viewer"
          onClick={onClose}
          autoFocus
        >
          <Icon name="close" />
        </button>
      </div>
      {index > 0 && (
        <button
          className="viewerIcon viewerNav viewerPrev"
          aria-label="Previous photo"
          onClick={() => go(-1)}
        >
          <Chevron flip />
        </button>
      )}
      {index < photos.length - 1 && (
        <button
          className="viewerIcon viewerNav viewerNext"
          aria-label="Next photo"
          onClick={() => go(1)}
        >
          <Chevron />
        </button>
      )}
      <div className="viewerBar viewerBottom">
        <div className="viewerMeta">
          <div className="viewerInfo">
            <span>{current.name}</span>
            <small>{size(current.bytes)} · Original file</small>
          </div>
          {guest && (
            <button
              className={"viewerIcon" + (current.favorite ? " activeHeart" : "")}
              aria-label={current.favorite ? "Remove from favorites" : "Add to favorites"}
              aria-pressed={Boolean(current.favorite)}
              disabled={saving}
              onClick={() => onToggle(current)}
            >
              <Icon name="heart" />
            </button>
          )}
        </div>
        <div className="viewerActions">
          <Download key={current.id} photo={current} />
        </div>
        <Message value={message} />
      </div>
    </dialog>
  );
}

function Chevron({ flip = false }: { flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={flip ? "flipX" : undefined}
    >
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}
