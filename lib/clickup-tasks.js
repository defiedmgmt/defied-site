// ClickUp tasks on the Dashboard: the open tasks of Internal Tasks (default), Pub Tasks, A&R Tasks and
// the five MGMT lists, read with the same Defied Bot token as lib/clickup.js (To do lists them all).
// Plus the tasks the dashboard keeps by itself: "Log new payments" and one per area (Luminate,
// Publishing, A&R) whose checklist ticks itself as the dashboard's own to-dos get done. The planners
// are pure; the writers only ever touch the one task id each keeps in app_state, plus To do's Done ✓
// and New task, and only when CLICKUP_TASK_WRITES is "on" (off by default, read at call time). Server-only.
import { sql } from "./db";

const API = "https://api.clickup.com/api/v2";
export const LISTS = {
  internal: { id: "901419028091", name: "Internal Tasks" },
  pub: { id: "901419028039", name: "Pub Tasks" },
  ar: { id: "901419003548", name: "A&R Tasks" },
  // Space Management (addendum H.2): one list per manager
  devin: { id: "901419028185", name: "Devin MGMT" },
  ella: { id: "901419028319", name: "Ella MGMT" },
  hank: { id: "901419028280", name: "Hank MGMT" },
  mag: { id: "901419028303", name: "Mag MGMT" },
  jordan: { id: "901419028352", name: "Jordan MGMT" },
};
export const WORKSPACE_ID = "90141502305";
export const listUrl = (id) => `https://app.clickup.com/${WORKSPACE_ID}/v/li/${id}`;
const keyOfList = (id) => Object.keys(LISTS).find((k) => LISTS[k].id === String(id)) || null;
const LIST_IDS = new Set(Object.values(LISTS).map((l) => l.id));
// as H.2 names them; ClickUp matches status names without caring about case
export const OPEN_STATUS = "TO DO";
export const DONE_STATUS = "COMPLETE";
export const DASHBOARD_URL = "https://www.defiedmgmt.com/dashboard";
export const STATE_KEYS = { weeklySync: "clickupWeeklySync", payments: "clickupPaymentsTask",
  "area:luminate": "clickupArea:luminate", "area:publishing": "clickupArea:publishing", "area:ar": "clickupArea:ar" };
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
    // the people, for To do's person filter (ids, names and initials only: no emails leave the server)
    people: (t.assignees || []).map((u) => ({ id: u.id, name: u.username || initials(u), initials: initials(u) })),
    list: keyOfList(t.list?.id),
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

// Every dashboard list's open tasks at once (To do): { lists: [{ key, id, name, url, count | error }], tasks }.
// One list that can't be read says so on its own; the rest still show.
export async function allTasks() {
  const keys = Object.keys(LISTS);
  const rs = await Promise.all(keys.map((k) => listTasks(LISTS[k].id)));
  const lists = keys.map((k, i) => ({ key: k, id: LISTS[k].id, name: LISTS[k].name, url: listUrl(LISTS[k].id), ...(rs[i].error ? { error: rs[i].error } : { count: rs[i].tasks.filter((t) => !t.done).length }) }));
  const tasks = rs.flatMap((r, i) => (r.tasks || []).filter((t) => !t.done).map((t) => ({ ...t, list: keys[i] })));
  return { lists, tasks };
}

// The workspace's people (New task's assignee picker): [{ id, name, initials }]. Cached like the lists.
let peopleCache = null;
export async function members() {
  if (peopleCache && Date.now() - peopleCache.at < CACHE_MS * 5) return peopleCache.data;
  if (!token()) return [];
  try {
    const r = await clickup("GET", "/team");
    const team = (r.teams || []).find((x) => String(x.id) === WORKSPACE_ID) || null;
    const data = (team?.members || []).map((m) => m.user).filter((u) => u && u.id != null).map((u) => ({ id: u.id, name: u.username || u.email || initials(u), initials: initials(u) }));
    peopleCache = { at: Date.now(), data };
    return data;
  } catch (err) {
    console.error("members failed:", err);
    return [];
  }
}

// a list's own "done" status: the first one ClickUp calls closed (the MGMT lists may not say COMPLETE)
const doneCache = new Map();
async function doneStatusFor(listId) {
  if (doneCache.has(listId)) return doneCache.get(listId);
  const r = await clickup("GET", `/list/${listId}`);
  const st = (r.statuses || []).find((x) => x.type === "closed") || (r.statuses || []).find((x) => x.type === "done");
  const name = st?.status || DONE_STATUS;
  doneCache.set(listId, name);
  return name;
}

const WRITES_OFF = "Writing to ClickUp isn't switched on yet.";
// To do's Done ✓: only a task on one of the dashboard's lists, set to that list's closed status
export async function markTaskDone(taskId) {
  if (!writesOn()) return { error: WRITES_OFF, off: true };
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(String(taskId || ""))) return { error: "That isn't a ClickUp task." };
  try {
    const t = await clickup("GET", `/task/${taskId}`);
    if (!LIST_IDS.has(String(t.list?.id))) return { error: "That task isn't on one of the dashboard's lists." };
    if (t.status?.type === "closed" || t.status?.type === "done") { clearTaskCache(); return { done: taskId, already: true }; }
    await clickup("PUT", `/task/${taskId}`, { status: await doneStatusFor(String(t.list.id)) });
    clearTaskCache();
    return { done: taskId };
  } catch (err) {
    if (err.status === 404) { clearTaskCache(); return { error: "That task was deleted in ClickUp." }; }
    console.error("markTaskDone failed:", err);
    return { error: "Couldn't reach ClickUp. Try again in a minute." };
  }
}

// To do's New task: a name, one of the dashboard's lists, an optional due day (YYYY-MM-DD, New York)
// and an optional assignee from the workspace. The list's own first status.
export function checkNewTask({ name, list, due, assignee } = {}, people = []) {
  const n = String(name ?? "").trim();
  if (!n) return { error: "Give the task a name." };
  if (n.length > 200) return { error: "That name is too long (200 characters at most)." };
  if (!LISTS[list]) return { error: "Pick one of the lists." };
  let dueMs = null;
  if (due) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(due)) || Number.isNaN(Date.parse(`${due}T12:00:00Z`))) return { error: "That due date isn't a date." };
    dueMs = Date.parse(`${due}T16:00:00Z`); // noon in New York, so the day reads the same everywhere
  }
  let who = null;
  if (assignee != null && assignee !== "") {
    who = people.find((p) => String(p.id) === String(assignee));
    if (!who) return { error: "That person isn't in the workspace." };
  }
  return { ok: { name: n, listId: LISTS[list].id, due: dueMs, assignee: who ? who.id : null } };
}
export async function createUserTask(input) {
  if (!writesOn()) return { error: WRITES_OFF, off: true };
  const v = checkNewTask(input, input?.assignee ? await members() : []);
  if (v.error) return v;
  try {
    const t = await clickup("POST", `/list/${v.ok.listId}/task`, {
      name: v.ok.name, ...(v.ok.assignee != null ? { assignees: [v.ok.assignee] } : {}),
      ...(v.ok.due ? { due_date: v.ok.due, due_date_time: false } : {}),
    });
    clearTaskCache();
    return { created: { ...taskRow(t), list: input.list } };
  } catch (err) {
    console.error("createUserTask failed:", err);
    return { error: "Couldn't reach ClickUp. Try again in a minute." };
  }
}

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
  // a detail line (the ISRCs of songs already counted as to add) adds no things of its own
  const n = syncTasks.reduce((s, t) => s + (t.detail ? 0 : Number(t.count) || 1), 0);
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
  // the label too: the stale line names the portfolio and its date, at a count of 1 either way
  const sig = syncTasks.map((t) => `${t.id || t.label}:${t.count || 1}:${t.label}`).join("|");
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
// liveName: the open task's name in ClickUp right now (run() reads it), so a new wording renames it once.
// A payment logged while the task is open stays on its checklist, ticked (state.items keeps them).
const payLabel = (p) => `${shortDate(p.at)} · ${p.client || p.payerName || "Unknown payer"} · ${usd(p.amount)}`;
const checklist = (items) => items.map((x) => `- [${x.done ? "x" : " "}] ${x.label}`);
export function planPaymentsTask({ unlogged = [], state = null, liveName = null }) {
  const n = unlogged.length;
  const total = unlogged.reduce((s, p) => s + p.amount, 0);
  const name = `Log new payments: ${n} unlogged (${usd(total)} paid)`;
  const now = unlogged.map((p) => ({ id: p.id, label: payLabel(p), done: false }));
  // while open: the ones listed before and logged since stay, ticked; new ones go at the end
  const items = isOpen(state) && Array.isArray(state.items)
    ? [...state.items.map((x) => now.find((y) => y.id === x.id) || { ...x, done: true }), ...now.filter((y) => !state.items.some((x) => x.id === y.id))]
    : now;
  const markdown = [
    "These Stripe payments aren't in the accounting sheet's Income tab yet. Log them from the dashboard's To do (or by hand); each one ticks itself once it's in, and this task closes itself when they all are.",
    "",
    ...checklist(items),
    "",
    `[Open the payments card](${DASHBOARD_URL}#payments)`,
  ].join("\n");
  const sig = unlogged.map((p) => p.id).sort().join("|");
  const keep = items.map(({ id, label, done }) => ({ id, label, done }));
  if (isOpen(state)) {
    if (n === 0) return { action: "complete", taskId: state.taskId, markdown, next: { ...state, open: false, count: 0, items: keep } };
    // the same payments under an older wording ("5 unlogged ($66.93)") still get the new name: one PUT,
    // only while the task's name (ClickUp's own, else the one we last wrote) differs
    const named = liveName ?? state.name;
    if (state.sig === sig && (named == null || named === name)) return { action: "none", taskId: state.taskId, next: state };
    return { action: "update", taskId: state.taskId, name, markdown, next: { ...state, sig, count: n, name, items: keep } };
  }
  if (n === 0) return { action: "none", next: state };
  const seen = new Set(String(state?.closedSig || "").split("|").filter(Boolean));
  if (seen.size && unlogged.every((p) => seen.has(p.id))) return { action: "none", next: state };
  return { action: "create", name, markdown, tags: ["finance"], next: { taskId: null, open: true, sig, count: n, name, items: keep } };
}

// One self-updating task per area (r7): the dashboard's own to-dos for that area ([{ id, label }],
// lib/area-tasks.js) as a checklist. Created when the first one appears, updated as they change, each
// ticked once it's done (it stays listed, ticked), completed at zero. One closed by hand stays closed
// until a to-do it didn't list appears (closedSig: id + words, so "Add 4 songs" after "Add 3" is new).
// Each area's task lives in its own ClickUp list.
export const AREA_TASKS = {
  luminate: { title: "Luminate", list: "internal", what: "Luminate jobs" },
  publishing: { title: "Publishing", list: "pub", what: "publishing jobs (splits, songs to update, sheet tabs)" },
  ar: { title: "A&R", list: "ar", what: "A&R jobs" },
};
const itemSig = (xs) => xs.map((x) => `${x.id}:${x.label}`).join("|");
export function areaTaskName(area, open) {
  const A = AREA_TASKS[area];
  return open.length === 1 ? `${A.title}: ${open[0].label}` : `${A.title}: ${open.length} things to do`;
}
export function planAreaTask({ area, items = [], state = null, liveName = null }) {
  const A = AREA_TASKS[area];
  if (!A) throw new Error(`unknown area ${area}`);
  const open = items.map((x) => ({ id: String(x.id), label: String(x.label), done: false }));
  const n = open.length;
  const merged = isOpen(state) && Array.isArray(state.items)
    ? [...state.items.map((x) => open.find((y) => y.id === x.id) || { ...x, done: true }), ...open.filter((y) => !state.items.some((x) => x.id === y.id))]
    : open;
  const name = n ? areaTaskName(area, open) : `${A.title}: all done`;
  const markdown = [
    `The dashboard's ${A.what}. Each one ticks itself once it's done on the dashboard's To do; this task closes itself when they're all done.`,
    "",
    ...checklist(merged),
    "",
    `[Open To do](${DASHBOARD_URL}?tab=todo)`,
  ].join("\n");
  const sig = merged.map((x) => `${x.id}:${x.done ? 1 : 0}:${x.label}`).join("|");
  const next = { sig, openSig: itemSig(open), count: n, name, items: merged };
  if (isOpen(state)) {
    if (n === 0) return { action: "complete", taskId: state.taskId, name, markdown, next: { ...state, ...next, open: false, closedSig: "" } };
    const named = liveName ?? state.name;
    if (state.sig === sig && (named == null || named === name)) return { action: "none", taskId: state.taskId, next: state };
    return { action: "update", taskId: state.taskId, name, markdown, next: { ...state, ...next } };
  }
  if (n === 0) return { action: "none", next: state };
  const seen = new Set(String(state?.closedSig || "").split("|").filter(Boolean));
  if (seen.size && open.every((x) => seen.has(`${x.id}:${x.label}`))) return { action: "none", next: state };
  return { action: "create", listKey: A.list, name, markdown, tags: ["dashboard"], next: { taskId: null, open: true, listKey: A.list, ...next } };
}

// --- writing (one task per kind, and only with CLICKUP_TASK_WRITES=on) -------------------------
const readState = async (key) => (await sql`SELECT value FROM app_state WHERE key = ${key}`)[0]?.value ?? null;
const saveState = async (key, value) => {
  await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${key}, ${JSON.stringify(value)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
};
const plain = (md) => md.replace(/^- \[ \] /gm, "• ").replace(/^- \[x\] /gm, "✓ ").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1: $2");

// Each writer takes the kind ("weeklySync" | "payments" | "area:<area>"), never a task id: the id comes
// from app_state. An area's task goes in its own list (plan.listKey), the others in Internal Tasks.
export async function createTask(kind, plan) {
  if (!writesOn()) return { skipped: "writes off" };
  const key = STATE_KEYS[kind];
  const state = await readState(key);
  if (isOpen(state)) return { skipped: "already open", taskId: state.taskId };
  const t = await clickup("POST", `/list/${(LISTS[plan.listKey] || LISTS.internal).id}/task`, {
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
  // the last checklist (every line ticked) goes with the status, so the closed task shows what got done
  await clickup("PUT", `/task/${state.taskId}`, { status: await closedStatus(state.listKey), ...(plan.markdown ? { markdown_content: plan.markdown, description: plain(plan.markdown) } : {}) });
  await saveState(key, { ...(plan.next || state), taskId: state.taskId, open: false });
  return { completed: state.taskId };
}

// Internal Tasks says COMPLETE (H.2); another list's closed status is read from the list
const closedStatus = async (listKey) => (!listKey || listKey === "internal" ? DONE_STATUS : doneStatusFor(LISTS[listKey].id).catch(() => DONE_STATUS));
// one run per kind at a time (the cron, a Dashboard load and an action can overlap): claimed in one
// statement, let go at the end. A run that finds it claimed waits its turn (a few seconds at most), so
// the last one to start still writes what it saw; a claim older than a minute is a run that died.
async function claimKind(kind) {
  for (let i = 0; i < 50; i++) {
    const rows = await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${`clickupRun:${kind}`}, ${JSON.stringify({ at: new Date().toISOString() })}, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now() WHERE app_state.updated_at < now() - interval '1 minute' RETURNING key`;
    if (rows.length) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}
const releaseKind = (kind) => sql`DELETE FROM app_state WHERE key = ${`clickupRun:${kind}`}`.catch(() => {});

// Plan and apply in one go (the cron, a Dashboard load, or right after the action that changed it).
// A task someone closed or deleted in ClickUp by hand counts as done, so the next one can start.
async function run(kind, planFor) {
  if (!writesOn()) return { skipped: "writes off" };
  if (!(await claimKind(kind))) return { skipped: "already running" };
  try {
    const key = STATE_KEYS[kind];
    let state = await readState(key);
    let liveName = null; // the open task's name in ClickUp now
    if (isOpen(state)) {
      try {
        const t = await clickup("GET", `/task/${state.taskId}`);
        if (typeof t.name === "string") liveName = t.name;
        // (an area task's closedSig is what was still open: id + words; the payments task's, its ids)
        if (t.status?.type === "closed" || t.status?.type === "done" || String(t.status?.status).toLowerCase() === DONE_STATUS.toLowerCase()) state = { ...state, open: false, closedSig: state.openSig ?? state.sig };
      } catch (err) {
        if (err.status !== 404) throw err;
        state = { ...state, open: false, closedSig: state.openSig ?? state.sig };
      }
      if (!state.open) await saveState(key, state);
    }
    const plan = planFor(state, liveName);
    if (plan.action === "create") return { action: "create", ...(await createTask(kind, plan)) };
    if (plan.action === "update") return { action: "update", ...(await updateTask(kind, plan)) };
    if (plan.action === "complete") return { action: "complete", ...(await completeTask(kind, plan)) };
    return { action: "none" };
  } catch (err) {
    console.error(`clickup ${kind} task failed:`, err);
    return { error: "Couldn't reach ClickUp" };
  } finally { await releaseKind(kind); }
}
export const runWeeklySync = ({ syncTasks, now = new Date(), weekday = Number(process.env.CLICKUP_SYNC_WEEKDAY || 1) }) =>
  run("weeklySync", (state) => planWeeklySync({ syncTasks, state, now, weekday }));
export const runPaymentsTask = ({ unlogged }) => run("payments", (state, liveName) => planPaymentsTask({ unlogged, state, liveName }));
export const runAreaTask = (area, items) => run(`area:${area}`, (state, liveName) => planAreaTask({ area, items, state, liveName }));
// the ids of the tasks the dashboard keeps itself (To do lists their to-dos already, so it leaves them out)
export async function ownTaskIds() {
  const rows = await sql`SELECT value FROM app_state WHERE key = ANY(${Object.values(STATE_KEYS)})`.catch(() => []);
  return rows.map((r) => r.value?.taskId).filter(Boolean);
}
