// Where Log it would put a Stripe payment on the Income tab, or why it can't (then the owner uses Log
// with details). Pure, so Accounting › To log can run the same check, dry, before anyone clicks.
// Server-only, staff-only data.
import { isTestPay } from "./accounting";
import { nyDay, coManagerFee, CO_MANAGER } from "./stripe";
import { OWNER } from "./pay-links";
import { personKey } from "./names";
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
// less Defied's 33% (DEFIED SHARE stays the sheet's F−G; the rest of the Co-Management Cut is the
// Stripe Fees tab's "fees covered by co-managers"). Only when Stripe took the co-manager split (33%, or
// the cut from its start date); else null and the formulas decide, as before.
export function coSplit(p, client) {
  const via = client === GENERAL ? coVia(p) : null;
  return via ? { manager: via, managerShare: coShare(p.amount, CO_MANAGER.sheetPct) / 100 } : null;
}
// The co-manager whose link a General / Company row for this payment names (coSplit), whatever client the row ends
// up with, or null. The Log confirm shows Manager and Manager Share as fields only on such a row (r11).
export function coVia(p) {
  const via = p?.link?.owner;
  if (!via || via === OWNER || p.direct) return null;
  if (!(p.amount > 0) || Math.abs(p.fee - coManagerFee(p.amount, p.at)) > ROUNDING) return null;
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
