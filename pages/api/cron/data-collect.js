// The automated numbers' second daily cron (vercel.json, two hours after /api/cron/data): collects the
// Apify runs the webhook didn't, and starts nothing new. Same CRON_SECRET check.
import { tick } from "../../../lib/data/engine";

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: "CRON_SECRET is not configured." });
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: "Not authorized." });
  try {
    return res.status(200).json(await tick({ step: "collect" }));
  } catch (err) {
    console.error("data collect cron failed:", err);
    return res.status(500).json({ error: "Collecting the numbers failed. The last numbers stay." });
  }
}
