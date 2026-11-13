// Runs once a day (vercel.json "crons"): pulls the sheet onto the site so a
// change typed straight into the sheet shows up without anyone signed in,
// looks up a few missing ISRCs (and the A&R artists' Deezer pages), keeps the ClickUp tasks the dashboard
// owns ("Log new payments", one per area) up to date, and reads each client's manager off the
// accounting sheet's INFO tab (roles: a Co-manager limited to their own artists). Vercel sends
// Authorization: Bearer $CRON_SECRET; without that secret set, this refuses
// to run at all.
import { sql } from "../../../lib/db";
import { syncSiteFromSheet } from "../../../lib/site-sync";
import { setState } from "../../../lib/app-state";
import { lookupIsrc } from "../../../lib/isrc";
import { refreshDeezer, refreshArIsrcs } from "../../../lib/ar-deezer";
import { normalizeTitle } from "../../../lib/sheets";
import { notifyClickUp } from "../../../lib/clickup";
import { checkClickUpTasks } from "../../../lib/money";
import { refreshManagers } from "../../../lib/access";

// the sheet pull plus the Stripe read behind the ClickUp tasks (see pages/api/home.js)
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: "CRON_SECRET is not configured." });
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: "Not authorized." });
  const report = { at: new Date().toISOString() };

  try { report.sync = await syncSiteFromSheet(); } catch (err) {
    report.syncError = err.message;
    // r11 launch: posting to ClickUp's Dashboard Alerts chat is its own gate (off by default)
    if (String(process.env.CLICKUP_ALERTS ?? "").trim().toLowerCase() === "on") await notifyClickUp(`**Nightly sync failed**: ${err.message}\nThe site's numbers weren't refreshed tonight. [Open dashboard](https://www.defiedmgmt.com/dashboard)`);
  }

  // up to 60 songs a night that have no ISRC yet and weren't looked up in the last 2 weeks: a sure hit
  // is saved with its source, else the finder's candidates wait for one tap on the song (the ISRC is how
  // one song with several Spotify ids is counted once, and how a song without a link is found on Spotify).
  // (2026-11-13: 10 a night left a 178-song Spotify import for 17 nights. A song with a Spotify link is one free
  // Spotify call now, lib/isrc.js, spaced like the rest: the 25 s below still decides, and what doesn't fit waits for
  // tomorrow. The whole cron took 14 s with 10 of its 60)
  try {
    const rows = await sql`
      SELECT p.id, p.song, p.artist, p.link FROM placements p LEFT JOIN song_tracking t ON t.placement_id = p.id
      WHERE COALESCE(t.isrc, '') = '' AND NOT COALESCE(t.skip, false)
        AND (t.isrc_checked_at IS NULL OR t.isrc_checked_at < now() - interval '14 days')
      LIMIT 240
    `;
    const groups = new Map();
    for (const r of rows) {
      const k = `${normalizeTitle(r.song)}|${normalizeTitle(r.artist)}`;
      groups.set(k, [...(groups.get(k) || []), r]);
    }
    report.isrc = { looked: 0, found: 0, offered: 0 };
    const start = Date.now();
    for (const g of [...groups.values()].slice(0, 60)) {
      if (Date.now() - start > 25000) break; // the rest tomorrow
      const r = await lookupIsrc({ song: g[0].song, artist: g[0].artist, link: g[0].link || g.find((x) => x.link)?.link || "" }).catch(() => ({ failed: true }));
      if (r.failed || r.retry) break; // the services are down (or Spotify didn't answer): tomorrow
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

  // each client's manager from the accounting sheet's INFO tab (Site › Users; reads the sheet only)
  try { const m = await refreshManagers(); report.managers = m.error ? { error: m.error } : { matched: m.matched }; } catch (err) { report.managersError = err.message; }
  // "Log new payments" and the Publishing, A&R and Money tasks (one stored task each), written only with
  // CLICKUP_TASK_WRITES=on
  try { report.clickupTasks = await checkClickUpTasks({ force: true }); } catch (err) { report.clickupTasksError = err.message; }
  await setState("cron", report);
  return res.status(200).json(report);
}
