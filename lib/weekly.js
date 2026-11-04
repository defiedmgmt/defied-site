// Week-on-week numbers, worked out one way for the roster's songs and artists and for the A&R lists.
// Pure: the server ranks, the page only draws. With the owner's export setting (1 week, Worldwide) an
// export's This Period is the 7 days up to the day Luminate made it and Last Period the 7 before, so
// the change is This / Last − 1 (Luminate's own "Streams (% Change)"). An older export (This Period =
// all time, no Last Period) has no week of its own: three exports of it about a week apart give one
// from their all-time counts; otherwise there is no week-on-week % for it.
export const TOP_MIN = 1000; // streams this week an item needs before its % can rank it (a 10 → 100 song can't top the list)
export const TOP_N = 5;
const DAY = 864e5;
const dayMs = (iso) => Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
export const addDay = (iso, n) => new Date(dayMs(iso) + n * DAY).toISOString().slice(0, 10);
// the day Luminate made an export, in New York (the dates the owner reads)
export const exportDay = (at) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

// null when there was nothing last week (no % from zero)
export const wowOf = (thisWeek, lastWeek) => (thisWeek != null && lastWeek > 0 ? (thisWeek / lastWeek - 1) * 100 : null);

// One entity's week from its own export rows ({ period, last } = This / Last Period streams), or null
// for an export with no Last Period row, or one whose period was longer than a week (longPeriod)
export function weekFromRows(e, day) {
  if (e?.longPeriod) return null;
  const thisWeek = num(e?.period), lastWeek = num(e?.last);
  if (thisWeek == null || lastWeek == null) return null;
  return { thisWeek, lastWeek, wowPct: wowOf(thisWeek, lastWeek), weekOf: { from: addDay(day, -6), to: day } };
}

// Was a weekly-layout export (This and Last Period rows) really made with the period set to 1 week?
// Two checks, either is enough. A: when its two periods both fall in this year, This + Last can't be
// more than Year to Date; on 3+ rows (or 10%+) it is, so each period is longer. B: against an older
// export of the same portfolio 7+ days before it, This ÷ the all-time growth since then × the gap in
// weeks is about how many weeks This covers (rows that grew 1,000+). Returns { long, weeks } (weeks
// rounded, 2 or more when long) or null for a file with no Last Period rows. older = { exportedAt,
// entities }. Pure.
const median = (xs) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export function periodCheck(x, older) {
  const rows = (x?.entities || []).filter((e) => num(e.period) != null && num(e.last) != null);
  if (!rows.length || !x.exportedAt) return null;
  const day = exportDay(x.exportedAt);
  let weeksA = null, weeksB = null;
  if (addDay(day, -14).slice(0, 4) === day.slice(0, 4)) {
    const withYtd = rows.filter((e) => num(e.ytd) > 0);
    const over = withYtd.filter((e) => e.period + e.last > e.ytd * 1.001);
    if (over.length >= 3 || (over.length && over.length >= withYtd.length * 0.1)) {
      // This ÷ Year to Date × the weeks since Jan 1: about how many weeks This covers
      const sinceJan1 = (dayMs(day) - dayMs(`${day.slice(0, 4)}-01-01`)) / DAY + 1;
      weeksA = median(over.map((e) => e.period / e.ytd)) * sinceJan1 / 7;
    }
  }
  if (older?.exportedAt && older.entities?.length) {
    const gap = (dayMs(day) - dayMs(exportDay(older.exportedAt))) / DAY;
    const before = new Map(older.entities.map((e) => [e.id, num(e.atd)]));
    const grew = gap >= 7 ? rows.filter((e) => before.get(e.id) != null && num(e.atd) - before.get(e.id) > 1000) : [];
    if (grew.length) weeksB = median(grew.map((e) => e.period / (e.atd - before.get(e.id)))) * gap / 7;
  }
  const long = weeksA != null || (weeksB != null && weeksB > 2);
  return { long, weeks: long ? Math.max(2, Math.round(weeksB != null && weeksB > 2 ? weeksB : weeksA ?? weeksB)) : 1 };
}
export const longPeriodNote = (weeks) => `This file covers more than one week (about ${weeks} weeks). Its all-time numbers are used; for this week's numbers, export it again with the period set to 1 week.`;

// a week that ended more than this many days before asOf (the newest export) is no longer this week's
export const STALE_DAYS = 8;
export const staleWeek = (to, asOf) => !!asOf && (dayMs(asOf) - dayMs(to)) / DAY > STALE_DAYS;

// From all-time snapshots ([[day, streams], …] oldest first): the newest three, when each gap is 6–8
// days (this week = 3rd − 2nd, last week = 2nd − 1st). A count that went down (a one-country export)
// gives no week, and so does one whose newest snapshot is stale next to asOf (a portfolio that stopped
// being exported doesn't keep ranking its last week).
export function weekFromSnapshots(series, asOf) {
  if (!series || series.length < 3) return null;
  const [a, b, c] = series.slice(-3);
  const gap = (x, y) => (dayMs(y[0]) - dayMs(x[0])) / DAY;
  if ([gap(a, b), gap(b, c)].some((g) => g < 6 || g > 8) || staleWeek(c[0], asOf)) return null;
  const thisWeek = c[1] - b[1], lastWeek = b[1] - a[1];
  if (thisWeek < 0 || lastWeek < 0) return null;
  return { thisWeek, lastWeek, wowPct: wowOf(thisWeek, lastWeek), weekOf: { from: addDay(b[0], 1), to: c[0] } };
}

// the items whose week ends on the newest day among them, so a sum is one real week, not two
export function sameWeek(items) {
  const to = items.map((x) => x?.weekOf?.to).filter(Boolean).sort().pop();
  return to ? items.filter((x) => !x?.weekOf || x.weekOf.to === to) : items;
}

// several items' weeks added up (a roster artist = their songs that have both weeks, in the same week)
export function sumWeeks(weeks) {
  const both = sameWeek(weeks.filter((w) => w && w.thisWeek != null && w.lastWeek != null));
  if (!both.length) return null;
  const thisWeek = both.reduce((s, w) => s + w.thisWeek, 0), lastWeek = both.reduce((s, w) => s + w.lastWeek, 0);
  return { thisWeek, lastWeek, wowPct: wowOf(thisWeek, lastWeek), weekOf: spanOf(both) };
}

// the days a list covers: its earliest week's first day to its newest week's last ("Oct 23 – 29")
export function spanOf(items) {
  const w = items.map((x) => x?.weekOf).filter(Boolean);
  if (!w.length) return null;
  return { from: w.map((x) => x.from).sort()[0], to: w.map((x) => x.to).sort().pop() };
}

// Full lists: biggest % first; no % goes last, by this week's streams (none at all at the very end)
export function byWow(a, b) {
  const pa = a.wowPct ?? null, pb = b.wowPct ?? null;
  if (pa != null || pb != null) { if (pa == null) return 1; if (pb == null) return -1; if (pb !== pa) return pb - pa; }
  return (b.thisWeek ?? -1) - (a.thisWeek ?? -1);
}

// Top lists ("biggest % rise first"): the biggest rises among items with at least TOP_MIN streams this
// week and some last week; short of n, the ones with no % yet fill in by this week's streams, marked
// ranked: false (shown without a %). A drop is never in a rise list (list A 3).
export function rankTop(items, { min = TOP_MIN, n = TOP_N } = {}) {
  const measured = (x) => x.thisWeek != null && x.thisWeek >= min && x.lastWeek > 0 && x.wowPct != null;
  const fits = (x) => measured(x) && x.wowPct >= 0;
  const top = items.filter(fits).sort((a, b) => b.wowPct - a.wowPct || b.thisWeek - a.thisWeek).slice(0, n).map((x) => ({ ...x, ranked: true }));
  if (top.length < n) {
    const rest = items.filter((x) => !measured(x) && x.thisWeek != null).sort((a, b) => b.thisWeek - a.thisWeek);
    top.push(...rest.slice(0, n - top.length).map((x) => ({ ...x, ranked: false })));
  }
  return top;
}
