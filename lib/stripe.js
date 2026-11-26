// Defied's Stripe commission, read-only. Defied is a Stripe Connect platform: clients pay through
// each manager's connected account (their pay.defiedmgmt.com link), and Defied's cut of each payment
// is that payment's application fee. Server-only, and GET only: nothing here can change Stripe.
// The pure parts (joinFee, commissionTotals, the fee rule) are separate from the fetching so tests
// can run them on the real snapshot without a network.
import { sql } from "./db";
import { ownerOfLink, withLinkOwners, OWNER } from "./pay-links";
import { readPayLinks } from "./pay-links-store";
import { CO_DEFIED_SHARE } from "./co-share";
export { CO_DEFIED_SHARE }; // the accounting sheet's share of a co-managed payment (33.3%), beside CO_MANAGER below

export const NY = "America/New_York";
export const STATE_KEY = "stripeCommission"; // app_state: the fee cursor + every joined payment
// STRIPE_API_BASE is for the staging tests only; the harness reroutes api.stripe.com itself
const apiBase = () => process.env.STRIPE_API_BASE || "https://api.stripe.com";
const stripeKey = () => process.env.STRIPE_READ_KEY || "";
export const stripeConnected = () => !!stripeKey();

// --- dates in New York ----------------------------------------------------
// Stripe times are unix seconds; a Date, an ISO string or milliseconds work too
export const toMs = (t) => (t instanceof Date ? t.getTime() : typeof t === "number" ? (t < 1e11 ? t * 1000 : t) : new Date(t).getTime());
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: NY, year: "numeric", month: "2-digit", day: "2-digit" });
export const nyDay = (t) => dayFmt.format(new Date(toMs(t))); // "2026-10-15"
export const nyMonth = (t) => nyDay(t).slice(0, 7); // "2026-10"
const prevMonth = (ym) => { const [y, m] = ym.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };

// --- the fee rule -----------------------------------------------------------
// Since 2026-10-06 a co-managed client's fee also carries the manager's share of Stripe's fees, while the accounting
// sheet's DEFIED SHARE stays gross × CO_DEFIED_SHARE (33.3%, 2026-11-16). The gap is "fees covered by co-managers", so a
// fee that's bigger than the sheet's share isn't an error.
// The Co-Management Cut (Stripe ▸ Connect ▸ Platform pricing) is a HISTORY, oldest first, because Stripe charges each payment
// at the cut of its own day (2026-11-16): gross × 35.11% + $0.45 from 2026-10-06, gross × 35.23% + $0.20 from 2026-11-16.
// pct is a fraction, flat is in cents, since is a New York day. These are what STRIPE actually took as Defied's fee, so they
// don't change when the sheet's share does (that is CO_DEFIED_SHARE). The accounting sheet's Stripe Fees tab holds the same
// history (lib/accounting.js parseCoCut) and wins when it has it; these stand in when it doesn't.
export const CO_CUTS = [
  { since: "2026-10-06", pct: 0.3511, flat: 45 },
  { since: "2026-11-16", pct: 0.3523, flat: 20 }, // B: Defied's 33.3% + ⅔ of Stripe's 2.9% + 30¢ (Defied pays ⅓)
];
// since: the day managers started covering their share of the fee (the first cut's); sheetPct: what Stripe took as Defied's
// fee before it, a flat 33% of the amount
export const CO_MANAGER = { since: CO_CUTS[0].since, sheetPct: 0.33 };
// The cut in effect on a New York day: the latest one that has started, or null before the first
export function cutOn(day, cuts = CO_CUTS) {
  let hit = null;
  for (const c of cuts || []) if (c.since <= day) hit = c;
  return hit;
}
// The fees (cents) Stripe could have taken as the cut on a payment: none before the first cut; else the fee of the cut of its
// day, and on the day a new cut started also the one before it (a payment earlier that day was still at the old price)
export function cutFeesOn(amount, at, cuts = CO_CUTS) {
  const day = nyDay(at), cut = cutOn(day, cuts);
  if (!cut) return [];
  const fee = (c) => Math.round(amount * c.pct + c.flat);
  const before = cuts[cuts.indexOf(cut) - 1];
  return before && day === cut.since ? [fee(cut), fee(before)] : [fee(cut)];
}
// What Stripe could have taken as Defied's fee on a co-managed payment: cutFeesOn, or before the first cut its old 33%
export function coFeesOn(amount, at, cuts = CO_CUTS) {
  const fees = cutFeesOn(amount, at, cuts);
  return fees.length ? fees : [Math.round(amount * CO_MANAGER.sheetPct)];
}
// The one fee for the day's cut (the new one on a switch day), or the old 33%
export function coManagerFee(amount, at, cuts = CO_CUTS) {
  const cut = cutOn(nyDay(at), cuts);
  return cut ? Math.round(amount * cut.pct + cut.flat) : Math.round(amount * CO_MANAGER.sheetPct);
}
// What Stripe kept against what the sheet will show, in cents, for a co-managed payment
export function feeVsSheet(p) {
  if (!p.link?.owner || p.link.owner === OWNER) return { stripe: p.fee, sheet: p.fee, covered: 0, note: "" };
  const sheet = Math.round(p.amount * CO_DEFIED_SHARE);
  const covered = p.fee - sheet;
  const ruled = coFeesOn(p.amount, p.at).includes(p.fee);
  // (2026-11-16) only an extra: a fee from before the cut, at Stripe's old 33%, is a little UNDER the sheet's 33.3%
  return { stripe: p.fee, sheet, covered, note: covered > 0 && ruled ? "The extra is the manager's share of Stripe's fees" : "" };
}

// --- joins (pure) -------------------------------------------------------------
const descriptionOf = (session) => {
  const f = (session?.custom_fields || []).find((x) => x.key === "description" || /description/i.test(x.label?.custom || ""));
  return f?.text?.value || f?.dropdown?.value || "";
};
// clientRef: the client's id, when they paid from their portal's Management Commission card (lib/commission.js)
const payerOf = (charge, session) => ({
  payerName: session?.customer_details?.name || charge?.billing_details?.name || "",
  payerEmail: session?.customer_details?.email || charge?.billing_details?.email || charge?.receipt_email || "",
  ...(session?.client_reference_id ? { clientRef: String(session.client_reference_id) } : {}),
});

// One client payment through a manager's link: the fee is Defied's part, the charge the whole payment. ownerOf(url): the manager whose
// link it is (2026-11-26: from the pay links setting, read once per refresh; the seed's when not given)
export function joinFee(fee, charge, session, link, ownerOf = (url) => ownerOfLink(url)) {
  return {
    id: fee.id,
    at: charge?.created ?? fee.created,
    amount: (charge?.amount ?? 0) - (charge?.amount_refunded ?? 0),
    fee: fee.amount - (fee.amount_refunded || 0),
    currency: fee.currency,
    ...payerOf(charge, session),
    description: descriptionOf(session),
    link: { url: link?.url || null, owner: ownerOf(link?.url) },
    connectedAccount: fee.account,
    receiptUrl: charge?.receipt_url || null,
  };
}
// A payment straight to Defied's own account (only tests and deposits so far): all of it is Defied's
export function joinPlatformCharge(charge, session, link) {
  const amount = charge.amount - (charge.amount_refunded || 0);
  return {
    id: charge.id, at: charge.created, amount, fee: amount, currency: charge.currency,
    ...payerOf(charge, session), description: descriptionOf(session),
    link: { url: link?.url || null, owner: OWNER }, connectedAccount: null, receiptUrl: charge.receipt_url || null, direct: true,
  };
}
// A platform charge that is itself a connected payment's fee transfer isn't a payment of its own
export const isOwnPlatformCharge = (c) => c.status === "succeeded" && c.paid !== false && !c.application_fee && !c.source_transfer;

// Defied's cut by New York month, in cents: this month, last month and this year
export function commissionTotals(list, now = new Date()) {
  const month = nyMonth(now), last = prevMonth(month), year = month.slice(0, 4);
  const out = { month, lastMonthKey: last, year, thisMonth: 0, lastMonth: 0, thisYear: 0, count: { thisMonth: 0, lastMonth: 0, thisYear: 0 } };
  for (const p of list) {
    const m = nyMonth(p.at);
    if (m === month) { out.thisMonth += p.fee; out.count.thisMonth++; }
    if (m === last) { out.lastMonth += p.fee; out.count.lastMonth++; }
    if (m.slice(0, 4) === year) { out.thisYear += p.fee; out.count.thisYear++; }
  }
  return out;
}

// --- fetching (GET only) ----------------------------------------------------------
export async function stripeRequest(method, path, { params, account } = {}) {
  // the read key is restricted anyway; this is the second lock
  if (String(method).toUpperCase() !== "GET") throw new Error("Stripe is read-only on this site.");
  const key = stripeKey();
  if (!key) throw new Error("Stripe isn't connected yet.");
  const qs = params && Object.keys(params).length ? `?${new URLSearchParams(params)}` : "";
  const headers = { Authorization: `Bearer ${key}` };
  if (account) headers["Stripe-Account"] = account;
  let res;
  try {
    res = await fetch(`${apiBase()}${path}${qs}`, { method: "GET", headers });
  } catch {
    throw new Error("Couldn't reach Stripe.");
  }
  if (res.status === 401 || res.status === 403) throw new Error("Stripe didn't accept the key.");
  if (!res.ok) throw new Error(`Stripe had a problem (${res.status}). Try again in a minute.`);
  return res.json();
}
const stripeGet = (path, opts) => stripeRequest("GET", path, opts);

// Every page of a list, newest first (Stripe's order)
async function listAll(path, params = {}, account) {
  const out = [];
  let after = null;
  for (let page = 0; page < 50; page++) {
    const r = await stripeGet(path, { params: { limit: "100", ...params, ...(after ? { starting_after: after } : {}) }, account });
    out.push(...(r.data || []));
    if (!r.has_more || !r.data?.length) break;
    after = r.data[r.data.length - 1].id;
  }
  return out;
}

async function joinDetails(paymentIntent, account) {
  if (!paymentIntent) return { session: null, link: null };
  const s = await stripeGet("/v1/checkout/sessions", { params: { payment_intent: paymentIntent }, account });
  const session = s.data?.[0] || null;
  const linkId = typeof session?.payment_link === "string" ? session.payment_link : session?.payment_link?.id;
  const link = linkId ? await stripeGet(`/v1/payment_links/${linkId}`, { account }) : null;
  return { session, link };
}

// app_state helpers (same table and shape as lib/app-state.js)
const dbStore = {
  async get(key) { return (await sql`SELECT value FROM app_state WHERE key = ${key}`)[0]?.value ?? null; },
  async set(key, value) {
    await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${key}, ${JSON.stringify(value)}, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  },
};

// Fetches only what's newer than the cache: one fees call and one platform-charges call when
// nothing came in, plus three reads per new payment (charge, checkout session, link), once ever.
// The lists reach back RECHECK_DAYS too, so a refund after the first fill still lowers its payment.
// A first fill (~3 reads a fee) is saved every SAVE_EVERY joins, and the "newest" marks only move
// once a whole list is joined, so a fill cut short picks up where it stopped on the next load.
const RECHECK_DAYS = 90;
const SAVE_EVERY = 10;
export async function refreshCommission(store = dbStore, { now = Date.now() } = {}) {
  const state = (await store.get(STATE_KEY)) || { v: 1, newestFee: 0, newestCharge: 0, fees: {}, charges: {} };
  const back = Math.floor(toMs(now) / 1000) - RECHECK_DAYS * 86400;
  // gte, not gt: two fees in the same second; ids already joined are skipped
  const since = (newest) => (newest ? { "created[gte]": String(Math.min(newest, back)) } : {});
  const save = () => store.set(STATE_KEY, { ...state, filledAt: state.filledAt || null, checkedAt: new Date().toISOString() });
  let changed = false, joined = 0, ownerOf = null;
  // the pay links as they are now, read once and only when there is a new payment to join
  const owners = async () => ownerOf || (ownerOf = ((links) => (url) => ownerOfLink(url, links))(await readPayLinks()));
  const fees = await listAll("/v1/application_fees", since(state.newestFee));
  for (const fee of fees) {
    const had = state.fees[fee.id];
    if (had) {
      // refunded since it was joined: the fee says so; its charge says what's left of the payment
      const cut = fee.amount - (fee.amount_refunded || 0);
      if (cut === had.fee) continue;
      const charge = await stripeGet(`/v1/charges/${fee.charge}`, { account: fee.account });
      state.fees[fee.id] = { ...had, fee: cut, amount: (charge?.amount ?? 0) - (charge?.amount_refunded ?? 0) };
      changed = true;
      continue;
    }
    const charge = await stripeGet(`/v1/charges/${fee.charge}`, { account: fee.account });
    const { session, link } = await joinDetails(charge.payment_intent, fee.account);
    state.fees[fee.id] = joinFee(fee, charge, session, link, await owners());
    changed = true;
    if (++joined % SAVE_EVERY === 0) await save();
  }
  state.newestFee = Math.max(state.newestFee, ...fees.map((f) => f.created));
  const own = await listAll("/v1/charges", since(state.newestCharge));
  for (const c of own) {
    const had = state.charges[c.id];
    if (had) {
      const amount = c.amount - (c.amount_refunded || 0);
      if (amount !== had.amount) { state.charges[c.id] = { ...had, amount, fee: amount }; changed = true; }
      continue;
    }
    if (!isOwnPlatformCharge(c)) continue;
    const { session, link } = await joinDetails(c.payment_intent, null);
    state.charges[c.id] = joinPlatformCharge(c, session, link);
    changed = true;
  }
  state.newestCharge = Math.max(state.newestCharge, ...own.filter(isOwnPlatformCharge).map((c) => c.created));
  if (changed || !state.filledAt) await store.set(STATE_KEY, { ...state, filledAt: state.filledAt || new Date().toISOString(), checkedAt: new Date().toISOString() });
  return state;
}

// (review money-2) One payment as Stripe has it right now, for Auto-log: { refunded } (any refund of its charge or of Defied's fee, or a dispute), or
// null when Stripe can't be asked or doesn't answer (then it's a person's call). refreshCommission re-reads a charge only when its fee's refund changes,
// and a refund leaves the fee alone unless refund_application_fee is set (a manager refunding a client from their own Stripe), so the stored amount
// can still be the full payment. Two GETs for a fee (it, then its charge on the connected account), one for a payment straight to Defied.
const anyRefund = (x) => !!(x && (x.refunded || Number(x.amount_refunded) > 0 || x.disputed));
export async function chargeNow(p) {
  if (!p?.id) return null;
  try {
    if (p.direct) { const c = await stripeGet(`/v1/charges/${p.id}`); return c?.id ? { refunded: anyRefund(c) } : null; }
    const fee = await stripeGet(`/v1/application_fees/${p.id}`);
    const chargeId = typeof fee?.charge === "string" ? fee.charge : fee?.charge?.id;
    const account = typeof fee?.account === "string" ? fee.account : fee?.account?.id;
    if (!chargeId) return null;
    const c = await stripeGet(`/v1/charges/${chargeId}`, { account });
    return c?.id ? { refunded: anyRefund(fee) || anyRefund(c) } : null;
  } catch (err) {
    console.error("stripe: couldn't check a payment again", String(err?.message || err).slice(0, 160));
    return null;
  }
}

// (2026-11-26 owner: automatic) The charges on one manager's connected account made since `since` (unix seconds), for Auto-log's refund check: what each
// refunded (any part, whether Defied's fee went back with it or not: the stored list sees only a refund that took the fee back) and the fee it carries
// (`fee`: the application fee's id, which is the payment's id here). GET only; at most `pages` pages of 100, newest first.
export async function chargesSince(account, since, { pages = 3 } = {}) {
  const out = [];
  let after = null;
  for (let page = 0; page < pages; page++) {
    const r = await stripeGet("/v1/charges", { params: { limit: "100", "created[gte]": String(Math.max(0, Math.floor(since))), ...(after ? { starting_after: after } : {}) }, account });
    out.push(...(r.data || []));
    if (!r.has_more || !r.data?.length) break;
    after = r.data[r.data.length - 1].id;
  }
  return out.map((c) => ({ id: c.id, fee: typeof c.application_fee === "string" ? c.application_fee : c.application_fee?.id || null, feeAmount: Number(c.application_fee_amount) || 0,
    amount: Number(c.amount) || 0, refunded: Number(c.amount_refunded) || 0, full: !!c.refunded }));
}

// Every commission payment since `since` (a Date, ISO string or unix seconds), newest first. Each one's manager is worked out again from
// the pay links as they are now (2026-11-26): a link added after its first payment, or changed since, still names its manager
export async function listCommission({ since = 0, store } = {}) {
  const state = await refreshCommission(store);
  const from = since ? toMs(since) : 0;
  const links = await readPayLinks();
  return withLinkOwners([...Object.values(state.fees), ...Object.values(state.charges)], links)
    .filter((p) => toMs(p.at) >= from)
    .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
}

// What the Dashboard's money row needs; a missing key or a Stripe outage is a plain line, never a crash
export async function commissionSummary({ now = new Date(), store } = {}) {
  if (!stripeConnected()) return { connected: false };
  try {
    const list = await listCommission({ store });
    return { connected: true, totals: commissionTotals(list, now), recent: list.slice(0, 8), list };
  } catch (err) {
    console.error("commissionSummary failed:", err);
    return { connected: true, error: err.message || "Couldn't reach Stripe." };
  }
}
