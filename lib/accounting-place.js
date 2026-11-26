// Where Log it would put a Stripe payment on the Income tab, or why it can't (then the owner uses Log
// with details). Pure, so Accounting › To log can run the same check, dry, before anyone clicks.
// Server-only, staff-only data.
import { isTestPay } from "./accounting";
import { nyDay, coFeesOn, CO_DEFIED_SHARE } from "./stripe";
import { OWNER } from "./pay-links";
import { personKey } from "./names";
import { sameManager } from "./roles";
import { dayWord, usd, ROUNDING } from "./accounting-checks";
import { coShare, GENERAL, COMMISSION } from "./log-fields";

// The sheet's own spelling of the client ("reallyindig0", "Stack!e"), from its INFO roster
export function rosterName(roster, ...names) {
  for (const n of names) {
    if (!n) continue;
    const hit = roster.find((r) => r === n) || roster.find((r) => personKey(r) && personKey(r) === personKey(n));
    if (hit) return hit;
  }
  return null;
}
// A payment through a co-manager's link, on a row INFO gives no manager (General / Company): left to the
// formulas, DEFIED SHARE would be all of it while Stripe paid the manager their part. So Manager and
// Manager Share are typed the way the owner typed rows 4, 37 and 58: the link's owner, and the gross
// less Defied's 33.3% (CO_DEFIED_SHARE; DEFIED SHARE stays the sheet's F−G; the rest of the Co-Management Cut is the
// Stripe Fees tab's "fees covered by co-managers"). Only when Stripe took the co-manager split (its old 33%, or
// the cut of that day, either of the two on the day a new cut started: coFeesOn); else null and the formulas decide, as before.
export function coSplit(p, client) {
  const via = client === GENERAL ? coVia(p) : null;
  return via ? { manager: via, managerShare: coShare(p.amount, CO_DEFIED_SHARE) / 100 } : null;
}
// The co-manager whose link a General / Company row for this payment names (coSplit), whatever client the row ends
// up with, or null. The Log confirm shows Manager and Manager Share as fields only on such a row (r11).
export function coVia(p) {
  const via = p?.link?.owner;
  if (!via || via === OWNER || p.direct) return null;
  if (!(p.amount > 0) || !coFeesOn(p.amount, p.at).some((f) => Math.abs(p.fee - f) <= ROUNDING)) return null;
  return via;
}
// The reasons say what to do instead, and `details` marks the ones Log with details handles. need (2026-11-26 owner: automatic): the same in a few words,
// for Auto-log's ClickUp note ("To log: needs a client (the payer isn't on INFO)")
export const NEED = {
  first: "a type and client (first payment from this payer)",
  other: "a type (this payer's earlier payments are other income)",
  info: "a client (the payer isn't on INFO)",
  shared: "a client (this payer has paid for more than one artist)",
  refunded: "a look (refunded in Stripe before it was logged)",
  again: "a look (it was logged once and its row isn't in the book now)",
};
const BY_DETAILS = "Use Log with details (Accounting › To log) to pick the type and client.";
// "Oct 6 · Mina Ortiz · $67.50": which payment a skipped line is about
export const payWhat = (p, nameOf) => `${dayWord(nyDay(p.at))} · ${(nameOf && nameOf(p).client) || p.payerName || "Unknown payer"} · ${usd(p.amount)}`;
// {client, test} for a payment Log it can place (a client the sheet has always typed as Management
// Commission, or a test), else {reason, details: true}. ctx: the INFO roster and the match's payer maps.
export function placement(p, { roster, typesOf, bySheet, nameOf }) {
  const email = String(p.payerEmail || "").toLowerCase(), name = String(p.payerName || "").toLowerCase();
  // a test payment is the company's own, like the owner's Test Deposit rows
  const test = isTestPay(p) && roster.includes(GENERAL);
  // (2026-11-26) paid from the client's own Management Commission card (its id rode along, clientRef): that client's commission, first payment or not.
  // Never a test; an id that isn't a client on INFO goes on to the checks below
  const who = isTestPay(p) ? null : nameOf(p);
  if (who?.how === "portal") { const client = rosterName(roster, who.client); if (client) return { client, test: false }; }
  // Studio or engineering money also comes in through Stripe, and the owner types it as Other Income
  // with no client. A payment only reads as a commission when every earlier row the sheet has for
  // that payer is a Management Commission; anything else is the owner's call (Log with details).
  if (!test) {
    const types = new Set([email && `email:${email}`, name && `name:${name}`].flatMap((k) => (k && typesOf.has(k) ? [...typesOf.get(k)] : [])));
    if (!types.size) return { reason: `This payer has no earlier Management Commission rows in the sheet, so it may be studio work or other income. ${BY_DETAILS}`, details: true, need: NEED.first };
    if (![...types].every((t) => t === COMMISSION)) return { reason: `This doesn't look like a commission payment: the sheet has this payer's earlier payments as other income (studio work or similar). ${BY_DETAILS}`, details: true, need: NEED.other };
  }
  const client = test ? GENERAL : rosterName(roster, (email && bySheet.get(`email:${email}`)) || (name && bySheet.get(`name:${name}`)), nameOf(p).client, p.payerName);
  if (!client) return { reason: `Who paid isn't one of the sheet's clients (its INFO tab). ${BY_DETAILS}`, details: true, need: NEED.info };
  return { client, test };
}

// --- Auto-log (2026-11-26 owner: automatic) --------------------------------------------------------------------------------------------------
// The owner: "just make the auto logging an automatic thing without all those rules". Every payment Log it places with certainty goes in by itself: no
// waiting a day, no "two earlier payments first". Certain means Log it's own placement (the portal card's client tag, the payer the book already knows as
// one client), the client's manager on INFO is the one whose pay link took it, and nothing in the book looks like the same payment typed by hand. What
// isn't certain stays in To log, exactly as today, and Auto-log's ClickUp note says what it needs.
const lower = (s) => String(s || "").trim().toLowerCase();
const clientKey = (c) => personKey(c) || lower(c);
// the same person either way round ("Magnus" and "Magnus Gutmann"); no manager on INFO is the owner's own client. Caden is never Cayden
const managedBy = (c, via) => { const m = String(c?.manager || "").trim() || OWNER; return sameManager(m, via) || sameManager(via, m); };
// (review money-3) a row in the book no payment explains, for the same client within HAND_DAYS of the payment: maybe this payment typed by hand (another
// day, another amount), so it's left for a person
export const HAND_DAYS = 14;
// -> { client, how: "portal" | "payer" } when Auto-log adds the payment exactly as Log it would; { need } when it stays in To log (what it needs, a few
// words); null when it isn't Auto-log's to judge (a test, a payment straight to Defied, refunded to nothing, not one of the books' years, already logged). Pure.
// ctx: roster (INFO's names), typesOf / bySheet / sole (rowTypesByPayer, clientsByPayer, soleClientByPayer), nameOf (payerNamer), clients
// ([{ id, name, info_name, manager }]), years (the books' years; none: any), unlogged (Set of ids; none: any), extra ([{ row, date, client }]), before (Set of
// the ids the dashboard logged once already: back in To log means its row left the book, and only a person adds it again), infoManager (review AL-2: Map of
// each INFO name's Assigned Manager in the book being written; a name it doesn't have, or none given, falls back to the site's clients.manager).
export function autoPlace(p, ctx = {}) {
  const { roster = [], typesOf = new Map(), bySheet = new Map(), sole = null, nameOf = () => ({ client: null, how: null }), clients = [], years = null, unlogged = null, extra = [], before = null, infoManager = null } = ctx;
  if (!p || isTestPay(p) || p.direct || !(p.amount > 0)) return null;
  if (years && ![...years].map(Number).includes(Number(nyDay(p.at).slice(0, 4)))) return null;
  if (unlogged && !unlogged.has(p.id)) return null;
  if (before?.has(p.id)) return { need: NEED.again };
  const place = placement(p, { roster, typesOf, bySheet, nameOf });
  if (place.reason) return { need: place.need || "details" };
  if (place.test) return null;
  const portal = nameOf(p)?.how === "portal";
  // a payer the book has for two artists (a parent, a business manager): Log it would take the first; Auto-log leaves it to a person
  if (!portal && sole) {
    const email = lower(p.payerEmail), name = lower(p.payerName);
    const k = email && bySheet.has(`email:${email}`) ? `email:${email}` : name && bySheet.has(`name:${name}`) ? `name:${name}` : null;
    if (k && !sole.has(k)) return { need: NEED.shared };
  }
  const key = clientKey(place.client);
  const c = (portal && clients.find((x) => x.id === p.clientRef)) || clients.find((x) => clientKey(x.info_name) === key || clientKey(x.name) === key);
  if (!c) return { need: `a manager check (${place.client} isn't on the site's roster)` };
  const via = p.link?.owner || OWNER;
  // prodzo paying through Devin's link while INFO says Caden: the sheet's formulas would give Caden the cut. (review AL-2) The manager is INFO's in the book
  // the row goes into (its formulas look it up there), not the site's copy, which follows INFO only when the managers are read again
  const manager = infoManager?.get(place.client) ?? c.manager;
  if (!managedBy({ manager }, via)) return { need: `a manager check (paid through ${via}'s link, INFO says ${String(manager || "").trim() || OWNER})` };
  const day = Date.parse(nyDay(p.at));
  const hand = (extra || []).find((r) => clientKey(r.client) === key && Math.abs(Date.parse(r.date) - day) <= HAND_DAYS * 864e5);
  if (hand) return { need: `a look (row ${hand.row} may already be this payment)` };
  return { client: place.client, how: portal ? "portal" : "payer" };
}
// Source / Notes on an auto-logged row: "Stripe · via Magnus · 1a2b3c4d" (the link's manager, the last 8 of the Stripe id)
export const autoNotes = (p) => `Stripe · via ${p.link?.owner || OWNER} · ${String(p.id || "").slice(-8)}`;
