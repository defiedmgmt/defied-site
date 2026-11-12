// A client's own numbers for their portal (2026-11-10, the owner: "show their social stats on their end as well"): the
// same Campaign card staff see on the artist's Clients page — Spotify streams this week, listeners and followers per
// platform with their change — for their own artist only, nothing else (no other artists, no costs, no money).
import { requireUser } from "../../lib/session";
import { loadSummary } from "../../lib/data/summary";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const session = await requireUser(req, res);
  if (!session) return;
  const { role, clientId } = session.user;
  if (role !== "client" || !clientId) return res.status(403).json({ error: "This is a client's own page." });
  res.setHeader("Cache-Control", "no-store");
  try {
    const d = await loadSummary({ clientIds: [clientId] });
    const a = (d.artists || []).find((x) => x.clientId === clientId);
    const artist = a ? { clientId, name: a.name, mode: a.mode, links: a.links || {}, streams: a.streams ? { thisWeek: a.streams.thisWeek, lastWeek: a.streams.lastWeek, pct: a.streams.pct, day: a.streams.day } : null,
      metrics: Object.fromEntries(Object.entries(a.metrics || {}).map(([k, m]) => [k, { latest: m.latest, daily: m.daily, growthPct: m.growthPct, approx: !!m.approx, day: m.day }])),
      // (2026-11-11) their own songs' Spotify all-time and "under 1,000", for a song Luminate doesn't have yet (the portal)
      songs: (a.songs || []).map((s) => ({ id: s.id, under1k: !!s.under1k, streams: s.streams ? { latest: s.streams.latest } : null })) } : null;
    return res.status(200).json({ artists: artist ? [artist] : [] });
  } catch (err) {
    console.error("my-numbers failed:", err);
    return res.status(503).json({ error: "Couldn't load your numbers. Try again in a minute." });
  }
}
