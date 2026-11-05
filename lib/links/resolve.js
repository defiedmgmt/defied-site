// List B #7, the "paste a link" box, the server part (POST /api/resolve-link). One pasted link becomes a
// card to add: what it is, its name, photo or cover, its numbers, the artist's other profiles to confirm
// with one tap, and whether we already track it.
//   Spotify song      title, artist, cover, release date, ISRC          Spotify Web API (free)
//   Spotify artist    name, photo, catalog (releases, the latest)       Spotify Web API (free)
//                     followers, monthly listeners                      Apify eduair94 (paid, 0.1¢)
//   YouTube channel   name, photo, subscribers, views                   YouTube Data API (free)
//   YouTube video     title, channel, views (+ the channel to confirm)  YouTube Data API (free)
//   TikTok profile    name, photo, followers                            Apify clockworks (paid, 0.3¢)
//   TikTok sound      title, artist, cover, videos made with it         Apify khadinakbar (paid, 0.3¢)
//   Instagram profile name, photo, followers                            Apify's own actor (paid, 0.26¢)
// Two steps, so the box is never stuck waiting on a scraper: resolveLink({ paid: false }) answers at once
// with everything free (and any number we already have in data_snapshots); when the card still misses
// something only Apify has, it says paid.needed, and the box asks again with { paid: true }. Paid answers
// are cached 7 days (link_cache); a run still going after PAID_WAIT_MS is kept and picked up by the next
// ask, never started twice. Every paid lookup is inside the month's Apify budget (Numbers › Sources'
// total, data_runs) and the account's hard limit, has its own charge cap, and is logged in data_runs
// (source "paste_box") so Numbers counts it. Photos from TikTok and Instagram are signed links that
// expire: shown on the card (preview) but never filled into a form. Keys are never logged or returned.
import crypto from "node:crypto";
import { sql as dbSql, rowsOrNoneIfNoTable } from "../db";
import * as D from "../data/direct";
import { ADAPTERS, runCapUsd, estUsd, handleOf, youtubeRef, spotifyId } from "../data/sources";
import { loadSettings, monthSpend, chargedUsd } from "../data/engine";
import { parseLink, kindLabel, linksInText, profileUrl, PLATFORM_LABEL } from "./parse";
import { arFns } from "./ar-bridge";
import { personKey } from "../names";
import { metaContent } from "../og";

let sqlImpl = dbSql;
// the real-data check runs this with no database at all (null): no cache, no "already tracked"
export const useLinkSql = (fn) => { sqlImpl = fn === undefined ? dbSql : fn; };
const sql = (...a) => sqlImpl(...a);
const hasDb = () => !!sqlImpl;

const DAY = 86400000;
const FREE_TTL = DAY / 2, PAID_TTL = 7 * DAY;
const POLL_MS = 1500;
const waitMs = () => Number(process.env.PAID_WAIT_MS) || 25000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lc = (s) => String(s ?? "").trim().toLowerCase();
const num = (v) => { const n = typeof v === "string" ? Number(v.replace(/[, ]/g, "")) : Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null; };
const keep = (url) => (/^https:\/\/(i\.scdn\.co|yt3\.ggpht\.com|i\.ytimg\.com|yt3\.googleusercontent\.com)\//.test(String(url || "")) ? url : "");
const imageOf = (imgs) => (imgs || []).find((x) => x.width && x.width <= 320)?.url || imgs?.[0]?.url || "";
const bigImage = (imgs) => (imgs || []).find((x) => x.width && x.width >= 300 && x.width <= 640)?.url || imgs?.[0]?.url || "";
const nm = (label, value, extra = {}) => (value == null ? null : { label, value, ...extra });

// which Apify adapter a paid lookup uses (the same scrapers as the automated numbers)
export const PAID = {
  // r10: beatanalytics also returns the artist's own external links (their Instagram, ...), so one run covers both
  "spotify:artist": { adapter: "beatanalytics", what: "followers, monthly listeners and their other profiles" },
  "tiktok:profile": { adapter: "clockworks", what: "name, photo and followers" },
  "tiktok:sound": { adapter: "khadinakbar", what: "title, cover and video count" },
  "instagram:profile": { adapter: "apify-instagram", what: "name, photo and followers" },
};
const paidFor = (l) => PAID[`${l.platform}:${l.kind}`] || null;

// ---------------------------------------------------------------- cache
async function cacheGet(key) {
  if (!hasDb()) return null;
  const [r] = await rowsOrNoneIfNoTable(sql`SELECT key, data, cost_usd, run_id, status, fetched_at FROM link_cache WHERE key = ${key}`);
  if (!r) return null;
  return { ...r, data: typeof r.data === "string" ? JSON.parse(r.data) : r.data || {}, age: Date.now() - new Date(r.fetched_at).getTime() };
}
async function cachePut(key, l, data, { cost = 0, runId = "", status = "ok" } = {}) {
  if (!hasDb()) return;
  try {
    await sql`INSERT INTO link_cache (key, platform, kind, data, cost_usd, run_id, status, fetched_at)
      VALUES (${key}, ${l.platform}, ${l.kind}, ${JSON.stringify(data)}::jsonb, ${cost}, ${runId}, ${status}, now())
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, cost_usd = EXCLUDED.cost_usd, run_id = EXCLUDED.run_id, status = EXCLUDED.status, fetched_at = now()`;
  } catch (err) { if (err?.code !== "42P01") throw err; } // before the migration: no cache, still works
}

// ---------------------------------------------------------------- free lookups
async function ytGet(path) {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}&key=${encodeURIComponent(process.env.YOUTUBE_API_KEY)}`, { signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`YouTube: ${r.status}${j?.error?.message ? ` ${String(j.error.message).slice(0, 120)}` : ""}`);
  return j;
}
async function ogPage(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; DefiedSite/1.0)", Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`answered ${r.status}`);
  return r.text();
}

async function freeSpotifySong(l) {
  if (D.spotifyConfigured()) {
    const t = await D.spotifyGet(`/tracks/${l.id}`);
    const artists = (t.artists || []).map((a) => ({ id: a.id, name: a.name }));
    return {
      name: t.name || "", artist: artists.map((a) => a.name).join(", "), image: keep(bigImage(t.album?.images)), releaseDate: t.album?.release_date || "",
      isrc: String(t.external_ids?.isrc || "").toUpperCase(), album: t.album?.album_type === "album" ? t.album?.name || "" : "",
      artists, links: { spotify: l.url }, source: "Spotify",
    };
  }
  // no Spotify keys: the song page's tags, as the old Auto-fill did ("Artist · Album · Song · 2017")
  const html = await ogPage(l.url);
  const desc = metaContent(html, "og:description");
  const year = /\b(19|20)\d{2}\b/.exec(desc)?.[0];
  return { name: metaContent(html, "og:title"), artist: desc.split("·")[0].trim(), image: keep(metaContent(html, "og:image")), releaseDate: year ? `${year}-01-01` : "", isrc: "", artists: [], links: { spotify: l.url }, source: "Spotify page" };
}
async function freeSpotifyArtist(l) {
  if (D.spotifyConfigured()) {
    const a = await D.spotifyGet(`/artists/${l.id}`);
    let catalog = null;
    try {
      const rel = await D.spotifyReleases(l.id, { max: 20 });
      const own = rel.filter((r) => !r.artists?.length || r.artists.includes(l.id));
      if (rel.length) catalog = { releases: own.length, more: rel.length >= 20, latest: own[0] ? { name: own[0].name, releaseDate: own[0].releaseDate } : null };
    } catch { catalog = null; }
    return { name: a.name || "", image: keep(bigImage(a.images)), photo: keep(bigImage(a.images)), catalog, links: { spotify: l.url }, source: "Spotify" };
  }
  const html = await ogPage(l.url);
  const img = keep(metaContent(html, "og:image"));
  return { name: metaContent(html, "og:title").trim(), image: img, photo: img, catalog: null, links: { spotify: l.url }, source: "Spotify page" };
}
async function freeYoutubeChannel(l) {
  if (!D.youtubeConfigured()) throw new Error("YouTube isn't connected (YOUTUBE_API_KEY).");
  const by = l.id.startsWith("UC") ? `id=${l.id}` : `forHandle=${encodeURIComponent(l.id.slice(1))}`;
  const j = await ytGet(`channels?part=snippet,statistics&${by}`);
  const it = j?.items?.[0];
  if (!it) throw new Error("YouTube has no channel at that link.");
  const st = it.statistics || {};
  const img = keep(it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url);
  return {
    name: it.snippet?.title?.trim() || "", image: img, photo: img, channelId: it.id,
    numbers: [!st.hiddenSubscriberCount && nm("YouTube subscribers", num(st.subscriberCount)), nm("YouTube views, all videos", num(st.viewCount))].filter(Boolean),
    bio: it.snippet?.description || "", links: { youtube: `https://www.youtube.com/channel/${it.id}` }, source: "YouTube",
  };
}
async function freeYoutubeVideo(l) {
  if (!D.youtubeConfigured()) throw new Error("YouTube isn't connected (YOUTUBE_API_KEY).");
  const j = await ytGet(`videos?part=snippet,statistics&id=${l.id}`);
  const it = j?.items?.[0];
  if (!it) throw new Error("YouTube has no video at that link.");
  const sn = it.snippet || {};
  return {
    name: sn.title || "", artist: sn.channelTitle || "", image: keep(sn.thumbnails?.medium?.url || sn.thumbnails?.default?.url), releaseDate: String(sn.publishedAt || "").slice(0, 10),
    channelId: sn.channelId || "", numbers: [nm("YouTube views", num(it.statistics?.viewCount))].filter(Boolean), links: {}, source: "YouTube",
  };
}
// TikTok and Instagram: nothing free but the handle (and any number we already keep)
const freeHandle = (l) => ({ name: l.kind === "sound" ? "" : `@${l.id}`, handleOnly: true, links: l.kind === "sound" ? {} : { [l.platform]: l.url }, source: PLATFORM_LABEL[l.platform] });

async function freeLookup(l) {
  if (l.platform === "spotify" && l.kind === "song") return freeSpotifySong(l);
  if (l.platform === "spotify" && l.kind === "artist") return freeSpotifyArtist(l);
  if (l.platform === "youtube" && l.kind === "channel") return freeYoutubeChannel(l);
  if (l.platform === "youtube" && l.kind === "video") return freeYoutubeVideo(l);
  return freeHandle(l);
}

// ---------------------------------------------------------------- paid lookups (Apify)
const APIFY = "https://api.apify.com/v2";
const apifyHeaders = () => ({ Authorization: `Bearer ${process.env.APIFY_TOKEN}`, "Content-Type": "application/json" });
// started without the numbers' webhook: this lookup collects its own run
async function startRun(actor, input, capUsd) {
  const q = new URLSearchParams({ maxTotalChargeUsd: String(capUsd), timeout: "120", memory: "1024" });
  const r = await fetch(`${APIFY}/acts/${actor.replace("/", "~")}/runs?${q}`, { method: "POST", headers: apifyHeaders(), body: JSON.stringify(input), signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.data?.id) throw new Error(`Apify didn't start the lookup (${r.status})`);
  return j.data;
}

// one actor's items -> the card's fields
export function paidCard(l, items) {
  const list = Array.isArray(items) ? items : [];
  if (l.platform === "spotify" && list.some((x) => x?._type === "artist")) {
    // beatanalytics/spotify-play-count-scraper (S/r8/real/out/run-sp-artist-beat.json)
    const i = list.find((x) => x?._type === "artist" && (x.id === l.id || spotifyId(x._url, "artist") === l.id)) || list.find((x) => x?._type === "artist");
    const ext = (i.externalLinks || []).map((x) => String(x?.url || "")).filter((u) => /^https?:\/\//.test(u));
    return { numbers: [nm("Spotify monthly listeners", num(i.monthlyListeners)), nm("Spotify followers", num(i.followers))].filter(Boolean), extLinks: ext,
      latestRelease: i.latest ? { name: i.latest.name || "", releaseDate: i.latest.releaseDate || "" } : null };
  }
  if (l.platform === "spotify") {
    const i = list.find((x) => x && x.ok !== false && (x.category === "artist_overview" || x.type === "artist"));
    if (!i) return null;
    return { numbers: [nm("Spotify monthly listeners", num(i.monthlyListeners)), nm("Spotify followers", num(i.followers))].filter(Boolean),
      catalogCounts: i.albumsCount != null || i.singlesCount != null ? { albums: num(i.albumsCount), singles: num(i.singlesCount) } : null,
      latestRelease: i.latestRelease ? { name: i.latestRelease.name || "", releaseDate: i.latestRelease.releaseDate || "" } : null };
  }
  if (l.platform === "tiktok" && l.kind === "profile") {
    const a = list.map((x) => x?.authorMeta).find((m) => m && lc(m.name) === lc(l.id)) || list[0]?.authorMeta;
    if (!a) return null;
    const fans = num(a.fans);
    return { name: a.nickName || a.name || "", preview: a.avatar || "", bio: [a.signature, a.bioLink?.link].filter(Boolean).join("\n"),
      numbers: [nm("TikTok followers", fans, { approx: fans >= 10000 })].filter(Boolean) };
  }
  if (l.platform === "tiktok" && l.kind === "sound") {
    const s = list.find((x) => x && (x.recordType || "sound") === "sound" && String(x.clipId || "") === l.id) || list.find((x) => x && (x.recordType || "sound") === "sound");
    if (!s) return null;
    return { name: s.title || "", artist: s.author || "", preview: s.coverUrl || "", numbers: [nm("TikTok videos with this sound", num(s.userCount))].filter(Boolean), soundUrl: s.soundUrl || "" };
  }
  if (l.platform === "instagram") {
    const p = list.find((x) => x && lc(x.username) === lc(l.id)) || list[0];
    if (!p || (!p.username && p.followersCount == null)) return null;
    return { name: String(p.fullName || "").trim(), preview: p.profilePicUrlHD || p.profilePicUrl || "", bio: [p.biography, p.externalUrl, ...(p.externalUrls || []).map((x) => x?.url)].filter(Boolean).join("\n"),
      numbers: [nm("Instagram followers", num(p.followersCount))].filter(Boolean) };
  }
  return null;
}

// What a paid lookup would cost, and whether this month's budget and Apify's limit allow it
export const needsApify = (what) => `${String(what || "These numbers").replace(/^./, (c) => c.toUpperCase())} need Apify, which isn't connected yet.`;
async function paidGuard(adapter, now, what = "") {
  if (!D.apifyConfigured()) return { off: needsApify(what) };
  const cap = runCapUsd(adapter, 1), est = estUsd(adapter, 1);
  let near = false;
  if (hasDb()) {
    const [settings, spent] = await Promise.all([loadSettings(), monthSpend(now)]);
    if (spent.total + est > settings.totalCapUsd) return { off: `This month's Apify budget is used up ($${spent.total.toFixed(2)} of $${settings.totalCapUsd}). Type their details in.` };
    near = spent.total >= settings.totalCapUsd * 0.8;
  }
  let acct;
  try { acct = await D.apifyLimits(); } catch { return { off: "Couldn't check Apify's monthly limit just now, so nothing was looked up. Try again in a minute." }; }
  if (acct.limitUsd - acct.usageUsd < cap) return { off: `Apify's monthly limit is almost reached ($${acct.usageUsd.toFixed(2)} of $${acct.limitUsd}).` };
  return { cap, est, near: near || acct.usageUsd >= acct.limitUsd * 0.8 };
}

async function logRun({ adapter, actor, run, usd, est, status, error = "", l }) {
  if (!hasDb()) return;
  const id = `p${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
  try {
    await sql`INSERT INTO data_runs (id, source, adapter, actor, apify_run_id, dataset_id, status, targets, items, snapshots, est_usd, usd, error, started_at, finished_at)
      VALUES (${id}, 'paste_box', ${adapter}, ${actor}, ${run?.id || null}, ${run?.defaultDatasetId || null}, ${status}, ${JSON.stringify([{ ref: l.key }])}::jsonb, ${run?.itemCount ?? null}, 0, ${est}, ${usd}, ${error}, ${run?.startedAt || new Date().toISOString()}, now())
      ON CONFLICT DO NOTHING`;
  } catch (err) { if (err?.code !== "42P01") throw err; }
}

// -> { data } | { pending } | { error } | { off }
async function paidLookup(l, { now = new Date() } = {}) {
  const p = paidFor(l);
  if (!p) return { data: null };
  const key = `${l.key}:paid`;
  const ad = ADAPTERS[p.adapter];
  const c = await cacheGet(key);
  if (c?.status === "ok" && c.age < PAID_TTL) return { data: c.data, cached: true, cost: 0 };
  let runId = c?.status === "running" && c.age < DAY ? c.run_id : "";
  let guard = null;
  if (!runId) {
    guard = await paidGuard(p.adapter, now, p.what);
    if (guard.off) return { off: guard.off };
    const target = { ref: l.id, url: l.kind === "sound" ? l.url : "", kind: l.kind === "sound" ? "sound" : "artist" };
    let run;
    try { run = await startRun(ad.actor, ad.input([target]), guard.cap); } catch (err) { return { error: err.message }; }
    runId = run.id;
    await cachePut(key, l, {}, { runId, status: "running" });
  }
  const until = Date.now() + waitMs();
  let run = null;
  for (;;) {
    try { run = await D.apifyRun(runId); } catch (err) { return { error: err.message }; }
    if (D.TERMINAL.has(run.status) || Date.now() >= until) break;
    await sleep(POLL_MS);
  }
  if (!D.TERMINAL.has(run.status)) return { pending: true };
  const est = estUsd(p.adapter, 1), usd = chargedUsd(p.adapter, run, est);
  if (run.status !== "SUCCEEDED") {
    await cachePut(key, l, {}, { status: "failed", cost: usd });
    await logRun({ adapter: p.adapter, actor: ad.actor, run, usd, est, status: "failed", error: `Apify run ${run.status}`, l });
    return { error: `${PLATFORM_LABEL[l.platform]} didn't answer this time (${run.status.toLowerCase()}).` };
  }
  let items = [];
  try { items = await D.apifyItems(run.defaultDatasetId, 50); } catch (err) { return { error: err.message }; }
  const data = paidCard(l, items) || { notFound: true };
  await cachePut(key, l, data, { cost: usd });
  await logRun({ adapter: p.adapter, actor: ad.actor, run, usd, est, status: "done", l });
  return { data, cost: usd, near: !!guard?.near };
}

// ---------------------------------------------------------------- what we already keep
// numbers already in data_snapshots for this link (free, and the box shows them at once)
async function knownNumbers(l) {
  if (!hasDb()) return [];
  let ids = [];
  if (l.platform === "spotify" && l.kind === "song") ids = [`t:${l.id}`];
  else if (l.platform === "tiktok" && l.kind === "sound") ids = [`s:${l.id}`];
  else {
    const plat = l.platform;
    const rows = await rowsOrNoneIfNoTable(sql`SELECT entity_id, url FROM data_links WHERE platform = ${plat}`);
    ids = rows.filter((r) => sameProfile(l, r.url)).map((r) => r.entity_id);
  }
  if (!ids.length) return [];
  const snaps = await rowsOrNoneIfNoTable(sql`SELECT DISTINCT ON (platform, metric) platform, metric, value, taken_at, approx FROM data_snapshots WHERE entity_id = ANY(${ids}) ORDER BY platform, metric, taken_at DESC`);
  const LABEL = { "spotify:streams": "Spotify streams, global", "spotify:monthly_listeners": "Spotify monthly listeners", "spotify:followers": "Spotify followers", "instagram:followers": "Instagram followers", "tiktok:followers": "TikTok followers", "tiktok:videos": "TikTok videos with this sound", "youtube:subscribers": "YouTube subscribers", "youtube:views": "YouTube views, all videos" };
  return snaps.filter((s) => s.platform === l.platform && LABEL[`${s.platform}:${s.metric}`]).map((s) => ({ label: LABEL[`${s.platform}:${s.metric}`], value: Number(s.value), approx: !!s.approx, on: new Date(s.taken_at).toISOString().slice(0, 10), kept: true }));
}

// is this stored link (a roster field, an A&R handle) the same profile as the pasted one?
export function sameProfile(l, stored) {
  const v = String(stored || "").trim();
  if (!v) return false;
  if (l.platform === "spotify") return spotifyId(v, l.kind === "song" ? "track" : "artist") === l.id;
  if (l.platform === "instagram") return lc(handleOf(v, "instagram.com")) === lc(l.id);
  if (l.platform === "tiktok" && l.kind === "profile") return lc(handleOf(v, "tiktok.com")) === lc(l.id);
  if (l.platform === "tiktok" && l.kind === "sound") return v.includes(l.id);
  if (l.platform === "youtube" && l.kind === "channel") { const r = youtubeRef(v); return !!r && lc(r) === lc(l.id); }
  return false;
}

export function soundSlugTitle(url, clip) {
  const m = /tiktok\.com\/music\/([^/?#]+)/.exec(String(url || ""));
  let slug = "";
  try { slug = m ? decodeURIComponent(m[1]) : ""; } catch { slug = m?.[1] || ""; }
  slug = slug.replace(new RegExp(`-?${clip}$`), "").replace(/-/g, " ").trim();
  return slug && !/^x$/i.test(slug) ? slug : `TikTok sound ${String(clip).slice(0, 6)}…`;
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nyShort = (t) => { const d = new Date(t); if (Number.isNaN(d.getTime())) return ""; const [m, dd] = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric" }).format(d).split("/").map(Number); return `${MON[m - 1]} ${dd}`; };
// r10: one line per person, the way the lists say it (A9: one person once):
//   mine     "Already on your list (added Nov 4)"   -> the box offers Open it, adds nothing
//   other    "Already on Hank's list (added Nov 3)" -> the box offers Add my name too (the same row)
//   roster   "On the roster (Stack!e)"              -> Add to my list (never expires)
//   removed  "Was on Devin's list until Oct 30. Adding it brings its numbers back."
//   info     "Already in Publishing (…'s songs)" (a note; it doesn't stop an add)
export function alreadyLines(hits, { me = null, removed = null } = {}) {
  const out = [];
  const people = new Map();
  for (const h of hits.filter((x) => x.where === "tracker")) {
    const k = h.ownerId || h.who;
    const p = people.get(k) || { ...h, at: h.addedAt };
    if (h.addedAt && (!p.at || h.addedAt < p.at)) p.at = h.addedAt;
    people.set(k, p);
  }
  for (const p of people.values()) {
    const mine = me && p.ownerId === me;
    const when = p.at ? ` (added ${nyShort(p.at)})` : "";
    out.push({ where: "tracker", state: mine ? "mine" : "other", who: p.who, ownerId: p.ownerId || null, itemId: p.itemId, key: p.key || null, kind: p.kind, addedAt: p.at || null,
      text: mine ? `Already on your list${when}` : p.who ? `Already on ${p.who}'s list${when}` : `Already on the team list${when}` });
  }
  for (const h of hits.filter((x) => x.where === "roster")) out.push({ ...h, state: "roster", text: `On the roster (${h.who})` });
  // a Watchlist row nobody has on a list any more (an outreach-only artist): one note, no second row is made
  if (!people.size) for (const h of hits.filter((x) => x.where === "watchlist")) out.push({ ...h, state: "other", text: "On the Watchlist (on nobody's list right now)" });
  for (const h of hits.filter((x) => x.where === "publishing" || x.where === "numbers")) out.push({ ...h, state: "info" });
  if (!out.some((x) => x.state === "mine" || x.state === "other" || x.state === "roster") && removed) out.push({ where: "removed", state: "removed", who: removed.who, text: `Was on ${removed.who}'s list until ${nyShort(removed.until)}. Adding it brings its numbers back.` });
  return out;
}
// "Already on Hank's list", "On the roster (Stack!e)": every place that keeps this link
export async function alreadyTracked(l, card = {}, { me = null } = {}) {
  const out = [];
  const seen = new Set();
  const add = (x) => { const k = `${x.where}|${x.who}|${x.itemId || ""}`; if (!seen.has(k)) { seen.add(k); out.push(x); } };
  const { findTracked } = arFns();
  if (findTracked) {
    try {
      const hits = await findTracked({
        spotifyArtistId: l.platform === "spotify" && l.kind === "artist" ? l.id : undefined,
        spotifyTrackId: l.platform === "spotify" && l.kind === "song" ? l.id : undefined,
        tiktokSoundId: l.platform === "tiktok" && l.kind === "sound" ? l.id : undefined,
        url: l.url,
      });
      // a roster artist: said once below, from the roster itself ("Already on the roster (name)")
      for (const h of (hits || []).filter((x) => !x.roster)) add({ where: "tracker", who: h.who || "", itemId: h.itemId, kind: h.kind, ownerId: h.trackerOwnerId || null, addedAt: h.addedAt || null, key: h.subject || null, text: "" });
    } catch (err) { console.error("findTracked failed:", err?.message); }
  }
  if (!hasDb()) return out;
  const field = { spotify: "spotify", instagram: "instagram", tiktok: "tiktok", youtube: "youtube" }[l.platform];
  if (l.kind !== "song" && l.kind !== "sound" && l.kind !== "video" && field) {
    const clients = await sql`SELECT id, name, spotify, instagram, tiktok, youtube FROM clients`;
    // a YouTube @handle and the channel id it resolved to are the same channel
    const alt = l.platform === "youtube" && card.channelId && card.channelId !== l.id ? { ...l, id: card.channelId } : null;
    for (const c of clients) if (sameProfile(l, c[field]) || (alt && sameProfile(alt, c[field]))) add({ where: "roster", who: c.name, itemId: c.id, text: `Already on the roster (${c.name})` });
  }
  if (l.platform === "spotify" && l.kind === "song") {
    const rows = await sql`SELECT p.id, p.song, c.name FROM placements p JOIN clients c ON c.id = p.client_id WHERE p.link LIKE ${`%${l.id}%`}`;
    for (const r of rows) add({ where: "publishing", who: r.name, itemId: r.id, text: `Already in Publishing (${r.name}'s songs)` });
  }
  if (l.platform === "tiktok" && l.kind === "sound") {
    const rows = await rowsOrNoneIfNoTable(sql`SELECT id FROM data_entities WHERE id = ${`s:${l.id}`} AND active`);
    if (rows.length && !out.some((x) => x.where === "tracker")) add({ where: "numbers", who: "", itemId: rows[0].id, text: "Already tracked as a sound (on nobody's list yet)" });
  }
  if (l.kind === "artist" || l.kind === "song" || l.kind === "profile") {
    const rows = await rowsOrNoneIfNoTable(sql`SELECT * FROM ar_tracked WHERE removed_at IS NULL`);
    for (const r of rows) {
      const hit = l.platform === "spotify" ? sameProfile(l, r.spotify) : (l.platform === "instagram" || l.platform === "tiktok") && (lc(String(r.handle || "").replace(/^@/, "")) === lc(l.id) || lc(r[l.platform] || "") === lc(l.id));
      if (hit) add({ where: "watchlist", who: r.created_by || "", itemId: r.id, key: `w:${r.id}`, text: "" });
    }
  }
  let removed = null;
  const { findRemoved } = arFns();
  if (findRemoved && !out.some((x) => x.where === "tracker" || x.where === "roster")) {
    removed = await findRemoved({ spotifyArtistId: l.platform === "spotify" && l.kind === "artist" ? l.id : "", spotifyTrackId: l.platform === "spotify" && l.kind === "song" ? l.id : "", tiktokSoundId: l.platform === "tiktok" && l.kind === "sound" ? l.id : "" }).catch(() => null);
  }
  return alreadyLines(out, { me, removed });
}

// ---------------------------------------------------------------- the artist's other profiles
// Real ones only: links in their own bio or description, the song's artists on Spotify, a channel's
// owner, and (free) a Spotify artist with exactly their name. Each is a one-tap "Yes, that's them".
async function suggestionsFor(l, card) {
  const out = [];
  const have = new Set([l.key, ...Object.entries(card.links || {}).map(([, u]) => parseLink(u)?.key).filter(Boolean)]);
  const add = (s) => { const p = parseLink(s.url); if (!p || have.has(p.key) || !["artist", "profile", "channel"].includes(p.kind)) return; have.add(p.key); out.push({ platform: p.platform, kind: p.kind, url: p.url, name: s.name || "", image: keep(s.image || ""), why: s.why }); };
  const from = PLATFORM_LABEL[l.platform];
  for (const x of linksInText(card.bio || "")) add({ url: x.url, why: x.why === "bio" ? `Named in their ${from} bio` : `Linked from their ${from} bio` });
  if (l.platform === "spotify" && l.kind === "song") for (const a of (card.artists || []).slice(0, 3)) add({ url: `https://open.spotify.com/artist/${a.id}`, name: a.name, why: "The song's artist on Spotify" });
  if (l.platform === "youtube" && l.kind === "video" && card.channelId) add({ url: `https://www.youtube.com/channel/${card.channelId}`, name: card.artist, why: "The video's channel" });
  for (const u of card.extLinks || []) add({ url: u, why: "Listed on their Spotify profile" });
  const name = l.kind === "song" || l.kind === "sound" || l.kind === "video" ? "" : card.handleOnly ? "" : card.name;
  if (name && l.platform !== "spotify" && D.spotifyConfigured() && !out.some((s) => s.platform === "spotify")) {
    try {
      const found = (await D.spotifyArtistSearch(name)).filter((a) => personKey(a.name) === personKey(name));
      if (found.length === 1) add({ url: `https://open.spotify.com/artist/${found[0].id}`, name: found[0].name, image: found[0].image, why: "Same name on Spotify" });
    } catch { /* a suggestion is optional */ }
  }
  // one YouTube channel with exactly their name (search.list, 100 of the free 10,000 daily units)
  const ytName = l.kind === "song" || l.kind === "sound" || l.kind === "video" || card.handleOnly ? "" : String(card.name || "").replace(/^@/, "");
  if (ytName && l.platform !== "youtube" && D.youtubeConfigured() && !out.some((s) => s.platform === "youtube")) {
    try {
      const j = await ytGet(`search?part=snippet&type=channel&maxResults=5&q=${encodeURIComponent(ytName)}`);
      const same = (j?.items || []).filter((x) => personKey(x?.snippet?.channelTitle || x?.snippet?.title) === personKey(ytName));
      if (same.length === 1 && same[0].id?.channelId) add({ url: `https://www.youtube.com/channel/${same[0].id.channelId}`, name: same[0].snippet.channelTitle || same[0].snippet.title, why: "Same name on YouTube" });
    } catch { /* a suggestion is optional */ }
  }
  // the roster or watchlist already knows this person: their other links
  if (hasDb() && l.kind !== "song" && l.kind !== "sound" && l.kind !== "video") {
    const field = { spotify: "spotify", instagram: "instagram", tiktok: "tiktok", youtube: "youtube" }[l.platform];
    const clients = await sql`SELECT name, spotify, instagram, tiktok, youtube FROM clients`;
    const alt = l.platform === "youtube" && card.channelId && card.channelId !== l.id ? { ...l, id: card.channelId } : null;
    for (const c of clients.filter((x) => sameProfile(l, x[field]) || (alt && sameProfile(alt, x[field])))) for (const p of ["spotify", "instagram", "tiktok", "youtube"]) if (p !== l.platform && c[p]) add({ url: /^https?:/.test(c[p]) ? c[p] : profileUrl(p, c[p]), name: c.name, why: "On the roster with this link" });
  }
  return out.slice(0, 5);
}

// ---------------------------------------------------------------- the whole lookup
// -> { ok, link, card, links, suggestions, already, paid: { needed, what, pending, error, off, cost } }
//    or { ok: false, error }
export async function resolveLink(text, { paid = false, now = new Date(), me = null } = {}) {
  let l = parseLink(text);
  if (!l) return { ok: false, error: "Paste a Spotify, TikTok, Instagram or YouTube link." };
  if (l.short) {
    // a short link: where it goes (no keys, a plain redirect)
    try {
      const r = await fetch(l.url, { method: "GET", redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; DefiedSite/1.0)" }, signal: AbortSignal.timeout(6000) });
      l = parseLink(r.url);
    } catch { l = null; }
    if (!l || l.short) return { ok: false, error: "Couldn't open that short link. Paste the full link from the app's Share › Copy link." };
  }
  if (l.kind === "album") return { ok: false, error: "That's an album. Paste one of its songs, or the artist's Spotify page." };
  const link = { platform: l.platform, kind: l.kind, label: kindLabel(l), url: l.url, key: l.key, id: l.id };
  const missed = [];
  // 1. free: cached half a day
  let card = null;
  const c = await cacheGet(l.key);
  if (c?.status === "ok" && c.age < FREE_TTL) card = c.data;
  else {
    try { card = await freeLookup(l); await cachePut(l.key, l, card); }
    catch (err) { missed.push(PLATFORM_LABEL[l.platform]); card = { name: "", links: l.kind === "song" || l.kind === "sound" || l.kind === "video" ? {} : { [l.platform]: l.url }, error: err.message }; }
  }
  card = { ...card, numbers: [...(card.numbers || [])] };
  // 2. paid, when asked and useful
  const need = paidFor(l);
  const kept = await knownNumbers(l);
  const paidOut = { needed: false, what: need?.what || "", adapter: need?.adapter || "" };
  if (need) {
    const pc = await cacheGet(`${l.key}:paid`);
    const fresh = pc?.status === "ok" && pc.age < PAID_TTL ? pc.data : null;
    let got = fresh ? { data: fresh, cached: true, cost: 0 } : null;
    if (!got && paid) got = await paidLookup(l, { now });
    if (got?.data && !got.data.notFound) {
      const d = got.data;
      card.name = card.handleOnly ? d.name || card.name : card.name || d.name;
      if (d.artist && !card.artist) card.artist = d.artist;
      if (d.preview) card.preview = d.preview;
      if (d.bio) card.bio = [card.bio, d.bio].filter(Boolean).join("\n");
      if (d.numbers) card.numbers.push(...d.numbers.filter((x) => !card.numbers.some((y) => y.label === x.label)));
      if (d.catalogCounts && !card.catalog) card.catalog = { releases: (d.catalogCounts.albums || 0) + (d.catalogCounts.singles || 0), latest: d.latestRelease };
      if (d.soundUrl) card.soundUrl = d.soundUrl;
      if (d.extLinks?.length) card.extLinks = d.extLinks;
      card.handleOnly = false;
      paidOut.done = true;
      paidOut.cached = !!got.cached;
      const usd = Number(got.cost) || 0;
      if (usd > 0) paidOut.cost = { usd, line: usd >= 0.01 || got.near ? `This lookup used about ${usd < 0.01 ? "under 1¢" : `${(usd * 100).toFixed(1)}¢`} of Apify credit${got.near ? " (this month's Apify budget is nearly used)" : ""}.` : "" };
    } else if (got?.data?.notFound) { paidOut.done = true; paidOut.notFound = true; missed.push(PLATFORM_LABEL[l.platform]); }
    else if (got?.pending) { paidOut.needed = true; paidOut.pending = true; }
    else if (got?.off) paidOut.off = got.off;
    else if (got?.error) { paidOut.error = got.error; missed.push(PLATFORM_LABEL[l.platform]); }
    else paidOut.needed = D.apifyConfigured(); // not asked yet: the box asks with { paid: true }
    if (!paid && !got && !D.apifyConfigured()) paidOut.off = needsApify(need.what);
  }
  for (const k of kept) if (!card.numbers.some((y) => y.label === k.label)) card.numbers.push(k);
  const [already, suggestions] = await Promise.all([alreadyTracked(l, card, { me }), suggestionsFor(l, card).catch(() => [])]);
  // a TikTok sound with no title yet: the link's own slug, else "TikTok sound 7301…" (never made up)
  if (l.platform === "tiktok" && l.kind === "sound" && !card.name) { card.name = soundSlugTitle(l.url, l.id); card.nameFrom = "link"; }
  const { bio, artists, handleOnly, error, extLinks, ...shown } = card;
  return { ok: true, link, card: { ...shown, artists: (artists || []).map((a) => a.name) }, links: card.links || {}, suggestions, already, paid: paidOut, missed: [...new Set(missed)], error: error || undefined };
}
