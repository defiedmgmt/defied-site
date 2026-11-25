// (2026-11-20) The advance calculator's math, one place for the page and the tests (pure: no imports, no I/O).
// The owner: "idk what theyre getting their scores off and estimates from lets make sure this is as accurate as possible cuz we're gonna be
// using it". What changed from the sheet's ADVANCE CALCULATOR formulas (lib/ar-sheet.js reads the levers; this is what the page shows):
//  1. Year 1 starts from TODAY'S PACE: the streams a year the person is earning now. A signed client's comes from real daily streams
//     (lib/advance-pace.js); anyone else's from the sheet's rule, lifetime streams × the forward run-rate (ASSUMPTIONS!B9, 30%), which the
//     sheet itself calls a placeholder. Real pace on the roster runs from 2% to 247% of lifetime a year by person (11-20), so one 30% for
//     everyone was far off per person.
//  2. The slowdown is smooth: at 25% a year (B8) the pace is 75% of today's a year from now, so the next 12 months average 86.9% of today's
//     pace, the next 12 after that 75% of that, and so on (the sheet took a whole year at the year-end rate: 75%).
//  3. The recommended advance is what our fee actually pays back in the months you pick, slowdown included (the sheet sized it as that many
//     months of year 1's fee, so 36 months came out "Too high" by its own check). "Pays back in" for any amount is the exact inverse; past
//     the point where our fee could ever repay it, it says so instead of extrapolating.
//  4. The verdict keeps the sheet's scale on months to pay back: 18 or less Safe, 30 Workable, 36 Tight, more is Too high.
// All money in dollars; rates are fractions (0.25 = 25%).

export const VERDICTS = [[18, "Safe"], [30, "Workable"], [36, "Tight"]];
export const TOO_HIGH = "Too high — lower it";
export const LADDER_MONTHS = [12, 18, 24, 36];

// judged on months to a tenth, as the page shows them: the exact amount for 36 months computes back to 36.00000000000001
export function verdictFor(months) {
  if (months == null || !Number.isFinite(months)) return months === Infinity ? TOO_HIGH : null;
  const m = Math.round(months * 10) / 10;
  for (const [max, word] of VERDICTS) if (m <= max) return word;
  return TOO_HIGH;
}

// q = what's left of the pace after a year; k = -ln q (the continuous rate). decay 0 (or less) = no slowdown.
const rates = (decay) => {
  const d = Math.min(Math.max(Number(decay) || 0, 0), 0.99);
  const q = 1 - d;
  return { d, q, k: d > 0 ? -Math.log(q) : 0 };
};

// The share of today's pace a year earns on average: year 1 = ∫0..1 q^t dt = (1 - q)/k, year n = q^(n-1) × that
export function yearFactor(decay, n) {
  const { d, q, k } = rates(decay);
  if (d === 0) return 1;
  return Math.pow(q, n - 1) * ((1 - q) / k);
}

// What a fee of `perYear` today (slowing by `decay` a year) adds up to over `months`
export function cumulative(perYear, decay, months) {
  const { d, q, k } = rates(decay);
  if (!(perYear > 0) || !(months > 0)) return 0;
  if (d === 0) return perYear * months / 12;
  return perYear * (1 - Math.pow(q, months / 12)) / k;
}

// The months our fee takes to repay `amount`: Infinity when it never could at this pace (amount at or past the ceiling), null without a fee
export function monthsToRepay(amount, perYear, decay) {
  const { d, q, k } = rates(decay);
  if (!(perYear > 0)) return null;
  if (!(amount > 0)) return 0;
  if (d === 0) return 12 * amount / perYear;
  const x = 1 - amount * k / perYear;
  if (x <= 0) return Infinity;
  return 12 * Math.log(x) / Math.log(q);
}

// The most our fee could ever repay, if the person kept earning forever at this slowdown (null with no slowdown: no ceiling)
export function ceiling(perYear, decay) {
  const { d, k } = rates(decay);
  if (!(perYear > 0)) return 0;
  return d === 0 ? null : perYear / k;
}

// The whole page's numbers.
// annualNetStreams: today's pace, all platforms, their share (streams a year); blendedRate $/stream; decay, feeRate fractions;
// recoupMonths: how fast the advance should pay back; amount: an advance typed to check (optional); owing: what the same fee still has to pay back on
// deals already there (optional, 0 = none). (2026-11-24, audit) The amount checked is stacked on top of `owing`: the fee pays the owing back first, so
// "pays back in" is the months to repay owing + amount, and the 3-year coverage is what is left of 3 years of the fee after the owing, over the amount.
export function advanceModel({ annualNetStreams, blendedRate, decay, feeRate, recoupMonths = 12, amount = null, owing = 0 }) {
  const pace = Math.max(Number(annualNetStreams) || 0, 0), rate = Number(blendedRate) || 0, fee = Number(feeRate) || 0;
  const theirNow = pace * rate, feeNow = theirNow * fee;
  const their = [1, 2, 3].map((n) => theirNow * yearFactor(decay, n));
  const ours = their.map((x) => x * fee);
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const R = Number(recoupMonths) > 0 ? Number(recoupMonths) : 12;
  const recommended = cumulative(feeNow, decay, R);
  const ladder = LADDER_MONTHS.map((m) => ({ months: m, advance: cumulative(feeNow, decay, m), verdict: verdictFor(m) }));
  const owed = Math.max(Number(owing) || 0, 0);
  const check = amount != null && Number(amount) > 0 ? (() => {
    const a = Number(amount), months = monthsToRepay(owed + a, feeNow, decay);
    return { amount: a, owing: owed, months, verdict: verdictFor(months), coverage: Math.max(0, sum(ours) - owed) / a };
  })() : null;
  return {
    pace, theirNow, feeNow,
    their, theirTotal: sum(their), ours, oursTotal: sum(ours),
    year1Share: yearFactor(decay, 1),
    recoupMonths: R, recommended, recommendedVerdict: verdictFor(R),
    coverage: recommended > 0 ? sum(ours) / recommended : null,
    ceiling: ceiling(feeNow, decay),
    ladder, check,
  };
}
