import { normalizeTitle } from "./catalog-data";
import { spotifyTrack } from "../../lib/duplicates";

// The songs with no ISRC (r11: a leaf, so To do's row count loads without the finder's screen). One row per
// song: the same Spotify link, or the same title and artist, is one song even when two clients' pages have it.
export function songsWithoutIsrc(db, songInfo) {
  const tr = songInfo?.tracking || {};
  const by = new Map();
  for (const p of db.placements || []) {
    const sp = spotifyTrack(p.link);
    const key = sp ? `t:${sp}` : `n:${normalizeTitle(p.song)}|${normalizeTitle(p.artist)}`;
    const g = by.get(key) || { key, song: p.song || "", artist: p.artist || "", link: p.link || "", ids: [], clientIds: [], isrc: "" };
    g.ids.push(p.id);
    if (p.clientId && !g.clientIds.includes(p.clientId)) g.clientIds.push(p.clientId);
    if (tr[p.id]?.isrc) g.isrc = tr[p.id].isrc;
    by.set(key, g);
  }
  const cands = songInfo?.isrcCandidates || {};
  return [...by.values()].filter((g) => !g.isrc).map((g) => ({ ...g, picks: g.ids.map((id) => cands[id]).find((x) => x?.length) || [] }));
}
