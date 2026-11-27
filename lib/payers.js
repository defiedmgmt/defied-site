// Who's paid (2026-11-26): Money › Overview's Who's paid and Paydays' Paid chips. Pure apart from
// its imports' own pure helpers; lib/payers-store.js reads what it needs and lib/accounting-section.js hands over the money read.
// Real money only: this year's book's Management Commission rows, the year's Stripe payments the book doesn't have yet that Log it would
// place as that client (so studio money never counts), and every Stripe payment the site names as the client (Last paid reaches past
// this year's book). Server-only, staff-only data.
import { isTestPay, cents, sheetDay } from "./accounting";
import { nyDay } from "./stripe";
import { infoOwnerOf } from "./info-links";
import { OWNER } from "./pay-links";
import { COMMISSION } from "./log-fields";
import { daysBetween } from "./paydays";

// (2026-11-26 owner: paydays only) Last paid shows amber after 90 days. The reminders that went with it (To do's "Liyakk!: 2 releases since their
// last payment" / "nothing paid in 90 days", with Not now) are gone: reminders are for pay days only (lib/paydays.js)
export const LATE_DAYS = 90;

// a client is on INFO when the nightly copy gave them INFO's manager or the people link paired them with an INFO row
export const onInfo = (c) => !!(String(c.info_name || "").trim() || String(c.manager || "").trim());

// -> Map(clientId -> { id, name, manager, onRoster, onInfo, paid (cents this year), last ("YYYY-MM-DD" or null), days (every day they paid, sorted) })
//   clients: [{ id, name, info_name?, sheet_tab_name?, manager, on_roster }]
//   rows: the book's Income rows, or null (the sheet couldn't be read); year: the book's year
//   list: every Stripe payment, or null (Stripe couldn't be read); unlogged: the year's payments the book doesn't have yet (match.unlogged) or null
//   placeOf(p): lib/accounting-place.js placement ({ client } in INFO's spelling, or { reason }); nameOf(p): lib/money.js payerNamer
export function clientMoney({ clients, rows, year, list, unlogged, placeOf = () => ({}), nameOf = () => ({}) }) {
  const out = new Map(clients.map((c) => [c.id, { id: c.id, name: c.name, manager: String(c.manager || "").trim(), onRoster: !!c.on_roster, onInfo: onInfo(c), paid: 0, last: null, days: [] }]));
  const byName = new Map(clients.map((c) => [c.name, c.id]));
  const seen = (e, day) => { if (!day) return; e.days.push(day); if (!e.last || day > e.last) e.last = day; };
  const y = String(year || "");
  for (const r of rows || []) {
    if (String(r.type || "").trim() !== COMMISSION || !(cents(r.gross) > 0)) continue;
    const c = infoOwnerOf(clients, r.client);
    if (!c) continue;
    const e = out.get(c.id), day = sheetDay(r.date);
    if (day.slice(0, 4) === y) e.paid += cents(r.gross);
    seen(e, day);
  }
  for (const p of unlogged || []) {
    if (isTestPay(p) || !(p.amount > 0) || nyDay(p.at).slice(0, 4) !== y) continue;
    const place = placeOf(p);
    if (!place?.client || place.test) continue;
    const c = infoOwnerOf(clients, place.client);
    if (c) out.get(c.id).paid += p.amount;
  }
  for (const p of list || []) {
    if (isTestPay(p) || !(p.amount > 0)) continue;
    const id = p.clientRef && out.has(p.clientRef) ? p.clientRef : byName.get(nameOf(p)?.client);
    if (id) seen(out.get(id), nyDay(p.at));
  }
  for (const e of out.values()) e.days.sort();
  return out;
}

// the first day on or after `day` a client paid, or null
export const paidSince = (e, day) => (e?.days || []).find((d) => d >= day) || null;

// Who's paid's rows: every client on INFO, and anyone else with a payment; most paid this year first. Dollars.
export function whoPaidRows(money, today) {
  return [...money.values()].filter((e) => e.onInfo || e.paid > 0 || e.last)
    .map((e) => ({ id: e.id, name: e.name, manager: e.manager || OWNER, paid: e.paid / 100, last: e.last, late: !!e.last && daysBetween(e.last, today) > LATE_DAYS }))
    .sort((a, b) => b.paid - a.paid || (b.last || "").localeCompare(a.last || "") || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}
// ...by manager (a client with no manager on INFO is the owner's, as the sheet reads a blank Manager)
export function managerRows(rows) {
  const by = new Map();
  for (const r of rows) {
    const m = by.get(r.manager) || { name: r.manager, clients: 0, paid: 0, last: null };
    m.clients++; m.paid = Math.round((m.paid + r.paid) * 100) / 100;
    if (r.last && (!m.last || r.last > m.last)) m.last = r.last;
    by.set(r.manager, m);
  }
  return [...by.values()].sort((a, b) => b.paid - a.paid || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}
