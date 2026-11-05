// List B #6, the TikTok sound radar. Server only. "Biggest growing sounds" in the genres we track:
//   keywords   an editable list (radar_keywords: keyword + genre). Each scan searches TikTok's sounds for
//              them (memo23/tiktok-music-scraper, backup khadinakbar's search) and saves every sound's total
//              video count as a dated snapshot (data_snapshots: s:<clip>, tiktok, videos)
//   seeds      free extras, asked about by clip id (khadinakbar/tiktok-sound-scraper, $0.003 a sound): the
//              sounds on our tracked artists' latest TikTok videos (read from the engine's TikTok runs, no
//              extra cost), sounds pasted in by hand, and our own (asked every day)
//   ranking    new videos + % growth since the last count (half each, as ranks); a sound that stopped
//              growing drops off. The top risers are asked every day until they cool off: a boost with an
//              end date (boost_until), renewed at each scan while they're still in the top, like a tracker
//   budget     its own monthly cap (data_settings "radar", default $6) inside the engine's total cap and
//              the Apify account's hard limit; nothing starts without DATA_REFRESH=on
// Runs go through the engine's data_runs (source "radar" / "radar_sounds"), so the cron and Apify's
// webhook collect them like the other sources (lib/data/engine.js finishRun hands them to readRadarRun).
import crypto from "node:crypto";
import { dataSql as sql, refreshOn, loadSettings, saveSetting, monthSpend } from "../data/engine";
import { rowsOrNoneIfNoTable } from "../db";
import { ADAPTERS, soundId } from "../data/sources";
import * as D from "../data/direct";
import { uid } from "../id";

export const TOKCHART_URL = "https://tokchart.com/";
export const RADAR_SOURCES = ["radar", "radar_sounds"];
export const RADAR_DEFAULTS = { capUsd: 6, perKeyword: 20, everyDays: 7, risers: 5, boostDays: 7, adapter: "memo23" };
const DAY = 864e5, HOUR = 36e5;
const iso = (t) => new Date(t).toISOString();
const ms = (t) => (t == null ? null : typeof t === "number" ? t : new Date(t).getTime());
const arr = (v) => (Array.isArray(v) ? v : typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []);
const num = (v) => { if (v == null || v === "") return null; const n = Number(String(v).replace(/[, ]/g, "")); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null; };
const newRunId = () => `r${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;

// keyword search, one shape: input(keywords, perKeyword), parse(items) -> [{ clip, title, author, cover, url, videos, keyword, approx }]
// (samples: S/r8/step0-tech.json apify.needs.tiktokSoundSearchByKeyword, real runs of 2026-11-04)
export const RADAR_ADAPTERS = {
  // the best ranking (big sounds first), with videoCount. On Apify's Free plan rows after the third have
  // some fields hidden or rounded (freePlanNote): those counts are marked "about"
  memo23: {
    actor: "memo23/tiktok-music-scraper", price: { start: 0.005, per: 0.002 },
    input: (keywords, per) => ({ keywords, maxSoundsPerKeyword: per, downloadAudio: false, includeVideos: false, region: "US" }),
    parse: (items) => items.filter((i) => i && (i.rowType || "sound") === "sound" && /^\d{10,22}$/.test(String(i.soundId || ""))).map((i) => ({
      clip: String(i.soundId), title: i.soundTitle || "", author: i.soundAuthor || "", cover: i.coverUrl || "", url: i.soundUrl || `https://www.tiktok.com/music/x-${i.soundId}`,
      videos: num(i.videoCount), keyword: String(i.keyword || ""), approx: !!i.freePlanNote })),
  },
  // backup: the same actor that counts our sounds, in search mode (exact userCount)
  "khadinakbar-search": {
    actor: "khadinakbar/tiktok-sound-scraper", price: { start: 0.00005, per: 0.003 },
    input: (keywords, per) => ({ searchQueries: keywords, outputMode: "sounds", maxSounds: keywords.length * per, maxSearchResultsPerQuery: per, maxVideosPerSound: 1, maxPagesPerSound: 1, region: "US" }),
    parse: (items) => items.filter((i) => i && (i.recordType || "sound") === "sound" && /^\d{10,22}$/.test(String(i.clipId || ""))).map((i) => ({
      clip: String(i.clipId), title: i.title || "", author: i.author || "", cover: i.coverUrl || "", url: i.soundUrl || `https://www.tiktok.com/music/x-${i.clipId}`,
      videos: num(i.userCount), keyword: String(i.searchQuery || i.inputValue || ""), approx: false })),
  },
};
const SOUND_ADAPTER = "khadinakbar"; // lib/data/sources.js: a sound's exact count by its link
export const radarEst = (adapter, units) => { const p = (RADAR_ADAPTERS[adapter] || ADAPTERS[adapter]).price; return units > 0 ? p.start + p.per * units : 0; };
const capOf = (adapter, units) => Math.round((radarEst(adapter, units) * 1.5 + 0.01) * 1000) / 1000;

export async function radarSettings() {
  const rows = await rowsOrNoneIfNoTable(sql`SELECT value FROM data_settings WHERE key = 'radar'`);
  let v = rows[0]?.value;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = {}; } }
  if (!v || typeof v !== "object") v = {};
  const n = (k, lo, hi) => (Number.isFinite(Number(v[k])) && v[k] !== "" && v[k] != null ? Math.min(hi, Math.max(lo, Number(v[k]))) : RADAR_DEFAULTS[k]);
  return { capUsd: n("capUsd", 0, 19), perKeyword: Math.round(n("perKeyword", 5, 50)), everyDays: Math.round(n("everyDays", 1, 30)), risers: Math.round(n("risers", 0, 20)), boostDays: Math.round(n("boostDays", 1, 30)),
    adapter: RADAR_ADAPTERS[v.adapter] ? v.adapter : RADAR_DEFAULTS.adapter };
}
export async function saveRadarSettings(patch) {
  const cur = await radarSettings();
  const next = { ...cur };
  if (patch.capUsd != null && patch.capUsd !== "") { const c = Number(patch.capUsd); if (!(c >= 0 && c <= 19)) throw Object.assign(new Error("The radar's budget is $0 to $19 a month."), { status: 400 }); next.capUsd = c; }
  if (patch.adapter != null) { if (!RADAR_ADAPTERS[patch.adapter]) throw Object.assign(new Error("Unknown scraper."), { status: 400 }); next.adapter = patch.adapter; }
  await saveSetting("radar", next);
  return next;
}
export const radarSpent = (spent) => RADAR_SOURCES.reduce((a, k) => a + (spent[k] || 0), 0);

// ---------------------------------------------------------------- pure: the ranking
// series: [[t, value, approx]] oldest first. The last count against the one before it (a different scan).
export function growthOf(series) {
  if (!series.length) return null;
  const [t1, v1, a1] = series[series.length - 1];
  const prev = [...series].reverse().find(([t]) => ms(t1) - ms(t) >= HOUR / 2);
  if (!prev) return { videos: v1, approx: !!a1, at: t1, first: true };
  const [t0, v0, a0] = prev;
  const newVideos = v1 - v0;
  return { videos: v1, approx: !!(a1 || a0), at: t1, since: t0, newVideos, pct: v0 > 0 ? newVideos / v0 : null, growing: newVideos > 0 };
}
// rank = half the rank by new videos, half the rank by % growth, among the growing sounds
export function rankSounds(list) {
  const grow = list.filter((s) => s.g?.growing);
  const pr = (key) => { const sorted = [...grow].sort((a, b) => (a.g[key] ?? 0) - (b.g[key] ?? 0)); const m = new Map(); sorted.forEach((s, i) => m.set(s.clip, grow.length > 1 ? i / (grow.length - 1) : 1)); return m; };
  const byNew = pr("newVideos"), byPct = pr("pct");
  for (const s of grow) s.rank = Math.round((0.5 * byNew.get(s.clip) + 0.5 * byPct.get(s.clip)) * 1000) / 1000;
  return grow.sort((a, b) => b.rank - a.rank || b.g.newVideos - a.g.newVideos);
}

// ---------------------------------------------------------------- reads
async function soundsWithSeries({ includeHidden = false } = {}) {
  const [sounds, snaps, keywords] = await Promise.all([
    rowsOrNoneIfNoTable(sql`SELECT * FROM radar_sounds`),
    rowsOrNoneIfNoTable(sql`SELECT entity_id, value, taken_at, approx FROM data_snapshots WHERE entity_id LIKE 's:%' AND platform = 'tiktok' AND metric = 'videos' ORDER BY taken_at`),
    rowsOrNoneIfNoTable(sql`SELECT id, keyword, genre, active, last_scan_at FROM radar_keywords ORDER BY lower(genre), lower(keyword)`),
  ]);
  const by = new Map();
  for (const s of snaps) { const k = s.entity_id.slice(2); if (!by.has(k)) by.set(k, []); by.get(k).push([iso(s.taken_at), Number(s.value), !!s.approx]); }
  const list = sounds.filter((s) => includeHidden || !s.hidden_at).map((s) => ({ clip: s.clip_id, title: s.title, author: s.author, cover: s.cover, url: s.url || `https://www.tiktok.com/music/x-${s.clip_id}`,
    genres: arr(s.genres), seeds: arr(s.seeds), own: !!s.own, fromEntity: s.from_entity || null, boostUntil: s.boost_until ? iso(s.boost_until) : null, firstSeen: iso(s.first_seen),
    lastSeen: s.last_seen ? iso(s.last_seen) : null, hidden: !!s.hidden_at, series: by.get(s.clip_id) || [] }));
  for (const s of list) s.g = growthOf(s.series);
  return { list, keywords };
}
// topRisingSounds({ n, genre }) -> [{ id, title, artist, newVideos, pct (a percent, 12.5 = +12.5%), url, ... }], the radar's main list
export async function topRisingSounds({ n = 20, genre = "" } = {}) {
  const { list } = await soundsWithSeries();
  const g = String(genre || "").toLowerCase();
  return rankSounds(list.filter((s) => !g || s.genres.some((x) => x.toLowerCase() === g)))
    .slice(0, n).map((s) => ({ id: s.clip, title: s.title, artist: s.author, newVideos: s.g.newVideos, pct: s.g.pct == null ? null : Math.round(s.g.pct * 1000) / 10, url: s.url, cover: s.cover, videos: s.g.videos, approx: s.g.approx,
      since: s.g.since, at: s.g.at, genres: s.genres, seeds: s.seeds, own: s.own, boosted: !!(s.boostUntil && ms(s.boostUntil) > Date.now()), rank: s.rank }));
}
// the page: the ranked risers, the sounds seen once so far, how many stopped, keywords, cost, what's due
export async function radarPage({ now = Date.now(), genre = "" } = {}) {
  const [{ list, keywords }, settings, spent, runs, tracked] = await Promise.all([
    soundsWithSeries(), radarSettings(), monthSpend(new Date(now)),
    rowsOrNoneIfNoTable(sql`SELECT id, source, adapter, status, items, snapshots, est_usd, usd, error, started_at, finished_at FROM data_runs WHERE source = ANY(${RADAR_SOURCES}) ORDER BY started_at DESC LIMIT 6`),
    rowsOrNoneIfNoTable(sql`SELECT subject, owner_name FROM ar_tracker WHERE removed_at IS NULL AND subject LIKE 's:%'`),
  ]);
  const g = String(genre || "").toLowerCase();
  const inGenre = list.filter((s) => !g || s.genres.some((x) => x.toLowerCase() === g));
  const onTracker = new Map();
  for (const t of tracked) { const k = t.subject.slice(2); onTracker.set(k, [...(onTracker.get(k) || []), t.owner_name]); }
  const out = (s) => ({ id: s.clip, title: s.title, artist: s.author, cover: s.cover, url: s.url, genres: s.genres, seeds: s.seeds, own: s.own,
    videos: s.g?.videos ?? null, approx: !!s.g?.approx, newVideos: s.g?.newVideos ?? null, pct: s.g?.pct ?? null, since: s.g?.since || null, at: s.g?.at || null,
    boosted: !!(s.boostUntil && ms(s.boostUntil) > ms(now)), boostUntil: s.boostUntil, rank: s.rank ?? null, trackedBy: onTracker.get(s.clip) || [] });
  const rising = rankSounds(inGenre).map(out);
  const firstSeen = inGenre.filter((s) => s.g?.first).sort((a, b) => (b.g.videos || 0) - (a.g.videos || 0)).map(out);
  const waiting = inGenre.filter((s) => !s.g).map(out); // pasted or seeded, not counted yet
  const stopped = inGenre.filter((s) => s.g && !s.g.first && !s.g.growing).length;
  const genres = [...new Set([...keywords.filter((k) => k.active).map((k) => k.genre || k.keyword), ...list.flatMap((s) => s.genres)])].filter(Boolean).sort((a, b) => a.localeCompare(b));
  const used = radarSpent(spent);
  return { rising, firstSeen, waiting, stopped, genres, tokchart: TOKCHART_URL,
    keywords: keywords.map((k) => ({ id: k.id, keyword: k.keyword, genre: k.genre, active: k.active, lastScanAt: k.last_scan_at ? iso(k.last_scan_at) : null })),
    own: list.filter((s) => s.own).map(out),
    cost: { spentUsd: Math.round(used * 10000) / 10000, capUsd: settings.capUsd, scanUsd: Math.round(radarEst(settings.adapter, keywords.filter((k) => k.active).length * settings.perKeyword) * 10000) / 10000, adapter: settings.adapter, perKeyword: settings.perKeyword },
    runs: runs.map((r) => ({ id: r.id, source: r.source, status: r.status, items: r.items, usd: r.usd != null ? Number(r.usd) : Number(r.est_usd), error: r.error, startedAt: iso(r.started_at), finishedAt: r.finished_at ? iso(r.finished_at) : null })),
    refresh: refreshOn() ? "on" : "off", lastScanAt: keywords.map((k) => k.last_scan_at).filter(Boolean).map(ms).sort((a, b) => b - a)[0] ? iso(keywords.map((k) => k.last_scan_at).filter(Boolean).map(ms).sort((a, b) => b - a)[0]) : null };
}

// ---------------------------------------------------------------- keywords, seeds, ours
export async function addKeyword({ keyword, genre = "", by = "" }) {
  const k = String(keyword || "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (k.length < 2) throw Object.assign(new Error("Type a genre keyword (e.g. jersey club)."), { status: 400 });
  const g = String(genre || "").trim().slice(0, 40);
  const id = uid();
  const r = await sql`INSERT INTO radar_keywords (id, keyword, genre, created_by) VALUES (${id}, ${k}, ${g || k}, ${by}) ON CONFLICT (lower(keyword)) DO UPDATE SET active = true, genre = CASE WHEN ${g} <> '' THEN ${g} ELSE radar_keywords.genre END RETURNING id`;
  return { ok: true, id: r[0]?.id || id };
}
export async function editKeyword({ id, genre, active }) {
  const [k] = await sql`SELECT id FROM radar_keywords WHERE id = ${String(id || "")}`;
  if (!k) throw Object.assign(new Error("That keyword was removed."), { status: 404 });
  if (genre != null) await sql`UPDATE radar_keywords SET genre = ${String(genre).trim().slice(0, 40)} WHERE id = ${k.id}`;
  if (active != null) await sql`UPDATE radar_keywords SET active = ${!!active} WHERE id = ${k.id}`;
  return { ok: true };
}
export async function removeKeyword({ id }) { await sql`DELETE FROM radar_keywords WHERE id = ${String(id || "")}`; return { ok: true }; }
// a pasted sound link (e.g. one spotted on Tokchart), or one of ours
export async function addRadarSound({ url, own = false, by = "" }) {
  const clip = soundId(url);
  if (!clip) throw Object.assign(new Error("Paste a TikTok sound link (tiktok.com/music/…)."), { status: 400 });
  const link = /^https:\/\/(www\.)?tiktok\.com\/music\//.test(String(url || "").trim()) ? String(url).trim().slice(0, 300) : `https://www.tiktok.com/music/x-${clip}`;
  const seed = own ? "own" : "manual";
  await sql`INSERT INTO radar_sounds (clip_id, url, seeds, own, added_by) VALUES (${clip}, ${link}, ${JSON.stringify([seed])}::jsonb, ${!!own}, ${by})
    ON CONFLICT (clip_id) DO UPDATE SET hidden_at = NULL, own = radar_sounds.own OR EXCLUDED.own,
      seeds = CASE WHEN radar_sounds.seeds @> ${JSON.stringify([seed])}::jsonb THEN radar_sounds.seeds ELSE radar_sounds.seeds || ${JSON.stringify([seed])}::jsonb END`;
  return { ok: true, id: clip };
}
export async function setOwn({ id, own }) {
  const r = await sql`UPDATE radar_sounds SET own = ${!!own}, seeds = CASE WHEN ${!!own} AND NOT (seeds @> '["own"]'::jsonb) THEN seeds || '["own"]'::jsonb ELSE seeds END WHERE clip_id = ${String(id || "")} RETURNING clip_id`;
  if (!r.length) throw Object.assign(new Error("No such sound."), { status: 404 });
  return { ok: true };
}
export async function hideSound({ id, hidden = true }) {
  await sql`UPDATE radar_sounds SET hidden_at = ${hidden ? iso(Date.now()) : null} WHERE clip_id = ${String(id || "")}`;
  return { ok: true };
}
// the free seed: the sound on each of our tracked artists' latest TikTok videos, from the items of the
// engine's TikTok follower run (clockworks: musicMeta; apidojo: song). Nothing is asked for it.
export async function seedFromProfiles(items, targets) {
  const byRef = new Map((targets || []).map((t) => [String(t.ref).toLowerCase(), t.entityId]));
  const found = new Map();
  for (const i of items || []) {
    const m = i?.musicMeta ? { clip: i.musicMeta.musicId, title: i.musicMeta.musicName, author: i.musicMeta.musicAuthor, cover: i.musicMeta.coverMediumUrl, who: i.authorMeta?.name || i.input }
      : i?.song ? { clip: i.song.id, title: i.song.title, author: i.song.artist, cover: i.song.cover, who: i.channel?.username || i.inputSource } : null;
    if (!m || !/^\d{10,22}$/.test(String(m.clip || ""))) continue;
    const ent = byRef.get(String(m.who || "").toLowerCase());
    if (!ent || found.has(String(m.clip))) continue;
    found.set(String(m.clip), { ...m, clip: String(m.clip), ent });
  }
  for (const s of found.values()) {
    await sql`INSERT INTO radar_sounds (clip_id, title, author, cover, url, seeds, from_entity) VALUES (${s.clip}, ${String(s.title || "").slice(0, 200)}, ${String(s.author || "").slice(0, 200)}, ${String(s.cover || "").slice(0, 500)}, ${`https://www.tiktok.com/music/x-${s.clip}`}, '["artist"]'::jsonb, ${s.ent})
      ON CONFLICT (clip_id) DO UPDATE SET from_entity = COALESCE(radar_sounds.from_entity, EXCLUDED.from_entity),
        seeds = CASE WHEN radar_sounds.seeds @> '["artist"]'::jsonb THEN radar_sounds.seeds ELSE radar_sounds.seeds || '["artist"]'::jsonb END`;
  }
  return { seeded: found.size };
}

// ---------------------------------------------------------------- the scans
// what a scan would ask now: the keywords not scanned for `everyDays`, and the seed sounds that are due
// (ours and the boosted risers every day, the others with the keywords' rhythm)
export function planRadar({ keywords, sounds, settings, now = Date.now(), force = false }) {
  const t = ms(now), slack = 3 * HOUR;
  const kw = keywords.filter((k) => k.active && (force || !k.last_scan_at || t - ms(k.last_scan_at) >= settings.everyDays * DAY - slack));
  const due = sounds.filter((s) => !s.hidden_at).filter((s) => {
    const seeds = arr(s.seeds), boosted = s.boost_until && ms(s.boost_until) > t, daily = s.own || boosted;
    if (!daily && !seeds.some((x) => x === "artist" || x === "manual")) return false;
    const last = Math.max(ms(s.last_checked) || 0, ms(s.last_seen) || 0);
    return force || !last || t - last >= (daily ? 1 : settings.everyDays) * DAY - slack;
  }).sort((a, b) => Number(!!b.own) - Number(!!a.own) || (ms(a.last_checked) || 0) - (ms(b.last_checked) || 0));
  return { keywords: kw, sounds: due };
}
async function runRow(r) {
  await sql`INSERT INTO data_runs (id, source, adapter, actor, apify_run_id, dataset_id, status, targets, est_usd, error, started_at, finished_at)
    VALUES (${r.id}, ${r.source}, ${r.adapter}, ${r.actor}, ${r.apifyRunId || null}, ${r.datasetId || null}, ${r.status}, ${JSON.stringify(r.targets || [])}::jsonb, ${r.estUsd || 0}, ${r.error || ""}, ${iso(r.startedAt)}, ${r.finishedAt ? iso(r.finishedAt) : null})`;
}
// startRadarScan({ force }) -> { started: [...] }: one keyword run and one seed-sound run at most, each
// inside the radar's budget, the engine's total and the Apify account's limit (read first, or nothing starts)
// r10: the keyword radar is parked (the owner: "add tiktok sounds to be tracked individually"). Its tables and code
// stay, idle: no keyword scans and no risers' daily boost unless RADAR_SCANS=on (default OFF; never set in the preview).
export const radarOn = () => /^on$/i.test(String(process.env.RADAR_SCANS || "").trim());
export async function startRadarScan({ now = Date.now(), force = false, onlyKeywords = null, maxSounds = null } = {}) {
  if (!radarOn()) return { parked: true };
  if (!refreshOn()) return { off: true };
  if (!D.apifyConfigured()) return { noKey: true };
  const [keywords, sounds, settings, all, open] = await Promise.all([
    sql`SELECT * FROM radar_keywords ORDER BY created_at, id`, sql`SELECT * FROM radar_sounds`, radarSettings(), loadSettings(),
    sql`SELECT source FROM data_runs WHERE source = ANY(${RADAR_SOURCES}) AND status IN ('started', 'collecting')`,
  ]);
  const plan = planRadar({ keywords: onlyKeywords ? keywords.filter((k) => onlyKeywords.includes(k.keyword)) : keywords, sounds, settings, now, force });
  if (maxSounds != null) plan.sounds = plan.sounds.slice(0, maxSounds);
  if (!plan.keywords.length && !plan.sounds.length) return { started: [], nothingDue: true };
  const spent = await monthSpend(new Date(now));
  let account;
  try { account = await D.apifyLimits(); await saveSetting("apify_account", { ...account, at: iso(now) }); }
  catch (err) { return { started: [], error: `Couldn't read the Apify account's limit, so nothing was started (${err.message}).` }; }
  const left = () => Math.min(settings.capUsd - radarSpent(spent), all.totalCapUsd - spent.total);
  const busy = new Set(open.map((r) => r.source));
  const out = [];
  const go = async (source, adapter, actor, input, targets, est, cap) => {
    if (busy.has(source)) return out.push({ source, waiting: true });
    if (account.limitUsd - account.usageUsd < cap) return out.push({ source, skipped: `Apify's monthly limit is almost reached ($${account.usageUsd.toFixed(2)} of $${account.limitUsd}).` });
    const id = newRunId();
    try {
      const run = await D.apifyStart(actor, input, { capUsd: cap });
      await runRow({ id, source, adapter, actor, apifyRunId: run.id, datasetId: run.defaultDatasetId, status: "started", targets, estUsd: est, startedAt: now });
      account.usageUsd += cap; spent[source] = (spent[source] || 0) + est; spent.total += est;
      out.push({ source, started: targets.length, estUsd: est, capUsd: cap });
    } catch (err) {
      await runRow({ id, source, adapter, actor, status: "failed", error: err.message, startedAt: now, finishedAt: now });
      out.push({ source, error: err.message });
    }
  };
  if (plan.keywords.length) {
    const ad = RADAR_ADAPTERS[settings.adapter];
    const per = ad.price.per * settings.perKeyword;
    const k = Math.min(plan.keywords.length, Math.floor((left() - ad.price.start) / per + 1e-9));
    if (k <= 0) out.push({ source: "radar", skipped: `The radar's budget is used up ($${radarSpent(spent).toFixed(2)} of $${settings.capUsd} this month).` });
    else {
      const batch = plan.keywords.slice(0, k), units = batch.length * settings.perKeyword;
      await go("radar", settings.adapter, ad.actor, ad.input(batch.map((x) => x.keyword), settings.perKeyword), batch.map((x) => ({ keyword: x.keyword, genre: x.genre || x.keyword })), radarEst(settings.adapter, units), capOf(settings.adapter, units));
    }
  }
  if (plan.sounds.length) {
    const ad = ADAPTERS[SOUND_ADAPTER];
    const n = Math.min(plan.sounds.length, 100, Math.floor((left() - ad.price.start) / ad.price.per + 1e-9));
    if (n <= 0) out.push({ source: "radar_sounds", skipped: `The radar's budget is used up ($${radarSpent(spent).toFixed(2)} of $${settings.capUsd} this month).` });
    else {
      const batch = plan.sounds.slice(0, n).map((s) => ({ entityId: `s:${s.clip_id}`, ref: s.clip_id, url: s.url || `https://www.tiktok.com/music/x-${s.clip_id}` }));
      await go("radar_sounds", SOUND_ADAPTER, ad.actor, ad.input(batch), batch.map(({ entityId, ref }) => ({ entityId, ref })), radarEst(SOUND_ADAPTER, n), capOf(SOUND_ADAPTER, n));
    }
  }
  return { started: out };
}
// a finished radar run's items -> radar_sounds + dated snapshots, then the risers' boosts. Called by the
// engine's finishRun (the run is already claimed there, once), and by the real-data script.
export async function readRadarRun(r, items, { takenAt = new Date(), now = Date.now() } = {}) {
  const targets = arr(r.targets);
  const at = iso(takenAt);
  let rows;
  if (r.source === "radar") {
    const genreOf = new Map(targets.map((t) => [String(t.keyword).toLowerCase(), t.genre || t.keyword]));
    const by = new Map();
    for (const s of (RADAR_ADAPTERS[r.adapter] || RADAR_ADAPTERS.memo23).parse(items)) {
      if (s.videos == null) continue;
      const g = genreOf.get(s.keyword.toLowerCase()) || s.keyword;
      const o = by.get(s.clip);
      if (o) { if (g && !o.genres.includes(g)) o.genres.push(g); o.videos = Math.max(o.videos, s.videos); o.approx = o.approx && s.approx; continue; }
      by.set(s.clip, { ...s, genres: g ? [g] : [] });
    }
    rows = [...by.values()];
    for (const s of rows) {
      await sql`INSERT INTO radar_sounds (clip_id, title, author, cover, url, genres, seeds, last_seen) VALUES (${s.clip}, ${s.title.slice(0, 200)}, ${s.author.slice(0, 200)}, ${s.cover.slice(0, 500)}, ${s.url.slice(0, 300)}, ${JSON.stringify(s.genres)}::jsonb, '["keyword"]'::jsonb, ${at})
        ON CONFLICT (clip_id) DO UPDATE SET title = CASE WHEN EXCLUDED.title <> '' THEN EXCLUDED.title ELSE radar_sounds.title END, author = CASE WHEN EXCLUDED.author <> '' THEN EXCLUDED.author ELSE radar_sounds.author END,
          cover = CASE WHEN EXCLUDED.cover <> '' THEN EXCLUDED.cover ELSE radar_sounds.cover END, last_seen = EXCLUDED.last_seen,
          genres = (SELECT COALESCE(jsonb_agg(DISTINCT g), '[]'::jsonb) FROM jsonb_array_elements(radar_sounds.genres || EXCLUDED.genres) g),
          seeds = CASE WHEN radar_sounds.seeds @> '["keyword"]'::jsonb THEN radar_sounds.seeds ELSE radar_sounds.seeds || '["keyword"]'::jsonb END`;
    }
    const kws = targets.map((t) => String(t.keyword).toLowerCase());
    if (kws.length) await sql`UPDATE radar_keywords SET last_scan_at = ${at} WHERE lower(keyword) = ANY(${kws})`;
  } else {
    const want = new Set(targets.map((t) => String(t.ref)));
    rows = ADAPTERS[SOUND_ADAPTER].parse(items).filter((x) => x.metric === "videos" && want.has(x.key)).map((x) => ({ clip: x.key, videos: x.value, approx: !!x.approx, title: x.name || "", author: x.artist || "", cover: x.image || "" }));
    for (const s of rows) await sql`UPDATE radar_sounds SET last_seen = ${at}, title = CASE WHEN title = '' THEN ${s.title.slice(0, 200)} ELSE title END, author = CASE WHEN author = '' THEN ${s.author.slice(0, 200)} ELSE author END, cover = CASE WHEN cover = '' THEN ${s.cover.slice(0, 500)} ELSE cover END WHERE clip_id = ${s.clip}`;
    if (want.size) await sql`UPDATE radar_sounds SET last_checked = ${iso(now)} WHERE clip_id = ANY(${[...want]})`;
  }
  const snaps = rows.map((s) => ({ entity_id: `s:${s.clip}`, value: s.videos, approx: !!s.approx }));
  if (snaps.length) await sql`
    INSERT INTO data_snapshots (entity_id, platform, metric, value, taken_at, source, approx, run_id)
    SELECT x.entity_id, 'tiktok', 'videos', x.value, ${at}, ${r.adapter}, x.approx, ${r.id} FROM jsonb_to_recordset(${JSON.stringify(snaps)}::jsonb) AS x(entity_id text, value bigint, approx boolean)
    ON CONFLICT DO NOTHING`;
  const boosts = radarOn() ? await boostRisers({ now }) : { boosted: 0 };
  return { sounds: rows.length, snapshots: snaps.length, boosted: boosts.boosted };
}
// the top risers are asked every day until boost_until; a scan that still has them in the top renews it.
// One that drops out keeps its date and cools off when it passes.
export async function boostRisers({ now = Date.now() } = {}) {
  const [settings, { list }] = await Promise.all([radarSettings(), soundsWithSeries()]);
  const top = rankSounds(list).slice(0, settings.risers).filter((s) => s.g.newVideos > 0);
  const until = iso(ms(now) + settings.boostDays * DAY);
  if (top.length) await sql`UPDATE radar_sounds SET boost_until = ${until} WHERE clip_id = ANY(${top.map((s) => s.clip)})`;
  return { boosted: top.length, until };
}
