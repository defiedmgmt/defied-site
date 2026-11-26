// GET /api/share-card?client=<id>&format=story|post — a client's share card as a PNG (2026-11-13, the owner: "a share
// button that captures only their gross streams"): their total streams and top songs, as their portal shows them
// (lib/share-card.js), drawn on the Defied look (lib/share-card-render.js) with each song's own cover art in its row, on
// plain black, saying the day it's made (2026-11-26). No net streams, splits or money.
//   a client      their own card (?client= may be left out; another client's id is refused)
//   staff         Clients access, ?client= named; an account limited to its own artists gets only theirs
// story is 1080x1920 (the default), post 1080x1350. A client with no streams yet gets 409, not an empty card, and a name
// in letters the card's fonts don't have gets 422, not a card with no name. A top song whose title can't be drawn is left
// off the list, and X-Share-Left-Off says how many were, for the window to say so.
// Speed (2026-11-26, the owner: "make it load way quicker"): the numbers are read fresh every time; a warm server then
// answers from the card it already drew for exactly those numbers, size and day (lib/share-card.js drawShareCard), and a
// window that already has that card (it sends the card's ETag in If-None-Match) gets 304 and no image at all. A whole
// card's answer carries its ETag; one drawn with a picture missing doesn't. Server-Timing says where the time went.
// Errors are one short plain line; nothing is kept by the browser's or any other cache (private, no-store): it's
// someone's own numbers.
import { requireAccess } from "../../lib/access";
import { shareStats, shareTarget, cardKey, cardTag, tagMatches, drawShareCard } from "../../lib/share-card";
import { cardText, loadAssets, warmEngine, FORMATS } from "../../lib/share-card-render";
import { shareFileName } from "../../lib/portal-streams";

// a story card is about 150-300 KB now that it's on black (it was 1-1.5 MB over the blurred cover): no size warning needed
export const config = { api: { responseLimit: false } };

const say = (res, status, text) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  return res.status(status).send(text);
};

// a name the card can't put on it: [a client's own words, staff's]
const NAME_LINE = {
  letters: ["Your name uses letters the card can't draw yet.", "This artist's name uses letters the card can't draw yet."],
  blank: ["Your name isn't on the site yet.", "This artist has no name on the site yet."],
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

  // a cold start loads the drawing engine while the numbers are read, not after
  warmEngine();
  const timings = [];
  const timing = (name, ms) => timings.push(`${name};dur=${Math.round(ms)}`);
  const timed = () => { if (timings.length) res.setHeader("Server-Timing", timings.join(", ")); };

  let stats;
  const t0 = Date.now();
  try {
    stats = await shareStats(who.clientId);
  } catch (err) {
    console.error("share card: numbers failed:", err);
    return say(res, 503, "Couldn't load the numbers. Try again in a minute.");
  }
  timing("numbers", Date.now() - t0);
  if (!stats) return say(res, 404, "That artist wasn't found.");
  if (!(stats.grossStreams > 0)) return say(res, 409, "No streams to share yet.");

  let assets, said;
  try {
    assets = loadAssets();
    said = cardText(stats, assets);
  } catch (err) {
    console.error("share card: fonts failed:", err);
    return say(res, 500, "Couldn't make the card. Try again in a minute.");
  }
  if (said.nameIssue) return say(res, 422, NAME_LINE[said.nameIssue][session.user.role === "staff" ? 1 : 0]);

  // the card for exactly these numbers, this size and today: the window may have it already
  const key = cardKey({ clientId: who.clientId, format, stats, said });
  const tag = cardTag(key);
  if (tagMatches(req.headers["if-none-match"], tag)) {
    res.setHeader("ETag", tag);
    timed();
    return res.status(304).end();
  }

  let card;
  try {
    // their photo only when there is one and it arrives in time (~1.2 s); never a stand-in face. And each top song's
    // cover art, all at once with the photo (~1.5 s at most): a song whose cover doesn't come gets the card's D tile, never
    // another picture. said.songs are the songs the card draws, so a cover stays with its own song
    card = await drawShareCard({ key, format, stats, said }, { assets, timing });
  } catch (err) {
    console.error("share card: drawing failed:", err);
    return say(res, 500, "Couldn't make the card. Try again in a minute.");
  }
  if (said.leftOff > 0) res.setHeader("X-Share-Left-Off", String(said.leftOff));
  if (card.complete) res.setHeader("ETag", tag);
  timed();
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Length", String(card.png.length));
  res.setHeader("Content-Disposition", `inline; filename="${shareFileName(stats.name)}"`);
  return res.status(200).send(card.png);
}
