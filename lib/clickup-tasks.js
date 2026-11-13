// ClickUp tasks on the Dashboard: the open tasks of Internal Tasks (default), Pub Tasks, A&R Tasks and
// the five MGMT lists, read with the same Defied Bot token as lib/clickup.js (To do lists them all).
// Plus the tasks the dashboard keeps by itself: "Log new payments" and one per area (Publishing,
// A&R, Money) whose checklist ticks itself as the dashboard's own to-dos get done. The planners
// are pure; the writers only ever touch the one task id each keeps in app_state, plus To do's Done ✓
// and New task, and only when CLICKUP_TASK_WRITES is "on" (off by default, read at call time). Server-only.
import { sql } from "./db";
import { offText } from "./preview";
import { personKey } from "./names";

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
// (2026-11-11) a staff login's own MGMT list, by its first name ("Magnus" -> Mag MGMT); null when it has none
const MGMT_OF = { devin: "devin", ella: "ella", hank: "hank", mag: "mag", magnus: "mag", jordan: "jordan" };
export const mgmtListOf = (name) => MGMT_OF[personKey(String(name ?? "").trim().split(/\s+/)[0])] || null;
export const WORKSPACE_ID = "90141502305";
// Devin Waxman's ClickUp user: the tasks the dashboard keeps are assigned to him, so they're in his "Assigned to me"
export const ASSIGNEE_ID = 228272890;
export const listUrl = (id) => `https://app.clickup.com/${WORKSPACE_ID}/v/li/${id}`;
const keyOfList = (id) => Object.keys(LISTS).find((k) => LISTS[k].id === String(id)) || null;
const LIST_IDS = new Set(Object.values(LISTS).map((l) => l.id));
// as H.2 names them; ClickUp matches status names without caring about case
export const OPEN_STATUS = "TO DO";
export const DONE_STATUS = "COMPLETE";
export const DASHBOARD_URL = "https://www.defiedmgmt.com/dashboard";
export const STATE_KEYS = { payments: "clickupPaymentsTask",
  "area:publishing": "clickupArea:publishing", "area:ar": "clickupArea:ar", "area:money": "clickupArea:money" };
const NY = "America/New_York";
const CACHE_MS = 2 * 60 * 1000;
// a slow or hung ClickUp gives up after this, so it can't hold up /api/home or Log it; a create waits
// longer, since one ClickUp took but answered late would be made again on the next run
const TIMEOUT_MS = 8000, CREATE_TIMEOUT_MS = 20000;

const token = () => process.env.CLICKUP_API_TOKEN || "";
// "on", "On " or "ON" all count (a value pasted into Vercel can carry a space or a capital)
export const writesOn = () => String(process.env.CLICKUP_TASK_WRITES).trim().toLowerCase() === "on";

// (2026-11-13, owner: reloading the Dashboard 2-3 times broke To do, Home and Sync) ClickUp lets this token make 100
// calls a minute and a load made about 35. After a 429 nothing is asked until ClickUp's own reset (X-RateLimit-Reset,
// unix seconds), here and, through app_state, in the server's other copies; the last answer shows meanwhile (allTasks).
const COOL_KEY = "clickupCooldown";
let coolUntil = 0;
const resetAt = (res) => {
  const at = Number(res.headers?.get?.("x-ratelimit-reset")) * 1000;
  return at > Date.now() ? Math.min(at, Date.now() + 2 * 60 * 1000) : Date.now() + 60 * 1000;
};
async function clickup(method, path, body) {
  if (Date.now() < coolUntil) { const e = new Error("ClickUp 429 (waiting for its reset)"); e.status = 429; e.ecode = null; e.reason = null; throw e; }
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: token(), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(method === "POST" ? CREATE_TIMEOUT_MS : TIMEOUT_MS),
  });
  if (!res.ok) {
    if (res.status === 429) { coolUntil = resetAt(res); await saveState(COOL_KEY, { until: coolUntil }).catch(() => {}); }
    const e = new Error(`ClickUp ${res.status}`); e.status = res.status;
    // ClickUp's own code ("ACCESS_065": the token can't see that space; "ACCESS_066": that folder) and its words
    try { const j = await res.json(); e.ecode = j?.ECODE || null; e.reason = j?.err || null; } catch { e.ecode = null; e.reason = null; }
    throw e;
  }
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

// A list the Defied Bot token isn't shared on: ClickUp answers its tasks with 200 and none at all (even with
// include_closed), so it would look empty. Only GET /list/{id} tells: 401 ACCESS_065 (the space isn't shared)
// or ACCESS_066 (the folder isn't). So each list's access is read first and a list the bot can't see says so,
// by name, instead of showing nothing (r10, C2). (2026-11-13) Kept 30 minutes in app_state, shared by the server's
// copies (it was 10 minutes, each copy its own: 8 calls a load); To do's "Check again" reads every list's again: the
// one call for the tasks leaves a list the bot can no longer see out without a word, so only this read says so.
export const noAccessText = (name) => `Defied Bot can't see ${name}. Share it with Defied Bot in ClickUp.`;
const ACCESS_MS = 6 * 60 * 60 * 1000, LIST_ACCESS_MS = 30 * 60 * 1000;
const ACCESS_KEY = "clickupAccess";
let accessMem = {}; // listId -> { at, ok, statuses | ecode }
export const isNoAccess = (err) => err?.status === 401 && /^ACCESS_/.test(String(err.ecode || ""));
// ClickUp answers GET /task for a task it doesn't have (deleted, or never there) with 401 OAUTH_023/OAUTH_027
// "Team(s) not authorized", never 404. The same codes mean the token lost the workspace, so a task only counts
// as gone while the list it lived in still reads.
const notThere = (err) => err?.status === 404 || (err?.status === 401 && /^OAUTH_02[37]$/.test(String(err.ecode || "")));
async function taskGone(err, listId, { orHidden = false } = {}) {
  if (!notThere(err) && !(orHidden && isNoAccess(err))) return false;
  try { await clickup("GET", `/list/${listId}`); return true; } catch { return false; }
}
// a 4xx is ClickUp saying no (a person not on that list, a bad field), not ClickUp being down: said as it is
const refusedText = (err) => (err?.status >= 400 && err.status < 500 && err.status !== 429 ? `ClickUp refused this: ${err.reason || err.ecode || `error ${err.status}`}` : null);
async function readAccess(listId) {
  try {
    const r = await clickup("GET", `/list/${listId}`);
    return { at: Date.now(), ok: true, statuses: r.statuses || [] };
  } catch (err) {
    if (isNoAccess(err)) return { at: Date.now(), ok: false, ecode: err.ecode };
    return null; // couldn't tell (ClickUp down or busy): asked again next time; the tasks read says so on its own
  }
}
// these lists' access: { [listId]: { ok: true | false | null, … } }. all: every list's is read again (Check again,
// or a list unshared since it was kept)
async function accessOf(ids, { all = false } = {}) {
  const fresh = (x) => !all && !!x && Date.now() - x.at < LIST_ACCESS_MS;
  if (!ids.every((id) => fresh(accessMem[id]))) {
    const kept = (await readState(ACCESS_KEY).catch(() => null)) || {};
    for (const [id, x] of Object.entries(kept)) if (x?.at && !(accessMem[id]?.at >= x.at)) accessMem[id] = x;
    const need = ids.filter((id) => !fresh(accessMem[id]));
    const got = await Promise.all(need.map(readAccess));
    need.forEach((id, i) => { if (got[i]) accessMem[id] = got[i]; });
    if (got.some(Boolean)) await saveState(ACCESS_KEY, accessMem).catch((err) => console.error("clickup access not kept:", err));
  }
  return Object.fromEntries(ids.map((id) => [id, accessMem[id] || { ok: null }]));
}

const cache = new Map(); // `${listId}|${statuses}` -> { at, data }
export async function listTasks(listId = LISTS.internal.id, { statuses = [] } = {}) {
  if (!LIST_IDS.has(String(listId))) return { error: "That ClickUp list isn't on the dashboard." };
  if (!token()) return { error: "Couldn't reach ClickUp" };
  const key = `${listId}|${statuses.join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const access = (await accessOf([String(listId)]))[String(listId)];
  if (access.ok === false) {
    const list = Object.values(LISTS).find((l) => l.id === String(listId));
    return { error: noAccessText(list.name), noAccess: true };
  }
  try {
    const qs = new URLSearchParams({ archived: "false", subtasks: "true", order_by: "due_date" });
    for (const s of statuses) qs.append("statuses[]", s);
    const r = await clickup("GET", `/list/${listId}/task?${qs}`);
    const list = Object.values(LISTS).find((l) => l.id === String(listId));
    const data = { list: { id: list.id, name: list.name }, tasks: (r.tasks || []).map(taskRow) };
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (err) {
    if (isNoAccess(err)) return { error: noAccessText(Object.values(LISTS).find((l) => l.id === String(listId)).name), noAccess: true };
    console.error("listTasks failed:", err);
    return { error: "Couldn't reach ClickUp" };
  }
}
// after Done ✓ or New task: the next read asks ClickUp again, here and in the shared copy (allTasks). Awaited by the
// callers: a write left running after the answer may never land on Vercel, and To do's next load would show the
// done task again for up to 90 seconds
export async function clearTaskCache() {
  cache.clear();
  await sql`UPDATE app_state SET value = value || '{"expired": true}'::jsonb WHERE key = ${OPEN_KEY}`.catch(() => {});
}
// (tests) this copy's memory of each list's access and the people; the copies kept in app_state stay
export function clearAccessCache() { accessMem = {}; peopleMem = null; }

// Every dashboard list's open tasks at once (To do, Home, the Sync check): { at, lists: [{ key, id, name, url, count |
// error }], tasks }, plus stale: true when ClickUp said to wait (429) and this is its last answer, from `at`.
// (2026-11-13) ONE call for every list the bot can see (GET /team/{id}/task?list_ids[]=…, a page per 100 tasks; it was
// two calls a list), kept 90 seconds in app_state (clickupOpen) and shared: by every request in that time, in any of
// the server's copies, and by two that land at once in the same copy (openRun: /api/tasks and /api/sync do).
// fresh (To do's Check again): skips the kept copy and reads every list's access again. A list the bot can't see
// says so on its own; the rest still show.
const OPEN_KEY = "clickupOpen", OPEN_MS = 90 * 1000;
let openRun = null;
const downAll = (error) => ({ lists: Object.keys(LISTS).map((k) => ({ key: k, id: LISTS[k].id, name: LISTS[k].name, url: listUrl(LISTS[k].id), error })), tasks: [] });
export async function allTasks({ fresh = false } = {}) {
  if (!token()) return downAll("Couldn't reach ClickUp");
  const [snap, cool] = await Promise.all([readState(OPEN_KEY).catch(() => null), readState(COOL_KEY).catch(() => null)]);
  coolUntil = Math.max(coolUntil, Number(cool?.until) || 0);
  if (snap?.lists && !snap.expired && !fresh && Date.now() - Date.parse(snap.at) < OPEN_MS) return snap;
  if (Date.now() < coolUntil) return snap?.lists ? { ...snap, stale: true } : downAll("Couldn't reach ClickUp");
  if (!openRun) openRun = readOpen(fresh, snap).finally(() => { openRun = null; });
  return openRun;
}
// every page of the open tasks on these lists (never an empty list_ids: ClickUp would answer the whole workspace)
async function teamTasks(listIds) {
  const out = [];
  for (let page = 0; listIds.length && page < 10; page++) {
    const qs = new URLSearchParams({ subtasks: "true", include_closed: "false", order_by: "due_date", page: String(page) });
    for (const id of listIds) qs.append("list_ids[]", id);
    const r = await clickup("GET", `/team/${WORKSPACE_ID}/task?${qs}`);
    out.push(...(r.tasks || []));
    if ((r.tasks || []).length < 100 || r.last_page === true) break;
  }
  return out.filter((t) => LIST_IDS.has(String(t.list?.id))).map(taskRow);
}
// ClickUp answering the one call "not found" (a workspace or plan without that route): each list's own read, as before
async function listByList(listIds) {
  const out = [];
  for (const id of listIds) {
    const r = await clickup("GET", `/list/${id}/task?${new URLSearchParams({ archived: "false", subtasks: "true", order_by: "due_date" })}`);
    out.push(...(r.tasks || []));
  }
  return out.filter((t) => LIST_IDS.has(String(t.list?.id))).map(taskRow);
}
const openTasks = (ids) => teamTasks(ids).catch((err) => { if (err?.status !== 404) throw err; return listByList(ids); });
async function readOpen(fresh, snap) {
  const keys = Object.keys(LISTS), ids = keys.map((k) => LISTS[k].id);
  const seen = (a) => ids.filter((id) => a[id].ok !== false);
  try {
    let access = await accessOf(ids, { all: fresh }), rows;
    try { rows = await openTasks(seen(access)); } catch (err) {
      if (!isNoAccess(err)) throw err;
      access = await accessOf(ids, { all: true }); // a list unshared since its access was kept: every list's again, once
      rows = await openTasks(seen(access));
    }
    const open = rows.filter((t) => !t.done);
    const lists = keys.map((k) => ({ key: k, id: LISTS[k].id, name: LISTS[k].name, url: listUrl(LISTS[k].id),
      ...(access[LISTS[k].id].ok === false ? { error: noAccessText(LISTS[k].name), noAccess: true } : { count: open.filter((t) => t.list === k).length }) }));
    const out = { at: new Date().toISOString(), lists, tasks: keys.flatMap((k) => open.filter((t) => t.list === k)) };
    await saveState(OPEN_KEY, out).catch((err) => console.error("clickup tasks not kept:", err));
    return out;
  } catch (err) {
    console.error("allTasks failed:", err);
    return err?.status === 429 && snap?.lists ? { ...snap, stale: true } : downAll("Couldn't reach ClickUp");
  }
}

// The workspace's people (New task's assignee picker): [{ id, name, initials }]. Kept 6 hours in app_state (the lists'
// access 30 minutes; 2026-11-13: it was 2 calls each copy every 10 minutes); fresh (Check again) reads them again.
// ClickUp not answering: the last ones kept.
const PEOPLE_KEY = "clickupMembers";
let peopleMem = null;
export async function members({ fresh = false } = {}) {
  if (!fresh && peopleMem && Date.now() - peopleMem.at < ACCESS_MS) return peopleMem.data;
  if (!token()) return [];
  const kept = (await readState(PEOPLE_KEY).catch(() => null)) || peopleMem;
  if (!fresh && kept?.data && Date.now() - kept.at < ACCESS_MS) { peopleMem = kept; return kept.data; }
  try {
    // the token's own user (Defied Bot) is a member too, but nobody assigns it work: left out (r10). If
    // ClickUp won't say who the token is, everyone stays.
    const [r, me] = await Promise.all([clickup("GET", "/team"), clickup("GET", "/user").catch(() => null)]);
    const team = (r.teams || []).find((x) => String(x.id) === WORKSPACE_ID) || null;
    const self = me?.user?.id;
    const data = (team?.members || []).map((m) => m.user).filter((u) => u && u.id != null && u.id !== self).map((u) => ({ id: u.id, name: u.username || u.email || initials(u), initials: initials(u) }));
    peopleMem = { at: Date.now(), data };
    await saveState(PEOPLE_KEY, peopleMem).catch((err) => console.error("clickup people not kept:", err));
    return data;
  } catch (err) {
    console.error("members failed:", err);
    return kept?.data || [];
  }
}

// a list's own "done" status: the first one ClickUp calls closed (the MGMT lists may not say COMPLETE)
const doneCache = new Map();
async function doneStatusFor(listId) {
  if (doneCache.has(listId)) return doneCache.get(listId);
  const known = accessMem[listId];
  const statuses = known?.ok && known.statuses.length ? known.statuses : (await clickup("GET", `/list/${listId}`)).statuses || [];
  const st = statuses.find((x) => x.type === "closed") || statuses.find((x) => x.type === "done");
  const name = st?.status || DONE_STATUS;
  doneCache.set(listId, name);
  return name;
}

const WRITES_OFF = offText("Writing to ClickUp isn't switched on yet.");
// To do's Done ✓: only a task on one of the dashboard's lists, set to that list's closed status
// listId: only a task on that list (My to-do: the login's own list)
export async function markTaskDone(taskId, { listId = null } = {}) {
  if (!writesOn()) return { error: WRITES_OFF, off: true };
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(String(taskId || ""))) return { error: "That isn't a ClickUp task." };
  try {
    const t = await clickup("GET", `/task/${taskId}`);
    if (!LIST_IDS.has(String(t.list?.id))) return { error: "That task isn't on one of the dashboard's lists." };
    if (listId && String(t.list?.id) !== String(listId)) return { error: "That task isn't on your list." };
    if (t.status?.type === "closed" || t.status?.type === "done") { await clearTaskCache(); return { done: taskId, already: true }; }
    await clickup("PUT", `/task/${taskId}`, { status: await doneStatusFor(String(t.list.id)) });
    await clearTaskCache();
    return { done: taskId };
  } catch (err) {
    // (the task's list is unknown here: Internal Tasks reading fine says the token still has the workspace)
    if (await taskGone(err, LISTS.internal.id)) { await clearTaskCache(); return { error: "That task was deleted in ClickUp." }; }
    console.error("markTaskDone failed:", err);
    return { error: refusedText(err) || "Couldn't reach ClickUp. Try again in a minute." };
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
    await clearTaskCache();
    return { created: { ...taskRow(t), list: input.list } };
  } catch (err) {
    console.error("createUserTask failed:", err);
    return { error: refusedText(err) || "Couldn't reach ClickUp. Try again in a minute." };
  }
}

// --- planning (pure) -------------------------------------------------------------------
const nyParts = (d) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: NY, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).map((p) => [p.type, p.value]));
const usd = (c) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDate = (t) => { const p = nyParts(new Date(typeof t === "number" && t < 1e11 ? t * 1000 : t)); return `${Number(p.month)}/${Number(p.day)}`; };
const isOpen = (state) => !!(state?.taskId && state.open);

// The Stripe payments the accounting sheet doesn't have yet ([{ id, at, client, amount }], cents)
// as one "Log new payments" task: created when the first comes in, updated as more do, completed
// when every listed one is in the sheet. The next unlogged payment starts a fresh one; one closed by
// hand stays closed until a payment it didn't list comes in (closedSig).
// liveName: the open task's name in ClickUp right now (run() reads it), so a new wording renames it once.
// A payment logged while the task is open stays on its checklist, ticked (state.items keeps them).
// A test payment says so, as To do does (lib/money.js forTask sets test)
const payLabel = (p) => `${shortDate(p.at)} · ${p.client || p.payerName || "Unknown payer"} · ${usd(p.amount)}${p.test ? " (test)" : ""}`;
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
    // To do's "N payments to log" row, opened (/dashboard/todo/log: placeOf in components/dash/StaffDashboard.jsx)
    `[Open the payments to log](${DASHBOARD_URL}/todo/log)`,
  ].join("\n");
  const sig = unlogged.map((p) => p.id).sort().join("|");
  const keep = items.map(({ id, label, done }) => ({ id, label, done }));
  if (isOpen(state)) {
    // closed under a name that says so, not the last count ("…: 1 unlogged ($10.00 paid)")
    if (n === 0) { const done = "Log new payments: all logged"; return { action: "complete", taskId: state.taskId, name: done, markdown, next: { ...state, open: false, count: 0, name: done, items: keep } }; }
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

// One self-updating task per area (r7): the dashboard's own to-dos for that area ([{ id, label, n? }],
// lib/area-tasks.js: To do's rows of that area) as a checklist. Created when the first one appears, updated as
// they change, each ticked once it's done (it stays listed, ticked), completed at zero. One closed by hand stays
// closed until a to-do it didn't list appears, or one's count (n) goes above what it was when closed: "Update 9
// songs" after "Update 8" is new, "Update 7" isn't (closedSig: id + words, for a line with no count).
// A line { id, keep: true } is one this run didn't read (a sheet not read after an action, or a read that
// failed): it stays as it was, and so does every "<id>:…" line. Each area's task lives in its own ClickUp
// list (list); todo is its To do area, which the task's link opens.
export const AREA_TASKS = {
  publishing: { title: "Publishing", list: "pub", todo: "roster", tag: "dashboard", what: "publishing jobs (splits, songs to update, ISRCs, sheet tabs, the Luminate update, the pub sheet sync)" },
  ar: { title: "A&R", list: "ar", todo: "ar", tag: "dashboard", what: "A&R jobs (Watchlist artists' Spotify to confirm)" },
  // Money's payments to log are the "Log new payments" task; this one is the rest of Money's To do rows
  money: { title: "Money", list: "internal", todo: "money", tag: "finance", what: "money jobs besides the payments to log (Income rows to check, the INFO tab vs the site)" },
};
const itemSig = (xs) => xs.map((x) => `${x.id}:${x.label}`).join("|");
const line = (x) => ({ id: String(x.id), label: String(x.label), done: false, ...(x.n != null ? { n: Number(x.n) } : {}) });
export function areaTaskName(area, open) {
  const A = AREA_TASKS[area];
  return open.length === 1 ? `${A.title}: ${open[0].label}` : `${A.title}: ${open.length} things to do`;
}
export function planAreaTask({ area, items = [], state = null, liveName = null }) {
  const A = AREA_TASKS[area];
  if (!A) throw new Error(`unknown area ${area}`);
  const was = Array.isArray(state?.items) ? state.items : [];
  const unread = items.filter((x) => x.keep).map((x) => String(x.id));
  const keep = (id) => unread.some((k) => id === k || id.startsWith(`${k}:`));
  const open = [...items.filter((x) => !x.keep).map(line), ...was.filter((x) => !x.done && keep(x.id)).map(line)];
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
    `[Open To do](${DASHBOARD_URL}/todo/${A.todo})`,
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
  const counts = new Map(was.filter((x) => !x.done && x.n != null).map((x) => [x.id, x.n]));
  const fresh = (x) => (x.n != null && counts.has(x.id) ? x.n > counts.get(x.id) : !seen.has(`${x.id}:${x.label}`));
  if (seen.size && !open.some(fresh)) return { action: "none", next: state };
  return { action: "create", listKey: A.list, name, markdown, tags: [A.tag], next: { taskId: null, open: true, listKey: A.list, ...next } };
}

// --- writing (one task per kind, and only with CLICKUP_TASK_WRITES=on) -------------------------
const readState = async (key) => (await sql`SELECT value FROM app_state WHERE key = ${key}`)[0]?.value ?? null;
const saveState = async (key, value) => {
  await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${key}, ${JSON.stringify(value)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
};
const plain = (md) => md.replace(/^- \[ \] /gm, "• ").replace(/^- \[x\] /gm, "✓ ").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1: $2");

// Each writer takes the kind ("payments" | "area:<area>"), never a task id: the id comes
// from app_state. An area's task goes in its own list (plan.listKey), the others in Internal Tasks.
export async function createTask(kind, plan) {
  if (!writesOn()) return { skipped: "writes off" };
  const key = STATE_KEYS[kind];
  const state = await readState(key);
  if (isOpen(state)) return { skipped: "already open", taskId: state.taskId };
  const t = await clickup("POST", `/list/${(LISTS[plan.listKey] || LISTS.internal).id}/task`, {
    name: plan.name, markdown_content: plan.markdown, description: plain(plan.markdown), status: OPEN_STATUS,
    tags: plan.tags || [], assignees: [ASSIGNEE_ID], ...(plan.due ? { due_date: plan.due, due_date_time: false } : {}),
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
  await clickup("PUT", `/task/${state.taskId}`, { status: await closedStatus(state.listKey), ...(plan.name ? { name: plan.name } : {}), ...(plan.markdown ? { markdown_content: plan.markdown, description: plain(plan.markdown) } : {}) });
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
// A task someone closed or archived in ClickUp by hand counts as done (closedSig: the next one starts with a
// to-do it didn't list). One deleted there, or moved where Defied Bot can't see it, is gone: nothing in ClickUp
// shows its to-dos any more, so a fresh one starts with what's open now.
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
        if (t.archived === true || t.status?.type === "closed" || t.status?.type === "done" || String(t.status?.status).toLowerCase() === DONE_STATUS.toLowerCase()) state = { ...state, open: false, closedSig: state.openSig ?? state.sig };
      } catch (err) {
        if (!(await taskGone(err, (LISTS[state.listKey] || LISTS.internal).id, { orHidden: true }))) throw err;
        state = { ...state, open: false, closedSig: "" };
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
export const runPaymentsTask = ({ unlogged }) => run("payments", (state, liveName) => planPaymentsTask({ unlogged, state, liveName }));
export const runAreaTask = (area, items) => run(`area:${area}`, (state, liveName) => planAreaTask({ area, items, state, liveName }));
// the tasks the dashboard keeps itself: To do leaves them out of ClickUp's list (it lists their to-dos
// already) and names the open ones once, in its "Done for you" line
export async function ownTasks() {
  const rows = await sql`SELECT key, value FROM app_state WHERE key = ANY(${Object.values(STATE_KEYS)})`.catch(() => []);
  const kindOf = Object.fromEntries(Object.entries(STATE_KEYS).map(([k, v]) => [v, k]));
  return rows.filter((r) => r.value?.taskId).map((r) => ({ kind: kindOf[r.key] || r.key, taskId: r.value.taskId, open: !!r.value.open, name: r.value.name || null, count: r.value.count ?? null,
    url: r.value.url || `https://app.clickup.com/t/${r.value.taskId}` }));
}
export const ownTaskIds = async () => (await ownTasks()).map((t) => t.taskId);
