// (2026-11-26, the owner: "seems like we're missing a stat on the client portal, maybe we can add something to fill it in like this month or this year idk") A client's streams
// this year, for the portal's This Year tile (components/portal/ClientPortal.jsx), from Luminate, on the same day as their Gross Streams. jan1For reads the database (server
// only); the rest is pure.
//
// A song's streams this year = its streams on the page (the pub sheet's Luminate all-time: Gross Streams' own number, so the two are from one day) minus its count on Jan 1.
// The Jan 1 count, for the year Y it is in New York, in this order:
//   1. all-time minus year-to-date on the newest export dated in Y. Luminate gives the year-to-date (lum_points grain "ytd") beside the all-time ("atd") only in the portfolio
//      exports (the newest is Oct 22, 2026), not in the monthly Trend Report the true-up applies (all-time only). That difference is the same on every export since Luminate's
//      change of count (lib/lum-basis.js, Sep 8: within 0.06% on 134 songs, read 2026-11-26) and far off on the older ones (Aug 13-27: 85 of 131 songs more than 1% apart);
//   2. else the newest all-time dated on or before Jan 1 of Y, no more than JAN1_WINDOW_DAYS before it: a true-up's total (trueup_points) or an export's (lum_points "atd").
//      So on Jan 1 the tile starts near 0 and grows as the year's true-ups come in, instead of a dash until a portfolio export (2026-11-26, the coordinator).
// Only numbers on the current count (dated Sep 8, 2026 or later) are used, either way. A song with neither (not in any Luminate file near Jan 1, no Luminate ID) counts 0:
// nothing is estimated. Each of the client's song copies counts, as in Gross Streams. Spotify's stand-ins in Gross Streams have no Luminate numbers, so they count 0 here too.
import { sql, rowsOrNoneIfNoTable } from "./db";
import { LUM_BASIS_FROM, olderCount } from "./lum-basis";

// how far before Jan 1 an all-time may be and still stand for the Jan 1 count (step 2): the streams between it and Jan 1 count as this year's
export const JAN1_WINDOW_DAYS = 45;
const DAY = 864e5;
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const dayOf = (v) => { const s = String(v ?? "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };
const count = (v) => { const n = Number(v); return v == null || v === "" || !Number.isFinite(n) || n < 0 ? null : n; };

// "2026": the year it is in New York
export const nyYear = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric" }).format(now);
// step 2's days for year Y: from JAN1_WINDOW_DAYS before Jan 1 (never before the current count) to Jan 1 itself; null when no day is both (2026: the count changed in Sep)
export function jan1Window(year) {
  const jan1 = `${year}-01-01`, w = addDays(jan1, -JAN1_WINDOW_DAYS), from = w > LUM_BASIS_FROM ? w : LUM_BASIS_FROM;
  return from <= jan1 ? { from, to: jan1 } : null;
}

// Pure. rows: lum_points, Worldwide [{ lum_id, grain: "ytd" | "atd", on: "YYYY-MM-DD", v }]; year: "2027"; trueups: trueup_points [{ lum_id, on, total }].
// -> Map(Luminate ID -> { jan1, on, by: "ytd" | "atd" }): its count on Jan 1 of that year, by step 1 when it can, else step 2 (the header)
export function jan1Counts(rows, year, trueups = []) {
  const days = new Map(), win = jan1Window(year), near = new Map();
  const nearer = (id, on, v, rank) => { const c = near.get(id); if (!c || on > c.on || (on === c.on && rank > c.rank)) near.set(id, { jan1: v, on, by: "atd", rank }); };
  for (const r of rows || []) {
    const on = dayOf(r?.on), v = count(r?.v);
    if (!r?.lum_id || (r.grain !== "ytd" && r.grain !== "atd") || !on || olderCount(on) || v == null) continue;
    if (on.slice(0, 4) === String(year)) { const k = `${r.lum_id}|${on}`; (days.get(k) || days.set(k, { id: String(r.lum_id), on }).get(k))[r.grain] = v; }
    if (r.grain === "atd" && win && on >= win.from && on <= win.to) nearer(String(r.lum_id), on, v, 0);
  }
  // a true-up's total wins a tie with an export's on the same day: it is the number the page's streams came from
  for (const t of trueups || []) { const on = dayOf(t?.on), v = count(t?.total); if (t?.lum_id && on && v != null && !olderCount(on) && win && on >= win.from && on <= win.to) nearer(String(t.lum_id), on, v, 1); }
  const out = new Map();
  for (const d of days.values()) {
    if (d.ytd == null || d.atd == null || d.ytd > d.atd) continue; // a year-to-date over its own all-time is no pair
    const cur = out.get(d.id);
    if (!cur || d.on > cur.on) out.set(d.id, { jan1: d.atd - d.ytd, on: d.on, by: "ytd" });
  }
  for (const [id, n] of near) if (!out.has(id)) out.set(id, { jan1: n.jan1, on: n.on, by: "atd" });
  return out;
}

// One client's Jan 1 counts ({ year, counts }), for their own songs only (the session's client: pages/api/dashboard-data.js)
export async function jan1For(clientId, year = nyYear()) {
  if (!clientId) return { year, counts: new Map() };
  const win = jan1Window(year), jan1 = `${year}-01-01`;
  const from = win ? win.from : jan1 > LUM_BASIS_FROM ? jan1 : LUM_BASIS_FROM;
  const [rows, trueups] = await Promise.all([
    rowsOrNoneIfNoTable(sql`
      SELECT lum_id, grain, period_to::text AS "on", value::float8 AS v FROM lum_points
      WHERE grain IN ('ytd', 'atd') AND location = 'Worldwide' AND period_to >= ${from}::date AND period_to <= ${`${year}-12-31`}::date
        AND lum_id IN (SELECT luminate_id FROM placements WHERE client_id = ${clientId} AND luminate_id <> '')`),
    // step 2's true-up totals: only read when the year has a window (none in 2026)
    win ? rowsOrNoneIfNoTable(sql`
      SELECT lum_id, total_on::text AS "on", total::float8 AS total FROM trueup_points
      WHERE total_on >= ${win.from}::date AND total_on <= ${win.to}::date
        AND lum_id IN (SELECT luminate_id FROM placements WHERE client_id = ${clientId} AND luminate_id <> '')`) : [],
  ]);
  return { year, counts: jan1Counts(rows, year, trueups) };
}

// Pure. placements: the client's song copies as stored [{ streams, luminate_id }] (or as the page has them, luminateId); jan1: jan1For's answer; day: the day the page's
// streams are from (lib/streams-on.js streamsOn): in jan1's year, or late enough in the year before to be on or after step 2's window (Jan 1: the December true-up's numbers,
// so the year starts at 0). -> { total, songs, year } (songs: the copies counted), or null: nothing to show (a dash)
export function yearStreamsOf(placements, jan1, day) {
  const d = dayOf(day), y = String(jan1?.year ?? "");
  if (!jan1?.counts?.size || !d || d.slice(0, 4) > y || d < addDays(`${y}-01-01`, -JAN1_WINDOW_DAYS)) return null;
  let total = 0, songs = 0;
  for (const p of placements || []) {
    const j = jan1.counts.get(String(p?.luminate_id ?? p?.luminateId ?? ""));
    const s = p?.streams == null || p.streams === "" ? NaN : Number(p.streams);
    if (!j || !Number.isFinite(s) || s < j.jan1) continue; // no number, or under its Jan 1 count: the page's number is older, or not on that count
    total += s - j.jan1;
    songs++;
  }
  return songs ? { total, songs, year: y } : null;
}
