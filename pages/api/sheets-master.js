// Read-only staff overview — pulls the MASTER tab's own precomputed
// per-writer rollup (streams, revenue, admin fee, 3-year forecast) so the
// Clients-tab overview always matches the sheet exactly. Nothing here ever
// writes back to the sheet.
import { getSheetsClient, getSheetId, readMasterRollup, readMasterLinks } from "../../lib/sheets";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  try {
    const sheets = getSheetsClient();
    const spreadsheetId = getSheetId();
    const rollup = await readMasterRollup(sheets, spreadsheetId);
    const links = await readMasterLinks(sheets, spreadsheetId);
    return res.status(200).json({ ...rollup, links });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Failed to read the MASTER tab." });
  }
}
