// Where Log it would put a Stripe payment on the Income tab, or why it can't (then the owner uses Log
// with details). Pure, so Accounting › To log can run the same check, dry, before anyone clicks.
// Server-only, staff-only data.
import { isTestPay } from "./accounting";
import { nyDay, toMs, coFeesOn, CO_DEFIED_SHARE } from "./stripe";
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
// The reasons say what to do instead, and `details` marks the ones Log with details handles
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
    if (!types.size) return { reason: `This payer has no earlier Management Commission rows in the sheet, so it may be studio work or other income. ${BY_DETAILS}`, details: true };
    if (![...types].every((t) => t === COMMISSION)) return { reason: `This doesn't look like a commission payment: the sheet has this payer's earlier payments as other income (studio work or similar). ${BY_DETAILS}`, details: true };
  }
  const client = test ? GENERAL : rosterName(roster, (email && bySheet.get(`email:${email}`)) || (name && bySheet.get(`name:${name}`)), nameOf(p).client, p.payerName);
  if (!client) return { reason: `Who paid isn't one of the sheet's clients (its INFO tab). ${BY_DETAILS}`, details: true };
  return { client, test };
}

// --- Auto-log (2026-11-26): the payments the daily job may add by itself ------------------------------------
// The owner's rules: a payer is a repeat payer only after TWO earlier commission payments for the same client, and a payment waits a day
// (refunds settle) before it is sure
export const SURE_AGE_MS = 24 * 3600 * 1000;
export const REPEAT_MIN = 2;
const lower = (s) => String(s || "").trim().toLowerCase();
const clientKey = (c) => personKey(c) || lower(c);
// the same person either way round ("Magnus" and "Magnus Gutmann"); no manager on INFO is the owner's own client
const managedBy = (c, via) => { const m = String(c?.manager || "").trim() || OWNER; return sameManager(m, via) || sameManager(via, m); };
// Each payer email's payments the sheet already has (matched, or one row for several), tests left out: [{ at, type, client }]
export function payerHistory(match) {
  const out = new Map();
  for (const p of [...(match?.matched || []), ...(match?.loggedTogether || [])]) {
    const email = lower(p.payerEmail);
    if (!email || isTestPay(p)) continue;
    if (!out.has(email)) out.set(email, []);
    out.get(email).push({ at: p.at, type: String(p.rowType || "").trim(), client: String(p.client || "").trim() });
  }
  return out;
}
// { client, how: "portal" | "repeat" } when Auto-log may add this payment exactly as Log it would, else null. Pure.
// ctx: roster (INFO's names), clients ([{ id, name, info_name, manager }]), history (payerHistory), year (the sheet's), unlogged (Set of ids), now.
// Sure: not a test, not a direct platform charge, something left after refunds, in the sheet's year, still to log, at least SURE_AGE_MS old, and
//  1. portal: from the client's own card, that client on INFO, and the link's manager is the client's INFO manager (prodzo paying through Devin's
//     link while INFO says Caden stays manual); a portal tag decides alone;
//  2. repeat: REPEAT_MIN earlier payments from the same email, every payment the sheet has from it a Management Commission for one client, that
//     client on INFO, the same manager check. A name alone is never enough.
// (review money-3) extra: the book's rows no payment explains ([{ date: YYYY-MM-DD, client }]). One for the same client within HAND_DAYS of the payment
// may be this payment typed by hand (another day, another amount), so it isn't sure: it stays in To log for Log it.
export const HAND_DAYS = 14;
export function sureOf(p, ctx = {}) {
  const s = sureOf0(p, ctx);
  if (!s || !ctx.extra?.length) return s;
  const day = Date.parse(nyDay(p.at)), key = clientKey(s.client);
  return ctx.extra.some((r) => clientKey(r.client) === key && Math.abs(Date.parse(r.date) - day) <= HAND_DAYS * 864e5) ? null : s;
}
function sureOf0(p, { roster = [], clients = [], history = new Map(), year = null, unlogged = null, now = Date.now() } = {}) {
  if (!p || isTestPay(p) || p.direct || !(p.amount > 0)) return null;
  if (year && Number(nyDay(p.at).slice(0, 4)) !== Number(year)) return null;
  if (unlogged && !unlogged.has(p.id)) return null;
  if (!(toMs(now) - toMs(p.at) >= SURE_AGE_MS)) return null;
  const via = p.link?.owner || OWNER;
  const tagged = p.clientRef ? clients.find((c) => c.id === p.clientRef) : null;
  if (tagged) {
    const client = rosterName(roster, tagged.info_name, tagged.name);
    return client && managedBy(tagged, via) ? { client, how: "portal" } : null;
  }
  const email = lower(p.payerEmail);
  const all = (email && history.get(email)) || [];
  if (!all.length || !all.every((h) => h.type === COMMISSION && h.client)) return null;
  if (new Set(all.map((h) => clientKey(h.client))).size !== 1) return null;
  if (all.filter((h) => toMs(h.at) < toMs(p.at)).length < REPEAT_MIN) return null;
  const client = rosterName(roster, all[0].client);
  const key = client && clientKey(client);
  const c = key && clients.find((x) => clientKey(x.info_name) === key || clientKey(x.name) === key);
  return c && managedBy(c, via) ? { client, how: "repeat" } : null;
}
// Source / Notes on an auto-logged row: "Stripe · via Magnus · 1a2b3c4d" (the link's manager, the last 8 of the Stripe id)
export const autoNotes = (p) => `Stripe · via ${p.link?.owner || OWNER} · ${String(p.id || "").slice(-8)}`;
