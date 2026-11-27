// (2026-11-26, books-1126) Each year's accounting book, the Founders' setting (app_state "accountingBooks", {"2027": sheetId}; the lookup by
// year is lib/accounting.js). What GET /api/accounting-books shows (booksState), the check a pasted book must pass before it's saved (checkBook:
// this year's tabs and headers, rows of the right year, and edit access for the site's Google account), the save (saveBook), and Log it in
// January (logPaymentsByBook: each payment goes into the book for its New York year). Server-only, Founders only (the route).
// (2026-11-26 owner: "automatically switch accounting sheets", books2-1126) Next year's book registers itself (syncNextBook, below): the owner's Apps
// Script makes it from the folder's TEMPLATE from Nov 15 and leaves a pointer in the book in use; the site checks it with checkBook and saves it for
// its year, with one ClickUp note either way. To do's "Set the 2027 book" now waits until Dec 15 (or shows at once, with the reason, when the check failed).
import { sql } from "./db";
import { getSheetsClient } from "./sheets";
import { BOOKS_KEY, SHEET_ID_RE, loadBooks, setBooksCache, accountingSummary, clearAccountingCache, withBookYear, parseIncome, parseSummary, parseBalance, parseTax,
  sheetYearOf, isLayoutError, parseCoCut, readPointer, SITE_TAB, INCOME_TAB, INCOME_HEADER_ROW, SUMMARY_TAB, BALANCE_TAB, TAX_TAB, FEES_TAB } from "./accounting";
import { nyDay } from "./stripe";
import { logWritesOn, logPayments } from "./accounting-log";
import { forgetMoneyState, moneyState } from "./money";
import { parseInfoManagers } from "./info-managers";
import { postNote } from "./alerts";
import { PREVIEW, PREVIEW_OFF } from "./preview";

const INFO_TAB = "INFO";
const qt = (title) => title.replace(/'/g, "''");
const label = (v) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
export const bookUrl = (id) => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`;
const robot = () => String(process.env.GOOGLE_SHEETS_CLIENT_EMAIL || "").trim();
const shareText = (can) => {
  const who = robot();
  return `The site's Google account${who ? ` (${who})` : ""} ${can === "view" ? "can only view" : "can't open"} that book. Share it with ${who || "the site's Google account"} as Editor, then paste the link again.`;
};
const statusOf = (err) => Number(err?.response?.status ?? err?.status ?? err?.code) || 0;
const clock = (now) => { const d = nyDay(now); return { y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)), d: Number(d.slice(8, 10)) }; };

// --- what Money and To do show ----------------------------------------------------------------------
// need: the year a Founder should set now, or null: this year's when it has none (last year's is being shown) or its book can't be read, else
// next year's from Dec 15 until it's set (books2-1126: the Apps Script makes it from Nov 15 and the site registers it by itself, so a Founder is
// asked only if that hasn't happened by then), or at once when its automatic check failed (auto: app_state NEXT_KEY; why: the check's reason).
// open: when Money shows its Books button (December, January, or a year in need). books: the years worth showing, each with its link (null: not
// set) and whether it can be changed here (next year's, or the one in need; never the one in use).
export const NEED_DAY = 15; // December's day from which To do asks for next year's book
export function booksView({ map, acct, now = new Date(), linkId = "", auto = {} }) {
  const { y, m, d } = clock(now);
  const shown = acct?.connected && !acct.error && acct.year ? acct.year : null;
  // (a failed check's reason stays while it's checked again or Google was busy; it goes once the book is set, or a Founder's own book is)
  const failed = (yr) => (auto?.[yr]?.why && !["set", "other"].includes(auto[yr].state) ? String(auto[yr].why) : null);
  let need = null;
  if (!acct?.connected || acct.fallback) need = y;
  else if (acct.error && acct.sheetYear) need = y; // its rows are another year's (a moved layout or a Sheets outage isn't a missing book)
  else if (!map[y + 1] && ((m === 12 && d >= NEED_DAY) || ((m === 11 || m === 12) && failed(y + 1)))) need = y + 1;
  const why = need ? failed(need) : null;
  const years = new Set([shown, need, m === 12 || map[y + 1] ? y + 1 : null, m === 1 && map[y - 1] ? y - 1 : null].filter(Boolean));
  const idOf = (yr) => (yr === shown ? (linkId || acct.sheetId) : map[yr] || null);
  const books = [...years].sort((a, b) => a - b).map((yr) => {
    const id = idOf(yr);
    return { year: yr, url: id ? bookUrl(id) : null, ...(yr === need || (yr > (shown || 0) && yr !== shown) ? { change: true } : {}) };
  });
  return { year: y, need, ...(why ? { why } : {}), open: !!need || m === 12 || m === 1, books };
}
export async function booksState({ now = new Date() } = {}) {
  const [map, acct, auto] = await Promise.all([loadBooks(), accountingSummary({ now }), readNextState()]);
  return booksView({ map, acct, now, linkId: String(process.env.ACCOUNTING_SHEET_LINK_ID || "").trim(), auto });
}

// --- the check before a book is saved --------------------------------------------------------------
// the book's id from its link (docs.google.com/spreadsheets/d/<id>/edit…, with /u/1/ for a second Google account), or the id itself, or ""
export function bookIdOf(link) {
  const s = String(link ?? "").trim();
  const id = (s.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,})/) || [])[1] || s;
  return SHEET_ID_RE.test(id) ? id : "";
}
const headerRow = (values) => { const r = (values?.[0] || []).map(label); while (r.length && !r[r.length - 1]) r.pop(); return r; };
// { id } or { error, status }: the book pasted for `year`, against the book in use now (`acct`, its tabs and INFO's headers); `map` the setting.
// roster (books2-1126, the automatic check): INFO's roster must also have clients when the book in use has some (a book made from the template
// with an empty INFO would leave Log it and the managers with nobody on Jan 1).
export async function checkBook({ year, link, map, acct, sheets = getSheetsClient(), roster = false }) {
  const id = bookIdOf(link);
  if (!id) return { status: 400, error: "Paste the book's link from Google Sheets." };
  const taken = Object.entries(map).find(([yr, v]) => v === id && Number(yr) !== year);
  const inUse = acct?.sheetId === id && acct.year && acct.year !== year ? acct.year : null;
  if (taken || inUse) return { status: 400, error: `That's the ${taken ? taken[0] : inUse} book. Paste the ${year} book's link.` };
  let meta;
  try { meta = (await sheets.spreadsheets.get({ spreadsheetId: id, fields: "properties(title),sheets(properties(sheetId,title))" })).data; } catch (err) {
    if ([403, 404].includes(statusOf(err))) return { status: 400, error: shareText("open") };
    throw err;
  }
  const tabs = (meta.sheets || []).map((s) => s.properties?.title);
  // this year's tabs (the book in use), or at least the ones the site reads
  const cur = acct?.sheetId && acct.sheetId !== id ? acct.sheetId : null;
  let want = [INCOME_TAB, SUMMARY_TAB, BALANCE_TAB, TAX_TAB, INFO_TAB];
  let curInfo = null, curRoster = null;
  const infoRange = `'${INFO_TAB}'!A3:Z${roster ? 300 : 3}`;
  if (cur) {
    try {
      const [cm, ci] = await Promise.all([
        sheets.spreadsheets.get({ spreadsheetId: cur, fields: "sheets(properties(title))" }),
        sheets.spreadsheets.values.get({ spreadsheetId: cur, range: infoRange, valueRenderOption: "UNFORMATTED_VALUE" }),
      ]);
      // (books2-1126) not the '_site' tab: it holds the Apps Script's pointer to next year's book, in the book in use only
      want = [...new Set([...want, ...(cm.data.sheets || []).map((s) => s.properties?.title).filter((t) => t && t !== SITE_TAB)])];
      curInfo = headerRow(ci.data.values);
      if (roster) curRoster = parseInfoManagers(ci.data.values);
    } catch (err) { console.error("accounting books: this year's book couldn't be read to compare", String(err?.message || err).slice(0, 120)); }
  }
  const missing = want.filter((t) => !tabs.includes(t));
  if (missing.length) return { status: 400, error: `That book has no ${list(missing.map((t) => `"${t}"`))} ${missing.length === 1 ? "tab" : "tabs"}. Make it from this year's book, then paste its link.` };
  const got = await sheets.spreadsheets.values.batchGet({ spreadsheetId: id, valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "SERIAL_NUMBER",
    ranges: [`'${INCOME_TAB}'!A${INCOME_HEADER_ROW}:J`, `'${qt(SUMMARY_TAB)}'!A1:P80`, `'${qt(BALANCE_TAB)}'!A1:J40`, `'${qt(TAX_TAB)}'!A1:J40`, infoRange] });
  const [inc, sum, bal, tax, info] = (got.data.valueRanges || []).map((v) => v.values || []);
  let rows;
  try { rows = parseIncome(inc || []); parseSummary(sum || [], 1); parseBalance(bal || []); parseTax(tax || []); } catch (err) {
    if (isLayoutError(err)) return { status: 400, error: `That book isn't laid out like this year's: ${err.what}.` };
    throw err;
  }
  if (curInfo && curInfo.length && JSON.stringify(headerRow(info)) !== JSON.stringify(curInfo)) return { status: 400, error: "That book's INFO headers (row 3) aren't this year's." };
  if (roster && curRoster?.length && !parseInfoManagers(info || [])?.length) return { status: 400, error: "That book's INFO tab has no clients on its roster (Artists / Clients, from row 4). Copy them from this year's INFO." };
  const sheetYear = sheetYearOf(rows);
  if (sheetYear && sheetYear !== year) return { status: 400, error: `That book's rows are dated ${sheetYear}. Paste the ${year} book's link.` };
  // edit access (Log it writes rows there): a find-and-replace that matches nothing, on the Income tab. It changes nothing; a book shared as
  // Viewer refuses it. Only where the site writes to the accounting book at all (ACCOUNTING_SHEET_WRITES, never a preview)
  if (logWritesOn() && !PREVIEW) {
    const tab = (meta.sheets || []).find((s) => s.properties?.title === INCOME_TAB)?.properties?.sheetId;
    const find = "⁣defied-edit-check⁣";
    try { await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [{ findReplace: { find, replacement: find, sheetId: tab ?? 0, matchCase: true, matchEntireCell: true } }] } }); } catch (err) {
      if (statusOf(err) === 403) return { status: 400, error: shareText("view") };
      throw err;
    }
  }
  return { id, title: String(meta.properties?.title || "") };
}

// --- the save --------------------------------------------------------------------------------------
// Last year's, this year's or next year's book. The book in use now is written down under its own year at the same time (when the setting
// doesn't have it yet: ACCOUNTING_SHEET_ID's book), so January still knows last year's book once this year's takes over. Merged into the
// one app_state row, so two saves at once both stay.
export async function saveBook({ year, link, by = "a Founder", now = new Date(), sheets } = {}) {
  const { y } = clock(now);
  if (!Number.isInteger(year) || year < y - 1 || year > y + 1) return { status: 400, error: `Only the ${y - 1}, ${y} or ${y + 1} book can be set here.` };
  const [map, acct] = await Promise.all([loadBooks({ fresh: true }), accountingSummary({ now })]);
  const chk = await checkBook({ year, link, map, acct, sheets: sheets || getSheetsClient() });
  if (chk.error) return chk;
  if (PREVIEW) return { status: 503, error: `That book checks out. ${PREVIEW_OFF}` };
  const add = { [year]: chk.id };
  if (acct?.connected && !acct.error && acct.sheetId && acct.year && acct.year !== year && !map[acct.year]) add[acct.year] = acct.sheetId;
  await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${BOOKS_KEY}, ${JSON.stringify(add)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = app_state.value || EXCLUDED.value, updated_at = now()`;
  console.log(`accounting books: ${by} set the ${year} book${add[acct?.year] ? ` (and kept the ${acct.year} book under ${acct.year})` : ""}`);
  setBooksCache({ ...map, ...add });
  await loadBooks({ fresh: true });
  clearAccountingCache();
  forgetMoneyState();
  return booksState({ now });
}

// --- next year's book, by itself (2026-11-26 owner: "automatically switch accounting sheets", books2-1126) ---------------------------
// The site's Google account can't make files, so the owner's Apps Script (in Defied's Google account, daily) makes "Defied Accounting Master Sheet
// <next year>" from the Accounting folder's TEMPLATE from Nov 15, shares it with the site's account as Editor and leaves a pointer in the book in use
// (lib/accounting.js readPointer: a hidden '_site' tab). syncNextBook, from the daily job and when a Founder's dashboard or Money loads (nextBookSoon):
//   - only while the book after the one in use has no book in the setting: next year's from Nov 15 (New York), or this year's in January while
//     last year's book is still served as itself (the pointer was left in it in December but not registered yet);
//   - the pointer must name that year and a book that isn't one in use; then checkBook (the paste's own check, with INFO's roster too) on it;
//   - passes: saved for its year in the same merged upsert as a Founder's save, never over a book a Founder set meanwhile (that one wins), and ONE
//     ClickUp note (lib/alerts.js postNote): "Accounting: the 2027 book is ready and will be used from Jan 1 · <link>" (plus a line when its
//     Stripe Fees cut isn't the book in use's newest);
//   - fails (the layout differs, no access, no clients on INFO): ONE ClickUp note with the reason (again only if the reason changes), and To do's
//     "Set the 2027 book" shows for the Founders with it (booksView). The check runs again at most once an hour, so a fix is picked up by itself.
//   - a moment's trouble (Google busy, a network error): nothing said, tried again in 5 minutes.
// One check at a time across servers: each attempt is claimed in app_state NEXT_KEY in one statement. Nothing on a preview. Never throws.
export const NEXT_KEY = "accountingNextBook"; // { "<year>": { id, state: "checking" | "retry" | "failed" | "set" | "other", at, why?, noted?, warn? } }
const CHECKING_MS = 5 * 60 * 1000; // a claim that never finished (a function cut off) or a moment's trouble: free again after this
const FAILED_MS = 60 * 60 * 1000; // a failed check is run again after this
const SOON_MS = 10 * 60 * 1000; // a page's run: at most once every 10 minutes on a server
export async function readNextState() {
  try {
    const [r] = await sql`SELECT value FROM app_state WHERE key = ${NEXT_KEY}`;
    return r?.value && typeof r.value === "object" && !Array.isArray(r.value) ? r.value : {};
  } catch (err) {
    if (!/DATABASE_URL is not configured/.test(String(err?.message || ""))) console.error("accounting books: the next book's state couldn't be read", String(err?.message || err).slice(0, 120));
    return {};
  }
}
// The year whose book the pointer may give now, or null (pure). acct: the book in use (accountingSummary); map: the setting.
const inWindow = ({ m, d }) => m === 12 || (m === 11 && d >= 15); // when the Apps Script makes next year's book
export function nextTarget({ acct, map, now = new Date() }) {
  if (!acct?.connected || acct.error || !acct.sheetId || !acct.year) return null;
  const c = clock(now), t = acct.year + 1;
  if (map?.[t]) return null;
  if (t === c.y + 1 && inWindow(c)) return t;
  if (t === c.y && acct.fallback) return t;
  return null;
}
// nothing can be to do (the book in use needn't even be read): next year's is set, or outside Nov 15 – Dec 31 with this year's in the setting
const nothingToDo = (map, now) => { const c = clock(now); return !!map[c.y + 1] || (!inWindow(c) && !!map[c.y]); };
// checkBook's words are for a Founder pasting a link; the automatic check's note and To do row say the same without "paste" (pure)
export const autoWhy = (error, year) => String(error || "")
  .replace(/,? then paste (?:the|its) link(?: again)?\./i, ".")
  .replace(/\s*Make it from this year's book\.?/i, "")
  .replace(/\s*Paste the \d{4} book's link\./i, "")
  .replace(/^That book('s)?\b/, `The ${year} book$1`)
  .trim();
const pctText = (p) => `${Math.round(p * 10000) / 100}%`;
const centsText = (c) => `$${(c / 100).toFixed(2)}`;
// a line for the note when the new book's Stripe Fees cut isn't the book in use's newest (the month check of next year would expect the old one), or ""
export function cutWarning(newCuts, curCuts, curYear) {
  const a = curCuts?.length ? curCuts[curCuts.length - 1] : null;
  if (!a) return "";
  const b = newCuts?.length ? newCuts[newCuts.length - 1] : null;
  if (!b) return `Its Stripe Fees tab has no co-management cut the site can read; the ${curYear} book's newest is ${pctText(a.pct)} + ${centsText(a.flat)}. Copy those rows over before Jan 1.`;
  if (b.pct === a.pct && b.flat === a.flat) return "";
  return `Its Stripe Fees tab has the co-management cut at ${pctText(b.pct)} + ${centsText(b.flat)}; the ${curYear} book's newest is ${pctText(a.pct)} + ${centsText(a.flat)}. Copy those rows over before Jan 1.`;
}
export const readyText = (year, id, { thisYear = false, warn = "" } = {}) =>
  `Accounting: the ${year} book is ready and ${thisYear ? "is used from now on" : "will be used from Jan 1"} · ${bookUrl(id)}${warn ? `\n${warn}` : ""}`;
export const failText = (year, id, why) =>
  `Accounting: the ${year} book couldn't be set up by itself: ${why} · ${bookUrl(id)}\nFix it there and the site checks it again within the hour, or set the ${year} book on Money › Settings.`;

// this attempt's claim for (year, id), in one statement: taken when there's no record for that book yet, or its last attempt is old enough to run
// again (a failure an hour ago, a claim or a moment's trouble 5 minutes ago); a book already set is never checked again. -> the record (with what the
// last note said) or null
async function claimNext(year, id, now) {
  const yk = String(year), at = new Date(now).toISOString();
  const staleRun = new Date(+new Date(now) - CHECKING_MS).toISOString(), staleFail = new Date(+new Date(now) - FAILED_MS).toISOString();
  const rows = await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${NEXT_KEY}, jsonb_build_object(${yk}::text, jsonb_build_object('id', ${id}::text, 'state', 'checking', 'at', ${at}::text)), now())
    ON CONFLICT (key) DO UPDATE SET value = jsonb_set(app_state.value, ARRAY[${yk}::text], COALESCE(app_state.value -> ${yk}::text, '{}'::jsonb) || (EXCLUDED.value -> ${yk}::text)), updated_at = now()
    WHERE app_state.value -> ${yk}::text IS NULL
      OR app_state.value -> ${yk}::text ->> 'id' IS DISTINCT FROM ${id}::text
      OR (app_state.value -> ${yk}::text ->> 'state' IN ('checking', 'retry') AND COALESCE(app_state.value -> ${yk}::text ->> 'at', '') < ${staleRun}::text)
      OR (app_state.value -> ${yk}::text ->> 'state' = 'failed' AND COALESCE(app_state.value -> ${yk}::text ->> 'at', '') < ${staleFail}::text)
    RETURNING value -> ${yk}::text AS rec`;
  const rec = rows?.[0]?.rec;
  return rec && typeof rec === "object" ? rec : null;
}
const putNext = (year, rec) => sql`INSERT INTO app_state (key, value, updated_at) VALUES (${NEXT_KEY}, jsonb_build_object(${String(year)}::text, ${JSON.stringify(rec)}::jsonb), now())
  ON CONFLICT (key) DO UPDATE SET value = app_state.value || EXCLUDED.value, updated_at = now()`;
const noteWord = (n) => (n?.posted ? "posted" : n?.skipped ? `not sent (${n.skipped})` : "failed");

// -> { skipped, year? } | { set: year, id, note, warn? } | { failed: why, year, id, note? } | { error, year? }
export async function syncNextBook({ now = new Date(), sheets = null, fresh = false, post = null, preview = PREVIEW } = {}) {
  let year = null;
  try {
    if (preview) return { skipped: "preview" };
    const map = await loadBooks({ fresh });
    if (nothingToDo(map, now)) return { skipped: "nothing to do" };
    const acct = await accountingSummary({ now });
    year = nextTarget({ acct, map, now });
    if (!year) return { skipped: "nothing to do" };
    const client = sheets || getSheetsClient();
    const ptr = await readPointer(acct.sheetId, { sheets: client, fresh });
    if (!ptr) return { skipped: "no pointer", year };
    if (ptr.year !== year) return { skipped: `the pointer is for ${ptr.year}`, year };
    if (ptr.id === acct.sheetId || Object.values(map).includes(ptr.id)) return { skipped: "the pointer names a book in use", year };
    const rec = await claimNext(year, ptr.id, now);
    if (!rec) return { skipped: "checked recently", year };
    const at = new Date(now).toISOString();
    let chk;
    try { chk = await checkBook({ year, link: ptr.id, map, acct, sheets: client, roster: true }); } catch (err) {
      await putNext(year, { id: ptr.id, state: "retry", at, ...(rec.why && rec.id === ptr.id ? { why: rec.why } : {}), ...(rec.noted ? { noted: rec.noted } : {}) }).catch(() => {});
      return { error: `the ${year} book couldn't be checked just now (${String(err?.message || err).slice(0, 120)})`, year };
    }
    if (chk.error) {
      const why = autoWhy(chk.error, year), said = `${ptr.id} ${why}`;
      let noted = rec.noted || null, note = null;
      if (noted !== said) {
        note = await postNote(failText(year, ptr.id, why), { post });
        if (!note.failed) noted = said; // a post that didn't go through is tried again at the next check
      }
      await putNext(year, { id: ptr.id, state: "failed", at, why, ...(noted ? { noted } : {}) });
      console.log(`accounting books: the ${year} book from the template didn't pass the check: ${why}`);
      return { failed: why, year, id: ptr.id, ...(note ? { note: noteWord(note) } : {}) };
    }
    // the same merged upsert as a Founder's save (the book in use written down under its own year when the setting doesn't have it), except that
    // anything already in the setting stays as it is: a book a Founder set for that year meanwhile wins
    const add = { [year]: ptr.id };
    if (acct.year !== year && !map[acct.year]) add[acct.year] = acct.sheetId;
    const saved = await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${BOOKS_KEY}, ${JSON.stringify(add)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value || app_state.value, updated_at = now()
      WHERE app_state.value -> ${String(year)}::text IS NULL RETURNING key`;
    if (!saved?.length) {
      await putNext(year, { id: ptr.id, state: "other", at });
      return { skipped: "a Founder set that year's book meanwhile", year };
    }
    console.log(`accounting books: the ${year} book was set by itself from the Apps Script's pointer`);
    setBooksCache({ ...map, ...add });
    await loadBooks({ fresh: true });
    clearAccountingCache();
    forgetMoneyState();
    // the Stripe Fees cut: only a line in the note (the layout is right; the month check would just expect another cut)
    let warn = "";
    try {
      const fees = await client.spreadsheets.values.get({ spreadsheetId: ptr.id, range: `'${qt(FEES_TAB)}'!A1:C40`, valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "SERIAL_NUMBER" });
      warn = cutWarning(parseCoCut(fees.data?.values || []), acct.coCuts, acct.year);
    } catch (err) { console.error("accounting books: the new book's Stripe Fees couldn't be read", String(err?.message || err).slice(0, 120)); }
    const note = await postNote(readyText(year, ptr.id, { thisYear: year === clock(now).y, warn }), { post });
    await putNext(year, { id: ptr.id, state: "set", at, noted: `${ptr.id} ok`, ...(warn ? { warn } : {}) });
    return { set: year, id: ptr.id, note: noteWord(note), ...(warn ? { warn } : {}) };
  } catch (err) {
    console.error("accounting books: next year's book", String(err?.message || err).slice(0, 200));
    return { error: String(err?.message || err).slice(0, 200), ...(year ? { year } : {}) };
  }
}
// A page's run (a Founder's dashboard: GET /api/accounting-books; Money: GET /api/accounting): at most once every SOON_MS on a server, one at a time;
// waited for by the caller (work left after the answer may never run). Never throws.
let soonAt = 0, soonRun = null;
export function nextBookSoon(opts = {}) {
  if (soonRun) return soonRun;
  if (Date.now() - soonAt < SOON_MS) return Promise.resolve(null);
  soonAt = Date.now();
  soonRun = syncNextBook(opts).finally(() => { soonRun = null; });
  return soonRun;
}
export function resetNextBookSoon() { soonAt = 0; soonRun = null; }

// --- Log it in January ------------------------------------------------------------------------------
// Last year's unlogged payments sit in To log beside this year's in January (lib/money.js): each one goes into the book for its New York year.
// The payments of the year read beside this one (moneyState's pair) are logged inside withBookYear (every read and write of that run is that
// book's), the rest as before, last, so its count of what's left is the final one. Outside January, or with nothing of the other year
// picked, this is logPayments itself. The answer is logPayments' own, the two runs' put together (each row and logged row says its year).
const nyYear = (at) => Number(nyDay(at).slice(0, 4));
export async function logPaymentsByBook(args = {}) {
  const now = args.now || new Date();
  if (clock(now).m !== 1) return logPayments(args);
  const ids = [...new Set((Array.isArray(args.ids) ? args.ids : []).map(String))];
  const m = await moneyState().catch(() => null);
  if (!m?.pair || !m.pay?.list) return logPayments(args);
  const yearOf = new Map(m.pay.list.map((p) => [p.id, nyYear(p.at)]));
  const theirs = ids.filter((id) => yearOf.get(id) === m.pair), rest = ids.filter((id) => yearOf.get(id) !== m.pair);
  if (!theirs.length) return logPayments(args);
  const first = await withBookYear(m.pair, () => logPayments({ ...args, ids: theirs, now }));
  if (!rest.length) return tagYear(first, m.pair);
  let second;
  // (the dry run writes nothing: its error is the answer's)
  if (args.dryRun) second = await logPayments({ ...args, ids: rest, now });
  else {
    try { second = await logPayments({ ...args, ids: rest, now }); } catch (err) {
      // the first run's rows are in: they're said, with why the rest weren't logged
      second = { logged: [], skipped: [], error: err?.message || "Couldn't log the rest just now. Try again in a minute.", busy: true }; // refused before writing (review AL-3)
    }
  }
  return joinRuns(tagYear(first, m.pair), tagYear(second, second.year || m.acct?.year || null));
}
const tagYear = (r, year) => ({ ...r, ...(r.rows ? { rows: r.rows.map((x) => ({ ...x, year })) } : {}), ...(r.logged ? { logged: r.logged.map((x) => ({ ...x, year })) } : {}) });
export function joinRuns(a, b) {
  const both = (k) => [...(a[k] || []), ...(b[k] || [])];
  const text = (k) => [a[k], b[k]].filter(Boolean).join(" ") || null;
  if (a.rows && !a.logged) return { rows: both("rows"), skipped: both("skipped"), year: b.year ?? a.year, options: b.options || a.options || null }; // the dry run
  // (review AL-N1, AL-3) for Auto-log's switch (lib/auto-log.js offWhy), about the run(s) that failed: sent, one of them failed after its rows went to its sheet;
  // busy, every one was refused for a moment, before writing. (One book's rows going in fine says nothing about the other's error.)
  const { sent: _s, busy: _b, ...ab } = { ...a, ...b };
  const failed = [a, b].filter((r) => r.error);
  return { ...ab, logged: both("logged"), skipped: both("skipped"), error: text("error"), alarm: text("alarm"),
    ...(failed.some((r) => r.sent) ? { sent: true } : {}), ...(failed.length && failed.every((r) => r.busy) ? { busy: true } : {}),
    left: b.left ?? a.left, leftTotal: b.leftTotal ?? a.leftTotal, task: b.task ?? a.task ?? null };
}
