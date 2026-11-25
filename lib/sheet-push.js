// One song's rows on the pub master sheet, one per split-holder, in their own tab: the write behind
// pages/api/sheets-push.js (the song editor's Save and Add Song, To do's Confirm and merge card) and lib/auto-add.js (a roster
// artist's new release). Moved out of the route (2026-11-17) with no change to what it does: the route still decides who may
// push what (the checks before it); this is the tab lookup, the claim of a tab for a new split-holder, the guarded row write
// (lib/sheet-writes.js guardedPush) and the facts update after it. It answers { status, body } exactly as the route did; an
// error it throws (a tab that is another client's, Google refusing a call: err.readBack says whether the write was read back)
// is the caller's to catch. Server-only.
import { getSheetsClient, getSheetId, listTabs, findTab, tabsOfOthers, claimTabForNewCollaborator } from "./sheets";
import { guardedPush } from "./sheet-writes";
import { pushShareProblem } from "./split-fixes";
import { sql } from "./db";
import { findByName } from "./names";
import { withTabLock, TAB_BUSY } from "./people-sync";
import { clearSheetFail } from "./sheet-fails";

// saved: the song as the site holds it now ({ client_id, splits }); known: every client's id, name and Sheet tab name
// (lib/sheets.js loadClientTabNames); whose(name): the client a split's name belongs to (lib/names.js ownerOf, for the song's own client);
// by: who is writing, for the one-tab-at-a-time lock's note
export async function pushSongRows({ placementId, song, artist, luminateId, splits, liveIds, check, saved, known, whose, by }) {
  const sheets = getSheetsClient();
  const spreadsheetId = getSheetId();
  let tabs = await listTabs(sheets, spreadsheetId);

  const results = [];
  for (const split of splits) {
    const name = (split.name || "").trim();
    const percent = Number(split.percent) || 0;
    if (!name || percent <= 0) continue;

    // the share's rules (pushShareProblem): the split-holder's own share in the saved split
    const owner = whose(name);
    const own = findByName(saved.splits || [], owner?.name || name) || findByName(saved.splits || [], name);
    const rules = { site: own ? Number(own.percent) : null, splits: saved.splits || [], check: check === "confirm" || check === "merge" ? check : null, who: owner?.name || name };
    let tab = findTab(tabs, name, tabsOfOthers(known, owner));
    let created = false;
    if (!tab) {
      // the tab of that exact name is another client's: never write into
      // it, and the sheet won't take a second tab of the same name either
      const n = name.toLowerCase();
      if (tabs.some((t) => t.title.trim().toLowerCase() === n)) {
        throw new Error(`The pub sheet's "${name}" tab is another client's. Give this client their own "Sheet tab name", then save the song again.`);
      }
      // a new tab has no share of its own to keep: the share's rules first, before a tab is claimed for it
      const bad = pushShareProblem({ ...rules, percent });
      if (bad) return { status: 409, body: { error: `${bad} Nothing was written to the pub sheet.`, refused: true, written: results.length > 0, results } };
      // (2026-11-13 review) one tab claimed at a time, with the Roster form's "Give them a pub sheet tab"
      // (lib/people-sync.js withTabLock): both rename the lowest free WRITER tab. The tab list is read again inside
      // the lock, so a tab just made for this name is used, not claimed twice; a WRITER tab a client goes by (their
      // Sheet tab name) is never claimed.
      const skip = tabsOfOthers(known, owner);
      const got = await withTabLock(by, async () => {
        const now = await listTabs(sheets, spreadsheetId);
        const there = findTab(now, name, skip);
        return there ? { tab: there, made: false } : { tab: await claimTabForNewCollaborator(sheets, spreadsheetId, name, now, skip), made: true };
      }, { waits: 2 });
      if (got.busy) return { status: 409, body: { error: `${TAB_BUSY} ${results.length ? `${name}'s share wasn't written yet.` : "Nothing was written to the pub sheet."}`, refused: true, written: results.length > 0, results } };
      tab = got.value.tab;
      created = got.value.made;
      tabs = await listTabs(sheets, spreadsheetId); // refresh — a tab was renamed/created
    }

    const syncId = `${placementId}:${name.toLowerCase()}`;
    // priority: (1) this exact syncId already owns a row — the normal
    // case; (2) the Luminate ID is the one field that identifies the
    // actual song regardless of what the site currently says about it —
    // title/artist/splits can all change, so a shared Luminate ID means
    // "this is obviously the same song" even if the local placement's id
    // changed (deleted and re-added, a stale re-sync) and its old syncId
    // is now sitting on the row unmatched; (3) a real pre-existing row
    // with the same title, where any syncId already there is either
    // blank or points at a placement that no longer exists in the
    // pushing browser's own placement list (liveIds) — rows typed by hand,
    // and ones written back when the site kept songs in each browser's
    // localStorage (two devices' copies of "the same" song could carry
    // different ids), have no other way to be reconciled.
    // (lib/sheet-writes.js guardedPush finds the row in that order, then guards the write; the row's Luminate ID
    // cell, M, is never written: list B #3)
    const out = await guardedPush(sheets, spreadsheetId, tab.title, { song, artist: artist || "", percent, syncId, luminateId, liveIds, rules });
    if (out.refused) return { status: 409, body: { error: out.refused, refused: true, written: results.length > 0, results } };
    if (out.alarm) console.error(`sheets-push: ${out.alarm}`);
    if (out.restored) console.error(`sheets-push: put the standard formula back in ${out.restored.join(", ")} on the ${tab.title} tab (it was blank)`);
    results.push({ name, tab: tab.title, tabCreated: created, updated: out.updated, row: out.row, ...(out.restored ? { restored: out.restored } : {}), ...(out.extended ? { extended: out.extended } : {}), ...(out.alarm ? { alarm: out.alarm } : {}) });
    // (2026-11-10) the song's own client's share as just written, so To do and Sync don't call it different from the
    // sheet until the next pull (the row's Net Streams follow the share; a song with no facts yet gets them then)
    if (owner?.id === saved.client_id && out.row) {
      await sql`UPDATE sheet_song_facts SET sheet_share = ${percent}, sheet_row = ${out.row}, net_streams = CASE WHEN sheet_share > 0 THEN net_streams * ${percent} / sheet_share ELSE net_streams END, synced_at = now()
        WHERE placement_id = ${placementId} AND client_id = ${saved.client_id}`.catch((err) => console.error("sheets-push: facts", err));
      // (2026-11-24, live: four prodchxse songs added from Possible placements at 10:27 PM had their rows on the ProdChxse tab, rows 10-13, yet Songs
      // to update said "Not on the pub sheet" for each, because the last pull, at 10:09 PM, was from before they existed, and the UPDATE above only
      // changes a song that already has facts) a song with none yet (Add Song, the auto-add, Possible placements' Add, Add to pub sheet) gets them
      // now: its row and the share just written; its Net Streams are 0 until the next pull reads the row (a new row has no Luminate ID, so no
      // streams). DO NOTHING keeps whatever is there: the UPDATE above, or a pull that saved this song's facts in between, is newer than this.
      await sql`INSERT INTO sheet_song_facts (placement_id, client_id, sheet_row, sheet_share, net_streams, synced_at)
        VALUES (${placementId}, ${saved.client_id}, ${out.row}, ${percent}, 0, now()) ON CONFLICT (placement_id, client_id) DO NOTHING`.catch((err) => console.error("sheets-push: new facts", err));
      // the song's row is on the sheet: a failed write said earlier (lib/sheet-fails.js) is over
      await clearSheetFail(placementId).catch((err) => console.error("sheets-push: sheet failure note", err));
    }
  }

  // every split was skipped (blank name or 0%) — nothing was written
  // anywhere. That's silent data loss from the caller's point of view if
  // it comes back looking like success, so make it a real error instead.
  if (results.length === 0) {
    return { status: 400, body: { error: "Nothing was synced — no split has a name and a percentage above 0%." } };
  }

  const alarms = results.map((r) => r.alarm).filter(Boolean);
  return { status: 200, body: { ok: true, results, ...(alarms.length ? { alarm: alarms.join(" ") } : {}) } };
}
