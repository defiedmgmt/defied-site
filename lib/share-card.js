// The share card's numbers (2026-11-13, the owner: "a share button that captures only their gross streams"). Server-only.
//   shareStats(clientId)  { name, photo, grossStreams, songs: [{ title, streams }] (the top 5), asOf } or null (no such
//                         client): exactly the Gross Streams and per-song streams the client's portal shows, worked out
//                         by the same function (lib/portal-streams.js portalStreams). No net streams, splits or money.
//   shareTarget(...)      whose card this request may have (a client: their own; staff: Clients access, and an account
//                         limited to its own artists only theirs)
//   loadPhoto(ref)        the client's photo as a data: URI the card can draw, or null (never more than ~1.5 s)
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
import { sniffImage } from "./image-links";

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
    sql`SELECT id, song, link, streams FROM placements WHERE client_id = ${clientId}`,
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
    placements: rows.map((p) => ({ id: p.id, song: p.song, link: p.link, streams: Number(p.streams) })),
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

// ---- the photo -------------------------------------------------------------------------------------------------------
// Only from where the site's own photos live (next.config.js images.remotePatterns), so a photo link can't make the
// server fetch anything else. A relative /assets/... photo is read from public/ (or the live site, where public/ isn't
// in the function).
const PHOTO_HOSTS = [/^i\.scdn\.co$/i, /^www\.defiedmgmt\.com$/i, /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i];
const SITE = "https://www.defiedmgmt.com";
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
// Satori draws PNG and JPEG (a WebP or GIF photo means no photo)
const asDataUri = (bytes) => {
  const kind = bytes?.length && bytes.length <= MAX_PHOTO_BYTES ? sniffImage(bytes) : null;
  return kind && (kind.type === "image/png" || kind.type === "image/jpeg") ? `data:${kind.type};base64,${Buffer.from(bytes).toString("base64")}` : null;
};
export const photoHostOk = (url) => {
  try { const u = new URL(url); return u.protocol === "https:" && PHOTO_HOSTS.some((re) => re.test(u.hostname)); } catch { return false; }
};

async function fetchPhoto(url, fetchImpl, signal) {
  if (!photoHostOk(url)) return null;
  const res = await fetchImpl(url, { signal, redirect: "manual", headers: { Accept: "image/png,image/jpeg" } });
  if (!res.ok) return null;
  if (Number(res.headers.get("content-length")) > MAX_PHOTO_BYTES) return null;
  return asDataUri(Buffer.from(await res.arrayBuffer()));
}

// ref: clients.photo (a data: URI, a Blob or Spotify link, or /assets/...). null when there's none, it isn't a PNG or
// JPEG, or it doesn't arrive within timeoutMs. Never throws.
export async function loadPhoto(ref, { timeoutMs = 1500, root = process.cwd(), fetchImpl = globalThis.fetch } = {}) {
  const v = String(ref || "").trim();
  if (!v) return null;
  const ctl = new AbortController();
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => { ctl.abort(); resolve(null); }, timeoutMs); });
  const work = (async () => {
    const m = /^data:([^;,]*);base64,(.*)$/is.exec(v);
    if (m) return asDataUri(Buffer.from(m[2], "base64"));
    if (/^\/(?!\/)/.test(v)) {
      const pub = path.join(root, "public");
      const rel = v.split(/[?#]/)[0];
      const file = path.join(pub, decodeURIComponent(rel));
      if (!file.startsWith(pub + path.sep)) return null; // a path out of public/ is no photo
      const bytes = await fs.readFile(file).catch(() => null);
      if (bytes) return asDataUri(bytes);
      return fetchImpl ? fetchPhoto(SITE + rel, fetchImpl, ctl.signal) : null;
    }
    return fetchImpl ? fetchPhoto(v, fetchImpl, ctl.signal) : null;
  })().catch(() => null);
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}
