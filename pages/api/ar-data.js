// Staff-only, read-only A&R data: links to the CALC & OUTREACH and ADVANCE
// CALCULATOR sheet tabs, the ASSUMPTIONS levers and recoup-target setting
// their formulas depend on, and the current outreach pipeline itself — so
// the site's Advance Calculator can run the exact same math without staff
// re-typing numbers by hand. Both tabs stay fully isolated from MASTER/
// roster totals; nothing here is ever written back to the sheet.
import { requireStaff } from "../../lib/session";
import {
  getSheetsClient, getSheetId, listTabs, tabLink,
  readAssumptions, readAdvanceCalcSettings, readOutreachProspects,
  OUTREACH_TAB, ADVANCE_TAB,
} from "../../lib/sheets";

export default async function handler(req, res) {
  const session = await requireStaff(req, res);
  if (!session) return;
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  try {
    const sheets = getSheetsClient();
    const spreadsheetId = getSheetId();
    const tabs = await listTabs(sheets, spreadsheetId);
    const outreachTab = tabs.find((t) => t.title === OUTREACH_TAB);
    const advanceTab = tabs.find((t) => t.title === ADVANCE_TAB);

    const [assumptions, advanceSettings, prospects] = await Promise.all([
      readAssumptions(sheets, spreadsheetId),
      readAdvanceCalcSettings(sheets, spreadsheetId),
      readOutreachProspects(sheets, spreadsheetId),
    ]);

    return res.status(200).json({
      links: {
        outreach: outreachTab ? tabLink(spreadsheetId, outreachTab.sheetId) : null,
        advanceCalculator: advanceTab ? tabLink(spreadsheetId, advanceTab.sheetId) : null,
      },
      assumptions,
      recoupTargetMonths: advanceSettings.recoupTargetMonths,
      prospects,
    });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Failed to load A&R data." });
  }
}
