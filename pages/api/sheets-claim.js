// Called right after a "Sync from sheet" pull creates new site placements
// for songs staff typed directly into the sheet (no Site Sync ID yet).
// Stamps each row's Site Sync ID so the next push updates that exact row
// instead of appending a duplicate, and the next pull matches it by
// syncId instead of re-detecting it as "new" every time.
import { getSheetsClient, getSheetId, writeSyncId } from "../../lib/sheets";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { claims } = req.body || {};
  if (!Array.isArray(claims) || claims.length === 0) {
    return res.status(400).json({ error: "claims[] is required." });
  }

  try {
    const sheets = getSheetsClient();
    const spreadsheetId = getSheetId();
    for (const c of claims) {
      if (!c.tab || !c.row || !c.syncId) continue;
      await writeSyncId(sheets, spreadsheetId, c.tab, c.row, c.syncId);
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Claim-back failed." });
  }
}
