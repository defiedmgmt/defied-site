// Triggers the "Luminate Portfolio Sync" Apps Script (updateStreamData) that's
// bound to the pub master sheet — reads the latest portfolio CSV exports from
// its Drive folder and refreshes the STREAM DATA tab. Routed server-side (not
// a plain link) so the deployment URL never reaches the client bundle, and so
// a CORS-blocked client fetch to script.google.com isn't a concern.
import { requireStaff, requireSameOrigin } from "../../lib/session";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!(await requireStaff(req, res))) return;
  if (!requireSameOrigin(req, res)) return;
  const url = process.env.STREAM_SYNC_URL;
  if (!url) return res.status(500).json({ error: "STREAM_SYNC_URL is not configured." });

  try {
    const scriptRes = await fetch(url, { redirect: "follow" });
    if (!scriptRes.ok) {
      throw new Error(`Sync script responded with ${scriptRes.status}`);
    }
    const text = await scriptRes.text();
    // the script returns an HTML page on success; a plain "Sync failed"
    // banner in that body means updateStreamData() itself threw.
    if (/❌/.test(text)) {
      const msg = text.match(/❌\s*Sync failed:\s*([^<]+)/)?.[1]?.trim();
      throw new Error(msg || "Sync script reported a failure.");
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Stream sync failed." });
  }
}
