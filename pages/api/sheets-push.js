// Writes one row per split-holder into their tab on the pub master sheet
// whenever a song is added/edited on the site. Never touches the sheet's
// formula columns (streams/revenue/admin fee/forecast) — only Song Title,
// Recording Artist, that person's Writer Share %, Luminate ID, and a Site
// Sync ID used to find the same row again on a later edit instead of
// duplicating it.
import {
  getSheetsClient, getSheetId, listTabs, findTab,
  claimTabForNewCollaborator, findRowBySyncId, findRowByLuminateId, findUnclaimedRowByTitle, writeSongRow, appendSongRow,
} from "../../lib/sheets";
import { requireUser, requireSameOrigin } from "../../lib/session";
import { sql } from "../../lib/db";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const session = await requireUser(req, res);
  if (!session) return;
  if (!requireSameOrigin(req, res)) return;
  const { placementId, song, artist, luminateId, splits, liveIds } = req.body || {};
  if (!placementId || !song || !Array.isArray(splits) || splits.length === 0) {
    return res.status(400).json({ error: "placementId, song, and splits are required." });
  }

  // a client session may only ever write their own split (the site's own
  // caller already sends exactly one entry: their own name/percent) — never
  // let a client-controlled request smuggle a write into someone else's tab.
  if (session.user.role !== "staff") {
    const [client] = await sql`SELECT name, sheet_tab_name FROM clients WHERE id = ${session.user.clientId}`;
    const mine = new Set([client?.name, client?.sheet_tab_name].filter(Boolean));
    const allowed = splits.every((s) => mine.has((s.name || "").trim()));
    if (!client || !allowed) return res.status(403).json({ error: "Not authorized for that split." });
  }

  try {
    const sheets = getSheetsClient();
    const spreadsheetId = getSheetId();
    let tabs = await listTabs(sheets, spreadsheetId);

    const results = [];
    for (const split of splits) {
      const name = (split.name || "").trim();
      const percent = Number(split.percent) || 0;
      if (!name || percent <= 0) continue;

      let tab = findTab(tabs, name);
      let created = false;
      if (!tab) {
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
      // pushing browser's own placement list (liveIds) — everything else
      // on the site is per-browser localStorage, so two staff members' (or
      // one staff member's two devices') local copies of "the same" song
      // can carry different ids with no other way to reconcile them.
      const existingRow = await findRowBySyncId(sheets, spreadsheetId, tab.title, syncId)
        ?? (luminateId ? await findRowByLuminateId(sheets, spreadsheetId, tab.title, luminateId) : null)
        ?? await findUnclaimedRowByTitle(sheets, spreadsheetId, tab.title, song, liveIds);
      const payload = { song, artist: artist || "", percent, luminateId, syncId };
      if (existingRow) {
        await writeSongRow(sheets, spreadsheetId, tab.title, existingRow, payload);
      } else {
        await appendSongRow(sheets, spreadsheetId, tab.title, payload);
      }
      results.push({ name, tab: tab.title, tabCreated: created, updated: !!existingRow });
    }

    // every split was skipped (blank name or 0%) — nothing was written
    // anywhere. That's silent data loss from the caller's point of view if
    // it comes back looking like success, so make it a real error instead.
    if (results.length === 0) {
      return res.status(400).json({ error: "Nothing was synced — no split has a name and a percentage above 0%." });
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Sheet push failed." });
  }
}
