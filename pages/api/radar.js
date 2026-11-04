// The TikTok sound radar (list B #6). Staff with A&R.
// GET  ?genre=  the biggest growing sounds (new videos + % growth since the last scan), the ones seen once
//      so far, the keywords, ours, what it cost this month and the last scans
// POST {action}: addKeyword | editKeyword | removeKeyword | addSound (a pasted link; own: one of ours) |
//      setOwn | hide | track (the sound, or its artist, onto your tracker) | scan (now, inside the radar's
//      budget; needs DATA_REFRESH on) | settings (the radar's budget and scraper: needs Money, it spends money)
import { requireAccess } from "../../lib/access";
import { requireSameOrigin } from "../../lib/session";
import * as R from "../../lib/ar/radar";
import * as T from "../../lib/ar/trackers";

export default async function handler(req, res) {
  const session = await requireAccess(req, res, ["ar"]);
  if (!session) return;
  const user = { id: session.user.id, name: session.user.name || session.user.email || "" };
  try {
    if (req.method === "GET") {
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(await R.radarPage({ genre: String(req.query.genre || "").slice(0, 40) }));
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    if (!requireSameOrigin(req, res)) return;
    const b = req.body && typeof req.body === "object" ? req.body : {};
    const a = b.action;
    if (a === "addKeyword") return res.status(200).json(await R.addKeyword({ keyword: b.keyword, genre: b.genre, by: user.name }));
    if (a === "editKeyword") return res.status(200).json(await R.editKeyword({ id: b.id, genre: b.genre, active: b.active }));
    if (a === "removeKeyword") return res.status(200).json(await R.removeKeyword({ id: b.id }));
    if (a === "addSound") return res.status(200).json(await R.addRadarSound({ url: b.url, own: !!b.own, by: user.name }));
    if (a === "setOwn") return res.status(200).json(await R.setOwn({ id: b.id, own: !!b.own }));
    if (a === "hide") return res.status(200).json(await R.hideSound({ id: b.id, hidden: b.hidden !== false }));
    if (a === "track") {
      const page = await R.radarPage({});
      const s = [...page.rising, ...page.firstSeen, ...page.waiting, ...page.own].find((x) => x.id === String(b.id || ""));
      if (!s) return res.status(404).json({ error: "That sound isn't on the radar any more." });
      if (b.what === "artist") {
        if (!s.artist) return res.status(400).json({ error: "This sound has no artist name to track." });
        return res.status(200).json(await T.addToTracker({ user, days: b.days, kind: "artist", name: s.artist }));
      }
      return res.status(200).json(await T.addToTracker({ user, days: b.days, kind: "sound", clip: s.id, url: s.url, name: s.title, artist: s.artist, image: s.cover }));
    }
    if (a === "scan") return res.status(200).json(await R.startRadarScan({ force: !!b.force }));
    if (a === "settings") {
      if (!req.access.sections.includes("money")) return res.status(403).json({ error: "Changing what the radar costs needs Money. A Founder can turn it on in Site › Users." });
      return res.status(200).json({ ok: true, settings: await R.saveRadarSettings({ capUsd: b.capUsd, adapter: b.adapter }) });
    }
    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error("radar failed:", err);
    return res.status(503).json({ error: "Couldn't load the radar — try again in a minute." });
  }
}
