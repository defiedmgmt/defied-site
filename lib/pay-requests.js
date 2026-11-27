// Request payment (2026-11-26): a pay link sent to a client from their page, Money's Who's paid or a payday card.
// Pure: lib/payers-store.js keeps the requests in app_state 'payRequests' ({ [id]: { clientId, key, cents, paydayId, by, at } }, a few a
// week, so no table) and works out on every read which ones a real payment has settled: nothing is written when one is paid, and a full
// refund opens it again.

export const REQUESTS_KEY = "payRequests";
export const ASKED_DAYS = 14; // "Requested Nov 26" shows for 14 days
export const MAX_CENTS = 100000000; // $1,000,000, the Log confirm's cap (lib/log-fields.js)
export const KEY_RE = /^[a-z][a-z0-9]{1,15}$/; // a pay.defiedmgmt.com/<key>
const DAY_MS = 864e5;
const ms = (t) => (t instanceof Date ? t.getTime() : typeof t === "number" ? (t < 1e11 ? t * 1000 : t) : Date.parse(t));

// the stored object -> requests, oldest first (anything malformed left out)
export function normalizeRequests(value) {
  const v = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const out = [];
  for (const [id, r] of Object.entries(v)) {
    if (!r || typeof r !== "object" || typeof r.clientId !== "string" || !Number.isFinite(ms(r.at))) continue;
    out.push({ id, clientId: r.clientId, key: String(r.key || ""), cents: Number.isInteger(r.cents) && r.cents > 0 ? r.cents : null, paydayId: String(r.paydayId || ""), by: String(r.by || ""), at: new Date(ms(r.at)).toISOString() });
  }
  return out.sort((a, b) => ms(a.at) - ms(b.at) || (a.id < b.id ? -1 : 1));
}

// Which requests a real payment settles: oldest request first, the first payment (not a test, more than $0) made at or after it, from that
// client (their portal or request link's id, or a payer the site names as them). With an amount asked for, a payment of exactly that much
// within 30 days comes first. One payment settles one request. -> Map(requestId -> { at, paymentId })
// payments: lib/stripe.js listCommission's; nameOf: lib/money.js payerNamer; nameById: client id -> name; isTest: lib/accounting.js isTestPay
export function settleRequests(requests, payments, { nameOf, nameById, isTest = () => false }) {
  const used = new Set(), out = new Map();
  const pays = (payments || []).filter((p) => p.amount > 0 && !isTest(p)).sort((a, b) => ms(a.at) - ms(b.at) || (a.id < b.id ? -1 : 1));
  for (const r of requests) {
    const from = ms(r.at), name = nameById.get(r.clientId);
    const mine = pays.filter((p) => !used.has(p.id) && ms(p.at) >= from && (p.clientRef === r.clientId || (!!name && nameOf(p)?.client === name)));
    const hit = (r.cents && mine.find((p) => p.amount === r.cents && ms(p.at) - from <= 30 * DAY_MS)) || mine[0];
    if (!hit) continue;
    used.add(hit.id);
    out.set(r.id, { at: new Date(ms(hit.at)).toISOString(), paymentId: hit.id });
  }
  return out;
}

// The requests of the last ASKED_DAYS days, newest first, each with the moment a payment settled it (or null)
export function recentRequests(requests, settled, now = Date.now()) {
  const since = ms(now) - ASKED_DAYS * DAY_MS;
  return requests.filter((r) => ms(r.at) >= since).reverse()
    .map((r) => ({ id: r.id, clientId: r.clientId, at: r.at, paydayId: r.paydayId, paid: settled.get(r.id)?.at || null }));
}
