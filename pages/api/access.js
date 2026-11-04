// Site › Users' part of roles and permissions (lib/access.js, lib/roles.js). Users only.
//   GET  -> { managersAt }: when each client's manager was last read from the accounting sheet
//   POST { action: "managers" } -> reads the accounting sheet's INFO tab ("Assigned Manager") and
//        keeps each client's manager, which a Co-manager limited to their own artists is matched on.
//        Reads the sheet only; writes clients.manager.
// The roles and overrides themselves are saved with the logins (POST /api/dashboard-data, users).
import { requireSameOrigin } from "../../lib/session";
import { requireAccess, refreshManagers } from "../../lib/access";
import { sql } from "../../lib/db";

export default async function handler(req, res) {
  const session = await requireAccess(req, res, "users");
  if (!session) return;
  try {
    if (req.method === "GET") {
      const [r] = await sql`SELECT max(manager_at) AS at FROM clients`;
      return res.status(200).json({ managersAt: r?.at || null });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    if (!requireSameOrigin(req, res)) return;
    if (req.body?.action !== "managers") return res.status(400).json({ error: "Unknown action." });
    const out = await refreshManagers();
    if (out.error) return res.status(out.connected ? 502 : 503).json(out);
    return res.status(200).json(out);
  } catch (err) {
    console.error("access route failed:", err);
    return res.status(502).json({ error: "Couldn't read the accounting sheet just now. Try again in a minute." });
  }
}
