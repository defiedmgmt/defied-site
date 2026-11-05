// Luminate's own numbers as dated, read-only history (r10): lum_points (migration 016, loaded from the old
// portfolio exports and Trend Reports), and before that table has rows, lum_history's last export (012).
// All platforms, labelled so, never mixed with the Spotify counts (data_snapshots). No money here. Server only.
//   lumWeek(keys)         { [entity key]: { v, last, pct, from, to, src } }: the newest FULL week vs the week before
//   lumSeries(key, opts)  [{ from, to, v, kind: "week" | "day" | "atd", src }], oldest first; a missing week or day is
//                         a point with v: null (a gap, never a zero)
//   lumLatestWeekLabel()  "Oct 23–29": the newest full week any entity has, or null
// Pure helpers (tested on their own): exportWeeks, weekStartOf, weekLabel, weekOfRows, seriesOfRows.
import { rowsOrNoneIfNoTable } from "../db";
import { dataSql as sql } from "./engine";

export const LUM_SRC = "Luminate, all platforms";
export const US_ONLY = "United States";
const srcOf = (location) => (location === US_ONLY ? `${LUM_SRC}, US only` : LUM_SRC);
const DAY = 864e5;
export const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const dow = (day) => new Date(`${day}T12:00:00Z`).getUTCDay(); // 4 = Thursday, 5 = Friday
const dayText = (v) => (v == null ? null : String(v instanceof Date ? v.toISOString() : v).slice(0, 10));
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

// Luminate's tracking weeks run Friday to Thursday (the Trend Report's week 43 = Oct 23–29)
export const weekStartOf = (day) => addDays(day, -((dow(day) + 2) % 7));
// A portfolio export's "This Period" is the last FULL week before the day it was made, "Last Period" the one
// before that: the Oct 29 exports are Oct 16–22 and Oct 9–15 (their all-time = the Trend Report's Oct 29
// all-time minus its Oct 23–29 days), never the week the export day is in. day: the export's New York day.
export function exportWeeks(day) {
  const to = addDays(day, -((dow(day) - 4 + 7) % 7 || 7));
  return { from: addDays(to, -6), to, lastFrom: addDays(to, -13), lastTo: addDays(to, -7) };
}

// "Oct 23–29", "Oct 30–Nov 5", "Oct 29" (one day)
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function weekLabel(from, to) {
  if (!from) return null;
  const [, am, ad] = from.split("-").map(Number), [, bm, bd] = String(to || from).split("-").map(Number);
  if (from === (to || from)) return `${MON[am - 1]} ${ad}`;
  return am === bm ? `${MON[am - 1]} ${ad}–${bd}` : `${MON[am - 1]} ${ad}–${MON[bm - 1]} ${bd}`;
}

const KIND_RANK = { song: 0, artist: 0, release: 1 };
// one Luminate id per entity (a song and its single's release group can point at one entity): the one with the
// newest data, then a song or artist over a release group, then the bigger number
const better = (a, b) => (a.to !== b.to ? (a.to > b.to ? a : b) : (KIND_RANK[a.kind] ?? 2) !== (KIND_RANK[b.kind] ?? 2) ? ((KIND_RANK[a.kind] ?? 2) < (KIND_RANK[b.kind] ?? 2) ? a : b) : (b.v ?? -1) > (a.v ?? -1) ? b : a);

// Pure. rows: lum_points week rows [{ key, lum_id, kind, location, from, to, v }] -> { [key]: week }.
// Worldwide when that Luminate id has a Worldwide week, else United States (never the two compared). last/pct
// are null when the week before is missing (no % across a gap, none from zero).
export function weekOfRows(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!r.key || num(r.v) == null) continue;
    const k = `${r.key}|${r.lum_id}`;
    (by.get(k) || by.set(k, []).get(k)).push({ ...r, from: dayText(r.from), to: dayText(r.to), v: num(r.v) });
  }
  const out = {};
  for (const list of by.values()) {
    const loc = list.some((r) => r.location !== US_ONLY) ? list.filter((r) => r.location !== US_ONLY) : list;
    const newest = loc.reduce((a, r) => (r.from > a.from ? r : a));
    const prev = loc.find((r) => r.from === addDays(newest.from, -7));
    const last = prev ? prev.v : null;
    const w = { v: newest.v, last, pct: last > 0 ? ((newest.v - last) / last) * 100 : null, from: newest.from, to: newest.to, src: srcOf(newest.location), kind: newest.kind };
    const cur = out[newest.key];
    out[newest.key] = cur ? better(cur, w) : w;
  }
  for (const k of Object.keys(out)) delete out[k].kind;
  return out;
}

// Pure. lum_history rows [{ key, kind, matched_by, atd, atd_on, week }] -> { [key]: week }. A row stored before
// the label fix says the week ended on the export day (to = atd_on): its dates are worked out again here.
export function weekOfHistory(rows) {
  const out = {};
  for (const r of rows) {
    const wk = typeof r.week === "string" ? JSON.parse(r.week) : r.week;
    if (!r.key || r.matched_by === "same-song" || !wk || num(wk.thisWeek) == null) continue;
    const on = dayText(r.atd_on);
    const dates = on && (!wk.to || dayText(wk.to) === on) ? exportWeeks(on) : { from: dayText(wk.from), to: dayText(wk.to) };
    const last = num(wk.lastWeek);
    const w = { v: num(wk.thisWeek), last, pct: last > 0 ? ((num(wk.thisWeek) - last) / last) * 100 : null, from: dates.from, to: dates.to, src: LUM_SRC, kind: r.kind };
    out[r.key] = out[r.key] ? better(out[r.key], w) : w;
  }
  for (const k of Object.keys(out)) delete out[k].kind;
  return out;
}

// lum_points rows for some entities, under the entity each Luminate id points at now (lum_history), or the one it
// was built for; nothing a person skipped
const pointsFor = (keys, grains) => rowsOrNoneIfNoTable(sql`
  SELECT x.* FROM (
    SELECT CASE WHEN h.lum_id IS NULL THEN p.entity_id WHEN h.status = 'skipped' THEN NULL ELSE COALESCE(h.entity_id, p.entity_id) END AS key,
      p.lum_id, p.kind, p.grain, p.location, p.period_from::text AS "from", p.period_to::text AS "to", p.value::float8 AS v
    FROM lum_points p LEFT JOIN lum_history h ON h.lum_id = p.lum_id
    WHERE p.grain = ANY(${grains}::text[])) x
  WHERE x.key = ANY(${keys}::text[])`);

export async function lumWeek(keys) {
  const want = [...new Set((keys || []).filter(Boolean).map(String))];
  if (!want.length) return {};
  const pts = weekOfRows(await pointsFor(want, ["week"]));
  const rest = want.filter((k) => !pts[k]);
  if (!rest.length) return pts;
  const hist = await rowsOrNoneIfNoTable(sql`SELECT entity_id AS key, kind, matched_by, atd, atd_on::text AS atd_on, week FROM lum_history
    WHERE entity_id = ANY(${rest}::text[]) AND status <> 'skipped' AND week IS NOT NULL`);
  return { ...weekOfHistory(hist), ...pts };
}

// Pure. rows: lum_points rows for ONE entity [{ lum_id, kind, grain, location, from, to, v }] -> the chart's
// points. location: "Worldwide" (default; a grain with no Worldwide rows falls back to US only) or "United States".
export function seriesOfRows(rows, { location = "Worldwide" } = {}) {
  const ok = rows.filter((r) => num(r.v) != null && ["week", "day", "atd"].includes(r.grain)).map((r) => ({ ...r, from: dayText(r.from), to: dayText(r.to), v: num(r.v) }));
  if (!ok.length) return [];
  // the Luminate id with the newest numbers (a song and its single are one entity)
  const ids = new Map();
  for (const r of ok) { const c = ids.get(r.lum_id) || { lum_id: r.lum_id, kind: r.kind, to: "", n: 0 }; c.n++; if (r.to > c.to) c.to = r.to; ids.set(r.lum_id, c); }
  const pick = [...ids.values()].sort((a, b) => (a.to !== b.to ? (a.to > b.to ? -1 : 1) : (KIND_RANK[a.kind] ?? 2) - (KIND_RANK[b.kind] ?? 2) || b.n - a.n))[0].lum_id;
  const mine = ok.filter((r) => r.lum_id === pick);
  const out = [];
  for (const [grain, step] of [["week", 7], ["day", 1], ["atd", 0]]) {
    const g = mine.filter((r) => r.grain === grain);
    const here = g.filter((r) => (location === US_ONLY ? r.location === US_ONLY : r.location !== US_ONLY));
    const list = (here.length || location === US_ONLY ? here : g.filter((r) => r.location === US_ONLY)).sort((a, b) => a.from.localeCompare(b.from));
    let prev = null;
    for (const r of list) {
      if (prev && step) for (let d = addDays(prev.from, step); d < r.from; d = addDays(d, step)) out.push({ from: d, to: addDays(d, step - 1), v: null, kind: grain, src: srcOf(r.location) });
      out.push({ from: r.from, to: r.to, v: r.v, kind: grain, src: srcOf(r.location) });
      prev = r;
    }
  }
  return out.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

// before lum_points has an entity's rows: lum_history's all-time series and its last export's two weeks
export function seriesOfHistory(rows) {
  const r = rows.filter((x) => x.matched_by !== "same-song").sort((a, b) => (num(b.atd) ?? -1) - (num(a.atd) ?? -1))[0];
  if (!r) return [];
  const out = [];
  const series = typeof r.series === "string" ? JSON.parse(r.series) : r.series || [];
  for (const [day, v] of series) if (num(v) != null) out.push({ from: dayText(day), to: dayText(day), v: num(v), kind: "atd", src: LUM_SRC });
  const wk = typeof r.week === "string" ? JSON.parse(r.week) : r.week;
  if (wk && num(wk.thisWeek) != null) {
    const on = dayText(r.atd_on);
    const d = on && (!wk.to || dayText(wk.to) === on) ? exportWeeks(on) : { from: dayText(wk.from), to: dayText(wk.to), lastFrom: dayText(wk.lastFrom) || addDays(dayText(wk.from), -7), lastTo: dayText(wk.lastTo) || addDays(dayText(wk.from), -1) };
    if (num(wk.lastWeek) != null) out.push({ from: d.lastFrom, to: d.lastTo, v: num(wk.lastWeek), kind: "week", src: LUM_SRC });
    out.push({ from: d.from, to: d.to, v: num(wk.thisWeek), kind: "week", src: LUM_SRC });
  }
  return out.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

export async function lumSeries(key, opts = {}) {
  if (!key) return [];
  const pts = seriesOfRows(await pointsFor([String(key)], ["week", "day", "atd"]), opts);
  if (pts.length) return pts;
  if (opts.location === US_ONLY) return [];
  const hist = await rowsOrNoneIfNoTable(sql`SELECT kind, matched_by, atd, atd_on::text AS atd_on, week, series FROM lum_history
    WHERE entity_id = ${String(key)} AND status <> 'skipped'`);
  return seriesOfHistory(hist);
}

export async function lumLatestWeekLabel() {
  const [p] = await rowsOrNoneIfNoTable(sql`SELECT period_from::text AS "from", period_to::text AS "to" FROM lum_points WHERE grain = 'week' ORDER BY period_from DESC LIMIT 1`);
  if (p?.from) return weekLabel(dayText(p.from), dayText(p.to));
  const [h] = await rowsOrNoneIfNoTable(sql`SELECT atd_on::text AS atd_on, week FROM lum_history WHERE week IS NOT NULL AND atd_on IS NOT NULL ORDER BY atd_on DESC LIMIT 1`);
  if (!h) return null;
  const wk = typeof h.week === "string" ? JSON.parse(h.week) : h.week;
  const on = dayText(h.atd_on);
  const d = !wk?.to || dayText(wk.to) === on ? exportWeeks(on) : { from: dayText(wk.from), to: dayText(wk.to) };
  return weekLabel(d.from, d.to);
}
