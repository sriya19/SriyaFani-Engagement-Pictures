import { fail, photoTypes } from "./common.js";
const api = "https://www.googleapis.com/drive/v3/files",
  tokenUrl = "https://oauth2.googleapis.com/token";
const folderMime = "application/vnd.google-apps.folder";
let cached;
export function driveReady(env) {
  return Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON);
}
function base64url(data) {
  return btoa(String.fromCharCode(...data))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
function encode(obj) {
  return base64url(new TextEncoder().encode(JSON.stringify(obj)));
}
async function accessToken(env) {
  if (!driveReady(env))
    fail(
      503,
      "Connect the Google Drive service account in hosting settings, or upload originals from your device.",
    );
  let account;
  try {
    account = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  } catch {
    fail(503, "Check the Google Drive credential in hosting settings.");
  }
  const now = Math.floor(Date.now() / 1000);
  if (
    cached &&
    cached.key === account.private_key_id &&
    cached.email === account.client_email &&
    cached.expires > now + 90
  )
    return cached.token;
  const privateDer = atob(
    account.private_key.replace(/-----[^-]+-----|\s/g, ""),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(privateDer, (c) => c.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const message =
    encode({ alg: "RS256", typ: "JWT" }) +
    "." +
    encode({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/drive.readonly",
      aud: tokenUrl,
      iat: now,
      exp: now + 3600,
    });
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(message),
  );
  const r = await fetch(tokenUrl, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: message + "." + base64url(new Uint8Array(signature)),
    }),
  });
  if (!r.ok)
    fail(
      503,
      "Google Drive could not sign in. Check the service account in hosting settings.",
    );
  const result = await r.json();
  cached = {
    token: result.access_token,
    expires: now + Number(result.expires_in),
    key: account.private_key_id,
    email: account.client_email,
  };
  return cached.token;
}
async function driveGet(env, path, params) {
  const url = new URL(api + path);
  for (const [k, v] of Object.entries(params))
    if (v) url.searchParams.set(k, v);
  const r = await fetch(url, {
    headers: { Authorization: "Bearer " + (await accessToken(env)) },
  });
  if (!r.ok)
    fail(
      r.status === 404 ? 404 : 502,
      "Google Drive could not read this item. Check the folder and its Viewer permission.",
    );
  return r;
}
const idPattern = /^[a-zA-Z0-9_-]{10,160}$/;
export function folderId(value) {
  const raw = String(value || "").trim();
  if (idPattern.test(raw)) return raw;
  try {
    const u = new URL(raw),
      m = u.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)(?:\/|$)/);
    if (
      u.protocol === "https:" &&
      u.hostname === "drive.google.com" &&
      m &&
      idPattern.test(m[1])
    )
      return m[1];
  } catch {}
  fail(400, "Paste a Google Drive folder link.");
}
export async function configuredFolder(env) {
  const row = await env.DB.prepare(
    "SELECT value FROM settings WHERE key='drive_folder'",
  ).first();
  return row?.value || env.DRIVE_FOLDER_ID || "";
}
async function meta(env, id) {
  if (!idPattern.test(id)) fail(400, "Invalid Drive item.");
  return (
    await driveGet(env, "/" + id, {
      fields:
        "id,name,mimeType,parents,trashed,size,md5Checksum,thumbnailLink,capabilities(canDownload)",
      supportsAllDrives: "true",
    })
  ).json();
}
async function inFolder(env, id, root) {
  let cursor = id;
  for (let depth = 0; cursor && depth < 32; depth++) {
    if (cursor === root) return;
    const info = await meta(env, cursor);
    if (info.trashed || info.mimeType !== folderMime) break;
    cursor = info.parents?.[0];
  }
  fail(403, "Choose a photo from the connected folder.");
}
export async function browseDrive(env, url) {
  const root = await configuredFolder(env);
  if (!root) fail(409, "Choose a source folder first.");
  const id = folderId(url.searchParams.get("folder") || root);
  await inFolder(env, id, root);
  const params = {
    q:
      "'" +
      id +
      "' in parents and trashed = false and (mimeType contains 'image/' or mimeType = '" +
      folderMime +
      "')",
    fields:
      "nextPageToken,files(id,name,mimeType,size,capabilities(canDownload))",
    orderBy: "folder,name_natural",
    pageSize: "48",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
    pageToken: url.searchParams.get("page") || "",
  };
  const data = await (await driveGet(env, "", params)).json();
  return {
    files: (data.files || [])
      .filter(
        (f) =>
          f.mimeType === folderMime ||
          (photoTypes.has(f.mimeType) && f.capabilities?.canDownload !== false),
      )
      .map((f) => ({
        id: f.id,
        name: f.name,
        folder: f.mimeType === folderMime,
        bytes: Number(f.size || 0),
      })),
    next: data.nextPageToken || "",
    root,
  };
}
export async function drivePhoto(env, id) {
  const root = await configuredFolder(env);
  if (!root) fail(409, "Choose a source folder first.");
  const info = await meta(env, id);
  if (
    info.trashed ||
    !photoTypes.has(info.mimeType) ||
    !info.parents?.[0] ||
    info.capabilities?.canDownload === false
  )
    fail(400, "Choose a downloadable photo from this folder.");
  await inFolder(env, info.parents[0], root);
  return info;
}
export async function original(env, id) {
  return driveGet(env, "/" + id, { alt: "media", supportsAllDrives: "true" });
}
export async function thumbnail(env, info) {
  if (!info.thumbnailLink) return null;
  let u = new URL(info.thumbnailLink);
  const good = (h) =>
    /^lh[0-9]+\.googleusercontent\.com$/.test(h) ||
    h === "drive.googleusercontent.com" ||
    h === "www.googleapis.com";
  for (let i = 0; i < 3; i++) {
    if (u.protocol !== "https:" || !good(u.hostname)) return null;
    const r = await fetch(u, {
      headers: { Authorization: "Bearer " + (await accessToken(env)) },
      redirect: "manual",
    });
    if (
      [301, 302, 303, 307, 308].includes(r.status) &&
      r.headers.has("Location")
    ) {
      u = new URL(r.headers.get("Location"), u);
      continue;
    }
    if (
      r.ok &&
      ["image/jpeg", "image/png", "image/webp"].includes(
        r.headers.get("Content-Type")?.split(";")[0],
      )
    )
      return r;
    return null;
  }
  return null;
}
