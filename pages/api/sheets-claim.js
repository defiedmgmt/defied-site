// Called right after a "Sync from sheet" pull creates new site placements
// for songs staff typed directly into the sheet (no Site Sync ID yet).
// Stamps each row's Site Sync ID so the next push updates that exact row
// instead of appending a duplicate, and the next pull matches it by
// syncId instead of re-detecting it as "new" every time.
// r11 todofix: each stamp goes through the formula guard (lib/sheet-writes.js
// guardedStamp): the tab is read with FORMULA first, a stamp into a cell that
// holds a formula or into the Total row (or below) is refused, naming the cell,
// and the tab is read again after. Every stamp refused (the merge card sends
// one) is a 409 { error, refused, written: false }; otherwise { ok, stamped,
// refused, alarm? } (alarm: a formula that changed, said loudly).
import { getSheetsClient, getSheetId, listTabs, findTab, loadClientTabNames, tabsOfOthers } from "../../lib/sheets";
import { guardedStamp } from "../../lib/sheet-writes";
import { requireSameOrigin } from "../../lib/session";
import { requireAccess, mayUseClient } from "../../lib/access";
import { ownerOf } from "../../lib/names";
import { sql } from "../../lib/db";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!(await requireAccess(req, res, "publishing"))) return;
  if (!requireSameOrigin(req, res)) return;
  const { claims } = req.body || {};
  if (!Array.isArray(claims) || claims.length === 0) {
    return res.status(400).json({ error: "claims[] is required." });
  }

  try {
    const sheets = getSheetsClient();
    const spreadsheetId = getSheetId();
    const tabs = await listTabs(sheets, spreadsheetId);
    const known = await loadClientTabNames();
    // each claim's song (saved just before this) says whose tab it was pulled from
    const ids = claims.map((c) => String(c.syncId || "").split(":")[0]);
    const songClient = Object.fromEntries((await sql`SELECT id, client_id FROM placements WHERE id = ANY(${ids})`).map((p) => [p.id, p.client_id]));
    // an account limited to its own artists stamps only their songs' rows
    if (ids.some((id) => songClient[id] && !mayUseClient(req, songClient[id]))) return res.status(403).json({ error: "That song isn't one of your artists'." });
    const items = [];
    for (const c of claims) {
      if (!c.tab || !c.row || !c.syncId) continue;
      // c.tab is the client's name or override, not the tab's real title —
      // resolve it the way the pull that found this row did, or a client
      // matched by the fuzzy fallback ("Liyakk!" -> "Liyakk") sends this
      // write to a tab that doesn't exist and fails the whole claim
      const me = ownerOf(known, c.tab, songClient[String(c.syncId).split(":")[0]]);
      const tab = findTab(tabs, c.tab, tabsOfOthers(known, me));
      if (!tab) continue;
      items.push({ tab: tab.title, row: Number(c.row), syncId: String(c.syncId) });
    }
    const out = await guardedStamp(sheets, spreadsheetId, items);
    for (const a of out.alarms) console.error(`sheets-claim: ${a}`);
    // nothing stamped and something refused: an error, so no caller goes on as if its row were marked
    if (out.refused.length && !out.stamped.length) return res.status(409).json({ error: out.refused.map((r) => r.reason).join(" "), refused: out.refused, written: false });
    return res.status(200).json({ ok: true, stamped: out.stamped.length, refused: out.refused, ...(out.alarms.length ? { alarm: out.alarms.join(" ") } : {}) });
  } catch (err) {
    // a stamp that failed was read back all the same (it may have landed)
    const back = err.readBack;
    if (back && !back.ok) console.error(`sheets-claim: ${back.alarm}`);
    return res.status(502).json({ error: err.message || "Claim-back failed.", ...(back ? { checked: true, ...(back.ok ? {} : { alarm: back.alarm }) } : {}) });
  }
}
