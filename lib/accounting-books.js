// (2026-11-26, books-1126) Each year's accounting book, the Founders' setting (app_state "accountingBooks", {"2027": sheetId}; the lookup by
// year is lib/accounting.js). What GET /api/accounting-books shows (booksState), the check a pasted book must pass before it's saved (checkBook:
// this year's tabs and headers, rows of the right year, and edit access for the site's Google account), the save (saveBook), and Log it in
// January (logPaymentsByBook: each payment goes into the book for its New York year). Server-only, Founders only (the route).
import { sql } from "./db";
import { getSheetsClient } from "./sheets";
import { BOOKS_KEY, SHEET_ID_RE, loadBooks, setBooksCache, accountingSummary, clearAccountingCache, withBookYear, parseIncome, parseSummary, parseBalance, parseTax,
  sheetYearOf, isLayoutError, INCOME_TAB, INCOME_HEADER_ROW, SUMMARY_TAB, BALANCE_TAB, TAX_TAB } from "./accounting";
import { nyDay } from "./stripe";
import { logWritesOn, logPayments } from "./accounting-log";
import { forgetMoneyState, moneyState } from "./money";
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
const clock = (now) => { const d = nyDay(now); return { y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)) }; };

// --- what Money and To do show ----------------------------------------------------------------------
// need: the year a Founder should set now, or null: this year's when it has none (last year's is being shown) or its book can't be read, else
// next year's from Dec 1 until it's set. open: when Money shows its Books button (December, January, or a year in need). books: the years worth
// showing, each with its link (null: not set) and whether it can be changed here (next year's, or the one in need; never the one in use).
export function booksView({ map, acct, now = new Date(), linkId = "" }) {
  const { y, m } = clock(now);
  const shown = acct?.connected && !acct.error && acct.year ? acct.year : null;
  let need = null;
  if (!acct?.connected || acct.fallback) need = y;
  else if (acct.error && acct.sheetYear) need = y; // its rows are another year's (a moved layout or a Sheets outage isn't a missing book)
  else if (m === 12 && !map[y + 1]) need = y + 1;
  const years = new Set([shown, need, m === 12 ? y + 1 : null, m === 1 && map[y - 1] ? y - 1 : null].filter(Boolean));
  const idOf = (yr) => (yr === shown ? (linkId || acct.sheetId) : map[yr] || null);
  const books = [...years].sort((a, b) => a - b).map((yr) => {
    const id = idOf(yr);
    return { year: yr, url: id ? bookUrl(id) : null, ...(yr === need || (yr > (shown || 0) && yr !== shown) ? { change: true } : {}) };
  });
  return { year: y, need, open: !!need || m === 12 || m === 1, books };
}
export async function booksState({ now = new Date() } = {}) {
  const [map, acct] = await Promise.all([loadBooks(), accountingSummary({ now })]);
  return booksView({ map, acct, now, linkId: String(process.env.ACCOUNTING_SHEET_LINK_ID || "").trim() });
}

// --- the check before a book is saved --------------------------------------------------------------
// the book's id from its link (docs.google.com/spreadsheets/d/<id>/edit…, with /u/1/ for a second Google account), or the id itself, or ""
export function bookIdOf(link) {
  const s = String(link ?? "").trim();
  const id = (s.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,})/) || [])[1] || s;
  return SHEET_ID_RE.test(id) ? id : "";
}
const headerRow = (values) => { const r = (values?.[0] || []).map(label); while (r.length && !r[r.length - 1]) r.pop(); return r; };
// { id } or { error, status }: the book pasted for `year`, against the book in use now (`acct`, its tabs and INFO's headers); `map` the setting
export async function checkBook({ year, link, map, acct, sheets = getSheetsClient() }) {
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
  let curInfo = null;
  if (cur) {
    try {
      const [cm, ci] = await Promise.all([
        sheets.spreadsheets.get({ spreadsheetId: cur, fields: "sheets(properties(title))" }),
        sheets.spreadsheets.values.get({ spreadsheetId: cur, range: `'${INFO_TAB}'!A3:Z3`, valueRenderOption: "UNFORMATTED_VALUE" }),
      ]);
      want = [...new Set([...want, ...(cm.data.sheets || []).map((s) => s.properties?.title).filter(Boolean)])];
      curInfo = headerRow(ci.data.values);
    } catch (err) { console.error("accounting books: this year's book couldn't be read to compare", String(err?.message || err).slice(0, 120)); }
  }
  const missing = want.filter((t) => !tabs.includes(t));
  if (missing.length) return { status: 400, error: `That book has no ${list(missing.map((t) => `"${t}"`))} ${missing.length === 1 ? "tab" : "tabs"}. Make it from this year's book, then paste its link.` };
  const got = await sheets.spreadsheets.values.batchGet({ spreadsheetId: id, valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "SERIAL_NUMBER",
    ranges: [`'${INCOME_TAB}'!A${INCOME_HEADER_ROW}:J`, `'${qt(SUMMARY_TAB)}'!A1:P80`, `'${qt(BALANCE_TAB)}'!A1:J40`, `'${qt(TAX_TAB)}'!A1:J40`, `'${INFO_TAB}'!A3:Z3`] });
  const [inc, sum, bal, tax, info] = (got.data.valueRanges || []).map((v) => v.values || []);
  let rows;
  try { rows = parseIncome(inc || []); parseSummary(sum || [], 1); parseBalance(bal || []); parseTax(tax || []); } catch (err) {
    if (isLayoutError(err)) return { status: 400, error: `That book isn't laid out like this year's: ${err.what}.` };
    throw err;
  }
  if (curInfo && curInfo.length && JSON.stringify(headerRow(info)) !== JSON.stringify(curInfo)) return { status: 400, error: "That book's INFO headers (row 3) aren't this year's." };
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
