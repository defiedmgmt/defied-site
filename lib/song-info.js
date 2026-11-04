// What the dashboard knows about each song beyond its card (GET /api/songs): its ISRC and where it came
// from, the ISRC finder's guesses where it wasn't sure, the pairs staff said aren't the same song, the
// clients whose sheet tab the last pull couldn't find, and the songs staff took off as "not ours".
// (Before list B #3 this came with Luminate's page; the ISRC lookups stayed.) Server-only.
import { sql, rowsOrNoneIfNoTable } from "./db";
import { getState } from "./app-state";
import { streamSheetStatus } from "./stream-sheet";

export async function songInfoState() {
  const [tracking, missingTabs, notOurs, notDuplicates, candidates, lum, streamSheet] = await Promise.all([
    sql`SELECT placement_id, isrc, isrc_source, isrc_checked_at FROM song_tracking`,
    getState("missingTabs"),
    rowsOrNoneIfNoTable(sql`SELECT client_id, song, luminate_id, removed_at FROM not_ours ORDER BY removed_at`),
    getState("notDuplicates"), // pairs of cards staff said aren't the same song (build H1)
    // what the ISRC finder offered where it wasn't sure (one-tap picking; none before its migration)
    rowsOrNoneIfNoTable(sql`SELECT item, candidates FROM isrc_candidates WHERE item NOT LIKE 'ar:%'`),
    // the day of Luminate's last numbers for the clients' songs (what the pub sheet's STREAM DATA still has)
    rowsOrNoneIfNoTable(sql`SELECT max(atd_on)::text AS day FROM lum_history WHERE area = 'roster'`),
    // STREAM DATA's writer (lib/stream-sheet.js): which numbers the sheet's streams are, on or off
    streamSheetStatus().catch(() => null),
  ]);
  const tBy = Object.fromEntries(tracking.map((t) => [t.placement_id, t]));
  return {
    tracking: Object.fromEntries(tracking.map((t) => [t.placement_id, { isrc: t.isrc, isrcSource: t.isrc_source, isrcCheckedAt: t.isrc_checked_at }])),
    missingTabs: missingTabs || [],
    notDuplicates: Object.keys(notDuplicates || {}),
    // placement id -> up to 3 { isrc, source, title, artist, cover } (only songs still without an ISRC)
    isrcCandidates: Object.fromEntries(candidates.filter((c) => !tBy[c.item]?.isrc && (c.candidates || []).length).map((c) => [c.item, c.candidates])),
    notOursList: notOurs.map((r) => ({ song: r.song, clientId: r.client_id, removedAt: r.removed_at })),
    lumLastDay: lum[0]?.day ? String(lum[0].day).slice(0, 10) : null,
    streamSheet,
  };
}
