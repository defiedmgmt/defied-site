// The automated numbers for the dashboard (list B #4). GET: Numbers' page (Publishing); ?home=1: Home's
// spikes, new releases and the monthly cost (Home or Publishing). An account limited to its own artists
// gets only theirs. POST (Publishing): campaign mode on an artist or sound, a TikTok sound to track or
// stop tracking; the sources' schedule, scraper and budgets need Money too (they spend money).
import { requireAccess, limited, ownSet } from "../../lib/access";
import { loadSummary } from "../../lib/data/summary";
import { setMode, addSound, removeSound, saveSetting, loadSettings, dataSql as sql } from "../../lib/data/engine";
import { SOURCES, sourceSettings, soundId } from "../../lib/data/sources";
import { loadSeeds, seedTodo, decideSeed, countsOf } from "../../lib/data/seeds";
import { syncEntities } from "../../lib/data/engine";

// the old Luminate portfolios' rows an account may answer for: the clients' catalogs need Publishing,
// the Artist and Song Trackers A&R (an account limited to its own artists sees none: the lists are everyone's)
const seedAreas = (req) => (limited(req) ? [] : [req.access.sections.includes("publishing") && "roster", req.access.sections.includes("ar") && "ar"].filter(Boolean));

export default async function handler(req, res) {
  // ?seeds=1: To do's rows for what the Luminate starting list still needs (GET); POST {action:"seed"}: an answer
  if (req.query.seeds || (req.method === "POST" && req.body?.action === "seed")) return seeds(req, res);
  if (req.method === "GET") {
    const home = !!req.query.home;
    const session = await requireAccess(req, res, home ? ["home", "publishing"] : ["publishing"]);
    if (!session) return;
    try {
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(await loadSummary({ clientIds: limited(req) ? [...ownSet(req)] : null, home }));
    } catch (err) {
      console.error("data summary failed:", err);
      return res.status(503).json({ error: "Couldn't load the numbers — try again in a minute." });
    }
  }
  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });
  if (req.headers["x-requested-with"] !== "defied-site") return res.status(400).json({ error: "Bad request." });
  const session = await requireAccess(req, res, ["publishing"]);
  if (!session) return;
  const b = req.body && typeof req.body === "object" ? req.body : {};
  const by = session.user.name || session.user.email || session.user.id || "";
  try {
    if (b.action === "mode") {
      const id = String(b.entityId || "");
      if (limited(req)) {
        const [e] = await sql`SELECT clients FROM data_entities WHERE id = ${id}`;
        const mine = ownSet(req);
        if (!e || !(Array.isArray(e.clients) ? e.clients : []).some((c) => mine.has(c))) return res.status(403).json({ error: "That isn't one of your artists." });
      }
      const days = b.days == null || b.days === "" ? null : Number(b.days);
      if (days != null && !(days >= 1 && days <= 365)) return res.status(400).json({ error: "Pick 1 to 365 days." });
      const r = await setMode(id, String(b.mode || ""), { days, by });
      return res.status(r.error ? 400 : 200).json(r);
    }
    if (b.action === "addSound") {
      const clip = soundId(b.url);
      if (!clip) return res.status(400).json({ error: "Paste a TikTok sound link (tiktok.com/music/…)." });
      return res.status(200).json(await addSound(clip, String(b.url).trim().slice(0, 300), { by }));
    }
    if (b.action === "removeSound") { const r = await removeSound(String(b.entityId || "")); return res.status(r.error ? 404 : 200).json(r); }
    if (b.action === "sources") {
      if (!req.access.sections.includes("money")) return res.status(403).json({ error: "Changing what the numbers cost needs Money. A Founder can turn it on in Site › Users." });
      const cur = await loadSettings();
      const next = {};
      for (const k of Object.keys(SOURCES)) next[k] = { ...cur.sources[k], ...(b.sources?.[k] && typeof b.sources[k] === "object" ? b.sources[k] : {}) };
      const clean = sourceSettings(next);
      const total = Number(b.totalCapUsd), hasTotal = b.totalCapUsd != null && b.totalCapUsd !== "";
      if (hasTotal && !(total >= 0 && total <= 19)) return res.status(400).json({ error: "The total budget is $0 to $19 a month (the Apify plan)." });
      await saveSetting("sources", clean);
      if (hasTotal) await saveSetting("caps", { totalUsd: total });
      return res.status(200).json({ ok: true, sources: clean });
    }
    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    console.error("data write failed:", err);
    return res.status(503).json({ error: "Couldn't save that — try again in a minute." });
  }
}

async function seeds(req, res) {
  if (req.method === "POST" && req.headers["x-requested-with"] !== "defied-site") return res.status(400).json({ error: "Bad request." });
  const session = await requireAccess(req, res, ["publishing", "ar"]);
  if (!session) return;
  res.setHeader("Cache-Control", "no-store");
  try {
    const areas = seedAreas(req);
    if (req.method === "GET") {
      const rows = await loadSeeds();
      return res.status(200).json({ todo: seedTodo(rows, areas), counts: countsOf(rows.filter((r) => areas.includes(r.area))) });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });
    const b = req.body || {};
    const [row] = (await loadSeeds()).filter((r) => r.lum_id === String(b.lumId || ""));
    if (!row) return res.status(404).json({ error: "That one isn't on the list any more." });
    if (!areas.includes(row.area)) return res.status(403).json({ error: row.area === "ar" ? "That one is A&R's." : "That one is Publishing's." });
    const by = session.user.name || session.user.email || session.user.id || "";
    const r = await decideSeed(row.lum_id, { op: String(b.op || ""), url: String(b.url || "").slice(0, 400), socials: b.socials && typeof b.socials === "object" ? b.socials : {} }, by);
    if (r.error) return res.status(400).json(r);
    // tracked from the next numbers on (no paid run starts here)
    await syncEntities().catch((err) => console.error("seed sync:", err));
    const s = r.row;
    return res.status(200).json({ ok: true, status: s.status, spotify: s.spotify_id ? { id: s.spotify_id, name: s.spotify_name } : null, socials: s.socials });
  } catch (err) {
    console.error("seeds failed:", err);
    return res.status(503).json({ error: "Couldn't load that — try again in a minute." });
  }
}
