// Site › Users (a Founder, or anyone with Users): POST { userId } -> { url, expiresAt }, a one-time link that lets that
// person choose their own password (lib/password-links.js). Shown once to copy; only its hash is kept.
import { requireAccess } from "../../../lib/access";
import { requireSameOrigin } from "../../../lib/session";
import { sql } from "../../../lib/db";
import { makeLink } from "../../../lib/password-links";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const session = await requireAccess(req, res, "users");
  if (!session) return;
  if (!requireSameOrigin(req, res)) return;
  const userId = String(req.body?.userId || "");
  try {
    const [u] = await sql`SELECT id, role, staff_role FROM users WHERE id = ${userId}`;
    if (!u) return res.status(404).json({ error: "That login isn't here any more. Reload the page." });
    // a Founder's login is a Founder's to change (as in the Users save)
    if (u.role === "staff" && u.staff_role === "founder" && req.access?.role !== "founder") return res.status(403).json({ error: "Only a Founder can do that for a Founder." });
    return res.status(200).json(await makeLink(u.id, session.user.name || session.user.email || ""));
  } catch (err) {
    console.error("password-link failed:", err);
    return res.status(502).json({ error: "Couldn't make the link. Try again." });
  }
}
