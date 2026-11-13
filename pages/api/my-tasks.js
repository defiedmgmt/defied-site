// My to-do (2026-11-11, the owner: "each co manager should have a todo list section too on their profile but it
// should ONLY be linked up to the todo list section for them on clickup. they should be able to add and remove stuff
// through there and itll reflect"): a staff login's own ClickUp list and nothing else (lib/clickup-tasks.js
// mgmtListOf: Magnus -> Mag MGMT). GET = its open tasks (?fresh=1 skips the two-minute cache); POST
// {action:"create", name, due} adds one to it, {action:"done", id} sets one of its tasks to done. Writes only with
// CLICKUP_TASK_WRITES on, as To do's.
import { requireUser, requireSameOrigin } from "../../lib/session";
import { LISTS, listUrl, listTasks, mgmtListOf, markTaskDone, createUserTask, clearTaskCache, writesOn } from "../../lib/clickup-tasks";

export default async function handler(req, res) {
  const session = await requireUser(req, res);
  if (!session) return;
  if (session.user.role !== "staff") return res.status(403).json({ error: "Staff only." });
  const key = mgmtListOf(session.user.name);
  if (!key) return res.status(200).json({ none: true });
  const L = LISTS[key];
  try {
    if (req.method === "GET") {
      res.setHeader("Cache-Control", "no-store");
      if (req.query.fresh) await clearTaskCache();
      const r = await listTasks(L.id);
      const list = { key, name: L.name, url: listUrl(L.id) };
      if (r.error) return res.status(200).json({ list, error: r.error, noAccess: !!r.noAccess, writes: writesOn() });
      return res.status(200).json({ list, tasks: r.tasks.filter((t) => !t.done), writes: writesOn() });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    if (!requireSameOrigin(req, res)) return;
    const b = req.body || {};
    const out = b.action === "done" ? await markTaskDone(String(b.id || ""), { listId: L.id })
      : b.action === "create" ? await createUserTask({ name: b.name, list: key, due: b.due || null, assignee: null })
      : { error: "Unknown action." };
    if (out.error) return res.status(out.off ? 503 : /Couldn't reach/.test(out.error) ? 502 : 400).json({ error: out.error });
    return res.status(200).json(out);
  } catch (err) {
    console.error("my-tasks failed:", err);
    return res.status(502).json({ error: "Couldn't reach ClickUp. Try again in a minute." });
  }
}
