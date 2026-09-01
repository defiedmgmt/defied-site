// Reads each client's tab back from the pub master sheet — streams, revenue,
// admin fee, and whatever Luminate ID has been filled in. Triggered manually
// from the staff dashboard (this data only changes when staff refresh
// Luminate stream data by hand, so there's nothing to poll). The caller
// merges the returned rows onto its own placements — this route has no
// access to localStorage, it just reads the sheet.
import { getSheetsClient, getSheetId, listTabs, findTab, readTabRows } from "../../lib/sheets";
import { requireUser, requireSameOrigin } from "../../lib/session";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const session = await requireUser(req, res);
  if (!session) return;
  if (!requireSameOrigin(req, res)) return;
  let { clients } = req.body || {};
  if (!Array.isArray(clients) || clients.length === 0) {
    return res.status(400).json({ error: "clients[] is required." });
  }
  const isStaff = session.user.role === "staff";
  // a client session may only ever pull their own tab, regardless of what
  // the request body claims — staff can pull any/all clients.
  if (!isStaff) {
    clients = clients.filter((c) => c.id === session.user.clientId);
    if (clients.length === 0) return res.status(403).json({ error: "Not authorized for that client." });
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
      const rawRows = await readTabRows(sheets, spreadsheetId, tab.title);
      const totalStreams = rawRows.reduce((sum, r) => sum + r.grossStreams, 0);
      // matches dashboard-data.js's redaction policy: a client sees their own
      // streams, never revenue/admin fee — the UI never calls this route as
      // a client anymore, but the API shouldn't rely on that to stay true.
      const rows = isStaff ? rawRows : rawRows.map(({ grossRevenue, adminFee, ...r }) => r);
      out.push({ clientId: c.id, tabFound: true, totalStreams, rows });
    }

    return res.status(200).json({ syncedAt: new Date().toISOString(), clients: out });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Sheet pull failed." });
  }
}
