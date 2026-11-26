// (2026-11-26, paylinks-1126) Site › Users' Pay link: a Founder sets, changes or removes a manager's pay.defiedmgmt.com link (lib/pay-links.js,
// lib/pay-links-store.js). Its own save, never the dashboard's big one. Everyone who can open Users sees the links in the dataset
// (pages/api/dashboard-data.js); only a Founder changes them.
//   POST { action: "save", key, owner, url }  -> { ok, links }   400 with the sentence to show when it doesn't check out
//   POST { action: "remove", key }            -> { ok, links }   the owner's own link can't be removed
// A preview build answers that saves are off: the links are the live site's (pay.defiedmgmt.com reads them).
import { sql } from "../../lib/db";
import { requireSameOrigin } from "../../lib/session";
import { requireAccess } from "../../lib/access";
import { PREVIEW, PREVIEW_OFF } from "../../lib/preview";
import { checkPayLink, checkRemove, publicLinks, OWNER } from "../../lib/pay-links";
import { readPayLinks, savePayLink, removePayLink } from "../../lib/pay-links-store";

// INFO's manager list, as the clients table copies it nightly (lib/info-managers.js)
async function infoManagers() {
  const rows = await sql`SELECT DISTINCT manager FROM clients WHERE manager <> ''`;
  return [OWNER, ...rows.map((r) => String(r.manager || "").trim()).filter(Boolean)];
}

export default async function handler(req, res) {
  const session = await requireAccess(req, res, "users");
  if (!session) return;
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!requireSameOrigin(req, res)) return;
  if (req.access?.role !== "founder") return res.status(403).json({ error: "Only Founders can change pay links." });
  if (PREVIEW) return res.status(503).json({ error: PREVIEW_OFF, off: true });
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const by = session.user?.name || session.user?.email || "staff";
  try {
    const links = await readPayLinks({ fresh: true, strict: true });
    if (body.action === "save") {
      const c = checkPayLink(body, links, { production: process.env.VERCEL_ENV === "production", managers: await infoManagers() });
      if (c.error) return res.status(400).json({ error: c.error });
      await savePayLink(c.value, links, by);
    } else if (body.action === "remove") {
      const c = checkRemove(body.key, links);
      if (c.error) return res.status(400).json({ error: c.error });
      await removePayLink(c.value.key);
    } else return res.status(400).json({ error: "Unknown action." });
    return res.status(200).json({ ok: true, links: publicLinks(await readPayLinks({ fresh: true })) });
  } catch (err) {
    console.error("pay links save failed:", err);
    return res.status(500).json({ error: "That didn't save. Try again in a minute." });
  }
}
