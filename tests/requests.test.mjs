import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createECDH, createDecipheriv, generateKeyPairSync, hkdfSync, randomBytes, verify } from "node:crypto";
import { albumApi } from "../album/api.js";

test("manual requests are independent per browser and approvals deliver private host and guest notifications", async () => {
  const sql = new DatabaseSync(":memory:");
  const local = new URL("../drizzle/", import.meta.url);
  const directory = existsSync(local) ? local : new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter(f=>f.endsWith(".sql")).sort())
    sql.exec(readFileSync(new URL(file, directory), "utf8"));
  function prep(q,args=[]) {
    const st = sql.prepare(q);
    return { bind:(...a)=>prep(q,a), first:async()=>st.get(...args), all:async()=>({results:st.all(...args)}), run:()=>st.run(...args) };
  }
  const db = {prepare:prep, batch:async arr=>{
    sql.exec("BEGIN");
    try { const rows=arr.map(s=>s.run()); sql.exec("COMMIT"); return rows; }
    catch(e) {sql.exec("ROLLBACK"); throw e;}
  }};
  const site="https://album.example", pages="https://guest.example";
  const signing=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
  const env={DB:db,GUEST_WEB_ORIGIN:pages,SITES_OWNER_EMAIL:"host@example.test",OWNER_PHONE:"+12025550123",
    WEB_PUSH_PRIVATE_JWK:JSON.stringify(signing.privateKey.export({format:"jwk"}))};
  const background=[];
  const ctx={waitUntil:p=>background.push(p)};
  const settle=async()=>{while(background.length) await Promise.all(background.splice(0));};
  const admin={"oai-authenticated-user-id":"host-id","oai-authenticated-user-email":env.SITES_OWNER_EMAIL};
  async function api(path,{data,headers={},host=false}={}) {
    const request=new Request(site+(host?"/api/":"/api/guest/")+path,{
      method:data===undefined?"GET":"POST",headers:{Origin:host?site:pages,"Content-Type":"application/json",...headers},
      body:data===undefined?undefined:JSON.stringify(data)});
    return albumApi(request,env,ctx);
  }
  // This test covers hosts approving by hand, so automatic access is turned off first.
  assert.equal((await api("host/settings/auto-approve",{headers:{}})).status,403);
  assert.equal((await (await api("host/settings/auto-approve",{headers:admin,host:true})).json()).on,true);
  assert.equal((await (await api("host/settings/auto-approve",{data:{on:false},headers:admin,host:true})).json()).on,false);
  const receipts=[], recipients=new Map();
  function browser(id) {
    const ec=createECDH("prime256v1");ec.generateKeys();const auth=randomBytes(16);
    const endpoint="https://web.push.apple.com/"+id;
    recipients.set(endpoint,{ec,auth});
    return {endpoint,keys:{p256dh:ec.getPublicKey().toString("base64url"),auth:auth.toString("base64url")}};
  }
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async (endpoint,options)=>{
    const {ec,auth}=recipients.get(endpoint);
    const jwt=options.headers.Authorization.match(/^vapid t=([^,]+)/)[1].split(".");
    assert.equal(verify("sha256",Buffer.from(jwt[0]+"."+jwt[1]),{key:signing.publicKey,dsaEncoding:"ieee-p1363"},Buffer.from(jwt[2],"base64url")),true);
    assert.equal(JSON.parse(Buffer.from(jwt[1],"base64url")).aud,new URL(endpoint).origin);
    const wire=Buffer.from(options.body); assert.equal(wire.readUInt32BE(16),4096);
    const server=wire.subarray(21,21+wire[20]),salt=wire.subarray(0,16);
    const seed=hkdfSync("sha256",ec.computeSecret(server),auth,Buffer.concat([Buffer.from("WebPush: info\0"),ec.getPublicKey(),server]),32);
    const k=hkdfSync("sha256",seed,salt,Buffer.from("Content-Encoding: aes128gcm\0"),16);
    const iv=hkdfSync("sha256",seed,salt,Buffer.from("Content-Encoding: nonce\0"),12);
    const dec=createDecipheriv("aes-128-gcm",k,iv);dec.setAuthTag(wire.subarray(-16));
    const clear=Buffer.concat([dec.update(wire.subarray(21+wire[20],-16)),dec.final()]);
    assert.equal(clear.at(-1),2);receipts.push([endpoint,clear.subarray(0,-1).toString()]);
    return new Response(null,{status:201});
  };
  try {
    const hostSub=browser("host"), guestSub=browser("guest");
    assert.equal((await (await api("notifications/key")).json()).key.length,87);
    assert.equal((await api("notifications/subscribe",{data:hostSub})).status,403);
    assert.equal((await api("notifications/subscribe",{data:hostSub,headers:admin,host:true})).status,200);
    await settle();
    const raw=randomBytes(32).toString("hex"), details={name:"Test guest",phone:env.OWNER_PHONE,ticket:raw};
    const headers={Authorization:"Bearer "+raw};
    assert.equal((await api("access/request",{data:{...details,phone:"123"}})).status,400);
    assert.equal((await (await api("access/request",{data:details})).json()).session,raw);
    await settle();
    assert.deepEqual(receipts,[[hostSub.endpoint,"request"]]);
    assert.equal((await api("access/request",{data:details})).status,200);
    assert.equal(sql.prepare("SELECT count(*) AS n FROM guests").get().n,1);
    assert.equal((await api("photos",{headers})).status,403);
    assert.equal((await api("host/requests-count",{headers:{Cookie:"__Host-sf_session="+raw},host:true})).status,403);
    const guest=sql.prepare("SELECT id,phone_verified FROM guests").get();
    assert.equal(guest.phone_verified,0);
    assert.equal((await api("notifications/subscribe",{headers,data:{...guestSub,endpoint:"https://example.test/invalid"}})).status,400);
    assert.equal((await api("notifications/subscribe",{headers,data:guestSub})).status,200); await settle();
    const approve={data:{id:guest.id,status:"approved"},headers:admin,host:true};
    assert.equal((await api("host/guest",approve)).status,200); await settle();
    assert.deepEqual(receipts.at(-1),[guestSub.endpoint,"approved"]);
    assert.equal((await api("photos",{headers})).status,200);
    assert.equal((await (await api("me",{headers})).json()).messages,true);
    assert.equal((await api("messages",{headers,data:{text:"   "}})).status,400);
    assert.equal((await api("messages",{headers,data:{text:"x".repeat(2001)}})).status,400);
    assert.equal((await api("messages",{headers,data:{text:"  Congratulations, you two!  "}})).status,200);
    assert.equal((await api("host/messages",{headers})).status,403);
    const notes=await (await api("host/messages",{headers:admin,host:true})).json();
    assert.deepEqual(notes.items.map(n=>[n.body,n.guest]),[["Congratulations, you two!","Test guest"]]);
    assert.equal((await api("host/messages/delete",{data:{id:notes.items[0].id},headers:admin,host:true})).status,200);
    assert.equal((await (await api("host/messages",{headers:admin,host:true})).json()).items.length,0);
    assert.equal((await api("messages",{headers,data:{text:"One more"}})).status,200);
    await api("host/guest",approve); await settle(); assert.equal(receipts.length,2);
    const late=browser("late"); await api("notifications/subscribe",{headers,data:late}); await settle();
    assert.deepEqual(receipts.at(-1),[late.endpoint,"approved"]);
    await api("notifications/subscribe",{headers,data:late}); await settle(); assert.equal(receipts.length,3);
    const other=randomBytes(32).toString("hex"); await api("access/request",{data:{...details,ticket:other}});
    await settle(); assert.equal((await api("photos",{headers:{Authorization:"Bearer "+other}})).status,403);
    assert.equal((await (await api("host/requests-count",{headers:admin,host:true})).json()).pending,1);
    await api("host/guest",{...approve,data:{id:guest.id,status:"revoked"}}); await settle();
    assert.equal((await api("photos",{headers})).status,403);
    assert.equal((await api("messages",{headers,data:{text:"After revoke"}})).status,403);
    const remove={data:{id:guest.id},headers:admin,host:true};
    assert.equal((await api("host/guest/delete",{...remove,headers:{}})).status,403);
    await api("host/guest",approve); await settle();
    assert.equal((await api("host/guest/delete",remove)).status,409);
    await api("host/guest",{...approve,data:{id:guest.id,status:"revoked"}}); await settle();
    sql.prepare("INSERT INTO photos(id,name,mime,bytes,created) VALUES('p','a.jpg','image/jpeg',1,1)").run();
    sql.prepare("INSERT INTO activity(guest,photo,action,created) VALUES(?,?,?,?)").run(guest.id,"p","download",1);
    sql.prepare("INSERT INTO favorites(guest,photo) VALUES(?,?)").run(guest.id,"p");
    assert.equal((await api("host/guest/delete",remove)).status,200);
    for (const [table,column] of [["guests","id"],["sessions","guest"],["activity","guest"],["favorites","guest"],["push_subscriptions","owner"],["messages","guest"]])
      assert.equal(sql.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column}=?`).get(guest.id).n,0,table);
    assert.equal(sql.prepare("SELECT count(*) AS n FROM guests").get().n,1);
    assert.equal((await api("photos",{headers})).status,403);
    assert.equal((await api("host/guest/delete",remove)).status,404);
  } finally {await settle();globalThis.fetch=oldFetch;sql.close();}
});
