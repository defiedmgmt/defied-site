// A song's split percents, said and kept exactly (2026-11-23, the owner: "dont know why some decimals are removed 33 shld be 33.33 and
// 17 shld eb 16.66 this shld be everywhere its important to be exact", then "nah ur right its .67"). One rule for the whole site, pure:
//   roundPct / splitPct  a percent to two decimals, half up, float-safe; splitPct is the text with no trailing zeros
//                        ("50", "33.33", "16.67", "12.5", "66.67"): every screen and sentence that names a split's share says it this way
//   snapSplits           the split to SAVE: shares typed to two decimals that are really thirds, sixths, eighths (16.67 + 83.33, 33.33 x 3,
//                        33.33 + 33.33 + 33.34) are kept as the exact fractions they mean (16.666…, 83.333…), and the total comes out as
//                        exactly 100. Anything else is kept as typed. Whole numbers (33, 33, 34) are never guessed at: they are the data fix's
//                        to put right (the nearest third of 33 is a third of a point away)
//   snapShare            the same for one share on its own (the one cell To do writes to the pub sheet)
//   importShare          a share read from the pub sheet, as a song brought in from it keeps it (6 decimals: no float tail, no rounding to a tenth)
//   sheetFraction        a share as the pub sheet's Writer Share cell holds it: the snapped percent / 100 to 8 decimals
//   exactShare           whether a share is one of those exact fractions (the pub sheet's push accepts it with more than two decimals)
// The rounding sites that used to show one decimal (33.33 as "33.3", 16.67 as "16.7") all read this file. A file of its own, with no imports:
// lib/splits.js, lib/split-fixes.js, the dashboard's screens, the pub sheet's writes, every save of a song and the nightly sync all use it.
export const SNAP_MAX = 12;       // thirds, sixths, eighths, twelfths: the even shares of a song with up to 12 on a side
export const SNAP_NEAR = 0.011;   // a share is "a third" when it is within this many points of one (33.33, 33.34, 16.66, 16.67: not 33, not 33.3)
export const TOTAL_OFF = 0.01;    // a split whose shares add up to 100 within this many points (after snapping) adds up to 100
export const ROUNDING_GAP = 0.05; // the site's share and the pub sheet's differ by no more than this: rounding, not a difference (was 0.5)
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

// how many parts of k each share is, when every share is within SNAP_NEAR of a whole number of them, none that was above 0 became 0, and
// together they are all k parts (100%); else null
function partsOf(xs, k) {
  const unit = 100 / k, ms = [];
  let sum = 0;
  for (const x of xs) {
    const m = Math.round(x / unit);
    if (m > k || (x > 0 && m < 1) || Math.abs(x - m * unit) > SNAP_NEAR + EPS) return null;
    ms.push(m);
    sum += m;
  }
  return sum === k ? ms : null;
}

// rows: [{ percent, … }]. Returns the rows themselves (the same array) when there is nothing to change: a split that is already exact, one that
// does not fit any k from 2 to 12, one that does not add up to 100 in parts. Else a new array whose shares are the exact fractions and add up to
// exactly 100 in floating point (the last row with a share takes the double's last digits, as lib/splits.js evenSplit's last unnamed row does),
// so the saved split never comes back to Splits to confirm for a hair
export function snapSplits(rows) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  const xs = rows.map(shareOf);
  if (xs.some((x) => !Number.isFinite(x) || x < 0)) return rows;
  for (let k = 2; k <= SNAP_MAX; k++) {
    const ms = partsOf(xs, k);
    if (!ms) continue;
    const want = ms.map((m) => part(m, k));
    if (xs.every((x, i) => Math.abs(x - want[i]) < EPS) && total(rows) === 100) return rows; // exact already (the even default, a saved split read back)
    const out = rows.map((r, i) => (shareOf(r) === want[i] ? r : { ...r, percent: want[i] }));
    const at = out.map(shareOf).findLastIndex((x) => x > 0);
    for (let i = 0; i < 3 && total(out) !== 100 && at >= 0; i++) out[at] = { ...out[at], percent: shareOf(out[at]) + (100 - total(out)) };
    return out;
  }
  return rows;
}

// one share on its own: the exact fraction it is within SNAP_NEAR of (33.33 -> a third, 16.67 -> a sixth, 12.5 stays), else as it is
export function snapShare(x) {
  const n = Number(x);
  if (!(n > 0 && n <= 100)) return n;
  for (let k = 2; k <= SNAP_MAX; k++) {
    const m = Math.round((n * k) / 100);
    if (m >= 1 && m <= k && Math.abs(n - (m * 100) / k) <= SNAP_NEAR + EPS) return part(m, k);
  }
  return n;
}

// a share read from the pub sheet (its cell x 100, with the float tail: 16.67 is 16.669999999999998) as the site keeps a song brought in from it:
// exactly what the sheet holds, to 6 decimals (2026-11-23: it was cut to one decimal, 33.33 became 33.3)
export const importShare = (x) => Math.round((Number(x) || 0) * 1e6) / 1e6;

// the pub sheet's Writer Share cell holds the share / 100 (33.333333 -> 0.33333333): at least 6 decimals of the percent, never one
export const sheetFraction = (percent) => Math.round(snapShare(percent) * 1e6) / 1e8;

// m parts of k, for k from 2 to 12 (a third, two thirds, five sixths, 41.666…): a share the site holds exactly
export function exactShare(x) {
  const n = Number(x);
  if (!(n > 0 && n <= 100)) return false;
  for (let k = 2; k <= SNAP_MAX; k++) {
    const m = Math.round((n * k) / 100);
    if (m >= 1 && m <= k && Math.abs(n - part(m, k)) < EPS) return true;
  }
  return false;
}
