"use client";
import { useCallback, useEffect, useState } from "react";
import { api, Icon, Kolam, Lotus, Me, Message, Modal, say } from "./shared";
import Access from "./Access";
import Gallery from "./Gallery";
import Host from "./Host";
export default function Album({ hostPage = false, switchHostAccount, homePath = "/", guestOnly = false }: {
  hostPage?: boolean;
  switchHostAccount?: string;
  homePath?: string;
  guestOnly?: boolean;
}) {
  const [me, setMe] = useState<Me>({ role: "visitor" }),
    [ready, setReady] = useState(false),
    [opened, setOpened] = useState(false),
    [dialog, setDialog] = useState<"access" | "note" | "privacy" | null>(null),
    [note, setNote] = useState("");
  const refresh = useCallback(async () => {
    const a = await api<Me>("me");
    setMe(a);
    setReady(true);
    if (a.role === "host" || a.status === "approved") {
      setDialog(null);
      setOpened(true);
    }
    return a;
  }, []);
  useEffect(() => {
    api<Me>("me")
      .then((a) => {
        setMe(a);
        if (
          !hostPage &&
          (new URLSearchParams(location.search).get("album") === "1" || a.role === "guest")
        ) {
          if (a.role === "host" || a.status === "approved") setOpened(true);
          else setDialog("access");
        }
      })
      .catch((e) => setNote(say(e)))
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (hostPage || me.status !== "pending") return;
    let active = true;
    async function check() {
      if (document.visibilityState !== "visible") return;
      try {
        const a = await api<Me>("me");
        if (!active || a.status === "pending") return;
        setMe(a);
        if (a.status === "approved") {
          setDialog(null); setOpened(true);
          setNote("Your request was approved. Welcome to the album!");
        }
      } catch { /* Another check runs when the browser regains focus. */ }
    }
    const timer = window.setInterval(check, 10000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => { active=false; clearInterval(timer); document.removeEventListener("visibilitychange",check); window.removeEventListener("focus",check); };
  }, [hostPage, me.status]);
  function enter() {
    if (me.role === "host" || me.status === "approved") {
      setOpened(true);
      setDialog(null);
    } else setDialog("access");
  }
  const home = !hostPage && !opened;
  return (
    <>
      <header className="mast">
        <div className="shell nav">
          <a className="mark" href={homePath} aria-label="Sriya and Fani invitation">
            <Lotus />
            Sriya <i>&amp;</i> Fani
          </a>
          <nav aria-label="Main navigation">
            <a className={"navLink" + (home ? " current" : "")} href={homePath}>
              Invitation
            </a>
            <button
              className="navAccess"
              disabled={!ready}
              onClick={
                hostPage
                  ? () => {
                      location.assign("/?album=1");
                    }
                  : enter
              }
            >
              <Icon name="lock" />
              Guest access
            </button>
          </nav>
        </div>
      </header>
      <main>
        {home ? (
          <section className="hero shell">
            <div className="heroText">
              <div className="eyebrow heroTag">
                <span />
                The engagement album
              </div>
              <h1 className="couple">
                Sriya <em>&amp;</em>
                <br />
                <span>Fani</span>
              </h1>
              <div className="motifRule" aria-hidden="true">
                <b />
                <Kolam />
                <b />
              </div>
              <p className="lede">
                Our engagement photographs, gathered here for the family and
                friends who mean the most to us.
              </p>
              <div className="heroActions">
                <button
                  className="button inviteButton"
                  onClick={enter}
                  disabled={!ready}
                >
                  <Icon name="album" />
                  Open the album
                </button>
                <button className="noteLink" onClick={() => setDialog("note")}>
                  A note from us
                </button>
              </div>
            </div>
            <div className="artwork">
              <div className="engrave cornerOne" />
              <div className="engrave cornerTwo" />
              <div className="engrave cornerThree" />
              <div className="engrave cornerFour" />
              <div className="archLine">
                <div className="arch">
                  <img
                    className="heroImage"
                    src={homePath + "lotus-pond.webp"}
                    alt="Pink lotuses bloom above a still green pond in a hand-painted botanical illustration."
                    fetchPriority="high"
                  />
                </div>
              </div>
              <div className="artSeal" aria-hidden="true">
                <Lotus />
              </div>
            </div>
          </section>
        ) : hostPage ? (
          <>
            {!ready ? (
              <section className="content">
                <p>Opening host studio…</p>
              </section>
            ) : me.role === "host" ? (
              <Host />
            ) : switchHostAccount ? (
              <section className="standalone">
                <div className="formBox">
                  <Lotus className="formLotus" />
                  <h2>Host studio</h2>
                  <p>Sign in with Sriya or Fani’s host account to manage the album.</p>
                  <a className="button" href={switchHostAccount} target="_top">Switch account</a>
                </div>
              </section>
            ) : (
              <section className="standalone">
                <Access me={me} refresh={refresh} hostPage />
              </section>
            )}
          </>
        ) : (
          <Gallery me={me} />
        )}
        <Message value={note} />
      </main>
      <footer className="footer">
        <div className="weave" aria-hidden="true" />
        <div className="shell footInner">
          <span>
            With love, <i>Sriya &amp; Fani</i>
          </span>
          <div>
            <button className="plain" onClick={() => setDialog("privacy")}>
              Album privacy
            </button>
            {!guestOnly && <><span aria-hidden="true">·</span><a href="/host" target="_top">Host studio</a></>}
            {me.role === "guest" && (
              <button
                className="plain"
                onClick={async () => {
                  try {
                    await api("logout", {});
                    location.assign(homePath);
                  } catch (e) {
                    setNote(say(e));
                  }
                }}
              >
                Sign out
              </button>
            )}
          </div>
        </div>
      </footer>
      {dialog && (
        <Modal
          title={
            dialog === "access"
              ? "Guest access"
              : dialog === "note"
                ? "A note from us"
                : "Album privacy"
          }
          close={() => setDialog(null)}
        >
          {dialog === "access" ? (
            <Access me={me} refresh={refresh} />
          ) : dialog === "note" ? (
            <div className="letter">
              <Lotus className="formLotus" />
              <p className="eyebrow">To our family &amp; friends</p>
              <h2>A note from us</h2>
              <p>
                We wanted a place where you could return to this day with us. We
                hope you find a photograph that makes you smile, or a moment
                you’ll want to keep.
              </p>
              <p>Thank you for being part of our story.</p>
              <p className="signature">
                With love,
                <br />
                Sriya &amp; Fani
              </p>
              <button className="button" onClick={enter}>
                Open the album
              </button>
            </div>
          ) : (
            <div className="letter">
              <Icon name="lock" />
              <h2>Album privacy</h2>
              <p>
                We use the name and mobile number you submit to review your request. Access belongs to the browser you used to request it.
                The hosts can see which photos you favorite or request to
                download, along with the time.
              </p>
              <p>
                Downloads contain the original photo files. Please share these
                family photographs with care.
              </p>
              <button className="button light" onClick={() => setDialog(null)}>
                Close
              </button>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
