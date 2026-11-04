// List B #8, the momentum score. Server only (the math, scoreOf, is pure). One score from 0 to 100 for
// every tracked artist (roster and watchlist), from the dated snapshots (lib/data/engine.js):
//   streams    the artist's Spotify streams (its songs summed) and monthly listeners
//   followers  Instagram, TikTok, YouTube subscribers, Spotify followers
//   tiktok     new videos on the artist's TikTok sounds (the radar's seeds from their own videos)
// Each part is the growth per week against its own size (so a small artist on the rise scores high, a big
// one standing still doesn't), the last 7 days weighted over the 3 weeks before (`recent`, 70%), mapped to
// points (50 = flat; tanh, so one wild number can't run away). The score is the parts' weighted mean
// (default streams 40, followers 30, TikTok 30; Trackers › Score weights). 50 means "flat"; no part with
// two days of numbers = no score yet. One score a day is kept (momentum_scores) for the trend, and a
// jump of 15 points or more is flagged on Home.
import { dataSql as sql, saveSetting } from "../data/engine";
import { rowsOrNoneIfNoTable } from "../db";
import { toSeries, sumSeries, valueAt, addDays } from "../data/math";

export const MOMENTUM_DEFAULTS = { streams: 40, followers: 30, tiktok: 30, recent: 70 };
// the weekly growth that scores about 88 (tanh(1.4)): streams and listeners move slower than a sound
export const SCALE = { streams: 0.15, followers: 0.05, tiktok: 0.3 };
export const JUMP = 15;
const DAY = 864e5;
const arr = (v) => (Array.isArray(v) ? v : typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []);
const gap = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const dayOfNow = (now) => new Date(now).toISOString().slice(0, 10);

export function cleanWeights(w = {}) {
  const v = w && typeof w === "object" ? w : {};
  const n = (k, hi) => (Number.isFinite(Number(v[k])) && v[k] !== "" && v[k] != null ? Math.min(hi, Math.max(0, Math.round(Number(v[k])))) : MOMENTUM_DEFAULTS[k]);
  const out = { streams: n("streams", 100), followers: n("followers", 100), tiktok: n("tiktok", 100), recent: n("recent", 100) };
  if (out.streams + out.followers + out.tiktok === 0) Object.assign(out, { streams: MOMENTUM_DEFAULTS.streams, followers: MOMENTUM_DEFAULTS.followers, tiktok: MOMENTUM_DEFAULTS.tiktok });
  return out;
}

// ---------------------------------------------------------------- pure
// one series' growth per week: recent = from the count about 7 days back (or the first count, at least a
// day back) to the newest; older = the 3 weeks before that, when there are counts that far back
export function rateOf(series) {
  if (!series || series.length < 2) return null;
  const [day, v] = series[series.length - 1];
  const w = valueAt(series, addDays(day, -7), 2);
  const base = w && gap(w[0], day) >= 1 ? w : series.find((p) => gap(p[0], day) >= 1 && gap(p[0], day) < 7) || null;
  if (!base || !(base[1] > 0)) return null;
  const days = gap(base[0], day);
  const recent = (v / base[1] - 1) * (7 / days);
  const o = valueAt(series, addDays(base[0], -21), 3);
  const older = o && o[1] > 0 && gap(o[0], base[0]) >= 7 ? (base[1] / o[1] - 1) * (7 / gap(o[0], base[0])) : null;
  return { recent, older, days, from: base[1], to: v, gain: v - base[1], since: base[0], day };
}
const pts = (g, scale) => 50 + 50 * Math.tanh(g / scale);
const blend = (r, recentPct) => (r.older == null ? r.recent : (recentPct / 100) * r.recent + (1 - recentPct / 100) * r.older);
const fmtK = (n) => { const a = Math.abs(n); return a >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M` : a >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}k` : String(Math.round(n)); };
const pctTxt = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 100))}%`;
const when = (r) => (r.days >= 6 ? "this week" : `since ${new Date(`${r.since}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`);
const PLATFORM = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", spotify: "Spotify" };

// parts: { streams: [{ label, series }], followers: [...], tiktok: [...] } -> { score, parts, why }
export function scoreOf(parts, weights = MOMENTUM_DEFAULTS) {
  const w = cleanWeights(weights);
  const out = {};
  let sum = 0, wsum = 0;
  for (const k of ["streams", "followers", "tiktok"]) {
    const rs = (parts[k] || []).map((p) => ({ ...p, r: rateOf(p.series) })).filter((p) => p.r);
    if (!rs.length) continue;
    const g = rs.reduce((a, p) => a + blend(p.r, w.recent), 0) / rs.length;
    const p = pts(g, SCALE[k]);
    // the "why": the part's biggest mover, in its own words
    const top = [...rs].sort((a, b) => Math.abs(b.r.recent) - Math.abs(a.r.recent))[0];
    const text = k === "tiktok" ? `TikTok sound ${top.r.gain >= 0 ? "+" : "−"}${fmtK(Math.abs(top.r.gain))} videos ${when(top.r)}` : `${top.label} ${pctTxt(top.r.to / top.r.from - 1)} ${when(top.r)}`;
    out[k] = { points: Math.round(p * 10) / 10, growth: r3(g), text, weight: w[k] };
    if (w[k] > 0) { sum += p * w[k]; wsum += w[k]; }
  }
  if (!wsum) return { score: null, parts: out, why: Object.keys(out).length ? "" : "Needs a second day of numbers" };
  const score = Math.round((sum / wsum) * 10) / 10;
  const why = Object.entries(out).filter(([k]) => w[k] > 0).sort((a, b) => Math.abs(b[1].points - 50) * b[1].weight - Math.abs(a[1].points - 50) * a[1].weight).slice(0, 2).map(([, v]) => v.text).join(", ");
  return { score, parts: out, why };
}
// the trend against the score kept about a week ago (else the last one before today)
export function trendOf(score, history, today) {
  if (score == null) return { trend: null, delta: null };
  const past = history.filter((h) => h.day < today && h.score != null).sort((a, b) => (a.day < b.day ? 1 : -1));
  const ref = past.find((h) => gap(h.day, today) >= 6) || past[0];
  if (!ref) return { trend: "new", delta: null };
  const delta = Math.round((score - Number(ref.score)) * 10) / 10;
  return { trend: delta >= 3 ? "rising" : delta <= -3 ? "falling" : "steady", delta, vs: ref.day, jump: delta >= JUMP };
}

// ---------------------------------------------------------------- reads
export async function momentumWeights() {
  const rows = await rowsOrNoneIfNoTable(sql`SELECT value FROM data_settings WHERE key = 'momentum'`);
  let v = rows[0]?.value; if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = {}; } }
  return cleanWeights(v || {});
}
export async function saveMomentumWeights(w) { const c = cleanWeights(w); await saveSetting("momentum", c); return c; }

// every artist entity's parts from the last 5 weeks of snapshots
async function partsByArtist(now) {
  const from = new Date(new Date(now).getTime() - 35 * DAY).toISOString();
  const [entities, snaps, sounds] = await Promise.all([
    rowsOrNoneIfNoTable(sql`SELECT id, kind, name, image, parent_id, clients, origins, active FROM data_entities`),
    rowsOrNoneIfNoTable(sql`SELECT entity_id, platform, metric, value, taken_at FROM data_snapshots WHERE taken_at >= ${from} ORDER BY taken_at`),
    rowsOrNoneIfNoTable(sql`SELECT clip_id, from_entity FROM radar_sounds WHERE from_entity IS NOT NULL`),
  ]);
  const series = new Map();
  for (const s of snaps) { const k = `${s.entity_id}|${s.platform}|${s.metric}`; if (!series.has(k)) series.set(k, []); series.get(k).push(s); }
  const ser = (id, platform, metric) => toSeries(series.get(`${id}|${platform}|${metric}`) || []);
  const artists = entities.filter((e) => e.kind === "artist").map((e) => ({ ...e, clients: arr(e.clients), origins: arr(e.origins) }));
  const tracks = entities.filter((e) => e.kind === "track").map((e) => ({ ...e, clients: arr(e.clients) }));
  const soundsOf = new Map();
  for (const s of sounds) soundsOf.set(s.from_entity, [...(soundsOf.get(s.from_entity) || []), s.clip_id]);
  const out = new Map();
  for (const a of artists) {
    const cid = a.id.startsWith("a:") ? a.id.slice(2) : null;
    const songs = tracks.filter((t) => t.parent_id === a.id || (cid && t.clients.includes(cid))).map((t) => ser(t.id, "spotify", "streams")).filter((s) => s.length);
    const streams = [];
    if (songs.length) streams.push({ label: "streams", series: sumSeries(songs) });
    const ml = ser(a.id, "spotify", "monthly_listeners"); if (ml.length) streams.push({ label: "monthly listeners", series: ml });
    const followers = [["instagram", "followers"], ["tiktok", "followers"], ["youtube", "subscribers"], ["spotify", "followers"]]
      .map(([p, m]) => ({ label: `${PLATFORM[p]} ${m === "subscribers" ? "subscribers" : "followers"}`, series: ser(a.id, p, m) })).filter((x) => x.series.length);
    const tiktok = (soundsOf.get(a.id) || []).map((clip) => ({ label: "TikTok sound", series: ser(`s:${clip}`, "tiktok", "videos") })).filter((x) => x.series.length);
    out.set(a.id, { entity: a, parts: { streams, followers, tiktok } });
  }
  return out;
}
// computeMomentum({ save }) -> Map(entityId -> { id, name, score, trend, delta, why, parts, scope }); save
// keeps today's score (one a day, the newest wins) for the trend
export async function computeMomentum({ now = Date.now(), save = false } = {}) {
  const today = dayOfNow(now);
  const [byArtist, weights, hist] = await Promise.all([
    partsByArtist(now), momentumWeights(),
    rowsOrNoneIfNoTable(sql`SELECT entity_id, day::text AS day, score FROM momentum_scores WHERE day >= ${addDays(today, -21)} ORDER BY day`),
  ]);
  const histOf = new Map();
  for (const h of hist) histOf.set(h.entity_id, [...(histOf.get(h.entity_id) || []), { day: String(h.day).slice(0, 10), score: h.score == null ? null : Number(h.score) }]);
  const out = new Map();
  for (const [id, { entity, parts }] of byArtist) {
    const s = scoreOf(parts, weights);
    const t = trendOf(s.score, histOf.get(id) || [], today);
    out.set(id, { id, name: entity.name, image: entity.image || "", active: entity.active, scope: entity.origins.includes("roster") ? "roster" : "watchlist", ...s, ...t });
  }
  if (save) {
    const rows = [...out.values()].map((m) => ({ entity_id: m.id, score: m.score, parts: m.parts, why: m.why }));
    if (rows.length) await sql`
      INSERT INTO momentum_scores (entity_id, day, score, parts, why, computed_at)
      SELECT x.entity_id, ${today}::date, x.score, x.parts, x.why, now() FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(entity_id text, score numeric, parts jsonb, why text)
      ON CONFLICT (entity_id, day) DO UPDATE SET score = EXCLUDED.score, parts = EXCLUDED.parts, why = EXCLUDED.why, computed_at = now()`;
  }
  return out;
}
// topMomentum({ n, scope: 'watchlist'|'roster'|'team', userId }) -> [{ id, name, score, trend, why }], best first.
// team = what's on the trackers (userId: that person's); an artist with no score yet comes last.
export async function topMomentum({ n = 10, scope = "team", userId = null, now = Date.now() } = {}) {
  const all = await computeMomentum({ now });
  let ids;
  if (scope === "team") {
    const { listTracker } = await import("./trackers");
    ids = new Set((await listTracker({ userId, now })).map((i) => i.entityId).filter(Boolean));
  }
  return [...all.values()]
    .filter((m) => (scope === "team" ? ids.has(m.id) : m.scope === scope && m.active))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name))
    .slice(0, n)
    .map((m) => ({ id: m.id, name: m.name, score: m.score, trend: m.trend, delta: m.delta, why: m.why, image: m.image, jump: !!m.jump }));
}
// Home's flags: the tracked artists whose score jumped JUMP points or more against about a week ago
export async function momentumJumps({ now = Date.now(), clientIds = null } = {}) {
  const all = await computeMomentum({ now });
  return [...all.values()].filter((m) => m.active && m.jump && (!clientIds || (m.id.startsWith("a:") && clientIds.includes(m.id.slice(2)))))
    .sort((a, b) => b.delta - a.delta).slice(0, 5).map((m) => ({ id: m.id, name: m.name, score: m.score, delta: m.delta, why: m.why, scope: m.scope }));
}
