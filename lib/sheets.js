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

// The standard formula set for columns C through L on any row, confirmed
// against an untouched WRITER tab — identical on every row from 5 through
// the Total row regardless of whether that row holds a real song.
const pristineFormulaRow = (n) => [
  `=IFERROR(INDEX('STREAM DATA'!$D:$D,MATCH($M${n},'STREAM DATA'!$A:$A,0)),0)`,
  "",
  `=IF(OR(ISBLANK(C${n}), C${n}=0), "", C${n}*D${n})`,
  "=ASSUMPTIONS!$B$7",
  `=IF(OR(E${n}="", E${n}=0), "", E${n}*F${n})`,
  `=IF(OR(G${n}="", G${n}=0), "", G${n}*0.2)`,
  "=ASSUMPTIONS!$B$8",
  `=IF(OR(H${n}="", H${n}=0), "", H${n}*ASSUMPTIONS!$B$9*(1-I${n}))`,
  `=IF(OR(J${n}="", J${n}=0), "", J${n}*(1-I${n}))`,
  `=IF(OR(K${n}="", K${n}=0), "", K${n}*(1-I${n}))`,
]; // columns C..L, 10 values

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

// Case-insensitive match against known tab titles. Falls back to a
// punctuation-stripped comparison for cases like a client's on-site display
// name being "Stack!e" while their actual tab on the sheet is "Stackie" —
// otherwise sync for that client silently finds nothing at all unless staff
// remember to fill in the client's "Sheet tab name" override by hand.
export function findTab(tabs, name) {
  const n = (name || "").trim().toLowerCase();
  const exact = tabs.find((t) => t.title.trim().toLowerCase() === n);
  if (exact) return exact;
  const norm = n.replace(/[^a-z0-9]+/g, "");
  if (!norm) return null;
  return tabs.find((t) => t.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "") === norm) || null;
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

// The reverse of claimTabForNewCollaborator — called when a client is
// deleted on the site. Wipes the tab's data and returns it to the WRITER
// pool under a generic name instead of leaving a deleted client's name
// sitting on an empty tab forever. No-op (returns null) for a tab that's
// already a generic WRITER slot, a tab that was cloned from TEMPLATE (its
// name doesn't fit back into a fixed WRITER-N slot), or if every WRITER
// slot is already taken — better to leave the tab alone than guess.
export async function releaseTabToPool(sheets, spreadsheetId, tabTitle, tabs) {
  const t = findTab(tabs, tabTitle);
  if (!t || WRITER_TAB_RE.test(t.title)) return null;
  const taken = new Set(tabs.filter((x) => WRITER_TAB_RE.test(x.title)).map((x) => Number(x.title.split(" ")[1])));
  let n = null;
  for (let i = 14; i <= 30; i++) if (!taken.has(i)) { n = i; break; }
  if (n === null) return null;
  const newTitle = `WRITER ${n}`;
  // Clear the site-owned columns (A, B, D, M, N — same set clearSongRow
  // touches) and reset the formula columns (C,E,F,G,H,I,J,K,L) to the
  // standard template on every row, row 5 included. A prior occupant may
  // have hand-overridden a row's Blended Rate/Decay cell (the sheet
  // explicitly allows this) or, before this function was fixed, had those
  // formulas wiped outright — neither should carry over to whoever claims
  // this tab next, so every row goes back to the exact pristine state seen
  // on an untouched WRITER slot. Never touches the Total row or below.
  const { totalRow } = await totalRowIndex(sheets, spreadsheetId, t.title);
  const lastRow = totalRow === null ? 64 : totalRow - 1;
  if (lastRow >= DATA_START_ROW) {
    await sheets.spreadsheets.values.batchClear({
      spreadsheetId,
      requestBody: { ranges: ["A", "B", "D", "M", "N"].map((col) => `'${qt(t.title)}'!${col}${DATA_START_ROW}:${col}${lastRow}`) },
    });
    const data = [];
    for (let r = DATA_START_ROW; r <= lastRow; r++) {
      data.push({ range: `'${qt(t.title)}'!C${r}:L${r}`, values: [pristineFormulaRow(r)] });
    }
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "USER_ENTERED", data },
    });
  }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ updateSheetProperties: { properties: { sheetId: t.sheetId, title: newTitle }, fields: "title" } }] },
  });
  return newTitle;
}

// Find the row (1-indexed) whose Site Sync ID (col N) matches `syncId`, or null.
export async function findRowBySyncId(sheets, spreadsheetId, tabTitle, syncId) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${qt(tabTitle)}'!N${DATA_START_ROW}:N1000` });
  const rows = res.data.values || [];
  const idx = rows.findIndex((r) => r[0] === syncId);
  return idx === -1 ? null : DATA_START_ROW + idx;
}

// Staff often hand-type a "(feat. X)" tag onto the sheet's title cell while
// looking up stream data, even though the site keeps the featured artist in
// its own separate field and never appends it to the song title — so a
// title match has to tolerate that tag or it silently never links up.
const normalizeTitle = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  .replace(/\s+(feat|ft|featuring)\s+.*$/, "").trim();

// The Luminate ID is the one field that identifies a specific real-world
// song regardless of what the site currently says about it — title, artist,
// and splits are all free text staff can edit. If a local placement's own
// id ever changes (deleted and re-added, a stale duplicate re-synced,
// anything that generates a fresh id), its syncId no longer matches the row
// it used to own, even though it's unmistakably the same song. Unlike
// findUnclaimedRowByTitle, this deliberately DOES reclaim a row that
// already carries a (now-stale) syncId — a shared Luminate ID is a
// stronger signal than "some other placement claimed this once."
export async function findRowByLuminateId(sheets, spreadsheetId, tabTitle, luminateId) {
  const target = (luminateId || "").trim();
  if (!target) return null;
  const { totalRow } = await totalRowIndex(sheets, spreadsheetId, tabTitle);
  const lastRow = totalRow === null ? 1000 : totalRow - 1;
  if (lastRow < DATA_START_ROW) return null;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${qt(tabTitle)}'!M${DATA_START_ROW}:M${lastRow}` });
  const rows = res.data.values || [];
  const idx = rows.findIndex((r) => (r[0] || "").trim() === target);
  return idx === -1 ? null : DATA_START_ROW + idx;
}

// A row that predates this feature (a real, pre-existing song someone typed
// in by hand before Site Sync IDs existed) has no syncId to match against.
// Without this, pushing an edit to that placement finds nothing via
// findRowBySyncId and appends a brand-new row right next to the original —
// a real duplicate with real financial data sitting twice in the same tab.
// Mirrors the title-fallback matching the pull direction already does; this
// is that same logic for the push direction. Only ever claims a row with no
// Site Sync ID of its own, so it can't steal a row another placement owns.
// liveIds (optional) is the pushing browser's full set of current placement
// ids — a row's syncId only means "actually claimed" if the placement it
// names still exists on that browser. Without this, a browser whose local
// copy of a song has drifted from whatever id last pushed it (a second
// staff member's device, a placement that got deleted/re-added) can never
// reclaim that song's real row through any path — the syncId doesn't match
// (findRowBySyncId), the local placement usually has no Luminate ID of its
// own yet either (findRowByLuminateId never even runs), and title-fallback
// used to refuse any row that already had a syncId at all — so it silently
// appended a real duplicate instead. Same fix as the pull-side reclaim.
export async function findUnclaimedRowByTitle(sheets, spreadsheetId, tabTitle, song, liveIds) {
  const target = normalizeTitle(song);
  if (!target) return null;
  const { totalRow } = await totalRowIndex(sheets, spreadsheetId, tabTitle);
  const lastRow = totalRow === null ? 1000 : totalRow - 1;
  if (lastRow < DATA_START_ROW) return null;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${qt(tabTitle)}'!A${DATA_START_ROW}:N${lastRow}` });
  const rows = res.data.values || [];
  // no liveIds passed at all -> preserve the strict original behavior (any
  // syncId blocks reclaim); liveIds passed -> a syncId only counts as
  // "genuinely claimed" if its owner is actually in that set.
  const live = liveIds == null ? null : (liveIds instanceof Set ? liveIds : new Set(liveIds));
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const syncId = r[13] || "";
    if (syncId) {
      const orphaned = live && !live.has(syncId.split(":")[0]);
      if (!orphaned) continue; // still genuinely claimed, or we have no way to know
    }
    if (normalizeTitle(r[0]) === target) return DATA_START_ROW + i;
  }
  return null;
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

// Read-only rollup for the staff Clients-tab overview — reads the MASTER
// tab's own precomputed per-writer totals directly rather than re-deriving
// them client-side, so the overview always matches the sheet exactly,
// including the 3-year forecast columns the site doesn't otherwise track.
const MASTER_TOP_KEYS = {
  "ROSTER GROSS STREAMS": "rosterGrossStreams",
  "ROSTER NET STREAMS": "rosterNetStreams",
  "GROSS REVENUE POOL": "grossRevenuePool",
  "CATALOG TO DATE": "catalogToDate",
  "3-YEAR FORECAST": "threeYearForecast",
  "TOTAL EST. ADMIN FEE": "totalEstAdminFee",
};

// Column A's label ("Stackie", "WRITER 13") is just hand-typed display text
// — it can go stale (a client renamed their tab but not this cell) or even
// be flat-out wrong (a row labeled "WRITER 13" was found to actually pull
// from the "prodgavin" tab). Every other column's formula hardcodes the
// real tab it reads from, e.g. =IF(COUNTA('Stack!e'!A5:A63)=0,"",...) or
// =IF(COUNTA(prodgavin!A5:A63)=0,"",...) — quoted only when the tab name
// needs it. Pull the tab name out of that formula instead of trusting the
// label, so overview rows link to the right client even when the label doesn't.
const MASTER_TAB_REF_RE = /COUNTA\(\s*(?:'([^']+)'|([A-Za-z0-9_]+))!/;
const extractTabRef = (formula) => {
  const m = MASTER_TAB_REF_RE.exec(formula || "");
  return m ? (m[1] || m[2] || "") : "";
};

async function readMasterRollupOnce(sheets, spreadsheetId) {
  // sequential, not Promise.all — this route can land at the same moment as
  // the much heavier per-client sheets-pull sync (both fire on a fresh
  // staff dashboard load), and two concurrent reads to the same sheet
  // occasionally raced into a transient all-zero response during testing.
  const valuesRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'MASTER'!A1:L300" });
  const formulaRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'MASTER'!A1:L300", valueRenderOption: "FORMULA" });
  const rows = valuesRes.data.values || [];
  const formulaRows = formulaRes.data.values || [];

  const topLabels = rows[0] || [];
  const topValues = rows[1] || [];
  const totals = {};
  topLabels.forEach((label, i) => {
    const key = MASTER_TOP_KEYS[(label || "").trim()];
    if (key) totals[key] = parseNum(topValues[i]);
  });

  // find the per-writer table by its own header rather than a hardcoded
  // row number, so a sheet edit that shifts rows doesn't silently break this.
  const headerIdx = rows.findIndex((r) => (r[0] || "").trim() === "Writer");

  const toRow = (r, formulaRow) => ({
    writer: r[0] || "",
    sheetTab: extractTabRef(formulaRow?.[1]), // Songs Logged formula holds the real tab reference
    songs: parseNum(r[1]),
    grossStreams: parseNum(r[2]),
    netStreams: parseNum(r[3]),
    grossRevenue: parseNum(r[4]),
    adminFee: parseNum(r[5]),
    year1: parseNum(r[6]),
    year2: parseNum(r[7]),
    year3: parseNum(r[8]),
    forecastTotal: parseNum(r[9]),
    totalEstAdminFee: parseNum(r[10]),
    pctOfRoster: parseNum(r[11]),
  });

  let rosterTotal = null;
  const writerRows = [];
  for (let i = headerIdx + 1; headerIdx !== -1 && i < rows.length; i++) {
    const r = rows[i];
    const label = (r[0] || "").trim();
    if (!label) continue;
    if (label === "ROSTER TOTAL") { rosterTotal = toRow(r, formulaRows[i]); break; }
    if (!parseNum(r[1])) continue; // empty placeholder WRITER slot — no songs logged
    writerRows.push(toRow(r, formulaRows[i]));
  }

  return { totals, rows: writerRows, rosterTotal };
}

// The roster always has real streams logged, so a result with rows but a
// zeroed-out roster total is a transient read glitch, not real data — retry
// once rather than showing staff a broken-looking $0 overview.
export async function readMasterRollup(sheets, spreadsheetId) {
  const first = await readMasterRollupOnce(sheets, spreadsheetId);
  if (first.rows.length > 0 && first.totals.rosterGrossStreams === 0) {
    return readMasterRollupOnce(sheets, spreadsheetId);
  }
  return first;
}

// MASTER row 4 holds three hyperlinks staff use often: a Drive folder icon
// and two Luminate portfolio shortcuts ("A"/"B"). values.get() never
// returns hyperlink targets (only cell text) — need the full grid data for
// that, which is a heavier call, so this is kept separate from the rollup.
export async function readMasterLinks(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: ["'MASTER'!A4:F4"],
    includeGridData: true,
  });
  const cells = meta.data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values || [];
  const links = {};
  for (const cell of cells) {
    if (!cell.hyperlink) continue;
    const label = (cell.formattedValue || "").trim();
    if (label.includes("FOLDER")) links.folder = cell.hyperlink;
    else if (label === "↗A") links.portfolioA = cell.hyperlink;
    else if (label === "↗B") links.portfolioB = cell.hyperlink;
  }
  return links;
}

export { DATA_START_ROW, WRITER_TAB_RE, TEMPLATE_TAB_NAME };
