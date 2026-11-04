// List B #4: what Numbers and Home show. buildSummary is pure (the tests and the real-data check call
// it on plain rows); loadSummary reads the tables. Every number carries its platform's label and the day
// it was taken, so a source that failed shows its last good number with "last updated <date>".
import { rowsOrNoneIfNoTable } from "../db";
import { SOURCES, SOURCE_KEYS, ADAPTERS, SCHEDULE_DAYS, metricLabel, monthlyEstimate } from "./sources";
import { toSeries, stats, sumStats, sumSeries, spikeOf, weekJump, addDays, dayOf } from "./math";
import { loadState, monthSpend, modeFor, refreshOn, dataSql as sql } from "./engine";
import * as D from "./direct";
import { loadSeeds, historyByEntity } from "./seeds";

const DAY = 86400000;
const SERIES_DAYS = 60;
const NEW_RELEASE_DAYS = 21;
// which source keeps each number fresh, and so how old it may get before it's "last updated <date>"
const SOURCE_OF = { "spotify:streams": "spotify_streams", "spotify:monthly_listeners": "spotify_listeners", "spotify:followers": "spotify_listeners", "instagram:followers": "instagram", "tiktok:followers": "tiktok", "tiktok:videos": "tiktok_sound", "youtube:subscribers": "youtube", "youtube:views": "youtube" };
const ARTIST_METRICS = [["spotify", "monthly_listeners"], ["spotify", "followers"], ["instagram", "followers"], ["tiktok", "followers"], ["youtube", "subscribers"], ["youtube", "views"]];

// history: the old Luminate numbers per entity (lib/data/seeds.js historyByEntity), shown read-only beside the new ones
export function buildSummary({ entities, links, checks = [], refresh = [], settings, snaps, runs = [], spent = { total: 0 }, albums = [], now = new Date(), clientIds = null, home = false, flags = {}, history = {} }) {
  const today = dayOf(now), t = new Date(now).getTime();
  const group = new Map();
  for (const s of snaps) {
    const k = `${s.entity_id}|${s.platform}|${s.metric}`;
    (group.get(k) || group.set(k, []).get(k)).push(s);
  }
  const metric = (id, platform, m, e) => {
    const list = group.get(`${id}|${platform}|${m}`);
    if (!list?.length) return null;
    const src = SOURCE_OF[`${platform}:${m}`];
    const days = (modeFor(e, refresh, t) === "campaign" ? 1 : SCHEDULE_DAYS[settings.sources[src]?.schedule || "daily"]);
    const series = toSeries(list);
    const st = stats(series, { slack: days > 1 ? 2 : 1 });
    const last = list[list.length - 1];
    return { ...st, label: metricLabel(platform, m), approx: !!last.approx, source: last.source, stale: st.day < addDays(today, -(days + 1)), series: series.slice(-SERIES_DAYS) };
  };
  const mine = (e) => !clientIds || e.clients.some((c) => clientIds.includes(c));
  const live = entities.filter((e) => e.active && mine(e));
  const linkMap = new Map(links.map((l) => [`${l.entity_id}|${l.platform}`, l]));
  // songs: one per ISRC (the same song can have several Spotify ids), the one with numbers first
  const songs = [], isrcs = new Map();
  const asked = new Set(checks.filter((c) => c.source === "spotify_streams").map((c) => c.entity_id)); // asked, and Spotify shows no count: under 1,000 plays
  for (const e of live.filter((x) => x.kind === "track")) {
    const st = metric(e.id, "spotify", "streams", e);
    const h = history[e.id];
    const s = { id: e.id, name: e.name, artist: e.artist, releaseDate: e.release_date, isNew: !!e.release_date && e.release_date >= addDays(today, -NEW_RELEASE_DAYS), clients: e.clients, parent: e.parent_id, streams: st, under1k: !st && asked.has(e.id),
      lum: h ? { atd: h.atd, on: h.on, week: h.week?.thisWeek ?? null } : null };
    const prev = e.isrc && isrcs.get(e.isrc);
    if (prev) { if (!prev.streams && st) Object.assign(prev, { ...s, id: prev.id, lum: prev.lum || s.lum }); else if (!prev.lum && s.lum) prev.lum = s.lum; continue; }
    if (e.isrc) isrcs.set(e.isrc, s);
    songs.push(s);
  }
  // a song in the list: only what the page shows (330 songs on a phone)
  const songOut = ({ id, name, artist, releaseDate, isNew, under1k, lum, streams: m }) => ({ id, name, artist, releaseDate, isNew, under1k, lum, streams: m && { latest: m.latest, day: m.day, daily: m.daily, thisWeek: m.thisWeek, lastWeek: m.lastWeek, pct: m.pct, stale: m.stale } });
  const artists = live.filter((e) => e.kind === "artist").map((e) => {
    const cid = e.id.startsWith("a:") ? e.id.slice(2) : null;
    const own = songs.filter((s) => s.parent === e.id || (cid && s.clients.includes(cid)));
    const st = own.map((s) => s.streams).filter(Boolean);
    const total = st.length ? { ...sumStats(st), label: metricLabel("spotify", "streams"), day: st.map((x) => x.day).sort().pop(), stale: st.every((x) => x.stale), series: sumSeries(own.filter((s) => s.streams).map((s) => s.streams.series)).slice(-SERIES_DAYS) } : null;
    const m = {};
    for (const [p, k] of ARTIST_METRICS) { const v = metric(e.id, p, k, e); if (v) m[`${p}_${k}`] = v; }
    const lk = Object.fromEntries(["spotify", "instagram", "tiktok", "youtube"].map((p) => [p, linkMap.get(`${e.id}|${p}`)?.url || ""]).filter(([, v]) => v));
    // Luminate's own artist row (the Artist Tracker), else its songs' last all-time added up
    const own_h = own.filter((s) => s.lum?.atd != null);
    const lum = history[e.id] ? { atd: history[e.id].atd, on: history[e.id].on, week: history[e.id].week?.thisWeek ?? null, series: history[e.id].series || [] }
      : own_h.length ? { atd: own_h.reduce((a, s) => a + s.lum.atd, 0), on: own_h.map((s) => s.lum.on).sort().pop(), songs: own_h.length, week: null } : null;
    return {
      id: e.id, name: e.name, image: e.image, clientId: cid, watchlist: e.origins.includes("watchlist") || (!cid && e.origins.includes("luminate")), mode: modeFor(e, refresh, t), lum,
      links: lk, streams: total, metrics: m, songs: own.map(songOut).sort((a, b) => (b.streams?.latest ?? -1) - (a.streams?.latest ?? -1)),
    };
  }).sort((a, b) => Number(a.watchlist) - Number(b.watchlist) || (b.streams?.latest ?? -1) - (a.streams?.latest ?? -1) || a.name.localeCompare(b.name));
  const looseSongs = songs.filter((s) => !s.parent && !s.clients.length).map(songOut); // watchlist songs
  const sounds = live.filter((e) => e.kind === "sound").map((e) => ({ id: e.id, name: e.name, artist: e.artist, url: linkMap.get(`${e.id}|tiktok_sound`)?.url || "", mode: modeFor(e, refresh, t), videos: metric(e.id, "tiktok", "videos", e) }));
  // spikes: a song's last two days 3x its usual, an artist's week up 50%+, followers up 10%+ in a week
  const spikes = [];
  for (const s of songs) {
    const sp = s.streams && spikeOf(s.streams.series, { min: 1000 });
    if (sp) spikes.push({ id: s.id, kind: "song", name: s.name, who: s.artist, gain: sp.gain, day: sp.day, text: `+${fmtN(sp.gain)} Spotify streams in 2 days${sp.times ? ` (${sp.times >= 10 ? "10+" : sp.times.toFixed(1)}× usual)` : ""}` });
  }
  for (const a of artists) {
    const j = a.streams && weekJump(a.streams, { min: 2000 });
    if (j) spikes.push({ id: a.id, kind: "artist", name: a.name, gain: j.gain, text: `+${fmtN(j.gain)} Spotify streams this week (${pctWord(j.pct)} on last week)` });
    for (const [k, v] of Object.entries(a.metrics)) {
      if (!/followers|subscribers/.test(k)) continue;
      const f = weekJump(v, { min: 200, growth: 0.1 });
      if (f) spikes.push({ id: a.id, kind: "artist", name: a.name, gain: f.gain, text: `+${fmtN(f.gain)} ${v.label} this week${f.growthPct ? ` (${pctWord(f.growthPct)})` : ""}` });
    }
  }
  for (const s of sounds) {
    const f = s.videos && weekJump(s.videos, { min: 500, growth: 0.2 });
    if (f) spikes.push({ id: s.id, kind: "sound", name: s.name, gain: f.gain, text: `+${fmtN(f.gain)} TikTok videos this week` });
  }
  spikes.sort((a, b) => b.gain - a.gain);
  const visibleArtists = new Set(artists.map((a) => a.id));
  const newReleases = albums.filter((a) => visibleArtists.has(a.artist_entity) && a.release_date >= addDays(today, -NEW_RELEASE_DAYS))
    .map((a) => ({ name: a.name, artist: artists.find((x) => x.id === a.artist_entity)?.name || "", releaseDate: a.release_date, songs: a.tracks }))
    .sort((a, b) => (a.releaseDate < b.releaseDate ? 1 : -1));
  // cost: what a month of the current schedule comes to, and this month's spend so far
  const sources = SOURCE_KEYS.map((key) => {
    const S = SOURCES[key], cfg = settings.sources[key];
    const targets = entities.filter((e) => e.active && e.kind === S.kind && linkMap.has(`${e.id}|${S.link}`) && (!S.rosterOnly || e.origins.includes("roster")));
    const n = S.kind === "track" ? new Set(targets.map((e) => e.isrc || e.id)).size : targets.length;
    const campaignN = targets.filter((e) => modeFor(e, refresh, t) === "campaign").length;
    const offN = targets.filter((e) => modeFor(e, refresh, t) === "off").length;
    const last = runs.find((r) => r.source === key && r.status !== "skipped");
    const skipped = runs.find((r) => r.source === key && r.status === "skipped" && (!last || new Date(r.started_at) > new Date(last.started_at)));
    return {
      key, label: S.label, schedule: cfg.schedule, adapter: cfg.adapter, softCapUsd: cfg.softCapUsd, paid: !!ADAPTERS[cfg.adapter].actor,
      adapters: S.adapters.map((a) => ({ id: a, actor: ADAPTERS[a].actor || (a === "youtube-api" ? "YouTube Data API (free)" : "Spotify Web API (free)"), per: ADAPTERS[a].price.per })),
      tracked: n, campaign: campaignN, estMonthlyUsd: round2(monthlyEstimate(cfg.adapter, cfg.schedule, n - offN, campaignN)), spentUsd: round2(spent[key] || 0),
      last: last ? { at: last.finished_at || last.started_at, status: last.status, error: last.error || "", snapshots: last.snapshots } : null,
      skipped: skipped ? { at: skipped.started_at, why: skipped.error } : null,
    };
  });
  const cost = { estMonthlyUsd: round2(sources.reduce((a, s) => a + s.estMonthlyUsd, 0)), spentUsd: round2(spent.total || 0), totalCapUsd: settings.totalCapUsd, account: settings.account || null };
  const lastAt = runs.filter((r) => r.status === "done").map((r) => r.finished_at || r.started_at).sort((a, b) => new Date(b) - new Date(a))[0] || null;
  const state = { refreshOn: flags.refreshOn ?? false, keys: flags.keys || {}, lastAt, open: runs.filter((r) => r.status === "started").length };
  if (home) return { spikes: spikes.slice(0, 5), newReleases: newReleases.slice(0, 3), cost: { estMonthlyUsd: cost.estMonthlyUsd }, state };
  return { artists, songs: looseSongs, sounds, spikes: spikes.slice(0, 10), newReleases, sources, cost, state };
}
const round2 = (v) => Math.round(v * 100) / 100;
const fmtN = (n) => Math.round(n).toLocaleString("en-US");
const pctWord = (p) => (p == null ? "" : `${p >= 0 ? "+" : ""}${Math.round(p * 100)}%`);

export async function loadSummary({ clientIds = null, home = false, now = new Date() } = {}) {
  const since = new Date(new Date(now).getTime() - (SERIES_DAYS + 15) * DAY).toISOString();
  const [state, recent, older, runs, spent, albums, seeds] = await Promise.all([
    loadState(),
    rowsOrNoneIfNoTable(sql`SELECT entity_id, platform, metric, value, taken_at, approx, source FROM data_snapshots WHERE taken_at > ${since} ORDER BY taken_at`),
    // the last good number of anything not refreshed lately
    rowsOrNoneIfNoTable(sql`SELECT DISTINCT ON (entity_id, platform, metric) entity_id, platform, metric, value, taken_at, approx, source FROM data_snapshots WHERE taken_at <= ${since} ORDER BY entity_id, platform, metric, taken_at DESC`),
    rowsOrNoneIfNoTable(sql`SELECT id, source, adapter, status, items, snapshots, est_usd, usd, error, started_at, finished_at FROM data_runs ORDER BY started_at DESC LIMIT 80`),
    monthSpend(now),
    rowsOrNoneIfNoTable(sql`SELECT album_id, artist_entity, name, release_date, tracks FROM data_albums WHERE release_date >= ${addDays(dayOf(now), -NEW_RELEASE_DAYS)}`),
    home ? [] : loadSeeds(),
  ]);
  return buildSummary({ ...state, snaps: [...older, ...recent], runs, spent, albums, now, clientIds, home, history: historyByEntity(seeds), flags: { refreshOn: refreshOn(), keys: { apify: D.apifyConfigured(), youtube: D.youtubeConfigured(), spotify: D.spotifyConfigured() } } });
}
