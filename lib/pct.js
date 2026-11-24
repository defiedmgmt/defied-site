// A song's split percents, said and kept exactly (2026-11-23, the owner: "dont know why some decimals are removed 33 shld be 33.33 and
// 17 shld eb 16.66 this shld be everywhere its important to be exact", then "nah ur right its .67"). One rule for the whole site, pure:
//   roundPct / splitPct  a percent to two decimals, half up, float-safe; splitPct is the text with no trailing zeros
//                        ("50", "33.33", "16.67", "12.5", "66.67"): every screen and sentence that names a split's share says it this way
//   snapSplits           the split to SAVE: a share typed to two decimals that is really a third, a sixth, a seventh, a ninth, an eleventh or a twelfth
//                        (16.67, 33.33, 14.29, 8.33) is kept as the exact fraction it means (16.666…, 33.333…), each share on its own, and the whole
//                        comes out as exactly 100. A share a person can type exactly (25, 12.5, 40, 49.99, 12.49) is never moved, and neither is a
//                        split that doesn't add up to 100 once its shares are snapped; whole numbers (33, 33, 34) are never guessed at either: they
//                        are the data fix's to put right (the nearest third of 33 is a third of a point away)
//   snapShare            the same for one share on its own (the one cell To do writes to the pub sheet)
//   shareChanged         whether two shares differ as the site keeps them (snapped; more than a thousandth of a point)
//   importShare          a share read from the pub sheet, as a song brought in from it keeps it (6 decimals: no float tail, no rounding to a tenth; a
//                        formula's 14.285714 is the exact seventh)
//   sheetFraction        a share as the pub sheet's Writer Share cell holds it: the snapped percent / 100 to 8 decimals
//   exactShare           whether a share is one of those exact fractions (the pub sheet's push accepts it with more than two decimals)
//   longShare            a share typed or pasted with a third decimal or more (up to six: 16.666667) that is one of those fractions' own digits: the fraction, else null
// The rounding sites that used to show one decimal (33.33 as "33.3", 16.67 as "16.7") all read this file. A file of its own, with no imports:
// lib/splits.js, lib/split-fixes.js, the dashboard's screens, the pub sheet's writes, every save of a song and the nightly sync all use it.
export const SNAP_MAX = 12;       // thirds to twelfths: the even shares of a song with up to 12 on a side
export const SNAP_NEAR = 0.011;   // a share is "a third" when it is within this many points of one (33.33, 33.34, 16.66, 16.67: not 33, not 33.3)
export const TOTAL_OFF = 0.01;    // a split whose shares add up to 100 within this many points (after snapping) adds up to 100
export const ROUNDING_GAP = 0.05; // the site's share and the pub sheet's differ by no more than this: rounding, not a difference (was 0.5)
export const TWO_DECIMALS = "Two decimals at most, like 33.33."; // what a box says to a third decimal that is no fraction's
const EPS = 1e-9;

// Math.round(x * 100) / 100 is wrong for 1.005 (100.49999999999999) and 16.665: the product is cut to 15 digits first, so what was typed
// is what is rounded. Half up. NaN and infinity say 0.
export function roundPct(x, digits = 2) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** digits;
  return Math.round(Number((n * f).toPrecision(15))) / f + 0; // (+ 0: no -0)
}
export const splitPct = (x) => String(roundPct(x));

const total = (rows) => rows.reduce((a, r) => a + Number(r?.percent || 0), 0);
const shareOf = (r) => Number(r?.percent || 0);

// the share that is m parts of k, as a double with the least error (m * 100 / k: 5 * 100 / 6, not 5 * (100 / 6))
const part = (m, k) => (m * 100) / k;

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
// The shares a snap moves toward: m parts of k (k up to SNAP_MAX) in lowest terms whose decimals never end (a denominator with a prime factor besides 2 and
// 5): the thirds, sixths, sevenths, ninths, elevenths and twelfths, 30 of them, 8.33 to 91.67. A share a person can type exactly (a half, a quarter, a fifth,
// an eighth, 12.5) is not one: nothing is moved toward it, so 49.99, 25.01, 12.49 and 9.99 stay as typed. No two are closer than 0.75 of a point, so a share
// is near one at most
const FRACTIONS = (() => {
  const out = [];
  for (let k = 3; k <= SNAP_MAX; k++) for (let m = 1; m < k; m++) {
    if (gcd(m, k) !== 1) continue;
    let d = k;
    while (d % 2 === 0) d /= 2;
    while (d % 5 === 0) d /= 5;
    if (d > 1) out.push(part(m, k));
  }
  return out.sort((a, b) => a - b);
})();
// the fraction a share is near: it is that fraction rounded to two decimals (33.33, 16.67), or within SNAP_NEAR of it (33.34, 16.66); null for any other share
const fractionNear = (x) => { for (const f of FRACTIONS) if (Math.abs(x - f) <= SNAP_NEAR + EPS) return f; return null; };

// rows: [{ percent, … }]. Each share is snapped on its own (3 producers and 4 artists, 16.67 x 3 + 12.5 x 4, are three exact sixths and four eighths, 3 and 2:
// 16.67 x 3 + 25 x 2). Returns the rows themselves (the same array) when there is nothing to change: no share is near a fraction, a split that is exact already,
// one that does not add up to exactly 100 once its shares are snapped. Else a new array whose snapped shares are the exact fractions and add up to exactly 100 in
// floating point (the last snapped row takes the double's last digits, as lib/splits.js evenSplit's last unnamed row does), so the saved split never comes back
// to Splits to confirm for a hair
export function snapSplits(rows) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  const xs = rows.map(shareOf);
  if (xs.some((x) => !Number.isFinite(x) || x < 0)) return rows;
  const want = xs.map((x) => (x > 0 ? fractionNear(x) : null));
  const last = want.findLastIndex((w) => w !== null);
  if (last < 0) return rows;
  if (Math.abs(xs.reduce((a, x, i) => a + (want[i] === null ? x : want[i]), 0) - 100) > EPS) return rows; // not a whole song once snapped: as typed
  if (want.every((w, i) => w === null || Math.abs(xs[i] - w) < EPS) && total(rows) === 100) return rows; // exact already (the even default, a saved split read back)
  const out = rows.map((r, i) => (want[i] === null || shareOf(r) === want[i] ? r : { ...r, percent: want[i] }));
  for (let i = 0; i < 3 && total(out) !== 100; i++) out[last] = { ...out[last], percent: shareOf(out[last]) + (100 - total(out)) };
  return out;
}

// one share on its own: the exact fraction it is near (33.33 -> a third, 16.67 -> a sixth), else as it is (12.5, 25.01, 49.99 stay)
export function snapShare(x) {
  const n = Number(x);
  if (!(n > 0 && n <= 100)) return n;
  return fractionNear(n) ?? n;
}

// whether two shares are different shares as the site keeps them: both snapped, then more than a thousandth of a point apart (33.33 over the sheet's 33.3 is a
// change, 33.33 over its 33.3333 is not, 50 over 50.04 is)
export const shareChanged = (a, b) => Math.abs(snapShare(a) - snapShare(b)) > 0.001;

// a share read from the pub sheet (its cell x 100, with the float tail: 16.67 is 16.669999999999998) as the site keeps a song brought in from it: exactly what the
// sheet holds, to 6 decimals (2026-11-23: it was cut to one decimal, 33.33 became 33.3). A value with more than two decimals is a formula's (=1/7 reads as
// 14.285714): the exact fraction it is the rounding of, else as it is; one typed with two (33.33, 16.67) stays as typed (a lone share is not proof of a split)
export function importShare(x) {
  const n = Math.round((Number(x) || 0) * 1e6) / 1e6;
  return roundPct(n) === n ? n : snapShare(n);
}

// the pub sheet's Writer Share cell holds the share / 100 (33.333333 -> 0.33333333): at least 6 decimals of the percent, never one
export const sheetFraction = (percent) => Math.round(snapShare(percent) * 1e6) / 1e8;

// m parts of k, for k from 2 to 12 (a third, two thirds, five sixths, 41.666…, a half): a share the site holds exactly
export function exactShare(x) {
  const n = Number(x);
  if (!(n > 0 && n <= 100)) return false;
  for (let k = 2; k <= SNAP_MAX; k++) {
    const m = Math.round((n * k) / 100);
    if (m >= 1 && m <= k && Math.abs(n - part(m, k)) < EPS) return true;
  }
  return false;
}

// a share typed or pasted with a third decimal or more, up to six (text: 16.666667 pasted from a formula, 33.333): the exact fraction whose own digits it is, rounded or
// cut at the last one (16.666667 or 16.666666 is a sixth, 33.333 a third), which is what is kept. Null for any other: 12.345, 49.999, seven decimals, and a number only
// near a fraction (16.665, 33.334): those are "Two decimals at most", not rounded behind the person's back
export function longShare(text) {
  const t = String(text ?? "").trim().replace(/\s*%$/, "").replace(",", ".");
  const m = /^\d*\.(\d{3,6})$/.exec(t);
  if (!m) return null;
  const n = Number(t), s = snapShare(n);
  if (!(n > 0 && n <= 100) || s === n) return null;
  const d = m[1].length, unit = 10 ** d;
  return Math.abs(n - roundPct(s, d)) < 1e-9 || Math.abs(n - Math.floor(s * unit + 1e-6) / unit) < 1e-9 ? s : null;
}
// what the song editor's number box does with the text typed into it: { n } (no text is 0; two decimals at most as typed; more only as a fraction the site keeps)
// or { reason } (the same words To do's boxes give a third decimal that is no fraction's)
export function boxShare(text) {
  const t = String(text ?? "").trim();
  if (!t) return { n: 0 };
  if (/\.\d{3,}$/.test(t)) { const s = longShare(t); return s == null ? { reason: TWO_DECIMALS } : { n: s }; }
  return { n: roundPct(Number(t)) };
}
