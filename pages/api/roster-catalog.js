// Roster › Catalog (components/dash/roster-views.jsx; it had a Releases page too until 2026-11-24): the two facts about a song that the dashboard's own data doesn't carry for every account, its ISRC and
// "Not on streaming" (song_tracking, lib/song-info.js). GET /api/songs has them, but it works on every artist at once, so an account limited to its own artists is refused;
// this gives each account its own artists' songs only, the same rule the Clients page follows (db.placements is already filtered that way). GET only, reads two columns, writes
// nothing, and the answer is never cached.
//   { tracking: { [placementId]: { isrc?: "USUM72506269", skip?: true } } }   only the songs that have one or the other
import { sql } from "../../lib/db";
import { requireAccess, limited, ownSet } from "../../lib/access";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  // the Roster section (Publishing in lib/roles.js); not `whole`: an account limited to its own artists may read its own
  const session = await requireAccess(req, res, "publishing");
  if (!session) return;
  try {
    const mine = limited(req) ? [...ownSet(req)] : null;
    const rows = mine && !mine.length ? [] : await (mine
      ? sql`SELECT t.placement_id, t.isrc, t.skip FROM song_tracking t JOIN placements p ON p.id = t.placement_id WHERE p.client_id = ANY(${mine})`
      : sql`SELECT t.placement_id, t.isrc, t.skip FROM song_tracking t JOIN placements p ON p.id = t.placement_id`);
    const tracking = {};
    for (const r of rows) {
      const isrc = String(r.isrc || "").trim();
      if (isrc || r.skip) tracking[r.placement_id] = { ...(isrc ? { isrc } : {}), ...(r.skip ? { skip: true } : {}) };
    }
    return res.status(200).json({ tracking });
  } catch (err) {
    console.error("roster-catalog failed:", err?.message);
    return res.status(502).json({ error: "Couldn't read the songs' facts just now. Try again in a minute." });
  }
}
