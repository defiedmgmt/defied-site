// Reads each client's tab back from the pub master sheet — streams, revenue,
// admin fee, and whatever Luminate ID has been filled in. Triggered manually
// from the staff dashboard (this data only changes when staff refresh
// Luminate stream data by hand, so there's nothing to poll). The caller
// merges the returned rows onto its own placements — this route has no
// access to localStorage, it just reads the sheet.
import { getSheetsClient, getSheetId, listTabs, findTab, readTabRows } from "../../lib/sheets";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { clients } = req.body || {};
  if (!Array.isArray(clients) || clients.length === 0) {
    return res.status(400).json({ error: "clients[] is required." });
  }

  try {
    const sheets = getSheetsClient();
    const spreadsheetId = getSheetId();
    const tabs = await listTabs(sheets, spreadsheetId);

    const out = [];
    for (const c of clients) {
      const tabName = (c.sheetTabName || c.name || "").trim();
      const tab = findTab(tabs, tabName);
      if (!tab) { out.push({ clientId: c.id, tabFound: false, totalStreams: 0, rows: [] }); continue; }
      const rows = await readTabRows(sheets, spreadsheetId, tab.title);
      const totalStreams = rows.reduce((sum, r) => sum + r.grossStreams, 0);
      out.push({ clientId: c.id, tabFound: true, totalStreams, rows });
    }

    return res.status(200).json({ syncedAt: new Date().toISOString(), clients: out });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Sheet pull failed." });
  }
}
