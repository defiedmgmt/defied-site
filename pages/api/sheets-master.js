// Read-only staff overview — pulls the MASTER tab's own precomputed
// per-writer rollup (streams, revenue, admin fee, 3-year forecast) so the
// Clients-tab overview always matches the sheet exactly. Nothing here ever
// writes back to the sheet.
import { getSheetsClient, getSheetId, readMasterRollup, readMasterLinks, readAssumptions } from "../../lib/sheets";
import { requireAccess, limited, ownSet } from "../../lib/access";
import { ownerOf } from "../../lib/names";
import { sql } from "../../lib/db";

// An account limited to its own artists (lib/roles.js): their writers' rows only, and the roster's totals
// as the sum of those rows, so no other artist's number reaches it
const SUMS = { rosterGrossStreams: "grossStreams", rosterNetStreams: "netStreams", grossRevenuePool: "grossRevenue", catalogToDate: "adminFee", threeYearForecast: "forecastTotal", totalEstAdminFee: "totalEstAdminFee" };
const ROW_KEYS = ["songs", "grossStreams", "netStreams", "grossRevenue", "adminFee", "year1", "year2", "year3", "forecastTotal", "totalEstAdminFee"];
export function scopeRollup(rollup, keep) {
  const rows = rollup.rows.filter(keep);
  const sum = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const totals = Object.fromEntries(Object.entries(SUMS).map(([t, k]) => [t, sum(k)]));
  const rosterTotal = { writer: "ROSTER TOTAL", sheetTab: "", ...Object.fromEntries(ROW_KEYS.map((k) => [k, sum(k)])), pctOfRoster: rows.length ? 1 : 0 };
  return { ...rollup, totals, rows: rows.map((r) => ({ ...r, pctOfRoster: totals.rosterGrossStreams ? r.grossStreams / totals.rosterGrossStreams : 0 })), rosterTotal };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  if (!(await requireAccess(req, res, "publishing"))) return;
  try {
    const sheets = getSheetsClient();
    const spreadsheetId = getSheetId();
    let rollup = await readMasterRollup(sheets, spreadsheetId);
    if (limited(req)) {
      const mine = ownSet(req), known = await sql`SELECT id, name, sheet_tab_name FROM clients`;
      rollup = scopeRollup(rollup, (r) => mine.has(ownerOf(known, r.sheetTab || r.writer)?.id));
    }
    const links = await readMasterLinks(sheets, spreadsheetId);
    // the $ a stream every estimate uses (ASSUMPTIONS!B7), for the overview's one line explaining
    // the money; without it the line just says "the sheet's blended rate"
    const a = await readAssumptions(sheets, spreadsheetId).catch(() => ({}));
    // runRate (B9) and decayRate (B8): the forecast tile says Year 1 = the fee so far × B9 × (1 − B8)
    // (2026-11-10) the money is the Founders' (Money access): streams and song counts only for anyone else
    if (!(req.access?.sections || []).includes("money")) {
      const keep = ({ writer, sheetTab, songs, grossStreams, netStreams }) => ({ writer, sheetTab, songs, grossStreams, netStreams });
      const totals = Object.fromEntries(Object.entries(rollup.totals || {}).filter(([k]) => /streams|songs/i.test(k)));
      // (and no links into the pub sheet's Drive: its folder is the Founders')
      return res.status(200).json({ totals, rows: rollup.rows.map(keep), rosterTotal: rollup.rosterTotal ? keep(rollup.rosterTotal) : null, links: {}, rate: null, runRate: null, decayRate: null });
    }
    return res.status(200).json({ ...rollup, links, rate: a.blendedRate || null, runRate: a.runRate || null, decayRate: a.decayRate ?? null });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Failed to read the MASTER tab." });
  }
}
