// Staff-only ClickUp tasks for To do (lib/clickup-tasks.js): GET = every open task on the dashboard's
// lists (Internal, Pub, A&R and the five MGMT lists), the people to filter by and assign, and whether
// writes are on. The tasks the dashboard keeps itself ("Log new payments", the area tasks) are left
// out (To do lists their to-dos already; the open ones come back as own, for its "Done for you" line).
// ?fresh=1 (To do's Check again, after sharing a list in ClickUp) skips the 90-second shared copy and reads again every
// list's access and the people; Try again doesn't (2026-11-13: it emptied every cache, about 18 more ClickUp calls
// while ClickUp was already saying wait). stale + at: ClickUp said to wait (429) and these are its last answer, from at.
// A list the Defied Bot can't see comes back as { error: "Defied Bot can't see …", noAccess: true } (r10, C2).
// POST {action:"done", id} sets a task to its list's closed status; {action:"create", name, list, due,
// assignee} adds one. Both only with CLICKUP_TASK_WRITES=on (else a plain line, nothing sent).
import { requireSameOrigin } from "../../lib/session";
import { requireAccess } from "../../lib/access";
import { allTasks, members, markTaskDone, createUserTask, ownTasks, writesOn } from "../../lib/clickup-tasks";

export default async function handler(req, res) {
  const session = await requireAccess(req, res, ["todo", "home"]);
  if (!session) return;
  try {
    if (req.method === "GET") {
      const fresh = !!req.query.fresh;
      const [{ lists, tasks, at, stale }, people, own] = await Promise.all([allTasks({ fresh }), members({ fresh }), ownTasks()]);
      const mine = new Set(own.map((t) => t.taskId));
      // own: only a task that's really there (open in its list) and kept current (writes on), so "Done for
      // you" never names one that doesn't exist
      const there = new Set(tasks.map((t) => t.id));
      return res.status(200).json({ lists, tasks: tasks.filter((t) => !mine.has(t.id)), people, writes: writesOn(), own: writesOn() ? own.filter((t) => t.open && there.has(t.taskId)) : [], ...(stale ? { stale: true, at } : {}) });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    if (!requireSameOrigin(req, res)) return;
    const b = req.body || {};
    const out = b.action === "done" ? await markTaskDone(String(b.id || ""))
      : b.action === "create" ? await createUserTask({ name: b.name, list: String(b.list || ""), due: b.due || null, assignee: b.assignee ?? null })
      : { error: "Unknown action." };
    if (out.error) return res.status(out.off ? 503 : /Couldn't reach/.test(out.error) ? 502 : 400).json({ error: out.error });
    return res.status(200).json(out);
  } catch (err) {
    console.error("tasks route failed:", err);
    return res.status(502).json({ error: "Couldn't reach ClickUp. Try again in a minute." });
  }
}
