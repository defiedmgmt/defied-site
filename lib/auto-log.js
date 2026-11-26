// (2026-11-26) Auto-log: Stripe payments go on the accounting book's Income tab by themselves, exactly as Log it would add them (lib/accounting-log.js
// logPayments, through lib/accounting-books.js logPaymentsByBook so each goes into the book for its New York year: the same claims, ledger lock, formula
// guard, read-back and "Log new payments" update; its rows carry Source / Notes "Stripe · via <manager> · <short id>" and accounting_log.by_name "Auto-log").
// (2026-11-26 owner: automatic) "just make the auto logging an automatic thing without all those rules — I just want a log or a message when things have been
// logged so I know they're done properly". So:
//   - It is ON unless a Founder turns it off (the one switch, Money › Settings; app_state "autoLog" { on, by, at }). A write that went wrong (a formula that
//     changed, rows that may or may not have landed, a row the sheet didn't take) turns it off by itself, and the note says so.
//   - Every payment Log it places with certainty is added (lib/accounting-place.js autoPlace): no waiting a day, no "two earlier payments" first. What it can't
//     place stays in To log, as today. At most AUTO_BATCH a run, the oldest first.
//   - It runs in the daily job (pages/api/cron/daily.js) and, server-side, when Home or Money's data loads (autoLogSoon): only when something new is waiting,
//     and at most once every SOON_MIN minutes. One run at a time (the run's lease, RUN_KEY).
//   - After a run that logged something, found a payment it can't place, or found an auto-logged payment refunded since, ONE ClickUp message (lib/alerts.js
//     postNote: where the site's alerts go), one line a payment. Each payment is told once (NOTES_KEY), nothing is sent when nothing new happened.
//   - A payment refunded after it was auto-logged (in full or in part, also when Defied's fee stayed) is told once, and is a To do row for the Founders
//     ("Refunded after logging: …") until one marks it handled (HANDLED_KEY). No row in the book is ever changed or removed here.
// A run writes nothing unless ACCOUNTING_SHEET_WRITES=on, and never on a preview. Server-only.
import { sql } from "./db";
import { uid } from "./id";
import { logWritesOn, autoPayments, AUTO_BATCH } from "./accounting-log";
import { logPaymentsByBook } from "./accounting-books";
import { moneyState } from "./money";
import { accountingSheetId, isTestPay, loadBooks } from "./accounting";
import { nyDay, toMs, chargesSince } from "./stripe";
import { postNote, scrub } from "./alerts";
import { dayWord, usd } from "./accounting-checks";
import { personKey } from "./names";
import { PREVIEW } from "./preview";

export { AUTO_BATCH };
export const AUTO_KEY = "autoLog";        // the Founders' switch
export const AUTO_BY = "Auto-log";        // accounting_log.by_name of its rows
export const RUN_KEY = "autoLogRun";      // the run's lease { holder, until }; its updated_at is when the last run started
export const NOTES_KEY = "autoLogNotes";  // what the ClickUp note has told: { said: { <id>: { logged?, need?, refund? } }, refunds: { <id>: {...} } }
export const HANDLED_KEY = "autoLogHandled"; // a Founder's "handled" on a refund row: { <id>: { by, at } }
export const SOON_MIN = 10;               // a page's run: at most once every 10 minutes
export const LEASE_S = 90;                // longer than any function runs (60 s), so a run cut off frees the lease by itself
export const REFUND_DAYS = 180;           // an auto-logged payment is watched for a refund this long
export const CATCHUP_DAYS = 2;            // an auto-logged row whose note didn't go out is told at a run within this long
export const KEEP_DAYS = 400;             // what the note told is kept this long (a payment waits in To log a book year at most)
export const MONEY_URL = "https://www.defiedmgmt.com/dashboard/money/payments";
const str = (v, n = 80) => String(v ?? "").slice(0, n);
const daysAgo = (now, d) => new Date(toMs(now) - d * 864e5);

// ---------------------------------------------------------------- the switch
// { on, by, at, offWhy }: on unless it was turned off (a Founder, or the job after a write that went wrong); offWhy only while the job's off is in force
export function normalizeAutoLog(v) {
  const o = v && typeof v === "object" && !Array.isArray(v) ? v : {};
  const on = o.on !== false;
  return { on, by: str(o.by), at: str(o.at, 40), offWhy: on ? "" : str(o.offWhy, 600) };
}
// never throws. A store that can't be read is off for the run (nothing is written when the switch can't be seen)
export async function autoLogState() {
  try {
    const [r] = await sql`SELECT value FROM app_state WHERE key = ${AUTO_KEY}`;
    return normalizeAutoLog(r?.value);
  } catch (err) {
    console.error("auto-log: state unavailable", err?.message || err);
    return { ...normalizeAutoLog(null), on: false, unread: true };
  }
}
// A Founder's switch (why empty), or the job turning it off (why = what went wrong). One flat value, written whole.
export async function setAutoLog(on, by, why = "") {
  const at = new Date().toISOString();
  const value = on ? { on: true, by: str(by), at } : { on: false, by: str(by), at, ...(why ? { offWhy: str(why, 600) } : {}) };
  await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${AUTO_KEY}, ${JSON.stringify(value)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  return normalizeAutoLog(value);
}

// ---------------------------------------------------------------- one run at a time
// Taken in ONE statement: a free lease (none, given back, or past its `until`), and for a page's run also a last run that started SOON_MIN minutes ago or
// more. -> the holder, or null (another run is on, or a page's run came too soon). Given back without touching updated_at: the 10 minutes count from a start.
export async function takeRun({ soon = false } = {}) {
  const holder = uid() + uid();
  const rows = soon
    ? await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${RUN_KEY}, jsonb_build_object('holder', ${holder}::text, 'until', now() + make_interval(secs => ${LEASE_S})), now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
        WHERE ((app_state.value->>'until')::timestamptz < now() OR app_state.value->>'holder' = '') AND app_state.updated_at < now() - make_interval(mins => ${SOON_MIN})
        RETURNING value->>'holder' AS holder`
    : await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${RUN_KEY}, jsonb_build_object('holder', ${holder}::text, 'until', now() + make_interval(secs => ${LEASE_S})), now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
        WHERE (app_state.value->>'until')::timestamptz < now() OR app_state.value->>'holder' = ''
        RETURNING value->>'holder' AS holder`;
  return rows[0]?.holder === holder ? holder : null;
}
export const giveRun = (holder) => sql`UPDATE app_state SET value = jsonb_build_object('holder', '', 'until', now()) WHERE key = ${RUN_KEY} AND value->>'holder' = ${holder}`
  .catch((err) => console.error("auto-log: couldn't give the run back", err?.message || err));

// ---------------------------------------------------------------- what was told
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
export const normalizeNotes = (v) => ({ said: { ...obj(obj(v).said) }, refunds: { ...obj(obj(v).refunds) } });
async function readNotes() {
  const [r] = await sql`SELECT value FROM app_state WHERE key = ${NOTES_KEY}`;
  return normalizeNotes(r?.value);
}
// written whole, only under the run's lease; what's older than KEEP_DAYS goes
async function writeNotes(v, now) {
  const cut = nyDay(daysAgo(now, KEEP_DAYS));
  const latest = (s) => Object.values(obj(s)).filter((x) => typeof x === "string").sort().pop() || "";
  const said = Object.fromEntries(Object.entries(v.said).filter(([, s]) => latest(s) >= cut));
  const refunds = Object.fromEntries(Object.entries(v.refunds).filter(([, r]) => String(r?.told || "") >= cut));
  await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${NOTES_KEY}, ${JSON.stringify({ said, refunds })}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

// ---------------------------------------------------------------- the message (pure)
// a name as one plain line: no Markdown, no line breaks
const plain = (s, n = 60) => String(s ?? "").replace(/[\r\n\t]+/g, " ").replace(/[*_`[\]()<>#|\\]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
// "Pat Payer / Alpha" when Stripe's payer isn't the client's own name, else the one known
export function whoLine(payer, client) {
  const a = plain(payer), b = plain(client);
  if (a && b && personKey(a) !== personKey(b)) return `${a} / ${b}`;
  return b || a || "Unknown payer";
}
const cents = (dollars) => Math.round((Number(dollars) || 0) * 100);
const pctOf = (part, whole) => { const v = whole ? Math.round((part / whole) * 1000) / 10 : 0; return `${v}%`; };
// logged: [{ day, payer, client, amount (cents), year, row, split?: { manager, managerShare, defied } (dollars) }]; needs: [{ day, payer, client, amount, need }];
// refunds: [{ day, payer, client, amount, refunded (cents), feeKept, year, row }]; alarm: what went wrong (it turned itself off). -> the message, or "" when
// there's nothing to tell. Never names a deal or a secret: it is built only from these fields.
export function noteText({ logged = [], needs = [], refunds = [], alarm = "" } = {}) {
  if (!logged.length && !needs.length && !refunds.length && !alarm) return "";
  const parts = [logged.length && `${logged.length} logged`, needs.length && `${needs.length} to log`, refunds.length && `${refunds.length} refunded after logging`, alarm && "turned itself off"].filter(Boolean);
  const lines = [`**Auto-log** · ${parts.join(" · ")}`];
  for (const x of logged) {
    const s = x.split;
    const cut = !s ? [] : [`Defied ${usd(cents(s.defied))}`, s.manager && s.managerShare > 0 ? `${plain(s.manager, 40)} ${pctOf(cents(s.managerShare), x.amount)} (${usd(cents(s.managerShare))})` : "no manager cut"];
    lines.push(`- ${[dayWord(x.day), whoLine(x.payer, x.client), usd(x.amount), ...cut, `logged to ${x.year} Income row ${x.row}`].join(" · ")}`);
  }
  for (const x of needs) lines.push(`- ${[dayWord(x.day), whoLine(x.payer, x.client), usd(x.amount), `To log: needs ${x.need}`].join(" · ")}`);
  for (const x of refunds) lines.push(`- Refunded after logging: ${[dayWord(x.day), whoLine(x.payer, x.client), usd(x.amount), `${usd(x.refunded)} refunded${x.feeKept ? " (Defied's fee kept)" : ""}`, `fix ${x.year} Income row ${x.row}`].join(" · ")}`);
  if (alarm) lines.push(`⚠️ ${scrub(alarm, 400)} Turn it back on in Money › Settings once the sheet is right.`);
  lines.push(`[Money › All payments](${MONEY_URL})`);
  return lines.join("\n");
}

// ---------------------------------------------------------------- refunds after logging
// The auto-logged rows still watched for a refund: accounting_log's Auto-log rows that went in, the last REFUND_DAYS
export async function trackedRows(now = new Date()) {
  return sql`SELECT payment_id, sheet_row, amount_cents, client, day, logged_at FROM accounting_log
    WHERE by_name = ${AUTO_BY} AND status = 'done' AND logged_at >= ${daysAgo(now, REFUND_DAYS).toISOString()}`;
}
// Each tracked payment refunded since (any part, with Defied's fee or without): the stored list's amount went down (a refund that took the fee back), or the
// manager's own Stripe account says its charge was refunded (one list of charges per account: a refund that left Defied's fee alone, which the stored list
// can't see). -> [{ id, day, payer, client, amount, refunded, feeKept, year, row }]. An account that can't be read is left for the next run.
export async function refundsOf({ tracked = [], list = [], listCharges = chargesSince } = {}) {
  const byId = new Map(list.map((p) => [p.id, p]));
  const out = new Map();
  const add = (e, p, refunded, feeKept) => {
    if (!(refunded > 0)) return;
    const had = out.get(e.payment_id);
    if (had && had.refunded >= refunded) return;
    out.set(e.payment_id, { id: e.payment_id, day: String(e.day), payer: p?.payerName || "", client: e.client || "", amount: Number(e.amount_cents) || 0,
      refunded, feeKept: !!feeKept, year: Number(String(e.day).slice(0, 4)), row: Number(e.sheet_row) || null });
  };
  const byAccount = new Map();
  for (const e of tracked) {
    const p = byId.get(e.payment_id);
    if (p && p.amount < Number(e.amount_cents)) add(e, p, Number(e.amount_cents) - p.amount, false);
    if (!p || p.direct || !p.connectedAccount) continue;
    if (!byAccount.has(p.connectedAccount)) byAccount.set(p.connectedAccount, []);
    byAccount.get(p.connectedAccount).push({ e, p });
  }
  for (const [account, xs] of byAccount) {
    let charges;
    try { charges = await listCharges(account, Math.min(...xs.map((x) => toMs(x.p.at))) / 1000 - 60); } catch (err) {
      console.error("auto-log: couldn't check a manager's Stripe for refunds", String(err?.message || err).slice(0, 160));
      continue;
    }
    const byFee = new Map(charges.filter((c) => c.fee).map((c) => [c.fee, c]));
    for (const { e, p } of xs) {
      const c = byFee.get(e.payment_id);
      if (!c || !(c.refunded > 0 || c.full)) continue;
      add(e, p, c.full && !(c.refunded > 0) ? c.amount : c.refunded, c.feeAmount > 0 && p.fee >= c.feeAmount);
    }
  }
  return [...out.values()];
}
// The Founders' To do rows: the refunds told and not marked handled, each with its book's link (the year's book; a preview's stand-in opens the real one,
// as Money's links do). Never throws ([]).
export async function openRefunds() {
  try {
    const rows = await sql`SELECT key, value FROM app_state WHERE key IN (${NOTES_KEY}, ${HANDLED_KEY})`;
    const notes = normalizeNotes(rows.find((r) => r.key === NOTES_KEY)?.value), done = obj(rows.find((r) => r.key === HANDLED_KEY)?.value);
    const open = Object.values(notes.refunds).filter((r) => r?.id && !done[r.id]);
    if (!open.length) return [];
    const map = await loadBooks().catch(() => ({}));
    const linkId = String(process.env.ACCOUNTING_SHEET_LINK_ID || "").trim();
    const urlOf = (year) => { const id = linkId || map[year] || accountingSheetId(); return id ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit` : null; };
    return open.map((r) => ({ id: r.id, payer: plain(r.payer) || plain(r.client) || "Unknown payer", client: plain(r.client),
      amount: (Number(r.amount) || 0) / 100, refunded: (Number(r.refunded) || 0) / 100, feeKept: !!r.feeKept, year: Number(r.year) || null, row: Number(r.row) || null, day: str(r.day, 10), url: urlOf(Number(r.year)) }))
      .sort((a, b) => (a.day < b.day ? 1 : -1));
  } catch (err) {
    console.error("auto-log: refunds unavailable", err?.message || err);
    return [];
  }
}
// A Founder marks one handled (merged into the one row, so two at once both stay). -> false when it isn't an open refund
export async function markRefundHandled(id, by) {
  const open = await openRefunds();
  if (!open.some((r) => r.id === id)) return false;
  await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${HANDLED_KEY}, jsonb_build_object(${id}::text, jsonb_build_object('by', ${str(by)}::text, 'at', now())), now())
    ON CONFLICT (key) DO UPDATE SET value = app_state.value || EXCLUDED.value, updated_at = now()`;
  return true;
}

// ---------------------------------------------------------------- the run
// -> { off } | { skipped } | { error } | { logged, toLog?, refunds?, more?, note?, alarm?, error? }. Throws only what the database throws taking the lease.
// source "daily" (the cron: any time the lease is free) or "page" (autoLogSoon: also at most once every SOON_MIN minutes). post: a test's fake ClickUp.
export async function runAutoLog({ now = new Date(), source = "daily", preview = PREVIEW, batch = AUTO_BATCH, post = null } = {}) {
  if (!logWritesOn()) return { off: "writes off" };
  if (preview) return { off: "preview" };
  if (!accountingSheetId()) return { off: "no sheet" };
  if (!(await autoLogState()).on) return { off: "switch off" };
  const holder = await takeRun({ soon: source === "page" });
  if (!holder) return { skipped: source === "page" ? "ran recently" : "busy" };
  try { return await runHeld({ now, batch, post }); } finally { await giveRun(holder); }
}

async function runHeld({ now, batch, post }) {
  const got = await autoPayments({ now, batch });
  if (got.error) return { error: got.error };
  let out = null, error = null;
  if (got.ids.length) {
    // refused before anything was written (Stripe or the sheet couldn't be read, the lock busy): the next run tries again, the switch stays on
    try { out = await logPaymentsByBook({ ids: got.ids, auto: true, by: AUTO_BY, now }); } catch (err) { error = err?.message || "Couldn't log the payments just now."; }
  }
  const failed = (out?.skipped || []).filter((s) => s.failed);
  const why = out?.alarm || out?.error || (failed.length ? failed[0].reason : "");
  if (why) { try { await setAutoLog(false, "the job", why); } catch (err) { console.error("auto-log: couldn't turn the switch off", err?.message || err); } }
  const alarm = why ? `${why} Auto-log turned itself off.` : "";
  const byPay = new Map((got.pay.list || []).map((p) => [p.id, p]));
  // the ones the write's own fresh read couldn't place after all (plan's need) join autoPayments'
  const needs = [...got.needs, ...(out?.skipped || []).filter((s) => s.need && byPay.has(s.id)).map((s) => ({ p: byPay.get(s.id), need: s.need }))];
  let tracked = [], refunds = [];
  try { tracked = await trackedRows(now); refunds = await refundsOf({ tracked, list: got.pay.list || [] }); } catch (err) { console.error("auto-log: the refund check failed", err?.message || err); }
  const told = await tell({ now, got, byPay, logged: out?.logged || [], needs, tracked, refunds, alarm, post });
  const res = { logged: out?.logged?.length || 0 };
  if (told.toLog) res.toLog = told.toLog;
  if (told.refunds) res.refunds = told.refunds;
  if (got.more) res.more = got.more;
  if (told.note) res.note = told.note;
  if (alarm) res.alarm = alarm;
  if (error) res.error = error;
  return res;
}

// What's new to tell, told once: the rows it added (this run's, with what the sheet worked out; and any Auto-log row of the last CATCHUP_DAYS whose note didn't go
// out), the payments it can't place, the refunds since. Marked before the post and unmarked if the post fails (the next run tells them); a post the gate holds
// back (ClickUp switched off for the site) stays marked: nobody can be told, and the pages wouldn't stop asking.
async function tell({ now, got, byPay, logged, needs, tracked, refunds, alarm, post }) {
  const notes = await readNotes();
  const was = JSON.stringify(notes);
  const day = nyDay(now);
  const said = (id, k) => !!notes.said[id]?.[k];
  const nameOf = got.nameOf || (() => ({ client: null }));
  const L = new Map();
  for (const x of logged) {
    if (said(x.id, "logged")) continue;
    const p = byPay.get(x.id);
    L.set(x.id, { id: x.id, day: x.day, payer: p?.payerName || "", client: x.client, amount: Math.round(Number(x.amount) * 100), year: Number(String(x.day).slice(0, 4)), row: x.row, split: x.split || null });
  }
  const since = daysAgo(now, CATCHUP_DAYS).getTime();
  const rowsOf = new Map((got.acct?.rows || []).map((r) => [r.row, r]));
  for (const e of tracked) {
    if (L.has(e.payment_id) || said(e.payment_id, "logged") || !(Date.parse(e.logged_at) >= since)) continue;
    const p = byPay.get(e.payment_id), r = rowsOf.get(Number(e.sheet_row)), year = Number(String(e.day).slice(0, 4));
    const split = r && year === Number(got.acct?.year) && personKey(r.client) === personKey(e.client) ? { manager: r.manager, managerShare: r.managerShare, defied: r.defiedShare } : null;
    L.set(e.payment_id, { id: e.payment_id, day: String(e.day), payer: p?.payerName || "", client: e.client || "", amount: Number(e.amount_cents) || 0, year, row: Number(e.sheet_row) || null, split });
  }
  const N = new Map();
  for (const { p, need } of needs) {
    if (!p || N.has(p.id) || L.has(p.id) || said(p.id, "need") || said(p.id, "logged") || isTestPay(p)) continue;
    N.set(p.id, { id: p.id, day: nyDay(p.at), payer: p.payerName || "", client: nameOf(p)?.client || "", amount: p.amount, need });
  }
  const R = refunds.filter((r) => !notes.refunds[r.id]);
  // a refund told once: a later, bigger refund of the same payment only updates its To do row
  for (const r of refunds) if (notes.refunds[r.id] && r.refunded > (Number(notes.refunds[r.id].refunded) || 0)) notes.refunds[r.id] = { ...notes.refunds[r.id], refunded: r.refunded, feeKept: r.feeKept };
  const text = noteText({ logged: [...L.values()], needs: [...N.values()], refunds: R, alarm });
  const counts = { toLog: N.size, refunds: R.length };
  if (!text) { if (JSON.stringify(notes) !== was) await writeNotes(notes, now); return { ...counts, note: null }; }
  for (const id of L.keys()) notes.said[id] = { ...notes.said[id], logged: day };
  for (const id of N.keys()) notes.said[id] = { ...notes.said[id], need: day };
  for (const r of R) notes.refunds[r.id] = { ...r, told: day };
  await writeNotes(notes, now);
  const sent = await postNote(text, { post });
  if (sent.failed) {
    try { await writeNotes(normalizeNotes(JSON.parse(was)), now); } catch (err) { console.error("auto-log: couldn't take back what the note would have told", err?.message || err); }
    return { ...counts, note: "failed" };
  }
  return { ...counts, note: sent.posted ? "posted" : `not sent (${sent.skipped})` };
}

// ---------------------------------------------------------------- when Home or Money's data loads
// Server-side, from what the page just read (its `match`; none given: the shared read, lib/money.js moneyState): when a payment is waiting that no note has
// told yet, a run (behind the lease, at most once every SOON_MIN minutes), so a payment is logged within minutes of being seen, with no new cron. Nothing
// waiting: one SQL, nothing else. Never throws.
export async function autoLogSoon({ match, now = new Date(), preview = PREVIEW, post = null } = {}) {
  try {
    if (!logWritesOn() || preview || !accountingSheetId()) return { off: true };
    if (match === undefined) match = (await moneyState()).match;
    if (!match?.unlogged) return { off: true };
    const rows = await sql`SELECT key, value, updated_at FROM app_state WHERE key IN (${AUTO_KEY}, ${NOTES_KEY}, ${RUN_KEY})`;
    const val = (k) => rows.find((r) => r.key === k);
    if (!normalizeAutoLog(val(AUTO_KEY)?.value).on) return { off: true };
    const ran = val(RUN_KEY)?.updated_at;
    if (ran && toMs(now) - new Date(ran).getTime() < SOON_MIN * 60000) return { skipped: "ran recently" };
    const said = normalizeNotes(val(NOTES_KEY)?.value).said;
    const fresh = match.unlogged.filter((p) => p && !isTestPay(p) && !p.direct && p.amount > 0 && !said[p.id]?.need && !said[p.id]?.logged);
    if (!fresh.length) return { idle: true };
    return await runAutoLog({ now, source: "page", preview, post });
  } catch (err) {
    console.error("auto-log: the run on a page load failed", err?.message || err);
    return { error: err?.message || "failed" };
  }
}

// ---------------------------------------------------------------- Home's "Logged N today"
// Midnight in New York on `now`'s New York day, as a Date (05:00 UTC in winter, 04:00 in summer)
export function nyMidnight(now = new Date()) {
  const day = nyDay(now);
  for (const off of ["-05:00", "-04:00"]) {
    const t = new Date(`${day}T00:00:00${off}`);
    if (nyDay(t) === day && nyDay(new Date(t.getTime() - 1)) !== day) return t;
  }
  return new Date(`${day}T00:00:00-05:00`);
}
// the rows Auto-log added since midnight in New York. Never throws (0).
export async function loggedToday(now = new Date()) {
  try {
    const [r] = await sql`SELECT count(*)::int AS n FROM accounting_log WHERE by_name = ${AUTO_BY} AND status = 'done' AND logged_at >= ${nyMidnight(now).toISOString()}`;
    return Number(r?.n) || 0;
  } catch (err) {
    console.error("auto-log: today's count unavailable", err?.message || err);
    return 0;
  }
}
