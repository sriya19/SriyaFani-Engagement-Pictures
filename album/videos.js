import { body, fail, json, privateHeaders } from "./common.js";

// Videos are stored in the private bucket and uploaded in parts, so phone
// videos far larger than one request can be added from the host studio.
// Guests play them through short-lived signed links, because a <video>
// element cannot send the guest's bearer token.
export const PART_SIZE = 50 * 1024 * 1024;
const MAX_BYTES = 4 * 1024 * 1024 * 1024;
const LINK_SECONDS = 6 * 3600;
const videoTypes = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"]);
const key = (id) => "videos/" + id;
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

async function signingKey(db) {
  await db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('video_signing_key',?)")
    .bind(hex(crypto.getRandomValues(new Uint8Array(32)))).run();
  const row = await db.prepare("SELECT value FROM settings WHERE key='video_signing_key'").first();
  return crypto.subtle.importKey("raw", new TextEncoder().encode(row.value), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
async function signature(db, id, exp) {
  return hex(await crypto.subtle.sign("HMAC", await signingKey(db), new TextEncoder().encode(id + "." + exp)));
}
async function link(db, origin, id) {
  const exp = Math.floor(Date.now() / 1000) + LINK_SECONDS;
  return origin + "/api/videos/" + id + "/stream?exp=" + exp + "&sig=" + (await signature(db, id, exp));
}
function equal(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function streamVideo(request, env, id) {
  const url = new URL(request.url),
    exp = Number(url.searchParams.get("exp")),
    sig = url.searchParams.get("sig") || "";
  if (!Number.isSafeInteger(exp) || exp < Date.now() / 1000 || !/^[a-f0-9]{64}$/.test(sig))
    fail(403, "This video link has expired. Please reopen the album.");
  if (!equal(sig, await signature(env.DB, id, exp))) fail(403, "This video link is not valid.");
  const item = await env.DB.prepare("SELECT mime,bytes FROM videos WHERE id=? AND status='ready'").bind(id).first();
  if (!item) fail(404, "Video unavailable.");
  const headers = {
    ...privateHeaders,
    "Cache-Control": "private, max-age=3600",
    "Content-Type": item.mime,
    "Accept-Ranges": "bytes",
  };
  const range = (request.headers.get("Range") || "").match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    let start, end;
    if (range[1]) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), item.bytes - 1) : item.bytes - 1;
    } else {
      start = Math.max(0, item.bytes - Number(range[2]));
      end = item.bytes - 1;
    }
    if (start > end || start >= item.bytes)
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": "bytes */" + item.bytes } });
    const object = await env.BUCKET.get(key(id), { range: { offset: start, length: end - start + 1 } });
    if (!object) fail(404, "Video unavailable.");
    return new Response(object.body, {
      status: 206,
      headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": "bytes " + start + "-" + end + "/" + item.bytes },
    });
  }
  const object = await env.BUCKET.get(key(id));
  if (!object) fail(404, "Video unavailable.");
  return new Response(object.body, { headers: { ...headers, "Content-Length": String(item.bytes) } });
}

export async function guestVideos(env, origin) {
  const { results } = await env.DB.prepare(
    "SELECT id,title,mime FROM videos WHERE published=1 AND status='ready' ORDER BY created DESC,id",
  ).all();
  return json({ items: await Promise.all(results.map(async (v) => ({ ...v, link: await link(env.DB, origin, v.id) }))) });
}

export async function hostVideos(env, origin) {
  const { results } = await env.DB.prepare(
    "SELECT id,name,title,mime,bytes,status,published,created FROM videos ORDER BY created DESC,id",
  ).all();
  return json({
    items: await Promise.all(results.map(async (v) => ({ ...v, link: v.status === "ready" ? await link(env.DB, origin, v.id) : null }))),
    partSize: PART_SIZE,
  });
}

export async function startVideo(request, env) {
  const input = await body(request);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim().slice(0, 120) : name.replace(/\.[^.]+$/, "");
  if (!videoTypes.has(input.mime) || !name || name.length > 240 || /[\x00-\x1f\x7f/\\]/.test(name))
    fail(400, "Choose an MP4, MOV or WebM video with a valid filename.");
  if (!Number.isSafeInteger(input.bytes) || input.bytes < 1 || input.bytes > MAX_BYTES)
    fail(413, "Choose a video under 4 GB.");
  const id = crypto.randomUUID();
  const upload = await env.BUCKET.createMultipartUpload(key(id), { httpMetadata: { contentType: input.mime } });
  await env.DB.prepare("INSERT INTO videos(id,name,title,mime,bytes,upload_id,status,published,created) VALUES(?,?,?,?,?,?, 'uploading',0,?)")
    .bind(id, name, title, input.mime, input.bytes, upload.uploadId, Date.now()).run();
  return json({ id, partSize: PART_SIZE }, 201);
}

async function uploading(env, id) {
  const item = await env.DB.prepare("SELECT id,bytes,upload_id FROM videos WHERE id=? AND status='uploading'").bind(id).first();
  if (!item) fail(404, "This upload is no longer open. Please start it again.");
  return item;
}

export async function uploadVideoPart(request, env, id) {
  const item = await uploading(env, id);
  const n = Number(new URL(request.url).searchParams.get("n"));
  const length = Number(request.headers.get("Content-Length"));
  const parts = Math.ceil(item.bytes / PART_SIZE);
  if (!Number.isInteger(n) || n < 1 || n > parts) fail(400, "Invalid video part.");
  const expected = n < parts ? PART_SIZE : item.bytes - PART_SIZE * (parts - 1);
  if (length !== expected) fail(400, "This part of the video was incomplete. Please try again.");
  const part = await env.BUCKET.resumeMultipartUpload(key(id), item.upload_id).uploadPart(n, request.body);
  return json({ partNumber: n, etag: part.etag });
}

export async function finishVideo(request, env, id) {
  const item = await uploading(env, id);
  const { parts } = await body(request);
  const count = Math.ceil(item.bytes / PART_SIZE);
  if (!Array.isArray(parts) || parts.length !== count ||
      parts.some((p, i) => !p || p.partNumber !== i + 1 || typeof p.etag !== "string"))
    fail(400, "Some parts of the video are missing. Please upload it again.");
  await env.BUCKET.resumeMultipartUpload(key(id), item.upload_id).complete(parts);
  const stored = await env.BUCKET.head(key(id));
  if (!stored || stored.size !== item.bytes) {
    await env.BUCKET.delete(key(id));
    await env.DB.prepare("DELETE FROM videos WHERE id=?").bind(id).run();
    fail(400, "The video was incomplete. Please upload it again.");
  }
  await env.DB.prepare("UPDATE videos SET status='ready',upload_id=NULL,published=1 WHERE id=?").bind(id).run();
  return json({ ok: true });
}

export async function updateVideo(request, env, id) {
  const input = await body(request);
  const item = await env.DB.prepare("SELECT id FROM videos WHERE id=? AND status='ready'").bind(id).first();
  if (!item) fail(404, "Video unavailable.");
  if (typeof input.published === "boolean")
    await env.DB.prepare("UPDATE videos SET published=? WHERE id=?").bind(input.published ? 1 : 0, id).run();
  if (typeof input.title === "string") {
    const title = input.title.trim();
    if (!title || title.length > 120) fail(400, "Give the video a title of up to 120 characters.");
    await env.DB.prepare("UPDATE videos SET title=? WHERE id=?").bind(title, id).run();
  }
  return json({ ok: true });
}

export async function deleteVideo(env, id) {
  const item = await env.DB.prepare("SELECT status,upload_id FROM videos WHERE id=?").bind(id).first();
  if (!item) fail(404, "Video unavailable.");
  if (item.status === "uploading" && item.upload_id)
    await env.BUCKET.resumeMultipartUpload(key(id), item.upload_id).abort().catch(() => {});
  else await env.BUCKET.delete(key(id));
  await env.DB.prepare("DELETE FROM videos WHERE id=?").bind(id).run();
  return json({ ok: true });
}
