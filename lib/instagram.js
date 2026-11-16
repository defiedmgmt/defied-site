// (2026-11-16) Site › Instagram: posting to the company's Instagram (@defiedmgmt, a professional account) with the
// "Instagram API with Instagram Login" (graph.instagram.com, no Facebook Page). Server only.
//   - a Founder connects it once (pages/api/instagram/connect.js → Instagram → callback.js): the code becomes a 60-day
//     sign-in, kept in app_state "instagram:conn" locked with AES-256-GCM (the key is a sha256 of SESSION_SECRET), never
//     sent to a browser or written to a log; it's renewed before a post (and when the tab opens) once it's a day old
//   - a post (pages/api/instagram.js "publish", only with INSTAGRAM_POSTS=on): containers for the photo / video, a wait
//     until Instagram has them ready, then media_publish; a video still not ready after ~42 s is kept as "pending" and
//     "Check again" carries on with the same containers, so nothing is ever posted twice
//   - each post goes to app_state "instagram:posts" (the last 50), and the handles used to "instagram:handles"
import crypto from "node:crypto";
import { getState, setState, claimState, dropState } from "./app-state";
import { personKey } from "./names";
import { isBlobLink } from "./image-links";
import { TYPES, MAX_CAPTION, MAX_COLLABORATORS, MAX_TAGS, cleanHandle, validHandle, tagSpots } from "./ig-caption";

export const GRAPH = "https://graph.instagram.com";
export const VER = "v21.0";
const AUTHORIZE = "https://www.instagram.com/oauth/authorize";
const TOKEN = "https://api.instagram.com/oauth/access_token";
export const SCOPES = "instagram_business_basic,instagram_business_content_publish";
export const KEYS = { conn: "instagram:conn", oauth: "instagram:oauth", posts: "instagram:posts", handles: "instagram:handles", pending: "instagram:pending", lock: "instagram:publishing" };
const DAY = 24 * 60 * 60 * 1000;
const OAUTH_MINUTES = 15;
const iso = (t) => new Date(t).toISOString();
const env = (k) => String(process.env[k] ?? "").trim();
export const missingEnv = () => ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"].filter((k) => !env(k));
export const postsOn = () => env("INSTAGRAM_POSTS").toLowerCase() === "on";

// an error with a plain line the dashboard can show, and the HTTP status the route answers with
export class IgError extends Error {
  constructor(message, status = 502, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}
// a line with nothing secret left in it: the sign-in itself, the app secret, anything shaped like an Instagram token
export function scrub(s, ...secrets) {
  let t = String(s ?? "");
  for (const x of [env("INSTAGRAM_APP_SECRET"), ...secrets]) if (x && String(x).length > 6) t = t.split(String(x)).join("…");
  return t.replace(/\bIG[A-Za-z0-9_-]{20,}/g, "…").slice(0, 400);
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

// ---- one call to Instagram: JSON back, or an IgError with Instagram's own words (scrubbed by the caller's catch)
async function call(url, { method = "GET", token, form, json, timeout = 20000 } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (form) { headers["Content-Type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(form).toString(); }
  if (json) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  let r;
  try { r = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeout) }); }
  catch (err) { throw new IgError(err?.name === "TimeoutError" ? "Instagram didn't answer in time. Try again in a minute." : "Couldn't reach Instagram. Try again in a minute.", 502); }
  const text = await r.text().catch(() => "");
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch { j = null; }
  if (!r.ok || j?.error) {
    const e = j?.error || {};
    const words = e.error_user_msg || e.message || (typeof j?.error_message === "string" && j.error_message) || `Instagram answered ${r.status}.`;
    throw new IgError(`Instagram: ${words}`, r.status >= 500 ? 502 : 400, { igCode: e.code });
  }
  return j || {};
}

// ---- connecting (Founders): where Instagram sends them back is this site's own address, so a preview works too
// (its address must be on the Meta app's list of redirect URIs, like the live one)
export function redirectFor(host) {
  const h = /^[a-z0-9.-]+(:\d{1,5})?$/i.test(String(host ?? "")) ? String(host).toLowerCase() : "www.defiedmgmt.com";
  return `${/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h) ? "http" : "https"}://${h}/api/instagram/callback`;
}
export const authUrl = ({ redirect, state }) => `${AUTHORIZE}?${new URLSearchParams({ client_id: env("INSTAGRAM_APP_ID"), redirect_uri: redirect, response_type: "code", scope: SCOPES, state })}`;
// the address to send the Founder to; the one-time state (with who asked and the redirect used) waits 15 minutes
export async function startConnect({ host, by = "", byId = "" }) {
  if (missingEnv().length) throw new IgError(`Instagram isn't set up yet: ${missingEnv().join(" and ")} ${missingEnv().length > 1 ? "aren't" : "isn't"} in Vercel.`, 503);
  const state = crypto.randomBytes(24).toString("base64url");
  const redirect = redirectFor(host);
  await setState(KEYS.oauth, { state, redirect, by, byId, at: Date.now() });
  return authUrl({ redirect, state });
}
const sameText = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
// the callback: the code → a short sign-in → a 60-day one → who it is; saved locked. Returns "connected" | "expired" | "failed"
// (the outcome is kept in "instagram:oauth" too, so Site › Instagram can say what happened)
export async function finishConnect({ code, state, byId = "", now = Date.now() }) {
  const p = await getState(KEYS.oauth);
  const fresh = p?.state && !p.result && state && sameText(p.state, state) && now - Number(p.at) <= OAUTH_MINUTES * 60 * 1000 && (!p.byId || p.byId === byId);
  // a link used already keeps its outcome (a replay must not turn "connected" into "expired")
  if (!fresh || !code) { if (!p?.result) await setState(KEYS.oauth, { result: "expired", at: now }); return "expired"; }
  await setState(KEYS.oauth, { result: "working", at: now }); // one use only: the same link can't be replayed
  try {
    const got = await exchangeCode(String(code).replace(/#_$/, ""), p.redirect);
    await setState(KEYS.conn, { userId: got.userId, username: got.username, token: sealToken(got.token), expiresAt: iso(now + got.expiresIn * 1000), tokenAt: iso(now), connectedBy: p.by || "", at: iso(now), canPublish: got.canPublish });
    await setState(KEYS.oauth, { result: "connected", at: now });
    return "connected";
  } catch (err) {
    console.error("instagram connect failed:", scrub(err?.message));
    await setState(KEYS.oauth, { result: "failed", why: scrub(err?.message).slice(0, 200), at: now });
    return "failed";
  }
}
export async function exchangeCode(code, redirect) {
  let short = {}, long = {};
  try {
    const s = await call(TOKEN, { method: "POST", form: { client_id: env("INSTAGRAM_APP_ID"), client_secret: env("INSTAGRAM_APP_SECRET"), grant_type: "authorization_code", redirect_uri: redirect, code } });
    short = (Array.isArray(s.data) ? s.data[0] : s) || {}; // newer answers wrap it in data: [ … ]
    if (!short.access_token) throw new IgError("Instagram didn't give a sign-in. Try Connect again.");
    long = await call(`${GRAPH}/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: env("INSTAGRAM_APP_SECRET"), access_token: short.access_token })}`);
    if (!long.access_token) throw new IgError("Instagram didn't give a lasting sign-in. Try Connect again.");
    const me = await call(`${GRAPH}/${VER}/me?fields=user_id,username`, { token: long.access_token });
    const perms = [].concat(short.permissions || []).join(",");
    return {
      token: long.access_token, expiresIn: Number(long.expires_in) || 60 * 24 * 3600,
      userId: String(me.user_id || short.user_id || me.id || ""), username: String(me.username || ""),
      canPublish: !perms || perms.includes("instagram_business_content_publish"),
    };
  } catch (err) {
    // Instagram's words can echo what it was sent: neither token nor the code goes any further
    err.message = scrub(err?.message, short.access_token, long.access_token, code);
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

// the sign-in to post with, renewed first once it's more than a day old (Instagram only renews a token that is at least
// 24 hours old and not run out; each renewal is good for 60 days more). A failed renewal keeps the old one while it lasts.
export async function liveConn({ now = Date.now() } = {}) {
  const c = await getState(KEYS.conn);
  if (!c?.token) throw new IgError("Instagram isn't connected. A Founder presses Connect Instagram in Site › Instagram.", 409);
  let token = openToken(c.token);
  if (!token) throw new IgError("The saved Instagram sign-in can't be read (the site's secret changed). A Founder presses Connect Instagram again.", 409);
  const exp = Date.parse(c.expiresAt) || 0;
  if (exp && exp <= now) throw new IgError("The Instagram sign-in ran out. A Founder presses Connect Instagram again.", 409);
  if (now - (Date.parse(c.tokenAt || c.at) || 0) > DAY) {
    try {
      const r = await call(`${GRAPH}/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token })}`);
      if (r.access_token) {
        const was = await getState(KEYS.conn);
        // not if a Founder disconnected or reconnected meanwhile
        if (was?.token === c.token) await setState(KEYS.conn, { ...c, token: sealToken(r.access_token), expiresAt: iso(now + (Number(r.expires_in) || 60 * 24 * 3600) * 1000), tokenAt: iso(now) });
        token = r.access_token;
      }
    } catch (err) { console.error("instagram token renewal failed:", scrub(err?.message, token)); }
  }
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
// the route may run 60 s (pages/api/instagram.js): the waiting stops ~42 s after the post started (the sign-in's renewal
// counts too), leaving room for media_publish and the permalink
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
// job: { creationId?, children?: [ids], parent?, childParams? } → { mediaId, permalink }. Carries on from whatever it has.
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
  let permalink = null;
  try { permalink = (await call(`${GRAPH}/${VER}/${encodeURIComponent(pub.id)}?fields=permalink`, { token: conn.token, timeout: 8000 })).permalink || null; }
  catch { /* posted; only its link couldn't be read */ }
  return { mediaId: String(pub.id), permalink };
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
async function logPost({ type, caption, title, by, people, permalink, mediaId }) {
  try {
    const posts = (await getState(KEYS.posts)) || [];
    await setState(KEYS.posts, [{ at: new Date().toISOString(), by, type, title: title || "", caption, permalink, mediaId }, ...posts].slice(0, 50));
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
