// Finds a song's ISRC (how one song with several Spotify ids is counted once, and how a song with no
// link is found on Spotify: search isrc:…) from free catalogs. Tried in order, stopping at the first sure hit:
//   0. (r11, the owner's ask) Spotify's Web API search, with the paste box's client credentials (free):
//      track:"<title>" artist:"<first artist>", 5 songs, each with its ISRC (external_ids.isrc), cover, artists
//      and release date; the song's own Spotify link among them is sure by itself (a song with a link: that song
//      is read first, GET /tracks/{id}, saved as from its Spotify link). Skipped when Spotify isn't set up
//      (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET) or a song comes back without an ISRC.
//   1. the song's own Spotify link -> song.link -> the same song on Deezer -> its ISRC
//   2. Deezer's search, with titles compared loosely (#jerseyclub, "(Jersey Club)", feat. credits and
//      punctuation don't count; a version like "Slowed & Reverb" or "Remix" has to agree)
//   3. the artist's own Deezer tracks (top tracks, then each album), for songs the search misses
//   4. MusicBrainz: its link table for the Spotify link, then its recording search (1 call a second)
// Sure = one song whose title and artist both match once cleaned: it's saved by itself, with where it
// came from. Otherwise up to 3 candidates (cover, title, artist, source) come back for one-tap picking.
import { personKey } from "./names";
import { spotifyTrack } from "./duplicates";
import { spotifyConfigured, spotifyGet } from "./data/direct";

export const ISRC_RE = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
export const cleanIsrc = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
// where a saved ISRC came from (song_tracking.isrc_source / ar_tracking.isrc_source), in words for the page
export const SOURCES = { spotify: "Spotify", "spotify-link": "the song's Spotify link", deezer: "Deezer", "deezer-artist": "the artist's Deezer page", musicbrainz: "MusicBrainz", manual: "typed in" };
const DEEZER = "https://api.deezer.com";
const SONGLINK = "https://api.song.link/v1-alpha.1/links";
const MB = "https://musicbrainz.org/ws/2";
const UA = "DefiedManagementDashboard/1.0 ( https://www.defiedmgmt.com )";
// the gap each service asks for between calls: Deezer 50 per 5 s, song.link 10 a minute without a
// key, MusicBrainz 1 a second
const GAP = { deezer: 120, songlink: 6100, musicbrainz: 1100, spotify: 100 };
const last = {};
// song.link or MusicBrainz down (5xx, 429, no answer): rested 10 minutes, so a batch doesn't wait on a
// dead service song after song. Deezer, the main source, is never rested: when it's down the lookup
// fails and is tried again later.
const REST_MS = 600000;
const restUntil = {};

// --- titles and names --------------------------------------------------------------------------
const VERSION_WORDS = [
  ["slowed", /\bslowed\b|\bslow(ed)?\s*down\b/], ["reverb", /\breverb(ed)?\b/], ["sped", /\bsped\s*up\b|\bspeed\s*up\b|\bnightcore\b/],
  ["remix", /\bremix\b|\bflip\b|\bbootleg\b|\bvip\b/], ["instrumental", /\binstrumental\b|\binst\b/], ["acapella", /\ba\s*cap+el+a\b/],
  ["live", /\blive\b/], ["extended", /\bextended\b/], ["edit", /\bedit\b/],
];
// what a store or the sheet adds or leaves off without it being another recording
const DECOR = /\b(jersey\s*club|jerseyclub|club\s*mix|drill|phonk|official(\s+(audio|video|music\s+video))?|audio|visuali[sz]er|lyrics?(\s+video)?|explicit|clean|dirty|remaster(ed)?|\d{4}\s+remaster(ed)?|prod\.?\s+by\b.*|bonus\s+track|original\s+mix|radio\s+version)\b/;
const CREDIT = /^\s*(feat\.?|ft\.?|featuring|with|prod\.?|produced)\b/;
const fold = (s) => String(s ?? "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
const words = (s) => fold(s).replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();

// A title taken apart: core = the words that name the song; versions = the version tags it carries
// ("slowed", "reverb", "remix", …), which have to agree for a sure match; bare = core without any other
// bracketed part either (a looser match, only ever a candidate).
export function titleParts(title) {
  let t = fold(title).replace(/[’`]/g, "'");
  const versions = new Set();
  const note = (seg) => { for (const [k, re] of VERSION_WORDS) if (re.test(seg)) versions.add(k); };
  // hashtags: a version one counts ("#slowed"), the rest are decoration ("#jerseyclub")
  t = t.replace(/#([\p{L}\p{N}_]+)/gu, (m, w) => { note(w.replace(/_/g, " ")); return " "; });
  const extra = [];
  // bracketed parts and " - suffix" parts: a credit or decoration goes, a version is noted, anything else
  // stays in the core but not in bare
  const seg = (s) => {
    const x = s.trim();
    if (!x || CREDIT.test(x)) return "";
    const before = versions.size;
    note(x);
    if (versions.size > before || VERSION_WORDS.some(([, re]) => re.test(x))) return "";
    if (DECOR.test(x) && words(x.replace(DECOR, "")).length <= 2) return "";
    extra.push(x);
    return ` ${x} `;
  };
  t = t.replace(/[([{]([^)\]}]*)[)\]}]/g, (m, x) => seg(x));
  t = t.replace(/\s+[-–—|:]\s+(.*)$/u, (m, x) => seg(x));
  // a trailing "feat. X" with no brackets
  t = t.replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/, "");
  const core = words(t);
  let bare = core;
  for (const x of extra) bare = ` ${bare} `.replace(` ${words(x)} `, " ").trim();
  return { core, bare: bare || core, versions: [...versions].sort().join(",") };
}

// every name an artist credit holds ("A, B & C feat. D" -> a, b, c, d), by the app's one name rule
const SPLIT = /,|&|\s+x\s+|\s+and\s+|\bfeat\.?|\bft\.?|\bwith\b|\//i;
export const artistNames = (s) => [...new Set(String(s || "").split(SPLIT).map(personKey).filter(Boolean))];
const sameArtist = (want, names) => !want.length || names.some((n) => want.includes(n));

// how well a store's track fits what we're after: "exact" (title, versions and artist), "version"
// (same song name, another version), "loose" (same name once any bracketed part is off), or null
export function fit(want, track) {
  const t = titleParts(track.title);
  const artistOk = sameArtist(want.names, track.names);
  if (!artistOk || !t.core) return null;
  if (t.core === want.t.core && t.versions === want.t.versions) return "exact";
  if (t.core === want.t.core) return "version";
  if (t.bare === want.t.bare || t.core === want.t.bare || t.bare === want.t.core) return t.versions === want.t.versions ? "loose" : "version";
  return null;
}
const RANK = { exact: 0, loose: 1, version: 2 };

// --- the services ------------------------------------------------------------------------------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(svc, url, o) {
  if (restUntil[svc] > Date.now()) { const e = new Error(`${svc} is resting after an error`); e.busy = true; throw e; }
  const gap = GAP[svc] - (Date.now() - (last[svc] || 0));
  if (gap > 0) await (o.wait || wait)(gap);
  last[svc] = Date.now();
  const rest = () => { if (svc !== "deezer") restUntil[svc] = Date.now() + REST_MS; };
  let res;
  try { res = await (o.fetch || fetch)(url, { headers: { Accept: "application/json", ...(svc === "musicbrainz" ? { "User-Agent": UA } : {}) } }); } catch (err) { rest(); throw err; }
  if (res.status >= 500 || res.status === 429) rest();
  const json = res.status === 404 ? null : await res.json().catch(() => null);
  o.onResponse?.({ svc, url, status: res.status, json });
  if (res.status === 404) return null;
  if (res.status === 429 || res.status === 503) { const e = new Error(`${svc} is busy`); e.busy = true; throw e; }
  if (!res.ok) throw new Error(`${svc} answered ${res.status}`);
  if (svc === "deezer" && json?.error) {
    if (/quota/i.test(json.error.type || "") || json.error.code === 4) { const e = new Error("Deezer is busy"); e.busy = true; throw e; }
    if (json.error.code === 800) return null; // "no data"
    throw new Error(json.error.message || "Deezer error");
  }
  return json;
}
const deezer = (path, o) => getJson("deezer", `${DEEZER}${path}`, o);

// a Deezer track as a candidate (its ISRC is only on /track/{id}, read when it's needed)
const fromDeezer = (t, source) => ({
  source, deezerId: t.id, title: t.title || "", artist: t.artist?.name || "", isrc: cleanIsrc(t.isrc),
  names: artistNames([t.artist?.name, ...(t.contributors || []).map((c) => c.name)].filter(Boolean).join(", ")),
  cover: t.album?.cover_medium || t.album?.cover || "", album: t.album?.title || "", duration: t.duration || 0, explicit: !!t.explicit_lyrics,
  link: t.link || (t.id ? `https://www.deezer.com/track/${t.id}` : ""),
});
// its ISRC and every credited artist (search rows name only the first one): /track/{id}, read when
// a list row lacks them, or always with force
async function withIsrc(c, o, force = false) {
  if ((c.isrc && !force) || !c.deezerId) return c;
  const t = await deezer(`/track/${c.deezerId}`, o);
  if (!t) return c;
  const full = fromDeezer(t, c.source);
  return { ...c, isrc: full.isrc || c.isrc, names: [...new Set([...c.names, ...full.names])], cover: c.cover || full.cover, duration: full.duration || c.duration };
}

// 0. Spotify's search (r11). o.spotifySearch(q) stands in for the Web API in tests. Any failure (a 429, a
// sign-in error, no answer) rests Spotify for REST_MS and the lookup carries on with Deezer.
const spotifyOn = (o) => !!o.spotifySearch || spotifyConfigured();
const spotifyImage = (imgs) => (imgs || []).find((x) => x.width && x.width <= 320)?.url || imgs?.[0]?.url || "";
const fromSpotify = (t) => {
  const artist = (t.artists || []).map((a) => a.name).filter(Boolean).join(", ");
  return { source: "spotify", spotifyId: t.id, title: t.name || "", artist, names: artistNames(artist), isrc: cleanIsrc(t.external_ids?.isrc),
    cover: spotifyImage(t.album?.images), album: t.album?.name || "", releaseDate: t.album?.release_date || "", duration: Math.round((t.duration_ms || 0) / 1000),
    explicit: !!t.explicit, link: t.id ? `https://open.spotify.com/track/${t.id}` : "" };
};
// one Spotify call, paced and rested like the rest: ask() -> its answer
async function spotifyCall(url, ask, o) {
  if (restUntil.spotify > Date.now()) { const e = new Error("spotify is resting after an error"); e.busy = true; throw e; }
  const gap = GAP.spotify - (Date.now() - (last.spotify || 0));
  if (gap > 0) await (o.wait || wait)(gap);
  last.spotify = Date.now();
  try {
    const b = await ask();
    o.onResponse?.({ svc: "spotify", url, status: 200, json: b });
    return b;
  } catch (err) {
    restUntil.spotify = Date.now() + REST_MS;
    const e = new Error(`Spotify: ${String(err?.message || err).replace(/^Spotify:?\s*/, "").slice(0, 160)}`); e.busy = /wait|429/.test(String(err?.message)); throw e;
  }
}
async function spotifyAsk(q, o) {
  const b = await spotifyCall(q, () => (o.spotifySearch ? o.spotifySearch(q) : spotifyGet(`/search?type=track&limit=5&q=${encodeURIComponent(q)}`)), o);
  return (b?.tracks?.items || []).filter((t) => t?.id).map(fromSpotify);
}
// the title as Spotify spells it, without the sheet's extras: hashtags, brackets, " - Jersey Club", "feat. …"
const plainTitle = (s) => String(s || "").replace(/#[\p{L}\p{N}_]+/gu, " ").replace(/[([{][^)\]}]*[)\]}]/g, " ").replace(/\s+[-–—|:]\s+.*$/u, "")
  .replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/i, "").replace(/"/g, "").replace(/\s+/g, " ").trim();
async function viaSpotifySearch(want, o) {
  const first = String(want.artist || "").split(SPLIT)[0].replace(/"/g, "").trim();
  const own = spotifyTrack(want.link);
  // (2026-11-13) a song with a Spotify link: that song itself first, one call (GET /tracks/{id}; Spotify blocks asking
  // for several at once in development mode). Its ISRC is the song's, sure by itself, so the 178 songs a Spotify import
  // left without one go about 60 a night instead of 10. o.spotifyTrack(id) stands in for it in tests
  if (own && (o.spotifyTrack || spotifyConfigured())) {
    // (a link Spotify doesn't have, a taken-down song: 404 or 400, is that song's own answer, not Spotify being down.
    // The search runs as before and Spotify isn't rested; else one dead link made every lookup after it "try again
    // later" and the nightly cron stopped on it, night after night)
    const t = await spotifyCall(`/tracks/${own}`, async () => {
      try { return await (o.spotifyTrack ? o.spotifyTrack(own) : spotifyGet(`/tracks/${own}`)); } catch (err) { if (/^Spotify: 40[04]\b/.test(String(err?.message))) return null; throw err; }
    }, o);
    const c = t?.id && fromSpotify(t);
    if (c && ISRC_RE.test(c.isrc)) return [{ ...c, source: "spotify-link", own: true }];
  }
  const raw = String(want.song || "").replace(/#[\p{L}\p{N}_]+/gu, " ").replace(/"/g, "").replace(/\s+/g, " ").trim();
  const titles = [...new Set([plainTitle(want.song) || raw, raw].filter(Boolean))];
  const out = [];
  for (const title of titles) {
    const found = await spotifyAsk(`track:"${title}"${first ? ` artist:"${first}"` : ""}`, o);
    for (const c of found) if (!out.some((x) => x.spotifyId === c.spotifyId)) out.push({ ...c, own: !!own && c.spotifyId === own });
    if (out.some((c) => (c.own || fit(want, c) === "exact") && ISRC_RE.test(c.isrc))) break;
  }
  return out;
}

// 1. the Spotify link: song.link names the same song on Deezer. Its keyless API was closed in 2026
// ("PUBLIC_API_ACCESS_DEPRECATED"), so without SONGLINK_API_KEY it's asked until it says no once; any
// other failure rests it (REST_MS). MusicBrainz' own link table is tried in step 4.
let songlinkClosed = false;
async function viaSpotifyLink(want, o) {
  const id = spotifyTrack(want.link);
  const key = process.env.SONGLINK_API_KEY || "";
  if (!id || (songlinkClosed && !key) || restUntil.songlink > Date.now()) return [];
  try {
    const r = await getJson("songlink", `${SONGLINK}?url=${encodeURIComponent(`https://open.spotify.com/track/${id}`)}&userCountry=US${key ? `&key=${encodeURIComponent(key)}` : ""}`, o);
    const k = r?.linksByPlatform?.deezer?.entityUniqueId;
    const dzId = k && (r.entitiesByUniqueId?.[k]?.id || String(k).split("::")[1]);
    const t = dzId && (await deezer(`/track/${dzId}`, o));
    return t ? [fromDeezer(t, "spotify-link")] : [];
  } catch (err) {
    if (!/^songlink/.test(err.message) && !err.busy) throw err; // (Deezer's own trouble)
    if (/answered 40[13]/.test(err.message)) songlinkClosed = true; else restUntil.songlink = Date.now() + REST_MS;
    return [];
  }
}
// MusicBrainz' link table: a Spotify URL -> its recording -> that recording's ISRCs (source spotify-link)
async function viaMusicBrainzLink(want, o) {
  const id = spotifyTrack(want.link);
  if (!id) return [];
  const u = await getJson("musicbrainz", `${MB}/url?resource=${encodeURIComponent(`https://open.spotify.com/track/${id}`)}&inc=recording-rels&fmt=json`, o);
  const out = [];
  for (const rel of (u?.relations || []).filter((x) => x.recording?.id).slice(0, 2)) {
    const rec = await getJson("musicbrainz", `${MB}/recording/${rel.recording.id}?inc=isrcs+artist-credits+releases&fmt=json`, o);
    const rid = rec?.releases?.[0]?.id;
    for (const i of rec?.isrcs || []) out.push({ source: "spotify-link", mbid: rec.id, title: rec.title || "", artist: mbArtist(rec), names: artistNames(mbArtist(rec)), isrc: cleanIsrc(i), cover: rid ? `https://coverartarchive.org/release/${rid}/front-250` : "", album: rec.releases?.[0]?.title || "", duration: Math.round((rec.length || 0) / 1000), link: `https://musicbrainz.org/recording/${rec.id}` });
  }
  return out;
}

// 2. Deezer's search: artist + title, then the title alone (a song filed under another first artist)
async function viaDeezerSearch(want, o) {
  const first = String(want.artist || "").split(SPLIT)[0].replace(/[^\p{L}\p{N}!\s]/gu, " ").trim();
  const qs = [...new Set([first && `artist:"${first}" track:"${want.t.core}"`, first && `${first} ${want.t.core}`, want.t.core, want.t.bare !== want.t.core && want.t.bare].filter(Boolean))];
  const out = [];
  for (const q of qs) {
    const r = await deezer(`/search/track?q=${encodeURIComponent(q)}&limit=25`, o);
    out.push(...(r?.data || []).map((t) => fromDeezer(t, "deezer")));
    if (out.some((c) => fit(want, c) === "exact")) return out;
  }
  // the search names only the first artist: a same-title track filed under someone else may still
  // credit ours (its contributors, on /track/{id}). The first few are read.
  const seen = new Set();
  const others = out.filter((c) => !fit(want, c) && fit({ ...want, names: [] }, c) && !seen.has(c.deezerId) && seen.add(c.deezerId)).slice(0, 3);
  for (const c of others) Object.assign(c, await withIsrc(c, o, true));
  return out;
}

// 3. the artist's own Deezer tracks: their top tracks, then their albums' tracks
async function viaDeezerArtist(want, o) {
  const out = [];
  for (const name of String(want.artist || "").split(SPLIT).map((s) => s.trim()).filter(Boolean).slice(0, 3)) {
    const r = await deezer(`/search/artist?q=${encodeURIComponent(name)}&limit=10`, o);
    const artist = (r?.data || []).find((a) => personKey(a.name) === personKey(name));
    if (!artist) continue;
    const top = await deezer(`/artist/${artist.id}/top?limit=100`, o);
    // (a track on their own page or album credits them, whoever the list names first)
    const theirs = (t) => { const c = fromDeezer(t, "deezer-artist"); c.names = [...new Set([...c.names, personKey(artist.name)])]; return c; };
    out.push(...(top?.data || []).map(theirs));
    if (out.some((c) => fit(want, c) === "exact")) return out;
    const albums = await deezer(`/artist/${artist.id}/albums?limit=50`, o);
    // the albums whose title is the song's come first (a single), then the rest, newest first
    const list = [...(albums?.data || [])].sort((a, b) => (titleParts(b.title).core === want.t.core) - (titleParts(a.title).core === want.t.core) || String(b.release_date || "").localeCompare(String(a.release_date || "")));
    for (const al of list.slice(0, 8)) {
      const tr = await deezer(`/album/${al.id}/tracks?limit=100`, o);
      out.push(...(tr?.data || []).map((t) => theirs({ ...t, album: { title: al.title, cover_medium: al.cover_medium } })));
      if (out.some((c) => fit(want, c) === "exact")) return out;
    }
  }
  return out;
}

// 4. MusicBrainz: the recording search, then each likely recording's own ISRCs (inc=isrcs)
const mbArtist = (r) => (r["artist-credit"] || []).map((a) => a.name || a.artist?.name).filter(Boolean).join(", ");
async function viaMusicBrainz(want, o) {
  const linked = await viaMusicBrainzLink(want, o);
  if (linked.some((c) => fit(want, c) === "exact")) return linked;
  const esc = (s) => String(s).replace(/(["\\])/g, "\\$1");
  const first = String(want.artist || "").split(SPLIT)[0].trim();
  const query = `recording:"${esc(want.t.core)}"${first ? ` AND artist:"${esc(first)}"` : ""}`;
  const r = await getJson("musicbrainz", `${MB}/recording?query=${encodeURIComponent(query)}&fmt=json&limit=10`, o);
  const out = [...linked];
  for (const rec of r?.recordings || []) {
    const c = { source: "musicbrainz", mbid: rec.id, title: rec.title || "", artist: mbArtist(rec), names: artistNames(mbArtist(rec)), isrc: "", cover: "", album: rec.releases?.[0]?.title || "", duration: Math.round((rec.length || 0) / 1000), link: `https://musicbrainz.org/recording/${rec.id}` };
    if (!fit(want, c)) continue;
    const isrcs = rec.isrcs?.length ? rec.isrcs : (await getJson("musicbrainz", `${MB}/recording/${rec.id}?inc=isrcs+releases&fmt=json`, o))?.isrcs || [];
    const rel = rec.releases?.[0]?.id;
    for (const i of isrcs) out.push({ ...c, isrc: cleanIsrc(i), cover: rel ? `https://coverartarchive.org/release/${rel}/front-250` : "" });
    if (out.length >= 6) break;
  }
  return out;
}

const STEPS = [["spotify", viaSpotifySearch], ["spotify-link", viaSpotifyLink], ["deezer", viaDeezerSearch], ["deezer-artist", viaDeezerArtist], ["musicbrainz", viaMusicBrainz]];

// One song: { song, artist, link } -> { hit, candidates, tried, errors }. hit = { isrc, source, title,
// artist, cover, deezerId|mbid } when sure, else null; candidates = up to 3 for staff to pick from (each
// with an ISRC). A service that's down or busy is skipped (errors names it); when every one failed,
// `failed` is true so the caller can try again later instead of saving "not found".
// o: { fetch, wait, onResponse } for tests, all: true runs every step (the live test's report).
export async function lookupIsrc({ song, artist, link } = {}, o = {}) {
  const want = { t: titleParts(song), names: artistNames(artist), artist, link, song };
  const out = { hit: null, candidates: [], tried: [], errors: [], bySource: {} };
  if (!want.t.core) return out;
  const pool = [];
  for (const [name, step] of STEPS) {
    if (name === "spotify-link" && !spotifyTrack(link)) continue;
    if (name === "spotify" && !spotifyOn(o)) continue;
    out.tried.push(name);
    let found = [];
    try { found = await step(want, o); } catch (err) { out.errors.push({ source: name, message: err.message, busy: !!err.busy }); continue; }
    // (r11: Spotify's copy of the song's own link is the song, whatever its title says)
    const own = found.find((c) => c.own && ISRC_RE.test(c.isrc));
    const fits = found.map((c) => ({ ...c, fit: c === own ? "exact" : fit(want, c) })).filter((c) => c.fit);
    const sure = own || await sureOf(fits.filter((c) => c.fit === "exact"), o);
    if (o.all) out.bySource[name] = { sure: sure ? brief(sure) : null, fits: fits.length };
    if (sure && !out.hit) { out.hit = brief(sure); if (!o.all) return out; }
    pool.push(...fits);
  }
  if (out.hit) return out;
  // nothing sure: the best few, each with an ISRC (one per ISRC), closest fit first
  const seen = new Set();
  for (const c of pool.sort((a, b) => RANK[a.fit] - RANK[b.fit])) {
    if (out.candidates.length >= 3) break;
    let x = c;
    try { x = await withIsrc(c, o); } catch { continue; }
    if (!ISRC_RE.test(x.isrc) || seen.has(x.isrc)) continue;
    seen.add(x.isrc);
    out.candidates.push({ ...brief(x), fit: c.fit });
  }
  out.failed = out.tried.length > 0 && out.errors.length === out.tried.length;
  // r11 prove: Spotify (the main source) didn't answer and nothing turned up anywhere else, so "not found" isn't
  // known yet. The callers save nothing and try again later (a single Spotify hiccup used to mark every song looked
  // up during its 10-minute rest as checked and not found: 112 of the 136 in the preview's run).
  out.retry = !out.failed && !out.candidates.length && out.errors.some((e) => e.source === "spotify");
  return out;
}
const brief = (c) => ({ isrc: c.isrc, source: c.source, title: c.title, artist: c.artist, cover: c.cover || "", album: c.album || "", link: c.link || "", ...(c.releaseDate ? { releaseDate: c.releaseDate } : {}), ...(c.spotifyId ? { spotifyId: c.spotifyId } : {}), ...(c.deezerId ? { deezerId: c.deezerId } : {}), ...(c.mbid ? { mbid: c.mbid } : {}) });

// The exact fits of one step are one song when they share an ISRC, or are the same recording filed
// twice (single + album: the same length within 2 s; the explicit one is kept). Else not sure.
async function sureOf(exact, o) {
  if (!exact.length) return null;
  const full = [];
  for (const c of exact.slice(0, 4)) { const x = await withIsrc(c, o); if (ISRC_RE.test(x.isrc)) full.push(x); }
  const isrcs = [...new Set(full.map((c) => c.isrc))];
  if (isrcs.length === 1) return full[0];
  if (full.length > 1 && full.every((c) => c.duration && Math.abs(c.duration - full[0].duration) <= 2)) return full.find((c) => c.explicit) || full[0];
  return null;
}

// The old answer shape (only a sure hit): { isrc, deezerId, title, artist, match, source } or null
export async function findIsrc(args, o = {}) {
  const r = await lookupIsrc(args, o);
  if (r.failed) throw new Error(r.errors[0]?.message || "The ISRC lookup failed");
  return r.hit ? { ...r.hit, match: "exact" } : null;
}

// tests only: forget the pacing and song.link's "closed" answer between cases
export function resetIsrcState() { songlinkClosed = false; for (const x of [last, restUntil]) for (const k of Object.keys(x)) delete x[k]; }
