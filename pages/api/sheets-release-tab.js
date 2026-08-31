// Called once, after a client's songs have all been cleared off the pub
// sheet (see /api/sheets-delete), to release their tab back into the
// generic WRITER pool instead of leaving a deleted client's name sitting
// on an otherwise-empty tab forever.
import { getSheetsClient, getSheetId, listTabs, releaseTabToPool } from "../../lib/sheets";
import { requireStaff, requireSameOrigin } from "../../lib/session";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!(await requireStaff(req, res))) return;
  if (!requireSameOrigin(req, res)) return;
  const { tabName } = req.body || {};
  if (!tabName) return res.status(400).json({ error: "tabName is required." });

  try {
    const sheets = getSheetsClient();
    const spreadsheetId = getSheetId();
    const tabs = await listTabs(sheets, spreadsheetId);
    const released = await releaseTabToPool(sheets, spreadsheetId, tabName, tabs);
    return res.status(200).json({ ok: true, released });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Tab release failed." });
  }
}
