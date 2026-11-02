// Read-only staff overview — pulls the MASTER tab's own precomputed
// per-writer rollup (streams, revenue, admin fee, 3-year forecast) so the
// Clients-tab overview always matches the sheet exactly. Nothing here ever
// writes back to the sheet.
import { getSheetsClient, getSheetId, readMasterRollup, readMasterLinks, readAssumptions } from "../../lib/sheets";
import { requireStaff } from "../../lib/session";
import { portfolioName } from "../../lib/luminate";

// the POR id in one of MASTER's ↗A / ↗B links, so the button reads Luminate's name for it ("Admin Catalog 1")
const porIn = (url) => (/POR[0-9A-F]{16,}/i.exec(String(url || "")) || [])[0] || "";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  if (!(await requireStaff(req, res))) return;
  try {
    const sheets = getSheetsClient();
    const spreadsheetId = getSheetId();
    const rollup = await readMasterRollup(sheets, spreadsheetId);
    const links = await readMasterLinks(sheets, spreadsheetId);
    links.names = { portfolioA: portfolioName(porIn(links.portfolioA), null), portfolioB: portfolioName(porIn(links.portfolioB), null) };
    // the $ a stream every estimate uses (ASSUMPTIONS!B7), for the overview's one line explaining
    // the money; without it the line just says "the sheet's blended rate"
    const a = await readAssumptions(sheets, spreadsheetId).catch(() => ({}));
    // runRate (B9) and decayRate (B8): the forecast tile says Year 1 = the fee so far × B9 × (1 − B8)
    return res.status(200).json({ ...rollup, links, rate: a.blendedRate || null, runRate: a.runRate || null, decayRate: a.decayRate ?? null });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Failed to read the MASTER tab." });
  }
}
