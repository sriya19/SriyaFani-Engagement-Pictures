"use client";
import { useEffect, useState } from "react";
import {
  api,
  Cover,
  Download,
  Icon,
  Lotus,
  Me,
  Message,
  Modal,
  Page,
  Photo,
  say,
  size,
} from "./shared";
export default function Gallery({ me }: { me: Me }) {
  const [items, setItems] = useState<Photo[]>([]),
    [next, setNext] = useState<number | null>(null),
    [saved, setSaved] = useState(false),
    [show, setShow] = useState<Photo | null>(null),
    [busy, setBusy] = useState(true),
    [message, setMessage] = useState("");
  async function get(start: number, only: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const data = await api<Page<Photo>>(
        "photos?offset=" + start + (only ? "&favorites=1" : ""),
      );
      setItems((old) => (start ? [...old, ...data.items] : data.items));
      setNext(data.next);
    } catch (e) {
      setMessage(say(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void get(0, saved);
  }, [saved]);
  async function toggle(p: Photo) {
    if (busy) return;
    setBusy(true);
    try {
      const { favorite } = await api("photos/" + p.id + "/favorite", {
        on: !p.favorite,
      });
      const changed = { ...p, favorite: favorite ? 1 : 0 };
      setItems((old) =>
        old
          .map((i) => (i.id === p.id ? changed : i))
          .filter((i) => !saved || i.favorite),
      );
      if (show?.id === p.id) setShow(changed);
    } catch (e) {
      setMessage(say(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="content">
      <p className="eyebrow">Sriya &amp; Fani</p>
      <h1>The engagement album</h1>
      <div className="tabs">
        <button aria-pressed={!saved} onClick={() => setSaved(false)}>
          All photos
        </button>
        {me.role === "guest" && (
          <button aria-pressed={saved} onClick={() => setSaved(true)}>
            My favorites
          </button>
        )}
      </div>
      <Message value={message} />
      {!items.length && !busy && !message && (
        <div className="empty">
          <Lotus />
          <h3>{saved ? "Your favorites" : "The album is being prepared"}</h3>
          <p>
            {saved
              ? "Tap the heart on a photo to save it here."
              : "Selected photographs will appear here when the hosts publish them."}
          </p>
        </div>
      )}
      <div className="photos">
        {items.map((p) => (
          <article className="photoCard" key={p.id}>
            <button
              className="imageButton"
              onClick={() => setShow(p)}
              aria-label={"Open " + p.name}
            >
              <Cover photo={p} />
            </button>
            <div className="photoMeta">
              <button className="plain titleButton" onClick={() => setShow(p)}>
                {p.name}
              </button>
              {me.role === "guest" && (
                <button
                  className={"iconButton" + (p.favorite ? " activeHeart" : "")}
                  aria-label={
                    (p.favorite ? "Remove favorite " : "Favorite ") + p.name
                  }
                  aria-pressed={Boolean(p.favorite)}
                  disabled={busy}
                  onClick={() => toggle(p)}
                >
                  <Icon name="heart" />
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {busy && <p role="status">Loading…</p>}
      {next !== null && (
        <button
          className="button light"
          disabled={busy}
          onClick={() => get(next, saved)}
        >
          More photos
        </button>
      )}
      {show && (
        <Modal wide title={show.name} close={() => setShow(null)}>
          <div className="lightbox">
            <Cover photo={show} />
          </div>
          <h3>{show.name}</h3>
          <p>{size(show.bytes)} · Original file</p>
          <div className="actions">
            <Download photo={show} />
            {me.role === "guest" && (
              <button
                className="button light"
                disabled={busy}
                aria-pressed={Boolean(show.favorite)}
                onClick={() => toggle(show)}
              >
                <Icon name="heart" />
                {show.favorite ? "Favorited" : "Favorite"}
              </button>
            )}
          </div>
          <Message value={message} />
        </Modal>
      )}
    </section>
  );
}
