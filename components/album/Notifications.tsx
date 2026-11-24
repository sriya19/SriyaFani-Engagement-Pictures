"use client";
import { useEffect, useState } from "react";
import { api, say } from "./shared";

function device() {
  const apple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
  if (apple && !standalone) return "install";
  if (!("serviceWorker" in navigator && "PushManager" in window && "Notification" in window)) return "unsupported";
  return Notification.permission === "denied" ? "blocked" : "ready";
}
async function prepare() {
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  const root = new URL("./", link?.href || location.href);
  const result = await api<{ key: string | null }>("notifications/key");
  if (!result.key) throw Error("Phone notifications are temporarily unavailable. You can still check access here.");
  await navigator.serviceWorker.register(new URL("album-push.js", root), {scope:root.pathname});
  const registration = await navigator.serviceWorker.ready;
  const binary = atob(result.key.replace(/-/g,"+").replace(/_/g,"/"));
  return { registration, key: Uint8Array.from(binary, c => c.charCodeAt(0)) };
}
export default function Notifications({ host = false, registered }: { host?: boolean; registered: boolean }) {
  const [mode, setMode] = useState("loading");
  const [status, setStatus] = useState<"off" | "busy" | "on">("off");
  const [context, setContext] = useState<Awaited<ReturnType<typeof prepare>> | null>(null);
  const [note, setNote] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const mode = device();
    setMode(mode);
    if (mode === "ready") {
      prepare().then(async (ctx) => {
        if (!active) return;
        setContext(ctx);
        const sub = await ctx.registration.pushManager.getSubscription();
        if (sub && active) {
          if (registered) await api("notifications/subscribe", sub.toJSON());
          if (active) setStatus("on");
        }
      }).catch(e => { if (active) setNote(say(e)); });
    }
    return () => { active = false; };
  }, [registered, retry]);
  async function enable() {
    setNote("");
    if (!context) { setRetry(v=>v+1); return; }
    setStatus("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMode(permission === "denied" ? "blocked" : "ready");
        setNote(permission === "default" ? "You can turn these on later." : "");
        setStatus("off"); return;
      }
      const manager = context.registration.pushManager;
      const sub = await manager.getSubscription() || await manager.subscribe({userVisibleOnly:true, applicationServerKey:context.key});
      if (registered) await api("notifications/subscribe", sub.toJSON());
      setStatus("on");
    } catch (e) {
      setNote(say(e)); setStatus("off");
    }
  }
  const title = host ? "Get notified about guest requests" : "Get notified when you’re approved";
  const detail = host ? "We’ll alert this device when a guest asks to see the album." : "When Sriya or Fani approves your request, tap the notification to open the album.";
  return <aside className="pushPrompt" aria-label="Phone notifications">
    <strong>{status === "on" ? "Notifications enabled on this device" : title}</strong>
    {mode === "install" ? <p>On iPhone or iPad, open this link in Safari, tap <b>Share → Add to Home Screen</b>, and open the new icon. {host ? "In Guest requests, tap Enable notifications." : "Submit your request from the icon and tap Enable notifications."}</p> :
     mode === "unsupported" ? <p>Open this link in a browser that supports phone notifications. You can also return here to check {host ? "guest requests" : "your approval"}.</p> :
     mode === "blocked" ? <p>Allow notifications in this device’s settings for the album. You can also return here for updates.</p> :
     <><p>{status === "on" && !registered ? "Submit your request below to finish setting up your approval alert." : detail}</p>
       {status !== "on" && <button type="button" className="button light" disabled={status === "busy" || (!context && !note)} onClick={enable}>
         {status === "busy" ? "Enabling…" : "Enable notifications"}
       </button>}</>}
    {note && <p role="status">{note}</p>}
  </aside>;
}
