// (2026-11-26, the owner: "seems like we're missing a stat on the client portal, maybe we can add something to fill it in like this month or this year idk") A client's streams
// this year, for the portal's This Year tile (components/portal/ClientPortal.jsx), from Luminate, on the same day as their Gross Streams. jan1For reads the database (server
// only); the rest is pure.
//
// Luminate gives a song's year-to-date (lum_points grain "ytd") beside its all-time ("atd") only in the portfolio exports (the newest is Oct 22), not in the monthly Trend
// Report the true-up applies (Nov 14: all-time only). All-time minus year-to-date on one export is the song's count on Jan 1, and that count is the same on every export since
// Luminate's change of count (lib/lum-basis.js, Sep 8: within 0.06% on 134 songs, read 2026-11-26) and far off on the older ones (Aug 13-27: 85 of 131 songs more than 1%
// apart), so only exports from Sep 8 on are used. A song's streams this year = its streams on the page (the pub sheet's Luminate all-time: Gross Streams' own number, so the
// two are from one day) minus its Jan 1 count. A song with no such export this year (not in a portfolio, no Luminate ID) counts 0: nothing is estimated. Each of the client's
// song copies counts, as in Gross Streams. Spotify's stand-ins in Gross Streams have no Luminate numbers, so they count 0 here too.
import { sql, rowsOrNoneIfNoTable } from "./db";
import { LUM_BASIS_FROM, olderCount } from "./lum-basis";

// "2026": the year it is in New York
export const nyYear = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric" }).format(now);

// Pure. rows: lum_points, Worldwide [{ lum_id, grain: "ytd" | "atd", on: "YYYY-MM-DD", v }]; year: "2026".
// -> Map(Luminate ID -> { jan1, on }): its count on Jan 1, from the newest day of that year on the current count with both numbers
export function jan1Counts(rows, year) {
  const days = new Map();
  for (const r of rows || []) {
    const on = String(r?.on ?? "").slice(0, 10), v = Number(r?.v);
    if (!r?.lum_id || (r.grain !== "ytd" && r.grain !== "atd") || !/^\d{4}-\d{2}-\d{2}$/.test(on) || on.slice(0, 4) !== String(year) || olderCount(on)) continue;
    if (r.v == null || r.v === "" || !Number.isFinite(v) || v < 0) continue;
    const k = `${r.lum_id}|${on}`;
    (days.get(k) || days.set(k, { id: String(r.lum_id), on }).get(k))[r.grain] = v;
  }
  const out = new Map();
  for (const d of days.values()) {
    if (d.ytd == null || d.atd == null || d.ytd > d.atd) continue; // a year-to-date over its own all-time is no pair
    const cur = out.get(d.id);
    if (!cur || d.on > cur.on) out.set(d.id, { jan1: d.atd - d.ytd, on: d.on });
  }
  return out;
}

// One client's Jan 1 counts ({ year, counts }), for their own songs only (the session's client: pages/api/dashboard-data.js)
export async function jan1For(clientId, year = nyYear()) {
  if (!clientId) return { year, counts: new Map() };
  const from = `${year}-01-01` > LUM_BASIS_FROM ? `${year}-01-01` : LUM_BASIS_FROM;
  const rows = await rowsOrNoneIfNoTable(sql`
    SELECT lum_id, grain, period_to::text AS "on", value::float8 AS v FROM lum_points
    WHERE grain IN ('ytd', 'atd') AND location = 'Worldwide' AND period_to >= ${from}::date AND period_to <= ${`${year}-12-31`}::date
      AND lum_id IN (SELECT luminate_id FROM placements WHERE client_id = ${clientId} AND luminate_id <> '')`);
  return { year, counts: jan1Counts(rows, year) };
}

// Pure. placements: the client's song copies as stored [{ streams, luminate_id }] (or as the page has them, luminateId); jan1: jan1For's answer; day: the day the page's
// streams are from (lib/streams-on.js streamsOn), which must be in jan1's year. -> { total, songs, year } (songs: the copies counted), or null: nothing to show (a dash)
export function yearStreamsOf(placements, jan1, day) {
  if (!jan1?.counts?.size || !day || String(day).slice(0, 4) !== String(jan1.year)) return null;
  let total = 0, songs = 0;
  for (const p of placements || []) {
    const j = jan1.counts.get(String(p?.luminate_id ?? p?.luminateId ?? ""));
    const s = p?.streams == null || p.streams === "" ? NaN : Number(p.streams);
    if (!j || !Number.isFinite(s) || s < j.jan1) continue; // no number, or under its Jan 1 count: the page's number isn't on the count that export is
    total += s - j.jan1;
    songs++;
  }
  return songs ? { total, songs, year: String(jan1.year) } : null;
}
