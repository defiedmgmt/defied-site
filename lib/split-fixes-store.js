// Server side of lib/split-fixes.js. Server-only.
//   autoState / recordAuto / undoAuto: the even splits confirmed by themselves (app_state "splitsAuto": done =
//     [{ id, song, client, before, after, at }], newest last; held = song ids Undo put back, never confirmed again)
//   fillBlankShare: the one sheet write, "fill in the sheet's blank share". Only the Writer Share cell (D) of the
//     song's own row is written, only while that cell is still blank and the row is the one the dialog named, only
//     for a song whose split here is still the client's 100%, with the share typed in the dialog (r11: 100 unless
//     the owner types another; the browser then saves that share on the site too), and only with
//     PUB_SHARE_WRITES=on (read at call time; off by default, so the live site writes nothing until the owner
//     says so). The song's sheet facts are read again afterwards (and on a refusal, so a reload shows the sheet).
import { sql } from "./db";
import { offText } from "./preview";
import { getSheetsClient, getSheetId, listTabs, findTab, loadClientTabNames, tabsOfOthers, readTabRows } from "./sheets";
import { sheetRowFor } from "./sheet-facts";
import { sheetFactQueries, saveSheetFacts } from "./sheet-facts-store";
import { findByName } from "./names";
import { typedShare } from "./split-fixes";

const KEY = "splitsAuto";
const KEEP = 800; // the newest confirmations kept for Undo (a first run on a real catalog can confirm a hundred or more)
// read like logWritesOn: "On", "ON" or a trailing newline from the env editor still count as on
export const shareWritesOn = () => String(process.env.PUB_SHARE_WRITES ?? "").trim().toLowerCase() === "on";

export async function autoState() {
  const [r] = await sql`SELECT value FROM app_state WHERE key = ${KEY}`;
  const v = r?.value || {};
  return { done: Array.isArray(v.done) ? v.done : [], held: Array.isArray(v.held) ? v.held : [] };
}
const save = (v) => sql`INSERT INTO app_state (key, value, updated_at) VALUES (${KEY}, ${JSON.stringify(v)}, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;

const isSplits = (x) => Array.isArray(x) && x.length <= 40 && x.every((s) => s && typeof s === "object" && Number.isFinite(Number(s.percent ?? 0)));
// items: what the browser just confirmed ([{ id, song, client, before, after }]); a held song is never recorded
export async function recordAuto(items, by = "") {
  if (!Array.isArray(items) || !items.length || items.length > KEEP) return { error: "Nothing to record." };
  if (!items.every((x) => x && typeof x.id === "string" && x.id.length <= 40 && isSplits(x.before) && isSplits(x.after))) return { error: "Those splits don't look right." };
  const st = await autoState();
  const ids = new Set(items.map((x) => x.id));
  const at = new Date().toISOString();
  const add = items.filter((x) => !st.held.includes(x.id)).map((x) => ({ id: x.id, song: String(x.song || "").slice(0, 200), client: String(x.client || "").slice(0, 120), before: x.before, after: x.after, at, by }));
  await save({ done: [...st.done.filter((d) => !ids.has(d.id)), ...add].slice(-KEEP), held: st.held });
  return { ok: true, recorded: add.length };
}
// Undo: these leave the list and are never confirmed by themselves again (the browser puts the old split back)
export async function undoAuto(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > KEEP || !ids.every((x) => typeof x === "string")) return { error: "Nothing to undo." };
  const st = await autoState();
  const set = new Set(ids);
  const undone = st.done.filter((d) => set.has(d.id));
  await save({ done: st.done.filter((d) => !set.has(d.id)), held: [...new Set([...st.held, ...ids])] });
  return { ok: true, undone };
}

const qt = (title) => title.replace(/'/g, "''");
// the % as the sheet keeps it: 50 -> 0.5, 33.3 -> 0.333 (never 0.33299999999999996), 100 -> 1
const sheetShare = (pct) => Math.round(pct * 10) / 1000;
// { ok, tab, row, cell, share, value } or { error, status }. share: the % typed in the dialog (100 when the request
// has none, as before r11); row: the sheet row the dialog named (a row that has moved since is refused).
// io: { sheets, spreadsheetId } for the tests and the dry run (the real client otherwise)
export async function fillBlankShare(placementId, { share = 100, row: shown = null } = {}, io = {}) {
  if (!shareWritesOn()) return { status: 503, off: true, error: offText("Writing to the pub sheet from here isn't switched on yet.") };
  const typed = typedShare(share);
  if (typed.reason) return { status: 400, error: typed.reason };
  const [p] = await sql`SELECT id, client_id, song, luminate_id, splits FROM placements WHERE id = ${String(placementId || "")}`;
  if (!p) return { status: 404, error: "That song isn't on the site anymore. Reload the page." };
  const known = await loadClientTabNames();
  const c = known.find((k) => k.id === p.client_id);
  // the site's own copy decides which songs may be filled: the client's own share there is still the whole 100%
  // (a typed share other than that is saved on the site by the browser, only after this write)
  const own = c && findByName(p.splits || [], c.name);
  if (!own || Math.abs(Number(own.percent) - 100) >= 0.05) return { status: 409, error: "Its split on the site isn't 100% any more. Reload the page." };
  const sheets = io.sheets || getSheetsClient(), spreadsheetId = io.spreadsheetId || getSheetId();
  const tab = findTab(await listTabs(sheets, spreadsheetId), (c.sheet_tab_name || c.name || "").trim(), tabsOfOthers(known, c));
  if (!tab) return { status: 409, error: `The pub sheet has no ${c.sheet_tab_name || c.name} tab.` };
  const songs = await sql`SELECT id, client_id, song, luminate_id FROM placements`;
  const live = new Set(songs.map((s) => s.id));
  // what the sheet says now, for that client's songs (the same facts a pull keeps)
  const keepFacts = (rows) => saveSheetFacts(sheetFactQueries(c.id, tab.title, songs.filter((s) => s.client_id === c.id), rows, live));
  const rows = await readTabRows(sheets, spreadsheetId, tab.title);
  const row = sheetRowFor({ id: p.id, song: p.song, luminateId: p.luminate_id }, rows, live);
  if (!row) return { status: 409, error: `"${p.song}" has no row on the ${tab.title} tab any more.` };
  // the dialog named a cell: a row added or removed above it since, and the share would land somewhere else
  if (shown != null && Number(shown) !== row.row) { await keepFacts(rows); return { status: 409, error: `"${p.song}" is on row ${row.row} of the ${tab.title} tab now, not ${shown}. Reload the page.` }; }
  // someone typed a share in meanwhile: theirs stands
  if (!row.shareBlank) { await keepFacts(rows); return { status: 409, error: `The share on row ${row.row} of the ${tab.title} tab isn't blank any more. Reload the page.` }; }
  const value = sheetShare(typed.share);
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "USER_ENTERED", data: [{ range: `'${qt(tab.title)}'!D${row.row}`, values: [[value]] }] } });
  await keepFacts(await readTabRows(sheets, spreadsheetId, tab.title));
  return { ok: true, tab: tab.title, row: row.row, cell: `D${row.row}`, share: typed.share, value };
}
