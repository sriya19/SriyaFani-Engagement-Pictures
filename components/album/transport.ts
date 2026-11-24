type Credential = "challenge" | "session";
let guestEndpoint = "";
let storagePrefix = "sf-album:/:";

const tokens: Partial<Record<Credential, string>> = {};
let pendingTicket = "";
export function configureGuestWebsite(origin: string, basePath: string) {
  guestEndpoint = new URL("/api/guest/", origin).href;
  storagePrefix = "sf-album:" + basePath + ":";
  for (const kind of ["challenge", "session"] as const) {
    try {
      const value = (kind === "session" ? localStorage.getItem(storagePrefix + kind) : null) || sessionStorage.getItem(storagePrefix + kind);
      if (value && /^[a-f0-9]{64}$/.test(value)) setToken(kind, value);
    } catch { /* An in-memory session still works on this visit. */ }
  }
}
export function requestTicket() {
  try { pendingTicket ||= localStorage.getItem(storagePrefix + "request") || ""; } catch {}
  if (!/^[a-f0-9]{64}$/.test(pendingTicket)) {
    pendingTicket = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,"0")).join("");
    try { localStorage.setItem(storagePrefix + "request", pendingTicket); } catch {}
  }
  return pendingTicket;
}
function clearTicket() {
  pendingTicket = "";
  try { localStorage.removeItem(storagePrefix + "request"); } catch {}
}
export function isGuestWebsite() { return Boolean(guestEndpoint); }
function setToken(kind: Credential, value?: string) {
  tokens[kind] = value;
  try {
    const storage = kind === "session" ? localStorage : sessionStorage;
    if (value) storage.setItem(storagePrefix + kind, value);
    else storage.removeItem(storagePrefix + kind);
    if (kind === "session") sessionStorage.removeItem(storagePrefix + kind);
  } catch { /* Keep the in-memory token when browser storage is unavailable. */ }
}
export function albumFetch(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (guestEndpoint) {
    const token = tokens[path === "otp/check" ? "challenge" : "session"];
    if (token && path !== "otp/start") headers.set("Authorization", "Bearer " + token);
  }
  return fetch((guestEndpoint || "/api/") + path, {
    ...options, headers, cache: "no-store", referrerPolicy: "no-referrer",
    credentials: guestEndpoint ? "omit" : "same-origin",
  });
}
export function acceptGuestResponse(path: string, result: { challenge?: string; session?: string }) {
  if (path === "access/request" || path === "logout") clearTicket();
  if (!guestEndpoint) return;
  if (path === "otp/start" && result.challenge) setToken("challenge", result.challenge);
  if ((path === "access/request" || path === "otp/check") && result.session) {
    setToken("session", result.session);
    setToken("challenge");
  }
  if (path === "logout") { setToken("session"); setToken("challenge"); }
}
