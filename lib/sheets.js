// Shared Google Sheets helper for the two /api/sheets-* routes. Server-only —
// never imported from components/App.jsx directly, same boundary as the
// Spotify credentials pattern in /api/spotify.js.
import { google } from "googleapis";

const SHEET_COLUMNS = "A:N"; // A Song Title … M Luminate ID, N Site Sync ID
const DATA_START_ROW = 5; // rows 1-4 are the summary header block on every tab
const WRITER_TAB_RE = /^WRITER \d+$/i;
const TEMPLATE_TAB_NAME = "TEMPLATE (COPY ME)";

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
    range: `'${tabTitle}'!A${DATA_START_ROW}:A${DATA_START_ROW + 5}`,
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
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tabTitle}'!N${DATA_START_ROW}:N1000` });
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
        { range: `'${tabTitle}'!A${row}`, values: [[song]] },
        { range: `'${tabTitle}'!B${row}`, values: [[artist]] },
        { range: `'${tabTitle}'!D${row}`, values: [[percent / 100]] },
        { range: `'${tabTitle}'!M${row}`, values: [[luminateId || ""]] },
        { range: `'${tabTitle}'!N${row}`, values: [[syncId]] },
      ],
    },
  });
}

export async function appendSongRow(sheets, spreadsheetId, tabTitle, { song, artist, percent, luminateId, syncId }) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${tabTitle}'!A${DATA_START_ROW}:N`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [[song, artist, "", percent / 100, "", "", "", "", "", "", "", "", luminateId || "", syncId]] },
  });
}

// Read every data row (A,B,D,C,G,H,M,N) from a tab for the pull direction.
export async function readTabRows(sheets, spreadsheetId, tabTitle) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tabTitle}'!${SHEET_COLUMNS}${DATA_START_ROW}:${SHEET_COLUMNS.split(":")[1]}1000` });
  const rows = res.data.values || [];
  return rows
    .filter((r) => r[0])
    .map((r) => ({
      song: r[0] || "",
      artist: r[1] || "",
      grossStreams: Number(r[2]) || 0,
      writerShare: Number(r[3]) || 0,
      grossRevenue: Number(r[6]) || 0,
      adminFee: Number(r[7]) || 0,
      luminateId: r[12] || "",
      syncId: r[13] || "",
    }));
}

export { DATA_START_ROW, WRITER_TAB_RE, TEMPLATE_TAB_NAME };
