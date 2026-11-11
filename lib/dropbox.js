// Dropbox for the website's music files (the owner, 2026-11-10: "i have dropbox … we still have limits so its not crazy
// big files"). Server only. The "Defied Submissions" app (App folder access: Dropbox › Apps › Defied Submissions):
//   - a Founder connects it once (pages/api/dropbox/connect.js → Dropbox → callback.js), PKCE with no app secret, and
//     the long-lived refresh token is kept in app_state "dropbox" (never sent to a browser)
//   - a visitor's file goes straight from their browser to a one-time upload link (files/get_temporary_upload_link),
//     so a 50 MB file never passes through the site (Vercel's request limit is 4.5 MB)
//   - after the upload the site checks each file (size, type), makes a shared link (sharing/…), and ClickUp gets them
import crypto from "node:crypto";
import { getState, setState } from "./app-state";

export const APP_KEY = process.env.DROPBOX_APP_KEY || "75alytmv74l9gg8"; // the app's public key (a client id, not a secret)
export const REDIRECT = process.env.DROPBOX_REDIRECT || "https://www.defiedmgmt.com/api/dropbox/callback";
const API = process.env.DROPBOX_API_BASE || "https://api.dropboxapi.com";
const AUTH = process.env.DROPBOX_AUTH_BASE || "https://www.dropbox.com";
const CONTENT = process.env.DROPBOX_CONTENT_BASE || "https://content.dropboxapi.com";
export const MAX_FILES = 5, MAX_MB = 50;
export const MAX_BYTES = MAX_MB * 1024 * 1024;
export const AUDIO = ["mp3", "wav", "m4a", "aac", "aif", "aiff", "flac", "ogg"];
export const extOf = (name) => (String(name).match(/\.([a-z0-9]{2,5})$/i)?.[1] || "").toLowerCase();

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function pkce() {
  const verifier = b64url(crypto.randomBytes(48));
  return { verifier, challenge: b64url(crypto.createHash("sha256").update(verifier).digest()), state: b64url(crypto.randomBytes(18)) };
}
export const authUrl = ({ challenge, state }) => `${AUTH}/oauth2/authorize?${new URLSearchParams({
  client_id: APP_KEY, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", token_access_type: "offline", redirect_uri: REDIRECT, state,
})}`;

async function tokenCall(params) {
  const r = await fetch(`${API}/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: APP_KEY, ...params }), signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.access_token) throw new Error(`Dropbox sign-in failed (${r.status}${j?.error ? `: ${j.error}` : ""}).`);
  return j;
}
// the callback: the code for a refresh token, kept with who connected it
export async function connect(code, verifier, by = "") {
  const j = await tokenCall({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT });
  if (!j.refresh_token) throw new Error("Dropbox didn't give a lasting sign-in. Try Connect again.");
  await setState("dropbox", { refresh_token: j.refresh_token, account_id: j.account_id || "", connected_at: new Date().toISOString(), by });
  cached = { token: j.access_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60000 };
}
export async function status() {
  const s = await getState("dropbox").catch(() => null);
  return s?.refresh_token ? { connected: true, at: s.connected_at || null, by: s.by || "" } : { connected: false };
}
export async function disconnect() {
  const tok = await accessToken().catch(() => null);
  if (tok) await fetch(`${API}/2/auth/token/revoke`, { method: "POST", headers: { Authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(10000) }).catch(() => null);
  await setState("dropbox", null);
  cached = null;
}
let cached = null;
async function accessToken() {
  if (cached && cached.until > Date.now()) return cached.token;
  const s = await getState("dropbox");
  if (!s?.refresh_token) throw new Error("Dropbox isn't connected.");
  const j = await tokenCall({ grant_type: "refresh_token", refresh_token: s.refresh_token });
  cached = { token: j.access_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60000 };
  return cached.token;
}
async function rpc(path, body) {
  const r = await fetch(`${API}/2/${path}`, { method: "POST", headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => null);
  if (!r.ok) { const e = new Error(`Dropbox ${path}: ${r.status}`); e.status = r.status; e.body = j; throw e; }
  return j;
}

// a folder per message, "/2026-11-10 Name - subject": nothing a sender types can reach outside it
const clean = (s, n) => String(s || "").normalize("NFKC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, n);
export const folderFor = ({ id, name, subject, at = new Date() }) => `/${new Date(at).toISOString().slice(0, 10)} ${clean(name, 60) || "Someone"}${subject ? ` - ${clean(subject, 40)}` : ""} (${id})`;
export const fileName = (name, i) => { const n = clean(name, 120); return n && extOf(n) ? n : `file-${i + 1}${extOf(name) ? `.${extOf(name)}` : ""}`; };
// one-time links the browser POSTs each file to (4 hours; Dropbox's own cap on one is 150 MB, ours is checked after)
export async function uploadLinks(folder, names) {
  const out = [];
  for (const n of names) {
    const j = await rpc("files/get_temporary_upload_link", { commit_info: { path: `${folder}/${n}`, mode: "add", autorename: true, mute: false }, duration: 14400 });
    out.push({ name: n, link: j.link });
  }
  return out;
}
// (2026-11-10, the owner: "make sure the uploads are only audio files") the first bytes of a file, read from Dropbox, must
// be an audio file's own start, whatever its name says: MP3 (ID3 or a frame), WAV, AIFF, FLAC, Ogg, M4A/AAC (ftyp)
export function isAudioStart(b) {
  if (!b || b.length < 12) return false;
  const at = (i, s) => b.slice(i, i + s.length).toString("latin1") === s;
  return at(0, "ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) || (at(0, "RIFF") && at(8, "WAVE")) || (at(0, "FORM") && (at(8, "AIFF") || at(8, "AIFC")))
    || at(0, "fLaC") || at(0, "OggS") || at(4, "ftyp");
}
async function firstBytes(path) {
  const r = await fetch(`${CONTENT}/2/files/download`, { method: "POST", headers: { Authorization: `Bearer ${await accessToken()}`, "Dropbox-API-Arg": JSON.stringify({ path }), Range: "bytes=0-31" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok && r.status !== 206) throw new Error(`Dropbox download: ${r.status}`);
  return Buffer.from(await r.arrayBuffer()).subarray(0, 32);
}
// what actually arrived: files over the size cap, not named as audio, or not audio inside are deleted; the rest get a shared link
export async function finishFolder(folder) {
  let entries = [];
  try { entries = (await rpc("files/list_folder", { path: folder })).entries || []; }
  catch (err) { if (err.status === 409) return { files: [], removed: [] }; throw err; } // nothing arrived: no folder
  const files = [], removed = [];
  for (const e of entries.filter((x) => x[".tag"] === "file")) {
    const why = e.size > MAX_BYTES ? `over ${MAX_MB} MB` : !AUDIO.includes(extOf(e.name)) ? "not an audio file"
      : !isAudioStart(await firstBytes(e.path_lower).catch(() => null)) ? "not an audio file inside" : null;
    if (why) {
      await rpc("files/delete_v2", { path: e.path_lower }).catch(() => null);
      removed.push({ name: e.name, why });
      continue;
    }
    files.push({ name: e.name, size: e.size, url: await sharedLink(e.path_lower) });
  }
  return { files, removed };
}
async function sharedLink(path) {
  try { return (await rpc("sharing/create_shared_link_with_settings", { path, settings: { requested_visibility: "public" } })).url; }
  catch (err) {
    const had = err.body?.error?.shared_link_already_exists?.metadata?.url;
    if (had) return had;
    const l = await rpc("sharing/list_shared_links", { path, direct_only: true }).catch(() => null);
    if (l?.links?.[0]?.url) return l.links[0].url;
    throw err;
  }
}
// the finish call's proof that it's the browser that sent the message (HMAC of its id with the session secret)
export const fileToken = (id) => crypto.createHmac("sha256", String(process.env.SESSION_SECRET || "dev")).update(`files:${id}`).digest("hex").slice(0, 32);
export const sizeWords = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
