// (2026-11-16) Site › Instagram (components/dash/instagram.jsx, lib/instagram.js): staff with Site, every artist at once.
//   GET                                   { connected, username, expiresAt, missing, postsOn, canConnect, uploads, roster, posts, pending, last }
//                                         (reads only what the site keeps: no call to Meta, and nothing renews. The system-user sign-in never expires)
//   POST { action: "lookup", url }        a Spotify song or album link → title, artists (with handles), cover, tracks, producer guess
//   POST { action: "publish", post }      posts it (INSTAGRAM_POSTS=on only) → { mediaId, permalink, warning? }; 202 { pending } while a
//                                         video is still being readied; { action: "publish", resume: true } carries on with it.
//                                         warning: it posted, but Instagram left the caption or the tags off (media_publish's config_issue)
//   POST { action: "discard" }            forgets the post that's waiting on Instagram (nothing was posted)
//   POST { action: "disconnect" }         Founders: forgets the Instagram sign-in
// The sign-in itself never leaves the server; every error line is scrubbed of it.
import { requireAccess } from "../../lib/access";
import { requireSameOrigin } from "../../lib/session";
import { blobConfigured } from "../../lib/images";
import { offText } from "../../lib/preview";
import { IgError, scrub, igStatus, publish, checkPost, discardPending, pendingInfo, recentPosts, disconnect } from "../../lib/instagram";
import { lookup, rosterHandles } from "../../lib/ig-lookup";

// a post with a video can wait ~42 s on Instagram (lib/instagram.js BUDGET_MS), then publishes
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const session = await requireAccess(req, res, "site", { whole: true });
  if (!session) return;
  res.setHeader("Cache-Control", "no-store");
  const founder = req.access?.role === "founder";
  const by = session.user.name || session.user.email || "";
  try {
    if (req.method === "GET") {
      const status = await igStatus();
      const [roster, posts, pending] = await Promise.all([rosterHandles(), recentPosts(10), pendingInfo()]);
      return res.status(200).json({ ...status, canConnect: founder, uploads: blobConfigured(), roster, posts, pending });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    if (!requireSameOrigin(req, res)) return;
    const b = req.body || {};
    if (b.action === "lookup") return res.status(200).json(await lookup(String(b.url || "").slice(0, 500)));
    if (b.action === "publish") {
      let post = null;
      if (!b.resume) {
        const c = checkPost(b.post);
        if (c.error) return res.status(400).json({ error: c.error });
        post = c.post;
      }
      const done = await publish({ post, by, resume: !!b.resume });
      return res.status(200).json({ ok: true, ...done });
    }
    if (b.action === "discard") { await discardPending(); return res.status(200).json({ ok: true }); }
    if (b.action === "disconnect") {
      if (!founder) return res.status(403).json({ error: "Only a Founder can disconnect Instagram." });
      await disconnect();
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    if (err instanceof IgError) {
      if (err.pending) return res.status(202).json({ pending: true, error: err.message });
      return res.status(err.status || 502).json({ error: err.off ? offText(err.message) : err.message, ...(err.off && { off: true }) });
    }
    console.error("instagram route failed:", scrub(err?.message));
    return res.status(500).json({ error: "Something went wrong. Try again in a minute." });
  }
}
