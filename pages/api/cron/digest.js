// List B #9, the Monday digests' cron (lib/digest.js). vercel.json runs it Mondays at 13:00 and 14:00 UTC
// (Hobby fires each within the hour): 9 AM New York in summer (EDT) and in winter (EST). It only works
// Monday 8:00-11:59 New York time, and digest_runs keeps each digest to once a week, so the cron that
// isn't needed this season does nothing. Posting needs DIGEST_WRITES=on (default off). Vercel sends
// Authorization: Bearer $CRON_SECRET; without that secret set, this refuses to run at all.
import { runDigests, dueNow, nyParts } from "../../../lib/digest";

export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: "CRON_SECRET is not configured." });
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: "Not authorized." });
  const now = new Date();
  if (!dueNow(now)) return res.status(200).json({ due: false, newYork: nyParts(now) });
  try {
    return res.status(200).json({ due: true, ...(await runDigests({ now })) });
  } catch (err) {
    console.error("digest cron failed:", err);
    return res.status(500).json({ error: "The Monday digest didn't finish." });
  }
}
