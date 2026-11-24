import {
  attachment,
  fail,
  json,
  photoTypes,
  privateHeaders,
} from "./common.js";
import { drivePhoto, original, thumbnail } from "./drive.js";
const photoKey = (id) => "originals/" + id;
const previewKey = (id) => "previews/" + id;
const directLimit = 90 * 1024 * 1024;
async function insert(env, id, drive, name, mime, size, preview) {
  await env.DB.prepare(
    "INSERT INTO photos(id,drive,name,mime,bytes,preview,created) VALUES(?,?,?,?,?,?,?)",
  )
    .bind(id, drive, name, mime, size, preview, Date.now())
    .run();
}
export async function importDrive(env, file) {
  const info = await drivePhoto(env, String(file || ""));
  const exists = await env.DB.prepare("SELECT id FROM photos WHERE drive=?")
    .bind(info.id)
    .first();
  if (exists) return json({ id: exists.id, existing: true });
  const id = crypto.randomUUID(),
    source = await original(env, info.id);
  const obj = await env.BUCKET.put(
    photoKey(id),
    source.body,
    info.md5Checksum ? { md5: info.md5Checksum } : {},
  );
  try {
    if (!obj || (info.size && Number(info.size) !== obj.size))
      fail(502, "Drive returned an incomplete original. Please retry.");
    const thumb = await thumbnail(env, info).catch(() => null);
    let preview = null;
    if (thumb) {
      const blob = await thumb.arrayBuffer();
      if (blob.byteLength && blob.byteLength <= 4 * 1024 * 1024) {
        preview = thumb.headers.get("Content-Type").split(";")[0];
        await env.BUCKET.put(previewKey(id), blob);
      }
    }
    await insert(env, id, info.id, info.name, info.mimeType, obj.size, preview);
  } catch (error) {
    await env.BUCKET.delete([photoKey(id), previewKey(id)]);
    const raced = await env.DB.prepare("SELECT id FROM photos WHERE drive=?")
      .bind(info.id)
      .first();
    if (raced) return json({ id: raced.id, existing: true });
    throw error;
  }
  return json({ id }, 201);
}
export async function upload(request, env) {
  const mime = (request.headers.get("Content-Type") || "").split(";")[0];
  let name;
  try {
    name = decodeURIComponent(request.headers.get("X-Photo-Name") || "").trim();
  } catch {}
  const bytes = Number(
    request.headers.get("Content-Length") ||
      request.headers.get("X-Photo-Bytes"),
  );
  if (
    !photoTypes.has(mime) ||
    !name ||
    name.length > 240 ||
    /[\x00-\x1f\x7f/\\]/.test(name)
  )
    fail(400, "Choose a supported image with a valid filename.");
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > directLimit)
    fail(
      413,
      "Choose an image under 90 MiB, or import it directly from Drive.",
    );
  const id = crypto.randomUUID(),
    obj = await env.BUCKET.put(photoKey(id), request.body);
  try {
    if (!obj || obj.size !== bytes)
      fail(400, "The original was incomplete. Please upload it again.");
    await insert(env, id, null, name, mime, bytes, null);
  } catch (e) {
    await env.BUCKET.delete(photoKey(id));
    throw e;
  }
  return json({ id }, 201);
}
export async function uploadPreview(request, env, id) {
  const length = Number(
    request.headers.get("Content-Length") ||
      request.headers.get("X-Photo-Bytes"),
  );
  if (
    length < 1 ||
    length > 4 * 1024 * 1024 ||
    request.headers.get("Content-Type") !== "image/jpeg"
  )
    fail(400, "Please use a JPEG preview under 4 MiB.");
  if (
    !(await env.DB.prepare("SELECT id FROM photos WHERE id=?").bind(id).first())
  )
    fail(404, "Photo unavailable.");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length !== length || bytes[0] !== 255 || bytes[1] !== 216)
    fail(400, "This preview could not be read.");
  await env.BUCKET.put(previewKey(id), bytes);
  await env.DB.prepare("UPDATE photos SET preview='image/jpeg' WHERE id=?")
    .bind(id)
    .run();
  return json({ ok: true });
}
export async function photo(env, id, actor) {
  if (actor.role !== "host" && actor.status !== "approved")
    fail(403, "Verified album access is required.");
  const item = await env.DB.prepare(
    "SELECT id,name,mime,bytes,preview,published FROM photos WHERE id=?",
  )
    .bind(id)
    .first();
  if (!item || (actor.role !== "host" && !item.published))
    fail(404, "Photo unavailable.");
  return item;
}
export async function servePhoto(env, item, actor, download) {
  if (!download && !item.preview)
    fail(404, "There is no preview for this photo.");
  const object = await env.BUCKET.get(
    download ? photoKey(item.id) : previewKey(item.id),
  );
  if (!object) fail(404, "Photo unavailable.");
  if (download && actor.role === "guest")
    await env.DB.prepare(
      "INSERT INTO activity(guest,photo,action,created) VALUES(?,?,'download',?)",
    )
      .bind(actor.id, item.id, Date.now())
      .run();
  const headers = {
    ...privateHeaders,
    "Content-Type": download ? item.mime : item.preview,
    "Content-Length": String(object.size),
  };
  if (download) headers["Content-Disposition"] = attachment(item.name);
  return new Response(object.body, { headers });
}
export async function favorite(env, id, actor, on) {
  if (actor.role !== "guest" || actor.status !== "approved")
    fail(403, "This feature is for approved guests.");
  await photo(env, id, actor);
  if (typeof on !== "boolean") fail(400, "Choose whether to save this photo.");
  const change = on
    ? "INSERT OR IGNORE INTO favorites(guest,photo) VALUES(?,?)"
    : "DELETE FROM favorites WHERE guest=? AND photo=?";
  await env.DB.batch([
    env.DB.prepare(change).bind(actor.id, id),
    env.DB.prepare(
      "INSERT INTO activity(guest,photo,action,created) SELECT ?,?,?,? WHERE changes()=1",
    ).bind(actor.id, id, on ? "favorite" : "unfavorite", Date.now()),
  ]);
  return json({ favorite: on });
}
