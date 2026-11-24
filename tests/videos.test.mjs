import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { albumApi } from "../album/api.js";
import { PART_SIZE } from "../album/videos.js";

function memoryBucket() {
  const objects = new Map(), uploads = new Map();
  const object = (bytes, range) => {
    const slice = range ? bytes.subarray(range.offset, range.offset + range.length) : bytes;
    return { size: bytes.length, body: new Blob([slice]).stream() };
  };
  return {
    objects, uploads,
    async createMultipartUpload(key) { const uploadId = "u" + uploads.size; uploads.set(uploadId, { key, parts: new Map() }); return { uploadId }; },
    resumeMultipartUpload(key, uploadId) {
      const u = uploads.get(uploadId); assert.equal(u.key, key);
      return {
        async uploadPart(n, body) { const bytes = new Uint8Array(await new Response(body).arrayBuffer()); u.parts.set(n, bytes); return { partNumber: n, etag: "e" + n }; },
        async complete(parts) { objects.set(key, Buffer.concat(parts.map((p) => { assert.equal(p.etag, "e" + p.partNumber); return u.parts.get(p.partNumber); }))); uploads.delete(uploadId); },
        async abort() { uploads.delete(uploadId); },
      };
    },
    async head(key) { const b = objects.get(key); return b ? { size: b.length } : null; },
    async get(key, opts) { const b = objects.get(key); return b ? object(b, opts?.range) : null; },
    async delete(key) { objects.delete(key); },
  };
}

test("hosts upload videos in parts and approved guests stream them through signed links", async () => {
  const sql = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) sql.exec(readFileSync(new URL(f, dir), "utf8"));
  const prep = (q, args = []) => { const st = sql.prepare(q); return { bind: (...a) => prep(q, a), first: async () => st.get(...args), all: async () => ({ results: st.all(...args) }), run: async () => st.run(...args) }; };
  const db = { prepare: prep, batch: async (arr) => { for (const s of arr) await s.run(); } };
  const site = "https://album.example", pages = "https://guest.example", bucket = memoryBucket();
  const env = { DB: db, BUCKET: bucket, GUEST_WEB_ORIGIN: pages, SITES_OWNER_EMAIL: "host@example.test", OWNER_PHONE: "+12025550123" };
  const ctx = { waitUntil() {} };
  const admin = { "oai-authenticated-user-id": "host", "oai-authenticated-user-email": env.SITES_OWNER_EMAIL };
  const call = (path, { data, raw, headers = {}, host = false, method } = {}) => albumApi(new Request(site + (host ? "/api/" : "/api/guest/") + path, {
    method: method || (data === undefined && raw === undefined ? "GET" : "POST"),
    headers: { Origin: host ? site : pages, ...(raw === undefined ? { "Content-Type": "application/json" } : { "Content-Type": "application/octet-stream", "Content-Length": String(raw.length) }), ...headers },
    body: raw !== undefined ? raw : data === undefined ? undefined : JSON.stringify(data),
  }), env, ctx);

  const video = randomBytes(PART_SIZE + 1234);
  assert.equal((await call("host/videos/start", { data: { name: "ring.mp4", mime: "video/mp4", bytes: video.length } })).status, 403);
  assert.equal((await call("host/videos/start", { host: true, headers: admin, data: { name: "x.exe", mime: "application/x", bytes: 5 } })).status, 400);
  const started = await (await call("host/videos/start", { host: true, headers: admin, data: { name: "ring.mp4", mime: "video/mp4", bytes: video.length } })).json();
  assert.equal(started.partSize, PART_SIZE);
  assert.equal((await call(`host/videos/${started.id}/part?n=1`, { host: true, headers: admin, raw: video.subarray(0, 10) })).status, 400);
  const parts = [];
  for (let n = 1, at = 0; at < video.length; n++, at += PART_SIZE)
    parts.push(await (await call(`host/videos/${started.id}/part?n=${n}`, { host: true, headers: admin, raw: video.subarray(at, at + PART_SIZE) })).json());
  assert.equal(parts.length, 2);
  assert.equal((await call(`host/videos/${started.id}/finish`, { host: true, headers: admin, data: { parts: parts.slice(0, 1) } })).status, 400);
  assert.equal((await call(`host/videos/${started.id}/finish`, { host: true, headers: admin, data: { parts } })).status, 200);
  assert.deepEqual(bucket.objects.get("videos/" + started.id), video);

  // An approved guest sees the published video with a working signed link.
  sql.prepare("INSERT INTO guests(id,phone,name,status,created,phone_verified) VALUES('g','+15550001111','Guest','approved',1,0)").run();
  sql.prepare("INSERT INTO sessions(token,guest,expires) VALUES(?,?,?)").run(await (await import("../album/common.js")).digest("a".repeat(64)), "g", Date.now() + 1e7);
  const guest = { Authorization: "Bearer " + "a".repeat(64) };
  assert.equal((await call("videos")).status, 403);
  const listed = (await (await call("videos", { headers: guest })).json()).items;
  assert.equal(listed.length, 1); assert.equal(listed[0].title, "ring");
  const link = new URL(listed[0].link);
  const get = (url, headers = {}) => albumApi(new Request(url, { headers }), env, ctx);
  const full = await get(link);
  assert.equal(full.status, 200); assert.equal(full.headers.get("Accept-Ranges"), "bytes");
  const part = await get(link, { Range: "bytes=100-199" });
  assert.equal(part.status, 206); assert.equal(part.headers.get("Content-Range"), `bytes 100-199/${video.length}`);
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), video.subarray(100, 200));
  const tail = await get(link, { Range: "bytes=-10" });
  assert.deepEqual(Buffer.from(await tail.arrayBuffer()), video.subarray(-10));
  assert.equal((await get(link, { Range: `bytes=${video.length}-` })).status, 416);
  const forged = new URL(link); forged.searchParams.set("sig", "0".repeat(64));
  assert.equal((await get(forged)).status, 403);
  const expired = new URL(link); expired.searchParams.set("exp", "1");
  assert.equal((await get(expired)).status, 403);

  // Hosts can rename, unpublish and delete.
  assert.equal((await call(`host/videos/${started.id}/update`, { host: true, headers: admin, data: { title: "The ring moment", published: false } })).status, 200);
  assert.equal((await (await call("videos", { headers: guest })).json()).items.length, 0);
  const hostList = await (await call("host/videos", { host: true, headers: admin })).json();
  assert.equal(hostList.items[0].title, "The ring moment"); assert.equal(hostList.items[0].published, 0);
  assert.equal((await call(`host/videos/${started.id}/delete`, { host: true, headers: admin, data: {} })).status, 200);
  assert.equal(bucket.objects.size, 0); assert.equal((await get(link)).status, 404);

  // An abandoned upload can be deleted, which aborts it.
  const open = await (await call("host/videos/start", { host: true, headers: admin, data: { name: "b.mov", mime: "video/quicktime", bytes: 10 } })).json();
  assert.equal(bucket.uploads.size, 1);
  assert.equal((await call(`host/videos/${open.id}/delete`, { host: true, headers: admin, data: {} })).status, 200);
  assert.equal(bucket.uploads.size, 0);
  sql.close();
});
