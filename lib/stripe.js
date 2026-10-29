// Defied's Stripe commission, read-only. Defied is a Stripe Connect platform: clients pay through
// each manager's connected account (their pay.defiedmgmt.com link), and Defied's cut of each payment
// is that payment's application fee. Server-only, and GET only: nothing here can change Stripe.
// The pure parts (joinFee, commissionTotals, the fee rule) are separate from the fetching so tests
// can run them on the real snapshot without a network.
import { sql } from "./db";
import { ownerOfLink, OWNER } from "./pay-links";

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
// Since 2026-10-06 a co-managed client's fee also carries the manager's share of Stripe's fees
// (gross × 35.11% + $0.45), while the accounting sheet's DEFIED SHARE stays gross × 33%. The gap
// is "fees covered by co-managers", so a fee that's bigger than the sheet's share isn't an error.
export const CO_MANAGER = { since: "2026-10-06", pct: 0.3511, flat: 45, sheetPct: 0.33 };
export function coManagerFee(amount, at) {
  return nyDay(at) >= CO_MANAGER.since ? Math.round(amount * CO_MANAGER.pct + CO_MANAGER.flat) : Math.round(amount * CO_MANAGER.sheetPct);
}
// What Stripe kept against what the sheet will show, in cents, for a co-managed payment
export function feeVsSheet(p) {
  if (!p.link?.owner || p.link.owner === OWNER) return { stripe: p.fee, sheet: p.fee, covered: 0, note: "" };
  const sheet = Math.round(p.amount * CO_MANAGER.sheetPct);
  const covered = p.fee - sheet;
  const ruled = p.fee === coManagerFee(p.amount, p.at);
  return { stripe: p.fee, sheet, covered, note: covered && ruled ? "The extra is the manager's share of Stripe's fees" : "" };
}

// --- joins (pure) -------------------------------------------------------------
const descriptionOf = (session) => {
  const f = (session?.custom_fields || []).find((x) => x.key === "description" || /description/i.test(x.label?.custom || ""));
  return f?.text?.value || f?.dropdown?.value || "";
};
const payerOf = (charge, session) => ({
  payerName: session?.customer_details?.name || charge?.billing_details?.name || "",
  payerEmail: session?.customer_details?.email || charge?.billing_details?.email || charge?.receipt_email || "",
});

// One client payment through a manager's link: the fee is Defied's part, the charge the whole payment
export function joinFee(fee, charge, session, link) {
  return {
    id: fee.id,
    at: charge?.created ?? fee.created,
    amount: (charge?.amount ?? 0) - (charge?.amount_refunded ?? 0),
    fee: fee.amount - (fee.amount_refunded || 0),
    currency: fee.currency,
    ...payerOf(charge, session),
    description: descriptionOf(session),
    link: { url: link?.url || null, owner: ownerOfLink(link?.url) },
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

// app_state helpers (same table and shape lib/luminate.js uses)
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
  let changed = false, joined = 0;
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
    state.fees[fee.id] = joinFee(fee, charge, session, link);
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

// Every commission payment since `since` (a Date, ISO string or unix seconds), newest first
export async function listCommission({ since = 0, store } = {}) {
  const state = await refreshCommission(store);
  const from = since ? toMs(since) : 0;
  return [...Object.values(state.fees), ...Object.values(state.charges)]
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
