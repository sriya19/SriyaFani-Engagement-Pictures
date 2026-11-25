import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { albumApi } from "../album/api.js";

test("with automatic access on, a guest who shares a name and number sees the album at once", async () => {
  const sql = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) sql.exec(readFileSync(new URL(f, dir), "utf8"));
  const prep = (q, args = []) => { const st = sql.prepare(q); return { bind: (...a) => prep(q, a), first: async () => st.get(...args), all: async () => ({ results: st.all(...args) }), run: async () => st.run(...args) }; };
  const db = { prepare: prep, batch: async (arr) => { for (const s of arr) await s.run(); } };
  const site = "https://album.example", pages = "https://guest.example";
  const env = { DB: db, GUEST_WEB_ORIGIN: pages, SITES_OWNER_EMAIL: "host@example.test", OWNER_PHONE: "+12025550123" };
  const ctx = { waitUntil() {} };
  const admin = { "oai-authenticated-user-id": "host", "oai-authenticated-user-email": env.SITES_OWNER_EMAIL };
  const call = (path, { data, headers = {}, host = false } = {}) => albumApi(new Request(site + (host ? "/api/" : "/api/guest/") + path, {
    method: data === undefined ? "GET" : "POST",
    headers: { Origin: host ? site : pages, "Content-Type": "application/json", ...headers },
    body: data === undefined ? undefined : JSON.stringify(data),
  }), env, ctx);

  const ticket = "b".repeat(64), guest = { Authorization: "Bearer " + ticket };
  assert.equal((await call("photos", { headers: guest })).status, 403);
  const sent = await call("access/request", { data: { name: "Asha", phone: "+919800000001", ticket } });
  assert.equal(sent.status, 200);
  const me = await (await call("me", { headers: guest })).json();
  assert.equal(me.role, "guest"); assert.equal(me.status, "approved");
  assert.equal((await call("photos", { headers: guest })).status, 200);
  const list = await (await call("host/guests", { headers: admin, host: true })).json();
  assert.deepEqual(list.items.map((g) => [g.name, g.status]), [["Asha", "approved"]]);

  // Revoking still works, and turning automatic access off makes new guests wait.
  await call("host/guest", { host: true, headers: admin, data: { id: list.items[0].id, status: "revoked" } });
  assert.equal((await call("photos", { headers: guest })).status, 403);
  await call("host/settings/auto-approve", { host: true, headers: admin, data: { on: false } });
  const later = { Authorization: "Bearer " + "c".repeat(64) };
  await call("access/request", { data: { name: "Ravi", phone: "+919800000002", ticket: "c".repeat(64) } });
  assert.equal((await (await call("me", { headers: later })).json()).status, "pending");
  assert.equal((await call("photos", { headers: later })).status, 403);
  sql.close();
});
