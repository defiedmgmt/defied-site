// GET /api/share-card?client=<id>&format=story|post — a client's share card as a PNG (2026-11-13, the owner: "a share
// button that captures only their gross streams"): their total streams and top songs, as their portal shows them
// (lib/share-card.js), drawn on the Defied look (lib/share-card-render.js). No net streams, splits or money.
//   a client      their own card (?client= may be left out; another client's id is refused)
//   staff         Clients access, ?client= named; an account limited to its own artists gets only theirs
// story is 1080x1920 (the default), post 1080x1350. A client with no streams yet gets 409, not an empty card.
// Errors are one short plain line; the card is never cached (it's someone's own numbers, and they change daily).
import { requireAccess } from "../../lib/access";
import { shareStats, shareTarget, loadPhoto } from "../../lib/share-card";
import { renderCardPng, FORMATS } from "../../lib/share-card-render";
import { shareFileName } from "../../lib/portal-streams";

// a story card is a few hundred KB: over Next's 4 MB warning only if something is badly wrong, so no warning needed
export const config = { api: { responseLimit: false } };

const say = (res, status, text) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  return res.status(status).send(text);
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return say(res, 405, "GET only."); }
  const session = await requireAccess(req, res, "publishing", { clients: true });
  if (!session) return;
  const who = shareTarget(req, session.user, req.query.client);
  if (who.error) return say(res, who.status, who.error);
  const format = req.query.format == null || req.query.format === "" ? "story" : String(req.query.format);
  if (!Object.hasOwn(FORMATS, format)) return say(res, 400, "The format is story or post.");

  let stats;
  try {
    stats = await shareStats(who.clientId);
  } catch (err) {
    console.error("share card: numbers failed:", err);
    return say(res, 503, "Couldn't load the numbers. Try again in a minute.");
  }
  if (!stats) return say(res, 404, "That artist wasn't found.");
  if (!(stats.grossStreams > 0)) return say(res, 409, "No streams to share yet.");

  let png;
  try {
    // their photo only when there is one and it arrives in time (~1.5 s); never a stand-in face
    const photo = await loadPhoto(stats.photo);
    png = await renderCardPng({ ...stats, photo }, format);
  } catch (err) {
    console.error("share card: drawing failed:", err);
    return say(res, 500, "Couldn't make the card. Try again in a minute.");
  }
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Length", String(png.length));
  res.setHeader("Content-Disposition", `inline; filename="${shareFileName(stats.name)}"`);
  return res.status(200).send(png);
}
