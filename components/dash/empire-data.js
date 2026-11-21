// (2026-11-21) What the Money tab's EMPIRE page says and draws, as plain functions of what GET /api/empire sends (the screens are components/dash/empire.jsx and
// empire-calc.jsx). Pure. This file is part of the page's code, which anyone can download, so it holds NO term of the contract: every rate, amount and date it speaks
// comes from the answer (its `terms`, `levers` and numbers), and nothing is worked out from a constant here.
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

// the sentence under "Check an amount": model.check is advanceModel's answer for it (producerDeal().check), ceil the most the royalties could ever repay
export function checkSentence(check, ceil) {
  if (!check) return null;
  const covers = check.coverage != null ? ` The royalties over 3 years cover it ${check.coverage.toFixed(1)}×.` : "";
  if (check.months == null) return { tone: "neutral", text: "There are no royalties at this pace, so there's nothing to pay it back from." };
  if (check.months === Infinity) return { tone: "neg", text: `The royalties would never pay this back at this pace${ceil != null ? `; the most they could ever repay is ${usd(ceil)}` : ""}.${covers}` };
  const verdict = verdictShown(check.months);
  return { tone: verdictTone(verdict), text: `Pays back in ${monthsText(check.months)} (${verdict}).${covers}` };
}

// ---- the recoupment card
// the bar: its solid part (statements) and striped part (the estimate), as percents of the whole, to a tenth (never past 100 together)
export function barOf(r) {
  const solid = Math.min(Math.max(Number(r?.pctStatements) || 0, 0), 1) * 100, total = Math.min(Math.max(Number(r?.pct) || 0, 0), 1) * 100;
  const s = Math.round(solid * 10) / 10, t = Math.round(total * 10) / 10;
  return { solid: s, striped: Math.max(Math.round((t - s) * 10) / 10, 0), total: t };
}
const ms = (s) => Date.parse(`${String(s).slice(0, 10)}T00:00:00Z`);
// The timeline under the bar, from the deal's first day to its last mark: where today, the day it is paid back at today's pace (when it is), the Additional Advance date and
// the 3-year date fall, as percents along it. tone: how the payback date sits against the Additional Advance date.
export function timelineOf({ terms, rec, today }) {
  const marks = [{ id: "today", label: "Today", date: today }];
  if (rec?.date && !rec.recouped) marks.push({ id: "payback", label: "Paid back at today's pace", date: rec.date, tone: rec.date <= terms.additionalBy ? "pos" : "warn" });
  marks.push({ id: "additional", label: `Last day to be paid back for EMPIRE's extra ${usd0(terms.additional)} advance`, date: terms.additionalBy });
  marks.push({ id: "buyout", label: `Defied can buy out from here (repaying ${pctText(terms.buyout, 0)} of what's left)`, date: terms.threeYear });
  const t0 = ms(terms.effective), last = Math.max(...marks.map((m) => ms(m.date)));
  const end = t0 + (last - t0) * 1.04;
  const place = (d) => Math.round(Math.min(Math.max(((ms(d) - t0) / (end - t0)) * 100, 0), 100) * 10) / 10;
  return { start: terms.effective, marks: marks.map((m) => ({ ...m, at: place(m.date), text: dayText(m.date) })), todayAt: place(today) };
}
// the line under the bar: when it is paid back at today's pace, or that it isn't
export function projectionText(rec) {
  if (!rec) return "";
  if (rec.estimateOff) return "The pub sheet's rates couldn't be read just now, so there's no projection. The statements typed in still count.";
  if (rec.recouped) return `Paid back: EMPIRE has earned back its ${usd0(rec.owed)}.`;
  if (rec.never) return `Not at today's pace — the current songs top out near ${usd0(rec.reach)} of the ${usd0(rec.owed)}.`;
  if (rec.date) return `At today's pace it's paid back around ${monthYear(rec.date)} (in ${aboutMonths(rec.months)}).`;
  return "";
}
// one plain sentence of what the bar means, for each way it can stand
export function meaningText(rec, terms) {
  if (!rec) return "";
  const owed = usd0(rec.owed), cut = pctText(terms.payout, 0), extra = usd0(terms.additional), by = dayText(terms.additionalBy);
  if (rec.recouped) return `EMPIRE has earned back its ${owed}, so from here Defied's ${cut} of what EMPIRE collects is paid out to Defied.`;
  if (rec.estimateOff) return `Until the bar is full, EMPIRE keeps Defied's ${cut} of what it collects to earn back its ${owed}; the statements typed in are counted, the rest waits for the pub sheet's rates.`;
  const keeps = `Until the bar is full, EMPIRE keeps Defied's ${cut} of what it collects to earn back its ${owed}`;
  switch (rec.additional?.state) {
    case "yes": return `${keeps}; at today's pace that's around ${monthYear(rec.date)}, in time for EMPIRE's extra ${extra} advance (Defied asks for it in writing once the account is recouped).`;
    case "late": return `${keeps}; at today's pace that's around ${monthYear(rec.date)}, after ${by}, so EMPIRE's extra ${extra} advance would be missed.`;
    case "missed": return `${keeps}, and the ${terms.additionalMonths} months for EMPIRE's extra ${extra} advance ended on ${by} without it.`;
    default: return `${keeps}, and at today's pace it never gets there, so Defied sees no cash from EMPIRE until more streams or more songs close the gap.`;
  }
}
// how much of the estimate is measured, and what it is made from
export function estimateNote(rec) {
  const e = rec?.estimate;
  if (!rec || rec.estimateOff) return "";
  if (!e?.from) return "Every quarter so far has an EMPIRE statement, so nothing here is estimated.";
  const songs = e.songs === 1 ? "1 song" : `${e.songs} songs`;
  const how = e.songs ? `${pctText(e.measuredShare, 0)} of those streams are counted from Luminate's totals (or a song's lifetime count since it came out), the rest is today's pace over the days` : "";
  return `Estimated from real streams since ${dayText(e.from)}: ${songs} on Schedule A${how ? `; ${how}` : ""}.${e.noShare ? ` ${e.noShare === 1 ? "1 song has" : `${e.noShare} songs have`} no split for the producer yet and ${e.noShare === 1 ? "isn't" : "aren't"} counted.` : ""}`;
}
// the first statements can be bigger than the estimate: EMPIRE also collects late payments for plays before the deal began (the letter of direction to the societies)
export const lateNote = (terms) => `A real statement can come in higher than the estimate: EMPIRE also collects what the societies and platforms pay late for plays before ${dayText(terms.effective)}.`;
export function buyoutText(rec, terms) {
  const b = rec?.buyout;
  if (!b) return "";
  if (rec.recouped || b.amount <= 0) return `From ${dayText(b.date)} Defied could buy out by repaying ${pctText(b.rate, 0)} of what's left. Nothing would be left at today's pace.`;
  return `From ${dayText(b.date)} Defied can buy out by repaying ${pctText(b.rate, 0)} of what's still unrecouped then: about ${usd0(b.amount)} at today's pace.`;
}
// the statements: a quarter in words, and when its statement comes
export const quarterWords = (q) => `${q.id}: ${dayShort(q.start)} – ${dayText(q.end)}`;
export const dueWords = (q) => `due ${dayText(q.due)}`;

// ---- the pot
// the stacked bar: given, planned and left as percents of the $75,000 (when more than all of it is promised, the bar is all given + planned, scaled down to fit)
export function potBar(pot) {
  const total = Number(pot?.total) || 0;
  if (!(total > 0)) return { given: 0, planned: 0, left: 0 };
  const g = Math.max(pot.given, 0), p = Math.max(pot.planned, 0), spent = g + p, scale = spent > total ? total / spent : 1;
  const r = (x) => Math.round(((x * scale) / total) * 1000) / 10;
  return { given: r(g), planned: r(p), left: Math.max(Math.round((100 - r(g) - r(p)) * 10) / 10, 0) };
}

// ---- the deals
export function scopeText(deal) {
  if (!deal.clientId) return `${deal.prospectName || "A prospect"}: not on Schedule A yet`;
  const n = deal.songs?.count ?? 0, names = deal.songs?.names || [];
  if (deal.scope === "songs") return `${n} ${n === 1 ? "song" : "songs"}: ${names.join(", ")}${n > names.length ? ` and ${n - names.length} more` : ""}`;
  return `Whole catalog (${n} ${n === 1 ? "song" : "songs"})`;
}
// a deal's payback line: where a given deal is, or how fast a planned one would repay
export function dealLine(deal) {
  const r = deal.recoup || {};
  if (r.off) return "The pub sheet's rates couldn't be read just now, so there's no payback figure.";
  if (r.none) return deal.clientId ? "None of its songs are on Schedule A right now, so there is nothing to count." : "Counting starts once they're a client with songs on Schedule A.";
  if (deal.status !== "given") {
    const p = r.payback || {};
    if (p.never) return `The producer's royalties would never pay this back at today's pace; the most they could ever repay is ${usd0(p.ceiling)}.`;
    if (p.months == null) return "No royalties at today's pace to pay it back from.";
    return `At today's pace the producer's royalties pay it back in ${aboutMonths(p.months)}.`;
  }
  if (r.recouped) return `Paid back: the producer's royalties since ${dayText(r.since)} cover the whole ${usd(deal.advance)}.`;
  const head = `${usd(r.royalties)} of ${usd(deal.advance)} paid back since ${dayText(r.since)} (${pctText(r.pct, 0)}), ${usd(r.remaining)} to go`;
  if (r.never) return `${head}. At today's pace the royalties never cover the rest.`;
  return r.date ? `${head}, around ${monthYear(r.date)} at today's pace.` : `${head}.`;
}

// ---- the calculator's pace, in words
// p: paceOfSongs()'s answer for the songs picked; rule: the sheet's run-rate (B9) as a fraction; decay: B8
export function paceSource({ p, rule, decay }) {
  const r = pctText(rule);
  if (p.real) {
    const rest = p.count - p.tracked;
    const other = rest > 0 ? ` ${rest === 1 ? "The other song uses" : `The other ${rest} use`} the sheet's rule (${r} of lifetime a year).` : "";
    return {
      real: true, perYear: p.perYear,
      source: `Real streams: Spotify's daily counts for ${p.tracked} of ${p.count} ${p.count === 1 ? "song" : "songs"}, scaled to all platforms by each song's lifetime total.${other}`,
      warning: p.newShare >= NEW_SONGS_WARN ? `${Math.round(p.newShare * 100)}% of this pace is from songs out under 3 months. New songs usually drop faster than ${pctText(decay)} a year, so treat this as the high end.` : null,
    };
  }
  return {
    real: false, perYear: p.perYear, warning: null,
    source: p.tracked > 0
      ? `Estimate: Spotify's daily counts cover only ${pctText(p.realShare)} of their pace (${p.tracked} of ${p.count} songs), so this uses the sheet's rule: lifetime streams × ${r} a year.`
      : `Estimate: no daily tracking for their songs, so this uses the sheet's rule: lifetime streams × ${r} a year.`,
  };
}
