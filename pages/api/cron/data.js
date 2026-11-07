// The automated numbers' cron (list B #4, lib/data/engine.js). Hobby runs each cron at most once a day,
// so there are two: this one collects, reads the free APIs and starts the Apify runs that are due;
// /api/cron/data-collect, two hours later, collects what the webhook didn't. Vercel
// sends Authorization: Bearer $CRON_SECRET; without that secret set, this refuses to run at all.
import { tick } from "../../../lib/data/engine";
import { afterDataCron } from "../../../lib/ar/tracker-sheet";
import { setState } from "../../../lib/app-state";

export const config = { maxDuration: 300 }; // Hobby's most; the Apify runs themselves aren't waited for

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: "CRON_SECRET is not configured." });
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: "Not authorized." });
  try {
    const report = await tick();
    // r11: the A&R sheet's Watchlist with the new numbers, and the Log's Expired lines (AR_TRACKER_SHEET_WRITES only)
    report.arSheet = await afterDataCron().catch((err) => ({ error: String(err?.message || err).slice(0, 200) }));
    // kept like the daily cron's report (app_state "cronData"): the last run and its errors stay readable after
    // the response is gone. Not saving it never fails a run that worked
    await setState("cronData", report).catch((err) => console.error("data cron report not saved:", err));
    return res.status(200).json(report);
  } catch (err) {
    console.error("data cron failed:", err);
    await setState("cronData", { at: new Date().toISOString(), error: String(err?.message || err).slice(0, 200) }).catch(() => {});
    return res.status(500).json({ error: "The numbers' update failed. The last numbers stay." });
  }
}
