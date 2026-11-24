import {
  body,
  cookie,
  digest,
  fail,
  json,
  randomToken,
  readCookie,
} from "./common.js";

const hour = 3600000;
export function smsReady(env) {
  return Boolean(
    env.TWILIO_ACCOUNT_SID &&
      env.TWILIO_AUTH_TOKEN &&
      env.TWILIO_VERIFY_SERVICE_SID,
  );
}
export async function identity(request, env) {
  const visitorEmail = request.headers
    .get("oai-authenticated-user-email")
    ?.trim()
    .toLowerCase();
  if (
    env.SITES_OWNER_EMAIL &&
    visitorEmail &&
    request.headers.get("oai-authenticated-user-id")
  ) {
    const hostEmails = [
      env.SITES_OWNER_EMAIL,
      ...(env.SITES_HOST_EMAILS || "").split(","),
    ];
    if (hostEmails.some((email) => email.trim().toLowerCase() === visitorEmail))
      return { role: "host" };
  }
  const token = readCookie(request, "session");
  if (!/^[0-9a-f]{64}$/.test(token)) return { role: "visitor" };
  const guest = await env.DB.prepare(
    "SELECT g.id, g.name, g.phone, g.status FROM sessions s JOIN guests g ON g.id=s.guest WHERE s.token=? AND s.expires>?",
  )
    .bind(await digest(token), Date.now())
    .first();
  if (!guest) return { role: "visitor" };
  if (env.OWNER_PHONE && guest.phone === env.OWNER_PHONE)
    return { role: "host", id: guest.id };
  return {
    role: "guest",
    id: guest.id,
    name: guest.name,
    status: guest.status,
  };
}
async function throttle(db, tag, ttl, limit) {
  const now = Date.now(),
    key = await digest("sf-v1:" + tag);
  const hit = await db
    .prepare(
      "INSERT INTO limits (key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN limits.expires<=? THEN 1 ELSE limits.count+1 END, expires=CASE WHEN limits.expires<=? THEN excluded.expires ELSE limits.expires END WHERE limits.expires<=? OR limits.count<? RETURNING count",
    )
    .bind(key, now + ttl, now, now, now, limit)
    .first();
  if (!hit) fail(429, "Please wait before requesting another code.");
}
async function verifyCall(env, endpoint, data) {
  const url =
    "https://verify.twilio.com/v2/Services/" +
    encodeURIComponent(env.TWILIO_VERIFY_SERVICE_SID) +
    "/" +
    endpoint;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization:
        "Basic " + btoa(env.TWILIO_ACCOUNT_SID + ":" + env.TWILIO_AUTH_TOKEN),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(data),
  });
  if (r.status === 429)
    fail(429, "Too many attempts. Please wait and try again.");
  if (
    endpoint === "VerificationCheck" &&
    (r.status === 404 || r.status === 400)
  )
    fail(
      400,
      "This code is incorrect or expired. Try again or request a new code.",
    );
  if (!r.ok)
    fail(
      503,
      endpoint === "Verifications"
        ? "The code could not be sent. Check the number and try again later."
        : "Verification is temporarily unavailable.",
    );
  return r.json();
}
async function cleanup(db) {
  const now = Date.now();
  await db.batch(
    ["challenges", "sessions", "limits"].map((table) =>
      db.prepare("DELETE FROM " + table + " WHERE expires<=?").bind(now),
    ),
  );
}
export async function start(request, env) {
  if (!smsReady(env))
    fail(
      503,
      "SMS invitations are not open yet. Please check back with Sriya or Fani.",
    );
  const input = await body(request),
    name = String(input.name || "")
      .trim()
      .replace(/\s+/g, " "),
    phone = String(input.phone || "").trim();
  if (!name || name.length > 80 || !/^\+[1-9]\d{7,14}$/.test(phone))
    fail(400, "Enter your name and a mobile number with its country code.");
  const db = env.DB;
  await cleanup(db);
  await throttle(db, "resend:" + phone, 60000, 1);
  await throttle(db, "phone:" + phone, hour, 5);
  await throttle(
    db,
    "ip:" + (request.headers.get("CF-Connecting-IP") || "shared"),
    hour,
    20,
  );
  await throttle(
    db,
    "daily-sms",
    24 * hour,
    Number(env.SMS_DAILY_LIMIT) || 120,
  );
  const verification = await verifyCall(env, "Verifications", {
    To: phone,
    Channel: "sms",
  });
  if (!verification.sid || verification.status !== "pending")
    fail(503, "The verification service could not start this request.");
  const token = randomToken(),
    ttl = 600;
  await db
    .prepare(
      "INSERT INTO challenges(id,verification,phone,name,expires) VALUES(?,?,?,?,?)",
    )
    .bind(
      await digest(token),
      verification.sid,
      phone,
      name,
      Date.now() + ttl * 1000,
    )
    .run();
  return json({ sent: true }, 200, {
    "Set-Cookie": cookie(request, "challenge", token, ttl),
  });
}
export async function notifyHost(env, guest, origin) {
  if (!env.RESEND_API_KEY || !env.HOST_EMAIL || !env.MAIL_FROM) return;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.RESEND_API_KEY,
      "Content-Type": "application/json",
      "Idempotency-Key": "album-request-" + guest,
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [env.HOST_EMAIL],
      subject: "New guest request for the Sriya & Fani album",
      text:
        "A guest has verified their mobile number and requested access to your engagement album. Review their request in your host studio.\n\n" +
        origin +
        "/host",
    }),
  });
  if (r.ok)
    await env.DB.prepare("UPDATE guests SET notified=1 WHERE id=?")
      .bind(guest)
      .run();
}
export async function finish(request, env, ctx) {
  if (!smsReady(env)) fail(503, "SMS invitations are not open yet.");
  const { code } = await body(request);
  if (typeof code !== "string" || !/^\d{4,10}$/.test(code))
    fail(400, "Enter the code from your text message.");
  const token = readCookie(request, "challenge");
  if (!/^[0-9a-f]{64}$/.test(token))
    fail(400, "Request a new verification code.");
  const key = await digest(token),
    db = env.DB;
  const ticket = await db
    .prepare(
      "UPDATE challenges SET attempts=attempts+1 WHERE id=? AND expires>? AND attempts<5 RETURNING verification,phone,name",
    )
    .bind(key, Date.now())
    .first();
  if (!ticket) fail(400, "This verification has expired. Request a new code.");
  const result = await verifyCall(env, "VerificationCheck", {
    VerificationSid: ticket.verification,
    Code: code,
  });
  if (result.status !== "approved" || result.to !== ticket.phone)
    fail(400, "This code is incorrect or expired.");
  if (
    !(await db
      .prepare("DELETE FROM challenges WHERE id=? RETURNING id")
      .bind(key)
      .first())
  )
    fail(400, "Request a new verification code.");
  await db
    .prepare(
      "INSERT INTO guests(id,phone,name,created) VALUES(?,?,?,?) ON CONFLICT(phone) DO NOTHING",
    )
    .bind(crypto.randomUUID(), ticket.phone, ticket.name, Date.now())
    .run();
  const guest = await db
    .prepare("SELECT id,status,notified FROM guests WHERE phone=?")
    .bind(ticket.phone)
    .first();
  const session = randomToken(),
    seconds = 7 * 24 * 3600;
  await db
    .prepare("INSERT INTO sessions(token,guest,expires) VALUES(?,?,?)")
    .bind(await digest(session), guest.id, Date.now() + seconds * 1000)
    .run();
  if (
    guest.status === "pending" &&
    !guest.notified &&
    ticket.phone !== env.OWNER_PHONE
  )
    ctx.waitUntil(
      notifyHost(env, guest.id, new URL(request.url).origin).catch(() => {}),
    );
  const response = json({ verified: true }, 200, {
    "Set-Cookie": cookie(request, "session", session, seconds),
  });
  response.headers.append("Set-Cookie", cookie(request, "challenge", "", 0));
  return response;
}
export async function logout(request, env) {
  const session = readCookie(request, "session");
  if (session)
    await env.DB.prepare("DELETE FROM sessions WHERE token=?")
      .bind(await digest(session))
      .run();
  return json({ ok: true }, 200, {
    "Set-Cookie": cookie(request, "session", "", 0),
  });
}
