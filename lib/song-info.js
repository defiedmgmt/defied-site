// What the dashboard knows about each song beyond its card (GET /api/songs): its ISRC and where it came
// from, the ISRC finder's guesses where it wasn't sure, the pairs staff said aren't the same song, the
// clients whose sheet tab the last pull couldn't find, the songs staff took off as "not ours", and (2026-11-17) the songs added
// automatically that nobody has said OK to yet (lib/auto-add.js, lib/auto-added.js), and (2026-11-18) the possible placements the credits scan found
// that nobody has said Add or Not ours to (lib/credits/scan.js, lib/credits/possible.js), and (2026-11-24) why a song's pub sheet row couldn't be
// written, when a write of it failed (lib/sheet-fails.js).
// (Before list B #3 this came with Luminate's page; the ISRC lookups stayed.) Server-only.
import { sql, rowsOrNoneIfNoTable } from "./db";
import { getState } from "./app-state";
import { streamSheetStatus } from "./stream-sheet";
import { uncheckedAutoAdds } from "./auto-added";
import { pendingPossible } from "./credits/possible";
import { sheetFailsOf, SHEET_FAILS_KEY } from "./sheet-fails";

export async function songInfoState() {
  const [tracking, missingTabs, notOurs, notDuplicates, candidates, lum, streamSheet, autoAdded, possible, sheetFails] = await Promise.all([
    sql`SELECT placement_id, isrc, isrc_source, isrc_checked_at, skip FROM song_tracking`,
    getState("missingTabs"),
    rowsOrNoneIfNoTable(sql`SELECT client_id, song, luminate_id, removed_at FROM not_ours ORDER BY removed_at`),
    getState("notDuplicates"), // pairs of cards staff said aren't the same song (build H1)
    // what the ISRC finder offered where it wasn't sure (one-tap picking; none before its migration)
    rowsOrNoneIfNoTable(sql`SELECT item, candidates FROM isrc_candidates WHERE item NOT LIKE 'ar:%'`),
    // the day of Luminate's last numbers for the clients' songs (what the pub sheet's STREAM DATA still has)
    rowsOrNoneIfNoTable(sql`SELECT max(atd_on)::text AS day FROM lum_history WHERE area = 'roster'`),
    // STREAM DATA's writer (lib/stream-sheet.js): which numbers the sheet's streams are, on or off
    streamSheetStatus().catch(() => null),
    getState("autoAdded"), // the songs lib/auto-add.js added, { [Spotify track id]: { placementId, clientId, at, checked? } }
    getState("creditsFound"), // the possible placements the credits scan found, { ["<Spotify track id>|<client id>"]: { song, artist, clientId, source, roles, credit, ... } }
    getState(SHEET_FAILS_KEY), // (2026-11-24) why a song's pub sheet row couldn't be written, { [placement id]: { error, at } } (lib/sheet-fails.js)
  ]);
  const tBy = Object.fromEntries(tracking.map((t) => [t.placement_id, t]));
  return {
    tracking: Object.fromEntries(tracking.map((t) => [t.placement_id, { isrc: t.isrc, isrcSource: t.isrc_source, isrcCheckedAt: t.isrc_checked_at, ...(t.skip ? { skip: true } : {}) }])),
    missingTabs: missingTabs || [],
    notDuplicates: Object.keys(notDuplicates || {}),
    // placement id -> up to 3 { isrc, source, title, artist, cover } (only songs still without an ISRC)
    isrcCandidates: Object.fromEntries(candidates.filter((c) => !tBy[c.item]?.isrc && (c.candidates || []).length).map((c) => [c.item, c.candidates])),
    notOursList: notOurs.map((r) => ({ song: r.song, clientId: r.client_id, removedAt: r.removed_at })),
    lumLastDay: lum[0]?.day ? String(lum[0].day).slice(0, 10) : null,
    streamSheet,
    // [{ id (Spotify track id), placementId, clientId, at }]: the ones still waiting for an OK (To do's "songs added automatically")
    autoAdded: uncheckedAutoAdds(autoAdded),
    // [{ key, spotifyId, clientId, client, song, artist, releaseDate, source, roles, credit, alias, ... }]: To do's "N possible placements", the newest release first
    possible: pendingPossible(possible),
    // { [placement id]: { error, at } }: Songs to update says it beside "Not on the pub sheet", with Add to pub sheet to try again
    sheetFails: sheetFailsOf(sheetFails),
  };
}
