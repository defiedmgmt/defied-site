// Reads each client's tab back from the pub master sheet — streams, revenue,
// admin fee, and whatever Luminate ID has been filled in. Triggered manually
// from the staff dashboard (this data only changes when staff refresh
// Luminate stream data by hand, so there's nothing to poll). The caller
// merges the returned rows onto its own placements and saves them
// (/api/dashboard-data) — this route only reads the sheet (and keeps what it
// read per song, lib/sheet-facts-store.js).
import { getSheetsClient, getSheetId, listTabs, findTab, loadClientTabNames, tabsOfOthers, readTabRows } from "../../lib/sheets";
import { ownerOf } from "../../lib/names";
import { requireSameOrigin } from "../../lib/session";
import { requireAccess, limited, mayUseClient } from "../../lib/access";
import { sql } from "../../lib/db";
import { sheetFactQueries, saveSheetFacts } from "../../lib/sheet-facts-store";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const session = await requireAccess(req, res, "publishing", { clients: true });
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
  // staff limited to their own artists (lib/roles.js) pull only those
  if (isStaff && limited(req) && !clients.every((c) => mayUseClient(req, c.id))) return res.status(403).json({ error: "That isn't one of your artists." });

  try {
    const sheets = getSheetsClient();
    const spreadsheetId = getSheetId();
    const tabs = await listTabs(sheets, spreadsheetId);
    const known = await loadClientTabNames();

    const out = [], facts = [];
    // staff pulls also keep what the sheet says per song (lib/sheet-facts.js), matched to the songs as saved
    const saved = isStaff ? await sql`SELECT id, client_id, song, luminate_id FROM placements` : [];
    const live = new Set(saved.map((p) => p.id));
    for (const c of clients) {
      // a client's tab is the one their own record names — never one the request names (that could
      // be any tab nobody owns: MASTER, an empty WRITER slot, a former client's)
      const own = !isStaff && known.find((k) => k.id === c.id);
      const tabName = (isStaff ? c.sheetTabName || c.name || "" : own ? own.sheet_tab_name || own.name || "" : "").trim();
      const me = known.find((k) => k.id === c.id) || ownerOf(known, tabName);
      const tab = findTab(tabs, tabName, tabsOfOthers(known, me));
      if (!tab) {
        if (isStaff && me?.id === c.id) facts.push(...sheetFactQueries(c.id, null, [], [], live));
        out.push({ clientId: c.id, tabFound: false, totalStreams: 0, rows: [] }); continue;
      }
      const rawRows = await readTabRows(sheets, spreadsheetId, tab.title);
      if (isStaff && known.some((k) => k.id === c.id)) facts.push(...sheetFactQueries(c.id, tab.title, saved.filter((p) => p.client_id === c.id), rawRows, live));
      const totalStreams = rawRows.reduce((sum, r) => sum + r.grossStreams, 0);
      // matches dashboard-data.js's redaction policy: a client sees their own
      // streams, never revenue/admin fee — the UI never calls this route as
      // a client anymore, but the API shouldn't rely on that to stay true.
      // (2026-11-10) and staff without Money (a Co-manager) get the streams without the money too
      const rows = isStaff && (req.access?.sections || []).includes("money") ? rawRows : rawRows.map(({ grossRevenue, adminFee, ...r }) => r);
      out.push({ clientId: c.id, tabFound: true, totalStreams, rows });
    }

    await saveSheetFacts(facts);
    return res.status(200).json({ syncedAt: new Date().toISOString(), clients: out });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Sheet pull failed." });
  }
}
