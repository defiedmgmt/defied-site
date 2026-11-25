// New York's clock for the moments the dashboard shows (2026-11-25): the business is in New York, so "5:33 PM" is New York's 5:33 PM wherever the words are made: on
// Vercel (its clock is UTC), inside /api/boot, in a browser in another time zone, in a test run with TZ=UTC. Every formatter names its time zone; nothing here reads
// the process's zone (the TZ variable) or the browser's. ICU puts a narrow no-break space (newer) or a no-break space before AM/PM: both become a plain space, so the words are the
// same on every Node and every browser. A missing or unreadable moment is "" (never "Invalid Date"). Pure: no imports, safe for the server and the browser bundles.
// Used by Site › Sync (lib/sync-checks.js, lib/schedule-a.js, lib/ar/tracker-sheet.js, components/dash/chips.jsx clock,
// components/dash/numbers.jsx SyncSources).
export const NY = "America/New_York";
const WHEN = new Intl.DateTimeFormat("en-US", { timeZone: NY, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const CLOCK = new Intl.DateTimeFormat("en-US", { timeZone: NY, hour: "numeric", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("en-US", { timeZone: NY, month: "short", day: "numeric" });
const CAL = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const plain = (s) => s.replace(/[  ]/g, " ");
const YMD = /^\d{4}-\d{2}-\d{2}$/;
// a Date, an ISO string, or milliseconds -> a Date, or null when there's nothing there or it isn't a moment
const moment = (t) => {
  if (t == null || t === "") return null;
  const d = t instanceof Date ? t : new Date(t);
  return Number.isFinite(d.getTime()) ? d : null;
};
// "Nov 25, 5:33 PM"
export const nyWhen = (t) => { const d = moment(t); return d ? plain(WHEN.format(d)) : ""; };
// "5:33 PM"
export const nyClock = (t) => { const d = moment(t); return d ? plain(CLOCK.format(d)) : ""; };
// "Nov 25": the New York day of a moment; a calendar day ("2026-11-25") is that day as written (it has no clock to move)
export const nyShortDay = (t) => {
  if (YMD.test(String(t ?? ""))) { const d = moment(`${t}T12:00:00Z`); return d ? CAL.format(d) : ""; }
  const d = moment(t); return d ? DAY.format(d) : "";
};
