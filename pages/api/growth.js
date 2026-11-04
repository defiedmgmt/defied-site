// Stream growth per song, from the automated numbers (Spotify streams, global; lib/data/growth.js):
// { [placementId]: { latest, latestOn, series, daily, thisWeek, lastWeek, wowPct, weekOf } }. Staff get
// every song; a client only their own. ?top=1 (staff only): Home's This week, ranked by week-on-week %.
import { requireAccess, limited, ownSet } from "../../lib/access";
import { songGrowth, rosterTop } from "../../lib/data/growth";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const session = await requireAccess(req, res, ["home", "publishing"], { clients: true });
  if (!session) return;
  const { role, clientId } = session.user;
  // an account limited to its own artists (lib/roles.js) gets only their songs, like a client its own
  const mine = role !== "staff" ? [clientId] : limited(req) ? [...ownSet(req)] : null;
  try {
    if (req.query.top) {
      if (role !== "staff") return res.status(403).json({ error: "Staff only." });
      return res.status(200).json({ top: await rosterTop(mine ? { clientIds: mine } : {}) });
    }
    return res.status(200).json({ growth: await songGrowth({ clientIds: mine }) });
  } catch (err) {
    console.error("growth failed:", err);
    return res.status(502).json({ error: "Couldn't load stream history." });
  }
}
