// Dropbox for the website's music files (lib/dropbox.js). Founders only, except the status line Site › Messages shows:
//   GET ?status=1                 { connected, at, by }
//   GET                           starts the one-time connect: off to Dropbox, back at /api/dropbox/callback
//   POST { action: "disconnect" } forgets the sign-in (the files already in Dropbox stay)
import { requireAccess } from "../../../lib/access";
import { requireSameOrigin } from "../../../lib/session";
import { pkce, authUrl, status, disconnect } from "../../../lib/dropbox";
import { setState } from "../../../lib/app-state";

export default async function handler(req, res) {
  const session = await requireAccess(req, res, "site");
  if (!session) return;
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET" && req.query.status) return res.status(200).json(await status());
    if (req.access?.role !== "founder") return res.status(403).json({ error: "Only a Founder can connect Dropbox." });
    if (req.method === "GET") {
      const p = pkce();
      await setState("dropboxPkce", { verifier: p.verifier, state: p.state, by: session.user.name || session.user.email || "", at: Date.now() });
      res.writeHead(302, { Location: authUrl(p) });
      return res.end();
    }
    if (req.method === "POST") {
      if (!requireSameOrigin(req, res)) return;
      if (req.body?.action === "disconnect") { await disconnect(); return res.status(200).json({ ok: true }); }
      return res.status(400).json({ error: "Unknown action." });
    }
    return res.status(405).json({ error: "GET or POST only" });
  } catch (err) {
    console.error("dropbox connect failed:", err);
    return res.status(502).json({ error: "Couldn't reach Dropbox. Try again in a minute." });
  }
}
