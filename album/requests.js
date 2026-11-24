import { body, cookie, digest, fail, json } from "./common.js";
import { identity, notifyHost, throttle } from "./auth.js";
import { deliverPush, queuePush } from "./push.js";

const seconds = 90 * 24 * 3600;
export async function requestAccess(request, env, ctx, guestWeb) {
  const existing = await identity(request, env, guestWeb);
  if (existing.role !== "visitor") return json({ received: true });
  const input = await body(request);
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  if (!name || name.length > 80 || !/^\+[1-9]\d{7,14}$/.test(phone))
    fail(400, "Enter your name and a mobile number with its country code.");
  if (typeof input.ticket !== "string" || !/^[a-f0-9]{64}$/.test(input.ticket))
    fail(400, "Reopen the guest invitation and try again.");
  const db = env.DB, hash = await digest(input.ticket);
  const session = () => db.prepare("SELECT s.guest FROM sessions s JOIN guests g ON g.id=s.guest WHERE s.token=? AND s.expires>? AND g.phone_verified=0")
    .bind(hash, Date.now()).first();
  if (!await session()) {
    const text = "Too many access requests. Please try again later.";
    await throttle(db, "access-ip:" + (request.headers.get("CF-Connecting-IP") || "shared"), 3600000, 60, text);
    await throttle(db, "access-number:" + phone, 3600000, 8, text);
    const id = crypto.randomUUID(), now = Date.now();
    try {
      await db.batch([
        db.prepare("INSERT INTO guests(id,phone,name,created,phone_verified) VALUES(?,?,?,?,0)").bind(id, phone, name, now),
        db.prepare("INSERT INTO sessions(token,guest,expires) VALUES(?,?,?)").bind(hash, id, now + seconds * 1000),
        queuePush(db, "hosts", id),
        db.prepare("DELETE FROM sessions WHERE expires<=?").bind(now),
        db.prepare("DELETE FROM limits WHERE expires<=?").bind(now),
      ]);
      ctx.waitUntil(Promise.all([deliverPush(env), notifyHost(env, id, new URL(request.url).origin)]).catch(() => {}));
    } catch (error) {
      if (!await session()) throw error;
    }
  }
  if (guestWeb) return json({ received: true, session: input.ticket });
  return json({ received: true }, 200, { "Set-Cookie": cookie(request, "session", input.ticket, seconds) });
}
