// (2026-11-24) Site › Instagram: posting to the company's Instagram (@defiedmgmt, a professional account) with Meta's
// "Instagram API with Unified Login" (Facebook Login for Business with a configuration; graph.facebook.com; no Facebook Page
// needed). The company's Meta app is a new one, and a new app can't use "Instagram API with Instagram Login". Server only.
//   - a Founder connects it once (pages/api/instagram/connect.js → Facebook's login dialog with the configuration's id →
//     callback.js): the code becomes a Business Integration System User token, which the configuration says never expires, so
//     nothing ever renews it. It's kept in app_state "instagram:conn" locked with AES-256-GCM (the key is a sha256 of
//     SESSION_SECRET), never sent to a browser or written to a log. The account is the one of /me/assigned_instagram_accounts
//     that is @defiedmgmt. A token Meta stops accepting (error 190: the app was removed from the business portfolio, the account
//     moved) is never retried: the Founder is told to press Connect Instagram again
//   - a post (pages/api/instagram.js "publish", only with INSTAGRAM_POSTS=on): containers for the photo / video, a wait
//     until Instagram has them ready, then media_publish; a video still not ready after ~42 s is kept as "pending" and
//     "Check again" carries on with the same containers, so nothing is ever posted twice
//   - each post goes to app_state "instagram:posts" (the last 50), and the handles used to "instagram:handles"
import crypto from "node:crypto";
import { getState, setState, claimState, dropState } from "./app-state";
import { personKey } from "./names";
import { isBlobLink } from "./image-links";
import { TYPES, MAX_CAPTION, MAX_COLLABORATORS, MAX_TAGS, cleanHandle, validHandle, tagSpots } from "./ig-caption";

export const GRAPH = "https://graph.facebook.com";
export const VER = "v27.0";
const AUTHORIZE = `https://www.facebook.com/${VER}/dialog/oauth`;
// the one account the site posts to: of the accounts a Founder shares, this is the one used (a lone account is used whatever its name)
export const COMPANY_HANDLE = "defiedmgmt";
export const KEYS = { conn: "instagram:conn", oauth: "instagram:oauth", posts: "instagram:posts", handles: "instagram:handles", pending: "instagram:pending", lock: "instagram:publishing" };
const OAUTH_MINUTES = 15;
const iso = (t) => new Date(t).toISOString();
const env = (k) => String(process.env[k] ?? "").trim();
// INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET are the Meta app's (App settings › Basic), INSTAGRAM_CONFIG_ID the Facebook Login for
// Business configuration's id (public, not a secret)
export const missingEnv = () => ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "INSTAGRAM_CONFIG_ID"].filter((k) => !env(k));
export const postsOn = () => env("INSTAGRAM_POSTS").toLowerCase() === "on";
const and = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs.join(""));

// an error with a plain line the dashboard can show, and the HTTP status the route answers with
export class IgError extends Error {
  constructor(message, status = 502, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}
// a line with nothing secret left in it: the sign-in itself, the app secret, anything shaped like a Meta access token (EAA…, IG…)
export function scrub(s, ...secrets) {
  let t = String(s ?? "");
  for (const x of [env("INSTAGRAM_APP_SECRET"), ...secrets]) if (x && String(x).length > 6) t = t.split(String(x)).join("…");
  return t.replace(/\b(?:IG|EA)[A-Za-z0-9_-]{20,}/g, "…").slice(0, 400);
}

// ---- the sign-in, locked at rest: "v1.<iv>.<tag>.<ciphertext>" (base64url), AES-256-GCM
const keyOf = () => {
  const secret = env("SESSION_SECRET") || env("INSTAGRAM_APP_SECRET");
  if (!secret) throw new IgError("The site has no secret to lock the Instagram sign-in with.", 503);
  return crypto.createHash("sha256").update(`defied-instagram-token:${secret}`).digest();
};
const AAD = Buffer.from("instagram:conn");
export function sealToken(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", keyOf(), iv);
  c.setAAD(AAD);
  const ct = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return ["v1", iv, c.getAuthTag(), ct].map((x) => (typeof x === "string" ? x : x.toString("base64url"))).join(".");
}
// null when it isn't one of ours or won't open (another secret, changed bytes)
export function openToken(sealed) {
  const [v, iv, tag, ct] = String(sealed ?? "").split(".");
  if (v !== "v1" || !iv || !tag || !ct) return null;
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", keyOf(), Buffer.from(iv, "base64url"));
    d.setAAD(AAD);
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  } catch { return null; }
}

// ---- one call to Meta: JSON back, or an IgError with Meta's own words (scrubbed by the caller's catch).
// The sign-in goes as a Bearer header, never in a URL; the app secret goes in one call only (the code exchange below).
export const RECONNECT = "Instagram disconnected: a Founder presses Connect Instagram again.";
// Meta no longer accepts the sign-in (error 190, or the session / access token said to be invalid, expired or revoked: the app was
// removed from the business portfolio, the account moved to another one). Retrying can't help; a Founder has to connect again.
const tokenRefused = (e) => {
  if (!e || typeof e !== "object") return false;
  if (Number(e.code) === 190 || Number(e.code) === 102) return true;
  const m = String(e.message ?? "");
  return e.type === "OAuthException" && /access token|session/i.test(m) && /invalid|expired|revoked|malformed|no longer valid/i.test(m);
};
// plain: the connect steps give Meta's own words instead (there is no sign-in to lose yet)
async function call(url, { method = "GET", token, json, timeout = 20000, plain = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  let r;
  try { r = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeout) }); }
  catch (err) { throw new IgError(err?.name === "TimeoutError" ? "Instagram didn't answer in time. Try again in a minute." : "Couldn't reach Instagram. Try again in a minute.", 502); }
  const text = await r.text().catch(() => "");
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch { j = null; }
  if (!r.ok || j?.error) {
    const e = j?.error || {};
    // never echoed: Meta's "Malformed access token …" line carries the token itself
    if (!plain && (tokenRefused(e) || (token && r.status === 401))) throw new IgError(RECONNECT, 409, { igCode: e.code, reconnect: true });
    const words = e.error_user_msg || e.message || (typeof j?.error_message === "string" && j.error_message) || `Instagram answered ${r.status}.`;
    throw new IgError(`Instagram: ${words}`, r.status >= 500 ? 502 : 400, { igCode: e.code });
  }
  return j || {};
}

// ---- connecting (Founders): where Facebook sends them back is this site's own address, so a preview works too
// (its address must be on the Meta app's list of valid redirect URIs, like the live one)
export function redirectFor(host) {
  const h = /^[a-z0-9.-]+(:\d{1,5})?$/i.test(String(host ?? "")) ? String(host).toLowerCase() : "www.defiedmgmt.com";
  return `${/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h) ? "http" : "https"}://${h}/api/instagram/callback`;
}
// Facebook Login for Business: the configuration (config_id) says which permissions and assets are asked for, so there is no
// scope here; override_default_response_type lets response_type=code (a system-user token needs the authorization code grant)
export const authUrl = ({ redirect, state }) => `${AUTHORIZE}?${new URLSearchParams({ client_id: env("INSTAGRAM_APP_ID"), config_id: env("INSTAGRAM_CONFIG_ID"), redirect_uri: redirect, response_type: "code", override_default_response_type: "true", state })}`;
// the address to send the Founder to; the one-time state (with who asked and the redirect used) waits 15 minutes
export async function startConnect({ host, by = "", byId = "" }) {
  const missing = missingEnv();
  if (missing.length) throw new IgError(`Instagram isn't set up yet: ${and(missing)} ${missing.length > 1 ? "aren't" : "isn't"} in Vercel.`, 503);
  const state = crypto.randomBytes(24).toString("base64url");
  const redirect = redirectFor(host);
  await setState(KEYS.oauth, { state, redirect, by, byId, at: Date.now() });
  return authUrl({ redirect, state });
}
const sameText = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
// the callback: the code → the system-user token → which account it is; saved locked. Returns "connected" | "expired" | "failed"
// (the outcome is kept in "instagram:oauth" too, so Site › Instagram can say what happened)
export async function finishConnect({ code, state, byId = "", now = Date.now() }) {
  const p = await getState(KEYS.oauth);
  const fresh = p?.state && !p.result && state && sameText(p.state, state) && now - Number(p.at) <= OAUTH_MINUTES * 60 * 1000 && (!p.byId || p.byId === byId);
  // a link used already keeps its outcome (a replay must not turn "connected" into "expired")
  if (!fresh || !code) { if (!p?.result) await setState(KEYS.oauth, { result: "expired", at: now }); return "expired"; }
  await setState(KEYS.oauth, { result: "working", at: now }); // one use only: the same link can't be replayed
  try {
    const got = await exchangeCode(String(code), p.redirect);
    // expiresAt stays null for a token that never expires (the configuration's setting); Meta's own lifetime is kept if it names one
    await setState(KEYS.conn, { userId: got.userId, username: got.username, token: sealToken(got.token), expiresAt: got.expiresIn ? iso(now + got.expiresIn * 1000) : null, connectedBy: p.by || "", at: iso(now) });
    await setState(KEYS.oauth, { result: "connected", at: now });
    return "connected";
  } catch (err) {
    console.error("instagram connect failed:", scrub(err?.message));
    await setState(KEYS.oauth, { result: "failed", why: scrub(err?.message).slice(0, 200), at: now });
    return "failed";
  }
}
// the account to post to, from /me/assigned_instagram_accounts (what the Founder shared): the one whose username is the
// company's, else the only one there is; anything else fails naming what was shared
export function pickAccount(list) {
  const accounts = (Array.isArray(list) ? list : []).filter((a) => a?.id).map((a) => ({ id: String(a.id), username: String(a.username ?? "") }));
  const mine = accounts.find((a) => a.username.toLowerCase() === COMPANY_HANDLE);
  if (mine) return mine;
  if (accounts.length === 1) return accounts[0];
  const named = accounts.map((a) => `@${a.username || a.id}`);
  throw new IgError(named.length
    ? `Instagram shared ${and(named)} with the site, but not @${COMPANY_HANDLE}. Press Connect Instagram again and share @${COMPANY_HANDLE}.`
    : `Instagram didn't share any account with the site. Press Connect Instagram again and share @${COMPANY_HANDLE}.`, 400);
}
// the code → the token (a server-to-server call: this is the one place the app secret goes) → the account's id and username
export async function exchangeCode(code, redirect) {
  let got = {};
  try {
    const q = new URLSearchParams({ client_id: env("INSTAGRAM_APP_ID"), client_secret: env("INSTAGRAM_APP_SECRET"), redirect_uri: redirect, code });
    got = await call(`${GRAPH}/${VER}/oauth/access_token?${q}`, { plain: true });
    if (!got.access_token) throw new IgError("Instagram didn't give a sign-in. Try Connect again.");
    const mine = await call(`${GRAPH}/${VER}/me/assigned_instagram_accounts?fields=id,username`, { token: got.access_token, plain: true });
    const account = pickAccount(mine.data);
    return { token: got.access_token, expiresIn: Number(got.expires_in) > 0 ? Number(got.expires_in) : 0, userId: account.id, username: account.username };
  } catch (err) {
    // Meta's words can echo what it was sent: neither token nor the code goes any further
    err.message = scrub(err?.message, got.access_token, code);
    throw err;
  }
}
export async function disconnect() { await setState(KEYS.conn, null); }

// what Site › Instagram shows: never the sign-in itself
export async function igStatus({ now = Date.now() } = {}) {
  const c = await getState(KEYS.conn).catch(() => null);
  const o = await getState(KEYS.oauth).catch(() => null);
  const base = { missing: missingEnv(), postsOn: postsOn(), last: o?.result && o.result !== "working" && now - Number(o.at) < 10 * 60 * 1000 ? { result: o.result, why: o.why || "" } : null };
  if (!c?.token) return { ...base, connected: false };
  const readable = openToken(c.token) != null;
  const expired = !!c.expiresAt && Date.parse(c.expiresAt) <= now;
  return { ...base, connected: readable && !expired, expired, unreadable: !readable, username: c.username || "", expiresAt: c.expiresAt || null, connectedBy: c.connectedBy || "", at: c.at || null, canPublish: c.canPublish !== false };
}

// the sign-in to post with. The system-user token never expires and is never renewed (no refresh call exists), so this only
// opens it; a token Meta stops accepting shows up as RECONNECT on the call that uses it. A token with a lifetime Meta named at
// connect time (expiresAt) is refused once that has passed.
export async function liveConn({ now = Date.now() } = {}) {
  const c = await getState(KEYS.conn);
  if (!c?.token) throw new IgError("Instagram isn't connected. A Founder presses Connect Instagram in Site › Instagram.", 409);
  const token = openToken(c.token);
  if (!token) throw new IgError("The saved Instagram sign-in can't be read (the site's secret changed). A Founder presses Connect Instagram again.", 409);
  const exp = Date.parse(c.expiresAt) || 0;
  if (exp && exp <= now) throw new IgError("The Instagram sign-in ran out. A Founder presses Connect Instagram again.", 409);
  return { userId: String(c.userId || ""), username: c.username || "", token };
}

// ---- a post: what the composer sends, checked
// images: an uploaded file (Vercel Blob) or a Spotify cover; videos: an uploaded file only
const okImage = (u) => /^https:\/\//i.test(u) && (isBlobLink(u) || /^https:\/\/([a-z0-9-]+\.)*(scdn\.co|spotifycdn\.com)\//i.test(u));
const okVideo = (u) => /^https:\/\//i.test(u) && isBlobLink(u);
const handles = (list, max, what) => {
  const out = [];
  for (const h of [].concat(list || []).map(cleanHandle).filter(Boolean)) {
    if (!validHandle(h)) return { error: `“${h.slice(0, 40)}” isn't an Instagram handle.` };
    if (!out.some((x) => x.toLowerCase() === h.toLowerCase())) out.push(h);
  }
  return out.length > max ? { error: `Instagram allows at most ${max} ${what} on a post.` } : { list: out };
};
export function checkPost(p) {
  const post = p && typeof p === "object" ? p : {};
  const type = TYPES.includes(post.type) ? post.type : null;
  if (!type) return { error: "Pick Single, Album or Video only." };
  const caption = String(post.caption ?? "").trim();
  if (!caption) return { error: "The caption is empty." };
  if (caption.length > MAX_CAPTION) return { error: `The caption is ${caption.length} characters; Instagram's limit is ${MAX_CAPTION}.` };
  const collab = handles(post.collaborators, MAX_COLLABORATORS, "collaborators");
  if (collab.error) return collab;
  const tags = handles(post.tags, MAX_TAGS, "people tagged");
  if (tags.error) return tags;
  const out = { type, caption, collaborators: collab.list, tags: tags.list, title: String(post.title ?? "").slice(0, 200) };
  if (type === "video") {
    const v = String(post.video ?? "");
    if (!okVideo(v)) return { error: "Add the video (uploaded here) first." };
    out.video = v;
  } else {
    const cover = String(post.cover ?? "");
    if (!okImage(cover)) return { error: "The cover has to be the Spotify cover or an image uploaded here." };
    out.cover = cover;
    if (post.slide2) {
      const kind = post.slide2.kind === "video" ? "video" : post.slide2.kind === "image" ? "image" : null;
      const url = String(post.slide2.url ?? "");
      if (!kind || !(kind === "video" ? okVideo(url) : okImage(url))) return { error: "Slide 2 has to be a video or an image uploaded here." };
      out.slide2 = { kind, url };
    }
  }
  // who was on it, to remember their handles for next time: [{ name, handle }]
  out.people = [].concat(post.people || []).slice(0, 60).map((x) => ({ name: String(x?.name ?? "").slice(0, 120), handle: cleanHandle(x?.handle) })).filter((x) => x.name && validHandle(x.handle));
  return { post: out };
}

// the containers a post needs, as a job the steps below carry out (and a "Check again" picks up where it stopped):
//   one photo  → { creationId }                     (the photo's container, its tags and collaborators on it)
//   carousel   → { children, parent }               (the cover with the tags, then slide 2; the parent has the caption)
//   Reel       → { creationId }                     (shown on the feed too)
const withList = (o, k, v) => (v && v.length ? { ...o, [k]: v } : o);
export function containersFor(post) {
  const userTags = post.tags.map((username, i) => ({ username, ...tagSpots(post.tags.length)[i] }));
  if (post.type === "video") return { single: withList({ media_type: "REELS", video_url: post.video, caption: post.caption, share_to_feed: true }, "collaborators", post.collaborators) };
  if (!post.slide2) return { single: withList(withList({ image_url: post.cover, caption: post.caption }, "user_tags", userTags), "collaborators", post.collaborators) };
  return {
    children: [
      withList({ image_url: post.cover, is_carousel_item: true }, "user_tags", userTags),
      post.slide2.kind === "video" ? { media_type: "VIDEO", video_url: post.slide2.url, is_carousel_item: true } : { image_url: post.slide2.url, is_carousel_item: true },
    ],
    parent: withList({ media_type: "CAROUSEL", caption: post.caption }, "collaborators", post.collaborators),
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// the route may run 60 s (pages/api/instagram.js): the waiting stops ~42 s after the post started, leaving room for
// media_publish and the permalink
export const POLL_MS = 3000, BUDGET_MS = 42000;
// Instagram fetches and processes each file by itself: wait for FINISHED (ERROR / EXPIRED stop at once). Out of time
// throws { pending } with the job so far, for "Check again".
async function ready(conn, id, clock, job) {
  for (;;) {
    const s = await call(`${GRAPH}/${VER}/${encodeURIComponent(id)}?fields=status_code,status`, { token: conn.token });
    if (s.status_code === "FINISHED" || s.status_code === "PUBLISHED") return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") {
      throw new IgError(`Instagram couldn't use that ${s.status_code === "EXPIRED" ? "upload any more (it expired)" : "file"}${s.status ? `: ${String(s.status).replace(/^ERROR:?\s*/i, "")}` : ""}. Check the video or image and post again.`, 400, { failed: true });
    }
    if (clock.now() + POLL_MS > clock.until) throw new IgError("Instagram is still getting the video ready. Press Check again in a minute: it won't post twice.", 202, { pending: job });
    await clock.sleep(POLL_MS);
  }
}
const create = async (conn, params) => {
  const r = await call(`${GRAPH}/${VER}/${encodeURIComponent(conn.userId)}/media`, { method: "POST", token: conn.token, json: params });
  if (!r.id) throw new IgError("Instagram didn't make the post's container. Try again.");
  return String(r.id);
};
// media_publish can say a part of the post was dropped although it published (config_issue); that is a posted post with a
// line to show, never an error (a second try would post it twice)
const ISSUES = {
  CAPTION_NOT_ATTACHED: "Posted, but Instagram left the caption off. Add the caption to the post in the Instagram app.",
  USER_TAGGING_FAILURE: "Posted, but Instagram left the people tags off. Tag them on the post in the Instagram app.",
};
const issueLine = (issue) => (issue ? ISSUES[issue] || `Posted, but Instagram left part of it out (${String(issue).replace(/[^A-Za-z0-9_ -]/g, "").slice(0, 60)}). Check the post in the Instagram app.` : null);
// job: { creationId?, children?: [ids], parent?, childParams? } → { mediaId, permalink, warning? }. Carries on from whatever it has.
export async function runJob(conn, job, { sleep = wait, now = Date.now, budgetMs = BUDGET_MS, until = null } = {}) {
  const clock = { sleep, now, until: until ?? now() + budgetMs };
  const j = { ...job };
  if (!j.creationId && j.childParams && !j.children) {
    j.children = [];
    for (const c of j.childParams) j.children.push(await create(conn, c));
  }
  if (!j.creationId && j.children) {
    for (const id of j.children) await ready(conn, id, clock, j);
    j.creationId = await create(conn, { ...j.parent, children: j.children.join(",") });
  }
  if (!j.creationId && j.single) j.creationId = await create(conn, j.single);
  await ready(conn, j.creationId, clock, j);
  const pub = await call(`${GRAPH}/${VER}/${encodeURIComponent(conn.userId)}/media_publish`, { method: "POST", token: conn.token, json: { creation_id: j.creationId } });
  if (!pub.id) throw new IgError("Instagram didn't publish it. Try again.");
  const warning = issueLine(pub.config_issue);
  let permalink = null;
  try { permalink = (await call(`${GRAPH}/${VER}/${encodeURIComponent(pub.id)}?fields=permalink`, { token: conn.token, timeout: 8000 })).permalink || null; }
  catch { /* posted; only its link couldn't be read */ }
  return { mediaId: String(pub.id), permalink, ...(warning && { warning }) };
}
export function jobFor(post) {
  const c = containersFor(post);
  return c.single ? { single: c.single } : { childParams: c.children, parent: c.parent };
}

// the whole post, as the route runs it: one at a time (a second press while one runs is refused), then logged.
// resume: carry on with the pending one instead of starting a new post.
export async function publish({ post, by = "", resume = false }, opts = {}) {
  const until = (opts.now || Date.now)() + (opts.budgetMs ?? BUDGET_MS);
  if (!postsOn()) throw new IgError("Posting to Instagram is off. A Founder turns it on with INSTAGRAM_POSTS=on in Vercel.", 503, { off: true });
  if (!(await claimState(KEYS.lock, 2))) throw new IgError("A post is already going out. Wait a moment.", 409);
  let conn = null;
  try {
    const pending = await getState(KEYS.pending);
    const stale = pending && Date.now() - Number(pending.at) > 23 * 60 * 60 * 1000; // Instagram drops containers after a day
    if (resume && (!pending || stale)) { if (stale) await setState(KEYS.pending, null); throw new IgError("There's nothing waiting to post any more. Post it again.", 409); }
    if (!resume && pending && !stale) throw new IgError("A post is still waiting on Instagram. Press Check again (or Discard it) first.", 409);
    conn = await liveConn({ now: (opts.now || Date.now)() });
    const record = resume ? pending.record : { type: post.type, caption: post.caption, title: post.title, people: post.people, by };
    let done;
    try {
      // the account itself can't be its own collaborator or tag (Instagram refuses the whole post)
      const notMe = (h) => h.toLowerCase() !== String(conn.username || "").toLowerCase();
      done = await runJob(conn, resume ? pending.job : jobFor({ ...post, collaborators: post.collaborators.filter(notMe), tags: post.tags.filter(notMe) }), { ...opts, until });
    } catch (err) {
      if (err?.pending) await setState(KEYS.pending, { job: err.pending, record, at: resume ? pending.at : Date.now(), by: record.by });
      else if (resume && err?.failed) await setState(KEYS.pending, null);
      throw err;
    }
    if (resume) await setState(KEYS.pending, null);
    await logPost({ ...record, ...done });
    return { ...done, username: conn.username };
  } catch (err) {
    if (err instanceof IgError) { err.message = scrub(err.message, conn?.token); throw err; }
    throw new IgError(scrub(err?.message || "Posting failed.", conn?.token));
  } finally {
    await dropState(KEYS.lock).catch(() => {});
  }
}
export async function discardPending() { await setState(KEYS.pending, null); }
export async function pendingInfo() {
  const p = await getState(KEYS.pending).catch(() => null);
  return p?.record ? { at: iso(Number(p.at)), type: p.record.type, title: p.record.title || "", by: p.record.by || "" } : null;
}

// the last 50 posts, newest first, and every handle used (by the person's name) for the next post's prefill
async function logPost({ type, caption, title, by, people, permalink, mediaId, warning }) {
  try {
    const posts = (await getState(KEYS.posts)) || [];
    await setState(KEYS.posts, [{ at: new Date().toISOString(), by, type, title: title || "", caption, permalink, mediaId, ...(warning && { warning }) }, ...posts].slice(0, 50));
    await rememberHandles(people);
  } catch (err) { console.error("instagram post log failed:", scrub(err?.message)); } // posted: the log is best effort
}
export async function rememberHandles(people) {
  const list = (people || []).filter((p) => personKey(p.name) && validHandle(p.handle));
  if (!list.length) return;
  const known = (await getState(KEYS.handles)) || {};
  for (const p of list) known[personKey(p.name)] = p.handle;
  await setState(KEYS.handles, known);
}
export async function recentPosts(n = 10) { return ((await getState(KEYS.posts).catch(() => null)) || []).slice(0, n); }
