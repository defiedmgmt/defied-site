// (2026-11-26) Auto-log: the daily job (pages/api/cron/daily.js) adds the SURE Stripe payments to the accounting sheet's Income tab by itself, exactly as
// Log it would (lib/accounting-log.js logPayments: the same claims, ledger lock, formula guard, read-back and "Log new payments" update; its rows carry
// Source / Notes "Stripe · via <manager> · <short id>" and accounting_log.by_name "Auto-log"). What "sure" means is lib/accounting-place.js sureOf.
// The Founders' switch, in app_state "autoLog" { on, by, at, offWhy?, offAt? }, is OFF until a Founder turns it on (Money's To log head). A run writes
// nothing unless ACCOUNTING_SHEET_WRITES=on and never on a preview; more than AUTO_MAX sure payments at once are held for a person (nothing written).
// A write that went wrong (a formula that changed, rows that may or may not have landed, a row the sheet didn't take) turns the switch off by itself and is
// told to the founders by the daily alert (lib/alerts.js dailyFailures). A read that failed (Google's quota, Stripe) writes nothing and tries again tomorrow.
// Server-only.
import { sql } from "./db";
import { logWritesOn, logPayments, surePayments } from "./accounting-log";
import { accountingSheetId } from "./accounting";
import { nyDay } from "./stripe";
import { PREVIEW } from "./preview";

export const AUTO_KEY = "autoLog";
export const AUTO_BY = "Auto-log";
export const AUTO_MAX = 10;
const str = (v, n = 80) => String(v ?? "").slice(0, n);

// { on, by, at, offWhy, offAt }: offWhy only while it is off because the job turned it off
export function normalizeAutoLog(v) {
  const o = v && typeof v === "object" && !Array.isArray(v) ? v : {};
  const on = o.on === true;
  return { on, by: str(o.by), at: str(o.at, 40), offWhy: on ? "" : str(o.offWhy, 600), offAt: on ? "" : str(o.offAt, 40) };
}
// never throws: a store that can't be read is "off"
export async function autoLogState() {
  try {
    const [r] = await sql`SELECT value FROM app_state WHERE key = ${AUTO_KEY}`;
    return normalizeAutoLog(r?.value);
  } catch (err) {
    console.error("auto-log: state unavailable", err?.message || err);
    return normalizeAutoLog(null);
  }
}
// A Founder's switch (why empty), or the job turning it off (why = what went wrong). One flat value, written whole.
export async function setAutoLog(on, by, why = "") {
  const at = new Date().toISOString();
  const value = on ? { on: true, by: str(by), at } : { on: false, by: str(by), at, ...(why ? { offWhy: str(why, 600), offAt: at } : {}) };
  await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${AUTO_KEY}, ${JSON.stringify(value)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  return normalizeAutoLog(value);
}

// The daily run. -> { off } | { error } | { held: n } | { logged, skipped? } (+ alarm when it turned the switch off). Throws only what logPayments
// can't say itself (the caller's try); a read that failed comes back as { error } with the switch left on.
export async function runAutoLog({ now = new Date(), max = AUTO_MAX, preview = PREVIEW } = {}) {
  if (!logWritesOn()) return { off: "writes off" };
  if (preview) return { off: "preview" };
  if (!accountingSheetId()) return { off: "no sheet" };
  if (!(await autoLogState()).on) return { off: "switch off" };
  const sure = await surePayments({ now, max });
  if (sure.error) return { error: sure.error };
  if (!sure.ids.length) return { logged: 0 };
  // a flood is a person's call: nothing is written, To log keeps them all
  if (sure.ids.length > max) return { held: sure.ids.length };
  let out;
  try { out = await logPayments({ ids: sure.ids, auto: true, by: AUTO_BY, now }); } catch (err) {
    // refused before anything was written (Stripe or the sheet couldn't be read, logging switched off): tomorrow tries again
    return { error: err?.message || "Couldn't log the sure payments." };
  }
  const failed = out.skipped.filter((s) => s.failed);
  const why = out.alarm || out.error || (failed.length ? failed[0].reason : "");
  const res = { logged: out.logged.length, ...(out.skipped.length ? { skipped: out.skipped.length } : {}) };
  if (!why) return res;
  try { await setAutoLog(false, "the job", why); } catch (err) { console.error("auto-log: couldn't turn the switch off", err?.message || err); }
  return { ...res, alarm: `${why} Auto-log turned itself off.` };
}

// Midnight in New York on `now`'s New York day, as a Date (05:00 UTC in winter, 04:00 in summer)
export function nyMidnight(now = new Date()) {
  const day = nyDay(now);
  for (const off of ["-05:00", "-04:00"]) {
    const t = new Date(`${day}T00:00:00${off}`);
    if (nyDay(t) === day && nyDay(new Date(t.getTime() - 1)) !== day) return t;
  }
  return new Date(`${day}T00:00:00-05:00`);
}
// Home's "Logged N today": the rows Auto-log added since midnight in New York. Never throws (0).
export async function loggedToday(now = new Date()) {
  try {
    const [r] = await sql`SELECT count(*)::int AS n FROM accounting_log WHERE by_name = ${AUTO_BY} AND status = 'done' AND logged_at >= ${nyMidnight(now).toISOString()}`;
    return Number(r?.n) || 0;
  } catch (err) {
    console.error("auto-log: today's count unavailable", err?.message || err);
    return 0;
  }
}
