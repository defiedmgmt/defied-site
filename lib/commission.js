// Management Commission (2026-11-11, the owner: clients "put in the total of how much they made and [it] calculates the
// 20 percent", then pay their manager): the rate, the manager's pay.defiedmgmt.com link with the amount filled in
// (Stripe's prefilled_amount on a pay-what-you-want link) and the client's id (client_reference_id, so Money knows who
// paid: lib/money.js payerNamer), and which payments are theirs. Pure: the portal card and /api/my-commission share it.
import { PAY_LINKS, OWNER } from "./pay-links";
import { personKey } from "./names";

export const COMMISSION_RATE = 0.2;
const KEY_OF = { devin: "devin", ella: "ella", hank: "hank", mag: "mag", magnus: "mag", jordan: "jordan" };
// a client's Assigned Manager (the accounting sheet's INFO tab) -> its link key; none or someone else: the owner's
export const payKeyOf = (manager) => KEY_OF[personKey(String(manager ?? "").trim().split(/\s+/)[0])] || Object.keys(PAY_LINKS).find((k) => PAY_LINKS[k].owner === OWNER);
// a staff login's own pay link, by its first name (My payments), except the owner's (all of that is Defied's)
export const ownLinkOf = (name) => { const k = KEY_OF[personKey(String(name ?? "").trim().split(/\s+/)[0])]; return k && PAY_LINKS[k] && PAY_LINKS[k].owner !== OWNER ? { key: k, owner: PAY_LINKS[k].owner } : null; };
export const payPage = (key) => `https://pay.defiedmgmt.com/${key}`;
export const payUrl = (key, cents, clientId) => `${payPage(key)}?${new URLSearchParams({ prefilled_amount: String(cents), ...(clientId ? { client_reference_id: clientId } : {}) })}`;
// "$5,000", "5000.50", "5k" -> cents; null when it isn't an amount
export function dollarsToCents(text) {
  const t = String(text ?? "").trim().replace(/[$,\s]/g, "").toLowerCase();
  const m = /^(\d+(?:\.\d{0,2})?|\.\d{1,2})(k)?$/.exec(t);
  if (!m) return null;
  const c = Math.round(Number(m[1]) * (m[2] ? 1000 : 1) * 100);
  return c > 0 ? c : null;
}
export const commissionOf = (cents) => Math.round(cents * COMMISSION_RATE);
export const usd = (cents) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// a client's own payments among Stripe's: paid from their portal (their id on it), with their login's email, or
// under their name or credit
export function paymentsOf(list, { clientId, email = "", names = [] }) {
  const em = String(email).toLowerCase(), keys = new Set(names.map(personKey).filter(Boolean));
  return (list || []).filter((p) => (p.clientRef && p.clientRef === clientId) || (!p.clientRef && ((em && String(p.payerEmail || "").toLowerCase() === em) || keys.has(personKey(p.payerName)))))
    .sort((a, b) => b.at - a.at);
}
