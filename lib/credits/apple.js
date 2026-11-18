// A song's credits from Apple Music, the most accurate free source (the owner's research, 2026-11-17: the right producer on 8 of 10 real placements). Spotify's
// API lists only performing artists; Apple Music's public song page (music.apple.com/us/song/<id>, its JSON in <script id="serialized-server-data">) lists the
// distributor's credits with their roles. The way to the page:
//   1. Apple's free iTunes Search API finds the song by its cleaned title and first artist; the pick is the song whose title, artist and length (within 2 seconds)
//      are Spotify's. 2. When Spotify's ISRC is known, Deezer's record of that ISRC (api.deezer.com/track/isrc:<ISRC>) has to agree with the pick: an Apple song
//      that doesn't fit the recording the ISRC names is a different song. 3. The page is fetched once, and read.
// Polite and small: at most one Apple page a second and 60 a day (lib/credits/scan.js caps them), a generic browser User-Agent, and Apple is
// left alone for the rest of the day on a 403, a 429 or a page that isn't the shape it was (the reason is kept). The owner accepted Apple's site terms for the
// accuracy. Nothing is written anywhere from here. Server-only.
import { titleParts, artistNames, fit } from "../isrc";
import { clean } from "./http";
import { isCredit } from "./match";

export const APPLE_PAGES_PER_DAY = 60;
export const PAGE_GAP_MS = 1000;      // one Apple page a second
export const ITUNES_GAP_MS = 1500;    // the Search API's own guidance is about 20 calls a minute: this is 40
export const DEEZER_GAP_MS = 120;     // Deezer allows 50 calls per 5 seconds (lib/isrc.js)
export const LENGTH_SLOP_S = 2;       // two recordings are the same song when their lengths are within this many seconds
// a generic browser's, the one the research's pages were read with
export const APPLE_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

// "PT3M43S" -> 223
export const isoSeconds = (s) => {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(String(s || "").trim());
  return m ? (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0) : 0;
};

// ---- the page
// -> { ok: true, title, artists, releaseDate, durationSec, credits: [{ name, roles }] }, or { ok: false, why }: the page isn't the shape this reads, which is how
// a changed page or a block shows up. A song page that lists only its performers is fine (its credits haven't arrived): credits is then what is there.
export function parseApplePage(html) {
  const m = /<script type="application\/json" id="serialized-server-data">([\s\S]*?)<\/script>/.exec(String(html || ""));
  if (!m) return { ok: false, why: "no serialized-server-data on the page" };
  let data;
  try { data = JSON.parse(m[1]); } catch { return { ok: false, why: "the page's data isn't JSON" }; }
  const sections = data?.data?.[0]?.data?.sections;
  if (!Array.isArray(sections)) return { ok: false, why: "the page's data has no sections" };
  const head = sections.find((s) => s?.itemKind === "songDetailHeader" || s?.id === "songDetail")?.items?.[0];
  if (!head || typeof head.title !== "string" || !head.title.trim()) return { ok: false, why: "the page has no song header" };
  // every credit, wherever the page files it: an object with a name and its roles (the research read them the same way)
  const credits = [];
  const walk = (o) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o.roleNames) && typeof o.name === "string" && o.name.trim()) {
      const roles = o.roleNames.filter((r) => typeof r === "string" && r.trim()).map((r) => r.trim());
      if (roles.length) credits.push({ name: o.name.trim(), roles });
    }
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
  };
  sections.forEach(walk);
  const length = /property="music:song:duration"[^>]*content="([^"]+)"/i.exec(html)?.[1] || /"timeRequired":"(PT[^"]+)"/.exec(html)?.[1] || "";
  return { ok: true, title: head.title.trim(), artists: String(head.artists || ""), releaseDate: String(head.releaseDate || ""), durationSec: isoSeconds(length), credits };
}

// ---- finding the song
// the iTunes Search API's songs for a track (title cleaned of tags and "feat.", with its first artist): { results } | { stop } (403 / 429: Apple is left alone today) | { error }
export async function searchApple(track, ctx) {
  const first = String(track.artist || "").split(",")[0].trim();
  const term = `${titleParts(track.name).core} ${first}`.trim();
  const r = await ctx.get(`https://itunes.apple.com/search?media=music&entity=song&country=us&limit=25&term=${encodeURIComponent(term)}`, { host: "itunes.apple.com", gap: ITUNES_GAP_MS });
  if (r.status === 403 || r.status === 429) return { stop: `iTunes Search answered ${r.status}` };
  if (!r.ok) return { error: `iTunes Search answered ${r.status}` };
  return { results: (Array.isArray(r.body?.results) ? r.body.results : []).filter((x) => x && x.trackId && (!x.kind || x.kind === "song")) };
}

// Deezer's record of an ISRC: { title, duration (seconds), id } | { none: true } (Deezer has no such recording) | { error }
export async function deezerByIsrc(isrc, ctx) {
  const r = await ctx.get(`https://api.deezer.com/track/isrc:${encodeURIComponent(isrc)}`, { host: "api.deezer.com", gap: DEEZER_GAP_MS });
  if (r.status === 404) return { none: true };
  if (!r.ok) return { error: `Deezer answered ${r.status}` };
  const e = r.body?.error;
  if (e) return e.code === 800 || /DataException/i.test(e.type || "") ? { none: true } : { error: "Deezer is busy" }; // 800 is "no data"; a quota error is "try later"
  if (!r.body?.title) return { none: true };
  return { title: String(r.body.title), duration: Number(r.body.duration) || 0, id: r.body.id };
}

// does an Apple song fit what Deezer says the ISRC is: the same title (tags and "feat." aside, a version has to agree) and a length within the slop
const agrees = (dz, song) => {
  const sec = (Number(song.trackTimeMillis) || 0) / 1000;
  if (dz.duration && sec && Math.abs(dz.duration - sec) > LENGTH_SLOP_S) return false;
  const a = titleParts(dz.title), b = titleParts(song.trackName);
  return a.core === b.core && a.versions === b.versions;
};

// The song among the search's results, or null. Its title is the track's (versions, "feat." and tags as lib/isrc.js fit reads them: another version of the song,
// "Slowed" or "Instrumental", is another recording), one of its artists is the track's, and its length is within 2 seconds of the track's (track.ms). With no length
// on either side only a title that is exactly the track's will do. deezer: Deezer's record of the track's ISRC, when there is one: the pick has to agree with it.
// skip: Apple ids that were the wrong page before. The closest length wins, then the exact title, then the order Apple gave.
export function pickApple(track, results, { deezer = null, skip = [] } = {}) {
  const want = { t: titleParts(track.name), names: artistNames(track.artist) };
  const ms = Number(track.ms) || 0;
  const rows = [];
  (results || []).forEach((song, order) => {
    if (!song?.trackId || skip.includes(String(song.trackId))) return;
    const f = fit(want, { title: song.trackName, names: artistNames(song.artistName) });
    if (f !== "exact" && f !== "loose") return;
    const len = Number(song.trackTimeMillis) || 0;
    const delta = ms && len ? Math.abs(ms - len) / 1000 : null;
    if (delta != null && delta > LENGTH_SLOP_S) return;
    if (delta == null && f !== "exact") return;
    if (deezer && !agrees(deezer, song)) return;
    rows.push({ song, f, delta: delta ?? 99, order });
  });
  rows.sort((a, b) => a.delta - b.delta || (a.f === "exact" ? 0 : 1) - (b.f === "exact" ? 0 : 1) || a.order - b.order);
  return rows[0]?.song || null;
}

// ---- one track's credits from Apple
// t: the track's state (lib/credits/scan.js: name, artist, ms, apple (the page found before), bad); day.apple: today's { pages, stop, errs }; isrc(): the Spotify ISRC
// when it can be had ("" when not). -> { status, ... }:
//   found      { appleId, credits, confirmed }   the page lists credits (someone besides the performers); confirmed: Deezer's record of the ISRC agreed
//   nocredits  { appleId }                        the song's page is there and lists only its performers so far (credits arrive late)
//   notfound   { why }                            no song on Apple Music that is this one (a new release can take a day or two to get there)
//   mismatch   { appleId }                        the page was another song's
//   stopped    { why, budget? }                   Apple is left alone: a 403, a 429, a page that isn't the shape it was, the day's pages used (budget); no try is counted
//   error      { why }                            this one couldn't be read (a network error, a 5xx); no try is counted
export async function appleCredits(t, ctx, day, { isrc = async () => "", pageCap = APPLE_PAGES_PER_DAY } = {}) {
  const A = day.apple;
  if (A.stop) return { status: "stopped", why: A.stop };
  if (A.pages >= pageCap) return { status: "stopped", why: `today's ${pageCap} Apple pages are used`, budget: true };
  let id = t.apple || "", confirmed = false;
  if (!id) {
    let found;
    try { found = await searchApple(t, ctx); } catch (err) { return { status: "error", why: clean(err) }; }
    if (found.stop) { A.stop = found.stop; return { status: "stopped", why: A.stop }; }
    if (found.error) return { status: "error", why: found.error };
    let deezer = null;
    const code = found.results.length ? await isrc() : "";
    if (code) {
      const d = await deezerByIsrc(code, ctx).catch(() => ({ error: "Deezer didn't answer" }));
      if (d.title) deezer = d; // no record, or Deezer down: the pick stands on Spotify's own title, artist and length
    }
    const pick = pickApple(t, found.results, { deezer, skip: t.bad || [] });
    if (!pick) return { status: "notfound", why: deezer ? "no Apple Music song agrees with Deezer's record of that ISRC" : found.results.length ? "no Apple Music song with that title, artist and length" : "Apple Music has no song like it yet" };
    id = String(pick.trackId);
    confirmed = !!deezer;
  }
  A.pages++;
  let page;
  try {
    page = await ctx.get(`https://music.apple.com/us/song/${id}`, { host: "music.apple.com", gap: PAGE_GAP_MS, as: "text", timeout: 20000,
      headers: { "User-Agent": APPLE_UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" } });
  } catch (err) {
    A.errs = (A.errs || 0) + 1;
    if (A.errs >= 3) { A.stop = `3 Apple pages in a row didn't load (${clean(err)})`; return { status: "stopped", why: A.stop }; }
    return { status: "error", why: clean(err) };
  }
  if (page.status === 403 || page.status === 429) { A.stop = `Apple Music answered ${page.status}`; return { status: "stopped", why: A.stop }; }
  if (page.status === 404) return { status: "notfound", why: "that Apple Music page doesn't exist", gone: id };
  if (!page.ok) {
    A.errs = (A.errs || 0) + 1;
    if (A.errs >= 3) { A.stop = `3 Apple pages in a row didn't load (the last answered ${page.status})`; return { status: "stopped", why: A.stop }; }
    return { status: "error", why: `Apple Music answered ${page.status}` };
  }
  A.errs = 0;
  const p = parseApplePage(page.text);
  if (!p.ok) { A.stop = `unexpected page shape: ${p.why}`; return { status: "stopped", why: A.stop }; }
  // the page is the track's: the same title (as loosely as the search's pick was: lib/isrc.js fit), and the same length when both are known
  const a = titleParts(p.title), b = titleParts(t.name);
  const sameTitle = a.versions === b.versions && (a.core === b.core || a.bare === b.bare || a.core === b.bare || a.bare === b.core);
  const lenOk = !p.durationSec || !t.ms || Math.abs(p.durationSec - t.ms / 1000) <= LENGTH_SLOP_S;
  if (!sameTitle || !lenOk) return { status: "mismatch", appleId: id };
  return p.credits.some((c) => isCredit(c.roles)) ? { status: "found", appleId: id, credits: p.credits, confirmed } : { status: "nocredits", appleId: id };
}
