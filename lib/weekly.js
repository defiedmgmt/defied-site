// Week-on-week numbers, worked out one way for the roster's songs and artists and for the A&R lists
// (list B #3: from the automated numbers' daily Spotify counts, lib/data/math.js; Luminate's weekly
// exports are gone). Pure: the server ranks, the page only draws.
export const TOP_MIN = 1000; // streams this week an item needs before its % can rank it (a 10 → 100 song can't top the list)
export const TOP_N = 5;
// null when there was nothing last week (no % from zero)
export const wowOf = (thisWeek, lastWeek) => (thisWeek != null && lastWeek > 0 ? (thisWeek / lastWeek - 1) * 100 : null);

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
// ranked: false (shown without a %) and why: "history" (no week before yet) or "streams" (under TOP_MIN
// this week), each reason's together (2026-11-13: Q&A's 288,454 sat under "Not enough streams for a % yet"
// when it had no week before). A drop is never in a rise list (list A 3).
export function rankTop(items, { min = TOP_MIN, n = TOP_N } = {}) {
  const measured = (x) => x.thisWeek != null && x.thisWeek >= min && x.lastWeek > 0 && x.wowPct != null;
  const fits = (x) => measured(x) && x.wowPct >= 0;
  const top = items.filter(fits).sort((a, b) => b.wowPct - a.wowPct || b.thisWeek - a.thisWeek).slice(0, n).map((x) => ({ ...x, ranked: true }));
  if (top.length < n) {
    const rest = items.filter((x) => !measured(x) && x.thisWeek != null).sort((a, b) => b.thisWeek - a.thisWeek);
    const why = (x) => (x.lastWeek > 0 && x.wowPct != null ? "streams" : "history");
    top.push(...rest.slice(0, n - top.length).map((x) => ({ ...x, ranked: false, why: why(x) })).sort((a, b) => (a.why === b.why ? 0 : a.why === "history" ? -1 : 1)));
  }
  return top;
}
