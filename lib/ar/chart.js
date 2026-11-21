// A&R's big chart (2026-11-20): the pure parts of components/ar/BigChart.jsx (days, axes, gaps, what a hover says, the numbers' words),
// kept apart so the tests can run them without React. Nothing here touches the page, the database or the network.
//
// A series is [{ d: "YYYY-MM-DD", v }] (the server's [day, v] pairs are accepted too). The days are New York days already, so here a day is
// just a number of days since 1970-01-01 and no time zone comes into it. Nothing is filled in: a day with no reading is a GAP, drawn as a
// faint dashed connector and said in words ("No reading Nov 6 – Nov 10"), never a zero and never a straight line across it.
//   step   1 for a series read daily; 7 for Luminate's weeks (the next reading is `step` days after the last one); "auto" for readings with no rhythm (see spacingOf)
//   kind   "level"  a count that goes up and down (monthly listeners, followers)
//          "total"  a running total that only grows (streams, TikTok videos on a sound): a hover also says the gain per day
//          "daily"  each point already IS one day's gain (the daily streams of a roster artist's songs): drawn as bars
const DAY = 864e5;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fx = (n) => Math.round(n * 10) / 10;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// ---------------------------------------------------------------- days
export const dayNum = (d) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY);
export const dayOfNum = (n) => new Date(n * DAY).toISOString().slice(0, 10);
export const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d)) && Number.isFinite(dayNum(d)) && dayOfNum(dayNum(d)) === d; // (month 13 and Feb 30 aren't days)
export const addDays = (d, n) => dayOfNum(dayNum(d) + n);
export const gapDays = (a, b) => dayNum(b) - dayNum(a);
export const weekdayOf = (d) => (((dayNum(d) + 4) % 7) + 7) % 7; // 0 = Sunday
// "Nov 4"
export const shortDay = (d) => { const [, m, day] = String(d).split("-").map(Number); return `${MON[m - 1]} ${day}`; };
// "Thu, Nov 12, 2026"
export const longDay = (d) => { const [y, m, day] = String(d).split("-").map(Number); return `${WDAY[weekdayOf(d)]}, ${MON[m - 1]} ${day}, ${y}`; };

// ---------------------------------------------------------------- numbers, in words
// "1,234,567" (a minus is "−", as everywhere in A&R)
export const exact = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.round(Number(v)).toLocaleString("en-US").replace("-", "−") : "");
// "+123", "−45", "±0"; under 10 a fraction shows one decimal ("+3.4": an average per day)
export function signedText(v) {
  if (v === null || v === "" || !Number.isFinite(Number(v))) return "";
  const n = Number(v), r = Math.abs(n) >= 10 || Number.isInteger(n) ? Math.round(n) : Math.round(n * 10) / 10;
  return r === 0 ? "±0" : `${r > 0 ? "+" : "−"}${Math.abs(r).toLocaleString("en-US", { maximumFractionDigits: 1 })}`;
}
// "+0.6%", "−1.2%", "+123%", "+0.02%"; "0%" when it is nothing
export function pctText(p) {
  if (p === null || !Number.isFinite(Number(p))) return "";
  const a = Math.abs(p), s = a.toFixed(a >= 100 ? 0 : a >= 0.1 ? 1 : 2);
  return Number(s) === 0 ? "0%" : `${p > 0 ? "+" : "−"}${s}%`;
}
// "20K", "1.2M", "999": three digits at most, a trailing zero dropped; `decimals` fixes the decimals (the axis asks for as many as keep its labels apart)
export function compact(v, decimals) {
  const n = Number(v);
  if (v === null || v === "" || !Number.isFinite(n)) return "";
  const a = Math.abs(n), [div, unit] = a >= 1e9 ? [1e9, "B"] : a >= 1e6 ? [1e6, "M"] : a >= 1e3 ? [1e3, "K"] : [1, ""];
  const x = a / div, dec = decimals ?? (unit === "" ? 0 : x >= 100 ? 0 : x >= 10 ? 1 : 2);
  const r = Number(x.toFixed(dec));
  if (r >= 1000 && unit !== "B") return compact(Math.sign(n) * r * div, decimals); // 999,950 rounds up to 1M, not "1000K"
  let s = x.toFixed(dec);
  if (s.includes(".")) s = s.replace(/\.?0+$/, "");
  return s === "0" ? "0" : `${n < 0 ? "−" : ""}${s}${unit}`;
}
// the labels for a list of ticks: as many decimals as the most exact tick needs, so no label is ever rounded (62,500 reads "62.5K", never "63K", and
// 1,000,000 / 1,010,000 read "1M" / "1.01M", not two "1M")
export function tickLabels(ticks) {
  const dec = Math.max(0, ...ticks.map((t) => {
    const a = Math.abs(t), x = a / (a >= 1e9 ? 1e9 : a >= 1e6 ? 1e6 : a >= 1e3 ? 1e3 : 1);
    for (let d = 0; d <= 3; d++) if (Math.abs(Number(x.toFixed(d)) - x) < 1e-9 * Math.max(1, x)) return d;
    return 3;
  }));
  if (dec >= 2 && Math.max(0, ...ticks.map(Math.abs)) < 1e6) return ticks.map(exact); // a tight axis in the thousands: "1,001", not "1.001K"
  return ticks.map((t) => compact(t, dec));
}

// ---------------------------------------------------------------- the series
// [[day, v]] or [{ d, v, ... }] -> [{ d, v }] oldest first, one per day (a later one wins), only real days and real numbers. A null or text value is
// a missing reading, not a 0. Extra fields (n, from) come along.
export function normPoints(points) {
  const m = new Map();
  for (const p of points || []) {
    const d = Array.isArray(p) ? p[0] : p?.d, raw = Array.isArray(p) ? p[1] : p?.v;
    if (!isDay(d) || raw === null || raw === undefined || raw === "" || !Number.isFinite(Number(raw))) continue;
    const o = { d, v: Number(raw) };
    if (!Array.isArray(p)) for (const k of ["n", "from"]) if (p[k] != null) o[k] = p[k];
    m.set(d, o);
  }
  return [...m.values()].sort((a, b) => (a.d < b.d ? -1 : 1));
}

// the range pills: 7D and 30D for a daily series, 30D and 90D for weekly ones; a range the data doesn't more than fill is left out (it would be All)
export const RANGES = { 1: [7, 30], 7: [30, 90] };
export const rangesFor = (points, step = 1) => {
  const span = points.length > 1 ? gapDays(points[0].d, points[points.length - 1].d) : 0;
  return (RANGES[step] || RANGES[1]).filter((r) => span > r);
};
// the readings from `range` days before the newest one (that day's reading included), or all of them
export const inRange = (points, range) => (range === "all" || range == null || !points.length ? points : points.filter((p) => p.d >= addDays(points[points.length - 1].d, -range)));
export const rangeLabel = (r) => (r === "all" ? "All" : `${r}D`);

// how a series is spaced. step 1 (daily) and 7 (weekly) are fixed rhythms: a reading further from the one before than that is after a gap. "auto" is for readings
// with no rhythm (Luminate's all-time totals: one per portfolio export, Aug 13, 18, 27, Oct 22, 29): two of them are a gap only when further apart than twice the
// usual interval (the median over the WHOLE series, so a range pill doesn't change what a gap is) and at least 8 days, and the days with no reading are the ones
// strictly between them. -> { auto, step (the unit of the missing days: 1 for auto), gapOver (days: further apart than this is a gap), snap (days: how close a pointer
// must be to a reading beside a gap to take it), typical (days: the usual interval, for the width of bars) }
export function spacingOf(points, step = 1) {
  if (step !== "auto") return { auto: false, step, gapOver: step, snap: step / 2, typical: step };
  const iv = [];
  for (let i = 1; i < points.length; i++) iv.push(gapDays(points[i - 1].d, points[i].d));
  iv.sort((a, b) => a - b);
  const mid = iv.length ? (iv.length % 2 ? iv[(iv.length - 1) / 2] : (iv[iv.length / 2 - 1] + iv[iv.length / 2]) / 2) : 0;
  return { auto: true, step: 1, gapOver: Math.max(7, 2 * mid), snap: 0.5, typical: Math.max(1, mid) };
}
// "12 days with a reading" (a daily series), "14 weeks with a number" (Luminate's weeks), "5 readings" (no rhythm), "10 days with a gain" (a day's gain): one wording
// for the head of the chart, its aria-label and the caption under it
export const countWords = (n, { kind = "level", step = 1, auto = false } = {}) => (kind === "daily" ? `${n} ${n === 1 ? "day" : "days"} with a gain`
  : n === 1 ? "1 reading" : auto ? `${n} readings` : step === 7 ? `${n} weeks with a number` : `${n} days with a reading`);

// runs of readings that follow each other (no further apart than `gapOver` days: `step` unless the series has no rhythm, see spacingOf), and the gaps between
// runs: { runs: [[index, ...]], gaps: [{ a, b, days, from, to, missing }] }
// from..to are the days with no reading ("No reading Nov 6 – Nov 10" for Nov 5 and Nov 11); a weekly series' missing weeks end a week before the next one
export function segmentsOf(points, step = 1, gapOver = step) {
  const runs = [], gaps = [];
  let cur = [];
  for (let i = 0; i < points.length; i++) {
    if (i && gapDays(points[i - 1].d, points[i].d) > gapOver) {
      const a = points[i - 1], b = points[i], g = gapDays(a.d, b.d);
      gaps.push({ a: i - 1, b: i, days: g, from: addDays(a.d, 1), to: addDays(b.d, -step), missing: Math.max(1, Math.round(g / step) - 1) });
      runs.push(cur); cur = [];
    }
    cur.push(i);
  }
  if (cur.length) runs.push(cur);
  return { runs, gaps };
}

// each reading against the one before: { i, d, v, first, prev, days, consecutive, change, pct, perDay }. consecutive = they are no further apart than `gapOver` days
// (a real day-over-day change; for a series with no rhythm, the change since the previous reading); perDay = the change spread over the days between them (a gain
// per day, true for a gap too)
export function deltasOf(points, step = 1, gapOver = step) {
  return points.map((p, i) => {
    const prev = points[i - 1];
    if (!prev) return { i, d: p.d, v: p.v, first: true, prev: null, days: null, consecutive: false, change: null, pct: null, perDay: null };
    const days = gapDays(prev.d, p.d), change = p.v - prev.v;
    return { i, d: p.d, v: p.v, first: false, prev: { d: prev.d, v: prev.v }, days, consecutive: days <= gapOver, change, pct: prev.v > 0 ? (change / prev.v) * 100 : null, perDay: change / Math.max(1, days) };
  });
}

// the row above the chart, for the readings in the range:
//   level / total: { current, since, days, change, pct, perDay, best } (best = the biggest rise between two readings that follow each other, with its day and the
//                  reading it is since)
//   daily:         { latest, total, avg, best, since, until, days, n } (n = the days with a gain: a day with nothing gained (0) is not one, so it is in neither n nor
//                  the average; best = the biggest day)
export function summarize(points, { step = 1, kind = "level", gapOver = step } = {}) {
  const n = points.length;
  if (!n) return null;
  const first = points[0], last = points[n - 1];
  if (kind === "daily") {
    const moving = points.filter((p) => p.v !== 0), total = points.reduce((a, p) => a + p.v, 0);
    let best = null;
    for (const p of moving) if (!best || p.v >= best.v) best = p;
    return { kind, n: moving.length, latest: { d: last.d, v: last.v }, total, avg: moving.length ? total / moving.length : 0, best: best && best.v > 0 ? { d: best.d, v: best.v } : null, since: first.d, until: last.d, days: gapDays(first.d, last.d) + 1 };
  }
  const days = gapDays(first.d, last.d);
  let best = null;
  for (const x of deltasOf(points, step, gapOver)) if (x.consecutive && !x.first && x.change > 0 && (!best || x.change >= best.change)) best = { d: x.d, change: x.change, from: x.prev.d };
  const change = last.v - first.v;
  return { kind, n, current: { d: last.d, v: last.v }, since: first.d, days, change: n > 1 ? change : null, pct: n > 1 && first.v > 0 ? (change / first.v) * 100 : null, perDay: days > 0 ? change / days : null, best };
}

// ---------------------------------------------------------------- the axes
// the vertical range: 8% of room above and below the data, so a line moving 1,000,000 → 1,020,000 isn't flattened by a scale that starts at 0. It starts at
// 0 (zero: true) only when the data already starts near the bottom (the smallest is a fifth of the biggest or less) or the chart is bars, which need a
// baseline. { min, max, lo, hi, zero }; zero tells the page whether to say "the scale starts at ..." under the chart.
export function yDomain(values, { zero = "auto", pad = 0.08 } = {}) {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return { min: 0, max: 1, lo: 0, hi: 0, zero: true };
  let lo = Math.min(...v), hi = Math.max(...v);
  const base = zero === true || (zero === "auto" && lo >= 0 && lo <= hi * 0.2);
  if (base) {
    lo = Math.min(lo, 0); hi = Math.max(hi, 0);
    const span = hi - lo || 1, min = lo < 0 ? lo - span * pad : 0, max = hi > 0 ? hi + span * pad : 0;
    return { min, max: max > min ? max : min + 1, lo, hi, zero: true };
  }
  const span = hi - lo || Math.max(Math.abs(hi) * 0.02, 1); // a flat line gets a little room too
  let min = lo - span * pad;
  if (lo >= 0 && min < 0) min = 0;
  return { min, max: hi + span * pad, lo, hi, zero: false };
}
// 4 or 5 ticks inside [min, max] on "nice" numbers: 1, 2, 2.5 or 5 times a power of ten (whole numbers: these are counts)
export function niceTicks(min, max, { count = 5, integer = true } = {}) {
  if (!(max > min)) return [min];
  const e0 = Math.floor(Math.log10((max - min) / count)) - 1;
  for (let e = e0; e <= e0 + 14; e++) {
    for (const m of [1, 2, 2.5, 5]) {
      const step = m * 10 ** e;
      if (integer && (step < 1 || (m === 2.5 && step < 10))) continue;
      const first = Math.ceil(min / step - 1e-9), last = Math.floor(max / step + 1e-9);
      if (last - first + 1 <= count) { const t = []; for (let k = first; k <= last; k++) t.push(Math.round(k * step * 1e6) / 1e6); return t; }
    }
  }
  return [min, max];
}
// date ticks from start to end: every day, 2, 3 or 5 days from the first day while that is few enough; else Mondays (every 1 or 2 weeks); else the 1st
// of the month (every 1, 2, 3, 6 or 12 months). max = how many labels fit. year: add '26 (a series that spans more than a year).
export function dateTicks(start, end, { max = 6, year = false } = {}) {
  const span = gapDays(start, end), cap = Math.max(2, Math.floor(max));
  const out = (list) => list.map((d) => ({ d, label: year ? `${shortDay(d)} '${d.slice(2, 4)}` : shortDay(d) }));
  if (span <= 0) return out([start]);
  for (const step of [1, 2, 3, 5]) {
    if (Math.floor(span / step) + 1 > cap) continue;
    const l = [];
    for (let k = 0; k <= span; k += step) l.push(addDays(start, k));
    return out(l);
  }
  for (const step of [7, 14]) {
    const l = [];
    for (let d = addDays(start, (1 - weekdayOf(start) + 7) % 7); d <= end; d = addDays(d, step)) l.push(d);
    if (l.length && l.length <= cap) return out(l);
  }
  const firsts = [];
  for (let y = +start.slice(0, 4), m = +start.slice(5, 7); ;) {
    const d = `${y}-${String(m).padStart(2, "0")}-01`;
    if (d > end) break;
    if (d >= start) firsts.push(d);
    if (++m > 12) { m = 1; y++; }
  }
  for (const k of [1, 2, 3, 6, 12]) { const l = firsts.filter((_, i) => i % k === 0); if (l.length && l.length <= cap) return out(l); }
  return out([start, end]);
}

// ---------------------------------------------------------------- the picture, as numbers
// Everything the SVG draws, worked out for a box w x h, from the readings in range (normPoints + inRange). The page only turns it into shapes.
//   plot / strip   the line's area and the day-over-day bar strip under it ({ x0, x1, y0, y1 }); xa..xb is where the first and last day sit
//   pts            [{ i, d, v, x, y, t }] (t = days from the first reading)
//   runs / gaps    the solid pieces ({ ids, path }) and the dashed connectors between them ({ a, b, x1, y1, x2, y2, from, to, missing })
//   yTicks/xTicks  gridlines with their labels      releases  [{ d, x, names }] inside the range      bars  the main bars (kind "daily")
//   stripBars      [{ i, x, y, w, h, up, change }]: one per reading that follows the one before it (none after a gap); strip.label says what they are
// spacing: spacingOf the WHOLE series (a range's readings alone could give another median); without it, the readings given are the series
export function buildChart({ points, step = 1, spacing, kind = "level", releases = [], w = 960, h = 340, zero } = {}) {
  const pts = points || [], n = pts.length, daily = kind === "daily", sp = spacing || spacingOf(pts, step);
  const dom = yDomain(pts.map((p) => p.v), { zero: daily ? true : zero ?? "auto" });
  const tickV = niceTicks(dom.min, dom.max, { count: 5 }), labels = tickLabels(tickV);
  const left = Math.max(34, Math.round(Math.max(1, ...labels.map((s) => s.length)) * 6.6 + 14)), right = 14;
  const stripH = daily || n < 2 ? 0 : h >= 300 ? 44 : h >= 230 ? 38 : 30, gapH = stripH ? 18 : 0, top = 12, labelsH = 22; // (the 18px above the strip hold its label)
  const plot = { x0: left, x1: w - right, y0: top, y1: Math.max(top + 40, h - labelsH - stripH - gapH - 6) };
  const xa = plot.x0 + 8, xb = plot.x1 - 8;
  const start = n ? pts[0].d : null, end = n ? pts[n - 1].d : null, span = n > 1 ? gapDays(start, end) : 0;
  const x = (d) => (span ? xa + (gapDays(start, d) / span) * (xb - xa) : (xa + xb) / 2);
  const y = (v) => plot.y1 - ((v - dom.min) / (dom.max - dom.min || 1)) * (plot.y1 - plot.y0);
  const P = pts.map((p, i) => ({ i, d: p.d, v: p.v, x: fx(x(p.d)), y: fx(y(p.v)), t: gapDays(start, p.d) }));
  const seg = segmentsOf(pts, sp.step, sp.gapOver);
  const runs = seg.runs.map((ids) => ({ ids, path: ids.length > 1 ? ids.map((i, k) => `${k ? "L" : "M"}${P[i].x},${P[i].y}`).join(" ") : null }));
  const gaps = seg.gaps.map((g) => ({ ...g, x1: P[g.a].x, y1: P[g.a].y, x2: P[g.b].x, y2: P[g.b].y }));
  const yTicks = tickV.map((v, k) => ({ v, y: fx(y(v)), label: labels[k] }));
  const xTicks = n ? dateTicks(start, end, { max: Math.max(2, Math.floor((xb - xa) / 76)), year: span > 330 }).map((t) => ({ ...t, x: fx(x(t.d)) })) : [];
  const rel = new Map();
  for (const r of releases || []) if (n && r?.d >= start && r.d <= end) rel.set(r.d, [...(rel.get(r.d) || []), r.name || "Release"]);
  const relOut = [...rel].map(([d, names]) => ({ d, x: fx(x(d)), names })).sort((a, b) => (a.d < b.d ? -1 : 1));
  const bw = Math.max(2, Math.min(28, ((xb - xa) / ((span || 0) / sp.typical + 1)) * 0.66));
  let strip = null, stripBars = [], bars = [];
  if (stripH) {
    const ds = deltasOf(pts, sp.step, sp.gapOver).filter((x) => x.consecutive && !x.first && Number.isFinite(x.change));
    const up = Math.max(0, ...ds.map((x) => x.change)), down = Math.max(0, ...ds.map((x) => -x.change)), tot = up + down;
    const y0 = plot.y1 + gapH, zeroY = tot ? y0 + (stripH * up) / tot : y0 + stripH;
    strip = { x0: plot.x0, x1: plot.x1, y0, y1: y0 + stripH, zeroY: fx(zeroY), label: sp.auto ? "Change since previous reading" : sp.step === 1 ? "Change since the day before" : sp.step === 7 ? "Change since the week before" : "Change since the previous reading" };
    stripBars = ds.filter((x) => x.change !== 0).map((x) => {
      const ht = Math.max(1, (stripH * Math.abs(x.change)) / tot);
      return { i: x.i, x: fx(P[x.i].x - bw / 2), y: fx(x.change > 0 ? zeroY - ht : zeroY), w: fx(bw), h: fx(ht), up: x.change > 0, change: x.change };
    });
  }
  if (daily) {
    const zy = y(0);
    bars = P.filter((p) => p.v !== 0).map((p) => ({ i: p.i, x: fx(p.x - bw / 2), y: fx(p.v >= 0 ? p.y : zy), w: fx(bw), h: fx(Math.max(1, Math.abs(p.y - zy))), up: p.v >= 0 })); // (a day with nothing gained has no bar)
  }
  return { w, h, kind, step: sp.step, sp, plot, strip, xa, xb, bw: fx(bw), start, end, span, dom, zero: dom.zero, pts: P, runs, gaps, yTicks, xTicks, releases: relOut, bars, stripBars, x, y, zeroY: fx(y(0)) };
}

// what the pointer is over, from its x in the chart's own units: between two readings that follow each other (no further apart than the series' gapOver) the nearer
// one; beside a gap, a reading only when the pointer is within `snap` days of it, else the gap
// -> { type: "point", i } | { type: "gap", a, b, from, to, missing, x } | null
export function hitAt(model, px) {
  const { pts, sp, xa, xb, span } = model, n = pts.length;
  if (!n) return null;
  if (n === 1) return { type: "point", i: 0 };
  const t = clamp((px - xa) / (xb - xa || 1), 0, 1) * span;
  const b = pts.findIndex((p) => p.t >= t);
  if (b <= 0 || pts[b].t === t) return { type: "point", i: Math.max(0, b) };
  const a = b - 1, da = t - pts[a].t, db = pts[b].t - t, near = da <= db ? a : b;
  if (pts[b].t - pts[a].t <= sp.gapOver || Math.min(da, db) <= sp.snap + 1e-9) return { type: "point", i: near };
  const g = segmentsOf([pts[a], pts[b]], sp.step, sp.gapOver).gaps[0];
  return { type: "gap", a, b, from: g.from, to: g.to, missing: g.missing, x: clamp(px, xa, xb) };
}
// ←/→ move between readings (nothing selected yet: the newest); "home"/"end" jump
export const moveIndex = (cur, key, n) => (!n ? null : key === "home" ? 0 : key === "end" ? n - 1 : cur == null ? n - 1 : clamp(cur + (key === "left" ? -1 : 1), 0, n - 1));

// ---------------------------------------------------------------- what a hover says
const dayRange = (a, b) => (a === b ? shortDay(a) : `${shortDay(a)} – ${shortDay(b)}`);
const noun = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// the releases in a tooltip: three at most, each name cut at 40 characters, then "and N more" (a long gap can hold dozens; the tooltip stays small enough to stay
// inside the plot)
const REL_SHOWN = 3, REL_NAME = 40;
const relCap = (list) => {
  const names = list.map((r) => { const nm = r.name || "Release"; return `${nm.length > REL_NAME ? `${nm.slice(0, REL_NAME - 1)}…` : nm} (${shortDay(r.d)})`; });
  return { releases: names.slice(0, REL_SHOWN), more: Math.max(0, names.length - REL_SHOWN) };
};
const relSay = (c) => (c.releases.length ? ` Released: ${c.releases.join(", ")}${c.more ? ` and ${c.more} more` : ""}.` : "");
// the tooltip for a hit: { gap, title, value, lines, releases, more, text }. A reading: the full date, the exact number, the change since the reading before it
// (with its day, and how many days earlier when it isn't the day before), a total's gain per day, and the releases since that reading. A gap: the days with
// no reading. A week point (`from` set) is titled by its week. `step` = the usual days between readings (1 for a series with no rhythm).
export function tipOf({ points, hit, step = 1, kind = "level", unit = "", releases = [], songs = null }) {
  if (!hit) return null;
  if (hit.type === "gap") {
    const a = points[hit.a], b = points[hit.b];
    const title = `${kind === "daily" ? "No daily gain" : "No reading"} ${dayRange(hit.from, hit.to)}`;
    const lines = [kind === "daily" ? `A day's gain needs a reading on both days. Last: ${shortDay(a.d)}, next: ${shortDay(b.d)}.` : `Last reading ${shortDay(a.d)}, next ${shortDay(b.d)}.`];
    const c = relCap((releases || []).filter((x) => x.d >= hit.from && x.d <= hit.to));
    return { gap: true, title, value: "", lines, ...c, text: `${title}. ${lines.join(" ")}${relSay(c)}` };
  }
  const p = points[hit.i], prev = points[hit.i - 1], days = prev ? gapDays(prev.d, p.d) : null;
  const title = p.from && p.from !== p.d ? `Week ${shortDay(p.from)} – ${shortDay(p.d)}, ${p.d.slice(0, 4)}` : longDay(p.d);
  const value = `${exact(p.v)}${unit ? ` ${unit}` : ""}`;
  const lines = [];
  if (kind === "daily") {
    // a day's gain is only compared with the day's gain just before it (a gain 7 days back says nothing about today)
    if (prev && days <= step) { const change = p.v - prev.v; lines.push(`${signedText(change)}${prev.v > 0 ? ` (${pctText((change / prev.v) * 100)})` : ""} vs ${shortDay(prev.d)}`); }
  } else if (prev) {
    const change = p.v - prev.v, pct = prev.v > 0 ? (change / prev.v) * 100 : null;
    lines.push(`${signedText(change)}${pct === null ? "" : ` (${pctText(pct)})`} since ${shortDay(prev.d)}${days > step ? ` (${noun(days, "day", "days")} earlier)` : ""}`);
    if (kind === "total") lines.push(`${signedText(change / days)} a day${days > 1 ? `, over those ${days} days` : ""}`);
  } else lines.push("First reading");
  if (p.n != null) lines.push(songs && p.n < songs ? `${p.n} of their ${songs} songs had a reading both days` : `${noun(p.n, "song", "songs")} counted`);
  const c = relCap((releases || []).filter((x) => x.d <= p.d && (prev ? x.d > prev.d : x.d === p.d)));
  return { gap: false, title, value, lines, ...c, text: `${title}: ${value}. ${lines.join(". ")}.${relSay(c)}` };
}

// the chart's aria-label: what it is, how many readings from when to when, where it stands, its low and high, the gaps and the releases marked
export function ariaSummary({ label = "", points, step = 1, gapOver = step, auto = false, kind = "level", unit = "", releases = [] }) {
  const n = points.length, what = label || "Chart";
  if (!n) return `${what}: no readings yet.`;
  const first = points[0], last = points[n - 1], u = unit ? ` ${unit}` : "";
  const parts = [`${what}, ${kind === "daily" ? "bar chart" : "line chart"}: ${countWords(n, { kind, step, auto })}${n > 1 ? ` from ${shortDay(first.d)} to ${shortDay(last.d)}` : ` on ${shortDay(first.d)}`}.`];
  if (kind === "daily") {
    const s = summarize(points, { kind });
    parts.push(`Latest day ${exact(last.v)}${u} on ${shortDay(last.d)}; ${exact(s.total)}${u} in all, ${exact(s.avg)} a day on average.`);
  } else {
    const lo = points.reduce((a, p) => (p.v < a.v ? p : a)), hi = points.reduce((a, p) => (p.v > a.v ? p : a));
    parts.push(`Latest ${exact(last.v)}${u} on ${shortDay(last.d)}.`);
    if (n > 1) {
      const pct = first.v > 0 ? ` (${pctText(Math.abs(((last.v - first.v) / first.v) * 100)).replace("+", "")})` : "";
      parts.push(`${last.v === first.v ? "No change" : `${last.v > first.v ? "Up" : "Down"} ${exact(Math.abs(last.v - first.v))}${pct}`} since ${shortDay(first.d)}. Lowest ${exact(lo.v)} on ${shortDay(lo.d)}, highest ${exact(hi.v)} on ${shortDay(hi.d)}.`);
    }
  }
  const { gaps } = segmentsOf(points, step, gapOver);
  if (gaps.length) parts.push(`${kind === "daily" ? "No daily gain" : "No reading"} ${gaps.slice(0, 3).map((g) => dayRange(g.from, g.to)).join("; ")}${gaps.length > 3 ? ` and ${gaps.length - 3} more gaps` : ""}.`);
  const inside = (releases || []).filter((r) => r.d >= first.d && r.d <= last.d);
  if (inside.length) parts.push(`${noun(inside.length, "release", "releases")} marked: ${inside.slice(0, 3).map((r) => `${r.name || "Release"} on ${shortDay(r.d)}`).join("; ")}${inside.length > 3 ? ` and ${inside.length - 3} more` : ""}.`);
  return parts.join(" ");
}

// ---------------------------------------------------------------- captions and the momentum words
// under each chart: what it measures and where it comes from, in plain words (the page adds how many readings and the dates)
export const CAPTION = {
  listeners: "Monthly listeners: the number Spotify shows on their public page (people who played their music in the last 28 days), read once a day.",
  spfollowers: "Spotify followers: the number Spotify shows on their public page, read once a day.",
  streams: "Spotify streams: this song's total plays so far, a running total that only grows, read once a day from Spotify's public play count.",
  tiktok: "TikTok followers: the number on their public TikTok profile, read once a day. TikTok rounds it once it is over 10,000, so a small move can be rounding.",
  instagram: "Instagram followers: the number on their public Instagram profile, read once a day.",
  youtube: "YouTube subscribers: the number on their channel, which YouTube rounds, read once a day.",
  videos: "TikTok videos using this sound: a running total from the sound's public page, read once a day. TikTok rounds it once it is over 10,000, so a small gain can be rounding.",
  songStreams: "Daily streams across their songs: each day's gain is Spotify's play count that day minus the day before's, added up over the songs. A day only counts for a song when both days were read.",
  lumWeek: "Luminate streams for each week, all platforms (not only Spotify), from the weekly exports. A week with no export is a gap.",
  lumAtd: "Luminate's all-time streams at each export, all platforms (not only Spotify).",
};

// "Streams 80 (weight 40%) · Followers 65 (30%) · TikTok sounds 60 (30%)" and the line that explains it. m: { score, day, parts, weights, why }, parts as
// lib/ar/momentum.js scoreOf makes them ({ streams: { points, growth, text, weight }, ... }). A part's share is its weight over the weights of the parts the
// artist has (no TikTok sounds: it isn't counted, and the other two share the score). null when there is no score.
export const MOMENTUM_PARTS = [["streams", "Streams"], ["followers", "Followers"], ["tiktok", "TikTok sounds"]];
export function momentumWords(m) {
  if (!m || m.score === null || m.score === undefined || !Number.isFinite(Number(m.score))) return null;
  const parts = m.parts || {}, w = m.weights || {};
  const weightOf = (k) => { const own = Number(parts[k]?.weight); return Number.isFinite(own) ? own : Number(w[k]) || 0; };
  const have = MOMENTUM_PARTS.filter(([k]) => parts[k] && Number.isFinite(Number(parts[k].points)));
  const counted = have.filter(([k]) => weightOf(k) > 0), total = counted.reduce((a, [k]) => a + weightOf(k), 0);
  const items = have.map(([k, label]) => {
    const on = weightOf(k) > 0;
    return { key: k, label, points: Math.round(Number(parts[k].points)), pct: on && total ? Math.round((weightOf(k) / total) * 100) : 0, counted: on, text: parts[k].text || "" };
  });
  const left = MOMENTUM_PARTS.filter(([k]) => !parts[k] && Number(w[k]) > 0).map(([, label]) => label); // wanted by the weights, but nothing to count
  const bits = items.filter((x) => x.counted).map((x, i) => `${x.label} ${x.points} (${i ? "" : "weight "}${x.pct}%)`);
  const line = `Score ${Math.round(Number(m.score))}${bits.length ? ` · ${bits.join(" · ")}` : ""} — each part is 50 when flat, higher when growing faster than usual, mostly from the last 7 days`;
  return { score: Math.round(Number(m.score)), day: m.day || null, items, left, recent: Number.isFinite(Number(w.recent)) ? Number(w.recent) : null, line, why: m.why || "" };
}

// "Score 71" and what it did: m = { score, delta, vs } as lib/ar/lists.js gives a row's momentum (delta = the score against the one kept on `vs`: about a week ago, else
// the last one before today, lib/ar/momentum.js trendOf). today = the day of the score ("yesterday" when vs is the day before). Says it as a number going up or down
// (the old "71 falling" beside "listeners +14% this week" read as a contradiction: a score can fall while one number on it rises).
export function momentumHead(m, today = null) {
  if (!m || m.score === null || m.score === undefined || !Number.isFinite(Number(m.score))) return null;
  const score = Math.round(Number(m.score)), delta = m.delta === null || m.delta === undefined ? null : Number(m.delta);
  if (delta === null || !Number.isFinite(delta)) return { score, dir: "flat", move: "the first score kept, nothing to compare it with yet", text: `Score ${score}, the first score kept` };
  const since = m.vs ? (today && isDay(today) && isDay(m.vs) && gapDays(m.vs, today) === 1 ? "yesterday" : shortDay(m.vs)) : "the score before";
  const dir = Math.abs(delta) < 0.05 ? "flat" : delta > 0 ? "up" : "down";
  const move = dir === "flat" ? `unchanged since ${since}` : `${dir} ${Math.abs(delta).toFixed(1)} since ${since}`;
  return { score, dir, move, text: `Score ${score}, ${move}` };
}

// ---------------------------------------------------------------- release markers (server: lib/ar/lists.js arItem)
// rows [{ name, d }] (a placement's release date or a Spotify album's, as text) -> [{ d, name }], newest first, at most `cap`: only whole dates (YYYY-MM-DD; "2026"
// or "2026-11" can't sit on a day axis), only inside from..to (when given), a name once a day.
export function releasesOf(rows, { from = null, to = null, cap = 60 } = {}) {
  const seen = new Set(), out = [];
  for (const r of rows || []) {
    const d = /^(\d{4}-\d{2}-\d{2})(?:$|T|\s)/.exec(String(r?.d ?? ""))?.[1];
    if (!d || !isDay(d) || (from && d < from) || (to && d > to)) continue;
    const name = String(r?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 100) || "Release", key = `${d}|${name.toLowerCase()}`;
    if (!seen.has(key)) { seen.add(key); out.push({ d, name }); }
  }
  return out.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : a.name.localeCompare(b.name))).slice(0, cap);
}
