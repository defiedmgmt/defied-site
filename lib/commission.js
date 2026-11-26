// Management Commission (2026-11-11, the owner: clients "put in the total of how much they made and [it] calculates the
// 20 percent", then pay their manager): the rate, the manager's pay.defiedmgmt.com link with the amount filled in
// (Stripe's prefilled_amount on a pay-what-you-want link) and the client's id (client_reference_id, so Money knows who
// paid: lib/money.js payerNamer), and which payments are theirs. Pure: the portal card and /api/my-commission share it.
// (2026-11-26, paylinks-1126) the links are a setting now (lib/pay-links-store.js): the server passes the table it read (links); with none,
// the seed (the links that were in code). Pure still: no imports but lib/pay-links.js, which the browser can have.
import { SEED_LINKS, keyOfManager, ownerKey } from "./pay-links";

export const COMMISSION_RATE = 0.2;
// a client's Assigned Manager (the accounting sheet's INFO tab) -> its link key; none, or a manager with no link (prodzo's Caden, 2026-11-26:
// "no Stripe yet"): the owner's
export const payKeyOf = (manager, links = SEED_LINKS) => keyOfManager(manager, links) || ownerKey(links);
// a staff login's own pay link, by its name (My payments; a founder's too, 2026-11-11, the owner: "how much
// money our link has made even tho defied is keeping all of it")
export const ownLinkOf = (name, links = SEED_LINKS) => { const k = keyOfManager(name, links); return k ? { key: k, owner: links[k].owner } : null; };
export const payPage = (key) => `https://pay.defiedmgmt.com/${key}`;
// cents null (or left out): no amount filled in (Request payment can send the link with none); clientId: who is paying (client_reference_id)
export const payUrl = (key, cents, clientId) => {
  const q = new URLSearchParams({ ...(cents != null ? { prefilled_amount: String(cents) } : {}), ...(clientId ? { client_reference_id: clientId } : {}) });
  const s = String(q);
  return s ? `${payPage(key)}?${s}` : payPage(key);
};
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
