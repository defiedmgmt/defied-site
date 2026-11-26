// The Luminate report's due day (the owner, 2026-11-26: due on the 1st of every month; To do's row only from 3 days
// before until a file exported for it is applied, otherwise a quiet calendar chip on the day). Pure: the server
// (lib/trueup.js trueUpState, lib/area-tasks.js) and the dashboard (components/trueup-data.js) use the same rule.
//   dueOn     the due day D in a month, clamped to its last day (D = 31 is Feb 28/29, Apr 30, ...)
//   window    a month's report opens DUE_LEAD_DAYS before its due day, or on its 1st when that is earlier: a file
//             exported from then on is that month's (D = 1: a file exported Nov 28 counts for Dec 1)
//   due       no file for this month's window yet, and today is on or after dueOn - DUE_LEAD_DAYS, or last month's
//             window had no file either (a month missed entirely keeps showing, as late, until any file is applied)
// D is a Founder's setting (app_state 'trueupDue' { day, by, at }); DUE_DAY until one is saved.
export const DUE_DAY = 1;
export const DUE_LEAD_DAYS = 3;
const DAY = 864e5;
const pad = (n) => String(n).padStart(2, "0");
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
// "2026-12" + n months
export const monthAdd = (ym, n) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };
// a saved day, or the default: a whole number 1-31
export const dueDayOf = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 31 ? n : DUE_DAY; };
export const dueIn = (ym, D = DUE_DAY) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${pad(Math.min(dueDayOf(D), new Date(Date.UTC(y, m, 0)).getUTCDate()))}`; };
export const windowStart = (ym, D = DUE_DAY) => { const first = `${ym}-01`, lead = addDays(dueIn(ym, D), -DUE_LEAD_DAYS); return lead < first ? lead : first; };

// The month whose report today is for (this month, or next month once its window has opened), its due day and window
export function dueWindow(today, D = DUE_DAY) {
  const ym = today.slice(0, 7), next = monthAdd(ym, 1);
  const cur = windowStart(next, D) <= today ? next : ym, prev = monthAdd(cur, -1);
  const dueOn = dueIn(cur, D);
  return { month: cur, dueOn, start: windowStart(cur, D), showFrom: addDays(dueOn, -DUE_LEAD_DAYS), prevDueOn: dueIn(prev, D), prevStart: windowStart(prev, D) };
}

// latest: the newest applied run ({ export_on: "YYYY-MM-DD" }) or null. { due, dueOn, late }: while due, dueOn is the day the
// row names (last month's while that one was missed and this month's window hasn't reached its 3 days yet); otherwise the
// next due day (next month's once this month's file is in)
export function dueOf(latest, today, D = DUE_DAY) {
  const w = dueWindow(today, D), on = latest?.export_on || "";
  const thisDone = !!on && on >= w.start;
  const lastMissed = !on || on < w.prevStart;
  const early = today < w.showFrom;
  const due = !thisDone && (!early || lastMissed);
  const dueOn = due ? (early ? w.prevDueOn : w.dueOn) : thisDone ? dueIn(monthAdd(w.month, 1), D) : w.dueOn;
  return { due, dueOn, late: due && today > dueOn };
}

// The calendar's chips: "Luminate report" on each due day from..to whose month has no file yet (a done month's goes)
export function dueChips(from, to, { exportOn = "", today, D = DUE_DAY } = {}) {
  const out = [];
  for (let ym = monthAdd(from.slice(0, 7), -1); ym <= monthAdd(to.slice(0, 7), 1); ym = monthAdd(ym, 1)) {
    const day = dueIn(ym, D);
    if (day < from || day > to || (exportOn && exportOn >= windowStart(ym, D))) continue;
    out.push({ day, label: "Luminate report", kind: "roster", late: !!today && day < today });
  }
  return out;
}
