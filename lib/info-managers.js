// Each client's manager, from the accounting sheet's INFO tab (moved here from lib/access.js on 2026-11-13 so
// lib/sync-checks.js and lib/people-sync.js can run it without pulling in the session code; lib/access.js re-exports
// all three). Server-only. Reads the sheet only; writes clients.manager.
import { sql } from "./db";
import { getSheetsClient } from "./sheets";
import { ownerOf } from "./names";
import { accountingSheetId } from "./accounting";

// INFO's roster: a header row with "Artists / Clients" and "Assigned Manager", one client a row under
// it. Returns [{ name, manager }] (blank managers included, the company row left out), or null when
// INFO has no such columns.
export function parseInfoManagers(values) {
  const rows = values || [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    const nc = row.findIndex((v) => /^artists?\s*\/\s*clients?$/i.test(String(v ?? "").trim()));
    const mc = row.findIndex((v) => /^assigned\s+manager$/i.test(String(v ?? "").trim()));
    if (nc < 0 || mc < 0) continue;
    const out = [];
    for (const x of rows.slice(r + 1)) {
      const name = String(x?.[nc] ?? "").trim();
      if (!name) { if (out.length) break; continue; }
      if (/^general\b|\bcompany$/i.test(name)) continue;
      out.push({ name, manager: String(x?.[mc] ?? "").trim() });
    }
    return out;
  }
  return null;
}

// Which site client each INFO name is (the same rule as the sheet routes: a "Sheet tab name" override,
// then the name): { [clientId]: manager }. A client not on INFO has no manager.
export function managersByClient(clients, info) {
  const out = {};
  for (const r of info) {
    const c = ownerOf(clients, r.name);
    if (c && !(c.id in out)) out[c.id] = r.manager;
  }
  return out;
}

// (2026-11-13 review) A read that would take the manager away from most clients is refused, never written: INFO's
// list cut short by a blank row, or the managers moved out of the "Assigned Manager" column. clients: DB rows with
// manager; by: managersByClient. -> a sentence, or null.
export function managersProblem(clients, by) {
  const had = clients.filter((c) => String(c.manager ?? "").trim());
  const lost = had.filter((c) => !String(by[c.id] ?? "").trim()).length;
  if (!had.length || !lost) return null;
  if (lost === had.length || (had.length >= 4 && lost > had.length / 2)) {
    return `INFO would take the manager away from ${lost} of the ${had.length} clients that have one on the site, so no manager was changed. Check INFO for a blank row between clients or a moved column.`;
  }
  return null;
}

// Reads INFO and writes each client's manager (clients.manager). Reads the sheet only. Run by the
// daily cron, by Site › Users' "Update from the sheet", after a save to INFO (lib/people-sync.js) and by
// the Sync check when INFO and the site differ (lib/sync-checks.js, at most every 2 minutes). Always its own read,
// columns found by their headers (2026-11-13 review: the Sync check used to hand it INFO read by fixed address).
export async function refreshManagers({ sheets, spreadsheetId = accountingSheetId() } = {}) {
  if (!spreadsheetId) return { connected: false, error: "The accounting sheet isn't connected (ACCOUNTING_SHEET_ID)." };
  const client = sheets || getSheetsClient();
  const got = await client.spreadsheets.values.batchGet({ spreadsheetId, ranges: ["'INFO'!A1:H60"] });
  const info = parseInfoManagers(got.data.valueRanges?.[0]?.values || []);
  if (!info) return { connected: true, error: "The accounting sheet's INFO tab has no Assigned Manager column." };
  const clients = await sql`SELECT id, name, sheet_tab_name, manager FROM clients`;
  const by = managersByClient(clients, info);
  const problem = managersProblem(clients, by);
  if (problem) return { connected: true, error: problem };
  await sql.transaction(clients.map((c) => sql`UPDATE clients SET manager = ${by[c.id] || ""}, manager_at = now() WHERE id = ${c.id}`));
  return { connected: true, ok: true, matched: Object.keys(by).length, at: new Date().toISOString() };
}
