// Writes one row per split-holder into their tab on the pub master sheet
// whenever a song is added/edited on the site. Never touches the sheet's
// formula columns (streams/revenue/admin fee/forecast) — only Song Title,
// Recording Artist, that person's Writer Share %, Luminate ID, and a Site
// Sync ID used to find the same row again on a later edit instead of
// duplicating it.
import {
  getSheetsClient, getSheetId, listTabs, findTab,
  claimTabForNewCollaborator, findRowBySyncId, findUnclaimedRowByTitle, writeSongRow, appendSongRow,
} from "../../lib/sheets";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { placementId, song, artist, luminateId, splits } = req.body || {};
  if (!placementId || !song || !Array.isArray(splits) || splits.length === 0) {
    return res.status(400).json({ error: "placementId, song, and splits are required." });
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
      // an already-claimed row (has this exact syncId) always wins; failing
      // that, a real pre-existing row with the same title and no Site Sync
      // ID of its own is almost certainly this same song typed in before
      // this feature existed — claim it instead of appending a duplicate.
      const existingRow = await findRowBySyncId(sheets, spreadsheetId, tab.title, syncId)
        ?? await findUnclaimedRowByTitle(sheets, spreadsheetId, tab.title, song);
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
