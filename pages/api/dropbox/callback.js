// Dropbox sends the Founder back here after "Allow" (lib/dropbox.js connect): the code becomes a lasting sign-in, then
// back to Site › Messages, which says whether it worked
import { requireAccess } from "../../../lib/access";
import { connect } from "../../../lib/dropbox";
import { getState, setState } from "../../../lib/app-state";

const back = (res, q) => { res.writeHead(302, { Location: `/dashboard/site/messages?dropbox=${q}` }); res.end(); };
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const session = await requireAccess(req, res, "site");
  if (!session) return;
  if (req.access?.role !== "founder") return back(res, "founders");
  const { code, state, error } = req.query;
  if (error) return back(res, "cancelled");
  try {
    const p = await getState("dropboxPkce");
    if (!p || !code || p.state !== state || Date.now() - Number(p.at) > 15 * 60 * 1000) return back(res, "expired");
    await connect(String(code), p.verifier, p.by || session.user.name || "");
    await setState("dropboxPkce", null);
    return back(res, "connected");
  } catch (err) {
    console.error("dropbox callback failed:", err);
    return back(res, "failed");
  }
}
