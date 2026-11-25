// (2026-11-21) What the Money tab's EMPIRE pages say and draw, as plain functions of what GET /api/empire sends (the screens are components/dash/empire.jsx, EMPIRE recoupment, and
// empire-calc.jsx, Advance calculator). Pure. This file is part of the page's code, which anyone can download, so it holds NO term of the contract: every rate, amount and date it speaks
// comes from the answer (its `terms`, `levers` and numbers), and nothing is worked out from a constant here.
// (2026-11-23) The recoupment card is real money only: its bar, its headline and its status line are what EMPIRE's statements credited. Every sentence made from streams (the
// estimate, the pace, the payback date, the extra advance, the buyout) is in forecastLines, which the card folds away under "Forecast (an estimate from streams, not money)".
// (2026-11-24, the owner: "just the key information") The page opens on three tiles (paid back, left to give out, next statement) and one short line of dates (datesLine, nextLine below);
// the timeline, the status line and the sentence about the bar, which they replace, are gone.
import { verdictFor, VERDICTS } from "../../lib/advance-model";
import { NEW_SONGS_WARN } from "../../lib/empire-math";

// ---- words for numbers and days
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ymd = (s) => /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
export const dayText = (s) => { const m = ymd(s); return m ? `${MON[+m[2] - 1]} ${+m[3]}, ${m[1]}` : ""; };   // Mar 1, 2029
export const dayShort = (s) => { const m = ymd(s); return m ? `${MON[+m[2] - 1]} ${+m[3]}` : ""; };            // Mar 1
export const monthYear = (s) => { const m = ymd(s); return m ? `${MON[+m[2] - 1]} ${m[1]}` : ""; };            // Mar 2029
export const usd = (n) => { const v = Number(n) || 0; return `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
export const usd0 = (n) => { const v = Math.round(Number(n) || 0); return `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US")}`; };
// a fraction as a percent: 0.2 is "20%", 0.272798 "27.3%"; no more than `digits` decimals, none when it is whole
export const pctText = (x, digits = 1) => { const f = 10 ** digits; return `${Math.round((Number(x) || 0) * 100 * f) / f}%`; };
// "about 20 months" (a number of months from today)
export const aboutMonths = (m) => { const n = Math.round(m); return n < 1 ? "less than a month" : `about ${n} ${n === 1 ? "month" : "months"}`; };
// the streams a year, short: 91,980,000 is "91.98M", 845,000 "845K"
export const bigNum = (n) => {
  const a = Math.abs(Number(n) || 0), s = n < 0 ? "-" : "";
  return a >= 1e6 ? `${s}${Math.round(a / 1e4) / 100}M` : a >= 1e3 ? `${s}${Math.round(a / 1e3)}K` : `${s}${Math.round(a).toLocaleString("en-US")}`;
};

// ---- the advance calculator's small rules (moved from components/dash/advance.jsx with the calculator)
// the verdict is judged on the months as the page shows them (to a tenth), so an advance typed back from a dollar figure rounded to the cent never flips it at 18, 30 or 36
export const verdictShown = (m) => verdictFor(Number.isFinite(m) ? Math.round(m * 10) / 10 : m);
export const verdictTone = (v) => (!v ? undefined : v === "Safe" ? "pos" : v === "Tight" ? "warn" : v.startsWith("Too high") ? "neg" : "neutral");
// months to one decimal, no trailing .0: "36 months", "31.2 months", "1 month"
export const monthsText = (m) => `${Math.round(m * 10) / 10} ${Math.round(m * 10) / 10 === 1 ? "month" : "months"}`;
// the months typed: blank (or nothing sensible) is 12, otherwise 1 to 120 (the box starts on the standard, 18, so a blank means the sheet's own 12)
export const clampMonths = (v) => { const n = Number(v); return String(v ?? "").trim() === "" || !Number.isFinite(n) ? 12 : Math.min(Math.max(n, 1), 120); };
// an amount typed, with or without the $ and commas: a number above 0, or null
export const amountOf = (v) => { const n = Number(String(v ?? "").replace(/[$,\s]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };
// a percent typed ("20", "20%", "12.5"): a fraction from 0 up to just under 1, or null when it isn't one
export const cutFromText = (v) => { const t = String(v ?? "").replace(/[%\s]/g, ""); const n = t === "" ? NaN : Number(t); return Number.isFinite(n) && n >= 0 && n < 100 ? Math.round(n * 100) / 10000 : null; };
// a share typed as a percent ("75", "62.5%"): a fraction above 0 up to 100%, or null (the server holds it to its own range)
export const shareFromText = (v) => { const t = String(v ?? "").replace(/[%\s]/g, ""); const n = t === "" ? NaN : Number(t); return Number.isFinite(n) && n > 0 && n <= 100 ? Math.round(n * 100) / 10000 : null; };
// the request that saves a calculator result as a planned deal: a producer's (their whole catalog, or the songs ticked) or a prospect's / someone new's (by name, whole catalog)
export function dealPayload({ producer = null, prospectName = "", scope = "catalog", songIds = [], advance, cut, note = "" }) {
  return producer
    ? { action: "saveDeal", clientId: producer.id, scope, placementIds: scope === "songs" ? songIds : [], advance, cut, note }
    : { action: "saveDeal", prospectName, scope: "catalog", advance, cut, note };
}
// "Verdict: Safe ≤ 18 months to pay back, Workable ≤ 30, Tight ≤ 36, Too high beyond." from the model's own limits
export const verdictRule = () => `Verdict: ${[`${VERDICTS[0][1]} ≤ ${VERDICTS[0][0]} months to pay back`, ...VERDICTS.slice(1).map(([max, word]) => `${word} ≤ ${max}`), "Too high beyond"].join(", ")}.`;

// the sentence under "Check an amount": model.check is advanceModel's answer for it (producerDeal().check), ceil the most the royalties could ever repay.
// (2026-11-24, audit) The amount is stacked on what the producer's deals still owe (check.owing), as the headline and the ladder are: the months are the months to repay both,
// and the coverage is what is left of 3 years of royalties after the owing.
const timesText = (x) => (x > 0 && x < 0.05 ? "less than 0.1×" : `${x.toFixed(1)}×`);
export function checkSentence(check, ceil) {
  if (!check) return null;
  const owing = Number(check.owing) > 0 ? Number(check.owing) : 0;
  const covers = check.coverage == null ? ""
    : !owing ? ` The royalties over 3 years cover it ${timesText(check.coverage)}.`
    : check.coverage > 0 ? ` After the ${usd(owing)} still to pay back, the royalties over 3 years cover it ${timesText(check.coverage)}.`
    : ` The royalties over 3 years don't even cover the ${usd(owing)} still to pay back.`;
  if (check.months == null) return { tone: "neutral", text: "There are no royalties at this pace, so there's nothing to pay it back from." };
  if (check.months === Infinity) {
    const most = ceil == null ? "" : owing ? `; the most they could ever repay is ${usd(ceil)}, so the most left for a new advance is ${usd(Math.max(0, ceil - owing))}` : `; the most they could ever repay is ${usd(ceil)}`;
    return { tone: "neg", text: `The royalties would never pay this back ${owing ? `on top of the ${usd(owing)} still to pay back` : "at this pace"}${most}.${covers}` };
  }
  const verdict = verdictShown(check.months);
  return { tone: verdictTone(verdict), text: `Pays back in ${monthsText(check.months)} (${verdict})${owing ? `, counting the ${usd(owing)} still to pay back first` : ""}.${covers}` };
}

// ---- the recoupment card
// the bar: what EMPIRE's statements credited, as a percent of the whole, to a tenth (never past 100). There is no estimated part: the bar is money only.
export function barOf(r) {
  return { solid: Math.round(Math.min(Math.max(Number(r?.pct) || 0, 0), 1) * 1000) / 10 };
}
// The line under the three tiles (it replaces the timeline, the status line and the sentence about the bar): the last day to be paid back (for EMPIRE's extra advance) and the day Defied
// can buy out, both from the terms (real dates only, nothing projected: the day it would be paid back at today's pace is in the forecast, as words), and what being paid back means.
export function datesLine({ terms, rec }) {
  return {
    payBy: { text: dayText(terms.additionalBy), title: `The last day to be paid back for EMPIRE's extra ${usd0(terms.additional)} advance` },
    buyout: { text: dayText(terms.threeYear), title: `Defied can buy out from here, repaying ${pctText(terms.buyout, 0)} of what's left` },
    paid: rec?.recouped ? "EMPIRE is paid back, so Defied gets paid" : "Defied gets paid once EMPIRE is paid back",
  };
}
// the "Next EMPIRE statement" tile: the day it is due (the quarters and due dates are the API's own: nextDue = the quarter whose statement comes next) and the quarter it is for
export function nextLine(nextDue) {
  if (!nextDue) return { big: "—", sub: "none due" };
  return { big: dayText(nextDue.due), sub: `due, for ${dayShort(nextDue.start)} – ${dayText(nextDue.end)}` };
}

// ---- the forecast (everything below is an estimate from streams, never money: the card folds it away)
// what today's pace would put on the next statement, and a year of it
export function paceText(rec) {
  const f = rec?.forecast;
  if (!f || f.off) return "";
  if (!(f.perYear > 0)) return "At today's pace nothing would be credited: there are no streams to count.";
  const next = f.next ? `the next statement (${f.next.quarter}, due ${dayText(f.next.due)}) would credit about ${usd0(f.next.amount)}, and a year about ${usd0(f.perYear)}` : `a year would credit about ${usd0(f.perYear)}`;
  return `At today's pace ${next}.`;
}
// when it is paid back at today's pace, or that it isn't. "Paid back" is only said by the statements (the first tile and its bar), so here: the estimate that reaches the total says so as an estimate
// (2026-11-21, review: statements come a quarter after the quarter ends)
export function projectionText(rec) {
  const f = rec?.forecast;
  if (!rec || !f) return "";
  if (f.off) return "The pub sheet's rates couldn't be read just now, so there's no forecast. The statements typed in still count.";
  if (rec.recouped) return "";
  if (f.estimatedRecouped) return "Estimated to be paid back — wait for EMPIRE's statement to confirm.";
  if (f.never) return `Not at today's pace — the current songs top out near ${usd0(f.reach)} of the ${usd0(rec.owed)}.`;
  if (f.date) return `At today's pace it's paid back around ${monthYear(f.date)} (in ${aboutMonths(f.months)}).`;
  return "";
}
// (2026-11-21, review) The extra advance EMPIRE can give once the account is paid back, in words: where the account stands against its last day. Only EMPIRE's statements can say "yes"
// (or that it was missed); the rest is an estimate from today's pace, and says so. Every sentence that talks about the extra advance carries the one that says it is recouped too.
export const EXTRA_NOTE = "If Defied takes it, EMPIRE adds it to what Defied owes, so it is paid back the same way.";
export function additionalText(rec, terms) {
  const f = rec?.forecast;
  if (!f) return "";
  const a = f.additional;
  const adv = `EMPIRE's extra ${usd0(terms.additional)} advance`, by = dayText(terms.additionalBy), owed = usd0(rec.owed);
  if (!a || f.off) return `${adv} has a last day, ${by}, for the account to be paid back. ${EXTRA_NOTE}`; // (no pace to judge it by, so only what it is)
  const ask = "Defied asks for it in writing once the account is recouped.";
  switch (a.state) {
    case "yes": return `EMPIRE's statements show the ${owed} was earned back in time for ${adv} (Defied asks for it in writing). ${EXTRA_NOTE}`;
    case "ontrack": return `On track (estimate) for ${adv}, whose last day is ${by}. ${ask} ${EXTRA_NOTE}`;
    case "close": return `Close (estimate) to ${by}, the last day for ${adv}. ${ask} ${EXTRA_NOTE}`;
    case "late": case "no": return `Not on this pace (estimate) for ${adv}, whose last day is ${by}. ${EXTRA_NOTE}`;
    case "missed": return rec.recouped
      ? `EMPIRE's statements show the ${owed} was earned back only after ${by}, the last day for ${adv}, so it was missed. ${EXTRA_NOTE}`
      : `The statements typed in don't show the ${owed} earned back by ${by}, the last day for ${adv}, so it may be missed (a statement still to come could change that). ${EXTRA_NOTE}`;
    default: return "";
  }
}
export function buyoutText(rec, terms) {
  const b = rec?.forecast?.buyout;
  if (!b) return "";
  if (rec.recouped || b.amount <= 0) return `From ${dayText(b.date)} Defied could buy out by repaying ${pctText(b.rate, 0)} of what's left. Nothing would be left at today's pace.`;
  return `From ${dayText(b.date)} Defied can buy out by repaying ${pctText(b.rate, 0)} of what's still unrecouped then: about ${usd0(b.amount)} at today's pace.`;
}
// the card's folded lines, in order: [id, text], the empty ones left out
export function forecastLines(rec, terms) {
  if (!rec?.forecast) return [];
  return [["pace", paceText(rec)], ["projection", projectionText(rec)], ["additional", additionalText(rec, terms)], ["buyout", buyoutText(rec, terms)]].filter(([, text]) => text);
}
// how much of the estimate is measured, and what it is made from (inside the "How the estimate counts Net Income" fold)
export function estimateNote(rec, streamsOn = "") {
  const f = rec?.forecast, e = f?.estimate;
  if (!rec || !f || f.off) return "";
  if (!e?.from) return "Every quarter so far has an EMPIRE statement, so nothing here is estimated.";
  const songs = e.songs === 1 ? "1 song" : `${e.songs} songs`;
  const how = e.songs ? `${pctText(e.measuredShare, 0)} of those streams are counted from Luminate's totals (or a song's lifetime count since it came out), the rest is today's pace over the days` : "";
  const asOf = streamsOn ? ` Streams as of ${dayText(streamsOn)}.` : "";
  return `Estimated from real streams since ${dayText(e.from)}: about ${usd0(f.estimated)} for Defied, from ${songs} on Schedule A${how ? `; ${how}` : ""}.${e.noShare ? ` ${e.noShare === 1 ? "1 song has" : `${e.noShare} songs have`} no split for the producer yet and ${e.noShare === 1 ? "isn't" : "aren't"} counted.` : ""}${asOf}`;
}
// the quarters before the last statement that have none of their own: they are estimated too
export const missingNote = (rec) => (rec?.missing?.length ? `No statement is typed in for ${rec.missing.join(", ")}, so ${rec.missing.length === 1 ? "it is" : "they are"} estimated too.` : "");
// the first statements can be bigger than the estimate: EMPIRE also collects late payments for plays before the deal began (the letter of direction to the societies)
export const lateNote = (terms) => `A real statement can come in higher than the estimate: EMPIRE also collects what the societies and platforms pay late for plays before ${dayText(terms.effective)}.`;
// the statements: a quarter in words, and when its statement comes
export const quarterWords = (q) => `${q.id}: ${dayShort(q.start)} – ${dayText(q.end)}`;
export const dueWords = (q) => `due ${dayText(q.due)}`;

// ---- the money spent out of EMPIRE's advance (2026-11-23: it starts at zero and fills only as a founder marks money spent; 2026-11-24: the "Left to give out" tile says what is left, so the section keeps the bar and the list)
// the bar: what is spent (deals marked given + the entries marked spent) as a percent of the total, to a tenth, never past 100 (the part over is said in words, not drawn)
export function spentBar(pot) {
  const total = Number(pot?.total) || 0;
  if (!(total > 0)) return { solid: 0 };
  return { solid: Math.round(Math.min(Math.max(Number(pot.spent) || 0, 0) / total, 1) * 1000) / 10 };
}
// the one muted line under the bar for deals that are only planned: they are not money yet, so they are not in the bar
export function plannedLine(pot) {
  const n = Number(pot?.plannedCount) || 0;
  return n > 0 ? `Planned, not spent yet: ${usd0(pot.planned)} (${n} ${n === 1 ? "deal" : "deals"})` : "";
}
// the Spent list, newest first: every deal marked given ("Advance to <producer>", un-given from its deal row, so it can't be deleted from here) and every entry typed in
// (kind "spend": it can be deleted). { key, kind, id, on, what, amount }
export function spentRows({ deals = [], spends = [], producers = [] }) {
  const names = new Map(producers.map((p) => [p.id, p.name]));
  const who = (d) => (d.clientId ? names.get(d.clientId) || "a producer" : d.prospectName || "a prospect");
  const rows = [
    ...deals.filter((d) => d.status === "given").map((d) => ({ key: `deal:${d.id}`, kind: "advance", id: d.id, on: d.givenOn || "", what: `Advance to ${who(d)}`, amount: Number(d.advance) || 0 })),
    ...spends.map((x) => ({ key: `spend:${x.id}`, kind: "spend", id: x.id, on: x.on || "", what: x.what, amount: Number(x.amount) || 0 })),
  ];
  return rows.sort((a, b) => String(b.on).localeCompare(String(a.on)) || a.key.localeCompare(b.key));
}

// ---- the deals
export function scopeText(deal) {
  if (!deal.clientId) return `${deal.prospectName || "A prospect"}: not on Schedule A yet`;
  const n = deal.songs?.count ?? 0, names = deal.songs?.names || [];
  if (deal.scope === "songs") return `${n} ${n === 1 ? "song" : "songs"}: ${names.join(", ")}${n > names.length ? ` and ${n - names.length} more` : ""}`;
  return `Whole catalog (${n} ${n === 1 ? "song" : "songs"})`;
}
// a given deal's payback line (2026-11-23, real money only: what EMPIRE's statements have paid back, the producer's share of each, split by each song's streams; $0 until one covers
// it). A planned deal repays nothing, so it says nothing.
export function dealLine(deal) {
  const r = deal.recoup || {};
  if (deal.status !== "given") return "";
  if (r.none) return deal.clientId ? "None of its songs are on Schedule A right now, so there is nothing to count." : "Counting starts once they're a client with songs on Schedule A.";
  if (r.paid == null) return "";
  return `Paid back ${usd(r.paid)} of ${usd(deal.advance)} (${pctText(r.pct, 0)}) from EMPIRE's statements, split by each song's streams. ${usd(r.remaining)} to go.${r.statements ? "" : " No statement covers it yet."}`;
}
// the small muted note on a given deal: when the royalties since its day would pay it back at today's pace (an estimate, said so), or that they never would
export function dealForecast(deal) {
  const r = deal.recoup || {}, f = r.forecast;
  if (deal.status !== "given" || !f || r.recouped) return "";
  if (f.recouped) return "forecast: the royalties so far should cover it, once a statement says so";
  if (f.never) return "forecast: not at today's pace";
  if (f.date) return `forecast: around ${monthYear(f.date)} at today's pace`;
  return "";
}

// ---- the calculator's pace, in words
// a part of the whole as a whole percent that never reads 0% or 100% while it is only a part (99.95% measured is "99%")
export const partPct = (x) => `${Math.min(99, Math.max(1, Math.round((Number(x) || 0) * 100)))}%`;
// p: paceOfSongs()'s answer for the songs picked (song by song: each measured song at its measured pace, the rest by the rule); rule: the sheet's run-rate (B9) as a
// fraction; decay: B8. -> { real (all of the pace measured), realShare, perYear, source, warning }
export function paceSource({ p, rule, decay }) {
  const r = pctText(rule);
  if (p.tracked > 0) {
    const rest = p.count - p.tracked;
    const other = rest > 0 ? ` ${rest === 1 ? "The other song uses" : `The other ${rest} use`} the sheet's rule (${r} of lifetime a year)${p.real ? "" : `, so ${partPct(p.realShare)} of the pace is measured`}.` : "";
    return {
      real: p.real, realShare: p.realShare, perYear: p.perYear,
      source: `${p.real ? "Real streams: " : ""}Spotify's daily counts for ${p.tracked} of ${p.count} ${p.count === 1 ? "song" : "songs"}, scaled to all platforms by each song's lifetime total.${other}`,
      warning: p.newShare >= NEW_SONGS_WARN ? `${Math.round(p.newShare * 100)}% of this pace is from songs out under 3 months. New songs usually drop faster than ${pctText(decay)} a year, so treat this as the high end.` : null,
    };
  }
  return {
    real: false, realShare: 0, perYear: p.perYear, warning: null,
    source: `Estimate: no daily tracking for their songs, so this uses the sheet's rule: lifetime streams × ${r} a year.`,
  };
}
