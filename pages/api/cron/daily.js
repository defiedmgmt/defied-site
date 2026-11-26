// Runs once a day (vercel.json "crons"): pulls the sheet onto the site so a
// change typed straight into the sheet shows up without anyone signed in,
// gives a writer tab that's running out of song rows more of them (lib/sheet-rows.js),
// looks up a few missing ISRCs and Spotify links (and the A&R artists' Deezer pages), keeps the ClickUp tasks the dashboard
// owns ("Log new payments", one per area) up to date, reads each client's manager off the
// accounting sheet's INFO tab (roles: a Co-manager limited to their own artists) and, LAST, puts a roster artist's
// new releases on the site and the pub sheet with the assumed split (lib/auto-add.js). Vercel sends
// Authorization: Bearer $CRON_SECRET; without that secret set, this refuses
// to run at all. (2026-11-17) A step that went wrong, the data refresh not having run for 26 hours and the Monday digest not having
// posted are told to the founders in ClickUp once the report is saved (lib/alerts.js), and so is a run that throws.
// (2026-11-18) The auto-add is last: it is the one step that can spend a lot of Google's per-minute Sheets quota (seven reads a song), and on
// Nov 18 it used up the minute before the sheet pull and the managers read, which failed. The core steps get the quota first; whatever the
// auto-add can't finish waits for tomorrow (lib/auto-add.js). A Sheets request that Google turns away for the quota waits and tries again
// (lib/sheets.js), but never past 45 seconds into this run (the whole run has 60).
// (2026-11-20) Schedule A (lib/schedule-a.js) is the very last step, after the auto-add, so a song it just put on the site is on the sheet the same night.
import { syncSiteFromSheet } from "../../../lib/site-sync";
import { setState } from "../../../lib/app-state";
import { lookupIsrc } from "../../../lib/isrc";
import { findNightly } from "../../../lib/isrc-nightly";
import { refreshDeezer, refreshArIsrcs } from "../../../lib/ar-deezer";
import { normalizeTitle, withSheetsDeadline } from "../../../lib/sheets";
import { notifyClickUp } from "../../../lib/clickup";
import { checkClickUpTasks } from "../../../lib/money";
import { refreshManagers } from "../../../lib/access";
import { keepRoom } from "../../../lib/sheet-rows";
import { runPeopleLink } from "../../../lib/people-link";
import { runAutoAdds } from "../../../lib/auto-add";
import { runScheduleA, scheduleAOn } from "../../../lib/schedule-a";
import { runAutoLog } from "../../../lib/auto-log";
import { alert, alertDaily, plainWhy, WHOLE_RUN } from "../../../lib/alerts";

// the sheet pull plus the Stripe read behind the ClickUp tasks (see pages/api/home.js)
export const config = { maxDuration: 60 };

// every step below is in its own try, so what can still throw here is the report's save: it is said, not left to Vercel's own 500
export default async function handler(req, res) {
  try { return await withSheetsDeadline(Date.now() + 45000, () => run(req, res)); } catch (err) {
    console.error("daily cron failed:", err);
    await alert({ job: "Daily update", step: WHOLE_RUN, error: err });
    if (!res.headersSent) return res.status(500).json({ error: "The daily update didn't finish." });
  }
}

async function run(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: "CRON_SECRET is not configured." });
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: "Not authorized." });
  const report = { at: new Date().toISOString() };
  const t0 = Date.now(); // (2026-11-13) the ISRC loop stops by 45 s in, whatever ran before it (maxDuration 60)

  // (2026-11-13) a client's tab under 20 empty song rows gets 50 more, behind PUB_SHARE_WRITES (lib/sheet-rows.js); what
  // went wrong goes to ClickUp's Dashboard Alerts like a failed sync. Before the pull: rows added move the tab's last song
  // row down, and the pull then saves every song's row as it is now
  try {
    const r = await keepRoom({ budgetMs: 15000 });
    report.rows = { extended: r.extended, refused: r.refused, failed: r.failed, later: r.later, fewest: [...r.room].filter((x) => x.free != null).sort((a, b) => a.free - b.free)[0] || null };
    const trouble = [...r.refused.map((x) => x.reason), ...r.failed.map((x) => `${x.tab}: ${x.error}`), ...r.extended.filter((x) => x.alarm).map((x) => x.alarm)];
    if (trouble.length && String(process.env.CLICKUP_ALERTS ?? "").trim().toLowerCase() === "on") await notifyClickUp(`**Pub sheet rows**: ${trouble.map(plainWhy).join(" ")}\n[Open dashboard](https://www.defiedmgmt.com/dashboard/site/sync)`);
  } catch (err) { report.rowsError = err.message; }

  try { report.sync = await syncSiteFromSheet(); } catch (err) {
    report.syncError = err.message;
    // r11 launch: posting to ClickUp's Dashboard Alerts chat is its own gate (off by default)
    if (String(process.env.CLICKUP_ALERTS ?? "").trim().toLowerCase() === "on") await notifyClickUp(`**Nightly sync failed**: ${plainWhy(err.message)}\nThe site's numbers weren't refreshed tonight. [Open dashboard](https://www.defiedmgmt.com/dashboard)`);
  }

  // up to 60 songs a night that have no ISRC yet and weren't looked up in the last 2 weeks: a sure hit
  // is saved with its source, else the finder's candidates wait for one tap on the song (the ISRC is how
  // one song with several Spotify ids is counted once, and how a song without a link is found on Spotify).
  // (2026-11-13: 10 a night left a 178-song Spotify import for 17 nights. A song with a Spotify link is one free
  // Spotify call now, lib/isrc.js, spaced like the rest: the 25 s below still decides, and what doesn't fit waits for
  // tomorrow. The whole cron took 14 s with 10 of its 60)
  // (2026-11-23, the owner: "we shld try and pull everything") lib/isrc-nightly.js: a sure hit on Spotify also fills the song's link, a song with an
  // ISRC and no link is found on Spotify by its ISRC, and the songs marked "Not on streaming" are looked at again once a week (the mark comes off when
  // Spotify has them). All inside the same 25 s and 45 s, and what it saves is marked for the Schedule A sheet, which the last step below writes.
  // (2026-11-23, review) The two new steps (the link by ISRC, the weekly look at the marked songs) end by t0 + 30 s whatever the loop has left, and each Spotify
  // call in them is cut at 5 s (lib/isrc-nightly.js laterMs, callMs): they must not spend the seconds the Schedule A step at the end of this run needs (about 3 of the 60)
  try {
    await findNightly({ report, lookup: lookupIsrc, normalizeTitle, t0 });
  } catch (err) { report.isrcError = err.message; }

  // the A&R artists' Deezer pages (fans, and the tracks a songs-only artist is followed by): a few a night
  try { report.deezer = await refreshDeezer({ limit: 8 }); report.arIsrc = await refreshArIsrcs({ limit: 3 }); } catch (err) { report.deezerError = err.message; }

  // each client's manager from the accounting sheet's INFO tab (Site › Users; reads the sheet only)
  try { const m = await refreshManagers(); report.managers = m.error ? { error: m.error } : { matched: m.matched }; } catch (err) { report.managersError = err.message; }
  // (2026-11-14) one person, same info everywhere (lib/people-link.js): the logins, the roster, the team page and INFO,
  // anyone new on one side added hidden on the others (PEOPLE_AUTOLINK=off stops it; INFO also needs ACCOUNTING_SHEET_WRITES)
  try {
    const r = await runPeopleLink({ by: "the nightly sync", auto: true });
    report.people = r.off ? { off: true } : r.busy ? { busy: true } : r.waiting ? { waiting: "the first Sync people now" } : { created: r.created, sheet: r.sheet, flags: (r.flags || []).length, ...(r.error ? { error: r.error } : {}) };
  } catch (err) { report.peopleError = err.message; }
  // (2026-11-26) Auto-log (lib/auto-log.js): the Stripe payments Log it places with certainty go on the Income tab by themselves (2026-11-26 owner: automatic;
  // unless a Founder turned it off, never without ACCOUNTING_SHEET_WRITES, never on a preview), with one ClickUp note of what it did. Before the ClickUp tasks, so
  // "Log new payments" counts what it added. Skipped with under 15 s of the 45 s Sheets budget left (a page load or tomorrow adds them); in the report when it ran
  try {
    const a = Date.now() - t0 > 30000 ? { skipped: "out of time" } : await runAutoLog();
    if (!a.off) report.autoLog = a;
  } catch (err) { report.autoLogError = err.message; }
  // "Log new payments" and the Publishing, A&R and Money tasks (one stored task each), written only with
  // CLICKUP_TASK_WRITES=on
  try { report.clickupTasks = await checkClickUpTasks({ force: true }); } catch (err) { report.clickupTasksError = err.message; }

  // (2026-11-17) a roster artist's new release goes on the site and on the pub sheet by itself, with the assumed split (lib/auto-add.js;
  // AUTO_ADD_SONGS=off stops it). (2026-11-18) Last, so the steps above had Google's per-minute quota first: it first finishes the pub
  // sheet rows an earlier night left undone, then adds new songs, at most 40 estimated reads in all. The new rows are read back by tomorrow's
  // pull. It stops at the first thing that goes wrong and says so in the report; whatever it does never keeps the report from being saved.
  // 15 s at most, and never past 50 s into the run (the whole cron has 60: what is left of it after the steps above)
  try { report.autoAdd = await runAutoAdds({ budgetMs: Math.min(15000, 50000 - (Date.now() - t0)) }); } catch (err) { report.autoAddError = err.message; }
  // (2026-11-20) Schedule A, the sheet of every producer's songs and shares (lib/schedule-a.js; SCHEDULE_A_SHEET_ID names it, SCHEDULE_A_WRITES=off stops it): one read of the
  // sheet and, when something changed, one write. In its own try, 12 s at most and never past the 42nd second of the run: the report's save and alertDaily's 8 seconds still
  // come after it, inside the 60. With under 3 s left it is skipped and the next trigger (a save, the Sync check, tomorrow) does it; another run in progress answers
  // { busy } and the change is marked for the Sync check. It never throws; its answer is in the report only when it is set up
  try { if (scheduleAOn()) report.scheduleA = await runScheduleA({ source: "the nightly update", budgetMs: Math.min(12000, Math.max(0, 50000 - (Date.now() - t0) - 8000)) }); } catch (err) { report.scheduleAError = err.message; }
  await setState("cron", report);
  await alertDaily(report); // after the save, so a slow ClickUp can't cost the report; it never throws and waits 8 s at the most
  return res.status(200).json(report);
}
