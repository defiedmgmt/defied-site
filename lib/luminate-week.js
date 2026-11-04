// The weekly "Luminate update" ClickUp task: one line per portfolio, ticked as its file for the week
// lands (dropped on the dashboard or sent by the Mac helper), closed by itself once they're all in.
// Created on the Luminate day (LUMINATE_WEEKDAY, else CLICKUP_SYNC_WEEKDAY, Monday = 1, New York)
// only while something is still missing: a week the helper finished before the cron ran asks nothing.
// The planner is pure; the writer touches only the one task id it keeps in app_state, and only with
// CLICKUP_TASK_WRITES=on (read at call time, off by default). Server-only.
import { sql } from "./db";
import { LISTS, OPEN_STATUS, DONE_STATUS, DASHBOARD_URL, writesOn } from "./clickup-tasks";
import { KNOWN_PORTFOLIOS, portfolioName, isAR } from "./luminate";

export const STATE_KEY = "clickupLuminateWeek";
const API = "https://api.clickup.com/api/v2";
const NY = "America/New_York";
const DAY = 864e5;

// the day in New York (YYYY-MM-DD) and its weekday (0 = Sunday)
const nyDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: NY, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const weekdayOf = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
// the first day of the Luminate week holding `now`: the latest Luminate day on or before it
export function weekStart(now = new Date(), weekday = 1) {
  const today = nyDay(now);
  return addDays(today, -((weekdayOf(today) - Number(weekday) + 7) % 7));
}
export const luminateWeekday = () => Number(process.env.LUMINATE_WEEKDAY || process.env.CLICKUP_SYNC_WEEKDAY || 1);
const monthDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const when = (at) => new Date(at).toLocaleString("en-US", { timeZone: NY, weekday: "short", hour: "numeric", minute: "2-digit" });

// portfolios: [{ id: POR…, name }] in the order the task lists them; newest: { POR…: ISO of its newest
// file's export } (Luminate's own time, from the file name). A portfolio is in for the week when its
// newest file was made on or after the week's first day (New York). Returns { action, name, markdown, next }.
export function planLuminateWeek({ portfolios = [], newest = {}, state = null, now = new Date(), weekday = 1 }) {
  const week = weekStart(now, weekday);
  const items = portfolios.map((p) => ({ ...p, at: newest[p.id] && nyDay(new Date(newest[p.id])) >= week ? newest[p.id] : null }));
  const left = items.filter((x) => !x.at).length, n = items.length;
  const name = `Luminate update: ${n - left} of ${n} portfolios in (week of ${monthDay(week)})`;
  const markdown = [
    "Export each portfolio with 1 week and Worldwide. The Mac helper sends each file in as it lands in Downloads (or drop them on the dashboard); this task ticks them off and closes itself when all are in.",
    "",
    ...items.map((x) => (x.at ? `- [x] ${x.name} (in ${when(x.at)})` : `- [ ] ${x.name}`)),
    "",
    `[Open the Luminate page](${DASHBOARD_URL}#luminate)`,
  ].join("\n");
  const sig = `${week}|${items.map((x) => `${x.id}:${x.at ? 1 : 0}`).join(",")}`;
  const next = { ...(state || {}), week, sig, left };
  const open = !!(state?.taskId && state.open);
  if (!n) return { action: "none", next: state };
  if (open) {
    if (!left) return { action: "complete", taskId: state.taskId, name, markdown, next: { ...next, open: false } };
    if (state.sig === sig) return { action: "none", taskId: state.taskId, next: state };
    return { action: "update", taskId: state.taskId, name, markdown, next };
  }
  // one task a week: not when everything's in, and not again in a week whose task was closed (by itself or by hand)
  if (!left || state?.week === week) return { action: "none", next: state };
  return { action: "create", name, markdown, due: Date.parse(`${addDays(week, 1)}T21:00:00Z`), next: { ...next, open: true } };
}

// The portfolios the week is about and each one's newest file: the clients' (on the Luminate page) and
// the A&R ones (the owner's two, and any kept from a drop)
export async function luminateWeekInputs() {
  const [roster, exportsAt, heldAt] = await Promise.all([
    sql`SELECT luminate_id, name FROM luminate_portfolios WHERE luminate_id IS NOT NULL AND kind = 'roster' ORDER BY sort, created_at`,
    sql`SELECT portfolio_id, max(exported_at) AS at FROM luminate_exports GROUP BY portfolio_id`,
    sql`SELECT portfolio_id, max(exported_at) AS at FROM luminate_ar_held GROUP BY portfolio_id`,
  ]);
  const list = new Map();
  for (const r of roster) list.set(r.luminate_id, portfolioName(r.luminate_id, r.name));
  // the owner's four always (the clients' two first), then any other kept from a drop
  for (const [id, k] of Object.entries(KNOWN_PORTFOLIOS)) if (!isAR(k.area) && !list.has(id)) list.set(id, k.name);
  for (const [id, k] of Object.entries(KNOWN_PORTFOLIOS)) if (isAR(k.area)) list.set(id, k.name);
  for (const h of heldAt) if (!list.has(h.portfolio_id)) list.set(h.portfolio_id, portfolioName(h.portfolio_id, `A&R …${String(h.portfolio_id).slice(-4)}`));
  const newest = {};
  for (const r of [...exportsAt, ...heldAt]) if (r.at) newest[r.portfolio_id] = new Date(r.at).toISOString();
  return { portfolios: [...list].map(([id, name]) => ({ id, name })), newest };
}

async function clickup(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { Authorization: process.env.CLICKUP_API_TOKEN || "", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) { const e = new Error(`ClickUp ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}
const readState = async () => (await sql`SELECT value FROM app_state WHERE key = ${STATE_KEY}`)[0]?.value ?? null;
const saveState = (value) => sql`INSERT INTO app_state (key, value, updated_at) VALUES (${STATE_KEY}, ${JSON.stringify(value)}, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
const plain = (md) => md.replace(/^- \[x\] /gm, "✓ ").replace(/^- \[ \] /gm, "• ").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1: $2");

// Plan and write in one go: after a drop, after each helper upload, and from the daily cron. A task
// someone closed or deleted in ClickUp counts as done for its week. Never throws.
export async function runLuminateWeek({ now = new Date(), weekday = luminateWeekday() } = {}) {
  if (!writesOn()) return { skipped: "writes off" };
  try {
    let state = await readState();
    if (state?.taskId && state.open) {
      try {
        const t = await clickup("GET", `/task/${state.taskId}`);
        if (t.status?.type === "closed" || t.status?.type === "done" || String(t.status?.status).toLowerCase() === DONE_STATUS.toLowerCase()) state = { ...state, open: false };
      } catch (err) {
        if (err.status !== 404) throw err;
        state = { ...state, open: false };
      }
      if (!state.open) await saveState(state);
    }
    const plan = planLuminateWeek({ ...(await luminateWeekInputs()), state, now, weekday });
    if (plan.action === "create") {
      const t = await clickup("POST", `/list/${LISTS.internal.id}/task`, {
        name: plan.name, markdown_content: plan.markdown, description: plain(plan.markdown), status: OPEN_STATUS, tags: ["luminate"], due_date: plan.due, due_date_time: false,
      });
      await saveState({ ...plan.next, taskId: t.id, url: t.url || null });
      return { action: "create", created: t.id };
    }
    if (plan.action === "update" || plan.action === "complete") {
      await clickup("PUT", `/task/${plan.taskId}`, { name: plan.name, markdown_content: plan.markdown, description: plain(plan.markdown), ...(plan.action === "complete" ? { status: DONE_STATUS } : {}) });
      await saveState({ ...plan.next, taskId: plan.taskId });
      return { action: plan.action, taskId: plan.taskId };
    }
    return { action: "none" };
  } catch (err) {
    console.error("luminate week task failed:", err);
    return { error: "Couldn't reach ClickUp" };
  }
}
