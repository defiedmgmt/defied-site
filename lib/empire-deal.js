// (2026-11-21) The EMPIRE Publishing administration deal in Money › EMPIRE recoupment (the owner: "we pick our own pub admin deals for our guys so we can do single songs
// or whole catalogs"). Server-only and CONFIDENTIAL (lib/empire-terms.js says why); GET/POST /api/empire (Founders only: Money access and the Founder role) is the one way the page sees any of it.
//   EMPIRE advanced Defied $75,000 and paid $5,000 to its attorney, and takes it all back out of the Net Income it would otherwise pay Defied (80% of what EMPIRE
//   receives on every delivered song, Schedule A and what comes after). Defied gives its own producers advances out of the $75,000, and takes each one back from
//   that producer's royalties on the deal's songs (Defied's cut, 20% unless the deal says another, comes off first).
// What this file does (the shared math of a producer deal is lib/empire-math.js; the terms and the calendar, lib/empire-terms.js; what is saved, lib/empire-store.js):
//   earnedSince / earnedWindow  the streams a song earned over a stretch, and how that was worked out: "luminate" (Luminate's all-time totals at both ends),
//                               "count" (a song that came out inside the stretch: its whole lifetime count), "pace" (today's pace × days, when nothing better is there)
//   recoupment                  how much of the $80,000 is paid back: ONLY what EMPIRE's statements credited, typed in by the founders (2026-11-23, the owner: "start us at
//                               zero since we havent made nothing yet ... based on real"). Everything worked out from streams, the estimate (Defied's 80% of the Net Income
//                               of the streams earned for the days no statement covers), when it would be paid back at today's pace, whether that is before the Additional
//                               Advance date and what the buyout would cost on the 3-year date, is under `forecast`, never in the headline numbers: it is not money. It is "paid
//                               back" only when the statements alone say so (they come a quarter after the quarter ends)
//   potOf / dealRecoupment      the $75,000 (received, spent: given to producers + what a founder marked spent, planned, left) and each given deal's own payback: the producer's
//                               share of what the statements credited, split by each song's streams (its estimate is under `forecast`)
//   empireView / runAction      the page's one GET, and the writes behind POST
// Net Income of a stream = the pub sheet's rate a stream (ASSUMPTIONS!B7) × NI_SHARE (what EMPIRE receives of it). Estimates are labelled as such and say how much
// of them is measured. Nothing here writes to a sheet.
import { sql, rowsOrNoneIfNoTable } from "./db";
import { masterOverview } from "./sheet-cache";
import { streamsOn } from "./streams-on";
import { scheduleAPlan } from "./schedule-a";
import { readsOf, readSnaps, songPace, trackOf } from "./advance-pace";
import { ceiling, cumulative, monthsToRepay } from "./advance-model";
import { DAY, DEAL, DEFAULT_CUT, DEFAULT_MONTHS, MONTH_MS, NI_SHARE, addDays, addMonths, dayMs, nyDay, quarterList, quarterRange, termsOf, validQuarter, ymdOf } from "./empire-terms";
import { cents, paceOfSongs, producerDeal } from "./empire-math";
import { LIMITS, addStatement, checkDeal, checkDealStatus, checkLevers, checkReceived, checkSpend, checkStatement, createDeal, createSpend, dropDeal, dropSpend, dropStatement, editPatch, patchDeal, readState, setLevers, setReceived } from "./empire-store";
export * from "./empire-terms";
export * from "./empire-math";
export * from "./empire-store";

const NEAR_DAYS = 7; // a Luminate all-time total this close to a date stands in for the count on that date
const CLOSE_MONTHS = 6; // a projected payback this many months or fewer before the Additional Advance's last day is "close" to it, not "on track"
const WHOLE_DATE = /^\d{4}-\d{2}-\d{2}/;

// ---------------------------------------------------------------- levers
// The pub sheet's levers (ASSUMPTIONS B7 rate a stream, B8 yearly slowdown, B9 run-rate; lib/sheet-cache.js masterOverview's saved copy) and the Net Income share.
// assumptions missing or unreadable: { ok: false }, and nothing in dollars is worked out.
export function leversOf({ assumptions, niShare = null, readAt = null, stale = false } = {}) {
  const a = assumptions || {};
  const rate = Number(a.blendedRate), decay = Number(a.decayRate), run = Number(a.runRate);
  if (!(rate > 0) || !Number.isFinite(decay) || !Number.isFinite(run)) return { ok: false };
  const set = niShare != null && Number.isFinite(Number(niShare));
  const share = set ? Number(niShare) : NI_SHARE;
  return { ok: true, blendedRate: rate, decayRate: decay, runRate: run, adminFeeRate: Number(a.adminFeeRate) || 0, niShare: share, niShareSet: set, niStandard: NI_SHARE, niPerStream: rate * share, readAt, stale: !!stale };
}

// ---------------------------------------------------------------- the streams a song earned
// song: { share (0 to 1: the producer's own share of it), paceNet (net streams a year at today's pace), life (lifetime streams, all platforms), asOf (the day `life` is
// from: the site's streams-as-of day; blank = now), release ("YYYY-MM-DD" or less), atd: [{ on: "YYYY-MM-DD", total }] (Luminate's Worldwide all-time totals),
// paceNow (optional: today's measured rate, for filling the days between a count and the moment it stands for; paceNet when absent) }.
const points = (song) => (song.atd || []).filter((p) => WHOLE_DATE.test(String(p?.on)) && Number(p.total) >= 0).map((p) => ({ ms: dayMs(String(p.on).slice(0, 10)) + DAY, total: Number(p.total) })).sort((a, b) => a.ms - b.ms);
// the all-time point closest to a moment (inside NEAR_DAYS); the earlier one when two are equally close
function nearest(pts, at) {
  let best = null;
  for (const p of pts) {
    const gap = Math.abs(p.ms - at);
    if (gap > NEAR_DAYS * DAY) continue;
    if (!best || gap < best.gap || (gap === best.gap && p.ms < best.p.ms)) best = { p, gap };
  }
  return best ? best.p : null;
}
// the latest all-time count there is: the site's lifetime count (placements.streams, from its as-of day) unless a Luminate total is higher (then the site's is old)
function latestOf(song, pts, now) {
  const life = Math.max(Number(song.life) || 0, 0), newest = pts[pts.length - 1];
  if (life > 0 && (!newest || life >= newest.total)) {
    const asOf = WHOLE_DATE.test(String(song.asOf || "")) ? dayMs(String(song.asOf).slice(0, 10)) + DAY : now;
    return { total: life, ms: Math.min(asOf, now) };
  }
  return newest ? { total: newest.total, ms: Math.min(newest.ms, now) } : null;
}

// The streams a song earned from `from` to `to` (ms; `to` is `now` for "so far"), net of the share: { net, measured (counted: the part from the two totals), extra
// (the rest: today's pace over the gaps between a total and the moment it stands for), method: "luminate" | "count" | "pace" }.
//   luminate  the Luminate all-time total nearest the start (inside 7 days) and the latest count; each gap to its date is filled at the song's pace
//   count     the song came out after the start, so everything it has is since: its lifetime count
//   pace      nothing to count from (no total near the start, a count that went down, no count at all): today's pace × the days since the song came out
export function earnedWindow(song, from, to, now) {
  // (2026-11-24) streams already earned are filled at today's measured rate (paceNow), not the held pace a new song is planned on (lib/advance-pace.js songPace `forward`)
  const share = Number(song.share) || 0, paceDay = Math.max(Number(song.paceNow ?? song.paceNet) || 0, 0) / 365;
  if (!(share > 0) || !(to > from)) return { net: 0, measured: 0, extra: 0, method: "pace", from, to };
  const rel = WHOLE_DATE.test(String(song.release || "")) ? dayMs(String(song.release).slice(0, 10)) : NaN;
  const fresh = Number.isFinite(rel) && rel > from;
  const start = fresh ? rel : from;
  if (!(to > start)) return { net: 0, measured: 0, extra: 0, method: "pace", from: start, to };
  const pts = points(song);
  let before = null, after = null;
  if (fresh) before = { total: 0, ms: start };
  else { const p = nearest(pts, from); if (p) before = { total: p.total, ms: p.ms }; }
  if (to >= now) after = latestOf(song, pts, now);
  else { const p = nearest(pts, to); if (p) after = { total: p.total, ms: p.ms }; }
  // a count only counts when it is newer than the one it starts from (the same total twice is nothing new: the pace fills in)
  if (before && after && after.ms > before.ms && after.total >= before.total) {
    const net = (share * after.total + (paceDay * (to - after.ms)) / DAY) - (share * before.total + (paceDay * (start - before.ms)) / DAY);
    if (net >= 0) { const measured = share * (after.total - before.total); return { net, measured, extra: net - measured, method: fresh ? "count" : "luminate", from: start, to }; }
  }
  const net = (paceDay * (to - start)) / DAY;
  return { net, measured: 0, extra: net, method: "pace", from: start, to };
}
// ...since a day (YYYY-MM-DD) until now
export const earnedSince = (song, since, now = Date.now()) => earnedWindow(song, dayMs(since), now, now);

// ---------------------------------------------------------------- the $80,000
// What EMPIRE pays Defied on a net stream, and what is in it: Net Income (levers.niPerStream) × the payout
const creditRate = (levers, terms) => levers.niPerStream * terms.payout;

// Sum of earnedWindow over songs. -> { net, measured, extra, songs (counted), byMethod: { luminate, count, pace }, noShare }
function earnedAll(songs, from, to, now) {
  const out = { net: 0, measured: 0, extra: 0, songs: 0, byMethod: { luminate: 0, count: 0, pace: 0 }, noShare: 0 };
  for (const s of songs) {
    if (!(Number(s.share) > 0)) { out.noShare++; continue; }
    const e = earnedWindow(s, from, to, now);
    out.net += e.net; out.measured += e.measured; out.extra += e.extra; out.songs++; out.byMethod[e.method]++;
  }
  return out;
}

// How much of EMPIRE's advance is paid back (the bar), and when it will be.
//   songs       Schedule A's songs (see earnedWindow, plus { paceNet, ruleNet, kind, isNew } for today's pace)
//   statements  what the founders typed in: [{ quarter, netIncome, credited }]; levers: leversOf's answer (ok); now: ms
// (2026-11-23, the owner: "start us at zero ... this shld be based on real") The headline, `credited` / `remaining` / `pct` and `recouped`, is what EMPIRE's statements credited and nothing
// else: with none typed in it is $0 of the $80,000. What is worked out from streams is under `forecast`: the estimate (every stretch since the Effective Date that no statement covers,
// up to now; a stretch of quarters in a row with no statement is ONE stretch, so the Luminate totals at its two ends are used rather than a pace for each quarter), when it would be
// paid back at today's pace, the Additional Advance and the buyout. Nothing in `forecast` is money paid back.
export function recoupment({ songs = [], statements = [], levers, now = Date.now(), terms = DEAL }) {
  const today = nyDay(now);
  const owed = terms.owed;
  const quarters = quarterList(today, terms.effective);
  const have = new Set(statements.map((s) => s.quarter));
  const fromStatements = statements.reduce((a, s) => a + (Number(s.credited) || 0), 0);
  const netStatements = statements.reduce((a, s) => a + (Number(s.netIncome) || 0), 0);
  const lastQuarter = statements.map((s) => s.quarter).sort().pop() || null;
  const stretches = [];
  let open = null;
  for (const q of quarters) {
    if (have.has(q.id)) { open = null; continue; }
    const from = dayMs(q.start), to = q.over ? dayMs(addDays(q.end, 1)) : now;
    if (open) { open.to = to; open.quarters.push(q.id); } else { open = { from, to, quarters: [q.id] }; stretches.push(open); }
  }
  const missing = quarters.filter((q) => !have.has(q.id) && q.over && lastQuarter && q.id < lastQuarter).map((q) => q.id); // quarters before the last statement with none of their own
  const out = {
    owed, today, quarters: quarters.map((q) => q.id), covered: statements.map((s) => s.quarter).sort(), lastStatement: lastQuarter, missing,
    netStatements: cents(netStatements),
    credited: cents(fromStatements), remaining: cents(Math.max(0, owed - fromStatements)), pct: Math.min(fromStatements / owed, 1),
  };
  // (2026-11-21, review) "paid back" is EMPIRE's word, and only the statements typed in can say it: the day they reach the total is the end of the quarter whose statement takes
  // the running total there. The estimate crossing it is only "estimated to be paid back" until a statement says so (they come a quarter after the quarter ends).
  let run = 0, recoupedOn = null;
  for (const s of [...statements].sort((a, b) => String(a.quarter).localeCompare(String(b.quarter)))) {
    run += Number(s.credited) || 0;
    if (cents(run) >= owed) { recoupedOn = quarterRange(s.quarter).end; break; }
  }
  out.recouped = recoupedOn != null;

  // ---- the forecast: an estimate from streams, not money
  let estimated = 0;
  const est = { from: stretches[0] ? ymdOf(stretches[0].from) : null, to: stretches.length ? today : null, songs: 0, measured: 0, pace: 0, noShare: 0, measuredShare: 0, ni: 0 };
  if (levers?.ok) {
    let net = 0, measured = 0, extra = 0, longest = null;
    for (const w of stretches) {
      const e = earnedAll(songs, w.from, w.to, now);
      net += e.net; measured += e.measured; extra += e.extra;
      if (!longest || w.to - w.from > longest.span) longest = { span: w.to - w.from, e };
    }
    // how many songs the estimate counts, and how many of those were measured (Luminate's totals, or a lifetime count) rather than taken at today's pace: those of its longest stretch
    if (longest) Object.assign(est, { songs: longest.e.songs, measured: longest.e.byMethod.luminate + longest.e.byMethod.count, pace: longest.e.byMethod.pace, noShare: longest.e.noShare });
    est.ni = cents(net * levers.niPerStream);
    est.measuredShare = net > 0 ? measured / (measured + extra) : 0;
    estimated = net * creditRate(levers, terms);
  }
  const credited = fromStatements + estimated;
  const remaining = Math.max(0, owed - credited);
  const fc = { off: !levers?.ok, estimated: cents(estimated), estimate: est, credited: cents(credited), remaining: cents(remaining), pct: Math.min(credited / owed, 1), estimatedRecouped: !out.recouped && remaining <= 0 };
  out.forecast = fc;
  // today's pace across Schedule A: Defied's payout a year, at the pace the songs run now (the slowdown the pub sheet assumes follows)
  const pace = paceOfSongs(songs.filter((s) => Number(s.share) > 0));
  fc.pace = { perYear: pace.perYear, real: pace.real, realShare: pace.realShare, newShare: pace.newShare, tracked: pace.tracked, songs: pace.count };
  Object.assign(fc, { perYear: null, months: null, date: null, never: false, ceiling: null, reach: null, next: null, additional: null, buyout: null });
  if (!levers?.ok) return out;
  const perYear = pace.perYear * creditRate(levers, terms);
  fc.perYear = cents(perYear);
  const decay = levers.decayRate;
  if (out.recouped || fc.estimatedRecouped) fc.months = 0;
  else if (perYear > 0) {
    const months = monthsToRepay(remaining, perYear, decay);
    if (months === Infinity) { const top = ceiling(perYear, decay) ?? 0; fc.never = true; fc.ceiling = cents(top); fc.reach = cents(credited + top); }
    else { fc.months = months; fc.date = ymdOf(now + months * MONTH_MS); }
  } else { fc.never = true; fc.ceiling = 0; fc.reach = cents(credited); }
  // what today's pace would put on the next statement: the quarter it is for (the first one over without a statement, else the one running)
  const nextQ = quarters.find((q) => q.over && !have.has(q.id)) || quarters.find((q) => !q.over);
  if (nextQ) {
    const e = earnedAll(songs, dayMs(nextQ.start), dayMs(addDays(nextQ.end, 1)), now);
    fc.next = { quarter: nextQ.id, start: nextQ.start, end: nextQ.end, due: nextQ.due, amount: cents(e.net * creditRate(levers, terms)) };
  }
  // the Additional Advance (cl. 3(b)): the account has to reach fully recouped within 30 months of the Effective Date. Only the statements can say "yes" (they have recouped it on or
  // before that day) or "missed" (they show it after, or the day has passed without them showing it); every other state is an estimate from today's pace:
  //   ontrack  estimated paid back more than 6 months before that day     close  estimated within those 6 months (6 months before included), up to the day itself
  //   late     estimated after it     no  never at today's pace
  const lastDay = terms.additionalBy, closeFrom = addMonths(lastDay, -CLOSE_MONTHS);
  let state;
  if (out.recouped) state = recoupedOn <= lastDay ? "yes" : "missed";
  else if (today > lastDay) state = "missed";
  else if (fc.never) state = "no";
  else { const when = fc.date || today; state = when > lastDay ? "late" : when >= closeFrom ? "close" : "ontrack"; }
  fc.additional = { amount: terms.additional, by: lastDay, state };
  // the buyout (cl. 2): from the 3-year date Defied can repay 110% of what is still unrecouped then
  const monthsTo = Math.max(0, (dayMs(terms.threeYear) - now) / MONTH_MS);
  const addBy = perYear > 0 ? cumulative(perYear, decay, monthsTo) : 0;
  const unrecouped = out.recouped ? 0 : Math.max(0, remaining - addBy);
  fc.buyout = { date: terms.threeYear, rate: terms.buyout, open: today >= terms.threeYear, unrecouped: cents(unrecouped), amount: cents(unrecouped * terms.buyout) };
  return out;
}

// A producer deal over a producer's songs (one song or many: each with its own pace), the way the calculator works it: today's pace of those songs (each measured song at its
// measured pace, the rest by the sheet's rule, lib/empire-math.js paceOfSongs), Net Income a stream from the levers, EMPIRE's payout from the terms, Defied's cut (the standard
// 20% unless the deal says another), the months the royalties should take and an amount to check. pot: potOf's answer (optional). -> producerDeal's answer
export function producerDealFor({ songs, cut = DEFAULT_CUT, levers, months = DEFAULT_MONTHS, amount = null, pot = null, terms = DEAL }) {
  return producerDeal({ pace: paceOfSongs((songs || []).filter((s) => Number(s.share) > 0)).perYear, ni: levers.niPerStream, payout: terms.payout, cut, decay: levers.decayRate, months, amount, pot });
}

// The $75,000: what has been SPENT, what is planned, what is left. received: { on, at }. (2026-11-23, the owner: "it should start at zero spent and go up when i mark off money spent")
// Spent is money that has gone out: the advances of the deals marked given, plus the spending entries a founder marked (spends: [{ amount }]). A planned deal is a plan, not money: it
// stays out of `spent` and `left`, and is only counted on its own (`planned`). `free` is what is neither spent nor planned, which the advance calculator plans against. Going over the
// total is allowed: `left` is then negative and `over` says by how much.
export function potOf({ received, deals = [], spends = [], total = DEAL.execution } = {}) {
  const of = (status) => deals.filter((d) => d.status === status);
  const sum = (xs, k) => xs.reduce((a, d) => a + (Number(d[k]) || 0), 0);
  const given = of("given"), planned = of("planned");
  const spent = sum(given, "advance") + sum(spends, "amount");
  const left = total - spent;
  return {
    total, received: { on: !!received?.on, at: received?.at || null },
    spent: cents(spent), pct: total > 0 ? spent / total : 0, left: cents(left), over: left < 0 ? cents(-left) : 0,
    given: cents(sum(given, "advance")), givenCount: given.length, entries: cents(sum(spends, "amount")), entryCount: spends.length,
    planned: cents(sum(planned, "advance")), plannedCount: planned.length, free: cents(left - sum(planned, "advance")),
  };
}

// The songs a deal covers: its producer's whole catalog on Schedule A now, or the songs it names (the ones still on Schedule A)
export function dealSongs(deal, songs) {
  if (!deal.clientId) return [];
  const mine = songs.filter((s) => s.clientId === deal.clientId);
  if (deal.scope !== "songs") return mine;
  const ids = new Set(deal.placementIds || []);
  return mine.filter((s) => ids.has(s.id));
}

// What EMPIRE's statements have paid back of a GIVEN deal (2026-11-23, real money only: $0 until a statement covers it). A statement credits Defied for the whole account and doesn't
// say which song earned what, so each one is split by streams: the producer's part of what it credited (what is left after Defied's cut) × the deal's songs' share of that quarter's
// Net Income, which is worked out from the streams every song earned in it (the rate and the share cancel, so only the streams count). It counts from the day the advance was given: a
// statement for a quarter that ended before it counts for nothing, and the days of its own quarter before it are left out of the deal's part. Never more than the advance.
// -> { since, paid, remaining, pct, recouped, statements (how many counted) }
function paidFromStatements({ deal, mine, songs, statements, now, terms }) {
  const all = songs.filter((s) => Number(s.share) > 0);
  let paid = 0, counted = 0;
  for (const s of statements) {
    const q = quarterRange(s.quarter);
    if (q.end < deal.givenOn) continue;
    counted++;
    const start = dayMs(q.start < terms.effective ? terms.effective : q.start), to = dayMs(addDays(q.end, 1));
    const whole = earnedAll(all, start, to, now).net, part = earnedAll(mine, Math.max(start, dayMs(deal.givenOn)), to, now).net;
    if (whole > 0 && part > 0) paid += (Number(s.credited) || 0) * (1 - deal.cut) * Math.min(part / whole, 1);
  }
  const got = cents(Math.min(paid, deal.advance));
  return { since: deal.givenOn, paid: got, remaining: cents(Math.max(0, deal.advance - got)), pct: Math.min(got / deal.advance, 1), recouped: got >= deal.advance, statements: counted };
}

// One deal's payback from the producer's royalties (Net Income x payout x (1 - cut) on its songs). A given deal: what the statements have paid back so far (paidFromStatements: real, $0
// until one covers it), and under `forecast` the estimate that used to be its headline: the royalties earned since its day, what is left of them, and when it pays back at today's pace.
// Every deal: what it would take at today's pace (`payback`). A planned deal repays nothing.
export function dealRecoupment({ deal, songs, levers, statements = [], now = Date.now(), terms = DEAL }) {
  const mine = dealSongs(deal, songs).filter((s) => Number(s.share) > 0);
  const out = { songs: mine.length };
  // (the real part needs no rates: it splits a credit that is already in dollars)
  if (mine.length && deal.status === "given" && deal.givenOn) Object.assign(out, paidFromStatements({ deal, mine, songs, statements, now, terms }));
  if (!levers?.ok) { out.off = true; return out; }
  if (!mine.length) return { songs: 0, none: true };
  const rate = creditRate(levers, terms) * (1 - deal.cut);
  const pace = paceOfSongs(mine);
  const perYear = pace.perYear * rate;
  Object.assign(out, { perYear: cents(perYear), pace: { real: pace.real, realShare: pace.realShare, tracked: pace.tracked } });
  const fullMonths = monthsToRepay(deal.advance, perYear, levers.decayRate);
  out.payback = { months: fullMonths == null ? null : fullMonths, never: fullMonths === Infinity, ceiling: perYear > 0 ? cents(ceiling(perYear, levers.decayRate) ?? 0) : 0 };
  if (deal.status !== "given" || !deal.givenOn) return out;
  const e = earnedAll(mine, dayMs(deal.givenOn), now, now);
  const royalties = e.net * rate;
  const remaining = Math.max(0, deal.advance - royalties);
  const fc = { royalties: cents(royalties), remaining: cents(remaining), pct: Math.min(royalties / deal.advance, 1), recouped: remaining <= 0, measuredShare: e.net > 0 ? e.measured / (e.measured + e.extra) : 0 };
  out.forecast = fc;
  if (!fc.recouped && perYear > 0) {
    const months = monthsToRepay(remaining, perYear, levers.decayRate);
    if (months === Infinity) fc.never = true; else { fc.months = months; fc.date = ymdOf(now + months * MONTH_MS); }
  } else if (!fc.recouped) fc.never = true;
  return out;
}

// ---------------------------------------------------------------- the songs, from the database
// scheduleAPlan's rows plus what the estimate needs about each: raw: { rows, placementsById: Map, clientsById: Map, reads, atdByLum: Map, asOf } (loadRaw's answer)
export function songsOf(raw, runRate, now = Date.now()) {
  const out = [];
  for (const row of raw.rows) {
    const p = raw.placementsById.get(row.siteId), c = raw.clientsById.get(row.clientId);
    if (!p || !c) continue;
    const sp = songPace(p, c, raw.reads, runRate, now);
    const lum = String(p.luminate_id || "");
    out.push({
      id: row.siteId, clientId: row.clientId, client: row.writer, song: row.song, artist: row.artist, release: row.releaseDate || "", link: row.link || "",
      // paceNet: the pace to plan on (a new song held toward the rule, lib/advance-pace.js songPace); paceNow: today's measured rate, for the streams already earned
      share: sp.share, life: sp.life, paceNet: sp.real ? sp.forward : sp.rule, paceNow: sp.real ? sp.perYear : sp.rule, ruleNet: sp.rule, kind: sp.real ? "real" : "rule", isNew: sp.isNew, launch: sp.launch,
      asOf: raw.asOf || "", atd: lum ? raw.atdByLum.get(lum) || [] : [],
    });
  }
  return out;
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
// Reads what the page works from: Schedule A's rows (the contract's catalog: every producer's songs, each once), the Spotify readings for their tracks, Luminate's
// all-time totals for the songs that carry a Luminate id (lum_points, and the monthly true-up's trueup_points) and the day the site's streams are from
export async function loadRaw({ now = Date.now() } = {}) {
  const [clients, placements, asOf] = await Promise.all([
    sql`SELECT id, name, credit, role, sheet_tab_name, on_roster, roster_order FROM clients`,
    sql`SELECT id, client_id, song, artist, release_date, link, streams, splits, luminate_id FROM placements`,
    streamsOn().catch(() => null),
  ]);
  const rows = scheduleAPlan({ clients, placements }).rows;
  const placementsById = new Map(placements.map((p) => [p.id, p]));
  const clientsById = new Map(clients.map((c) => [c.id, c]));
  const tracks = [...new Set(rows.map((r) => trackOf(placementsById.get(r.siteId)?.link)).filter(Boolean).map((t) => `t:${t}`))];
  const snaps = tracks.length ? await readSnaps(sql, tracks, now) : [];
  const lumIds = [...new Set(rows.map((r) => String(placementsById.get(r.siteId)?.luminate_id || "")).filter(Boolean))];
  const [lum, tru] = lumIds.length ? await Promise.all([
    rowsOrNoneIfNoTable(sql`SELECT lum_id, period_to::text AS day, value::float8 AS total FROM lum_points WHERE grain = 'atd' AND location = 'Worldwide' AND lum_id = ANY(${lumIds}) ORDER BY lum_id, period_to`),
    rowsOrNoneIfNoTable(sql`SELECT lum_id, total_on::text AS day, total::float8 AS total FROM trueup_points WHERE lum_id = ANY(${lumIds}) ORDER BY lum_id, total_on`),
  ]) : [[], []];
  // one total a day (the true-up's wins a tie), oldest first
  const byLum = new Map();
  for (const r of [...lum, ...tru]) {
    const day = String(r.day || "").slice(0, 10), total = num(r.total);
    if (!WHOLE_DATE.test(day) || !(total >= 0)) continue;
    if (!byLum.has(r.lum_id)) byLum.set(r.lum_id, new Map());
    byLum.get(r.lum_id).set(day, total);
  }
  const atdByLum = new Map([...byLum].map(([id, days]) => [id, [...days].sort(([a], [b]) => a.localeCompare(b)).map(([on, total]) => ({ on, total }))]));
  return { rows, placementsById, clientsById, reads: readsOf(snaps, now), atdByLum, asOf };
}
// who a deal may be for: Map clientId -> { name, ids: Set of that producer's placement ids on Schedule A } (a lighter read than loadRaw)
export async function loadOwners() {
  const [clients, placements] = await Promise.all([
    sql`SELECT id, name, credit, role, sheet_tab_name, on_roster, roster_order FROM clients`,
    sql`SELECT id, client_id, song, artist, release_date, link, streams, splits, luminate_id FROM placements`,
  ]);
  const owners = new Map();
  for (const r of scheduleAPlan({ clients, placements }).rows) {
    if (!owners.has(r.clientId)) owners.set(r.clientId, { name: r.writer, ids: new Set() });
    owners.get(r.clientId).ids.add(r.siteId);
  }
  return owners;
}

// ---------------------------------------------------------------- the page's answer
// (launch: a new song's pace is held down; measuredNet: its measured pace, which the calculator's "Show the math" names beside it)
const songView = (s) => ({ id: s.id, song: s.song, artist: s.artist, release: s.release, share: s.share, life: s.life, paceNet: s.paceNet, ruleNet: s.ruleNet, kind: s.kind, isNew: s.isNew,
  launch: !!s.launch, measuredNet: s.kind === "real" ? Number(s.paceNow ?? s.paceNet) || 0 : 0 });
const dealWords = (deal, songs) => {
  const mine = dealSongs(deal, songs);
  return { count: mine.length, names: mine.slice(0, 4).map((s) => s.song) };
};
// (2026-11-21, review) What is still to pay back on a deal, an ESTIMATE for planning (it is the forecast's, not the statements'): a planned deal's whole advance (nothing is earned against
// it until it is given), a given deal's advance less the royalties earned since its day. Without that estimate (rates unreadable, no songs on Schedule A) the whole advance, the
// careful side. The calculator takes it off the advance it recommends for a producer who already has a deal.
const owingOf = (deal, recoup) => cents(deal.status === "given" && recoup?.forecast?.remaining != null ? recoup.forecast.remaining : deal.advance);

// Pure. state: readState's answer; songs: songsOf's; lev: leversOf's; asOf: the day the site's streams are from
export function buildView({ state, songs, lev, now = Date.now(), asOf = null, terms = DEAL }) {
  const today = nyDay(now);
  const have = new Set(state.statements.map((s) => s.quarter));
  const quarters = quarterList(today, terms.effective).map((q) => ({ ...q, statement: have.has(q.id) }));
  const nextDue = quarters.find((q) => q.over && !q.statement) || quarters.find((q) => !q.over) || null;
  const by = new Map();
  for (const s of songs) {
    if (!by.has(s.clientId)) by.set(s.clientId, { id: s.clientId, name: s.client, songs: [] });
    by.get(s.clientId).songs.push(songView(s));
  }
  return {
    now: new Date(now).toISOString(), today, streamsOn: asOf, terms: termsOf(terms),
    defaults: { cut: DEFAULT_CUT, niShare: NI_SHARE, months: DEFAULT_MONTHS },
    levers: lev,
    recoupment: recoupment({ songs, statements: state.statements, levers: lev, now, terms }),
    pot: potOf({ received: state.received, deals: state.deals, spends: state.spends, total: terms.execution }),
    received: state.received,
    deals: state.deals.map((d) => { const recoup = dealRecoupment({ deal: d, songs, levers: lev, statements: state.statements, now, terms }); return { ...d, songs: dealWords(d, songs), recoup, owing: owingOf(d, recoup) }; }),
    spends: state.spends,
    statements: state.statements.map((s) => ({ ...s, end: quarterRange(s.quarter).end })),
    quarters, nextDue,
    producers: [...by.values()],
    stats: { songs: songs.length, noShare: songs.filter((s) => !(s.share > 0)).length, tracked: songs.filter((s) => s.kind === "real").length },
  };
}

// The sheet's levers, from the saved MASTER copy (a read the whole dashboard shares). A failure is { ok: false }, never a thrown error: the page then says so.
async function readAssumptions() {
  try { const o = await masterOverview(); return { assumptions: o?.v?.assumptions, readAt: o?.readAt ?? null, stale: !!o?.stale }; } catch (err) {
    console.error("empire: the pub sheet's levers couldn't be read:", err?.message || err);
    return { assumptions: null };
  }
}

export async function empireView({ now = Date.now() } = {}) {
  const [state, raw, sheet] = await Promise.all([readState(), loadRaw({ now }), readAssumptions()]);
  const lev = leversOf({ assumptions: sheet.assumptions, niShare: state.levers.niShare, readAt: sheet.readAt, stale: sheet.stale });
  return buildView({ state, songs: songsOf(raw, lev.ok ? lev.runRate : 0, now), lev, now, asOf: raw.asOf });
}

// ---------------------------------------------------------------- the writes (POST /api/empire)
const fail = (status, error) => ({ status, body: { error } });
const done = (body = {}) => ({ status: 200, body: { ok: true, ...body } });
// -> { status, body }. b: the request body; by: who is signed in (their name); now: ms
export async function runAction(b, { by = "staff", now = Date.now() } = {}) {
  const today = nyDay(now), at = new Date(now).toISOString();
  switch (b?.action) {
    case "saveDeal": {
      const state = await readState();
      const base = b.id ? state.deals.find((d) => d.id === String(b.id)) : null;
      if (b.id && !base) return fail(404, "That deal isn't there any more. Reload to see what's left.");
      if (!b.id && state.deals.length >= LIMITS.deals) return fail(400, `That's ${LIMITS.deals} deals already.`);
      const owners = await loadOwners();
      const input = base ? { ...b, status: undefined } : b;
      const r = checkDeal(input, { today, owners, base, others: state.deals });
      if (r.error) return fail(400, r.error);
      if (!base) return done({ deal: await createDeal({ ...r.value, by, at }) });
      // an edit never changes the status (that is setDealStatus), and writes only the fields the request sent: what it read of the deal may be a moment old, and the rest of the
      // deal (its status and given day, another founder's new advance) is left as it is now
      const deal = await patchDeal(base.id, { ...editPatch(b, r.value), updatedBy: by, updatedAt: at });
      return deal ? done({ deal }) : fail(404, "That deal was deleted just now.");
    }
    case "setDealStatus": {
      const state = await readState();
      const base = state.deals.find((d) => d.id === String(b.id ?? ""));
      if (!base) return fail(404, "That deal isn't there any more. Reload to see what's left.");
      const r = checkDealStatus(b, { today, base });
      if (r.error) return fail(400, r.error);
      const deal = await patchDeal(base.id, { ...r.value, updatedBy: by, updatedAt: at });
      return deal ? done({ deal }) : fail(404, "That deal was deleted just now.");
    }
    case "deleteDeal": {
      const id = String(b.id ?? "");
      if (!id || id.length > 60) return fail(400, "Pick a deal to delete.");
      return (await dropDeal(id)) ? done() : fail(404, "That deal was already deleted.");
    }
    case "addStatement": {
      const state = await readState();
      if (state.statements.length >= LIMITS.statements) return fail(400, `That's ${LIMITS.statements} statements already.`);
      const r = checkStatement(b, { today, taken: state.statements.map((s) => s.quarter) });
      if (r.error) return fail(400, r.error);
      const entry = { ...r.value, enteredBy: by, at };
      if (!(await addStatement(entry))) return fail(409, `${r.value.quarter} already has a statement (someone entered it just now). Reload to see it.`);
      return done({ statement: entry });
    }
    case "deleteStatement": {
      const quarter = String(b.quarter ?? "").toUpperCase();
      if (!validQuarter(quarter)) return fail(400, "Pick a statement to delete.");
      return (await dropStatement(quarter)) ? done() : fail(404, `${quarter} has no statement.`);
    }
    case "setReceived": {
      const r = checkReceived(b, { today });
      if (r.error) return fail(400, r.error);
      await setReceived({ ...r.value, by, when: at });
      return done({ received: r.value });
    }
    case "addSpend": {
      const state = await readState();
      if (state.spends.length >= LIMITS.spends) return fail(400, `That's ${LIMITS.spends} spending entries already.`);
      const r = checkSpend(b, { today });
      if (r.error) return fail(400, r.error);
      return done({ spend: await createSpend({ ...r.value, by, at }) });
    }
    case "deleteSpend": {
      const id = String(b.id ?? "");
      if (!id || id.length > 60) return fail(400, "Pick an entry to delete.");
      return (await dropSpend(id)) ? done() : fail(404, "That entry was already deleted.");
    }
    case "setLevers": {
      const r = checkLevers(b);
      if (r.error) return fail(400, r.error);
      await setLevers(r.value.niShare == null ? null : { niShare: r.value.niShare, by, when: at });
      return done({ levers: r.value });
    }
    default:
      return fail(400, "Unknown action.");
  }
}

