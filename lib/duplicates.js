// Two cards on one client's page that are likely the same song (build H1, owner Nov 1: "the 2 songs are
// grouped as the same and should show up as the same"), e.g. "TRUST WHO - SLOWED & REVERB" (the sheet row and
// the Luminate id) and "TRUST WHO #jerseyclub" (a release date and a link, no row). Pure: the Dashboard's To do,
// the merge card and its tests read this one rule. Nothing here writes anything.
//
// A pair is the same client and one of: the same Luminate id, the same ISRC, the same Spotify track, or the
// same title once version tags are taken off ("- SLOWED & REVERB", "#jerseyclub", "(Jersey Club)", "Sped Up").
// Never a pair: two different Luminate ids (Luminate counts them as two songs), both with a pub sheet row (the
// sheet already has them as two), a client whose tab hasn't been read (whether they have rows isn't known),
// or a pair staff marked "Not the same song".

const TAG = "(?:(?:super\\s+)?slowed(?:\\s+down)?|sped\\s*up|reverb(?:ed)?|jersey\\s*club|nightcore)";
const TAGS = `${TAG}(?:\\s*(?:&|\\+|and|,|/)?\\s*${TAG})*(?:\\s+(?:version|remix|edit|mix))?`;
const PAREN = new RegExp(`[(\\[]\\s*${TAGS}\\s*[)\\]]`, "gi");
const DASH = new RegExp(`\\s+[-–—:|]\\s*${TAGS}\\s*$`, "i");
const TAIL = new RegExp(`\\s+${TAGS}\\s*$`, "i");
const HASH = /#\s*(?:jersey\s*club|slowed(?:\s*(?:and|&)?\s*reverb)?|sped\s*up|reverb|nightcore)\b/gi;

// the title as it reads without its version tags, case kept: "TRUST WHO - SLOWED & REVERB" -> "TRUST WHO"
export function plainTitle(s) {
  let t = String(s || "").replace(HASH, " ").replace(PAREN, " ");
  for (let i = 0; i < 3; i++) t = t.replace(DASH, "").replace(TAIL, "");
  t = t.replace(/\s+/g, " ").replace(/[\s\-–—:|,.]+$/, "").trim();
  return t || String(s || "").trim();
}
// what two titles are compared on: no tags, no case, no punctuation ("Spots. - Jersey Club" -> "spots")
export const baseTitle = (s) => plainTitle(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
// the track id of a Spotify track link (open.spotify.com/track/<id>, with or without intl-xx/ and ?si=)
export const spotifyTrack = (link) => (/open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]{22})/.exec(String(link || "")) || [])[1] || "";
// one key per pair, whichever card comes first
export const pairKey = (a, b) => [a, b].sort().join("|");

// why two cards look alike, in plain words; null when they don't
export function sameSong(a, b, isrcOf = () => "") {
  if (a.luminateId && b.luminateId) return a.luminateId === b.luminateId ? "the same Luminate id" : null;
  const ia = isrcOf(a.id), ib = isrcOf(b.id);
  if (ia && ib && ia.toUpperCase() === ib.toUpperCase()) return "the same ISRC";
  const sa = spotifyTrack(a.link), sb = spotifyTrack(b.link);
  if (sa && sb && sa === sb) return "the same Spotify track";
  const ta = baseTitle(a.song), tb = baseTitle(b.song);
  return ta && ta === tb ? "the same title once version tags are left out" : null;
}

// placements: db.placements; facts: db.sheetFacts ({ songs: { id: { row } }, clients: { clientId: net } });
// isrcOf(placementId): the ISRC Luminate tracking holds; dismissed: pair keys marked "Not the same song".
// Returns [{ key, clientId, keep, drop, why }], biggest streams first. keep is the card with the sheet row
// (else the Luminate id, else more streams): it's never the one removed
export function likelyDuplicates(placements, { facts = {}, isrcOf = () => "", dismissed = [] } = {}) {
  const rowOf = (p) => facts.songs?.[p.id]?.row ?? null;
  const tabRead = (clientId) => facts.clients?.[clientId] != null;
  const skip = new Set(dismissed);
  const by = new Map();
  for (const p of placements || []) if (p.clientId) by.set(p.clientId, [...(by.get(p.clientId) || []), p]);
  const out = [], used = new Set();
  for (const [clientId, songs] of by) {
    if (!tabRead(clientId)) continue;
    for (let i = 0; i < songs.length; i++) {
      for (let j = i + 1; j < songs.length; j++) {
        const a = songs[i], b = songs[j];
        if (used.has(a.id) || used.has(b.id) || skip.has(pairKey(a.id, b.id))) continue;
        if (rowOf(a) != null && rowOf(b) != null) continue;
        const why = sameSong(a, b, isrcOf);
        if (!why) continue;
        const score = (p) => (rowOf(p) != null ? 4 : 0) + (p.luminateId ? 2 : 0);
        const [keep, drop] = score(a) !== score(b) ? (score(a) > score(b) ? [a, b] : [b, a]) : ((b.streams || 0) > (a.streams || 0) ? [b, a] : [a, b]);
        // one pair per card at a time: a third copy comes up after this pair is merged or set aside
        used.add(a.id); used.add(b.id);
        out.push({ key: pairKey(a.id, b.id), clientId, keep, drop, why });
      }
    }
  }
  return out.sort((x, y) => Math.max(y.keep.streams || 0, y.drop.streams || 0) - Math.max(x.keep.streams || 0, x.drop.streams || 0));
}

const total = (rows) => (rows || []).reduce((a, s) => a + Number(s.percent || 0), 0);
const adds = (rows) => Math.abs(total(rows) - 100) <= 0.001;
const unnamed = (rows) => (rows || []).filter((s) => !String(s.name || "").trim()).length;
// the card the merge leaves: the kept card as it is (its title, streams, sheet row and Luminate id), with what it
// lacks filled from the other one, and the split that adds up to 100% (the kept card's own when neither does).
// When both add up, the one that names more people: a kept card whose even default was confirmed as
// "Stack!e 50 · unnamed artist 50" never drops the other card's named "Ziahfyah 50"
export function mergedCard(keep, drop) {
  const splits = !adds(drop.splits) ? keep.splits : !adds(keep.splits) ? drop.splits
    : unnamed(drop.splits) < unnamed(keep.splits) ? drop.splits : keep.splits;
  return {
    ...keep,
    releaseDate: keep.releaseDate || drop.releaseDate || "",
    link: keep.link || drop.link || "",
    cover: keep.cover || drop.cover || "",
    artist: keep.artist || drop.artist || "",
    luminateId: keep.luminateId || drop.luminateId || "",
    notable: !!(keep.notable || drop.notable),
    splits: splits || [],
  };
}

// The merged card's title (build I2, owner Nov 2: "trustwho #jersey club is the real song and the slowed and reverb
// one is in that release group"): what Luminate calls the kept card's Luminate id, when that is the same song as one
// of the two cards once their version tags are compared (a wrong id never renames a card); else the kept card's own.
// Returns { title, fromLuminate, other }: other is the second choice the merge card offers ("" when there's none).
export function mergedTitle(keep, drop, lumTitle) {
  const lt = String(lumTitle || "").trim();
  const fromLuminate = !!lt && !!baseTitle(lt) && [keep, drop].some((p) => baseTitle(p.song) === baseTitle(lt));
  const title = fromLuminate ? lt : keep.song || "";
  const other = [keep.song, drop.song].map((t) => String(t || "").trim()).find((t) => t && t !== title) || "";
  return { title, fromLuminate, other };
}
