import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createHash, generateKeyPairSync } from "node:crypto";
import { albumApi } from "../album/api.js";

test("the managed site recognizes its owner and explicitly invited host logins", async () => {
  const settings = {
    SITES_OWNER_EMAIL: "owner@example.test",
    SITES_HOST_EMAILS: "second@example.test, Other@example.test ",
  };
  async function role(email, id, env = settings) {
    const headers = new Headers();
    if (email) headers.set("oai-authenticated-user-email", email);
    if (id) headers.set("oai-authenticated-user-id", id);
    const res = await albumApi(
      new Request("https://album.example/api/me", { headers }),
      env,
      {},
    );
    assert.equal(res.status, 200);
    return (await res.json()).role;
  }
  assert.equal(await role("owner@example.test", "owner-id"), "host");
  assert.equal(await role("SECOND@example.test", "second-id"), "host");
  assert.equal(await role("other@example.test", "other-id"), "host");
  assert.equal(await role("guest@example.test", "guest-id"), "visitor");
  assert.equal(await role("second@example.test", ""), "visitor");
  assert.equal(await role("", "identity-without-email"), "visitor");
  assert.equal(
    await role("second@example.test", "id", { ...settings, SITES_OWNER_EMAIL: undefined }),
    "visitor",
  );
});

test("verified approval gates previews and original bytes, and favorites and downloads leave accurate host records", async () => {
  const sql = new DatabaseSync(":memory:");
  const root = new URL("../", import.meta.url);
  const dir = ["drizzle", "migrations"].find((d) => {
    try {
      return readdirSync(new URL(d + "/", root)).some((f) =>
        f.endsWith(".sql"),
      );
    } catch {
      return false;
    }
  });
  for (const file of readdirSync(new URL(dir + "/", root))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sql.exec(readFileSync(new URL(dir + "/" + file, root), "utf8"));
  function statement(query, args = []) {
    const s = sql.prepare(query);
    return {
      bind: (...bindings) => statement(query, bindings),
      first: async () => s.get(...args),
      all: async () => ({ results: s.all(...args) }),
      run: async () => s.run(...args),
    };
  }
  const db = {
    prepare: statement,
    batch: async (statements) => {
      sql.exec("BEGIN");
      try {
        for (const s of statements) await s.run();
        sql.exec("COMMIT");
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  };
  const store = new Map();
  const bucket = {
    put: async (key, body, opts) => {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      if (opts?.md5)
        assert.equal(createHash("md5").update(bytes).digest("hex"), opts.md5);
      if (opts?.sha256)
        assert.equal(createHash("sha256").update(bytes).digest("hex"), opts.sha256);
      store.set(key, bytes);
      return { size: bytes.length };
    },
    get: async (key) => {
      const bytes = store.get(key);
      return bytes ? { size: bytes.length, body: bytes } : null;
    },
    delete: async (keys) => {
      for (const k of [keys].flat()) store.delete(k);
    },
  };
  const env = {
    DB: db,
    BUCKET: bucket,
    SITES_OWNER_EMAIL: "hosts@example.test",
  };
  const origin = "https://album.example",
    ctx = { waitUntil: (p) => p.catch(() => {}) };
  const admin = {
    "oai-authenticated-user-email": env.SITES_OWNER_EMAIL,
    "oai-authenticated-user-id": "test-id",
  };
  const phone = "+12025550115",
    guestInput = { name: "Test Guest", phone };
  const oldFetch = globalThis.fetch;
  async function call(path, { data, bytes, headers = {}, method } = {}) {
    const req = new Request(origin + "/api/" + path, {
      method: method || (data !== undefined || bytes ? "POST" : "GET"),
      headers: {
        Origin: origin,
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: data === undefined ? bytes : JSON.stringify(data),
    });
    return albumApi(req, env, ctx);
  }
  const decode = async (r, status = 200) => {
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  const id = "00000000-0000-4000-8000-000000000000";
  try {
    assert.equal((await call("photos")).status, 403);
    assert.equal((await call("host/guests")).status, 403);
    assert.deepEqual(await decode(await call("me")), { role: "visitor", smsEnabled: false, messages: true, videos: true });
    assert.equal((await call("otp/start", { data: guestInput })).status, 503);
    Object.assign(env, {
      TWILIO_ACCOUNT_SID: "test",
      TWILIO_AUTH_TOKEN: "fixture",
      TWILIO_VERIFY_SERVICE_SID: "fixture",
    });
    assert.deepEqual(await decode(await call("me")), { role: "visitor", smsEnabled: true, messages: true, videos: true });
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/Verifications")) {
        assert.equal(init.body.get("To"), phone);
        return Response.json({
          status: "pending",
          sid: "fixture-verification",
        });
      }
      if (String(url).endsWith("/VerificationCheck")) {
        assert.equal(init.body.get("VerificationSid"), "fixture-verification");
        return Response.json({
          status: init.body.get("Code") === "123456" ? "approved" : "pending",
          to: phone,
        });
      }
      throw Error("Unexpected upstream");
    };
    const start = await call("otp/start", { data: guestInput });
    await decode(start);
    const challenge = start.headers.get("Set-Cookie").split(";")[0];
    assert.match(start.headers.get("Set-Cookie"), /HttpOnly/);
    assert.equal((await call("otp/start", { data: guestInput })).status, 429);
    assert.equal(
      (
        await call("otp/check", {
          headers: { Cookie: challenge },
          data: { code: "000000" },
        })
      ).status,
      400,
    );
    sql.exec("UPDATE challenges SET expires=0");
    assert.equal(
      (
        await call("otp/check", {
          headers: { Cookie: challenge },
          data: { code: "123456" },
        })
      ).status,
      400,
    );
    sql.prepare("UPDATE challenges SET expires=?").run(Date.now() + 600000);
    const checked = await call("otp/check", {
      headers: { Cookie: challenge },
      data: { code: "123456" },
    });
    await decode(checked);
    const guest = { Cookie: checked.headers.getSetCookie()[0].split(";")[0] };
    assert.equal(
      (
        await call("otp/check", {
          headers: { Cookie: challenge },
          data: { code: "123456" },
        })
      ).status,
      400,
    );
    assert.equal(
      (await decode(await call("me", { headers: guest }))).status,
      "pending",
    );
    assert.equal(
      (await call("photos/" + id + "/preview", { headers: guest })).status,
      403,
    );
    const listed = await decode(await call("host/guests", { headers: admin }));
    assert.equal(listed.items.length, 1);
    const person = listed.items[0].id;
    await decode(
      await call("host/guest", {
        headers: admin,
        data: { id: person, status: "approved" },
      }),
    );
    const bytes = new Uint8Array([255, 216, 255, 225, 4, 6, 7, 255, 217]);
    const p = await decode(
      await call("host/upload", {
        bytes,
        headers: {
          ...admin,
          "Content-Type": "image/jpeg",
          "X-Photo-Name": "fixture.jpg",
          "X-Photo-Bytes": String(bytes.length),
        },
      }),
      201,
    );
    const hash = createHash("sha256").update(bytes).digest("hex");
    const match = (digest) => call("host/upload-match", { headers: admin, data: { name: "fixture.jpg", bytes: bytes.length, digest } });
    assert.equal((await decode(await match("1".repeat(64)))).existing, false);
    assert.equal((await decode(await match(hash))).id, p.id);
    const retry = await decode(await call("host/upload", { bytes, headers: { ...admin, "Content-Type": "image/jpeg", "X-Photo-Name": "fixture.jpg", "X-Photo-Bytes": String(bytes.length), "X-Photo-SHA256": hash } }));
    assert.equal(retry.id, p.id);
    assert.equal(retry.existing, true);
    const summary = await decode(await call("host/photos", { headers: admin }));
    assert.equal(summary.total, 1);
    assert.equal(summary.published, 0);
    assert.equal(
      (
        await call("photos/" + p.id + "/original", {
          method: "POST",
          headers: guest,
        })
      ).status,
      404,
    );
    await decode(
      await call("host/preview/" + p.id, {
        bytes,
        headers: {
          ...admin,
          "Content-Type": "image/jpeg",
          "X-Photo-Bytes": String(bytes.length),
        },
      }),
    );
    await decode(
      await call("host/publish", {
        headers: admin,
        data: { id: p.id, published: true },
      }),
    );
    const ims = await decode(await call("photos", { headers: guest }));
    assert.equal(ims.items[0].name, "fixture.jpg");
    assert.equal(ims.items[0].drive, undefined);
    assert.equal(
      (await call("photos/" + p.id + "/preview", { headers: guest })).status,
      200,
    );
    for (const on of [true, true, false, true])
      await decode(
        await call("photos/" + p.id + "/favorite", {
          headers: guest,
          data: { on },
        }),
      );
    const original = await call("photos/" + p.id + "/original", {
      method: "POST",
      headers: guest,
    });
    assert.equal(original.status, 200);
    assert.deepEqual(new Uint8Array(await original.arrayBuffer()), bytes);
    assert.match(original.headers.get("Content-Disposition"), /fixture.jpg/);
    assert.equal(
      (
        await call("photos/" + p.id + "/original", {
          method: "POST",
          headers: { ...guest, Origin: "https://unrelated.example" },
        })
      ).status,
      403,
    );
    const a = await decode(await call("host/activity", { headers: admin }));
    assert.deepEqual(
      a.items.map((e) => e.action),
      ["download", "favorite", "unfavorite", "favorite"],
    );
    assert.equal(a.items[0].phone, phone);
    assert.equal(a.items[0].photo, "fixture.jpg");
    await decode(
      await call("host/guest", {
        headers: admin,
        data: { id: person, status: "revoked" },
      }),
    );
    assert.equal(
      (await call("photos/" + p.id + "/preview", { headers: guest })).status,
      403,
    );
    assert.equal(
      (
        await call("photos/" + p.id + "/original", {
          method: "POST",
          headers: guest,
        })
      ).status,
      403,
    );
    await decode(await call("logout", { headers: guest, data: {} }));
    assert.equal(
      (await decode(await call("me", { headers: guest }))).role,
      "visitor",
    );
    // The GitHub invitation works without third-party cookies or a platform login.
    const pagesOrigin = "https://album-guest.github.io";
    const pagesHeaders = { Origin: pagesOrigin, "Sec-Fetch-Site": "cross-site" };
    async function fromPages(path, options = {}) {
      return call("guest/" + path, { ...options, headers: { ...pagesHeaders, ...options.headers } });
    }
    assert.equal((await fromPages("me")).status, 403);
    env.GUEST_WEB_ORIGIN = pagesOrigin;
    const preflight = await fromPages("otp/check", { method: "OPTIONS" });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), pagesOrigin);
    assert.equal(preflight.headers.has("Access-Control-Allow-Credentials"), false);
    assert.equal((await fromPages("me", { headers: { Origin: "https://other.example" } })).status, 403);
    assert.equal((await decode(await fromPages("me", { headers: admin }))).role, "visitor");
    assert.equal((await fromPages("host/guests", { headers: admin })).status, 403);
    sql.exec("DELETE FROM limits");
    const ticket = await fromPages("otp/start", { data: guestInput });
    const challengeToken = (await decode(ticket)).challenge;
    assert.match(challengeToken, /^[0-9a-f]{64}$/);
    assert.equal(ticket.headers.has("Set-Cookie"), false);
    const proof = { Authorization: "Bearer " + challengeToken };
    assert.equal((await fromPages("otp/check", { data: { code: "000000" }, headers: proof })).status, 400);
    const verified = await fromPages("otp/check", { data: { code: "123456" }, headers: proof });
    const sessionToken = (await decode(verified)).session;
    assert.match(sessionToken, /^[0-9a-f]{64}$/);
    assert.equal(verified.headers.has("Set-Cookie"), false);
    const bearer = { Authorization: "Bearer " + sessionToken };
    assert.equal((await fromPages("photos", { headers: bearer })).status, 403);
    await decode(await call("host/guest", { headers: admin, data: { id: person, status: "approved" } }));
    assert.equal((await decode(await fromPages("photos", { headers: bearer }))).items[0].id, p.id);
    assert.equal((await fromPages("photos", { headers: { Cookie: "__Host-sf_session=" + sessionToken } })).status, 403);
    assert.equal((await call("photos", { headers: bearer })).status, 403);
    assert.equal((await fromPages("photos/" + p.id + "/preview", { headers: bearer })).status, 200);
    await decode(await fromPages("photos/" + p.id + "/favorite", { data: { on: true }, headers: bearer }));
    const pagesOriginal = await fromPages("photos/" + p.id + "/original", { headers: bearer, method: "POST" });
    assert.deepEqual(new Uint8Array(await pagesOriginal.arrayBuffer()), bytes);
    await decode(await call("host/guest", { headers: admin, data: { id: person, status: "revoked" } }));
    assert.equal((await fromPages("photos/" + p.id + "/original", { headers: bearer, method: "POST" })).status, 403);
    await decode(await fromPages("logout", { headers: bearer, data: {} }));
    assert.equal((await decode(await fromPages("me", { headers: bearer }))).role, "visitor");
    const rootId = "drive-root-fixture",
      fileId = "drive-file-fixture";
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: "test@example.test",
      private_key_id: "fixture",
      private_key: privateKey.export({ format: "pem", type: "pkcs8" }),
    });
    env.DRIVE_FOLDER_ID = rootId;
    const sample = {
      id: fileId,
      name: "original.jpg",
      parents: [rootId],
      mimeType: "image/jpeg",
      size: String(bytes.length),
      md5Checksum: createHash("md5").update(bytes).digest("hex"),
      capabilities: { canDownload: true },
    };
    globalThis.fetch = async (input, init) => {
      const u = new URL(input);
      if (u.origin === "https://oauth2.googleapis.com")
        return Response.json({ access_token: "test-token", expires_in: 3600 });
      assert.equal(init.headers.Authorization, "Bearer test-token");
      if (u.pathname === "/drive/v3/files")
        return Response.json({ files: [sample] });
      if (u.pathname.endsWith("/" + fileId))
        return u.searchParams.get("alt") === "media"
          ? new Response(bytes)
          : Response.json(sample);
      return new Response(null, { status: 404 });
    };
    assert.equal(
      (await decode(await call("host/drive", { headers: admin }))).files[0].id,
      fileId,
    );
    const imported = await decode(
      await call("host/import", { headers: admin, data: { file: fileId } }),
      201,
    );
    const repeat = await decode(
      await call("host/import", { headers: admin, data: { file: fileId } }),
    );
    assert.equal(imported.id, repeat.id);
    assert.equal(repeat.existing, true);
    const hostOriginal = await call("photos/" + imported.id + "/original", {
      method: "POST",
      headers: admin,
    });
    assert.deepEqual(new Uint8Array(await hostOriginal.arrayBuffer()), bytes);
    assert.equal(
      (
        await call("photos/" + imported.id + "/original", {
          method: "POST",
          headers: guest,
        })
      ).status,
      403,
    );
  } finally {
    globalThis.fetch = oldFetch;
    sql.close();
  }
});
