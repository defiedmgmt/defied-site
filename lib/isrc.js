// Finds a song's ISRC (the code Luminate's "add songs" search takes) in
// Deezer's free public catalog: no key, no account. Spotify stopped giving
// ISRCs to small apps in 2026, so it can't be used for this. A hit must have
// the same title (feat. tags and punctuation aside) and, when we know one,
// a matching artist; anything less is left for staff to type in.
import { normalizeTitle } from "./sheets";
import { personKey } from "./names";

const DEEZER = "https://api.deezer.com";
export const ISRC_RE = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
export const cleanIsrc = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function deezer(path) {
  const res = await fetch(`${DEEZER}${path}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Deezer answered ${res.status}`);
  const data = await res.json();
  if (data?.error) throw new Error(data.error.message || "Deezer error");
  return data;
}

// every name an artist credit holds ("A, B & C feat. D" -> a, b, c, d)
const SPLIT = /,|&|\s+x\s+|\bfeat\.?|\bft\.?|\bwith\b/i;
const names = (s) => String(s || "").split(SPLIT).map(personKey).filter(Boolean);
// titles compare without a "(feat. X)" or "(with X)" credit, which stores add or leave off
const loose = (s) => normalizeTitle(String(s || "").replace(/[([]\s*(feat|ft|featuring|with)\b[^)\]]*[)\]]/gi, "")).replace(/\s+with\s+.*$/, "");

// -> { isrc, deezerId, title, artist, match: "exact"|"title" } or null when nothing fits
export async function findIsrc({ song, artist }) {
  const title = loose(song);
  if (!title) return null;
  const want = names(artist);
  const first = String(artist || "").split(SPLIT)[0].replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
  const plain = String(song || "").replace(/[([]\s*(feat|ft|featuring|with)\b[^)\]]*[)\]]/gi, "").replace(/[^\p{L}\p{N}\s'&]/gu, " ").replace(/\s+/g, " ").trim();
  let pick = null, byArtist = [];
  // artist + title first; a title-only search finds songs Deezer files under a different first artist
  for (const q of [`${first} ${plain}`.trim(), plain]) {
    const found = await deezer(`/search/track?q=${encodeURIComponent(q)}&limit=25`);
    const sameTitle = (found.data || []).filter((t) => loose(t.title) === title || loose(t.title_short) === title);
    byArtist = sameTitle.filter((t) => want.length && names(t.artist?.name).some((n) => want.includes(n)));
    pick = byArtist[0] || (!want.length ? sameTitle[0] : null);
    if (pick) break;
    await wait(120);
  }
  if (!pick) return null;
  await wait(120); // Deezer allows 50 calls per 5 seconds
  const track = await deezer(`/track/${pick.id}`);
  const isrc = cleanIsrc(track.isrc);
  if (!ISRC_RE.test(isrc)) return null;
  return { isrc, deezerId: pick.id, title: track.title, artist: track.artist?.name || "", match: byArtist.length ? "exact" : "title" };
}
