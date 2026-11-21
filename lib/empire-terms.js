// (2026-11-21) The EMPIRE Publishing administration deal's terms, and the calendar it runs on. Server-only and CONFIDENTIAL: the contract keeps its terms
// between the parties (cl. 13), so nothing here may be imported by a page component. The dashboard gets these numbers from GET /api/empire (Money access only) and
// never carries them in its own code; the math the page shares with the server (lib/empire-math.js) takes every rate as an argument for that reason.
// Clause numbers are the agreement's own paragraph numbers (1 Compositions, 2 Term, 3 Advance, 4 Royalty, 5 Rights, 10 Accounting, 13 Confidentiality).

const EXECUTION = 75000; // cl. 3(a) Execution Advance, payable after full execution and Delivery of the Catalog (Schedule A)
const LEGAL = 5000;      // cl. 3(c) Legal Advance, paid to Defied's attorney; it counts as payment to Defied, so it is recouped too
export const EFFECTIVE = "2026-09-01"; // the preamble: "effective as of September 1, 2026"

// Dates by calendar (UTC days written YYYY-MM-DD). Pure.
export const DAY = 864e5;
export const MONTH_MS = (365.2425 / 12) * DAY; // an average month, for "in N months" from today
const pad = (n) => String(n).padStart(2, "0");
export const dayMs = (ymd) => Date.parse(`${ymd}T00:00:00Z`);
export const ymdOf = (ms) => new Date(ms).toISOString().slice(0, 10);
export const validYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && Number.isFinite(dayMs(s)) && ymdOf(dayMs(s)) === s;
// the New York day (the site's own clock for "today", as lib/streams-on.js nyYmd)
export const nyDay = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
export const addDays = (ymd, n) => ymdOf(dayMs(ymd) + n * DAY);
export const daysBetween = (a, b) => Math.round((dayMs(b) - dayMs(a)) / DAY);
// a date n calendar months on (made for the 1st of a month: Mar 1 + 30 months)
export function addMonths(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  return ymdOf(Date.UTC(y, m - 1 + n, d));
}

export const DEAL = Object.freeze({
  effective: EFFECTIVE,
  execution: EXECUTION,
  legal: LEGAL,
  owed: EXECUTION + LEGAL,        // cl. 3(d): every advance is recoupable from the Net Income otherwise payable to Defied, across every delivered composition (cl. 1: Schedule A plus the New Compositions)
  additional: 75000,              // cl. 3(b) Additional Advance, if the account reaches fully recouped within 30 months of the Effective Date, after Defied's written notice
  additionalMonths: 30,
  additionalBy: addMonths(EFFECTIVE, 30), // 2029-03-01
  payout: 0.8,                    // cl. 4(c) EMPIRE pays Defied 80% of Net Income, subject to recoupment
  payoutSync: 0.7,                // cl. 4(d) 70% instead on EMPIRE-procured sync licences and recordings from sessions EMPIRE arranged (not streams: nothing here models it)
  termYears: 3,                   // cl. 2 the term is the later of three years or recoupment (then 90-day options)
  threeYear: addMonths(EFFECTIVE, 36), // 2029-09-01: from here Defied may repay the unrecouped balance (cl. 2) and be recouped
  buyout: 1.1,                    // cl. 2 ... at 110% of the unrecouped balance on the latest statement (with EMPIRE's estimate of pipeline income)
  feeCap: 0.15,                   // cl. 4(a) Net Income is after collection fees, capped at 15% of gross (B7 is already after society fees)
  minPayment: 300,                // cl. 10(a) no payment for a period when what is payable is $300 or less (held for the next one); a statement still comes. Cash timing only: not in the math
  quarterEnds: Object.freeze(["03-31", "06-30", "09-30", "12-31"]), // cl. 10(a) EMPIRE accounts as of each of these for the prior three months, and sends the statement (and payment) at the next one
});

// What share of whole-song publishing (the pub sheet's B7, a rate a stream) EMPIRE actually receives as Net Income. B7 is mechanical + performance, writer and
// publisher; EMPIRE collects the mechanicals (about half of it) and the publisher's half of performance (about a quarter): 0.5 + 0.25. The writer's share of
// performance (the other quarter) isn't Net Income: the writer is paid it through their PRO, outside the deal and its recoupment (cl. 4(a), cl. 5(d); 2026-11-21, review: the page says so). Our estimate, not a term;
// a Founder can change it (app_state "empireDeal" levers.niShare, Money › EMPIRE deal).
export const NI_SHARE = 0.75;
export const NI_SHARE_RANGE = [0.1, 1];
// Defied's cut of what EMPIRE pays on a producer's songs, unless the deal says another (the owner, 2026-11-21): 20%
export const DEFAULT_CUT = 0.2;
export const DEFAULT_MONTHS = 18;

// ---- quarters. A statement is for a quarter ("2026Q3"); the first one starts on the Effective Date.
export const validQuarter = (id) => /^\d{4}Q[1-4]$/.test(String(id));
export const quarterId = (ymd) => `${ymd.slice(0, 4)}Q${Math.floor((Number(ymd.slice(5, 7)) - 1) / 3) + 1}`;
export const nextQuarter = (id) => (id.endsWith("Q4") ? `${Number(id.slice(0, 4)) + 1}Q1` : `${id.slice(0, 4)}Q${Number(id[5]) + 1}`);
// the quarter's first and last day
export function quarterRange(id) {
  const y = Number(id.slice(0, 4)), m0 = (Number(id[5]) - 1) * 3;
  return { id, start: `${y}-${pad(m0 + 1)}-01`, end: ymdOf(Date.UTC(y, m0 + 3, 0)) };
}
// Every quarter from the Effective Date's through today's: { id, start (never before the Effective Date), end, over (it has ended), due (when its statement
// comes: the end of the next quarter, cl. 10(a)) }.
export function quarterList(today, effective = EFFECTIVE) {
  const out = [];
  if (today < effective) return out;
  for (let id = quarterId(effective), n = 0; id <= quarterId(today) && n < 60; id = nextQuarter(id), n++) {
    const r = quarterRange(id);
    out.push({ id, start: r.start < effective ? effective : r.start, end: r.end, over: r.end < today, due: quarterRange(nextQuarter(id)).end });
  }
  return out;
}

// The terms as GET /api/empire sends them (the page draws its markers, sentences and the bar from these)
export const termsOf = (deal = DEAL) => ({
  effective: deal.effective, execution: deal.execution, legal: deal.legal, owed: deal.owed,
  additional: deal.additional, additionalMonths: deal.additionalMonths, additionalBy: deal.additionalBy,
  payout: deal.payout, payoutSync: deal.payoutSync, threeYear: deal.threeYear, buyout: deal.buyout, feeCap: deal.feeCap, minPayment: deal.minPayment,
});
