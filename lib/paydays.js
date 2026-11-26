// Paydays (2026-11-26, the owner: "the whole royalty payout tracker" lives in Money as its own pill): the days BMI, ASCAP and The MLC pay
// our writers, and which clients each one pays, so the team knows when to expect commission. Pure, no imports: the page, the To do rows,
// the calendar chips, the Monday digest and the ClickUp Money task all read it. lib/paydays-store.js keeps it in app_state 'paydays'.
//
// Stored as one flat object (each save merges only its own key, so two saves can't undo each other):
//   "date:<source>:<YYYY-MM-DD>"  {} or { approx: true } (ASCAP published only the month: the day is its calendar's, shown with ≈)
//   "who:<clientId>"              ["bmi", "mlc"]: the sources that pay that client
//   "done:<source>:<YYYY-MM-DD>"  { by, at }: Got it, that payday's commission is sorted
// SEED is what's used while there's no row yet; the first save stores SEED with that save on top (lib/paydays-store.js).
//
// The seed is real (e/features-1125/payouts.json, checked against BMI's, ASCAP's and The MLC's own pages 2026-11-25/26): every 2026 date
// and every 2027 date published so far. Nothing is computed for the dates not out yet: a Founder types each one when the source posts it.
// Defied's own publishing statements (they aren't a client's commission), SoundExchange, SESAC and GMR (no published days) aren't here.

export const PAYDAYS_KEY = "paydays";
export const KEEP_DAYS = 14; // a payday's To do row lasts 14 days at most
export const SOURCES = [
  { id: "bmi", name: "BMI", url: "https://www.bmi.com/creators/royalty/how_we_pay_royalties" },
  { id: "ascap-w", name: "ASCAP writer", url: "https://www.ascap.com/help/royalties-and-payment/payment/distribution" },
  { id: "ascap-intl", name: "ASCAP international", url: "https://www.ascap.com/help/royalties-and-payment/payment/distribution" },
  { id: "ascap-pub", name: "ASCAP publisher", url: "https://www.ascap.com/iframe/ma/iFrameCalendar.aspx" },
  { id: "mlc", name: "The MLC", url: "https://help.themlc.com/en/support/what-is-the-payment-timeline" },
];
const SOURCE = Object.fromEntries(SOURCES.map((s) => [s.id, s]));
export const sourceName = (id) => SOURCE[id]?.name || id;
export const isSource = (id) => Object.prototype.hasOwnProperty.call(SOURCE, id);

const SEED_DATES = {
  bmi: ["2026-02-20", "2026-05-22", "2026-08-21", "2026-11-20", "2027-02-19", "2027-05-21"],
  "ascap-w": ["2026-01-12", "2026-04-13", "2026-07-13", "2026-10-13"],
  "ascap-intl": ["2026-02-17", "2026-05-18", "2026-08-17", "2026-11-16"],
  "ascap-pub": ["2026-03-20", "2026-06-18", "2026-09-18", "2026-12-16"],
  mlc: ["2026-01-14", "2026-02-13", "2026-03-16", "2026-04-16", "2026-05-14", "2026-06-12", "2026-07-14", "2026-08-14", "2026-09-11", "2026-10-14", "2026-11-13", "2026-12-14",
    "2027-01-14", "2027-02-13", "2027-03-16"],
};
const SEED_APPROX = new Set(["ascap-intl:2026-11-16", "ascap-pub:2026-12-16"]);
// (the owner, 2026-11-26) ASCAP writers get both the writer and the international paydays; Jjxcksnn isn't on The MLC yet. The six with
// no PRO (Midtwos, Kxrma, prodbyVK, prodchxse, prodyel1ow, prodgavin) and the clients the tracker doesn't list have no entry.
const SEED_WHO = {
  c1oqr7hf: ["bmi", "mlc"], // Stack!e
  vtc3qxue: ["ascap-w", "ascap-intl", "mlc"], // Sauceproducedit
  nwft9ynn: ["bmi", "mlc"], // Reallyindig0
  hbhdxfrj: ["bmi", "mlc"], // prodbylandn
  l6xe5ihh: ["ascap-w", "ascap-intl"], // Jjxcksnn
};
export const SEED = Object.freeze({
  ...Object.fromEntries(Object.entries(SEED_DATES).flatMap(([src, days]) => days.map((d) => [`date:${src}:${d}`, SEED_APPROX.has(`${src}:${d}`) ? { approx: true } : {}]))),
  ...Object.fromEntries(Object.entries(SEED_WHO).map(([id, s]) => [`who:${id}`, s])),
});

// ---------------------------------------------------------------- days
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
export function validDay(s) {
  const m = YMD.exec(String(s ?? ""));
  if (!m || +m[1] < 2000 || +m[1] > 2100) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
const dayNum = (ymd) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 864e5;
export const daysBetween = (a, b) => dayNum(b) - dayNum(a);
export const addDays = (ymd, n) => new Date((dayNum(ymd) + n) * 864e5).toISOString().slice(0, 10);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// "Nov 20", "≈Nov 16"; with the weekday: "Fri Nov 20"
export const dayText = (ymd, approx = false) => `${approx ? "≈" : ""}${MON[+ymd.slice(5, 7) - 1]} ${+ymd.slice(8, 10)}`;
export const weekdayText = (ymd, approx = false) => `${approx ? "≈" : ""}${WD[new Date(`${ymd}T12:00:00Z`).getUTCDay()]} ${MON[+ymd.slice(5, 7) - 1]} ${+ymd.slice(8, 10)}`;

export const paydayId = (src, day) => `${src}:${day}`;
export const PAYDAY_ID = /^([a-z][a-z0-9-]{1,15}):(\d{4}-\d{2}-\d{2})$/;

// ---------------------------------------------------------------- the stored object -> { dates, who, done }
// value: the stored object, or null/undefined while there's no row (the seed). Unknown sources, bad days and keys of no kind are left out.
export function normalizePaydays(value) {
  const v = value && typeof value === "object" && !Array.isArray(value) ? value : SEED;
  const dates = Object.fromEntries(SOURCES.map((s) => [s.id, []]));
  const who = {}, done = {};
  for (const [k, e] of Object.entries(v)) {
    const [kind, ...rest] = k.split(":");
    if (kind === "date" || kind === "done") {
      const [src, day] = rest;
      if (!isSource(src) || !validDay(day) || rest.length !== 2) continue;
      if (kind === "date") dates[src].push({ day, approx: !!(e && e.approx) });
      else done[paydayId(src, day)] = { by: String(e?.by || ""), at: String(e?.at || "") };
    } else if (kind === "who" && rest.length === 1 && rest[0]) {
      const list = Array.isArray(e) ? [...new Set(e.filter((x) => isSource(x)))] : [];
      if (list.length) who[rest[0]] = SOURCES.map((s) => s.id).filter((id) => list.includes(id));
    }
  }
  for (const s of SOURCES) dates[s.id].sort((a, b) => (a.day < b.day ? -1 : 1));
  return { dates, who, done };
}

// every payday between two days (both included), oldest first, in SOURCES' order on one day
export function occurrences(s, from, to) {
  const out = [];
  for (const src of SOURCES) for (const d of s.dates[src.id] || []) if (d.day >= from && d.day <= to) out.push({ id: paydayId(src.id, d.day), source: src.id, name: src.name, day: d.day, approx: d.approx });
  const order = Object.fromEntries(SOURCES.map((x, i) => [x.id, i]));
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : order[a.source] - order[b.source]));
}
// the clients a source pays, from people ([{ id, name }]: clients that still exist), by name
export function expectedFor(s, src, people) {
  return people.filter((c) => (s.who[c.id] || []).includes(src)).sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}
const nextAfter = (s, src, day) => (s.dates[src] || []).find((d) => d.day > day) || null;

// The paydays whose commission is still to come in, oldest first. One shows from its day until, whichever is first:
//   Got it (done), everyone it pays has paid since the day, the same source's next date arrives, or KEEP_DAYS days have gone by.
// paidSince(clientId, day) -> the first day they paid on or after `day`; null = not yet; undefined = unknown (Stripe or the sheet
// couldn't be read): an unknown never counts as paid, so the row stays. asked(clientId, paydayId, day) -> the day it was requested, or null.
// A source that pays nobody (ASCAP publisher: it pays the publisher of record) has no row.
export function openPaydays(s, { today, people, paidSince = () => undefined, asked = () => null, keepDays = KEEP_DAYS }) {
  const out = [];
  for (const o of occurrences(s, addDays(today, -(keepDays - 1)), today)) {
    if (s.done[o.id]) continue;
    const next = nextAfter(s, o.source, o.day);
    if (next && next.day <= today) continue;
    const exp = expectedFor(s, o.source, people);
    if (!exp.length) continue;
    const ps = exp.map((c) => { const paid = paidSince(c.id, o.day); return { id: c.id, name: c.name, paid: paid || null, unknown: paid === undefined, asked: paid ? null : asked(c.id, o.id, o.day) || null }; });
    if (ps.every((p) => p.paid)) continue;
    out.push({ ...o, today: o.day === today, people: ps });
  }
  return out;
}
// each source's next payday after today that pays someone, soonest first (Money › Paydays' coming lines)
export function upcomingPaydays(s, { today, people }) {
  const out = [];
  for (const src of SOURCES) {
    const d = nextAfter(s, src.id, today);
    if (!d) continue;
    const exp = expectedFor(s, src.id, people);
    if (exp.length) out.push({ id: paydayId(src.id, d.day), source: src.id, name: src.name, day: d.day, approx: d.approx, people: exp.map((c) => ({ id: c.id, name: c.name })) });
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}
// the paydays in the week starting on a Monday (the Monday digest), source and day only
export const weekPaydays = (s, monday) => occurrences(s, monday, addDays(monday, 6)).map((o) => ({ id: o.id, name: o.name, day: o.day, approx: o.approx }));
// a source that pays someone and has no date after today: "2027 not set" (the year after its last date's, or this year when it has none this year)
export function notSetOf(s, src, today, people) {
  if (!expectedFor(s, src, people).length) return null;
  const ds = s.dates[src] || [];
  if (ds.some((d) => d.day > today)) return null;
  const y = Number(today.slice(0, 4));
  return `${ds.some((d) => d.day.slice(0, 4) === String(y)) ? y + 1 : y} not set`;
}
// every stored payday as a calendar chip (Home's week, To do's Calendar): { day, label }
export const calendarDates = (s) => occurrences(s, "2000-01-01", "2100-12-31").map((o) => ({ day: o.day, label: `${o.approx ? "≈" : ""}${o.name}` }));

// ---------------------------------------------------------------- typing dates in
// "Jan 14, Feb 12, 2027-03-16, ≈Apr 13" (commas, new lines or semicolons; a comma before a year is the date's own) -> { days: [{ day, approx }], bad: [text] }.
// A day typed without a year is the next one on or after today. ≈ (or ~) in front marks an estimate.
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
export function parseDates(text, today) {
  const days = [], bad = [];
  const parts = String(text ?? "").split(/[\n;]+|,(?!\s*\d{4}(?![\d/-]))/).map((x) => x.trim()).filter(Boolean);
  for (const raw of parts.slice(0, 40)) {
    let t = raw, approx = false;
    if (/^[≈~]/.test(t)) { approx = true; t = t.slice(1).trim(); }
    let y = null, m = null, d = null, x;
    if ((x = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) [y, m, d] = [+x[1], +x[2], +x[3]];
    else if ((x = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(t))) [y, m, d] = [x[3] ? +x[3] : null, +x[1], +x[2]];
    else if ((x = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/i.exec(t))) {
      const k = x[1].toLowerCase();
      const mm = MONTHS[k] || MONTHS[k.slice(0, 3)];
      if (mm) { m = mm; d = +x[2]; y = x[3] ? +x[3] : null; }
    }
    if (!m) { bad.push(raw); continue; }
    const pad = (n) => String(n).padStart(2, "0");
    if (y == null) { y = Number(today.slice(0, 4)); if (`${y}-${pad(m)}-${pad(d)}` < today) y++; }
    const day = `${y}-${pad(m)}-${pad(d)}`;
    if (!validDay(day)) { bad.push(raw); continue; }
    if (!days.some((z) => z.day === day)) days.push({ day, approx });
  }
  return { days, bad };
}
