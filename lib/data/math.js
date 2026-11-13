// List B #4: the math on the dated snapshots. Pure. A series is [[day "YYYY-MM-DD" (New York), value]], oldest
// first, one value a day (the day's newest). Nothing is filled in: a number we don't have stays null.
const DAY = 86400000;
// (2026-11-13) New York days, as A&R's (lib/ar/lists.js): a 7 PM reading is that day's, not the next UTC day's, so
// Home, the ticker and A&R measure a week from the same reading (they disagreed on crumley's followers)
const NY_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
export const dayOf = (t) => NY_DAY.format(new Date(t));
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const gapDays = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

// snapshots [{ value, taken_at }] -> series (the newest of each day). Each point keeps its reading's time as p.time
// (ms) for weekOver below; JSON leaves it out, so the page still gets [day, value].
export function toSeries(snaps) {
  const m = new Map();
  for (const s of [...snaps].sort((a, b) => new Date(a.taken_at) - new Date(b.taken_at))) {
    const v = Number(s.value), day = dayOf(s.taken_at);
    if (Number.isFinite(v)) m.set(day, Object.assign([day, v], { time: new Date(s.taken_at).getTime() }));
  }
  return [...m.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

// the value on `day`, else the nearest day within `slack` days of it (the earlier one on a tie)
export function valueAt(series, day, slack = 1) {
  let best = null, gap = Infinity;
  for (const p of series) {
    const g = Math.abs(gapDays(p[0], day));
    if (g <= slack && (g < gap || (g === gap && p[0] < best[0]))) { best = p; gap = g; }
  }
  return best;
}

// how far from the day it wants a week may look: a day for a series read daily (its last two gaps a day each), else 2
// (a weekly one: a week apart give or take a cron's drift, even with one extra reading). From the series itself, so
// Home and A&R always look alike.
export function slackOf(series) {
  const k = series?.length || 0, gap = (i) => gapDays(series[i - 1][0], series[i][0]);
  return k < 2 || (gap(k - 1) === 1 && (k < 3 || gap(k - 2) === 1)) ? 1 : 2;
}
// the whole days of counts between two readings, from their own times (toSeries keeps them; else their days). Whole
// days, because Spotify's count moves once a day: on Nov 5 every song read +0 from 00:00 to 12:03 UTC, so the 7 PM
// Nov 4 reading and Nov 10's 9:34 AM one are 5 days of plays apart, not 5.4
const timeOf = (p) => p.time ?? Date.parse(`${p[0]}T00:00:00Z`);
const daysOf = (a, b) => Math.max(1, Math.round((timeOf(b) - timeOf(a)) / DAY));

// The week on week, worked out one way for Home, the client pages, the ticker, the digest (stats below) and A&R
// (lib/ar/lists.js cellOf). (2026-11-13: with no readings on Nov 6, and in the first days, a "week" ran 6 or 8 days
// but was compared as 7, so a steady song read +19% one day and -11% another.)
//   w0, w1     the readings nearest 7 days before the newest, and 7 days before w0 (within `slack` days)
//   thisWeek   the newest count minus w0's, over the days it really covers: weekDays (daysOf above), from .. day
//   lastWeek   w0's count minus w1's, put at this week's length (per day), so this week against it is
//              a fair % when one of them ran 6 or 8 days
export function weekOver(series, { slack = slackOf(series) } = {}) {
  if (!series?.length) return null;
  const newest = series[series.length - 1], [day, latest] = newest;
  const w0 = valueAt(series, addDays(day, -7), slack), w1 = w0 && valueAt(series, addDays(w0[0], -7), slack);
  const thisWeek = w0 ? latest - w0[1] : null, weekDays = w0 ? daysOf(w0, newest) : null;
  const last = w0 && w1 ? ((w0[1] - w1[1]) * weekDays) / daysOf(w1, w0) : null;
  const pct = thisWeek != null && last != null && last > 0 ? thisWeek / last - 1 : null;
  return { day, latest, w0, w1, thisWeek, lastWeek: last == null ? null : Math.round(last), pct, weekDays, from: w0 ? addDays(day, 1 - weekDays) : null };
}

// Daily = today's count minus yesterday's (only when the two are a day apart). This week, last week, % change, weekDays
// and from (this week's length and first day): weekOver above. growthPct = this week's gain against the count a week
// ago (followers).
export function stats(series, { slack } = {}) {
  if (!series?.length) return null;
  const [day, latest] = series[series.length - 1];
  const prev = series.length > 1 ? series[series.length - 2] : null;
  const daily = prev && gapDays(prev[0], day) === 1 ? latest - prev[1] : null;
  const { w0, thisWeek, lastWeek, pct, weekDays, from } = weekOver(series, { slack });
  const growthPct = thisWeek != null && w0[1] > 0 ? thisWeek / w0[1] : null;
  return { latest, day, daily, thisWeek, lastWeek, pct, growthPct, weekDays, from, since: series[0][0], points: series.length };
}

// day-to-day gains, only between days that are one apart: [[day, gain]]
export function dailyGains(series) {
  const g = [];
  for (let i = 1; i < series.length; i++) if (gapDays(series[i - 1][0], series[i][0]) === 1) g.push([series[i][0], series[i][1] - series[i - 1][1]]);
  return g;
}

// A spike: the last two days' gain is at least 3x the usual two days (the 7 days before them) and at
// least `min`. Two days, because Spotify's count sometimes lands a day late (0, then double).
export function spikeOf(series, { min = 1000 } = {}) {
  const g = dailyGains(series);
  if (g.length < 5) return null;
  const last2 = g.slice(-2), prior = g.slice(-9, -2);
  if (last2.length < 2 || gapDays(last2[0][0], last2[1][0]) !== 1 || prior.length < 3) return null;
  const recent = last2[0][1] + last2[1][1];
  const usual = (prior.reduce((a, [, v]) => a + v, 0) / prior.length) * 2;
  if (recent >= min && recent >= 3 * Math.max(usual, 1)) return { day: last2[1][0], gain: recent, times: usual > 0 ? recent / usual : null };
  return null;
}

// A week that jumps: this week's gain at least `min` and 50% over last week's (or, for followers, at
// least `growth` of the count)
export function weekJump(st, { min = 1000, growth = null } = {}) {
  if (!st || st.thisWeek == null || st.thisWeek < min) return null;
  if (st.pct != null && st.pct >= 0.5) return { gain: st.thisWeek, pct: st.pct };
  if (growth != null && st.growthPct != null && st.growthPct >= growth) return { gain: st.thisWeek, growthPct: st.growthPct };
  return null;
}

const lastBy = (series, day) => { let v = null; for (const p of series) if (p[0] <= day) v = p; return v; };
// several series summed day by day, each carried forward from its last count (all-time totals only
// grow), on the days any of them has a count, from the first day all of them have one
export function sumSeries(list) {
  const live = list.filter((s) => s?.length);
  if (!live.length) return [];
  const start = live.map((s) => s[0][0]).sort().pop();
  const days = [...new Set(live.flatMap((s) => s.map(([d]) => d)))].filter((d) => d >= start).sort();
  return days.map((d) => [d, live.reduce((a, s) => a + (lastBy(s, d)?.[1] ?? 0), 0)]);
}

// totals for a group of songs: only the songs that have each number count toward it
export function sumStats(list) {
  const has = (k) => list.filter((s) => s && s[k] != null);
  const add = (k) => (has(k).length ? has(k).reduce((a, s) => a + s[k], 0) : null);
  const both = list.filter((s) => s && s.thisWeek != null && s.lastWeek != null);
  const tw = both.reduce((a, s) => a + s.thisWeek, 0), lw = both.reduce((a, s) => a + s.lastWeek, 0);
  return { latest: add("latest"), daily: add("daily"), thisWeek: add("thisWeek"), lastWeek: both.length ? lw : null, pct: both.length && lw > 0 ? (tw - lw) / lw : null, songs: has("latest").length };
}
