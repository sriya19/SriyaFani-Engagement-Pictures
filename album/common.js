export class AlbumError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function fail(status, message) {
  throw new AlbumError(status, message);
}
export const privateHeaders = {
  "Cache-Control": "private, no-store, no-transform",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};
export function json(value, status = 200, extra = {}) {
  return Response.json(value, {
    status,
    headers: { ...privateHeaders, ...extra },
  });
}
export function cookie(request, name, value, seconds) {
  const secure = new URL(request.url).protocol === "https:";
  return (
    (secure ? "__Host-" : "") +
    "sf_" +
    name +
    "=" +
    value +
    "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" +
    seconds +
    (secure ? "; Secure" : "")
  );
}
export function readCookie(request, name) {
  const key =
    (new URL(request.url).protocol === "https:" ? "__Host-" : "") +
    "sf_" +
    name +
    "=";
  return (
    (request.headers.get("Cookie") || "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(key))
      ?.slice(key.length) || ""
  );
}
export function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function digest(text) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function sameOrigin(request) {
  if (
    request.headers.get("Origin") !== new URL(request.url).origin ||
    request.headers.get("Sec-Fetch-Site") === "cross-site"
  )
    fail(403, "Please try again from the album.");
}
export async function body(request) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    fail(415, "Please send a JSON request.");
  if (Number(request.headers.get("Content-Length")) > 8192)
    fail(413, "This form is too large.");
  const text = await request.text();
  if (text.length > 8192) fail(413, "This form is too large.");
  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object" && !Array.isArray(data)) return data;
  } catch {}
  fail(400, "Please check the form and try again.");
}
export const photoTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/tiff",
]);
export function attachment(name) {
  const safe = name.replace(/[\u0000-\u001f\u007f\\/]/g, "_");
  const ascii = safe.replace(/[^a-zA-Z0-9._ -]/g, "_") || "photo";
  return (
    'attachment; filename="' +
    ascii +
    "\"; filename*=UTF-8''" +
    encodeURIComponent(safe).replace(
      /['()*]/g,
      (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
    )
  );
}
