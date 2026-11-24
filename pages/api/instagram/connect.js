// (2026-11-16) Site › Instagram's "Connect Instagram" (Founders): off to Meta's login dialog for the company's Facebook Login for
// Business configuration (2026-11-24, Unified Login), back at /api/instagram/callback. Without INSTAGRAM_APP_ID,
// INSTAGRAM_APP_SECRET and INSTAGRAM_CONFIG_ID it goes straight back and says what's missing.
import { requireAccess } from "../../../lib/access";
import { startConnect, scrub } from "../../../lib/instagram";

const back = (res, q) => { res.writeHead(302, { Location: `/dashboard/site/instagram?instagram=${q}` }); res.end(); };
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const session = await requireAccess(req, res, "site", { whole: true });
  if (!session) return;
  res.setHeader("Cache-Control", "no-store");
  if (req.access?.role !== "founder") return res.status(403).json({ error: "Only a Founder can connect Instagram." });
  try {
    const url = await startConnect({ host: req.headers.host, by: session.user.name || session.user.email || "", byId: session.user.id });
    res.writeHead(302, { Location: url });
    return res.end();
  } catch (err) {
    console.error("instagram connect start failed:", scrub(err?.message));
    return back(res, err?.status === 503 ? "setup" : "failed");
  }
}
