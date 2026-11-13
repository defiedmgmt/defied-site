// Writes one row per split-holder into their tab on the pub master sheet
// whenever a song is added/edited on the site. Never touches the sheet's
// formula columns (streams/revenue/admin fee/forecast) — only Song Title,
// Recording Artist, that person's Writer Share %, and a Site Sync ID used to
// find the same row again on a later edit instead of duplicating it. (The
// row's Luminate ID is only read, to find the row: it's never written since
// list B #3.)
// r11 todofix: every push goes through the formula guard here, whoever sends it
// (the song editor's Save, To do's Confirm and merge card, a page opened before
// a deploy, a hand-made request): lib/sheet-writes.js guardedPush reads the
// tab with FORMULA before writing and refuses, naming the cell, a formula in
// A, B, D or N, the Total row or below it, or a share that fails
// pushShareProblem (the share saved on the site, one decimal, and with
// check "confirm" a split of exactly 100%, "merge" at most 100%); then reads
// the tab again and answers with a loud `alarm` if any formula changed.
// A refusal is a 409 { error, refused, written }; a 502 says whether its
// write was read back (checked, alarm).
// (2026-11-13) The one formula write: a formula column of the row being
// written that's blank (Sauceproducedit's C15 lost its streams lookup by hand,
// and it's the next row a song lands on) gets its standard formula back in the
// same guarded write, so the song's streams count; each result says which
// (`restored`), and the log too. A typed value there is never touched.
import {
  getSheetsClient, getSheetId, listTabs, findTab, loadClientTabNames, tabsOfOthers, claimTabForNewCollaborator,
} from "../../lib/sheets";
import { guardedPush } from "../../lib/sheet-writes";
import { pushShareProblem } from "../../lib/split-fixes";
import { requireSameOrigin } from "../../lib/session";
import { requireAccess, limited, mayUseClient } from "../../lib/access";
import { sql } from "../../lib/db";
import { ownerOf, findByName } from "../../lib/names";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const session = await requireAccess(req, res, "publishing", { clients: true });
  if (!session) return;
  if (!requireSameOrigin(req, res)) return;
  const { placementId, song, artist, luminateId, splits, liveIds, check } = req.body || {};
  if (!placementId || !song || !Array.isArray(splits) || splits.length === 0) {
    return res.status(400).json({ error: "placementId, song, and splits are required." });
  }

  const isStaff = session.user.role === "staff";
  try {
    // whose song this is (saved just before this push): a split under one of
    // that client's own names is theirs, even where another client's tab
    // override reads the same; its saved split is what each share is checked
    // against (r11 todofix)
    const known = await loadClientTabNames();
    const [saved] = await sql`SELECT client_id, splits FROM placements WHERE id = ${placementId}`;
    const songClient = isStaff ? saved?.client_id : session.user.clientId;
    const whose = (name) => ownerOf(known, name, songClient);
    // staff limited to their own artists (lib/roles.js) push only those artists' songs
    if (isStaff && limited(req) && !mayUseClient(req, songClient)) return res.status(403).json({ error: "That song isn't one of your artists'." });
    // a client session may only ever write their own split (the site's own
    // caller already sends exactly one entry: their own name/percent) — never
    // let a client-controlled request smuggle a write into someone else's tab.
    if (!isStaff && !splits.every((s) => whose((s.name || "").trim())?.id === session.user.clientId)) {
      return res.status(403).json({ error: "Not authorized for that split." });
    }
    // (every caller saves the song first: a push for one the site doesn't have writes nothing)
    if (!saved) return res.status(409).json({ error: "That song isn't saved on the site, so nothing was written to the pub sheet. Reload the page and save it again.", refused: true, written: false });

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
        if (bad) return res.status(409).json({ error: `${bad} Nothing was written to the pub sheet.`, refused: true, written: results.length > 0, results });
        tab = await claimTabForNewCollaborator(sheets, spreadsheetId, name, tabs);
        tabs = await listTabs(sheets, spreadsheetId); // refresh — a tab was renamed/created
        created = true;
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
      if (out.refused) return res.status(409).json({ error: out.refused, refused: true, written: results.length > 0, results });
      if (out.alarm) console.error(`sheets-push: ${out.alarm}`);
      if (out.restored) console.error(`sheets-push: put the standard formula back in ${out.restored.join(", ")} on the ${tab.title} tab (it was blank)`);
      results.push({ name, tab: tab.title, tabCreated: created, updated: out.updated, row: out.row, ...(out.restored ? { restored: out.restored } : {}), ...(out.alarm ? { alarm: out.alarm } : {}) });
      // (2026-11-10) the song's own client's share as just written, so To do and Sync don't call it different from the
      // sheet until the next pull (the row's Net Streams follow the share; a song with no facts yet gets them then)
      if (owner?.id === saved.client_id && out.row) {
        await sql`UPDATE sheet_song_facts SET sheet_share = ${percent}, sheet_row = ${out.row}, net_streams = CASE WHEN sheet_share > 0 THEN net_streams * ${percent} / sheet_share ELSE net_streams END, synced_at = now()
          WHERE placement_id = ${placementId} AND client_id = ${saved.client_id}`.catch((err) => console.error("sheets-push: facts", err));
      }
    }

    // every split was skipped (blank name or 0%) — nothing was written
    // anywhere. That's silent data loss from the caller's point of view if
    // it comes back looking like success, so make it a real error instead.
    if (results.length === 0) {
      return res.status(400).json({ error: "Nothing was synced — no split has a name and a percentage above 0%." });
    }

    const alarms = results.map((r) => r.alarm).filter(Boolean);
    return res.status(200).json({ ok: true, results, ...(alarms.length ? { alarm: alarms.join(" ") } : {}) });
  } catch (err) {
    // a write call that failed was read back all the same (it may have landed): its answer goes with the error
    const back = err.readBack;
    if (back && !back.ok) console.error(`sheets-push: ${back.alarm}`);
    return res.status(502).json({ error: err.message || "Sheet push failed.", ...(back ? { checked: true, ...(back.ok ? {} : { alarm: back.alarm }) } : {}) });
  }
}
