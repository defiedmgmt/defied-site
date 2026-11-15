// The share card's numbers (2026-11-13, the owner: "a share button that captures only their gross streams"). Server-only.
//   shareStats(clientId)  { name, photo, grossStreams, songs: [{ title, streams, cover, track }] (the top 5), asOf } or
//                         null (no such client): exactly the Gross Streams and per-song streams the client's portal
//                         shows, worked out by the same function (lib/portal-streams.js portalStreams). No net streams,
//                         splits or money. cover is the song's stored cover link (placements.cover) and track its
//                         Spotify track id: where the card's cover art comes from
//   shareTarget(...)      whose card this request may have (a client: their own; staff: Clients access, and an account
//                         limited to its own artists only theirs)
//   loadPhoto(ref)        the client's photo as a data: URI the card can draw, or null (never more than ~1.5 s)
//   loadCovers(songs)     each top song's cover art the same way (loadPhoto's one fetcher, ~3 s each, all at once), or
//                         null for a song with none: the card then draws its D tile, never another picture
// The picture itself is lib/share-card-render.js; GET /api/share-card puts the two together.
import fs from "node:fs/promises";
import path from "node:path";
import { sql } from "./db";
import { mayUseClient } from "./access";
import { songGrowth } from "./data/growth";
import { loadSummary } from "./data/summary";
import { loadSameSongIds, withSameSongIds } from "./data/engine";
import { streamsOn, nyYmd } from "./streams-on";
import { portalStreams, spotSongsOf, topSongs } from "./portal-streams";
import { sniffImage, MAX_IMAGE_BYTES } from "./image-links";
import { spotifyConfigured, spotifyTrack } from "./data/direct";

// Pure. What the portal has when it shows Gross Streams: the client, their songs ({ id, song, link, streams }), the
// Spotify growth per song (GET /api/growth), the automated numbers' songs for the artist (GET /api/my-numbers or
// /api/data: [{ id, ids?, under1k, streams: { latest } }]) and the day the streams are from.
export function shareStatsFrom({ client, placements, growth = null, artistSongs = [], asOf = null }) {
  if (!client) return null;
  const r = portalStreams(placements || [], { growth, spotSongs: spotSongsOf(artistSongs) });
  return { name: String(client.name || ""), photo: client.photo || null, grossStreams: Math.round(r.gross), songs: topSongs(r.songs, 5), asOf };
}

// The same reads the portal's three requests make (GET /api/dashboard-data, /api/growth, /api/my-numbers), for one client
export async function loadShareInputs(clientId) {
  const [clients, rows, growth, summary, same, day, settings] = await Promise.all([
    sql`SELECT id, name, photo FROM clients WHERE id = ${clientId}`,
    sql`SELECT id, song, link, cover, streams FROM placements WHERE client_id = ${clientId}`,
    songGrowth({ clientIds: [clientId] }),
    loadSummary({ clientIds: [clientId] }),
    loadSameSongIds(),
    streamsOn(),
    sql`SELECT last_synced_at FROM site_settings WHERE id = 1`,
  ]);
  const artist = (summary.artists || []).find((a) => a.clientId === clientId);
  const lastSync = settings[0]?.last_synced_at;
  return {
    client: clients[0] || null,
    placements: rows.map((p) => ({ id: p.id, song: p.song, link: p.link, cover: p.cover, streams: Number(p.streams) })),
    growth,
    artistSongs: withSameSongIds(artist?.songs || [], same),
    // the portal's "Streams as of" day, as a New York date
    asOf: day || nyYmd(lastSync || new Date()),
  };
}

export async function shareStats(clientId, { load = loadShareInputs } = {}) {
  return shareStatsFrom(await load(clientId));
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
  if (!(req?.access?.sections || []).includes("publishing")) return { status: 403, error: "Your account can't use Clients." };
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
// it isn't a PNG or JPEG, it's over maxBytes, or it doesn't arrive within timeoutMs. Never throws.
export async function loadPhoto(ref, { timeoutMs = 1500, root = process.cwd(), fetchImpl = globalThis.fetch, maxBytes = MAX_PHOTO_BYTES } = {}) {
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
// (lib/data/direct.js, the data engine's client-credentials sign-in). The link it gives is then fetched by loadPhoto, so
// it has to be on the same short list of hosts. null without Spotify keys, on any error, or when Spotify has none.
export async function spotifyCoverUrl(track) {
  if (!track || !spotifyConfigured()) return null;
  try { return (await spotifyTrack(track))?.image || null; } catch { return null; }
}

// `promise`'s answer, or null after ms
function within(ms, promise) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([Promise.resolve(promise).catch(() => null), late]).finally(() => clearTimeout(timer));
}

// The cover art of the songs the card draws, each as a data: URI it can draw, or null. songs: [{ cover, track }] (what
// shareStats gives, lib/portal-streams.js topSongs). The song's own stored cover first; for a song with none that can be
// drawn (none stored, a host that isn't on the list, a WebP, too big, too slow), Spotify's picture of its track when it
// has one. Nothing else: a song with no cover of its own gets null, and the card its D tile, never another song's art or
// a made-up one. All the songs at once, each with timeoutMs (3 s) from the start for its whole search, so a slow one never
// holds the card up longer than that. A cover two songs share is fetched once. Never throws. [dataUri | null], in order
export async function loadCovers(songs, { timeoutMs = 3000, root, fetchImpl, lookup = spotifyCoverUrl } = {}) {
  const same = new Map();
  const one = async (s) => {
    const until = Date.now() + timeoutMs, left = () => Math.max(1, until - Date.now());
    const get = (ref) => loadPhoto(ref, { timeoutMs: left(), root, fetchImpl, maxBytes: MAX_COVER_BYTES });
    const stored = await get(s?.cover);
    if (stored || !s?.track || !lookup) return stored;
    const url = await within(left(), lookup(s.track));
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
