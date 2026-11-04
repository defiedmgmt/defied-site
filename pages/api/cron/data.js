// The automated numbers' cron (list B #4, lib/data/engine.js). Hobby runs each cron at most once a day,
// so there are two: this one collects, reads the free APIs and starts the Apify runs that are due;
// /api/cron/data-collect, two hours later, collects what the webhook didn't. Vercel
// sends Authorization: Bearer $CRON_SECRET; without that secret set, this refuses to run at all.
import { tick } from "../../../lib/data/engine";

export const config = { maxDuration: 300 }; // Hobby's most; the Apify runs themselves aren't waited for

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: "CRON_SECRET is not configured." });
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: "Not authorized." });
  try {
    return res.status(200).json(await tick());
  } catch (err) {
    console.error("data cron failed:", err);
    return res.status(500).json({ error: "The numbers' update failed. The last numbers stay." });
  }
}
