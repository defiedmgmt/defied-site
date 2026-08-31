// Staff-only, read-only A&R data: links to the OUTREACH and ADVANCE
// CALCULATOR sheet tabs, the ASSUMPTIONS levers and recoup-target setting
// their formulas depend on, the current outreach pipeline (with each
// prospect's real "Advance Given?" status merged in), the tab's own
// starting/committed/remaining budget tracker, and every signed client's
// Net Streams (computed the same way their own portal does) so they can
// be evaluated in the Advance Calculator too. Both sheet tabs stay fully
// isolated from MASTER/roster totals; nothing here writes back except via
// the dedicated actions in /api/ar-write.
import { sql } from "../../lib/db";
import { requireStaff } from "../../lib/session";
import {
  getSheetsClient, getSheetId, listTabs, tabLink,
  readAssumptions, readAdvanceCalcSettings, readAdvanceBudget, readAdvanceGivenMap,
  readOutreachProspects, OUTREACH_TAB, ADVANCE_TAB, OUTREACH_STATUSES,
} from "../../lib/sheets";

// Same math as SongManager's own catalog summary (components/App.jsx) —
// net streams is each placement's streams × that client's own split %,
// summed across their whole catalog. Kept in sync by hand since one lives
// server-side (Postgres) and the other client-side (already-loaded db).
async function readSignedClientsWithNetStreams() {
  const [clients, placements] = await Promise.all([
    sql`SELECT id, name FROM clients ORDER BY roster_order`,
    sql`SELECT client_id, streams, splits FROM placements`,
  ]);
  const byClient = new Map(clients.map((c) => [c.id, { id: c.id, name: c.name, grossStreams: 0, netStreams: 0 }]));
  for (const p of placements) {
    const entry = byClient.get(p.client_id);
    if (!entry) continue;
    const streams = Number(p.streams) || 0;
    entry.grossStreams += streams;
    const mine = (p.splits || []).find((s) => s.name === entry.name);
    entry.netStreams += streams * ((Number(mine?.percent) || 0) / 100);
  }
  return Array.from(byClient.values()).map((c) => ({ ...c, netStreams: Math.round(c.netStreams) }));
}

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

    const [assumptions, advanceSettings, budget, givenMap, rawProspects, signedClients] = await Promise.all([
      readAssumptions(sheets, spreadsheetId),
      readAdvanceCalcSettings(sheets, spreadsheetId),
      readAdvanceBudget(sheets, spreadsheetId),
      readAdvanceGivenMap(sheets, spreadsheetId),
      readOutreachProspects(sheets, spreadsheetId),
      readSignedClientsWithNetStreams(),
    ]);
    const prospects = rawProspects.map((p) => ({ ...p, advanceGiven: givenMap[p.row] || "" }));

    return res.status(200).json({
      links: {
        outreach: outreachTab ? tabLink(spreadsheetId, outreachTab.sheetId) : null,
        advanceCalculator: advanceTab ? tabLink(spreadsheetId, advanceTab.sheetId) : null,
      },
      assumptions,
      recoupTargetMonths: advanceSettings.recoupTargetMonths,
      budget,
      statuses: OUTREACH_STATUSES,
      prospects,
      signedClients,
    });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Failed to load A&R data." });
  }
}
