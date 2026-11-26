// Who's paid, Request payment and Paydays on the server (2026-11-26): what they read (the clients, their release days, and app_state's
// 'payRequests', 'payNudges' and 'paydays'), the one place that puts them together with a money read (lib/money.js moneyState), and
// their saves. Each save merges only its own key into its app_state row in one statement, so two saves at once both stay. Server-only, staff-only data.
import { sql } from "./db";
import { nyDay } from "./stripe";
import { isTestPay, rowTypesByPayer, clientsByPayer } from "./accounting";
import { placement } from "./accounting-place";
import { ymdOf } from "./roster-catalog";
import { GENERAL } from "./log-fields";
import { uid } from "./id";
import { clientMoney, paidSince, whoPaidRows, managerRows, quietClients, quietWhy, onInfo } from "./payers";
import { REQUESTS_KEY, NUDGES_KEY, NOT_NOW_DAYS, normalizeRequests, settleRequests, recentRequests, snoozedIds } from "./pay-requests";
import { PAYDAYS_KEY, SOURCES, normalizePaydays, openPaydays, upcomingPaydays, calendarDates, notSetOf } from "./paydays";
export { readPaydays, savePaydays, removePayday, weekOfPaydays } from "./paydays-store";

// ---------------------------------------------------------------- reads
async function clientRows() {
  try {
    return await sql`SELECT id, name, sheet_tab_name, manager, on_roster, info_name FROM clients`;
  } catch (err) {
    if (err?.code !== "42703") throw err; // before migration 022 (no info_name): the names alone, as lib/info-links.js does
    return sql`SELECT id, name, sheet_tab_name, manager, on_roster FROM clients`;
  }
}
// -> { clients, releases: Map(clientId -> [days]), requests, nudges, paydays (the stored value or null) }
export async function payersInputs() {
  const [clients, rel, state] = await Promise.all([
    clientRows(),
    sql`SELECT client_id, release_date FROM placements WHERE release_date <> ''`,
    sql`SELECT key, value FROM app_state WHERE key IN (${REQUESTS_KEY}, ${NUDGES_KEY}, ${PAYDAYS_KEY})`,
  ]);
  const releases = new Map();
  for (const r of rel || []) { const d = ymdOf(r.release_date); if (d) releases.set(r.client_id, [...(releases.get(r.client_id) || []), d]); }
  const kv = Object.fromEntries((state || []).map((r) => [r.key, r.value]));
  return { clients: clients || [], releases, requests: normalizeRequests(kv[REQUESTS_KEY]), nudges: kv[NUDGES_KEY] || {}, paydays: kv[PAYDAYS_KEY] ?? null };
}

// ---------------------------------------------------------------- one money read -> everything these screens show
// pay, acct, match: lib/money.js moneyState's; namer: payerNamer(match). Either Stripe or the sheet missing: what's found still counts as
// paid, but nothing is called quiet and nobody's "not paid" is trusted (paidSince says unknown), so a payday row never closes by itself.
export function compute({ inputs, pay, acct, match, namer, now = new Date() }) {
  const today = nyDay(now);
  const { clients, releases, requests, nudges } = inputs;
  const rows = acct?.rows || null, list = pay?.list || null;
  const whole = !!(rows && list);
  const partial = whole ? null : rows ? "stripe" : list ? "sheet" : "both";
  const roster = [...clients.filter(onInfo).map((c) => String(c.info_name || "").trim() || c.name), GENERAL];
  const placeOf = match && namer ? (p) => placement(p, { roster, typesOf: rowTypesByPayer(match), bySheet: clientsByPayer(match), nameOf: namer }) : () => ({});
  const money = clientMoney({ clients, rows, year: acct?.year, list, unlogged: match?.unlogged || null, placeOf, nameOf: namer || (() => ({})) });
  const nameById = new Map(clients.map((c) => [c.id, c.name]));
  const settled = list && namer ? settleRequests(requests, list, { nameOf: namer, nameById, isTest: isTestPay }) : new Map();
  const recent = recentRequests(requests, settled, now);
  const asked = new Set(recent.filter((r) => !r.paid).map((r) => r.clientId));
  const quiet = whole ? quietClients({ money, releases, today, snoozed: snoozedIds(nudges, now), asked }).map((q) => ({ ...q, why: quietWhy(q) })) : null;
  const sched = normalizePaydays(inputs.paydays);
  const people = clients.map((c) => ({ id: c.id, name: c.name }));
  const since = (id, day) => { const d = paidSince(money.get(id), day); return d || (whole ? null : undefined); };
  // a payday's "Requested": a request for that payday, or any request for the client since its day, that no payment has settled
  const askedFor = (id, pid, day) => recent.find((r) => r.clientId === id && !r.paid && (r.paydayId === pid || nyDay(r.at) >= day))?.at || null;
  const open = openPaydays(sched, { today, people, paidSince: since, asked: askedFor });
  return { today, partial, money, recent, quiet, sched, people, open };
}
// the counts part (every Money load: To do's rows and the calendar chips) and, full, Who's paid. Never throws: null when it couldn't be worked out.
export async function payersFor({ pay, acct, match, namer, now = new Date(), full = false }) {
  try {
    const c = compute({ inputs: await payersInputs(), pay, acct, match, namer, now });
    const counts = { quiet: c.quiet, requests: c.recent.map(({ id, clientId, at, paid }) => ({ id, clientId, at, paid })), paydays: { open: c.open, dates: calendarDates(c.sched) } };
    if (!full) return { counts };
    const clients = whoPaidRows(c.money, c.today);
    return { counts, clients, managers: managerRows(clients), partial: c.partial };
  } catch (err) {
    console.error("payers: couldn't work out who's paid", err);
    return null;
  }
}
// Money › Paydays: the schedule (each source's dates, "2027 not set"), the clients grid, the open paydays and the coming ones
export async function paydaysView({ pay, acct, match, namer, now = new Date() }) {
  const inputs = await payersInputs();
  const c = compute({ inputs, pay, acct, match, namer, now });
  const sources = SOURCES.map((s) => ({ id: s.id, name: s.name, url: s.url, dates: c.sched.dates[s.id].map((d) => ({ day: d.day, approx: d.approx, past: d.day < c.today })), notSet: notSetOf(c.sched, s.id, c.today, c.people) }));
  const who = new Set(Object.keys(c.sched.who));
  const clients = inputs.clients.filter((x) => who.has(x.id) || (x.on_roster && onInfo(x)))
    .map((x) => ({ id: x.id, name: x.name, who: c.sched.who[x.id] || [] }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return { today: c.today, partial: c.partial, sources, clients, open: c.open, upcoming: upcomingPaydays(c.sched, { today: c.today, people: c.people }), requests: c.recent.map(({ id, clientId, at, paid }) => ({ id, clientId, at, paid })) };
}

// ---------------------------------------------------------------- saves
const merge = (key, obj) => sql`INSERT INTO app_state (key, value, updated_at) VALUES (${key}, ${JSON.stringify(obj)}::jsonb, now())
  ON CONFLICT (key) DO UPDATE SET value = app_state.value || EXCLUDED.value, updated_at = now()`;
// Request payment: recorded once the link was shared or copied. -> { id, at }
export async function createRequest({ clientId, key, cents = null, paydayId = "", by }) {
  const id = uid(), at = new Date().toISOString();
  await merge(REQUESTS_KEY, { [id]: { clientId, key, cents, paydayId, by, at } });
  return { id, at };
}
// Not now: that client is off To do's quiet list for 30 days
export async function snoozeClient(clientId, by) {
  const at = new Date();
  await merge(NUDGES_KEY, { [clientId]: { until: new Date(at.getTime() + NOT_NOW_DAYS * 864e5).toISOString(), by, at: at.toISOString() } });
}
export async function clientExists(id) {
  return (await sql`SELECT id FROM clients WHERE id = ${id}`).length > 0;
}
