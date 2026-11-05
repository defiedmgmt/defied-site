// List B #7, the "paste a link" box (components/LinkBox.jsx): POST { url, context, paid?, kinds? } ->
// what the link is and everything it fills in (lib/links/resolve.js). Reads only: Spotify, YouTube, and
// (paid: true) one Apify lookup, cached; the only writes are that cache and the lookup's cost line in
// data_runs. Nothing is added anywhere here: the box hands the card to its screen's own Add.
//   context  tracker | watchlist | radar | roster: which screen asks (A&R's three need A&R; the roster
//            Publishing or Site)
//   kinds    the kinds of link that screen takes (["song"], ["artist","profile","channel"], ["sound"])
// A client (their own portal's song form) gets a Spotify song's details only: nothing about who else
// tracks it, no suggestions, no paid lookups.
import { requireAccess } from "../../lib/access";
import { resolveLink } from "../../lib/links/resolve";
import { parseLink, wrongKind } from "../../lib/links/parse";

export const config = { maxDuration: 60 };
const CONTEXTS = { tracker: ["ar"], watchlist: ["ar"], radar: ["ar"], sounds: ["ar"], roster: ["publishing", "site"] };
const KINDS = new Set(["song", "artist", "profile", "channel", "video", "sound"]);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only." });
  if (req.headers["x-requested-with"] !== "defied-site") return res.status(400).json({ error: "Bad request." });
  const b = req.body && typeof req.body === "object" ? req.body : {};
  const context = CONTEXTS[b.context] ? b.context : "roster";
  const session = await requireAccess(req, res, CONTEXTS[context], { clients: true });
  if (!session) return;
  const url = String(b.url || "").slice(0, 600);
  const kinds = Array.isArray(b.kinds) ? b.kinds.filter((k) => KINDS.has(k)) : [];
  const client = req.access.role === "client";
  const l = parseLink(url);
  if (!l) return res.status(200).json({ ok: false, error: "Paste a Spotify, TikTok, Instagram or YouTube link." });
  if (client && !(l.platform === "spotify" && l.kind === "song")) return res.status(200).json({ ok: false, error: "Paste a Spotify song link." });
  const wrong = !l.short && wrongKind(l, kinds);
  if (wrong) return res.status(200).json({ ok: false, error: wrong, link: { platform: l.platform, kind: l.kind } });
  try {
    const r = await resolveLink(url, { paid: !client && !!b.paid, me: client ? null : session.user.id });
    if (r.ok && kinds.length && !kinds.includes(r.link.kind)) return res.status(200).json({ ok: false, error: wrongKind(r.link, kinds), link: { platform: r.link.platform, kind: r.link.kind } });
    res.setHeader("Cache-Control", "no-store");
    if (client) return res.status(200).json({ ...r, already: [], suggestions: [], paid: { needed: false } });
    return res.status(200).json(r);
  } catch (err) {
    console.error("resolve-link failed:", err?.message);
    return res.status(200).json({ ok: false, error: "Couldn't look that link up just now. Type the details in, or try again in a minute." });
  }
}
