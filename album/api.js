import { AlbumError, body, fail, json, sameOrigin } from "./common.js";
import {
  start,
  finish,
  identity,
  logout,
  smsReady,
  notifyHost,
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
  photo,
  servePhoto,
  upload,
  uploadPreview,
} from "./media.js";
import { privateHeaders } from "./common.js";
const uuid = "[a-f0-9-]{36}";
const photoRoute = new RegExp(
  "^/photos/(" + uuid + ")/(preview|original|favorite)$",
);
const thumbUpload = new RegExp("^/host/preview/(" + uuid + ")$");
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
  if (method === "POST" && !guestWeb) sameOrigin(request);
  if (guestWeb && path.startsWith("/host/")) fail(403, "Guest access only.");
  const db = env.DB;
  if (path === "/me" && method === "GET") {
    const a = await identity(request, env, guestWeb);
    return json({ role: a.role, status: a.status, name: a.name, smsEnabled: smsReady(env) });
  }
  if (path === "/otp/start" && method === "POST") return start(request, env, guestWeb);
  if (path === "/otp/check" && method === "POST")
    return finish(request, env, ctx, guestWeb);
  if (path === "/logout" && method === "POST") return logout(request, env, guestWeb);
  const actor = await identity(request, env, guestWeb);
  if (path.startsWith("/host/")) {
    if (actor.role !== "host")
      fail(403, "Please sign in with the host account.");
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
    const thumb = path.match(thumbUpload);
    if (thumb && method === "POST")
      return uploadPreview(request, env, thumb[1]);
    if (path === "/host/photos" && method === "GET")
      return json(
        await paginate(
          db.prepare(
            "SELECT id,name,mime,bytes,preview,published FROM photos ORDER BY created DESC,id LIMIT ? OFFSET ?",
          ),
          [],
          url,
        ),
      );
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
            "SELECT id,name,phone,status,created FROM guests WHERE phone<>? ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END,created DESC,id LIMIT ? OFFSET ?",
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
      const change = await db
        .prepare(
          "UPDATE guests SET status=? WHERE id=? AND phone<>? RETURNING id",
        )
        .bind(input.status, input.id, env.OWNER_PHONE || "")
        .first();
      if (!change) fail(404, "Guest unavailable.");
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
    fail(403, "Verified album access is required.");
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
