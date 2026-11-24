import { AlbumError, body, fail, json, sameOrigin } from "./common.js";
import {
  start,
  finish,
  identity,
  logout,
  smsReady,
  notifyHost,
  throttle,
} from "./auth.js";
import {
  browseDrive,
  configuredFolder,
  drivePhoto,
  driveReady,
  folderId,
  thumbnail,
} from "./drive.js";
import {
  favorite,
  importDrive,
  matchUpload,
  photo,
  servePhoto,
  upload,
  uploadPreview,
} from "./media.js";
import { privateHeaders } from "./common.js";
import { requestAccess } from "./requests.js";
import { deliverPush, pushPublicKey, queuePush, subscribePush } from "./push.js";
import {
  deleteVideo,
  finishVideo,
  guestVideos,
  hostVideos,
  startVideo,
  streamVideo,
  updateVideo,
  uploadVideoPart,
} from "./videos.js";
const uuid = "[a-f0-9-]{36}";
const photoRoute = new RegExp(
  "^/photos/(" + uuid + ")/(preview|original|favorite)$",
);
const thumbUpload = new RegExp("^/host/preview/(" + uuid + ")$");
const videoStream = new RegExp("^/videos/(" + uuid + ")/stream$");
const hostVideo = new RegExp("^/host/videos/(" + uuid + ")/(part|finish|update|delete)$");
const take = 60;
function offset(url) {
  return Math.min(
    1000000,
    Math.max(0, Math.floor(Number(url.searchParams.get("offset")) || 0)),
  );
}
async function paginate(statement, params, url) {
  const skip = offset(url),
    { results } = await statement.bind(...params, take + 1, skip).all();
  return {
    items: results.slice(0, take),
    next: results.length > take ? skip + take : null,
  };
}
async function handle(request, env, ctx, guestWeb) {
  const url = new URL(request.url),
    path = url.pathname.slice(guestWeb ? "/api/guest".length : "/api".length),
    method = request.method;
  if (method !== "GET" && method !== "POST") fail(405, "Method unavailable.");
  // Signed links let a <video> element stream without the guest's token.
  const stream = !guestWeb && method === "GET" && path.match(videoStream);
  if (stream) return streamVideo(request, env, stream[1]);
  if (method === "POST" && !guestWeb) sameOrigin(request);
  if (guestWeb && path.startsWith("/host/")) fail(403, "Guest access only.");
  const db = env.DB;
  if (path === "/access/request" && method === "POST") return requestAccess(request, env, ctx, guestWeb);
  if (path === "/notifications/key" && method === "GET") return json({ key: pushPublicKey(env) });
  if (path === "/me" && method === "GET") {
    const a = await identity(request, env, guestWeb);
    if (a.status === "pending" && env.WEB_PUSH_PRIVATE_JWK) ctx.waitUntil(deliverPush(env).catch(() => {}));
    return json({ role: a.role, status: a.status, name: a.name, smsEnabled: smsReady(env), messages: true, videos: true });
  }
  if (path === "/otp/start" && method === "POST") return start(request, env, guestWeb);
  if (path === "/otp/check" && method === "POST")
    return finish(request, env, ctx, guestWeb);
  if (path === "/logout" && method === "POST") return logout(request, env, guestWeb);
  const actor = await identity(request, env, guestWeb);
  if (path === "/notifications/subscribe" && method === "POST") {
    if (actor.role === "visitor") fail(403, "Request album access first.");
    await subscribePush(env, actor.role === "host" ? "hosts" : actor.id, await body(request));
    ctx.waitUntil(deliverPush(env).catch(() => {}));
    return json({ enabled: true });
  }
  if (path.startsWith("/host/")) {
    if (actor.role !== "host")
      fail(403, "Please sign in with the host account.");
    if (path === "/host/requests-count" && method === "GET") {
      ctx.waitUntil(deliverPush(env).catch(() => {}));
      return json(await db.prepare("SELECT COUNT(*) AS pending FROM guests WHERE status='pending' AND (phone_verified=0 OR phone<>?)")
        .bind(env.OWNER_PHONE || "").first());
    }
    if (path === "/host/status" && method === "GET") {
      const folder = await configuredFolder(env);
      return json({
        folder,
        drive: driveReady(env),
        sms: smsReady(env),
        email: Boolean(env.RESEND_API_KEY && env.HOST_EMAIL && env.MAIL_FROM),
      });
    }
    if (path === "/host/folder" && method === "POST") {
      const id = folderId((await body(request)).folder);
      await db
        .prepare(
          "INSERT INTO settings(key,value) VALUES('drive_folder',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .bind(id)
        .run();
      return json({ folder: id });
    }
    if (path === "/host/drive" && method === "GET")
      return json(await browseDrive(env, url));
    if (path === "/host/drive-preview" && method === "GET") {
      const info = await drivePhoto(
        env,
        String(url.searchParams.get("file") || ""),
      );
      const r = await thumbnail(env, info);
      if (!r) fail(404, "Preview unavailable.");
      return new Response(r.body, {
        headers: {
          ...privateHeaders,
          "Content-Type": r.headers.get("Content-Type"),
        },
      });
    }
    if (path === "/host/import" && method === "POST")
      return importDrive(env, (await body(request)).file);
    if (path === "/host/upload" && method === "POST")
      return upload(request, env);
    if (path === "/host/upload-match" && method === "POST")
      return matchUpload(env, await body(request));
    const thumb = path.match(thumbUpload);
    if (thumb && method === "POST")
      return uploadPreview(request, env, thumb[1]);
    if (path === "/host/photos" && method === "GET") {
      const [page, totals] = await Promise.all([
        paginate(
          db.prepare(
            "SELECT id,name,mime,bytes,preview,published FROM photos ORDER BY created DESC,id LIMIT ? OFFSET ?",
          ),
          [],
          url,
        ),
        db.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(published),0) AS published FROM photos").first(),
      ]);
      return json({ ...page, ...totals });
    }
    if (path === "/host/publish" && method === "POST") {
      const input = await body(request);
      if (typeof input.published !== "boolean" || typeof input.id !== "string")
        fail(400, "Choose a photo.");
      if (
        !(await db
          .prepare("UPDATE photos SET published=? WHERE id=? RETURNING id")
          .bind(input.published ? 1 : 0, input.id)
          .first())
      )
        fail(404, "Photo unavailable.");
      return json({ ok: true });
    }
    if (path === "/host/guests" && method === "GET")
      return json(
        await paginate(
          db.prepare(
            "SELECT id,name,phone,status,created FROM guests WHERE (phone_verified=0 OR phone<>?) ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END,created DESC,id LIMIT ? OFFSET ?",
          ),
          [env.OWNER_PHONE || ""],
          url,
        ),
      );
    if (path === "/host/guest" && method === "POST") {
      const input = await body(request);
      if (
        !["approved", "denied", "revoked"].includes(input.status) ||
        typeof input.id !== "string"
      )
        fail(400, "Choose a guest and access level.");
      const allowed = await db.prepare("SELECT id FROM guests WHERE id=? AND (phone_verified=0 OR phone<>?)")
        .bind(input.id, env.OWNER_PHONE || "").first();
      if (!allowed) fail(404, "Guest unavailable.");
      // Queue a push only for a real transition, atomically with the approval.
      const notification = input.status === "approved"
        ? db.prepare("UPDATE push_subscriptions SET delivery=?,retry_at=0 WHERE owner=? AND EXISTS(SELECT 1 FROM guests WHERE id=? AND status<>'approved')")
            .bind(crypto.randomUUID(), input.id, input.id)
        : queuePush(db, input.id, null);
      await db.batch([notification, db.prepare("UPDATE guests SET status=? WHERE id=?").bind(input.status, input.id)]);
      if (input.status === "approved") ctx.waitUntil(deliverPush(env).catch(() => {}));
      return json({ ok: true });
    }
    if (path === "/host/guest/delete" && method === "POST") {
      const { id } = await body(request);
      if (typeof id !== "string") fail(400, "Choose a guest.");
      const guest = await db.prepare("SELECT status FROM guests WHERE id=? AND (phone_verified=0 OR phone<>?)")
        .bind(id, env.OWNER_PHONE || "").first();
      if (!guest) fail(404, "Guest unavailable.");
      if (guest.status === "approved") fail(409, "Revoke this guest's access before deleting them.");
      // Remove the request together with everything recorded for it.
      await db.batch([
        db.prepare("DELETE FROM sessions WHERE guest=?").bind(id),
        db.prepare("DELETE FROM favorites WHERE guest=?").bind(id),
        db.prepare("DELETE FROM activity WHERE guest=?").bind(id),
        db.prepare("DELETE FROM push_subscriptions WHERE owner=?").bind(id),
        db.prepare("DELETE FROM messages WHERE guest=?").bind(id),
        db.prepare("DELETE FROM guests WHERE id=?").bind(id),
      ]);
      return json({ ok: true });
    }
    if (path === "/host/videos" && method === "GET") return hostVideos(env, url.origin);
    if (path === "/host/videos/start" && method === "POST") return startVideo(request, env);
    const hv = path.match(hostVideo);
    if (hv && method === "POST") {
      if (hv[2] === "part") return uploadVideoPart(request, env, hv[1]);
      if (hv[2] === "finish") return finishVideo(request, env, hv[1]);
      if (hv[2] === "update") return updateVideo(request, env, hv[1]);
      return deleteVideo(env, hv[1]);
    }
    if (path === "/host/messages" && method === "GET")
      return json(
        await paginate(
          db.prepare(
            "SELECT m.id,m.body,m.created,g.name AS guest,g.phone FROM messages m JOIN guests g ON g.id=m.guest ORDER BY m.id DESC LIMIT ? OFFSET ?",
          ),
          [],
          url,
        ),
      );
    if (path === "/host/messages/delete" && method === "POST") {
      const { id } = await body(request);
      if (!Number.isInteger(id)) fail(400, "Choose a message.");
      await db.prepare("DELETE FROM messages WHERE id=?").bind(id).run();
      return json({ ok: true });
    }
    if (path === "/host/activity" && method === "GET")
      return json(
        await paginate(
          db.prepare(
            "SELECT a.id,a.action,a.created,g.name AS guest,g.phone,p.name AS photo FROM activity a JOIN guests g ON a.guest=g.id JOIN photos p ON a.photo=p.id ORDER BY a.id DESC LIMIT ? OFFSET ?",
          ),
          [],
          url,
        ),
      );
    if (path === "/host/notify" && method === "POST") {
      const { id } = await body(request);
      const pending = await db
        .prepare(
          "SELECT id FROM guests WHERE id=? AND status='pending' AND notified=0",
        )
        .bind(String(id || ""))
        .first();
      if (pending) await notifyHost(env, pending.id, url.origin);
      return json({ ok: true });
    }
    fail(404, "Page unavailable.");
  }
  if (actor.role !== "host" && actor.status !== "approved")
    fail(403, "Host approval is required to view this album.");
  if (path === "/photos" && method === "GET") {
    const only = url.searchParams.get("favorites") === "1";
    const sql =
      "SELECT p.id,p.name,p.bytes,p.preview, EXISTS(SELECT 1 FROM favorites f WHERE f.guest=? AND f.photo=p.id) AS favorite FROM photos p WHERE p.published=1" +
      (only
        ? " AND EXISTS(SELECT 1 FROM favorites f WHERE f.guest=? AND f.photo=p.id)"
        : "") +
      " ORDER BY p.created DESC,p.id LIMIT ? OFFSET ?";
    return json(
      await paginate(
        db.prepare(sql),
        only ? [actor.id || "", actor.id || ""] : [actor.id || ""],
        url,
      ),
    );
  }
  if (path === "/videos" && method === "GET") return guestVideos(env, url.origin);
  // Notes from approved guests. Only the hosts can read them.
  if (path === "/messages" && method === "POST") {
    if (actor.role !== "guest") fail(403, "Only guests can leave a note.");
    const input = await body(request);
    const text = typeof input.text === "string" ? input.text.trim() : "";
    if (!text || text.length > 2000) fail(400, "Write a note of up to 2,000 characters.");
    await throttle(db, "message:" + actor.id, 3600000, 10, "You’ve sent several notes already. Please try again a little later.");
    await db.prepare("INSERT INTO messages(guest,body,created) VALUES(?,?,?)").bind(actor.id, text, Date.now()).run();
    return json({ sent: true });
  }
  const m = path.match(photoRoute);
  if (m && (m[2] === "preview" ? method === "GET" : method === "POST")) {
    if (m[2] === "favorite")
      return favorite(env, m[1], actor, (await body(request)).on);
    return servePhoto(
      env,
      await photo(env, m[1], actor),
      actor,
      m[2] === "original",
    );
  }
  fail(404, "Page unavailable.");
}
export async function albumApi(request, env, ctx) {
  const guestWeb = new URL(request.url).pathname.startsWith("/api/guest/");
  if (guestWeb && (!env.GUEST_WEB_ORIGIN || request.headers.get("Origin") !== env.GUEST_WEB_ORIGIN))
    return json({ error: "Please open the guest invitation." }, 403);
  let response;
  try {
    response = guestWeb && request.method === "OPTIONS"
      ? new Response(null, { status: 204, headers: privateHeaders })
      : await handle(request, env, ctx, guestWeb);
  } catch (error) {
    response = error instanceof AlbumError
      ? json({ error: error.message }, error.status)
      : json(
          {
            error:
              "The album could not complete this request. Please try again.",
          },
          500,
        );
  }
  if (guestWeb) {
    response.headers.set("Access-Control-Allow-Origin", env.GUEST_WEB_ORIGIN);
    response.headers.set("Vary", "Origin");
    if (request.method === "OPTIONS") {
      response.headers.set("Access-Control-Allow-Methods", "GET, POST");
      response.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
      response.headers.set("Access-Control-Max-Age", "600");
    }
  }
  return response;
}
