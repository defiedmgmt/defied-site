// Staff-only writes to the OUTREACH sheet tab — add/edit/delete a prospect,
// add/edit/delete one of their up-to-5 song slots. Unlike the client
// catalog, prospects have no Postgres row at all (they aren't signed
// clients yet); the sheet is the only source of truth, so this writes
// straight to it. Still fully isolated from MASTER/roster totals.
import { requireStaff, requireSameOrigin } from "../../lib/session";
import {
  getSheetsClient, getSheetId, firstEmptyOutreachRow,
  writeOutreachProspect, clearOutreachProspect, writeOutreachSong, clearOutreachSong,
  writeOutreachProspectFull, writeAdvanceGiven,
} from "../../lib/sheets";

export default async function handler(req, res) {
  const session = await requireStaff(req, res);
  if (!session) return;
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!requireSameOrigin(req, res)) return;

  const { action } = req.body || {};
  const sheets = getSheetsClient();
  const spreadsheetId = getSheetId();

  try {
    if (action === "saveProspectFull") {
      const { row, name, contact, status, songs } = req.body;
      if (!name || !String(name).trim()) return res.status(400).json({ error: "Name is required." });
      const targetRow = row || (await firstEmptyOutreachRow(sheets, spreadsheetId));
      await writeOutreachProspectFull(sheets, spreadsheetId, targetRow, { name: String(name).trim(), contact: contact || "", status: status || "", songs: songs || [] });
      return res.status(200).json({ ok: true, row: targetRow });
    }
    if (action === "setAdvanceGiven") {
      const { row, given } = req.body;
      if (!row) return res.status(400).json({ error: "row is required." });
      await writeAdvanceGiven(sheets, spreadsheetId, row, !!given);
      return res.status(200).json({ ok: true });
    }
    if (action === "saveProspect") {
      const { row, name, contact } = req.body;
      if (!name || !String(name).trim()) return res.status(400).json({ error: "Name is required." });
      const targetRow = row || (await firstEmptyOutreachRow(sheets, spreadsheetId));
      await writeOutreachProspect(sheets, spreadsheetId, targetRow, { name: String(name).trim(), contact: contact || "" });
      return res.status(200).json({ ok: true, row: targetRow });
    }
    if (action === "deleteProspect") {
      const { row } = req.body;
      if (!row) return res.status(400).json({ error: "row is required." });
      await clearOutreachProspect(sheets, spreadsheetId, row);
      return res.status(200).json({ ok: true });
    }
    if (action === "saveSong") {
      const { row, slot, streams, writerShare } = req.body;
      if (!row || !(slot >= 1 && slot <= 5)) return res.status(400).json({ error: "row and slot (1-5) are required." });
      await writeOutreachSong(sheets, spreadsheetId, row, slot, { streams: Number(streams) || 0, writerShare: Number(writerShare) || 0 });
      return res.status(200).json({ ok: true });
    }
    if (action === "deleteSong") {
      const { row, slot } = req.body;
      if (!row || !(slot >= 1 && slot <= 5)) return res.status(400).json({ error: "row and slot (1-5) are required." });
      await clearOutreachSong(sheets, spreadsheetId, row, slot);
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Failed to save." });
  }
}
