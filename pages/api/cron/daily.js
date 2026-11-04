// Runs once a day (vercel.json "crons"): pulls the sheet onto the site so a
// change typed straight into the sheet shows up without anyone signed in,
// looks up a few missing ISRCs (and the A&R artists' Deezer pages), pings ClickUp when no Luminate update has
// come in for over a week, and keeps the two ClickUp tasks the dashboard owns
// (the weekly sync one, "Log new payments") up to date. Vercel sends
// Authorization: Bearer $CRON_SECRET; without that secret set, this refuses
// to run at all.
import { sql } from "../../../lib/db";
import { syncSiteFromSheet } from "../../../lib/site-sync";
import { getState, setState } from "../../../lib/luminate";
import { lookupIsrc } from "../../../lib/isrc";
import { refreshDeezer, refreshArIsrcs } from "../../../lib/ar-deezer";
import { runLuminateWeek } from "../../../lib/luminate-week";
import { normalizeTitle } from "../../../lib/sheets";
import { notifyClickUp } from "../../../lib/clickup";
import { checkClickUpTasks } from "../../../lib/money";

// the sheet pull plus the Stripe read behind the ClickUp tasks (see pages/api/home.js)
export const config = { maxDuration: 60 };

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

  // up to 10 songs a night that have no ISRC yet and weren't looked up in the last 2 weeks: a sure hit
  // is saved with its source, else the finder's candidates wait for one tap on the Luminate page
  try {
    const rows = await sql`
      SELECT p.id, p.song, p.artist, p.link FROM placements p LEFT JOIN song_tracking t ON t.placement_id = p.id
      WHERE p.luminate_id = '' AND COALESCE(t.isrc, '') = '' AND NOT COALESCE(t.skip, false)
        AND (t.isrc_checked_at IS NULL OR t.isrc_checked_at < now() - interval '14 days')
      LIMIT 40
    `;
    const groups = new Map();
    for (const r of rows) {
      const k = `${normalizeTitle(r.song)}|${normalizeTitle(r.artist)}`;
      groups.set(k, [...(groups.get(k) || []), r]);
    }
    report.isrc = { looked: 0, found: 0, offered: 0 };
    const start = Date.now();
    for (const g of [...groups.values()].slice(0, 10)) {
      if (Date.now() - start > 25000) break; // the rest tomorrow
      const r = await lookupIsrc({ song: g[0].song, artist: g[0].artist, link: g[0].link || g.find((x) => x.link)?.link || "" }).catch(() => ({ failed: true }));
      if (r.failed) break; // the services are down: tomorrow
      report.isrc.looked++;
      if (r.hit) report.isrc.found++; else if (r.candidates.length) report.isrc.offered++;
      const at = new Date().toISOString();
      await sql.transaction(g.map((x) => sql`
        INSERT INTO song_tracking (placement_id, isrc, isrc_source, isrc_checked_at) VALUES (${x.id}, ${r.hit?.isrc || ""}, ${r.hit?.source || ""}, ${at})
        ON CONFLICT (placement_id) DO UPDATE SET isrc = CASE WHEN song_tracking.isrc = '' THEN EXCLUDED.isrc ELSE song_tracking.isrc END,
          isrc_source = CASE WHEN song_tracking.isrc = '' THEN EXCLUDED.isrc_source ELSE song_tracking.isrc_source END,
          isrc_checked_at = EXCLUDED.isrc_checked_at, updated_at = now()
      `));
      const ids = g.map((x) => x.id);
      await (r.hit || !r.candidates.length
        ? sql`DELETE FROM isrc_candidates WHERE item = ANY(${ids})`
        : sql.transaction(ids.map((id) => sql`INSERT INTO isrc_candidates (item, song, artist, candidates) VALUES (${id}, ${g[0].song}, ${g[0].artist}, ${JSON.stringify(r.candidates)})
            ON CONFLICT (item) DO UPDATE SET candidates = EXCLUDED.candidates, checked_at = now()`))).catch((err) => { if (err?.code !== "42P01") throw err; });
    }
  } catch (err) { report.isrcError = err.message; }

  // the A&R artists' Deezer pages (fans, and the tracks a songs-only artist is followed by): a few a night
  try { report.deezer = await refreshDeezer({ limit: 8 }); report.arIsrc = await refreshArIsrcs({ limit: 3 }); } catch (err) { report.deezerError = err.message; }

  // nothing new from Luminate in over a week: say so once a day until it comes in. lastUpload is the
  // clients' exports only (A&R files don't count), and the day only counts once ClickUp took the
  // message, so an outage doesn't swallow it. The age is the numbers' own (numbersFrom: when
  // Luminate made the oldest portfolio's newest export), so dropping month-old files doesn't reset it.
  const last = await getState("lastUpload");
  const at = last?.at ? new Date(last.at).getTime() : null, made = last?.numbersFrom ? new Date(last.numbersFrom).getTime() : null;
  const byNumbers = made !== null && (at === null || made < at);
  const age = byNumbers ? (Date.now() - made) / DAY : at !== null ? (Date.now() - at) / DAY : null;
  const alerted = await getState("staleAlert");
  if ((age === null || age > STALE_DAYS) && (!alerted?.at || Date.now() - new Date(alerted.at).getTime() > DAY - 3600000)) {
    const when = age === null ? "No Luminate update has come in yet."
      : byNumbers ? `The newest Luminate numbers${last.numbersPortfolio ? ` for ${last.numbersPortfolio}` : ""} are ${Math.floor(age)} days old.`
      : `The last Luminate update was ${Math.floor(age)} days ago.`;
    const sent = await notifyClickUp(`**Streams are getting stale**: ${when}\nDownload the portfolio exports and drop them on the dashboard's Luminate page. [Open dashboard](https://www.defiedmgmt.com/dashboard)`);
    if (sent) {
      await setState("staleAlert", { at: new Date().toISOString() });
      report.staleAlert = true;
    } else report.staleAlertFailed = true; // tried again at the next run
  }
  // the weekly "clear the sync tasks" task (Mondays) and "Log new payments" (H.3/H.4): one stored
  // task each, written only with CLICKUP_TASK_WRITES=on
  try { report.clickupTasks = await checkClickUpTasks({ force: true }); } catch (err) { report.clickupTasksError = err.message; }
  // the week's "Luminate update" task: made on the Luminate day while a portfolio's file is missing
  report.luminateWeek = await runLuminateWeek();
  await setState("cron", report);
  return res.status(200).json(report);
}
