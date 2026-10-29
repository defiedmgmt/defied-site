// Runs once a day (vercel.json "crons"): pulls the sheet onto the site so a
// change typed straight into the sheet shows up without anyone signed in,
// looks up a few missing ISRCs, and pings ClickUp when no Luminate update has
// come in for over a week. Vercel sends Authorization: Bearer $CRON_SECRET;
// without that secret set, this refuses to run at all.
import { sql } from "../../../lib/db";
import { syncSiteFromSheet } from "../../../lib/site-sync";
import { getState, setState } from "../../../lib/luminate";
import { findIsrc } from "../../../lib/isrc";
import { normalizeTitle } from "../../../lib/sheets";
import { notifyClickUp } from "../../../lib/clickup";

const STALE_DAYS = 8;
const DAY = 86400000;

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: "CRON_SECRET is not configured." });
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: "Not authorized." });
  const report = { at: new Date().toISOString() };

  try { report.sync = await syncSiteFromSheet(); } catch (err) {
    report.syncError = err.message;
    await notifyClickUp(`**Nightly sync failed**: ${err.message}\nThe site's numbers weren't refreshed tonight. [Open dashboard](https://www.defiedmgmt.com/dashboard)`);
  }

  // up to 10 songs a night that have no ISRC yet and weren't looked up in the last 2 weeks
  try {
    const rows = await sql`
      SELECT p.id, p.song, p.artist FROM placements p LEFT JOIN song_tracking t ON t.placement_id = p.id
      WHERE p.luminate_id = '' AND COALESCE(t.isrc, '') = '' AND NOT COALESCE(t.skip, false)
        AND (t.isrc_checked_at IS NULL OR t.isrc_checked_at < now() - interval '14 days')
      LIMIT 40
    `;
    const groups = new Map();
    for (const r of rows) {
      const k = `${normalizeTitle(r.song)}|${normalizeTitle(r.artist)}`;
      groups.set(k, [...(groups.get(k) || []), r]);
    }
    report.isrc = { looked: 0, found: 0 };
    for (const g of [...groups.values()].slice(0, 10)) {
      const hit = await findIsrc({ song: g[0].song, artist: g[0].artist }).catch(() => undefined);
      if (hit === undefined) break; // Deezer down: tomorrow
      report.isrc.looked++;
      if (hit) report.isrc.found++;
      const at = new Date().toISOString();
      await sql.transaction(g.map((r) => sql`
        INSERT INTO song_tracking (placement_id, isrc, isrc_source, isrc_checked_at) VALUES (${r.id}, ${hit?.isrc || ""}, ${hit ? "deezer" : ""}, ${at})
        ON CONFLICT (placement_id) DO UPDATE SET isrc = CASE WHEN song_tracking.isrc = '' THEN EXCLUDED.isrc ELSE song_tracking.isrc END,
          isrc_source = CASE WHEN song_tracking.isrc = '' THEN EXCLUDED.isrc_source ELSE song_tracking.isrc_source END,
          isrc_checked_at = EXCLUDED.isrc_checked_at, updated_at = now()
      `));
    }
  } catch (err) { report.isrcError = err.message; }

  // nothing new from Luminate in over a week: say so once a day until it comes in
  const last = await getState("lastUpload");
  const age = last?.at ? (Date.now() - new Date(last.at).getTime()) / DAY : null;
  const alerted = await getState("staleAlert");
  if ((age === null || age > STALE_DAYS) && (!alerted?.at || Date.now() - new Date(alerted.at).getTime() > DAY - 3600000)) {
    const when = age === null ? "No Luminate update has come in yet." : `The last Luminate update was ${Math.floor(age)} days ago.`;
    await notifyClickUp(`**Streams are getting stale**: ${when}\nDownload the portfolio exports and drop them on the dashboard's Luminate page. [Open dashboard](https://www.defiedmgmt.com/dashboard)`);
    await setState("staleAlert", { at: new Date().toISOString() });
    report.staleAlert = true;
  }
  await setState("cron", report);
  return res.status(200).json(report);
}
