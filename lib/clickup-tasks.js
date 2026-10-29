// ClickUp tasks on the Dashboard: the open tasks of Internal Tasks (default), Pub Tasks and A&R Tasks,
// read with the same Defied Bot token as lib/clickup.js. Plus the two tasks the dashboard keeps in
// Internal Tasks by itself: the weekly "clear the sync tasks" one and the recurring "Log new
// payments" one. The planners are pure; the writers only ever touch the one task id each keeps in
// app_state, and only when CLICKUP_TASK_WRITES is "on" (off by default). Server-only.
import { sql } from "./db";

const API = "https://api.clickup.com/api/v2";
export const LISTS = {
  internal: { id: "901419028091", name: "Internal Tasks" },
  pub: { id: "901419028039", name: "Pub Tasks" },
  ar: { id: "901419003548", name: "A&R Tasks" },
};
const LIST_IDS = new Set(Object.values(LISTS).map((l) => l.id));
// as H.2 names them; ClickUp matches status names without caring about case
export const OPEN_STATUS = "TO DO";
export const DONE_STATUS = "COMPLETE";
export const DASHBOARD_URL = "https://www.defiedmgmt.com/dashboard";
export const STATE_KEYS = { weeklySync: "clickupWeeklySync", payments: "clickupPaymentsTask" };
const NY = "America/New_York";
const CACHE_MS = 2 * 60 * 1000;

const token = () => process.env.CLICKUP_API_TOKEN || "";
export const writesOn = () => process.env.CLICKUP_TASK_WRITES === "on";

async function clickup(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: token(), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) { const e = new Error(`ClickUp ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}

// --- reading -------------------------------------------------------------------------
const initials = (u) => (u.initials || String(u.username || u.email || "?").split(/[\s._@-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("")).toUpperCase();
export function taskRow(t) {
  return {
    id: t.id,
    name: t.name,
    status: t.status?.status || "",
    statusColor: t.status?.color || null,
    done: t.status?.type === "closed" || t.status?.type === "done",
    assignees: (t.assignees || []).map(initials),
    due: t.due_date ? new Date(Number(t.due_date)).toISOString() : null,
    priority: t.priority?.priority || null, // "urgent" | "high" | "normal" | "low"
    tags: (t.tags || []).map((x) => x.name),
    url: t.url || `https://app.clickup.com/t/${t.id}`,
  };
}

const cache = new Map(); // `${listId}|${statuses}` -> { at, data }
export async function listTasks(listId = LISTS.internal.id, { statuses = [] } = {}) {
  if (!LIST_IDS.has(String(listId))) return { error: "That ClickUp list isn't on the dashboard." };
  if (!token()) return { error: "Couldn't reach ClickUp" };
  const key = `${listId}|${statuses.join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  try {
    const qs = new URLSearchParams({ archived: "false", subtasks: "true", order_by: "due_date" });
    for (const s of statuses) qs.append("statuses[]", s);
    const r = await clickup("GET", `/list/${listId}/task?${qs}`);
    const list = Object.values(LISTS).find((l) => l.id === String(listId));
    const data = { list: { id: list.id, name: list.name }, tasks: (r.tasks || []).map(taskRow) };
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (err) {
    console.error("listTasks failed:", err);
    return { error: "Couldn't reach ClickUp" };
  }
}
export function clearTaskCache() { cache.clear(); }

// --- planning (pure) -------------------------------------------------------------------
const nyParts = (d) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: NY, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).map((p) => [p.type, p.value]));
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const usd = (c) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDate = (t) => { const p = nyParts(new Date(typeof t === "number" && t < 1e11 ? t * 1000 : t)); return `${Number(p.month)}/${Number(p.day)}`; };
const isOpen = (state) => !!(state?.taskId && state.open);

// The Dashboard's sync tasks ([{ id, label, count }]) as one weekly ClickUp task. Created on the
// chosen weekday (Monday = 1, New York) when there's something to clear and no task is open; kept
// up to date while open; completed once they reach zero. Returns the next state to save after the write.
export function planWeeklySync({ syncTasks = [], state = null, now = new Date(), weekday = 1 }) {
  const n = syncTasks.reduce((s, t) => s + (Number(t.count) || 1), 0);
  const p = nyParts(now);
  const today = `${p.year}-${p.month}-${p.day}`;
  const name = `Weekly dashboard sync: ${n} thing${n === 1 ? "" : "s"} to clear`;
  const markdown = [
    "The dashboard has syncing jobs waiting. Clear them on the dashboard; this task closes itself when they're done.",
    "",
    // (each label already says how many)
    ...syncTasks.map((t) => `- [ ] ${t.label}`),
    "",
    `[Open the dashboard](${DASHBOARD_URL})`,
  ].join("\n");
  const sig = syncTasks.map((t) => `${t.id || t.label}:${t.count || 1}`).join("|");
  if (isOpen(state)) {
    if (n === 0) return { action: "complete", taskId: state.taskId, next: { ...state, open: false, completedOn: today, count: 0 } };
    if (state.sig === sig) return { action: "none", taskId: state.taskId, next: state };
    return { action: "update", taskId: state.taskId, name, markdown, next: { ...state, sig, count: n } };
  }
  // once a week: not on other days, and not twice on the same day after the last one was closed
  if (n === 0 || WEEKDAYS.indexOf(p.weekday) !== Number(weekday) || state?.createdOn === today) return { action: "none", next: state };
  const due = new Date(now.getTime() + 2 * 864e5).getTime();
  return { action: "create", name, markdown, due, tags: [], next: { taskId: null, open: true, sig, count: n, createdOn: today } };
}

// The Stripe payments the accounting sheet doesn't have yet ([{ id, at, client, amount }], cents)
// as one "Log new payments" task: created when the first comes in, updated as more do, completed
// when every listed one is in the sheet. The next unlogged payment starts a fresh one; one closed by
// hand stays closed until a payment it didn't list comes in (closedSig).
export function planPaymentsTask({ unlogged = [], state = null }) {
  const n = unlogged.length;
  const total = unlogged.reduce((s, p) => s + p.amount, 0);
  const name = `Log new payments: ${n} unlogged (${usd(total)})`;
  const markdown = [
    "These Stripe payments aren't in the accounting sheet's Income tab yet. Log them from the dashboard's payments card (or by hand); this task closes itself once they're all in.",
    "",
    ...unlogged.map((p) => `- [ ] ${shortDate(p.at)} · ${p.client || p.payerName || "Unknown payer"} · ${usd(p.amount)}`),
    "",
    `[Open the payments card](${DASHBOARD_URL}#payments)`,
  ].join("\n");
  const sig = unlogged.map((p) => p.id).sort().join("|");
  if (isOpen(state)) {
    if (n === 0) return { action: "complete", taskId: state.taskId, next: { ...state, open: false, count: 0 } };
    if (state.sig === sig) return { action: "none", taskId: state.taskId, next: state };
    return { action: "update", taskId: state.taskId, name, markdown, next: { ...state, sig, count: n } };
  }
  if (n === 0) return { action: "none", next: state };
  const seen = new Set(String(state?.closedSig || "").split("|").filter(Boolean));
  if (seen.size && unlogged.every((p) => seen.has(p.id))) return { action: "none", next: state };
  return { action: "create", name, markdown, tags: ["finance"], next: { taskId: null, open: true, sig, count: n } };
}

// --- writing (one task per kind, and only with CLICKUP_TASK_WRITES=on) -------------------------
const readState = async (key) => (await sql`SELECT value FROM app_state WHERE key = ${key}`)[0]?.value ?? null;
const saveState = async (key, value) => {
  await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${key}, ${JSON.stringify(value)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
};
const plain = (md) => md.replace(/^- \[ \] /gm, "• ").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1: $2");

// Each writer takes the kind ("weeklySync" | "payments"), never a task id: the id comes from app_state
export async function createTask(kind, plan) {
  if (!writesOn()) return { skipped: "writes off" };
  const key = STATE_KEYS[kind];
  const state = await readState(key);
  if (isOpen(state)) return { skipped: "already open", taskId: state.taskId };
  const t = await clickup("POST", `/list/${LISTS.internal.id}/task`, {
    name: plan.name, markdown_content: plan.markdown, description: plain(plan.markdown), status: OPEN_STATUS,
    tags: plan.tags || [], ...(plan.due ? { due_date: plan.due, due_date_time: false } : {}),
  });
  await saveState(key, { ...plan.next, taskId: t.id, open: true, url: t.url || null });
  return { created: t.id };
}
export async function updateTask(kind, plan) {
  if (!writesOn()) return { skipped: "writes off" };
  const key = STATE_KEYS[kind];
  const state = await readState(key);
  if (!isOpen(state)) return { skipped: "no open task" };
  await clickup("PUT", `/task/${state.taskId}`, { name: plan.name, markdown_content: plan.markdown, description: plain(plan.markdown) });
  await saveState(key, { ...plan.next, taskId: state.taskId, open: true });
  return { updated: state.taskId };
}
export async function completeTask(kind, plan = {}) {
  if (!writesOn()) return { skipped: "writes off" };
  const key = STATE_KEYS[kind];
  const state = await readState(key);
  if (!isOpen(state)) return { skipped: "no open task" };
  await clickup("PUT", `/task/${state.taskId}`, { status: DONE_STATUS });
  await saveState(key, { ...(plan.next || state), taskId: state.taskId, open: false });
  return { completed: state.taskId };
}

// Plan and apply in one go (the cron, or the Dashboard after loading payments). A task someone
// closed or deleted in ClickUp by hand counts as done, so the next one can start.
async function run(kind, planFor) {
  if (!writesOn()) return { skipped: "writes off" };
  try {
    const key = STATE_KEYS[kind];
    let state = await readState(key);
    if (isOpen(state)) {
      try {
        const t = await clickup("GET", `/task/${state.taskId}`);
        if (t.status?.type === "closed" || t.status?.type === "done" || String(t.status?.status).toLowerCase() === DONE_STATUS.toLowerCase()) state = { ...state, open: false, closedSig: state.sig };
      } catch (err) {
        if (err.status !== 404) throw err;
        state = { ...state, open: false, closedSig: state.sig };
      }
      if (!state.open) await saveState(key, state);
    }
    const plan = planFor(state);
    if (plan.action === "create") return { action: "create", ...(await createTask(kind, plan)) };
    if (plan.action === "update") return { action: "update", ...(await updateTask(kind, plan)) };
    if (plan.action === "complete") return { action: "complete", ...(await completeTask(kind, plan)) };
    return { action: "none" };
  } catch (err) {
    console.error(`clickup ${kind} task failed:`, err);
    return { error: "Couldn't reach ClickUp" };
  }
}
export const runWeeklySync = ({ syncTasks, now = new Date(), weekday = Number(process.env.CLICKUP_SYNC_WEEKDAY || 1) }) =>
  run("weeklySync", (state) => planWeeklySync({ syncTasks, state, now, weekday }));
export const runPaymentsTask = ({ unlogged }) => run("payments", (state) => planPaymentsTask({ unlogged, state }));
