// The A&R sheet (r11, the owner: "track all our A&R stuff on a seperate new spreadsheet"). Server only.
// A ONE-WAY copy of the A&R lists: the database stays the source of truth and nothing here ever reads the
// sheet's values back. Its own spreadsheet (AR_TRACKER_SHEET_ID), the same Google service account as the others.
//   Watchlist  a bold, frozen header row, then one row per thing on anyone's list (merged like the Watchlist:
//              one row, all the names), sorted Type then Name. Rewritten in full (A:V only, values only: RAW,
//              never a formula) after every list change and after the daily data cron.
//   Log        one row appended per action: Added / Removed / Renewed / Expired / Confirmed. Never cleared.
// Both tabs are created with their headers when missing. No other tab is read or written, and no row of Log
// is ever deleted. AR_TRACKER_SHEET_WRITES (default off, read at call time) gates all of it: off, nothing here
// calls Google at all. AR_TRACKER_SHEET_LINK_ID only builds the "Open the sheet" link ("none" hides it).
// A real number or blank, never a 0 for something unknown.
import { sql, rowsOrNoneIfNoTable } from "../db";
import { getSheetsClient } from "../sheets";
import { getState, setState } from "../app-state";
import { uid } from "../id";

const on = (v) => /^(on|true|1|yes)$/i.test(String(v || "").trim());
export const trackerSheetOn = () => on(process.env.AR_TRACKER_SHEET_WRITES);
export const trackerSheetId = () => String(process.env.AR_TRACKER_SHEET_ID || "").trim();
// "Open the sheet": AR_TRACKER_SHEET_LINK_ID when set ("none" = no link), else the sheet itself
export function trackerSheetUrl() {
  const l = String(process.env.AR_TRACKER_SHEET_LINK_ID || "").trim();
  if (/^none$/i.test(l)) return "";
  const id = l || trackerSheetId();
  return id ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit` : "";
}

export const WATCH_TAB = "Watchlist";
export const LOG_TAB = "Log";
export const WATCH_HEADERS = ["Type", "Name", "Artist", "Added by", "Added on", "Tracking", "Spotify", "Instagram", "TikTok", "YouTube",
  "Monthly listeners", "Spotify followers", "Instagram followers", "TikTok followers", "YouTube subscribers", "Spotify streams", "Sound videos",
  "Day change", "Week change", "Luminate last week", "Updated", "Notes"];
export const LOG_HEADERS = ["Date", "Who", "Action", "Type", "Name", "Link"];
export const ACTIONS = ["Added", "Removed", "Renewed", "Expired", "Confirmed"];
export const TYPE_ORDER = ["Artist", "Producer", "Song", "TikTok sound"];
const COLS = WATCH_HEADERS.length; // 22: A:V
const LAST_COL = String.fromCharCode(64 + COLS); // V
const NUM_COLS = [10, 11, 12, 13, 14, 15, 16]; // K:Q, whole numbers
const DATE_COL = 4, UPDATED_COL = 20; // E, U
const STATE = "arTrackerSheet", LOCK = "arTrackerSheetLock", DIRTY = "arTrackerSheetDirty";
const DAY = 864e5;
const NY = "America/New_York";
const q = (tab) => `'${tab}'`;

// ---------------------------------------------------------------- pure: the cells
const nyParts = (t) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: NY, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
  .formatToParts(new Date(t)).map((p) => [p.type, p.value]));
// a Sheets date serial (days since 1899-12-30) of the New York day; with the time of day when asked
export function nySerial(t, { time = false } = {}) {
  if (!t || !Number.isFinite(new Date(t).getTime())) return "";
  const p = nyParts(t);
  const days = (Date.UTC(+p.year, +p.month - 1, +p.day) - Date.UTC(1899, 11, 30)) / DAY;
  return time ? days + (+p.hour * 3600 + +p.minute * 60 + +p.second) / 86400 : days;
}
// the Log's date, as text in New York: "Nov 5, 2026 11:03 AM"
export const nyStamp = (t) => new Intl.DateTimeFormat("en-US", { timeZone: NY, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(t)).replace(/, (\d{1,2}:\d{2})/, " $1").replace(/ /g, " ");

const fmtN = (n) => Math.round(Math.abs(n)).toLocaleString("en-US");
const num = (c) => (c && c.v != null && c.v !== "" && Number.isFinite(Number(c.v)) ? Number(c.v) : "");
const UNIT = { listeners: ["listener", "listeners"], streams: ["stream", "streams"], videos: ["video", "videos"] };
const MAIN = { artist: "listeners", song: "streams", sound: "videos" };
// "+609 listeners (+11.7%)": the change of the row's main number (an artist's monthly listeners, a song's
// streams, a sound's videos) over a day or a week; blank until there are readings for it
export function changeText(c, key, which) {
  if (!c || c.untracked || c.none) return "";
  const d = which === "week" ? c.d7 : c.d1;
  if (d == null || !Number.isFinite(Number(d))) return "";
  const p = which === "week" ? c.g7 : c.g1;
  const sign = (x) => (x > 0 ? "+" : x < 0 ? "-" : "");
  const [one, many] = UNIT[key] || ["", ""];
  const word = Math.abs(Math.round(d)) === 1 ? one : many;
  const pct = p != null && Number.isFinite(Number(p)) ? ` (${sign(p)}${Math.abs(p).toFixed(1)}%)` : "";
  return `${sign(d)}${fmtN(d)}${word ? ` ${word}` : ""}${pct}`;
}
export function trackingText(t) {
  if (!t) return "";
  if (t.never || t.roster) return "Never ends";
  if (t.state === "expired") return "Expired";
  if (t.daysLeft != null) return `${t.daysLeft} ${t.daysLeft === 1 ? "day" : "days"} left`;
  return "";
}
// Artist / Producer / Song / TikTok sound. roles: { tracked: Map(id -> ar_tracked row), clients: Map(id -> role) }
export function typeOf(r, roles = {}) {
  if (r.kind === "song") return "Song";
  if (r.kind === "sound") return "TikTok sound";
  // a roster row: its client's role (Site › Roster: "Producer", "Artist"); a Watchlist row: ar_tracked.role (r11)
  const role = r.role || (r.trackedId && roles.tracked?.get(r.trackedId)?.role) || (r.clientId && roles.clients?.get(r.clientId)) || "";
  return /^\s*producer\s*$/i.test(String(role)) ? "Producer" : "Artist";
}
const mainLink = (r) => (r.kind === "sound" ? r.links?.tiktok : r.links?.spotify || r.links?.instagram || r.links?.tiktok || r.links?.youtube) || "";
// the newest reading on the row
const updatedOf = (r) => Object.values(r.m || {}).map((c) => c?.at).filter(Boolean).sort().pop() || "";

// One Watchlist row (22 cells) from an A&R lists row (lib/ar/lists.js arLists rows). Pure.
export function watchCells(r, roles = {}) {
  const m = r.m || {}, main = MAIN[r.kind];
  const notes = r.notes ?? (r.trackedId ? roles.tracked?.get(r.trackedId)?.notes : "") ?? "";
  const lum = r.lum?.week && r.lum.week.v != null ? `${fmtN(r.lum.week.v)}${r.lum.week.label ? ` (${r.lum.week.label})` : ""}` : "";
  return [
    typeOf(r, roles), r.name || "", r.kind === "song" || r.kind === "sound" ? r.artist || "" : "",
    (r.names || []).join(", "), nySerial(r.addedAt), trackingText(r.tracking),
    r.kind === "sound" ? "" : r.links?.spotify || "", r.links?.instagram || "", r.links?.tiktok || "", r.links?.youtube || "",
    num(m.listeners), num(m.spfollowers), num(m.instagram), num(m.tiktok), num(m.youtube), num(m.streams), num(m.videos),
    changeText(m[main], main, "day"), changeText(m[main], main, "week"), lum, nySerial(updatedOf(r), { time: true }), String(notes || ""),
  ];
}
// The whole Watchlist tab: header + rows sorted Type, then Name (then Artist). Pure.
export function planWatchlist(rows, roles = {}) {
  const out = rows.map((r) => watchCells(r, roles));
  const t = (x) => { const i = TYPE_ORDER.indexOf(x[0]); return i < 0 ? 9 : i; };
  out.sort((a, b) => t(a) - t(b) || String(a[1]).localeCompare(String(b[1]), "en", { sensitivity: "base" }) || String(a[2]).localeCompare(String(b[2]), "en", { sensitivity: "base" }));
  return [WATCH_HEADERS, ...out];
}
// One Log row. Pure.
export function logCells({ at, who, action, type, name, link }) {
  return [nyStamp(at), String(who || ""), action, type || "", name || "", link || ""];
}

// ---------------------------------------------------------------- reads (the database only)
async function rolesNow() {
  const [tracked, clients] = await Promise.all([rowsOrNoneIfNoTable(sql`SELECT * FROM ar_tracked`), sql`SELECT id, role FROM clients`]);
  return { tracked: new Map(tracked.map((t) => [t.id, t])), clients: new Map(clients.map((c) => [c.id, c.role || ""])) };
}
// every row on anyone's list, as the Watchlist merges them (lib/ar/lists.js: Team folded into Watchlist)
export async function watchRows({ now = Date.now() } = {}) {
  const L = await import("./lists");
  const [lists, roles] = await Promise.all([L.arLists({ view: "team", now }), rolesNow()]);
  return { rows: lists.rows || [], roles };
}
// what one subject is, for a Log line (also after it came off every list: the rows stay in the database)
export async function subjectLine(subject, roles = null) {
  const [p, id] = [String(subject).slice(0, 1), String(subject).slice(2)];
  const R = roles || await rolesNow();
  if (p === "w") {
    const t = R.tracked.get(id);
    if (!t) return null;
    const kind = t.kind === "song" ? "song" : "artist";
    const link = t.spotify || (t.instagram ? `https://www.instagram.com/${String(t.instagram).replace(/^@/, "")}` : "") || (t.tiktok ? `https://www.tiktok.com/@${String(t.tiktok).replace(/^@/, "")}` : "") || t.youtube || "";
    return { type: typeOf({ kind, trackedId: id }, R), name: t.name || "", link: String(link).split("?")[0] };
  }
  if (p === "a") {
    const [c] = await sql`SELECT id, name, spotify, role FROM clients WHERE id = ${id}`;
    return c ? { type: typeOf({ kind: "artist", role: c.role }), name: c.name, link: String(c.spotify || "").split("?")[0] } : null;
  }
  if (p === "s") {
    const [s] = await rowsOrNoneIfNoTable(sql`SELECT clip_id, title, author, url FROM radar_sounds WHERE clip_id = ${id}`);
    const { soundTitle } = await import("./lists");
    return { type: "TikTok sound", name: soundTitle(s || {}, id), link: s?.url && /tiktok\.com\/music\//.test(s.url) ? s.url.split("?")[0] : `https://www.tiktok.com/music/x-${id}` };
  }
  return null;
}

// ---------------------------------------------------------------- Google
// the two tabs (created with their header when missing: bold, frozen); nothing else in the spreadsheet is touched
async function ensureTabs(sheets, spreadsheetId) {
  const got = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const all = (got.data.sheets || []).map((s) => s.properties);
  const find = (t) => all.find((p) => p.title === t) || all.find((p) => String(p.title).toLowerCase() === t.toLowerCase()) || null;
  const missing = [[WATCH_TAB, WATCH_HEADERS], [LOG_TAB, LOG_HEADERS]].filter(([t]) => !find(t));
  if (missing.length) {
    const r = await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: missing.map(([title, h]) => ({ addSheet: { properties: { title, gridProperties: { rowCount: 1000, columnCount: Math.max(h.length, 26), frozenRowCount: 1 } } } })) } });
    const made = (r.data.replies || []).map((x) => x.addSheet?.properties).filter(Boolean);
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: missing.map(([t, h]) => ({ range: `${q(t)}!A1:${String.fromCharCode(64 + h.length)}1`, values: [h] })) } });
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: made.map((p) => ({ repeatCell: { range: { sheetId: p.sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: "userEnteredFormat.textFormat.bold" } })) } });
    all.push(...made);
  }
  const props = (p) => ({ sheetId: p.sheetId, title: p.title, rowCount: p.gridProperties?.rowCount ?? 1000, colCount: p.gridProperties?.columnCount ?? 26 });
  return { watch: props(find(WATCH_TAB)), log: props(find(LOG_TAB)), created: missing.map(([t]) => t) };
}

// the whole Watchlist, A:V: the grid grows first when it has to, then one write, then the rows below are cleared
// (an item that came off), then the number and date formats over the rows written
async function writeWatchlist(sheets, spreadsheetId, tab, grid) {
  const need = grid.length;
  let rowCount = tab.rowCount;
  const grow = [];
  if (need > rowCount) { rowCount = need + 200; grow.push({ updateSheetProperties: { properties: { sheetId: tab.sheetId, gridProperties: { rowCount } }, fields: "gridProperties.rowCount" } }); }
  if (tab.colCount < COLS) grow.push({ updateSheetProperties: { properties: { sheetId: tab.sheetId, gridProperties: { columnCount: COLS } }, fields: "gridProperties.columnCount" } });
  if (grow.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: grow } });
  const values = grid.map((row) => Array.from({ length: COLS }, (_, i) => (row[i] == null ? "" : row[i])));
  await sheets.spreadsheets.values.update({ spreadsheetId, range: `${q(WATCH_TAB)}!A1:${LAST_COL}${need}`, valueInputOption: "RAW", requestBody: { values } });
  if (need < rowCount) await sheets.spreadsheets.values.batchClear({ spreadsheetId, requestBody: { ranges: [`${q(WATCH_TAB)}!A${need + 1}:${LAST_COL}${rowCount}`] } });
  if (need > 1) {
    const rng = (c1, c2 = c1 + 1) => ({ sheetId: tab.sheetId, startRowIndex: 1, endRowIndex: need, startColumnIndex: c1, endColumnIndex: c2 });
    const nf = (range, numberFormat) => ({ repeatCell: { range, cell: { userEnteredFormat: { numberFormat } }, fields: "userEnteredFormat.numberFormat" } });
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
      nf(rng(DATE_COL), { type: "DATE", pattern: "mmm d, yyyy" }),
      nf(rng(UPDATED_COL), { type: "DATE_TIME", pattern: "mmm d, yyyy h:mm am/pm" }),
      nf(rng(NUM_COLS[0], NUM_COLS[NUM_COLS.length - 1] + 1), { type: "NUMBER", pattern: "#,##0" }),
    ] } });
  }
  return need - 1;
}
async function appendLog(sheets, spreadsheetId, lines) {
  if (!lines.length) return 0;
  await sheets.spreadsheets.values.append({ spreadsheetId, range: `${q(LOG_TAB)}!A:F`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: lines.map(logCells) } });
  return lines.length;
}

// a Google error in plain words, for Site › Sync
export function plainError(err) {
  const code = Number(err?.code || err?.response?.status || err?.status) || 0;
  const who = String(process.env.GOOGLE_SHEETS_CLIENT_EMAIL || "").trim();
  if (code === 404) return "Couldn't find the A&R spreadsheet. Check AR_TRACKER_SHEET_ID.";
  if (code === 403) return `The A&R spreadsheet isn't shared with the site's Google account${who ? ` (${who})` : ""}. Share it as Editor.`;
  if (code === 401) return "Google turned the site's sign-in down. Check the Google key.";
  if (code === 429) return "Google asked us to slow down. The next change or the daily update writes it again.";
  return `Couldn't write the A&R sheet just now${code ? ` (Google answered ${code})` : ""}. The next change or the daily update tries again.`;
}

// ---------------------------------------------------------------- the lease (changes close together are written once)
async function claim() {
  const holder = uid();
  const [got] = await sql`
    INSERT INTO app_state (key, value, updated_at) VALUES (${LOCK}, jsonb_build_object('holder', ${holder}::text, 'until', now() + interval '60 seconds'), now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      WHERE (app_state.value->>'until')::timestamptz < now() OR app_state.value->>'holder' = ''
    RETURNING value->>'holder' AS holder`;
  return got?.holder === holder ? holder : null;
}
const release = (holder) => sql`UPDATE app_state SET value = jsonb_build_object('holder', '', 'until', now()), updated_at = now() WHERE key = ${LOCK} AND value->>'holder' = ${holder}`.catch(() => null);
const markDirty = () => setState(DIRTY, { at: new Date().toISOString() }).catch(() => null);
const takeDirty = async () => { const [r] = await sql`DELETE FROM app_state WHERE key = ${DIRTY} RETURNING key`; return !!r; };

// One full rewrite (and the Log lines waiting), under the lease. A change that arrives while another
// request is writing only marks the sheet dirty; the writer sees that and writes once more (at most 3).
async function writeNow({ lines = [], now = Date.now(), sheets = getSheetsClient() } = {}) {
  const spreadsheetId = trackerSheetId();
  if (!spreadsheetId) { await saveState({ error: "AR_TRACKER_SHEET_ID isn't set, so there's no A&R sheet to write.", errorAt: new Date(now).toISOString() }); return { error: "no sheet id" }; }
  let tabs;
  try { tabs = await ensureTabs(sheets, spreadsheetId); } catch (err) { return failed(err, now); }
  let logged = 0;
  try { logged = await appendLog(sheets, spreadsheetId, lines); } catch (err) { return failed(err, now); }
  let rows = null, rounds = 0;
  for (; rounds < 3; rounds++) {
    const holder = await claim();
    if (!holder) { await markDirty(); return { logged, queued: true, created: tabs.created }; }
    try {
      await takeDirty();
      const { rows: list, roles } = await watchRows({ now });
      rows = await writeWatchlist(sheets, spreadsheetId, tabs.watch, planWatchlist(list, roles));
      if (rows + 1 > tabs.watch.rowCount) tabs.watch.rowCount = rows + 201;
    } catch (err) { await release(holder); return failed(err, now, { logged }); }
    await release(holder);
    const [again] = await sql`SELECT 1 AS x FROM app_state WHERE key = ${DIRTY}`;
    if (!again) break;
  }
  const st = { at: new Date().toISOString(), rows, logged: ((await getState(STATE).catch(() => null))?.logged || 0) + logged, error: null, errorAt: null };
  await saveState(st);
  return { ok: true, rows, logged, created: tabs.created };
}
async function saveState(patch) {
  const was = (await getState(STATE).catch(() => null)) || {};
  await setState(STATE, { ...was, ...patch }).catch(() => null);
}
async function failed(err, now, extra = {}) {
  console.error("A&R sheet write failed:", err?.message || err);
  const error = plainError(err);
  await saveState({ error, errorAt: new Date(now).toISOString() });
  return { error, ...extra };
}

// ---------------------------------------------------------------- the hooks
// After a change on the lists (lib/ar/trackers.js, the A&R API): log = [{ action, userId, who, subject }]. The Who
// is the person's live name (users, the way the lists show it), else `who`. Never throws, and never holds the
// change's answer up for more than `waitMs` (the next change or the daily cron catches up).
export async function afterListChange({ log = [], now = Date.now(), waitMs = 5000 } = {}) {
  if (!trackerSheetOn()) return { skipped: "AR_TRACKER_SHEET_WRITES is off" };
  const work = (async () => {
    const roles = log.length ? await rolesNow() : null;
    const ids = [...new Set(log.map((x) => x.userId).filter(Boolean))];
    const users = ids.length ? new Map((await sql`SELECT id, name, email FROM users WHERE id = ANY(${ids})`).map((u) => [u.id, u])) : new Map();
    const { displayName } = ids.length ? await import("./lists") : {};
    const lines = [];
    for (const x of log) {
      if (!ACTIONS.includes(x.action)) continue;
      const s = x.info || (x.subject ? await subjectLine(x.subject, roles).catch(() => null) : null);
      const who = (x.userId && users.has(x.userId) && displayName(users.get(x.userId))) || x.who || "";
      if (s) lines.push({ at: x.at || now, who, action: x.action, ...s });
    }
    return writeNow({ lines, now });
  })().catch((err) => failed(err, now));
  return Promise.race([work, new Promise((r) => setTimeout(() => r({ pending: true }), waitMs))]);
}

// After the daily data cron: what ran out since the last run goes in the Log (Expired, under the person whose
// entry it was), so does what the sweep took off 14 days later (Removed, "Automatic"); then the full rewrite.
export async function afterDataCron({ now = Date.now() } = {}) {
  if (!trackerSheetOn()) return { skipped: "AR_TRACKER_SHEET_WRITES is off" };
  try {
    const st = (await getState(STATE).catch(() => null)) || {};
    const from = st.expiredUpTo || new Date(now - DAY).toISOString(), to = new Date(now).toISOString();
    const [ran, gone] = await Promise.all([
      rowsOrNoneIfNoTable(sql`SELECT id, owner_id, owner_name, subject, expires_at FROM ar_tracker WHERE expires_at > ${from} AND expires_at <= ${to} AND subject NOT LIKE 'a:%' ORDER BY expires_at`),
      rowsOrNoneIfNoTable(sql`SELECT id, subject, removed_at FROM ar_tracker WHERE removed_why = 'expired' AND removed_at > ${from} AND removed_at <= ${to} ORDER BY removed_at`),
    ]);
    const users = await sql`SELECT id, name, email FROM users`;
    const { ownerName } = await import("./lists");
    const byId = new Map(users.map((u) => [u.id, u]));
    const roles = await rolesNow();
    const lines = [];
    for (const e of ran) { const s = await subjectLine(e.subject, roles).catch(() => null); if (s) lines.push({ at: e.expires_at, who: ownerName(e, byId), action: "Expired", ...s }); }
    for (const e of gone) { const s = await subjectLine(e.subject, roles).catch(() => null); if (s) lines.push({ at: e.removed_at, who: "Automatic", action: "Removed", ...s }); }
    const out = await writeNow({ lines, now });
    if (!out.error) await saveState({ expiredUpTo: to });
    return out;
  } catch (err) { return failed(err, now); }
}

// The status line (Site › Sync, GET /api/ar-tracker-sheet): Off / last written / the error
const nyClock = (t) => new Intl.DateTimeFormat("en-US", { timeZone: NY, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(t)).replace(/ /g, " ");
export async function trackerSheetStatus() {
  const url = trackerSheetUrl();
  if (!trackerSheetOn()) return { on: false, url, text: "A&R sheet: Off" };
  const st = (await getState(STATE).catch(() => null)) || {};
  if (st.error && (!st.at || st.errorAt > st.at)) return { on: true, url, error: st.error, errorAt: st.errorAt, at: st.at || null, rows: st.rows ?? null, text: `A&R sheet: ${st.error}` };
  if (!st.at) return { on: true, url, text: "A&R sheet: on, not written yet (it fills after the next list change or the daily update)" };
  return { on: true, url, at: st.at, rows: st.rows, text: `A&R sheet: last written ${nyClock(st.at)}, ${st.rows} ${st.rows === 1 ? "row" : "rows"}` };
}
// "Write it now" (POST /api/ar-tracker-sheet): the first fill after the sheet is shared, or after a hand edit
export async function rewriteNow({ now = Date.now() } = {}) {
  if (!trackerSheetOn()) return { skipped: "AR_TRACKER_SHEET_WRITES is off" };
  return writeNow({ now }).catch((err) => failed(err, now));
}
