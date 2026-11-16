// (2026-11-16) Site › Instagram's "Look up": a Spotify song or album link → what the composer needs (title, artists,
// the biggest cover, release date, an album's tracks), each artist with the @handle the site already knows, and a best
// guess at who produced it from the song's split (placements.splits). Server only; reads Spotify through the repo's own
// client-credentials helper (lib/data/direct.js) and writes nothing.
import { sql } from "./db";
import { getState } from "./app-state";
import { spotifyGet, spotifyAlbumTracks, spotifyConfigured } from "./data/direct";
import { handleOf } from "./data/sources";
import { findByName, personKey } from "./names";
import { sideOf } from "./splits";
import { baseTitle, spotifyTrack } from "./duplicates";
import { cleanTitle } from "./ig-caption";
import { IgError, KEYS } from "./instagram";

// { kind: "track" | "album", id } from open.spotify.com/(intl-xx/)track|album/<id> or spotify:track:<id>; null otherwise
export function spotifyRef(url) {
  const m = /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?|spotify:)(track|album)[/:]([A-Za-z0-9]{22})/.exec(String(url ?? ""));
  return m ? { kind: m[1], id: m[2] } : null;
}
const biggest = (imgs) => [...(imgs || [])].sort((a, b) => (Number(b?.width) || 0) - (Number(a?.width) || 0))[0]?.url || "";
const artistsOf = (list) => (list || []).filter((a) => a?.name).map((a) => ({ name: a.name, spotifyId: a.id || "" }));

// Spotify's answers, as the composer reads them
export function parseTrack(t) {
  return {
    kind: "track", id: t.id, title: cleanTitle(t.name), artists: artistsOf(t.artists), cover: biggest(t.album?.images),
    releaseDate: t.album?.release_date || "", album: t.album?.name || "", link: `https://open.spotify.com/track/${t.id}`,
  };
}
export function parseAlbum(a, items) {
  return {
    kind: "album", id: a.id, title: String(a.name || "").trim(), artists: artistsOf(a.artists), cover: biggest(a.images),
    releaseDate: a.release_date || "", albumType: a.album_type || "", link: `https://open.spotify.com/album/${a.id}`,
    // n is the track's place on the album (as the caption's "Track 9" counts), across discs
    tracks: (items || []).map((t, i) => ({ n: i + 1, id: t.id || "", name: cleanTitle(t.name), artists: artistsOf(t.artists) })),
  };
}
export async function spotifyLookup(url) {
  const ref = spotifyRef(url);
  if (!ref) throw new IgError("Paste a Spotify song or album link (open.spotify.com/track/… or /album/…).", 400);
  if (!spotifyConfigured()) throw new IgError("Spotify isn't set up (SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET).", 503);
  try {
    if (ref.kind === "track") return parseTrack(await spotifyGet(`/tracks/${ref.id}`));
    const a = await spotifyGet(`/albums/${ref.id}`);
    let items = a?.tracks?.items || [];
    const total = Number(a?.total_tracks) || items.length;
    // an album longer than the first page: the rest, ten at a time (Spotify's development-mode page size)
    if (items.length < total) items = await spotifyAlbumTracks(ref.id, { max: Math.min(total, 100) });
    return parseAlbum(a, items);
  } catch (err) {
    if (/: 404\b|: 400\b/.test(String(err?.message))) throw new IgError("Spotify doesn't have that link. Check it and try again.", 404);
    throw new IgError(`Spotify didn't answer (${String(err?.message || "").slice(0, 80)}). Try again in a minute.`, 502);
  }
}

// who the site knows: the clients (and the team page) with their Instagram, the handles used on earlier posts, and the songs' splits
async function known() {
  const [clients, staff, placements, remembered] = await Promise.all([
    sql`SELECT id, name, role, instagram, sheet_tab_name, on_roster FROM clients`,
    sql`SELECT name, instagram FROM staff_bios`.catch(() => []),
    sql`SELECT client_id, song, artist, link, splits FROM placements`,
    getState(KEYS.handles).catch(() => null),
  ]);
  return { clients, staff, placements, remembered: remembered || {} };
}
const igOf = (v) => handleOf(v, "instagram.com");
// a name's handle: the roster's (clients.instagram), else the team page's, else the last one used on a post, else none
export function handleFor(name, k) {
  const c = findByName(k.clients, name);
  if (c && igOf(c.instagram)) return { handle: igOf(c.instagram), from: "roster", clientId: c.id };
  const s = findByName(k.staff, name);
  if (s && igOf(s.instagram)) return { handle: igOf(s.instagram), from: "team", clientId: c?.id || null };
  const r = k.remembered[personKey(name)];
  if (r) return { handle: r, from: "remembered", clientId: c?.id || null };
  return { handle: "", from: "", clientId: c?.id || null };
}
// The song's own card (the same Spotify track, else the same title with one of its artists) and who its split says produced
// it: { producers: [clientId], credit: "produced" | null }. "produced" only when every producer on the split is a client
// (an unnamed producer counts as someone else). A best guess: the composer only preselects it.
export function producerHint(track, k) {
  const ps = k.placements || [];
  const keys = (track.artists || []).map((a) => personKey(a.name)).filter(Boolean);
  const p = ps.find((x) => track.id && spotifyTrack(x.link) === track.id)
    || ps.find((x) => baseTitle(x.song) && baseTitle(x.song) === baseTitle(track.name || track.title) && (!x.artist || keys.some((a) => personKey(x.artist).includes(a))));
  if (!p) return null;
  const prods = (Array.isArray(p.splits) ? p.splits : []).filter((s) => sideOf(s?.role) === "Producer");
  const ids = [], strangers = [];
  for (const s of prods) {
    const c = !s.unnamed && s.name ? findByName(k.clients, s.name) : null;
    if (c) { if (!ids.includes(c.id)) ids.push(c.id); } else strangers.push(s);
  }
  if (!prods.length) {
    const own = k.clients.find((c) => c.id === p.client_id);
    return own && sideOf(own.role) === "Producer" ? { producers: [own.id], credit: null } : null;
  }
  return { producers: ids, credit: ids.length && !strangers.length ? "produced" : null };
}

// the lookup the composer gets: Spotify's answer with a handle (and where it came from) on every artist, and the guess
export async function lookup(url) {
  const found = await spotifyLookup(url);
  const k = await known();
  const withHandle = (a) => ({ ...a, ...handleFor(a.name, k) });
  const out = { ...found, artists: found.artists.map(withHandle) };
  if (found.kind === "track") out.hint = producerHint({ id: found.id, name: found.title, artists: found.artists }, k);
  else {
    out.tracks = found.tracks.map((t) => ({ ...t, artists: t.artists.map(withHandle), hint: producerHint(t, k) }));
    // a one-song release (Spotify files singles as albums): its song's guess is the release's
    out.hint = out.tracks.length === 1 ? out.tracks[0].hint : null;
  }
  return out;
}

// the producers' list: every client, with their handle (the roster's, else the last one used), producers first
export async function rosterHandles() {
  const [clients, remembered] = await Promise.all([sql`SELECT id, name, role, instagram, on_roster FROM clients`, getState(KEYS.handles).catch(() => null)]);
  const k = { clients, remembered: remembered || {} };
  return k.clients
    .map((c) => {
      const own = igOf(c.instagram), was = k.remembered[personKey(c.name)] || "";
      return { id: c.id, name: c.name, role: c.role || "", producer: sideOf(c.role) === "Producer", onRoster: !!c.on_roster, handle: own || was, from: own ? "roster" : was ? "remembered" : "" };
    })
    .sort((a, b) => (b.producer - a.producer) || a.name.localeCompare(b.name));
}
