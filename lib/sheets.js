// Shared Google Sheets helper for the two /api/sheets-* routes. Server-only —
// never imported from components/App.jsx directly, same boundary as the
// Spotify credentials pattern in /api/spotify.js.
import { google } from "googleapis";

const SHEET_COLUMNS = "A:N"; // A Song Title … M Luminate ID, N Site Sync ID
const DATA_START_ROW = 5; // rows 1-4 are the summary header block on every tab
const WRITER_TAB_RE = /^WRITER \d+$/i;
const TEMPLATE_TAB_NAME = "TEMPLATE (COPY ME)";

// A single quote inside a sheet name (e.g. a client called "O'Brien") has to
// be doubled when the name is embedded in quoted A1 range syntax, or the
// range string breaks. Client/collaborator names are free text staff type
// in, so this can't be assumed away.
const qt = (title) => title.replace(/'/g, "''");

let cachedClient = null;

export function getSheetsClient() {
  if (cachedClient) return cachedClient;
  const email = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const key = (process.env.GOOGLE_SHEETS_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Google Sheets credentials are not configured.");
  const auth = new google.auth.JWT({ email, key, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  cachedClient = google.sheets({ version: "v4", auth });
  return cachedClient;
}

export function getSheetId() {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("GOOGLE_SHEET_ID is not configured.");
  return id;
}

// { title, sheetId }[] for every tab in the spreadsheet.
export async function listTabs(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  return (res.data.sheets || []).map((s) => ({ title: s.properties.title, sheetId: s.properties.sheetId }));
}

// Case-insensitive exact match against known tab titles.
export function findTab(tabs, name) {
  const n = (name || "").trim().toLowerCase();
  return tabs.find((t) => t.title.trim().toLowerCase() === n) || null;
}

async function isTabEmpty(sheets, spreadsheetId, tabTitle) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${qt(tabTitle)}'!A${DATA_START_ROW}:A${DATA_START_ROW + 5}`,
  });
  const rows = res.data.values || [];
  return rows.every((r) => !r[0]);
}

// Claim an empty WRITER tab (renaming it), or clone TEMPLATE if none are free.
// Returns the resolved { title, sheetId }.
export async function claimTabForNewCollaborator(sheets, spreadsheetId, name, tabs) {
  const writerTabs = tabs.filter((t) => WRITER_TAB_RE.test(t.title));
  for (const t of writerTabs) {
    if (await isTabEmpty(sheets, spreadsheetId, t.title)) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ updateSheetProperties: { properties: { sheetId: t.sheetId, title: name }, fields: "title" } }] },
      });
      return { title: name, sheetId: t.sheetId };
    }
  }
  // no empty WRITER tab left — clone the template
  const template = findTab(tabs, TEMPLATE_TAB_NAME);
  if (!template) throw new Error(`Could not find "${TEMPLATE_TAB_NAME}" tab to clone.`);
  const dup = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ duplicateSheet: { sourceSheetId: template.sheetId, newSheetName: name } }] },
  });
  const newProps = dup.data.replies[0].duplicateSheet.properties;
  return { title: newProps.title, sheetId: newProps.sheetId };
}

// Find the row (1-indexed) whose Site Sync ID (col N) matches `syncId`, or null.
export async function findRowBySyncId(sheets, spreadsheetId, tabTitle, syncId) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${qt(tabTitle)}'!N${DATA_START_ROW}:N1000` });
  const rows = res.data.values || [];
  const idx = rows.findIndex((r) => r[0] === syncId);
  return idx === -1 ? null : DATA_START_ROW + idx;
}

// Write Song Title / Recording Artist / Writer Share % / Luminate ID / Site
// Sync ID into a specific row, leaving every formula column untouched.
export async function writeSongRow(sheets, spreadsheetId, tabTitle, row, { song, artist, percent, luminateId, syncId }) {
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: `'${qt(tabTitle)}'!A${row}`, values: [[song]] },
        { range: `'${qt(tabTitle)}'!B${row}`, values: [[artist]] },
        { range: `'${qt(tabTitle)}'!D${row}`, values: [[percent / 100]] },
        { range: `'${qt(tabTitle)}'!M${row}`, values: [[luminateId || ""]] },
        { range: `'${qt(tabTitle)}'!N${row}`, values: [[syncId]] },
      ],
    },
  });
}

// Clear a deleted song back out — only the same columns writeSongRow ever
// touches (A, B, D, M, N), never the formula columns, since staff sometimes
// hand-tune a row's Blended Rate or Decay cell and that must survive.
export async function clearSongRow(sheets, spreadsheetId, tabTitle, row) {
  await sheets.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: {
      ranges: ["A", "B", "D", "M", "N"].map((col) => `'${qt(tabTitle)}'!${col}${row}`),
    },
  });
}

// Stamp just the Site Sync ID column onto a row a staff member typed
// directly into the sheet, so a song created on pull round-trips cleanly —
// the next push updates this exact row instead of appending a duplicate.
export async function writeSyncId(sheets, spreadsheetId, tabTitle, row, syncId) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${qt(tabTitle)}'!N${row}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[syncId]] },
  });
}

// Every client/writer tab ends its data block with a literal "Total" row
// (currently row 64 or 65, depending on the tab — it isn't a fixed number)
// whose own SUM(...) formulas the MASTER tab reads by absolute cell
// reference. Below that sit five fixed instructional rows. Both are
// permanent fixtures, not song data — never let row-scanning logic wander
// past the Total row, or a new song either overwrites sheet-owned content
// or lands outside the range the Total row's SUM formulas cover, silently
// dropping it from every rollup that reads this tab.
async function totalRowIndex(sheets, spreadsheetId, tabTitle) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${qt(tabTitle)}'!A${DATA_START_ROW}:A2000`,
  });
  const rows = res.data.values || [];
  const idx = rows.findIndex((r) => (r[0] || "").trim() === "Total");
  return { rows, totalRow: idx === -1 ? null : DATA_START_ROW + idx };
}

// The sheet pre-fills formula columns (Blended Rate, YoY Decay, …) on every
// row of a fresh WRITER/TEMPLATE tab even where no song has been entered —
// that fools values.append's own "find the table" heuristic into skipping
// past dozens of formula-only rows. Column A (Song Title) is the one thing
// that's genuinely blank until a real row is written, so use it directly,
// matching the same definition isTabEmpty() already uses.
async function firstEmptyRow(sheets, spreadsheetId, tabTitle) {
  const { rows, totalRow } = await totalRowIndex(sheets, spreadsheetId, tabTitle);
  const searchable = totalRow === null ? rows : rows.slice(0, totalRow - DATA_START_ROW);
  const idx = searchable.findIndex((r) => !r[0]);
  if (idx !== -1) return DATA_START_ROW + idx;
  if (totalRow !== null) {
    throw new Error(`No room left in the "${tabTitle}" tab — every row above its Total row is full. Add more rows above the Total row in the sheet, then try again.`);
  }
  return DATA_START_ROW + rows.length;
}

export async function appendSongRow(sheets, spreadsheetId, tabTitle, payload) {
  const row = await firstEmptyRow(sheets, spreadsheetId, tabTitle);
  await writeSongRow(sheets, spreadsheetId, tabTitle, row, payload);
  return row;
}

// Sheets returns computed cells as display strings ("1,000,000", "$2,500.00",
// "100.0%") from these formula columns, not raw numbers — Number() on those
// returns NaN, which the `|| 0` fallback silently turns into a false zero.
const parseNum = (v) => {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// Read every data row (A,B,D,C,G,H,M,N) from a tab for the pull direction.
// Stops at the tab's "Total" row (see firstEmptyRow's note above) so that
// row and the instructional text below it never get read back as songs.
export async function readTabRows(sheets, spreadsheetId, tabTitle) {
  const [startCol, endCol] = SHEET_COLUMNS.split(":");
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${qt(tabTitle)}'!${startCol}${DATA_START_ROW}:${endCol}2000` });
  const rows = res.data.values || [];
  const totalIdx = rows.findIndex((r) => (r[0] || "").trim() === "Total");
  const dataRows = totalIdx === -1 ? rows : rows.slice(0, totalIdx);
  return dataRows
    .map((r, i) => ({ r, row: DATA_START_ROW + i }))
    .filter(({ r }) => r[0])
    .map(({ r, row }) => ({
      row,
      song: r[0] || "",
      artist: r[1] || "",
      grossStreams: parseNum(r[2]),
      writerShare: parseNum(r[3]),
      grossRevenue: parseNum(r[6]),
      adminFee: parseNum(r[7]),
      luminateId: r[12] || "",
      syncId: r[13] || "",
    }));
}

export { DATA_START_ROW, WRITER_TAB_RE, TEMPLATE_TAB_NAME };
