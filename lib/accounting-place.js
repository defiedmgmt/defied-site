// Where Log it would put a Stripe payment on the Income tab, or why it can't (then the owner uses Log
// with details). Pure, so Accounting › To log can run the same check, dry, before anyone clicks.
// Server-only, staff-only data.
import { isTestPay } from "./accounting";
import { nyDay } from "./stripe";
import { personKey } from "./names";
import { dayWord, usd } from "./accounting-checks";

const GENERAL = "General / Company";
const COMMISSION = "Management Commission";

// The sheet's own spelling of the client ("reallyindig0", "Stack!e"), from its INFO roster
export function rosterName(roster, ...names) {
  for (const n of names) {
    if (!n) continue;
    const hit = roster.find((r) => r === n) || roster.find((r) => personKey(r) && personKey(r) === personKey(n));
    if (hit) return hit;
  }
  return null;
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
