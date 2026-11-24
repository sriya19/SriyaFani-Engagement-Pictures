type Credential = "challenge" | "session";
let guestEndpoint = "";
let storagePrefix = "";
const tokens: Partial<Record<Credential, string>> = {};

export function configureGuestWebsite(origin: string, basePath: string) {
  guestEndpoint = new URL("/api/guest/", origin).href;
  storagePrefix = "sf-album:" + basePath + ":";
  for (const kind of ["challenge", "session"] as const) {
    try {
      const value = sessionStorage.getItem(storagePrefix + kind);
      if (value && /^[a-f0-9]{64}$/.test(value)) tokens[kind] = value;
    } catch {
      // Private browsers can still complete verification in the current page.
    }
  }
}
export function isGuestWebsite() {
  return Boolean(guestEndpoint);
}
function setToken(kind: Credential, value?: string) {
  tokens[kind] = value;
  try {
    if (value) sessionStorage.setItem(storagePrefix + kind, value);
    else sessionStorage.removeItem(storagePrefix + kind);
  } catch {
    // The in-memory session is sufficient when tab storage is unavailable.
  }
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
  if (!guestEndpoint) return;
  if (path === "otp/start" && result.challenge) setToken("challenge", result.challenge);
  if (path === "otp/check" && result.session) {
    setToken("session", result.session);
    setToken("challenge");
  }
  if (path === "logout") {
    setToken("session");
    setToken("challenge");
  }
}
