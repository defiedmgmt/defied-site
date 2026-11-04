// A&R trackers (list B #5) and the momentum score (#8). Staff with A&R.
// GET  ?who=team|me|<user id>  the team tracker (or one person's), each entry with its momentum score,
//      trend and "why", plus the people with a tracker, the score weights and the person's expiring ones
//      ?find=<link>  who already tracks it (the paste box: "already on Hank's tracker")
//      ?scores=1     every artist's score, trend and why (the Watchlist)
//      ?home=1       Home's momentum jumps (Home or A&R; an account limited to its own artists: theirs only)
// POST {action}: add | renew | setDays | remove | weights. Nothing here writes to a sheet or ClickUp.
import { requireAccess, limited, ownSet } from "../../lib/access";
import { requireSameOrigin } from "../../lib/session";
import * as T from "../../lib/ar/trackers";
import * as M from "../../lib/ar/momentum";

const scoreFor = (all, i) => {
  const m = i.entityId && all.get(i.entityId);
  return m ? { score: m.score, trend: m.trend, delta: m.delta, why: m.why, jump: !!m.jump } : { score: null, trend: null, delta: null, why: i.kind === "artist" ? "Needs a second day of numbers" : "", jump: false };
};

export default async function handler(req, res) {
  const home = req.method === "GET" && !!req.query.home;
  const session = await requireAccess(req, res, home ? ["home", "ar"] : ["ar"]);
  if (!session) return;
  const user = { id: session.user.id, name: session.user.name || session.user.email || "" };
  try {
    if (req.method === "GET") {
      res.setHeader("Cache-Control", "no-store");
      if (home) return res.status(200).json({ jumps: await M.momentumJumps({ clientIds: limited(req) ? [...ownSet(req)] : null }) });
      if (req.query.scores) {
        const all = await M.computeMomentum({});
        return res.status(200).json({ scores: Object.fromEntries([...all.values()].map((m) => [m.id, { score: m.score, trend: m.trend, delta: m.delta, why: m.why, vs: m.vs || null }])) });
      }
      if (req.query.find) return res.status(200).json({ tracked: await T.findTracked({ url: String(req.query.find).slice(0, 400) }) });
      const who = String(req.query.who || "team");
      const [team, all, weights] = await Promise.all([T.listTracker({}), M.computeMomentum({}), M.momentumWeights()]);
      const ownerId = who === "team" ? null : who === "me" ? user.id : who;
      const items = (ownerId == null ? team : team.filter((i) => i.who.some((w) => w.ownerId === ownerId)))
        .map((i) => ({ ...i, ...scoreFor(all, i), mine: i.who.some((w) => w.ownerId === user.id) }))
        // best momentum first; the ones with no score yet after, newest first
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || new Date(b.addedAt) - new Date(a.addedAt));
      const expiring = await T.expiringSoon({ userId: user.id });
      return res.status(200).json({ items, people: T.peopleOf(team), me: user.id, who, weights, durations: T.DURATIONS, graceDays: T.GRACE_DAYS,
        expiring: expiring.map((i) => ({ key: i.key, name: i.name, state: i.mine.state, daysLeft: i.mine.daysLeft ?? null, entryId: i.mine.entryId })) });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    if (!requireSameOrigin(req, res)) return;
    const b = req.body && typeof req.body === "object" ? req.body : {};
    if (b.action === "add") return res.status(200).json(await T.addToTracker({ user, days: b.days, kind: b.kind, spotify: b.spotify, name: b.name, artist: b.artist, genre: b.genre, image: b.image, url: b.url, clip: b.clip, clientId: b.clientId }));
    if (b.action === "renew") return res.status(200).json(await T.renew({ subject: Array.isArray(b.subjects) ? b.subjects.map(String) : String(b.subject || ""), entryId: b.entryId ? String(b.entryId) : null, user, days: b.days ?? null }));
    if (b.action === "setDays") return res.status(200).json(await T.setDays({ entryId: String(b.entryId || ""), user, days: b.days }));
    if (b.action === "remove") return res.status(200).json(await T.removeEntry({ entryId: String(b.entryId || "") }));
    if (b.action === "weights") return res.status(200).json({ ok: true, weights: await M.saveMomentumWeights(b.weights || {}) });
    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    if (err instanceof T.TrackerError) return res.status(err.status).json({ error: err.message });
    console.error("ar-trackers failed:", err);
    return res.status(503).json({ error: "Couldn't load the trackers — try again in a minute." });
  }
}
