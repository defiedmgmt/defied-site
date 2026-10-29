// Read-only staff overview — pulls the MASTER tab's own precomputed
// per-writer rollup (streams, revenue, admin fee, 3-year forecast) so the
// Clients-tab overview always matches the sheet exactly. Nothing here ever
// writes back to the sheet.
import { getSheetsClient, getSheetId, readMasterRollup, readMasterLinks, readAssumptions } from "../../lib/sheets";
import { requireStaff } from "../../lib/session";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  if (!(await requireStaff(req, res))) return;
  try {
    const sheets = getSheetsClient();
    const spreadsheetId = getSheetId();
    const rollup = await readMasterRollup(sheets, spreadsheetId);
    const links = await readMasterLinks(sheets, spreadsheetId);
    // the $ a stream every estimate uses (ASSUMPTIONS!B7), for the overview's one line explaining
    // the money; without it the line just says "the sheet's blended rate"
    const rate = await readAssumptions(sheets, spreadsheetId).then((a) => a.blendedRate || null, () => null);
    return res.status(200).json({ ...rollup, links, rate });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Failed to read the MASTER tab." });
  }
}
