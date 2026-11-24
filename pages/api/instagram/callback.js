// (2026-11-16) Facebook sends the Founder back here after "Continue" in the login dialog (lib/instagram.js finishConnect): the code
// becomes a system-user sign-in that never expires (2026-11-24, Unified Login), kept locked in app_state with the account it is
// for; then back to Site › Instagram, which says whether it worked
import { requireAccess } from "../../../lib/access";
import { finishConnect, scrub, KEYS } from "../../../lib/instagram";
import { setState } from "../../../lib/app-state";

const back = (res, q) => { res.writeHead(302, { Location: `/dashboard/site/instagram?instagram=${q}` }); res.end(); };
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const session = await requireAccess(req, res, "site", { whole: true });
  if (!session) return;
  res.setHeader("Cache-Control", "no-store");
  if (req.access?.role !== "founder") return back(res, "founders");
  const { code, state, error } = req.query;
  try {
    if (error) { await setState(KEYS.oauth, { result: "cancelled", at: Date.now() }); return back(res, "cancelled"); }
    return back(res, await finishConnect({ code: typeof code === "string" ? code : "", state: typeof state === "string" ? state : "", byId: session.user.id }));
  } catch (err) {
    console.error("instagram callback failed:", scrub(err?.message));
    return back(res, "failed");
  }
}
