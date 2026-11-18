// Job alerts (2026-11-17). A nightly or weekly job that fails tells the founders with ONE short ClickUp message instead of failing
// silently (Mon Nov 16: the personal weekly digest for devin@ failed, "No ClickUp member with …: set users.clickup_user_id.", and
// nobody knew). Server only.
//   alert({ job, step, error, now })  posts "⚠️ Site check · <job>: <step> failed (<short error>). …" to ClickUp chat. With an error, `step`
//     is the thing that failed ("the pub sheet sync"); without one it is the whole sentence ("hasn't run since …"). It never throws and
//     gives up after 5 seconds, so a cron that calls it is neither failed nor held up by it.
//   It posts only when ALERTS isn't off|false|0|no (unset: on), DIGEST_WRITES is on (the digest's own "may write to ClickUp" switch) and
//     there is a token and a channel (ALERT_CHANNEL_ID, else DIGEST_CHANNEL_ID). Otherwise the message is only logged (console.error).
//   One message per job + step per New York day: app_state "alertsSent" { "<day>|<job>|<step>": true }, kept for 14 days and claimed in
//     ONE statement, so two runs failing at once can't both post. A post that doesn't go through gives its claim back, so the next run
//     (the digest's second Monday cron, tomorrow's nightly) tries again. A store that can't be read doesn't stop it: better twice than never.
//   alertDaily(report) is what pages/api/cron/daily.js calls once its report is saved: each step the report says went wrong, and two
//     watchdogs: the data refresh that hasn't run for 26 hours, and the Monday digest that didn't post.
// The ClickUp post is lib/digest.js's own (postTo), loaded only when something is sent: that file reads the whole dashboard's code, and
// the crons shouldn't pay for it on a night nothing failed (nor should a check that only reads a table need it, hence mondayOf below).
import { sql } from "./db";
import { getState } from "./app-state";

export const ALERTS_KEY = "alertsSent";
export const WHOLE_RUN = "the whole run";
// alert() gives up after totalMs; the ClickUp post inside it after postMs (tests make both short)
export const limits = { totalMs: 5000, postMs: 4000 };
const KEEP_DAYS = 14, MAX_ERROR = 200, STALE_HOURS = 26;

const on = (v) => /^(on|true|1|yes)$/i.test(String(v ?? "").trim());
const off = (v) => /^(off|false|0|no)$/i.test(String(v ?? "").trim());
const channelOf = (env = process.env) => String(env.ALERT_CHANNEL_ID || "").trim() || String(env.DIGEST_CHANNEL_ID || "").trim();

// "" when an alert may be posted, else why not: "off", "writes off", "no token" or "no channel"
export function alertGate(env = process.env) {
  if (off(env.ALERTS)) return "off";
  if (!on(env.DIGEST_WRITES)) return "writes off";
  if (!String(env.CLICKUP_API_TOKEN || "").trim()) return "no token";
  if (!channelOf(env)) return "no channel";
  return "";
}
export const WHY = { off: "alerts are switched off (ALERTS)", "writes off": "DIGEST_WRITES isn't on", "no token": "CLICKUP_API_TOKEN isn't set", "no channel": "neither ALERT_CHANNEL_ID nor DIGEST_CHANNEL_ID is set" };

// ---------------------------------------------------------------- New York time
const nyDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(d)); // 2026-11-17
export const nyWhen = (d) => new Date(d).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).replace(/\u202f/g, " "); // Mon, Nov 16, 9:00 AM (newer ICU puts a thin space before AM)
function nyClock(now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { weekday: p.weekday, hour: Number(p.hour) };
}
const shiftDay = (day, n) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// the Monday (New York) of the week `now` is in: lib/digest.js digestWeek, which digest_runs.week holds (the test checks they agree)
const mondayOf = (now) => shiftDay(nyDay(now), -({ Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[nyClock(now).weekday] || 0));

// ---------------------------------------------------------------- the message
// The error as a short line anyone may read: no token, key, password or link with one in it (an exact secret from the environment, a Bearer
// header, token=…, a URL with its path and query cut to the host, the usual key shapes, any long opaque string), one line, ~200 characters
const SECRET_NAME = /TOKEN|SECRET|KEY|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|DATABASE_URL/i;
export function scrub(text, max = MAX_ERROR) {
  let s = String(text ?? "").slice(0, 2000);
  for (const [k, v] of Object.entries(process.env)) if (SECRET_NAME.test(k) && String(v || "").trim().length >= 8) s = s.split(String(v).trim()).join("<hidden>");
  s = s
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, "<hidden>")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)\]]+/gi, (u) => { try { const x = new URL(u); return `${x.protocol}//${x.host}/…`; } catch { return "<link>"; } })
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 <hidden>")
    .replace(/\b(token|access_token|api[_-]?key|key|secret|password|passwd|pwd|auth|authorization|signature|sig)(["']?\s*[=:]\s*["']?)[^\s"'&,;)]+/gi, "$1$2<hidden>")
    .replace(/\b(?:sk|rk|pk|whsec)_[A-Za-z0-9_]{12,}|\bAIza[0-9A-Za-z_-]{20,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.?[A-Za-z0-9_-]*|\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}/g, "<hidden>")
    .replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
const hasError = (e) => e !== undefined && e !== null && e !== false;
const AGAIN = { "Daily update": "tomorrow", "Data refresh": "tomorrow", "Data collect": "tomorrow" };
// Pure. A daily step that failed says the rest of the night ran (each step is in its own try); the whole run says nothing of the sort
export function alertText({ job, step, error } = {}) {
  job = String(job || "A job"); step = String(step || "its run");
  const why = hasError(error) ? scrub(typeof error === "string" ? error : error?.message || String(error)) : "";
  const what = hasError(error) ? `${step} failed${why ? ` (${why})` : ""}` : step;
  const rest = job === "Daily update" && step !== WHOLE_RUN && hasError(error) ? " Everything else ran." : "";
  return `⚠️ Site check · ${job}: ${what}.${rest} It tries again ${AGAIN[job] || "at its next run"}.`;
}

// ---------------------------------------------------------------- sending
const keyOf = (day, job, step) => `${day}|${String(job).replace(/\|/g, "/")}|${String(step).replace(/\|/g, "/")}`.replace(/\s+/g, " ").slice(0, 200);
// the day's claim, in one statement: this key added to what's kept (the last 14 New York days) unless it is there already -> true when it's ours
async function claim(k, now) {
  const cutoff = shiftDay(nyDay(now), -(KEEP_DAYS - 1));
  const rows = await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${ALERTS_KEY}, jsonb_build_object(${k}::text, true), now())
    ON CONFLICT (key) DO UPDATE SET value = COALESCE((SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(app_state.value) e WHERE left(e.key, 10) >= ${cutoff}::text), '{}'::jsonb) || EXCLUDED.value, updated_at = now()
    WHERE app_state.value -> ${k}::text IS NULL RETURNING key`;
  return rows.length > 0;
}
const release = (k) => sql`UPDATE app_state SET value = value - ${k}::text, updated_at = now() WHERE key = ${ALERTS_KEY}`;

// the whole send; never rejects
async function send(text, { job, step, now }) {
  try {
    const gate = alertGate();
    if (gate) { console.error(`alert not sent (${WHY[gate]}):`, text); return { skipped: gate }; }
    const k = keyOf(nyDay(now), job, step);
    let held = false;
    try {
      if (!(await claim(k, now))) return { skipped: "already sent today" };
      held = true;
    } catch (err) { console.error("alert: couldn't tell whether it went out today, sending anyway:", scrub(err?.message || err)); }
    try {
      const { postTo } = await import("./digest");
      await postTo(channelOf(), text, { timeoutMs: limits.postMs });
      return { posted: true };
    } catch (err) {
      console.error("alert: the ClickUp post failed:", scrub(err?.message || err), "|", text);
      if (held) await release(k).catch(() => {});
      return { failed: scrub(err?.message || err) };
    }
  } catch (err) { console.error("alert failed:", scrub(err?.message || err)); return { failed: scrub(err?.message || err) }; }
}
// the work's answer, or `late` if it takes longer than ms (the work never rejects: what is left of it finishes or fails on its own)
function within(ms, work, late) {
  let timer;
  return Promise.race([work, new Promise((resolve) => { timer = setTimeout(() => resolve(late), ms); })]).finally(() => clearTimeout(timer));
}

// -> { posted: true } | { skipped: "off" | "writes off" | "no token" | "no channel" | "already sent today" } | { failed: why }
export async function alert({ job, step, error, now = new Date() } = {}) {
  try {
    const text = alertText({ job, step, error });
    const out = await within(limits.totalMs, send(text, { job: String(job || "A job"), step: String(step || "its run"), now }), { failed: "timed out" });
    if (out.failed === "timed out") console.error("alert: gave up waiting:", text);
    return out;
  } catch (err) { console.error("alert failed:", scrub(err?.message || err)); return { failed: "error" }; }
}

// ---------------------------------------------------------------- the nightly run
// Pure. The steps of pages/api/cron/daily.js that went wrong, in the run's order: [{ step, error }]. Each is its own try, with the error kept
// in the report as <name>Error; three also report a failure inside what they return (the auto-add stops at its first problem, the managers
// and the people link say what they couldn't read), and those count too, once per step.
export function dailyFailures(report = {}) {
  const A = report.autoAdd;
  const added = A?.error ? `"${A.error.song}" (${A.error.client}) stopped at ${A.error.step}: ${A.error.error}` : A?.alarm || undefined;
  const steps = [
    ["the empty-rows check on the pub sheet", report.rowsError],
    ["adding new releases", report.autoAddError ?? added],
    ["the pub sheet sync", report.syncError],
    ["the ISRC lookup", report.isrcError],
    ["the Deezer refresh", report.deezerError],
    ["reading the managers off the accounting sheet", report.managersError ?? report.managers?.error],
    ["linking people across the site and the sheets", report.peopleError ?? report.people?.error],
    ["the ClickUp tasks update", report.clickupTasksError],
  ];
  return steps.filter(([, error]) => hasError(error)).map(([step, error]) => ({ step, error }));
}

// "" while the data cron's last run (app_state "cronData", .at) is no more than `hours` old, or there is no record of one; else when it was
export function staleSince(at, now = new Date(), hours = STALE_HOURS) {
  const t = Date.parse(at);
  if (!Number.isFinite(t) || new Date(now).getTime() - t <= hours * 3600000) return "";
  return nyWhen(t);
}
// The Monday digest's window (8:00 to 11:59 New York time, lib/digest.js dueNow) is over: Monday from noon, and Tuesday. The daily cron
// runs about 9 AM New York time, so on a Monday it never sees noon: in practice this is Tuesday's run, once, and not a reminder every day
export function digestOverdue(now = new Date()) {
  const { weekday, hour } = nyClock(now);
  return (weekday === "Mon" && hour >= 12) || weekday === "Tue";
}

async function dataWatch(now) {
  try {
    const since = staleSince((await getState("cronData"))?.at, now);
    if (since) await alert({ job: "Data refresh", step: `hasn't run since ${since}`, now });
  } catch (err) { console.error("alerts: the data refresh check failed:", scrub(err?.message || err)); }
}
async function digestWatch(now) {
  try {
    if (!on(process.env.DIGEST_WRITES) || !digestOverdue(now)) return; // writes off: every row is "off" on purpose
    const [row] = await sql`SELECT status FROM digest_runs WHERE week = ${mondayOf(now)} AND kind = 'team'`;
    if (row?.status !== "sent") await alert({ job: "Weekly digest", step: "didn't post this week", now });
  } catch (err) { console.error("alerts: the digest check failed:", scrub(err?.message || err)); }
}
export const watchdogs = ({ now = new Date() } = {}) => Promise.all([dataWatch(now), digestWatch(now)]);

// What pages/api/cron/daily.js calls once its report is saved. Never throws and costs the run 8 seconds at the very most
export async function alertDaily(report, { now = new Date() } = {}) {
  try {
    await within(limits.totalMs + 3000, Promise.all([...dailyFailures(report).map((f) => alert({ job: "Daily update", ...f, now })), watchdogs({ now })]), null);
  } catch (err) { console.error("alerts: the nightly check failed:", scrub(err?.message || err)); }
}

// ---------------------------------------------------------------- what was sent (Site › Sync)
// state: app_state "alertsSent". -> the last `days` New York days' alerts, newest first: [{ day, job, step }]
export function recentAlerts(state, now = new Date(), days = 7) {
  const from = shiftDay(nyDay(now), -(days - 1));
  return Object.keys(state && typeof state === "object" ? state : {})
    .map((k) => { const [day, job, ...rest] = k.split("|"); return { day, job, step: rest.join("|") }; })
    .filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a.day) && a.day >= from)
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : `${a.job}|${a.step}`.localeCompare(`${b.job}|${b.step}`)));
}
