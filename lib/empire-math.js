// (2026-11-21) The math of a producer's advance under the EMPIRE deal, one place for the server (lib/empire-deal.js) and the dashboard (components/dash/empire-calc.jsx,
// so the numbers move as you type). Pure: no imports but the advance model, no I/O. It holds NO term of the contract: the payout, the rates and the slowdown all
// come in as arguments (from GET /api/empire), because this file is part of the page's code and the contract is confidential.
//
// The flow of the money, per $1 of Net Income (what EMPIRE receives, lib/empire-deal.js): EMPIRE keeps (1 − payout), Defied gets the payout; of what Defied gets,
// Defied's cut is `cut` and the rest is the producer's royalties, which pay back the producer's advance first. All of Defied's payout counts toward EMPIRE's own
// advance (the producer's share too: EMPIRE doesn't see the split), and the writer's own performance share isn't Net Income, so none of this touches it.
import { advanceModel } from "./advance-model";

export const cents = (x) => Math.round((Number(x) || 0) * 100) / 100;
export const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

// A measured pace gets a warning when this share of it is from songs out under 3 months.
export const NEW_SONGS_WARN = 0.25;

// Today's pace for a set of songs, in net streams a year (their share). A song: { paceNet (its pace: measured, or the rule's), ruleNet (what the rule gives it:
// lifetime × share × run-rate), kind: "real" | "rule", isNew }.
// (2026-11-24, audit) Song by song: a song with daily readings counts at its measured pace, a song without by the sheet's rule, and the pace is their sum. It used to
// switch the whole set to the rule when under half of the pace was measured, which threw the measured songs away (1.00M measured gave an 18-month advance of $1,076,
// 0.99M gave $807; a 400K measured song was swapped for its 30K rule). realShare still says how much of the pace is measured, for the labels.
// -> { perYear (what to use), real (ALL of it measured), realShare, newShare, tracked, count, mixPerYear (the same as perYear, for older callers), rulePerYear (the rule alone) }
export function paceOfSongs(songs) {
  let realP = 0, ruleP = 0, newP = 0, tracked = 0, allRule = 0, count = 0;
  for (const s of songs || []) {
    const p = Math.max(Number(s?.paceNet) || 0, 0), r = Math.max(Number(s?.ruleNet) || 0, 0);
    count++; allRule += r;
    if (s.kind === "real") { tracked++; realP += p; if (s.isNew) newP += p; } else ruleP += p;
  }
  const perYear = realP + ruleP;
  const realShare = perYear > 0 ? realP / perYear : 0, newShare = perYear > 0 ? newP / perYear : 0;
  return { perYear, real: perYear > 0 && ruleP === 0, realShare, newShare, tracked, count, mixPerYear: perYear, rulePerYear: allRule };
}

// Do two producer deals cover a song in common? (2026-11-21, review: two deals on the same song would count its royalties twice.) A deal: { clientId, scope: "catalog" | "songs",
// placementIds }. One producer's whole catalog overlaps every other deal of theirs; two deals on some songs overlap when they share one; a prospect's deal (no clientId) has no
// songs yet, so it overlaps nothing, and neither do two different producers' deals. `other` is the deal that is already there; live (optional): the Set of the producer's songs on
// Schedule A now, which a whole catalog is counted against. -> null, or { whole: true } when `other` is the whole catalog, else { whole: false, ids } (the songs in common; when
// `deal` is the whole catalog, the songs of `other` that are on Schedule A now, or all of them when none is)
export function overlapOf(deal, other, live = null) {
  if (!deal?.clientId || !other?.clientId || deal.clientId !== other.clientId) return null;
  if (other.scope !== "songs") return { whole: true, ids: [] };
  const theirs = other.placementIds || [];
  if (!theirs.length) return null;
  if (deal.scope !== "songs") { const here = live ? theirs.filter((id) => live.has(id)) : theirs; return { whole: false, ids: here.length ? here : theirs }; }
  const mine = new Set(deal.placementIds || []), shared = theirs.filter((id) => mine.has(id));
  return shared.length ? { whole: false, ids: shared } : null;
}

// The cut a deal can carry: 0 up to just under 100% (at 100% nothing is left to pay the advance back)
export const CUT_MAX = 0.9999;
export const cutOf = (x) => clamp(Number.isFinite(Number(x)) ? Number(x) : 0, 0, CUT_MAX);

// One dollar of Net Income, split: { empire, defiedCut, producer } (they add up to 1)
export function splitOfDollar({ payout, cut }) {
  const pay = clamp(Number(payout) || 0, 0, 1), c = cutOf(cut);
  return { empire: 1 - pay, defiedCut: pay * c, producer: pay * (1 - c) };
}

// A producer deal's numbers.
//   pace     net streams a year at today's pace (paceOfSongs().perYear, or the rule for someone not on Schedule A)
//   ni       Net Income a net stream: the pub sheet's blended rate (B7) × the share of it EMPIRE receives
//   payout   the share of Net Income EMPIRE pays Defied      cut     Defied's cut of that, 0 up to just under 1
//   decay    the yearly slowdown (B8)       months   how fast the producer's royalties should pay the advance back
//   amount   an advance typed to check (optional)            pot      { left } what is left of EMPIRE's execution advance (optional)
//   owing    what the producer's deals on these songs still have to pay back out of the same royalties (optional): the amount checked is stacked on it
// The advance the producer's royalties repay in `months` is lib/advance-model.js's, run on those royalties: Net Income × payout × (1 − cut).
export function producerDeal({ pace, ni, payout, cut, decay, months = 18, amount = null, pot = null, owing = 0 }) {
  const pay = clamp(Number(payout) || 0, 0, 1), c = cutOf(cut);
  const m = advanceModel({ annualNetStreams: pace, blendedRate: ni, decay, feeRate: pay * (1 - c), recoupMonths: months, amount, owing });
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const ofNi = (x) => ({ ni: x, empire: x * (1 - pay), defied: x * pay, defiedCut: x * pay * c, royalties: x * pay * (1 - c) });
  const toDefied = m.their.map((x) => x * pay);
  return {
    pace: m.pace, perDollar: splitOfDollar({ payout: pay, cut: c }),
    now: ofNi(m.theirNow),                // a year at today's pace, before it slows
    next12: ofNi(m.their[0]),             // the next 12 months, the slowdown in
    years: { ni: m.their, royalties: m.ours, defied: toDefied },
    toEmpire: { next12: toDefied[0], next36: sum(toDefied) }, // what these songs add to EMPIRE's recoupment: all of Defied's payout
    months: m.recoupMonths, advance: m.recommended, verdict: m.recommendedVerdict, coverage: m.coverage, ceiling: m.ceiling,
    ladder: m.ladder, check: m.check,
    pot: pot ? { left: pot.left, afterAdvance: pot.left - m.recommended, afterCheck: m.check ? pot.left - m.check.amount : null } : null,
    royaltiesNow: m.feeNow,
  };
}
