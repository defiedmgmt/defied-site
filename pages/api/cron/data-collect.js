// The automated numbers' second daily cron (vercel.json, two hours after /api/cron/data): collects the
// Apify runs the webhook didn't, and starts nothing new. Same CRON_SECRET check.
import { tick } from "../../../lib/data/engine";
import { afterDataCron } from "../../../lib/ar/tracker-sheet";
import { setState } from "../../../lib/app-state";

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: "CRON_SECRET is not configured." });
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: "Not authorized." });
  try {
    const report = await tick({ step: "collect" });
    // r11: the A&R sheet's Watchlist with the new numbers, and the Log's Expired lines (AR_TRACKER_SHEET_WRITES only)
    report.arSheet = await afterDataCron().catch((err) => ({ error: String(err?.message || err).slice(0, 200) }));
    // kept like the daily cron's report (app_state "cronDataCollect"): the last run and its errors stay readable after
    // the response is gone. Not saving it never fails a run that worked
    await setState("cronDataCollect", report).catch((err) => console.error("data collect cron report not saved:", err));
    return res.status(200).json(report);
  } catch (err) {
    console.error("data collect cron failed:", err);
    await setState("cronDataCollect", { at: new Date().toISOString(), error: String(err?.message || err).slice(0, 200) }).catch(() => {});
    return res.status(500).json({ error: "Collecting the numbers failed. The last numbers stay." });
  }
}
