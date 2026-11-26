// The share card's numbers (2026-11-13, the owner: "a share button that captures only their gross streams"). Server-only.
//   shareStats(clientId)  { name, photo, grossStreams, songs: [{ title, streams, cover, track }] (the top 5), asOf } or
//                         null (no such client): exactly the Gross Streams and per-song streams the client's portal
//                         shows, worked out by the same function (lib/portal-streams.js portalStreams). No net streams,
//                         splits or money. cover is the song's stored cover link (placements.cover) and track its
//                         Spotify track id: where the card's cover art comes from. asOf is the day the card is made, in
//                         New York (2026-11-26, the owner: "make it as of the export date"; lib/share-card-layout.js
//                         cardDay), not the day the numbers are from
//   shareTarget(...)      whose card this request may have (a client: their own; staff: Clients access, and an account
//                         limited to its own artists only theirs)
//   loadPhoto(ref)        the client's photo as a data: URI the card can draw, or null (never more than ~1.2 s)
//   loadCovers(songs)     each top song's cover art the same way (loadPhoto's one fetcher, ~1.5 s each, all at once), or
//                         null for a song with none: the card then draws its D tile, never another picture
//   cardKey / drawShareCard / makeShareCard (2026-11-26, the owner: "make it load way quicker"): a warm server keeps the
//                         cards it drew (per client, size, day and numbers) and the pictures it fetched, so the Post after
//                         the Story, or the same card opened again, isn't fetched and drawn again; see below
// The picture itself is lib/share-card-render.js; GET /api/share-card puts the two together.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { sql } from "./db";
import { mayUseClient } from "./access";
import { songGrowth } from "./data/growth";
import { loadSummary } from "./data/summary";
import { loadSameSongIds, withSameSongIds } from "./data/engine";
import { portalStreams, spotSongsOf, topSongs } from "./portal-streams";
import { sniffImage, MAX_IMAGE_BYTES } from "./image-links";
import { spotifyConfigured, spotifyTrack } from "./data/direct";
import { cardText, cardDay, loadAssets, renderCardPng, shrinkPicture, LAYOUT } from "./share-card-render";

// Pure. What the portal has when it shows Gross Streams: the client, their songs ({ id, song, link, streams }), the
// Spotify growth per song (GET /api/growth) and the automated numbers' songs for the artist (GET /api/my-numbers or
// /api/data: [{ id, ids?, under1k, streams: { latest, day } }]). today: the day the card is made ("YYYY-MM-DD"; today in
// New York by default), which is the card's asOf
export function shareStatsFrom({ client, placements, growth = null, artistSongs = [], today = cardDay() }) {
  if (!client) return null;
  const r = portalStreams(placements || [], { growth, spotSongs: spotSongsOf(artistSongs) });
  return { name: String(client.name || ""), photo: client.photo || null, grossStreams: Math.round(r.gross), songs: topSongs(r.songs, 5), asOf: today };
}

// The same reads the portal's requests make (GET /api/dashboard-data, /api/growth, /api/my-numbers), for one client.
// (2026-11-26) No longer the day the numbers are from (streamsOn, the last sync): the card says the day it's made
export async function loadShareInputs(clientId) {
  const [clients, rows, growth, summary, same] = await Promise.all([
    sql`SELECT id, name, photo FROM clients WHERE id = ${clientId}`,
    sql`SELECT id, song, link, cover, streams FROM placements WHERE client_id = ${clientId}`,
    songGrowth({ clientIds: [clientId] }),
    loadSummary({ clientIds: [clientId] }),
    loadSameSongIds(),
  ]);
  const artist = (summary.artists || []).find((a) => a.clientId === clientId);
  return {
    client: clients[0] || null,
    placements: rows.map((p) => ({ id: p.id, song: p.song, link: p.link, cover: p.cover, streams: Number(p.streams) })),
    growth,
    artistSongs: withSameSongIds(artist?.songs || [], same),
  };
}

// now: the moment the card is made (the clock by default; a test gives its own)
export async function shareStats(clientId, { load = loadShareInputs, now = Date.now() } = {}) {
  const inputs = await load(clientId);
  return inputs ? shareStatsFrom({ ...inputs, today: cardDay(now) }) : null;
}

// Whose card: { clientId } or { status, error } (a short line the dialog shows). req.access is requireAccess's.
//   a client session  its own client only (asking for another is refused, not quietly swapped)
//   staff             Clients access, a client named, and for an account limited to its own artists one of theirs
export function shareTarget(req, user, requested) {
  const asked = String((Array.isArray(requested) ? requested[0] : requested) ?? "").trim();
  if (user?.role !== "staff") {
    if (!user?.clientId) return { status: 403, error: "This sign-in isn't linked to an artist." };
    if (asked && asked !== user.clientId) return { status: 403, error: "You can only share your own stats." };
    return { clientId: user.clientId };
  }
  if (!(req?.access?.sections || []).includes("publishing")) return { status: 403, error: "Your account can't use Roster." };
  if (!asked) return { status: 400, error: "Say which artist's card to make." };
  if (!mayUseClient(req, asked)) return { status: 403, error: "That isn't one of your artists." };
  return { clientId: asked };
}

// ---- the photo and the covers ------------------------------------------------------------------------------------------
// Only from where the site's own photos and covers live (next.config.js images.remotePatterns: Spotify's i.scdn.co,
// the public site, the Blob store), so a link can't make the server fetch anything else. A relative /assets/... photo is
// read from public/ (or the live site, where public/ isn't in the function).
const PHOTO_HOSTS = [/^i\.scdn\.co$/i, /^www\.defiedmgmt\.com$/i, /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i];
const SITE = "https://www.defiedmgmt.com";
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
// a cover is never bigger than the dashboard lets one be uploaded (a Spotify one is ~100 KB)
const MAX_COVER_BYTES = MAX_IMAGE_BYTES;
// Satori draws PNG and JPEG (a WebP or GIF photo means no photo)
const asDataUri = (bytes, max = MAX_PHOTO_BYTES) => {
  const kind = bytes?.length && bytes.length <= max ? sniffImage(bytes) : null;
  return kind && (kind.type === "image/png" || kind.type === "image/jpeg") ? `data:${kind.type};base64,${Buffer.from(bytes).toString("base64")}` : null;
};
export const photoHostOk = (url) => {
  try { const u = new URL(url); return u.protocol === "https:" && PHOTO_HOSTS.some((re) => re.test(u.hostname)); } catch { return false; }
};

// a body nobody will read is cancelled, so its connection is let go
const drop = (res) => { try { res.body?.cancel?.()?.catch?.(() => {}); } catch { /* already closed */ } };

// the response's bytes, or null once they pass `max`: a body that keeps going is dropped as it arrives, not buffered
async function readCapped(res, max) {
  if (Number(res.headers.get("content-length")) > max) { drop(res); return null; }
  if (!res.body?.getReader) { const all = Buffer.from(await res.arrayBuffer()); return all.length <= max ? all : null; }
  const reader = res.body.getReader(), chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function fetchPhoto(url, fetchImpl, signal, max) {
  if (!photoHostOk(url)) return null;
  const res = await fetchImpl(url, { signal, redirect: "manual", headers: { Accept: "image/png,image/jpeg" } });
  if (!res.ok) { drop(res); return null; }
  return asDataUri(await readCapped(res, max), max);
}

// ref: clients.photo or placements.cover (a data: URI, a Blob or Spotify link, or /assets/...). null when there's none,
// it isn't a PNG or JPEG, it's over maxBytes, or it doesn't arrive within timeoutMs (1.2 s: a photo that slow is left off
// rather than holding the card up). Never throws.
export async function loadPhoto(ref, { timeoutMs = 1200, root = process.cwd(), fetchImpl = globalThis.fetch, maxBytes = MAX_PHOTO_BYTES } = {}) {
  const v = String(ref || "").trim();
  if (!v) return null;
  const ctl = new AbortController();
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => { ctl.abort(); resolve(null); }, timeoutMs); });
  const work = (async () => {
    const m = /^data:([^;,]*);base64,(.*)$/is.exec(v);
    // one too long to be under the cap (base64 is 4/3 of the bytes) isn't even decoded
    if (m) return m[2].length > Math.ceil(maxBytes * 1.4) ? null : asDataUri(Buffer.from(m[2], "base64"), maxBytes);
    if (/^\/(?!\/)/.test(v)) {
      const pub = path.join(root, "public");
      const rel = v.split(/[?#]/)[0];
      const file = path.join(pub, decodeURIComponent(rel));
      if (!file.startsWith(pub + path.sep)) return null; // a path out of public/ is no photo
      const bytes = await fs.readFile(file).catch(() => null);
      if (bytes) return asDataUri(bytes, maxBytes);
      return fetchImpl ? fetchPhoto(SITE + rel, fetchImpl, ctl.signal, maxBytes) : null;
    }
    return fetchImpl ? fetchPhoto(v, fetchImpl, ctl.signal, maxBytes) : null;
  })().catch(() => null);
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

// Spotify's own picture of a song, for one whose stored cover can't be drawn: the Web API's track -> its album image
// (lib/data/direct.js, the data engine's client-credentials sign-in; its 300 px one). The link it gives is then fetched by
// loadPhoto, so it has to be on the same short list of hosts. null without Spotify keys, on any error, or when Spotify has none.
export async function spotifyCoverUrl(track) {
  if (!track || !spotifyConfigured()) return null;
  try { return (await spotifyTrack(track))?.image || null; } catch { return null; }
}

// A stored Spotify cover is the album's 640 px picture (i.scdn.co/image/ab67616d0000b273…, ~100-150 KB); the same picture
// at 300 px is the same id after ab67616d00001e02 (~20-40 KB), and the card draws a cover at 96 px at most. The 300 px
// link for a 640 px one, or null for any other link (it's then fetched as it is). (2026-11-26)
const SPOTIFY_640 = /^https:\/\/i\.scdn\.co\/image\/ab67616d0000b273([0-9a-f]{16,64})$/i;
export const smallCover = (url) => {
  const m = SPOTIFY_640.exec(String(url || "").trim());
  return m ? `https://i.scdn.co/image/ab67616d00001e02${m[1].toLowerCase()}` : null;
};

// `promise`'s answer, or null after ms
function within(ms, promise) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([Promise.resolve(promise).catch(() => null), late]).finally(() => clearTimeout(timer));
}

// ---- what a warm server remembers (2026-11-26) ---------------------------------------------------------------------------
// A small map of answers: at most `max` entries (the least recently used goes first), each kept for its own ttl (ms).
// Entries are promises, so two requests asking for the same thing at once share one fetch or one drawing.
export function memo(max, clock = () => Date.now()) {
  const m = new Map();
  return {
    get(key) {
      const e = m.get(key);
      if (!e) return undefined;
      if (clock() - e.at > e.ttl) { m.delete(key); return undefined; }
      m.delete(key); m.set(key, e); // most recently used last
      return e.value;
    },
    set(key, value, ttl) {
      m.delete(key);
      m.set(key, { at: clock(), ttl, value });
      while (m.size > max) m.delete(m.keys().next().value);
      return value;
    },
    delete: (key) => m.delete(key),
    clear: () => m.clear(),
    get size() { return m.size; },
  };
}
const hash = (s) => crypto.createHash("sha256").update(String(s)).digest("base64url");

// Pictures: each photo and cover as the data: URI the card draws, already made small. A Spotify cover's link is its
// picture's own id and a Blob upload gets a new link, so a link's picture doesn't change under it; a /assets/ file can be
// replaced, so nothing is kept past PICTURE_TTL. One that didn't come (too slow, an error, not a PNG or JPEG) is kept only
// MISS_TTL, so a slow moment costs that cover for a minute, not for the day.
export const PICTURE_TTL = 6 * 3600e3, MISS_TTL = 60e3;
export const PICTURES = memo(160);
// a picture whose longer side is over SHRINK_OVER times the size it's drawn at is drawn down first (a 768 px photo for a
// 176 px circle; a 640 px cover for a 96 px tile), once, so no card decodes the big one again
const SHRINK_OVER = 4;
// [width, height] of a PNG or JPEG data: URI, or null
export function pictureSize(uri) {
  const m = /^data:image\/(png|jpe?g);base64,(.*)$/is.exec(String(uri || ""));
  if (!m) return null;
  const b = Buffer.from(m[2], "base64");
  if (b[0] === 0x89 && b.length > 24) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) { i++; continue; }
    const k = b[i + 1];
    if (k === 0xd8 || k === 0x01 || (k >= 0xd0 && k <= 0xd7) || k === 0xff) { i += k === 0xff ? 1 : 2; continue; }
    if (k >= 0xc0 && k <= 0xcf && k !== 0xc4 && k !== 0xc8 && k !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}
// A picture for the card, side px at most where it's drawn: loadPhoto's, drawn down when it's much bigger than that, kept
// in `cache` (PICTURES on the server; none means fetched every time, as a test may want). null as loadPhoto's null.
export async function cardPicture(ref, side, { cache = null, ...opts } = {}) {
  const v = String(ref || "").trim();
  if (!v) return null;
  const make = async () => {
    const uri = await loadPhoto(v, opts);
    const size = uri && pictureSize(uri);
    return size && Math.max(...size) > side * SHRINK_OVER ? (await shrinkPicture(uri, side)) || uri : uri;
  };
  if (!cache) return make();
  const key = `p${side}|${hash(v)}`;
  const kept = cache.get(key);
  if (kept !== undefined) return within(Math.max(1, opts.timeoutMs ?? 1200), kept);
  const work = make().catch(() => null);
  cache.set(key, work, PICTURE_TTL);
  const got = await work;
  if (!got && cache.get(key) === work) cache.set(key, work, MISS_TTL);
  return got;
}
// Spotify's link for a track's cover, kept the same way (a track's album art doesn't change)
async function coverLink(track, lookup, cache, ms) {
  if (!cache) return within(ms, lookup(track));
  const key = `t|${track}`;
  let work = cache.get(key);
  if (work === undefined) {
    work = Promise.resolve(lookup(track)).catch(() => null);
    cache.set(key, work, PICTURE_TTL);
    work.then((url) => { if (!url && cache.get(key) === work) cache.set(key, work, MISS_TTL); });
  }
  return within(ms, work);
}

// The cover art of the songs the card draws, each as a data: URI it can draw, or null. songs: [{ cover, track }] (what
// shareStats gives, lib/portal-streams.js topSongs). The song's own stored cover first (a Spotify one at 300 px, its 640 px
// one if that doesn't come); for a song with none that can be drawn (none stored, a host that isn't on the list, a WebP,
// too big, too slow), Spotify's picture of its track when it has one. Nothing else: a song with no cover of its own gets
// null, and the card its D tile, never another song's art or a made-up one. All the songs at once, each with timeoutMs
// (1.5 s) from the start for its whole search, so a slow one never holds the card up longer than that. A cover two songs
// share is fetched once. side: the size a cover is drawn at (the story's tile); cache: where pictures are kept (PICTURES
// on the server). Never throws. [dataUri | null], in order
export async function loadCovers(songs, { timeoutMs = 1500, root, fetchImpl, lookup = spotifyCoverUrl, side = LAYOUT.story.thumb, cache = null } = {}) {
  const same = new Map();
  const one = async (s) => {
    const until = Date.now() + timeoutMs, left = () => Math.max(1, until - Date.now());
    const get = (ref) => cardPicture(ref, side, { cache, timeoutMs: left(), root, fetchImpl, maxBytes: MAX_COVER_BYTES });
    const small = smallCover(s?.cover);
    const stored = (small && (await get(small))) || (await get(s?.cover));
    if (stored || !s?.track || !lookup) return stored;
    const url = await coverLink(s.track, lookup, cache, left());
    return url ? get(url) : null;
  };
  return Promise.all((songs || []).map((s) => {
    const key = `${String(s?.cover || "").trim()}|${s?.track || ""}`;
    if (key !== "|" && same.has(key)) return same.get(key);
    const work = one(s).catch(() => null);
    same.set(key, work);
    return work;
  }));
}

// ---- the card, made once (2026-11-26) ---------------------------------------------------------------------------------
// A warm server keeps each card it drew, keyed by everything the card shows: the client, the size, the day it says and the
// numbers (the name, the total, each top song's title, streams and cover link, the photo's link). When any of those
// change (a new day, new streams, a new cover) the key is new and the card is drawn again; nothing is ever served for
// numbers that aren't the ones just read. A card drawn with a picture missing (a cover that didn't come in time) is kept
// only PARTIAL_TTL and gets no ETag, so it isn't held on to as if it were the whole card.
export const CARD_TTL = 6 * 3600e3, PARTIAL_TTL = 60e3;
export const CARDS = memo(24); // a card is ~150-300 KB
const CARD_LOOK = "black-1126"; // bumped when the card's look changes, so a card from before isn't taken for the same one
export function cardKey({ clientId, format, stats, said }) {
  return hash(JSON.stringify({
    look: CARD_LOOK, clientId: String(clientId), format, day: stats?.asOf || "", name: said?.name ?? null, gross: stats?.grossStreams ?? 0,
    photo: String(stats?.photo || ""), songs: (said?.songs || []).map((s) => [s.title, s.streams, String(s.cover || ""), s.track || ""]), leftOff: said?.leftOff || 0,
  }));
}
// the ETag that goes with a key (only a whole card's is ever sent)
export const cardTag = (key) => `"sc-${String(key).slice(0, 32)}"`;
// an If-None-Match header names this ETag (one of a list, weak or strong)
export const tagMatches = (header, tag) => String(header || "").split(",").map((s) => s.trim().replace(/^W\//, "")).includes(tag);

// The card's PNG for numbers already read (stats, and said = cardText's): the kept one when there is one, else its photo
// and covers (each kept too) and a fresh drawing. { png, complete (every picture it should have came), cached }.
// opts: assets, cards (CARDS), pictures (PICTURES), timing(name, ms), and loadCovers' fetchImpl, lookup, root.
export async function drawShareCard({ key, format, stats, said }, { assets, cards = CARDS, pictures = PICTURES, timing = () => {}, fetchImpl, lookup, root } = {}) {
  const kept = cards?.get(key);
  if (kept) {
    const hit = await kept.catch(() => null);
    if (hit) { timing("cache", 0); return { ...hit, cached: true }; }
  }
  const work = (async () => {
    let t = Date.now();
    const load = { cache: pictures, ...(fetchImpl ? { fetchImpl } : {}), ...(root ? { root } : {}) };
    const [photo, covers] = await Promise.all([
      cardPicture(stats.photo, LAYOUT.story.photo, { ...load, timeoutMs: 1200 }),
      loadCovers(said.songs, { ...load, ...(lookup !== undefined ? { lookup } : {}) }),
    ]);
    timing("pictures", Date.now() - t);
    const songs = said.songs.map((s, i) => ({ title: s.title, streams: s.streams, cover: covers[i] }));
    t = Date.now();
    const png = await renderCardPng({ ...stats, photo, songs }, format, { assets: assets || loadAssets() });
    timing("render", Date.now() - t);
    const complete = (!String(stats.photo || "").trim() || !!photo) && said.songs.every((s, i) => !!covers[i] || (!String(s.cover || "").trim() && !s.track));
    return { png, complete };
  })();
  if (!cards) return { ...(await work), cached: false };
  cards.set(key, work, CARD_TTL);
  try {
    const out = await work;
    if (!out.complete && cards.get(key) === work) cards.set(key, work, PARTIAL_TTL);
    return { ...out, cached: false };
  } catch (err) {
    if (cards.get(key) === work) cards.delete(key);
    throw err;
  }
}

// Everything at once, as GET /api/share-card does it (for scripts and tests; the route runs the same steps with its
// answers in between): the numbers, what the card says, its key, the card. null when there's no such client.
// { png, complete, cached, key, day, stats, said }
export async function makeShareCard(clientId, format, { load, now, timing = () => {}, ...opts } = {}) {
  let t = Date.now();
  const stats = await shareStats(clientId, { ...(load ? { load } : {}), ...(now != null ? { now } : {}) });
  timing("numbers", Date.now() - t);
  if (!stats) return null;
  const assets = opts.assets || loadAssets();
  const said = cardText(stats, assets);
  const key = cardKey({ clientId, format, stats, said });
  const out = await drawShareCard({ key, format, stats, said }, { ...opts, assets, timing });
  return { ...out, key, day: stats.asOf, stats, said };
}
