// Stream growth per song, from the dated Luminate snapshots: { [placementId]:
// { latest, latestOn, week, weekPct, ytd, series, thisWeek, lastWeek, wowPct, weekOf } }. Staff get
// every song; a client only their own (keyed by song, so Luminate ids stay staff-only).
// ?top=1 (staff only): the Dashboard's Top gainers, ranked by week-on-week % (lib/luminate.js rosterTop).
import { sql } from "../../lib/db";
import { requireAccess, limited, ownSet } from "../../lib/access";
import { growthFor, rosterTop } from "../../lib/luminate";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const session = await requireAccess(req, res, ["home", "publishing"], { clients: true });
  if (!session) return;
  const { role, clientId } = session.user;
  // an account limited to its own artists (lib/roles.js) gets only their songs, like a client its own
  const mine = limited(req) ? [...ownSet(req)] : null;
  try {
    if (req.query.top) {
      if (role !== "staff") return res.status(403).json({ error: "Staff only." });
      return res.status(200).json({ top: await rosterTop(mine ? { clientIds: mine } : {}) });
    }
    const rows = role !== "staff"
      ? await sql`SELECT id, luminate_id FROM placements WHERE luminate_id <> '' AND client_id = ${clientId}`
      : mine ? await sql`SELECT id, luminate_id FROM placements WHERE luminate_id <> '' AND client_id = ANY(${mine})`
      : await sql`SELECT id, luminate_id FROM placements WHERE luminate_id <> ''`;
    const growth = await growthFor(rows.map((r) => r.luminate_id));
    const out = {};
    for (const r of rows) if (growth[r.luminate_id]) out[r.id] = growth[r.luminate_id];
    return res.status(200).json({ growth: out });
  } catch (err) {
    console.error("growth failed:", err);
    return res.status(502).json({ error: "Couldn't load stream history." });
  }
}
