/**
 * Defied: next year's accounting book, made by itself (books2-1126, 2026-11-26).
 *
 * The owner: "can you just have it automatically switch accounting sheets, keep it organized in that folder like it should be, make sure
 * there are no glitches; there should already be a template."
 *
 * Runs in Defied's own Google account (defiedmgmt@gmail.com), once a day (installTrigger). The website's Google account
 * (sheet-sync@…) can't make files, so this script makes the book and the site does the rest:
 *
 *   From Nov 15 (New York), when the Accounting folder has no Google Sheet named "Defied Accounting Master Sheet <next year>":
 *     1. the folder's "Defied Accounting Master Sheet TEMPLATE.xlsx" is turned into a Google Sheet with that name, in the same folder;
 *     2. formulas that came back from the .xlsx as "__xludf.DUMMYFUNCTION" stand-ins are put back as the real formula (if there are any);
 *     3. a cell labelled exactly "Year" (column A) holding a typed year (not a formula) is set to the new year. Nothing else is renamed:
 *        the live book's year comes from a formula (Stripe Fees › Year), and "Tax Rates" says the year of the law its rates are from,
 *        which only a person should change (the log says so);
 *     4. INFO's rows from row 4 down (the roster, managers, splits and dropdown lists) are copied from this year's book, when both INFO
 *        tabs have the same headers on row 3. Until Dec 31 they're copied again each day so the new book keeps up with this year's INFO,
 *        unless someone has changed the new book's INFO by hand (then it's left alone and the log says so);
 *   Every day once the book exists (whoever made it):
 *     5. it's shared with the website's Google account as Editor, without an email;
 *     6. a pointer is written into this year's book: a hidden tab "_site" with A1 "next_year_book", B1 the new book's id, C1 its year,
 *        D1 when. Only those four cells are written, and only when they don't already say that.
 *   The website reads the pointer, checks the new book has this year's tabs and headers (and clients on INFO), and uses it from Jan 1.
 *   It posts one ClickUp note either way ("Accounting: the 2027 book is ready and will be used from Jan 1 · <link>", or why not).
 *
 * Running it again changes nothing that's already right. One run at a time (a script lock). No secrets, no web requests.
 *
 * Functions to run by hand: runNow() (the same as the daily run), installTrigger() (once: one daily trigger, duplicates removed).
 */

var FOLDER_ID = "1kvaLXCCKC2TfPiBxKBhlviw8-Bc3ujvD";                      // Drive › Accounting
var BOOK_PREFIX = "Defied Accounting Master Sheet";                         // "Defied Accounting Master Sheet 2027"
var TEMPLATE_NAME = "Defied Accounting Master Sheet TEMPLATE.xlsx";
var SITE_ACCOUNT = "sheet-sync@defied-site-sync.iam.gserviceaccount.com";   // the website's Google account
var TZ = "America/New_York";
var START_MONTH = 11, START_DAY = 15;                                       // from Nov 15
var SITE_TAB = "_site", POINTER_TAG = "next_year_book";
var INFO_TAB = "INFO", INFO_HEADER_ROW = 3;
var KEEP_INFO_IN_STEP = true;     // step 4 (false: the new book keeps the template's INFO)
var REPAIR_XLSX_FORMULAS = true;  // step 2
var SET_YEAR_CELLS = true;        // step 3

var SHEET_MIME = "application/vnd.google-apps.spreadsheet";

function runNow() {
  return ensureNextYearBook();
}

function ensureNextYearBook() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    log_("Another run is still going: nothing done this time.");
    return { skipped: "busy" };
  }
  try {
    return ensure_(new Date());
  } finally {
    lock.releaseLock();
  }
}

// One daily trigger for ensureNextYearBook (any others for it are removed first). Run once by hand.
function installTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "ensureNextYearBook") { ScriptApp.deleteTrigger(t); removed++; }
  });
  ScriptApp.newTrigger("ensureNextYearBook").timeBased().everyDays(1).atHour(6).create();
  log_("Daily trigger set for ensureNextYearBook (about 6-7 AM New York time)" + (removed ? "; " + removed + " old one(s) removed." : "."));
  return { removed: removed };
}

// ------------------------------------------------------------------------------------------------ the run
function ensure_(now) {
  var y = Number(Utilities.formatDate(now, TZ, "yyyy"));
  var md = Utilities.formatDate(now, TZ, "MM-dd");
  var next = y + 1;
  var out = { year: next };
  if (md < pad_(START_MONTH) + "-" + pad_(START_DAY)) {
    log_("It's " + md + " in New York: the " + next + " book is made from Nov 15. Nothing to do.");
    out.skipped = "before Nov 15";
    return out;
  }
  var folder = DriveApp.getFolderById(FOLDER_ID);
  var books = listBooks_(folder);
  var current = pickBook_(books, y);
  var nextBook = pickBook_(books, next);
  if (!current) log_("No Google Sheet named \"" + BOOK_PREFIX + " " + y + "…\" in the Accounting folder: the pointer can't be written (the site won't find the " + next + " book by itself; a Founder can set it on Money › Settings).");
  else log_("This year's book: \"" + current.name + "\" (" + current.id + ").");

  if (!nextBook) {
    nextBook = makeFromTemplate_(folder, next);
    out.made = true;
    setMade_(nextBook.id, { year: next, at: new Date().toISOString(), done: false }); // at once: a run cut short after this finishes the steps next time
  } else {
    log_("The " + next + " book is already there: \"" + nextBook.name + "\" (" + nextBook.id + ").");
  }
  var meta = madeMeta_(nextBook.id);
  if (meta && !meta.done) {
    // steps 2 and 3, once, on a book this script made (each is safe to run again: a second run finds nothing to change)
    var made = SpreadsheetApp.openById(nextBook.id);
    if (current) {
      try { made.setSpreadsheetTimeZone(SpreadsheetApp.openById(current.id).getSpreadsheetTimeZone()); } catch (e) { log_("Couldn't copy the time zone: " + e); }
    }
    if (REPAIR_XLSX_FORMULAS) out.repaired = repairXlsxFormulas_(made);
    if (SET_YEAR_CELLS) out.yearCells = setYearCells_(made, next);
    meta.done = true;
    setMade_(nextBook.id, meta);
  }
  out.id = nextBook.id;
  out.shared = shareWithSite_(nextBook.id);

  if (current) {
    var cur = SpreadsheetApp.openById(current.id);
    var nxt = SpreadsheetApp.openById(nextBook.id);
    if (KEEP_INFO_IN_STEP && madeHere_(nextBook.id)) out.info = carryInfo_(cur, nxt, nextBook.id, next);
    compareTabs_(cur, nxt, next);
    out.pointer = writePointer_(cur, nextBook.id, next);
  }
  log_("Done: " + JSON.stringify(out));
  return out;
}

// ------------------------------------------------------------------------------------------------ the folder
// Every Google Sheet in the folder named "Defied Accounting Master Sheet <year>…" ("… 2026 v2" counts as 2026), not in the trash
function listBooks_(folder) {
  var re = new RegExp("^" + escapeRe_(BOOK_PREFIX) + "\\s+(20\\d\\d)(?!\\d)", "i");
  var out = [];
  var it = folder.getFilesByType(SHEET_MIME);
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed()) continue;
    var m = re.exec(f.getName());
    if (m) out.push({ file: f, id: f.getId(), name: f.getName(), year: Number(m[1]) });
  }
  return out;
}

// The book for `year`: the only one, else the one shared with the website's account (the one the site uses), else the newest
function pickBook_(books, year) {
  var all = books.filter(function (b) { return b.year === year; });
  if (all.length < 2) return all[0] || null;
  var shared = all.filter(function (b) { return editorsOf_(b.file).indexOf(SITE_ACCOUNT) >= 0; });
  var pool = shared.length ? shared : all;
  pool.sort(function (a, b) { return b.file.getLastUpdated().getTime() - a.file.getLastUpdated().getTime(); });
  log_(all.length + " books for " + year + " (" + all.map(function (b) { return "\"" + b.name + "\""; }).join(", ") + "): using \"" + pool[0].name + "\"" + (shared.length ? " (shared with the website's account)." : " (the newest)."));
  return pool[0];
}

function editorsOf_(file) {
  try {
    return file.getEditors().map(function (u) { return String(u.getEmail() || "").toLowerCase(); });
  } catch (e) {
    return [];
  }
}

function findTemplate_(folder) {
  var it = folder.getFilesByName(TEMPLATE_NAME);
  while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) return f; }
  // the same file renamed a little ("…TEMPLATE", "… Template.xlsx"): a name that starts with the prefix and says TEMPLATE, never a BACKUP
  var all = folder.getFiles();
  while (all.hasNext()) {
    var g = all.next();
    var n = g.getName();
    if (!g.isTrashed() && n.toLowerCase().indexOf(BOOK_PREFIX.toLowerCase()) === 0 && /template/i.test(n) && !/backup/i.test(n)) return g;
  }
  return null;
}

// The template turned into a Google Sheet named for `year`, in the folder -> { id, name, file }
function makeFromTemplate_(folder, year) {
  var name = BOOK_PREFIX + " " + year;
  var tpl = findTemplate_(folder);
  if (!tpl) throw new Error("No \"" + TEMPLATE_NAME + "\" in the Accounting folder: the " + year + " book can't be made.");
  var id = null;
  if (tpl.getMimeType() === SHEET_MIME) {
    id = tpl.makeCopy(name, folder).getId();
  } else {
    try {
      id = Drive.Files.copy({ name: name, mimeType: SHEET_MIME, parents: [FOLDER_ID] }, tpl.getId(), { supportsAllDrives: true, fields: "id" }).id;
      if (DriveApp.getFileById(id).getMimeType() !== SHEET_MIME) {
        DriveApp.getFileById(id).setTrashed(true); // a plain .xlsx copy: not what's wanted, and it would clutter the folder
        log_("The copy came back as a plain file (not a Google Sheet): it was moved to the trash; uploading the template as a Google Sheet instead.");
        id = null;
      }
    } catch (e) {
      log_("Copying the template as a Google Sheet didn't work (" + e + "): uploading it as a Google Sheet instead.");
      id = null;
    }
    if (!id) id = Drive.Files.create({ name: name, mimeType: SHEET_MIME, parents: [FOLDER_ID] }, tpl.getBlob(), { supportsAllDrives: true, fields: "id" }).id;
  }
  var file = DriveApp.getFileById(id);
  if (file.getMimeType() !== SHEET_MIME) throw new Error("The " + year + " book (" + id + ") isn't a Google Sheet after converting the template.");
  log_("Made \"" + name + "\" (" + id + ") from \"" + tpl.getName() + "\".");
  return { id: id, name: name, file: file };
}

// what this script remembers of a book it made (Script Properties "made:<id>": { year, at, done }), or null: a book made by a person isn't touched
function madeMeta_(id) {
  var v = PropertiesService.getScriptProperties().getProperty("made:" + id);
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { return { done: true }; }
}
function setMade_(id, meta) {
  PropertiesService.getScriptProperties().setProperty("made:" + id, JSON.stringify(meta));
}
function madeHere_(id) {
  return !!madeMeta_(id);
}

// ------------------------------------------------------------------------------------------------ the new book's cells
// "=IFERROR(__xludf.DUMMYFUNCTION("FORMULA"),cached)" is how Google Sheets saves a formula Excel doesn't know into an .xlsx; put the formula back
var XLUDF_RE = /^=IFERROR\(__xludf\.DUMMYFUNCTION\("((?:[^"]|"")*)"\),/;
function unwrapXludf_(formula) {
  var m = XLUDF_RE.exec(String(formula || ""));
  return m ? "=" + m[1].replace(/""/g, "\"") : null;
}
function repairXlsxFormulas_(ss) {
  var n = 0;
  ss.getSheets().forEach(function (sh) {
    var lr = sh.getLastRow(), lc = sh.getLastColumn();
    if (!lr || !lc) return;
    var fs = sh.getRange(1, 1, lr, lc).getFormulas();
    for (var r = 0; r < fs.length; r++) {
      for (var c = 0; c < fs[r].length; c++) {
        var f = unwrapXludf_(fs[r][c]);
        if (f) { sh.getRange(r + 1, c + 1).setFormula(f); n++; }
      }
    }
  });
  log_(n ? "Put back " + n + " formula(s) the .xlsx had saved as stand-ins." : "No stand-in formulas from the .xlsx (nothing to put back).");
  return n;
}

// A row whose column A says exactly "Year" with a typed year (not a formula) beside it: set to the new year. "Tax Rates" is never changed.
function setYearCells_(ss, year) {
  var changed = [];
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    if (name === SITE_TAB) return;
    var rows = Math.min(sh.getLastRow(), 200);
    if (rows < 1) return;
    if (/tax\s*rates/i.test(name)) {
      var heads = sh.getRange(1, 1, Math.min(rows, 5), 1).getValues();
      for (var t = 0; t < heads.length; t++) {
        var m = /\b(20\d\d)\b/.exec(String(heads[t][0]));
        if (m && Number(m[1]) !== year) { log_("\"" + name + "\" says \"" + String(heads[t][0]) + "\": its rates are that year's law, so it's left as it is. Update them by hand when the " + year + " numbers are out."); break; }
      }
      return;
    }
    if (sh.getLastColumn() < 2) return;
    var rng = sh.getRange(1, 1, rows, 2);
    var vs = rng.getValues(), fs = rng.getFormulas();
    for (var r = 0; r < vs.length; r++) {
      if (String(vs[r][0]).trim().toLowerCase() !== "year" || fs[r][1]) continue;
      var v = String(vs[r][1]).trim();
      if (/^20\d\d$/.test(v) && Number(v) !== year) {
        sh.getRange(r + 1, 2).setValue(year);
        changed.push(name + "!B" + (r + 1) + ": " + v + " → " + year);
      }
    }
  });
  log_(changed.length ? "Year cells set: " + changed.join("; ") + "." : "No typed year cell to change (the year comes from formulas).");
  return changed;
}

// Step 4: INFO from row 4 down, as this year's book has it (formulas as formulas). -> what happened, in a word
function carryInfo_(cur, nxt, nextId, year) {
  var a = cur.getSheetByName(INFO_TAB), b = nxt.getSheetByName(INFO_TAB);
  if (!a || !b) { log_("INFO not copied: " + (!a ? "this year's" : "the " + year) + " book has no INFO tab."); return "no INFO"; }
  var width = Math.max(a.getLastColumn(), b.getLastColumn(), 1);
  var ha = JSON.stringify(trimRow_(a.getRange(INFO_HEADER_ROW, 1, 1, width).getValues()[0]));
  var hb = JSON.stringify(trimRow_(b.getRange(INFO_HEADER_ROW, 1, 1, width).getValues()[0]));
  if (ha !== hb) { log_("INFO not copied: its headers (row 3) differ between this year's book and the " + year + " book. The site's check will say so too."); return "headers differ"; }
  var first = INFO_HEADER_ROW + 1;
  var rows = Math.max(a.getLastRow(), b.getLastRow(), INFO_HEADER_ROW) - INFO_HEADER_ROW;
  if (rows <= 0) return "empty";
  var src = block_(a, first, rows, width);
  var arrays = src.some(function (r) { return r.some(function (x) { return typeof x === "string" && /^=.*\b(ARRAYFORMULA|FILTER|SORT|UNIQUE|QUERY|IMPORTRANGE)\s*\(/i.test(x); }); });
  if (arrays) { log_("INFO not copied: this year's INFO has formulas that fill other cells (ARRAYFORMULA, FILTER…); copy it by hand."); return "array formulas"; }
  var props = PropertiesService.getScriptProperties(), key = "info:" + nextId;
  var dstHash = hash_(block_(b, first, rows, width));
  if (hash_(src) === dstHash) { props.setProperty(key, dstHash); log_("INFO: the " + year + " book's already matches this year's."); return "same"; }
  var written = props.getProperty(key);
  if (written && written !== dstHash) { log_("INFO not copied: the " + year + " book's INFO was changed by hand since it was last copied, so it's left as it is."); return "changed by hand"; }
  b.getRange(first, 1, rows, width).setValues(src);
  SpreadsheetApp.flush();
  props.setProperty(key, hash_(block_(b, first, rows, width)));
  log_("INFO: rows " + first + "–" + (first + rows - 1) + " copied from this year's book into the " + year + " book.");
  return "copied";
}
function block_(sh, row, rows, width) {
  var rng = sh.getRange(row, 1, rows, width);
  var vs = rng.getValues(), fs = rng.getFormulas();
  return vs.map(function (r, i) { return r.map(function (v, j) { return fs[i][j] ? fs[i][j] : v; }); });
}
function trimRow_(r) {
  var out = r.map(function (v) { return String(v).trim(); });
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}
// the block without its empty edges (trailing blank cells and rows), so a longer or shorter read of the same INFO hashes the same
function canon_(block) {
  var rows = block.map(function (r) {
    var x = r.slice();
    while (x.length && (x[x.length - 1] === "" || x[x.length - 1] === null)) x.pop();
    return x;
  });
  while (rows.length && !rows[rows.length - 1].length) rows.pop();
  return rows;
}
function hash_(block) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(canon_(block)), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ("0" + ((b + 256) % 256).toString(16)).slice(-2); }).join("");
}

// The tabs this year's book has that the new one doesn't: the site's check will refuse the new book for them, so the log says so first
function compareTabs_(cur, nxt, year) {
  var have = nxt.getSheets().map(function (s) { return s.getName(); });
  var missing = cur.getSheets().map(function (s) { return s.getName(); }).filter(function (n) { return n !== SITE_TAB && have.indexOf(n) < 0; });
  if (missing.length) log_("The " + year + " book has no " + missing.map(function (n) { return "\"" + n + "\""; }).join(", ") + " tab(s), which this year's book has: the site won't use it until it does. Add them to the template too.");
}

// ------------------------------------------------------------------------------------------------ sharing and the pointer
// The website's account as Editor (no email): only when it isn't one already. -> "already" | "shared"
function shareWithSite_(fileId) {
  var perms = Drive.Permissions.list(fileId, { supportsAllDrives: true, fields: "permissions(emailAddress,role)" }).permissions || [];
  var has = perms.some(function (p) { return String(p.emailAddress || "").toLowerCase() === SITE_ACCOUNT && (p.role === "writer" || p.role === "owner" || p.role === "organizer" || p.role === "fileOrganizer"); });
  if (has) return "already";
  Drive.Permissions.create({ role: "writer", type: "user", emailAddress: SITE_ACCOUNT }, fileId, { sendNotificationEmail: false, supportsAllDrives: true });
  log_("Shared the book with " + SITE_ACCOUNT + " as Editor (no email).");
  return "shared";
}

// The hidden "_site" tab of this year's book: A1 "next_year_book", B1 the id, C1 the year, D1 when. Only those four cells; only when they differ.
function writePointer_(cur, nextId, year) {
  var sh = cur.getSheetByName(SITE_TAB);
  if (!sh) { sh = cur.insertSheet(SITE_TAB, cur.getSheets().length); log_("Made the hidden \"" + SITE_TAB + "\" tab in this year's book."); }
  var rng = sh.getRange(1, 1, 1, 4);
  var now = rng.getValues()[0];
  var same = String(now[0]).trim() === POINTER_TAG && String(now[1]).trim() === nextId && String(now[2]).trim() === String(year);
  if (!sh.isSheetHidden()) sh.hideSheet();
  if (same) { log_("The pointer to the " + year + " book is already in this year's book."); return "already"; }
  rng.setNumberFormat("@"); // plain text: the id, the year and the time stay exactly as written
  rng.setValues([[POINTER_TAG, nextId, String(year), new Date().toISOString()]]);
  log_("Wrote the pointer to the " + year + " book (" + nextId + ") into this year's book (" + SITE_TAB + "!A1:D1).");
  return "written";
}

// ------------------------------------------------------------------------------------------------ small helpers
function pad_(n) { return (n < 10 ? "0" : "") + n; }
function escapeRe_(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function log_(s) { console.log(s); }
