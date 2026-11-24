import { fail } from "./common.js";

const encoder = new TextEncoder();
const algorithm = { name: "ECDH", namedCurve: "P-256" };

function bytes64(value) {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (s) => s.charCodeAt(0));
}
function base64(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function join(...parts) {
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
export function pushPublicKey(env) {
  if (!env.WEB_PUSH_PRIVATE_JWK) return null;
  const { x, y } = JSON.parse(env.WEB_PUSH_PRIVATE_JWK);
  return base64(join(Uint8Array.of(4), bytes64(x), bytes64(y)));
}
function allowedEndpoint(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.port || u.username || u.password || u.hash || u.pathname === "/") return false;
    return u.hostname === "fcm.googleapis.com" || u.hostname === "web.push.apple.com" ||
      u.hostname.endsWith(".push.apple.com") || u.hostname.endsWith(".push.services.mozilla.com") ||
      u.hostname.endsWith(".notify.windows.com");
  } catch { return false; }
}
export async function subscribePush(env, owner, sub) {
  if (!pushPublicKey(env)) fail(503, "Phone notifications are temporarily unavailable.");
  if (!allowedEndpoint(sub.endpoint) || !/^[\w-]{87}$/.test(sub.keys?.p256dh || "") ||
      !/^[\w-]{22}$/.test(sub.keys?.auth || ""))
    fail(400, "This browser could not register for notifications.");
  try { await crypto.subtle.importKey("raw", bytes64(sub.keys.p256dh), algorithm, false, []); }
  catch { fail(400, "Please enable notifications again in this browser."); }
  const saved = await env.DB.prepare(
    "INSERT INTO push_subscriptions(endpoint,owner,p256dh,auth,delivery) " +
    "VALUES(?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM guests WHERE id=? AND status='approved') THEN ? END) " +
    "ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth WHERE owner=excluded.owner RETURNING owner",
  ).bind(sub.endpoint, owner, sub.keys.p256dh, sub.keys.auth, owner, crypto.randomUUID()).first();
  if (!saved) fail(409, "This browser already has alerts for another request. Turn them off and enable them again.");
}
async function hkdf(secret, salt, info, bits) {
  const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, material, bits));
}
// RFC 8291, one final aes128gcm record, containing only the type of album notification.
async function encrypt(row, type) {
  const user = bytes64(row.p256dh);
  const recipient = await crypto.subtle.importKey("raw", user, algorithm, false, []);
  const sender = await crypto.subtle.generateKey(algorithm, true, ["deriveBits"]);
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey("raw", sender.publicKey));
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: recipient }, sender.privateKey, 256);
  const keyInfo = join(encoder.encode("WebPush: info\0"), user, senderPublic);
  const seed = await hkdf(shared, bytes64(row.auth), keyInfo, 256);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const [keyBytes, iv] = await Promise.all([
    hkdf(seed, salt, encoder.encode("Content-Encoding: aes128gcm\0"), 128),
    hkdf(seed, salt, encoder.encode("Content-Encoding: nonce\0"), 96),
  ]);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const payload = join(encoder.encode(type), Uint8Array.of(2));
  const ciphertext = await crypto.subtle.encrypt({name:"AES-GCM", iv}, key, payload);
  return join(salt, Uint8Array.of(0, 0, 16, 0, 65), senderPublic, new Uint8Array(ciphertext));
}
async function sendPush(env, row) {
  const audience = new URL(row.endpoint).origin;
  const header = base64(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64(encoder.encode(JSON.stringify({
    aud: audience, exp: Math.floor(Date.now()/1000) + 3600,
    sub: env.WEB_PUSH_SUBJECT || "https://sriya19.github.io/SriyaFani-Engagement-Pictures/",
  })));
  const input = header + "." + claims;
  const key = await crypto.subtle.importKey("jwk", JSON.parse(env.WEB_PUSH_PRIVATE_JWK),
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(input));
  return fetch(row.endpoint, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(9000),
    headers: {
      Authorization: "vapid t=" + input + "." + base64(new Uint8Array(signature)) + ", k=" + pushPublicKey(env),
      TTL: "86400", Urgency: "high", "Content-Type": "application/octet-stream", "Content-Encoding": "aes128gcm",
    },
    body: await encrypt(row, row.owner === "hosts" ? "request" : "approved"),
  });
}
export function queuePush(db, owner, ticket) {
  return db.prepare("UPDATE push_subscriptions SET delivery=?,retry_at=0 WHERE owner=?").bind(ticket, owner);
}
export async function deliverPush(env) {
  if (!env.WEB_PUSH_PRIVATE_JWK) return;
  const now = Date.now();
  const { results } = await env.DB.prepare(
    "SELECT * FROM push_subscriptions WHERE delivery IS NOT NULL AND retry_at<=? ORDER BY retry_at LIMIT 12",
  ).bind(now).all();
  await Promise.all(results.map(async (row) => {
    const leased = await env.DB.prepare("UPDATE push_subscriptions SET retry_at=? WHERE endpoint=? AND delivery=? AND retry_at<=? RETURNING owner")
      .bind(now + 90000, row.endpoint, row.delivery, now).first();
    if (!leased) return;
    try {
      const reply = await sendPush(env, row);
      if (reply.ok) {
        await env.DB.prepare("UPDATE push_subscriptions SET delivery=NULL,retry_at=0 WHERE endpoint=? AND delivery=?")
          .bind(row.endpoint, row.delivery).run();
      } else if (reply.status === 404 || reply.status === 410) {
        await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint=? AND delivery=?").bind(row.endpoint, row.delivery).run();
      }
    } catch {
      // The durable pending delivery is retried on the next visit or studio poll.
    }
  }));
}
