// Called right after a "Sync from sheet" pull creates new site placements
// for songs staff typed directly into the sheet (no Site Sync ID yet).
// Stamps each row's Site Sync ID so the next push updates that exact row
// instead of appending a duplicate, and the next pull matches it by
// syncId instead of re-detecting it as "new" every time.
import { getSheetsClient, getSheetId, listTabs, findTab, loadClientTabNames, otherClientTabNames, writeSyncId } from "../../lib/sheets";
import { requireStaff, requireSameOrigin } from "../../lib/session";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!(await requireStaff(req, res))) return;
  if (!requireSameOrigin(req, res)) return;
  const { claims } = req.body || {};
  if (!Array.isArray(claims) || claims.length === 0) {
    return res.status(400).json({ error: "claims[] is required." });
  }

  try {
    const sheets = getSheetsClient();
    const spreadsheetId = getSheetId();
    const tabs = await listTabs(sheets, spreadsheetId);
    const known = await loadClientTabNames();
    for (const c of claims) {
      if (!c.tab || !c.row || !c.syncId) continue;
      // c.tab is the client's name or override, not the tab's real title —
      // resolve it the way the pull that found this row did, or a client
      // matched by the fuzzy fallback ("Liyakk!" -> "Liyakk") sends this
      // write to a tab that doesn't exist and fails the whole claim
      const tab = findTab(tabs, c.tab, otherClientTabNames(known, c.tab));
      if (!tab) continue;
      await writeSyncId(sheets, spreadsheetId, tab.title, c.row, c.syncId);
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Claim-back failed." });
  }
}
