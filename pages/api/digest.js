// List B #9: "Preview this week's digest" (Numbers › Monday digest). GET -> exactly what this Monday's
// digests would say for the signed-in account: the team digest's sections it may see, and its own
// personal digest. A Founder (Users) may pass ?user=<id> to see someone else's personal digest, and gets
// the list of people and what this week's run did for each (digest_runs). Reads only; nothing is sent here.
import { requireAccess } from "../../lib/access";
import { sql } from "../../lib/db";
import { buildTeamDigest, buildPersonalDigest, messageOf, teamMessagesOf, digestWritesOn, digestWeek, personalPeople } from "../../lib/digest";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only." });
  const session = await requireAccess(req, res, ["publishing", "ar"]);
  if (!session) return;
  const founder = req.access.sections.includes("users");
  try {
    const now = new Date();
    let who = session.user;
    if (req.query.user && founder) {
      const [u] = await sql`SELECT id, email, name FROM users WHERE id = ${String(req.query.user)} AND role = 'staff'`;
      if (!u) return res.status(404).json({ error: "No staff account with that id." });
      who = u;
    }
    const [team, personal] = await Promise.all([
      buildTeamDigest({ now, access: req.access }),
      buildPersonalDigest(who, who.id === session.user.id ? { now, access: req.access } : { now }),
    ]);
    const out = {
      week: digestWeek(now), writesOn: digestWritesOn(), schedule: "Mondays, 9 AM New York time",
      // the team digest is two ClickUp messages (roster, then the tracked artists): shown one after the other
      team: { ...team, text: teamMessagesOf(team).map((m) => m.content).join("\n\n———\n\n"), channelSet: !!String(process.env.DIGEST_CHANNEL_ID || "").trim() },
      personal: { ...personal, text: personal.sections.length ? messageOf(personal) : "" },
    };
    if (founder) {
      const users = await sql`SELECT id, email, name FROM users WHERE role = 'staff' ORDER BY name`;
      const getting = new Set(personalPeople(users).map((u) => u.id));
      let runs = [];
      try { runs = await sql`SELECT id, kind, user_id, status, error, created_at FROM digest_runs WHERE week = ${out.week}`; } catch (err) { if (err?.code !== "42P01") throw err; }
      out.people = users.map((u) => ({ id: u.id, name: u.name || u.email, getsPersonal: getting.has(u.id), thisWeek: runs.find((r) => r.user_id === u.id) || null }));
      out.teamRun = runs.find((r) => r.kind === "team") || null;
    }
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(out);
  } catch (err) {
    console.error("digest preview failed:", err);
    return res.status(503).json({ error: "Couldn't build the digest preview — try again in a minute." });
  }
}
