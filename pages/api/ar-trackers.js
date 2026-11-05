// A&R trackers (list B #5) and the momentum score (#8). Staff with A&R.
// GET  ?who=team|me|<user id>  the team tracker (or one person's), each entry with its momentum score,
//      trend and "why", plus the people with a tracker, the score weights and the person's expiring ones
//      ?find=<link>  who already tracks it (the paste box: "already on Hank's tracker")
//      ?scores=1     every artist's score, trend and why (the Watchlist)
//      ?home=1       Home's momentum jumps (Home or A&R; an account limited to its own artists: theirs only)
// POST {action}: add | renew | setDays | remove | weights, and (r10, the A&R lists' drawer) confirmMatch | notThem |
//      setMode (campaign: daily refresh) | notes | setRole (r11: Artist/Producer). (r11: toOutreach is gone with
//      Outreach.) The only sheet these reach is the A&R sheet, a one-way copy written after each change
//      (lib/ar/tracker-sheet.js, AR_TRACKER_SHEET_WRITES only); never the pub sheet, never ClickUp.
import { requireAccess, limited, ownSet } from "../../lib/access";
import { requireSameOrigin } from "../../lib/session";
import { sql } from "../../lib/db";
import * as T from "../../lib/ar/trackers";
import * as M from "../../lib/ar/momentum";
import * as L from "../../lib/ar/lists";

const scoreFor = (all, i) => {
  const m = i.entityId && all.get(i.entityId);
  return m ? { score: m.score, trend: m.trend, delta: m.delta, why: m.why, jump: !!m.jump } : { score: null, trend: null, delta: null, why: i.kind === "artist" ? "Needs a second day of numbers" : "", jump: false };
};

export default async function handler(req, res) {
  const home = req.method === "GET" && !!req.query.home;
  const session = await requireAccess(req, res, home ? ["home", "ar"] : ["ar"]);
  if (!session) return;
  // the same name everywhere a person is shown (users.name, else the email's first part; never the email)
  const user = { id: session.user.id, name: L.displayName(session.user) };
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
    if (b.action === "add") {
      const out = await T.addToTracker({ user, days: b.days, kind: b.kind, spotify: b.spotify, name: b.name, artist: b.artist, genre: b.genre, image: b.image, url: b.url, clip: b.clip, clientId: b.clientId, isrc: b.isrc, links: b.links && typeof b.links === "object" ? b.links : {}, role: L.ROLES.includes(b.role) ? b.role : null });
      // r11 (A2): the paste box's Artist/Producer pick is saved inside addToTracker, before the A&R sheet's "Added" line
      return res.status(200).json(out);
    }
    if (b.action === "setRole") { const out = await L.setRole({ id: String(b.id || ""), role: b.role }); await T.sheetAfter(); return res.status(200).json(out); } // (r11) the A&R sheet's Type follows
    if (b.action === "renew") return res.status(200).json(await T.renew({ subject: Array.isArray(b.subjects) ? b.subjects.map(String) : String(b.subject || ""), entryId: b.entryId ? String(b.entryId) : null, user, days: b.days ?? null }));
    if (b.action === "setDays") return res.status(200).json(await T.setDays({ entryId: String(b.entryId || ""), user, days: b.days }));
    if (b.action === "remove") {
      // your own entry; a Founder may take anyone's off (the page's confirm names the person)
      const [e] = await sql`SELECT owner_id FROM ar_tracker WHERE id = ${String(b.entryId || "")} AND removed_at IS NULL`;
      if (e && e.owner_id !== user.id && req.access?.role !== "founder") return res.status(403).json({ error: "That's on someone else's list. A Founder can take it off." });
      return res.status(200).json(await T.removeEntry({ entryId: String(b.entryId || ""), by: user.name, byId: user.id }));
    }
    // r10 fix: the drawer's "Add to my list" on a row someone else added (your name goes on it, 30 days)
    if (b.action === "addMine") {
      const subject = String(b.subject || "");
      if (!/^(w|s):[A-Za-z0-9_-]{1,60}$/.test(subject)) return res.status(400).json({ error: "That one can't be added from here. Paste its link instead." });
      const [e] = await sql`SELECT kind FROM ar_tracker WHERE subject = ${subject} AND removed_at IS NULL LIMIT 1`;
      if (!e) return res.status(404).json({ error: "That one isn't on any list any more. Paste its link to add it again." });
      return res.status(200).json(await T.addEntry({ user, subject, kind: e.kind, days: T.DEFAULT_DAYS }));
    }
    // (r11) the A&R sheet: a confirmed match is a Log line; a match turned down or new notes change the Watchlist tab
    if (b.action === "confirmMatch") { const out = await L.confirmMatch({ id: b.id, spotifyId: String(b.spotifyId || ""), by: user.name }); await T.sheetAfter([{ action: "Confirmed", userId: user.id, who: user.name, subject: `w:${String(b.id)}` }]); return res.status(200).json(out); }
    if (b.action === "notThem") { const out = await L.notThem({ id: b.id, spotifyId: String(b.spotifyId || "") }); await T.sheetAfter(); return res.status(200).json(out); }
    if (b.action === "notes") { const out = await L.saveNotes({ id: b.id, notes: b.notes }); await T.sheetAfter(); return res.status(200).json(out); }
    if (b.action === "setMode") {
      // campaign mode (every number daily) moves here from Numbers: an artist or a sound on the lists
      const id = String(b.entityId || "");
      if (!/^(a|w|s):[A-Za-z0-9_-]{1,40}$/.test(id)) return res.status(400).json({ error: "Campaign mode is for an artist or a sound." });
      const E = await import("../../lib/data/engine");
      const r = await E.setMode(id, b.mode === "campaign" ? "campaign" : "auto", { by: user.name });
      return r.error ? res.status(400).json(r) : res.status(200).json(r);
    }
    if (b.action === "weights") return res.status(200).json({ ok: true, weights: await M.saveMomentumWeights(b.weights || {}) });
    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    if (err instanceof T.TrackerError || (err?.status && err.status < 500)) return res.status(err.status).json({ error: err.message });
    console.error("ar-trackers failed:", err);
    return res.status(503).json({ error: "Couldn't load the trackers — try again in a minute." });
  }
}
