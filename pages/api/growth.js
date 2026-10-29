// Stream growth per song, from the dated Luminate snapshots: { [placementId]:
// { latest, latestOn, week, weekPct, ytd, series } }. Staff get every song; a
// client only their own (keyed by song, so Luminate ids stay staff-only).
import { sql } from "../../lib/db";
import { requireUser } from "../../lib/session";
import { growthFor } from "../../lib/luminate";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const session = await requireUser(req, res);
  if (!session) return;
  const { role, clientId } = session.user;
  try {
    const rows = role === "staff"
      ? await sql`SELECT id, luminate_id FROM placements WHERE luminate_id <> ''`
      : await sql`SELECT id, luminate_id FROM placements WHERE luminate_id <> '' AND client_id = ${clientId}`;
    const growth = await growthFor(rows.map((r) => r.luminate_id));
    const out = {};
    for (const r of rows) if (growth[r.luminate_id]) out[r.id] = growth[r.luminate_id];
    return res.status(200).json({ growth: out });
  } catch (err) {
    console.error("growth failed:", err);
    return res.status(502).json({ error: "Couldn't load stream history." });
  }
}
