// Luminate portfolio exports, taken in by the dashboard instead of a Drive
// folder: each export is checked, kept, written into the pub sheet's STREAM
// DATA tab (the same rows, columns and "newest file per portfolio wins" rule
// as the sheet's own Luminate Portfolio Sync script, so either one can run),
// and recorded as a dated snapshot for growth. Server-only, like lib/sheets.js.
import { sql } from "./db";
import {
  getSheetsClient, getSheetId, listTabs, findTab, loadClientTabNames, tabsOfOthers,
  findRowBySyncId, findUnclaimedRowByTitle, appendSongRow, normalizeTitle,
} from "./sheets";
import { ownerOf, findByName } from "./names";
import { alertsChannel } from "./clickup";

export const PORTFOLIO_CAP = 100;
// Where an export belongs, by its portfolio's POR id: "clients" (STREAM DATA and the clients'
// numbers) or "ar_artists" / "ar_songs" (prospects, kept apart for the A&R tab). The user's own
// portfolios are known up front, so their first drop asks nothing.
export const AREAS = ["clients", "ar_artists", "ar_songs"];
export const KNOWN_PORTFOLIOS = {
  POR069D735D69A24B35AEE8B7FF6D221BA4: { area: "ar_artists", name: "A&R Artists" },
  POR074E2117846F41B1A02150A26A5B0599: { area: "ar_songs", name: "A&R Songs" },
  PORD63A45A7E3214C9BA012EAE23C93E274: { area: "clients" },
  POR2D7C3C99583C47AB97903870A7BF68B9: { area: "clients" },
};
const AR_NAMES = { ar_artists: "A&R Artists", ar_songs: "A&R Songs" };
export const isAR = (area) => area === "ar_artists" || area === "ar_songs";
// an A&R portfolio met only through its export: named by what it holds and the end of its id
const arName = (area, por) => KNOWN_PORTFOLIOS[por]?.name || `${AR_NAMES[area]} …${String(por).slice(-4)}`;
// only the clients' portfolios feed STREAM DATA, linking and the to-add list (a batch-1 "watchlist"
// record never does)
export const isRoster = (p) => (p?.kind || "roster") === "roster";
export const AR_KEPT = "A&R export: saved for the A&R tab.";
const STREAM_TAB = "STREAM DATA";
const ATD = "activity to date";
const YTD = "year to date";
const THIS_PERIOD = "this period";
const LAST_PERIOD = "last period"; // only in exports made for a shorter period (the A&R ones are weekly)
const qt = (title) => title.replace(/'/g, "''");
const newId = () => Math.random().toString(36).slice(2, 10);

// RFC 4180, the rules Luminate writes its CSVs with (quoted fields may hold
// commas, newlines and doubled quotes)
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const s = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const count = (v) => { const n = parseInt(String(v ?? "").replace(/[^0-9.-]/g, ""), 10); return Number.isNaN(n) ? 0 : n; };

// "portfolio-export-PORD63A…E274-1790177303899 (1).csv": the portfolio's id,
// then the moment Luminate made the file (ms)
export const portfolioIdOf = (s) => String(s || "").match(/(POR[0-9A-Fa-f]{6,})/)?.[1].toUpperCase() || null;
function exportedAtOf(name) {
  const ms = Number(String(name || "").match(/POR[0-9A-Fa-f]+-(\d{12,14})/)?.[1]);
  return ms ? new Date(ms).toISOString() : null;
}

// One export file -> { portfolioId, exportedAt, entities: [{ id, name, type, atd, ytd, period }] },
// or { error } in words staff can act on.
export function parseExport(fileName, text) {
  const portfolioId = portfolioIdOf(fileName);
  if (!portfolioId) return { error: `"${fileName}" isn't a Luminate portfolio export (its name should start with portfolio-export-POR…).` };
  const rows = parseCsv(text);
  const h = (rows[0] || []).map((x) => x.trim());
  const col = {
    type: h.indexOf("Entity Type"), id: h.indexOf("Entity ID"), name: h.indexOf("Entity Name"), period: h.indexOf("Period"),
    streams: h.indexOf("Streams (Current)"), change: h.indexOf("Streams (% Change)"), owners: h.indexOf("Owners"),
  };
  if (col.id < 0 || col.period < 0 || col.streams < 0) {
    return { error: `"${fileName}" is missing Luminate's Entity ID / Period / Streams columns. Download it again from the portfolio page.` };
  }
  const byId = new Map();
  for (const r of rows.slice(1)) {
    const id = String(r[col.id] || "").trim();
    if (!id || r.length <= col.period) continue;
    const e = byId.get(id) || { id, name: col.name >= 0 ? r[col.name] || "" : "", type: col.type >= 0 ? r[col.type] || "" : "", atd: null, ytd: null, period: null, last: null, change: null, owners: "" };
    const period = String(r[col.period]).trim().toLowerCase();
    if (period === ATD) { e.atd = count(r[col.streams]); if (col.owners >= 0 && r[col.owners]) e.owners = r[col.owners]; }
    else if (period === YTD) e.ytd = count(r[col.streams]);
    else if (period === THIS_PERIOD) {
      e.period = count(r[col.streams]);
      // Luminate's own week-over-week change, as a percentage (blank when there was nothing before)
      const pct = col.change >= 0 ? parseFloat(String(r[col.change] ?? "").trim()) : NaN;
      if (Number.isFinite(pct)) e.change = pct;
    } else if (period === LAST_PERIOD) e.last = count(r[col.streams]);
    byId.set(id, e);
  }
  const entities = [...byId.values()].filter((e) => e.atd !== null);
  if (!entities.length) return { error: `"${fileName}" has no "Activity to Date" rows. Check the export's settings and download it again.` };
  // the date comes only from Luminate's own file name: without it the file can't be put in order
  // (an older file could replace newer numbers, and its history would be dated today)
  const exportedAt = exportedAtOf(fileName);
  if (!exportedAt) return { error: `"${fileName}": this file was renamed, so its date is unknown. Download it again from Luminate.` };
  return { portfolioId, fileName, exportedAt, entities };
}

// by the Entity Type column, never by the id's prefix (artists are AR…, songs SG…, releases MRELG…)
export const entityType = (e) => !e.type || /^song$/i.test(e.type) ? "song" : /^artist$/i.test(e.type) ? "artist" : /release/i.test(e.type) ? "release" : "other";
const isSong = (e) => entityType(e) === "song";
const NOUN = { song: "song", artist: "artist", release: "release", other: "other row" };
const noun = (type, n) => `${NOUN[type]}${n === 1 ? "" : "s"}`;
// a portfolio's 100 slots hold every type (the user's full one is 98 songs + 2 releases); "others"
// is everything that isn't a song, "otherTypes" the rows of a type we don't follow (counted, named)
const counts = (entities) => {
  const n = (t) => entities.filter((e) => entityType(e) === t).length;
  return {
    entities: entities.length, songs: n("song"), artists: n("artist"), releases: n("release"), others: entities.length - n("song"),
    otherTypes: n("other"), otherNames: [...new Set(entities.filter((e) => entityType(e) === "other").map((e) => e.type))],
  };
};
// "33 songs + 2 releases": what a file or portfolio holds, by type (ClickUp; the page has its own copy)
export const slotsText = (c) => [c.songs && `${c.songs} ${noun("song", c.songs)}`, c.artists && `${c.artists} ${noun("artist", c.artists)}`,
  c.releases && `${c.releases} ${noun("release", c.releases)}`, c.otherTypes && `${c.otherTypes} other`].filter(Boolean).join(" + ") || "nothing";
// what a new export changes against the last one of the same portfolio: the upload preview's lines
// (songs, or the type an A&R portfolio follows)
function diffExport(x, prev, pick = isSong) {
  const before = new Map((prev || []).map((e) => [e.id, e]));
  const songs = x.entities.filter(pick);
  const added = songs.filter((e) => !before.has(e.id));
  const kept = songs.filter((e) => before.has(e.id));
  const gone = (prev || []).filter((e) => pick(e) && !x.entities.some((n) => n.id === e.id));
  const gain = kept.reduce((a, e) => a + (e.atd - (before.get(e.id).atd || 0)), 0);
  return {
    first: !prev, totalStreams: songs.reduce((a, e) => a + (e.atd || 0), 0), gain: prev ? gain : null,
    newSongs: added.map((e) => e.name).slice(0, 20), newCount: added.length,
    goneSongs: gone.map((e) => e.name).slice(0, 20), goneCount: gone.length,
    down: kept.filter((e) => e.atd < (before.get(e.id).atd || 0)).length,
  };
}
const songsIn = (entities) => entities.filter(isSong);
const sum = (list) => list.reduce((a, e) => a + (e.atd || 0), 0);

// An all-time count never goes down. If it did for many songs, the export
// was most likely made for one country instead of Worldwide: refuse it, so a
// wrong file can't overwrite everyone's numbers. (The period setting doesn't
// change "Activity to Date", so it only earns a note.) The clients' files are
// checked on their songs; an A&R file on the type it follows, from 3 in common.
// The rule itself: of the rows both hold (before = id -> all-time streams), too many went down, or
// the total did. "DOWN for 30 of 33 songs (12% lower in total)", or null.
function wentDown(next, before, types, minOverlap) {
  for (const type of types) {
    const both = next.entities.filter((e) => entityType(e) === type && before.has(e.id));
    const dropped = both.filter((e) => e.atd < before.get(e.id) * 0.98);
    const was = both.reduce((a, e) => a + before.get(e.id), 0), now = sum(both);
    if (both.length >= minOverlap && (dropped.length / both.length > 0.2 || now < was * 0.95)) {
      const pct = was ? Math.round((1 - now / was) * 100) : 0;
      return `DOWN for ${dropped.length} of ${both.length} ${noun(type, both.length)}${pct > 0 ? ` (${pct}% lower in total)` : ""}`;
    }
  }
  return null;
}
export function checkExport(next, prev, { types = ["song"], minOverlap = 5 } = {}) {
  const notes = [];
  const of = (list, type) => list.filter((e) => entityType(e) === type);
  const listed = next.entities.filter((e) => types.includes(entityType(e)));
  const offPeriod = listed.filter((e) => e.period !== null && e.period !== e.atd).length;
  // a weekly export (it has a Last Period row, like the A&R ones) is weekly on purpose: no note
  const weekly = next.entities.some((e) => e.last !== null);
  if (!weekly && listed.length && offPeriod / listed.length > 0.5) notes.push("The export's time period wasn't All time. That's fine, the all-time numbers were used.");
  if (!prev) return { block: null, notes };
  const down = wentDown(next, new Map(prev.map((e) => [e.id, e.atd || 0])), types, minOverlap);
  if (down) return { block: `All-time streams went ${down}. That usually means the export wasn't set to Worldwide. Check the settings and download it again.`, notes };
  for (const type of types) {
    const gone = of(prev, type).filter((e) => !next.entities.some((x) => x.id === e.id)).length;
    if (gone) notes.push(`${gone} ${NOUN[type]}${gone === 1 ? " that was" : "s that were"} in the last export ${gone === 1 ? "isn't" : "aren't"} in this one.`);
  }
  return { block: null, notes };
}

// A clients' portfolio's FIRST export has nothing of its own to be checked against, but STREAM DATA
// already holds numbers for its songs (the sheet's own script, or another portfolio). An older file,
// or one made for one country, would roll those back for every client: the same rule, against the
// sheet. sheet = id -> all-time streams there now. Also counts the songs that would go down at all.
export function checkAgainstSheet(next, sheet, { minOverlap = 5 } = {}) {
  const down = wentDown(next, sheet, ["song"], minOverlap);
  const lower = songsIn(next.entities).filter((e) => sheet.has(e.id) && e.atd < sheet.get(e.id)).length;
  return {
    block: down && `All-time streams went ${down} compared with what the pub sheet has now. This file is probably older than the sheet's numbers, or wasn't set to Worldwide. Download this week's export (All time · Worldwide) and drop it again.`,
    lower,
  };
}

// STREAM DATA as it is now: [Entity ID, Entity Name, Owners, all-time streams, source] rows
async function readStreamData(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${qt(STREAM_TAB)}'!A2:E`, valueRenderOption: "UNFORMATTED_VALUE" });
  return res.data.values || [];
}

// the newest export of each clients' portfolio (a batch-1 "watchlist" record, or one of the user's
// A&R portfolios taken in by batch 1, never counts)
async function latestExports() {
  const [rows, other] = await Promise.all([
    sql`
      SELECT DISTINCT ON (portfolio_id) id, portfolio_id, file_name, exported_at, uploaded_at, uploaded_by, song_count, total_streams, entities
      FROM luminate_exports ORDER BY portfolio_id, exported_at DESC NULLS LAST, uploaded_at DESC
    `,
    sql`SELECT luminate_id FROM luminate_portfolios WHERE kind <> 'roster' AND luminate_id IS NOT NULL`,
  ]);
  const skip = new Set([...other.map((r) => r.luminate_id), ...Object.keys(KNOWN_PORTFOLIOS).filter((id) => isAR(KNOWN_PORTFOLIOS[id].area))]);
  return rows.filter((x) => !skip.has(x.portfolio_id));
}

// when the clients' numbers last came in (uploadedAt: the upload of the newest clients' export; older
// files dropped later only add history), and how old they are: numbersFrom is the day Luminate made
// the OLDEST of the portfolios' newest exports (portfolio names which one), so a drop of month-old
// files, or one portfolio forgotten while the other is dropped weekly, still reads as stale
export async function clientNumbers() {
  const [latest, names] = await Promise.all([latestExports(), sql`SELECT luminate_id, name FROM luminate_portfolios WHERE luminate_id IS NOT NULL`]);
  if (!latest.length) return { uploadedAt: null, numbersFrom: null, portfolio: null };
  const ms = (t) => new Date(t).getTime();
  const oldest = latest.filter((x) => x.exported_at).sort((a, b) => ms(a.exported_at) - ms(b.exported_at))[0];
  return {
    uploadedAt: new Date(Math.max(...latest.map((x) => ms(x.uploaded_at)))).toISOString(),
    numbersFrom: oldest ? new Date(oldest.exported_at).toISOString() : null,
    portfolio: oldest ? names.find((n) => n.luminate_id === oldest.portfolio_id)?.name || null : null,
  };
}

// the newest A&R file kept so far per POR id (what the next one is checked against)
async function latestHeld() {
  return sql`
    SELECT DISTINCT ON (portfolio_id) portfolio_id, holds, exported_at, entities FROM luminate_ar_held
    ORDER BY portfolio_id, exported_at DESC, uploaded_at DESC
  `;
}

// the A&R tab's lists: each A&R portfolio's newest kept file, with its name (lib/ar.js arListsOf)
export async function arHeldLatest() {
  return (await latestHeld()).map((r) => ({ portfolioId: r.portfolio_id, holds: r.holds, exportedAt: r.exported_at, entities: r.entities || [],
    name: arName(r.holds === "artists" ? "ar_artists" : "ar_songs", r.portfolio_id) }));
}

// Which area each POR id is already known to belong to: the user's own portfolios, A&R files kept
// before, then the clients' portfolios set up on the Luminate page. Missing = never seen.
export async function knownAreas() {
  const [held, roster] = await Promise.all([latestHeld(), sql`SELECT luminate_id, name, kind FROM luminate_portfolios WHERE luminate_id IS NOT NULL`]);
  const out = new Map();
  // from: "known" (the user's own), "held" (only its kept A&R files: an answer staff can take back),
  // "portfolio" (a record on the Luminate page)
  for (const [id, k] of Object.entries(KNOWN_PORTFOLIOS)) if (isAR(k.area)) out.set(id, { area: k.area, name: k.name, from: "known" });
  for (const h of held) {
    const area = h.holds === "artists" ? "ar_artists" : "ar_songs";
    if (!out.has(h.portfolio_id)) out.set(h.portfolio_id, { area, name: arName(area, h.portfolio_id), from: "held" });
  }
  // (a batch-1 "A&R watchlist" record held prospects' songs)
  for (const r of roster) if (!out.has(r.luminate_id)) out.set(r.luminate_id, { area: isRoster(r) ? "clients" : "ar_songs", name: r.name, from: "portfolio" });
  for (const [id, k] of Object.entries(KNOWN_PORTFOLIOS)) if (!out.has(id)) out.set(id, { area: k.area, from: "known" });
  return out;
}

// A portfolio this page has never seen: what it most likely holds, from its newest file. Only a
// guess: an A&R-looking one is never taken without staff answering "What's in it?".
export function guessArea(x) {
  const types = x.entities.map(entityType);
  if (types.length && types.every((t) => t === "artist")) return "ar_artists";
  // the clients' routine exports are All time; a weekly one (Last Period rows) is how A&R is exported
  if (x.entities.some((e) => e.last !== null)) return types.includes("song") ? "ar_songs" : "ar_artists";
  // anything else is taken as batch 1 did. (Once the A&R tab tracks prospects' songs, a file mostly
  // of those reads as A&R songs here.)
  return "clients";
}

// Per POR id in a drop: { area, unknown, guess, needsArea }. area is null while an A&R-looking new
// portfolio has no answer; answers are the drop's picker choices ({ [POR]: "clients"|"ar_artists"|"ar_songs" }).
export async function areasFor(parsed, answers = {}) {
  const known = await knownAreas();
  const newest = new Map();
  for (const p of parsed) if (!newest.has(p.portfolioId) || p.exportedAt > newest.get(p.portfolioId).exportedAt) newest.set(p.portfolioId, p);
  const out = new Map();
  for (const [id, x] of newest) {
    const k = known.get(id);
    if (k) { out.set(id, { area: k.area, name: k.name || null, unknown: false }); continue; }
    const guess = guessArea(x);
    const answer = AREAS.includes(answers?.[id]) ? answers[id] : null;
    // a clients'-looking file with no answer is taken as batch 1 did (a new clients' portfolio)
    const area = answer || (guess === "clients" ? "clients" : null);
    out.set(id, { area, name: isAR(area) ? arName(area, id) : null, unknown: true, guess, needsArea: guess !== "clients", answer });
  }
  return out;
}

// A portfolio answered "A&R" by mistake in "What's in it?": its kept files become that clients'
// portfolio's exports, as if they'd been taken in as clients' files (the same rows, dates and who
// dropped them), so its next drop goes to the clients' numbers. Only for one met through its kept
// files: the user's own A&R portfolios stay A&R. Returns how many files moved.
export async function moveHeldToClients(por) {
  if (isAR(KNOWN_PORTFOLIOS[por]?.area)) return 0;
  const held = await sql`SELECT * FROM luminate_ar_held WHERE portfolio_id = ${por} ORDER BY exported_at`;
  if (!held.length) return 0;
  await sql.transaction([
    ...held.map((h) => {
      const songs = songsIn(h.entities || []);
      return sql`
        INSERT INTO luminate_exports (id, portfolio_id, file_name, exported_at, uploaded_at, uploaded_by, song_count, total_streams, entities)
        VALUES (${newId()}, ${por}, ${h.file_name}, ${h.exported_at}, ${h.uploaded_at}, ${h.uploaded_by}, ${songs.length}, ${sum(songs)}, ${JSON.stringify(h.entities || [])})
      `;
    }),
    sql`DELETE FROM luminate_ar_held WHERE portfolio_id = ${por}`,
  ]);
  return held.length;
}

// the portfolio record an export belongs to: by Luminate id, else the one clients' portfolio staff
// added without an id yet (they pasted a link with no POR… in it), else a new clients' one
async function portfolioFor(lumId) {
  const all = await sql`SELECT * FROM luminate_portfolios ORDER BY sort, created_at`;
  const hit = all.find((p) => p.luminate_id === lumId);
  if (hit) return hit;
  const unnamed = all.filter((p) => !p.luminate_id && isRoster(p));
  if (unnamed.length === 1) {
    await sql`UPDATE luminate_portfolios SET luminate_id = ${lumId} WHERE id = ${unnamed[0].id}`;
    return { ...unnamed[0], luminate_id: lumId };
  }
  const p = { id: newId(), luminate_id: lumId, name: `Portfolio ${all.length + 1}`, sort: all.length };
  await sql`INSERT INTO luminate_portfolios (id, luminate_id, name, kind, sort) VALUES (${p.id}, ${p.luminate_id}, ${p.name}, 'roster', ${p.sort}) ON CONFLICT (luminate_id) DO NOTHING`;
  return (await sql`SELECT * FROM luminate_portfolios WHERE luminate_id = ${lumId}`)[0];
}

// Takes in parsed exports (oldest first, so the newest of each portfolio ends up last). Each file
// carries its area: a clients' file goes into luminate_exports (STREAM DATA, linking); an A&R one is
// only kept (luminate_ar_held) for the A&R tab. Both add growth history. Returns one result per
// file: { fileName, portfolioId, area, status: "ready"|"taken"|"older"|"blocked", message, notes, …counts }.
export async function takeExports(parsed, { by = "", force = false, dryRun = false } = {}) {
  const results = [];
  // several exports of one portfolio in one drop (old ones kept in Downloads): taken oldest first, so
  // each is checked against the one before it and they all become growth history; a dry run keeps
  // that chain in memory instead of the database
  const order = [...parsed].sort((a, b) => String(a.exportedAt || "").localeCompare(String(b.exportedAt || "")));
  const chain = new Map();
  const capacity = new Map((await sql`SELECT luminate_id, capacity FROM luminate_portfolios WHERE luminate_id IS NOT NULL`).map((r) => [r.luminate_id, r.capacity]));
  // A clients' portfolio coming in for the first time: its newest file in this drop (the one STREAM
  // DATA will go by) is checked against what the sheet holds now, read once. If that blocks, its
  // older files in the drop are held back too, or the newest of them would take its place.
  const fresh = new Map();
  const clientIds = [...new Set(order.filter((x) => !isAR(x.area || "clients")).map((x) => x.portfolioId))];
  const hasExports = new Set(clientIds.length ? (await sql`SELECT DISTINCT portfolio_id FROM luminate_exports WHERE portfolio_id = ANY(${clientIds})`).map((r) => r.portfolio_id) : []);
  for (const x of order) if (!isAR(x.area || "clients") && !hasExports.has(x.portfolioId)) fresh.set(x.portfolioId, x); // oldest first: the newest stays
  const vsSheet = new Map();
  if (fresh.size) {
    const now = await readStreamData(getSheetsClient(), getSheetId())
      .then((rows) => new Map(rows.filter((r) => r[0]).map((r) => [String(r[0]), Number(r[3]) || 0])), (err) => ({ error: err.message || "no answer" }));
    for (const [por, x] of fresh) vsSheet.set(por, now.error ? { error: now.error, newest: x } : { ...checkAgainstSheet(x, now), newest: x });
  }
  for (const x of order) {
    const area = x.area || "clients", ar = isAR(area);
    const follows = area === "ar_artists" ? "artist" : "song";
    const [stored] = chain.has(x.portfolioId) ? [] : ar
      ? await sql`SELECT exported_at, entities FROM luminate_ar_held WHERE portfolio_id = ${x.portfolioId} ORDER BY exported_at DESC, uploaded_at DESC LIMIT 1`
      : await sql`
          SELECT exported_at, entities FROM luminate_exports WHERE portfolio_id = ${x.portfolioId}
          ORDER BY exported_at DESC NULLS LAST, uploaded_at DESC LIMIT 1
        `;
    const prev = chain.get(x.portfolioId) || stored;
    const base = {
      fileName: x.fileName, portfolioId: x.portfolioId, exportedAt: x.exportedAt, area, capacity: capacity.get(x.portfolioId) || PORTFOLIO_CAP, ...counts(x.entities),
      ...(dryRun && { preview: diffExport(x, prev?.entities, (e) => entityType(e) === follows) }),
    };
    if (prev?.exported_at && x.exportedAt && new Date(prev.exported_at) >= new Date(x.exportedAt)) {
      results.push({ ...base, status: "older", message: "Already have this export or a newer one, so it was skipped." });
      continue;
    }
    const check = ar ? checkExport(x, prev?.entities, { types: [follows], minOverlap: 3 }) : checkExport(x, prev?.entities);
    const vs = !ar && vsSheet.get(x.portfolioId);
    if (vs) {
      check.block ||= vs.block || null;
      const newest = x.exportedAt === vs.newest.exportedAt; // (its notes go on that file, not the older ones)
      if (newest && vs.error) check.notes.push(`Couldn't compare this first export with the pub sheet's numbers (the sheet didn't answer: ${vs.error}).`);
      if (newest && !vs.block && vs.lower) check.notes.push(`${vs.lower} song${vs.lower === 1 ? "" : "s"} would go down compared with the pub sheet's numbers.`);
      if (dryRun && newest) base.preview.sheetLower = vs.lower || 0;
    }
    if (check.block && !force) { results.push({ ...base, status: "blocked", message: check.block, notes: check.notes }); continue; }
    const kept = ar && { message: AR_KEPT };
    if (dryRun) {
      const [known] = ar ? [] : await sql`SELECT name FROM luminate_portfolios WHERE luminate_id = ${x.portfolioId}`;
      results.push({ ...base, ...kept, status: "ready", portfolioName: ar ? x.portfolioName || null : known?.name || null, notes: check.notes, forced: !!(check.block && force) });
      chain.set(x.portfolioId, { exported_at: x.exportedAt, entities: x.entities });
      continue;
    }
    const takenOn = x.exportedAt.slice(0, 10);
    const c = counts(x.entities);
    const queries = [];
    let portfolio = null;
    if (ar) {
      queries.push(sql`
        INSERT INTO luminate_ar_held (id, portfolio_id, holds, file_name, exported_at, uploaded_by, entity_count, artist_count, song_count, weekly, entities)
        VALUES (${newId()}, ${x.portfolioId}, ${area === "ar_artists" ? "artists" : "songs"}, ${x.fileName}, ${x.exportedAt}, ${by},
          ${c.entities}, ${c.artists}, ${c.songs}, ${x.entities.some((e) => e.last !== null)}, ${JSON.stringify(x.entities)})
      `);
    } else {
      portfolio = await portfolioFor(x.portfolioId);
      const songs = songsIn(x.entities);
      queries.push(sql`
        INSERT INTO luminate_exports (id, portfolio_id, file_name, exported_at, uploaded_by, song_count, total_streams, entities)
        VALUES (${newId()}, ${x.portfolioId}, ${x.fileName}, ${x.exportedAt}, ${by}, ${songs.length}, ${sum(songs)}, ${JSON.stringify(x.entities)})
      `);
    }
    for (const e of x.entities) {
      queries.push(sql`
        INSERT INTO stream_snapshots (luminate_id, taken_on, streams, ytd) VALUES (${e.id}, ${takenOn}, ${e.atd}, ${e.ytd})
        ON CONFLICT (luminate_id, taken_on) DO UPDATE SET streams = EXCLUDED.streams, ytd = EXCLUDED.ytd
      `);
    }
    await sql.transaction(queries);
    results.push({ ...base, ...kept, status: "taken", portfolioName: ar ? x.portfolioName || x.portfolioId : portfolio?.name || x.portfolioId, notes: check.notes, forced: !!(check.block && force) });
    chain.set(x.portfolioId, { exported_at: x.exportedAt, entities: x.entities });
  }
  return results;
}

// STREAM DATA's rows from the newest export of each clients' portfolio, the way the sheet's own
// script writes them: [Entity ID, Entity Name, Owners, all-time streams, "portfolio ATD"]. An id in
// two portfolios takes the newer export's numbers. Pure: the parity test runs it on the real files.
export function streamDataRows(latest) {
  const map = new Map();
  const time = (x) => (x.exported_at ? new Date(x.exported_at).getTime() : 0);
  for (const x of [...latest].sort((a, b) => time(a) - time(b))) {
    for (const e of x.entities) map.set(e.id, [e.id, e.name || "", e.owners || "", e.atd || 0, "portfolio ATD"]);
  }
  return map;
}

// STREAM DATA = streamDataRows, biggest first. Rows already there for an id no export has ever held
// (a portfolio the dashboard hasn't seen, still updated by the sheet's script) are kept, so taking in
// one portfolio never blanks out another's songs; a song that has left our own portfolios goes, as
// it does when the script runs. Written over the old rows first and the leftover tail cleared after,
// so a failed write leaves the old numbers in place instead of an empty tab.
export async function rebuildStreamData() {
  const sheets = getSheetsClient(), spreadsheetId = getSheetId();
  const map = streamDataRows(await latestExports());
  const seen = new Set((await sql`SELECT DISTINCT e->>'id' AS id FROM luminate_exports, jsonb_array_elements(entities) e`).map((r) => r.id));
  const values = await readStreamData(sheets, spreadsheetId);
  const existing = values.filter((r) => r[0]);
  const kept = existing.filter((r) => !map.has(String(r[0])) && !seen.has(String(r[0])));
  const out = [...map.values(), ...kept.map((r) => [r[0], r[1] ?? "", r[2] ?? "", Number(r[3]) || 0, r[4] ?? ""])];
  out.sort((a, b) => b[3] - a[3]);
  if (out.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: `'${qt(STREAM_TAB)}'!A2:E${out.length + 1}`, valueInputOption: "RAW", requestBody: { values: out },
    });
  }
  const oldLast = values.length + 1;
  if (oldLast > out.length + 1) {
    await sheets.spreadsheets.values.batchClear({ spreadsheetId, requestBody: { ranges: [`'${qt(STREAM_TAB)}'!A${out.length + 2}:E${oldLast}`] } });
  }
  return { rows: out.length, kept: kept.length };
}

// Writes a song's Luminate ID into column M of its row on each tab it was pushed to (found the way
// a push finds it: Site Sync ID, then an unclaimed row with the same title). The sheet's stream
// formulas read that cell. A song with no row yet is left for its next save to push.
export async function writeLuminateIds(links) {
  if (!links.length) return { written: 0, missing: [] };
  const sheets = getSheetsClient(), spreadsheetId = getSheetId();
  const tabs = await listTabs(sheets, spreadsheetId);
  const known = await loadClientTabNames();
  const ids = links.map((l) => l.placementId);
  const rows = await sql`SELECT p.id, p.song, p.artist, p.splits, p.client_id, c.name, c.sheet_tab_name FROM placements p JOIN clients c ON c.id = p.client_id WHERE p.id = ANY(${ids})`;
  const liveIds = new Set((await sql`SELECT id FROM placements`).map((r) => r.id));
  let written = 0;
  const missing = [];
  for (const l of links) {
    const p = rows.find((r) => r.id === l.placementId);
    if (!p) continue;
    const name = (p.sheet_tab_name || p.name || "").trim();
    const me = ownerOf(known, name, p.client_id);
    const tab = findTab(tabs, name, tabsOfOthers(known, me));
    if (!tab) { missing.push({ song: p.song, client: p.name, why: "no sheet tab" }); continue; }
    const syncId = `${p.id}:${name.toLowerCase()}`;
    const row = (await findRowBySyncId(sheets, spreadsheetId, tab.title, syncId))
      ?? (await findUnclaimedRowByTitle(sheets, spreadsheetId, tab.title, p.song, liveIds));
    if (row) {
      await sheets.spreadsheets.values.update({
        spreadsheetId, range: `'${qt(tab.title)}'!M${row}`, valueInputOption: "RAW", requestBody: { values: [[l.luminateId]] },
      });
      written++;
      continue;
    }
    // never pushed to the sheet yet: add its row the way saving the song would (their own split only)
    if (!l.luminateId) continue; // unlinking a song that never had a row: nothing to clear
    const mine = findByName(p.splits || [], p.name);
    if (!(Number(mine?.percent) > 0)) { missing.push({ song: p.song, client: p.name, why: "no row on the sheet" }); continue; }
    await appendSongRow(sheets, spreadsheetId, tab.title, { song: p.song, artist: p.artist || "", percent: Number(mine.percent), luminateId: l.luminateId, syncId });
    written++;
  }
  return { written, missing };
}

const groupKey = (p, t) => (t?.isrc ? `isrc:${t.isrc}` : `t:${normalizeTitle(p.song)}|${normalizeTitle(p.artist)}`);

// A new song in a portfolio's export that staff marked as added to that same portfolio, with the
// same title and no other song competing for it, is linked without asking. Everything else that
// only matches by title waits for a click (see lumState's unlinked suggestions).
async function linkData() {
  const [placements, tracking, ignored, latest, portfolios] = await Promise.all([
    sql`SELECT id, song, artist, luminate_id FROM placements`,
    sql`SELECT * FROM song_tracking`,
    sql`SELECT luminate_id FROM luminate_ignored`,
    latestExports(),
    sql`SELECT id, luminate_id, kind FROM luminate_portfolios`,
  ]);
  return { placements, tracking, ignored, latest, portfolios };
}

// What autoLink would link, worked out without writing anything (the upload preview uses it too,
// with the not-yet-taken exports laid over the stored ones)
export function planLinks({ placements: rows, tracking, ignored, latest, portfolios }) {
  const placements = rows.map((p) => ({ ...p }));
  const tBy = Object.fromEntries(tracking.map((t) => [t.placement_id, t]));
  const linked = new Set(placements.map((p) => p.luminate_id).filter(Boolean));
  const skip = new Set(ignored.map((r) => r.luminate_id));
  const links = [];
  // the same song on another client's page (same title and artist) that's already linked: same id,
  // as long as there's only one to copy
  const byKey = new Map();
  for (const p of placements) {
    if (!p.luminate_id) continue;
    const k = `${normalizeTitle(p.song)}|${normalizeTitle(p.artist)}`;
    byKey.set(k, new Set([...(byKey.get(k) || []), p.luminate_id]));
  }
  for (const p of placements) {
    const ids = !p.luminate_id && byKey.get(`${normalizeTitle(p.song)}|${normalizeTitle(p.artist)}`);
    if (ids && ids.size === 1 && !tBy[p.id]?.skip) {
      const [lumId] = ids;
      links.push({ placementId: p.id, luminateId: lumId, song: p.song, copied: true });
      p.luminate_id = lumId;
    }
  }
  for (const x of latest) {
    // only a clients' portfolio's songs are ever linked onto client songs
    const portfolio = portfolios.find((p) => p.luminate_id === x.portfolio_id);
    if (!portfolio || !isRoster(portfolio)) continue;
    const fresh = x.entities.filter((e) => isSong(e) && !linked.has(e.id) && !skip.has(e.id));
    const waiting = placements.filter((p) => !p.luminate_id && tBy[p.id]?.portfolio_id === portfolio.id && !tBy[p.id]?.skip);
    for (const e of fresh) {
      const title = normalizeTitle(e.name);
      if (!title || fresh.filter((f) => normalizeTitle(f.name) === title).length > 1) continue;
      const matches = waiting.filter((p) => normalizeTitle(p.song) === title);
      // one song can sit on several clients' pages (co-writers): one group, all linked together
      const groups = new Set(matches.map((p) => groupKey(p, tBy[p.id])));
      if (!matches.length || groups.size !== 1) continue;
      for (const p of matches) links.push({ placementId: p.id, luminateId: e.id, song: p.song, entityName: e.name });
      linked.add(e.id);
    }
  }
  return links;
}

// the links an upload would make, before anything is written (its clients' files only)
export async function previewLinks(parsed) {
  const data = await linkData();
  const over = new Map(data.latest.map((x) => [x.portfolio_id, x]));
  for (const x of parsed) if (!isAR(x.area)) over.set(x.portfolioId, { portfolio_id: x.portfolioId, entities: x.entities });
  return planLinks({ ...data, latest: [...over.values()] });
}

export async function autoLink() {
  const links = planLinks(await linkData());
  if (links.length) {
    await sql.transaction(links.map((l) => sql`UPDATE placements SET luminate_id = ${l.luminateId} WHERE id = ${l.placementId} AND luminate_id = ''`));
  }
  return links;
}

// growth per Luminate id from the snapshots: the newest count, the gain since about a week before it
// (the closest snapshot 5-10 days earlier), this year's count, and up to a year of points to draw.
// gain/gainFrom is the real gain since the snapshot it's compared with: that week-old one, else the
// one just before the newest (a skipped week, or two exports in one week), never scaled to 7 days.
export async function growthFor(lumIds) {
  const ids = [...new Set(lumIds.filter(Boolean))];
  if (!ids.length) return {};
  const rows = await sql`
    SELECT luminate_id, taken_on::text AS d, streams, ytd FROM stream_snapshots
    WHERE luminate_id = ANY(${ids}) AND taken_on > now() - interval '400 days' ORDER BY luminate_id, taken_on
  `;
  const out = {};
  for (const r of rows) (out[r.luminate_id] ||= { series: [] }).series.push([r.d, Number(r.streams), r.ytd === null ? null : Number(r.ytd)]);
  const day = (d) => new Date(`${d}T00:00:00Z`).getTime() / 86400000;
  for (const g of Object.values(out)) {
    const last = g.series[g.series.length - 1];
    g.latest = last[1]; g.latestOn = last[0]; g.ytd = last[2];
    const prior = g.series.filter((s) => day(last[0]) - day(s[0]) >= 5 && day(last[0]) - day(s[0]) <= 10).pop();
    if (prior) { g.week = last[1] - prior[1]; g.weekPct = prior[1] ? g.week / prior[1] : null; g.weekFrom = prior[0]; }
    const from = prior || g.series[g.series.length - 2];
    if (from) { g.gain = last[1] - from[1]; g.gainPct = from[1] ? g.gain / from[1] : null; g.gainFrom = from[0]; }
    g.series = g.series.map(([d, s]) => [d, s]);
  }
  return out;
}

export async function getState(key) {
  return (await sql`SELECT value FROM app_state WHERE key = ${key}`)[0]?.value ?? null;
}
export async function setState(key, value) {
  await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${key}, ${JSON.stringify(value)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

// Everything the dashboard's Luminate page draws: the clients' portfolios only (A&R files are kept
// apart, so their songs never show up to link, to match or to add).
export async function lumState() {
  const [all, tracking, ignored, latest, placements, lastUpload, arLastUpload, missingTabs] = await Promise.all([
    sql`SELECT * FROM luminate_portfolios ORDER BY sort, created_at`,
    sql`SELECT * FROM song_tracking`,
    sql`SELECT luminate_id FROM luminate_ignored`,
    latestExports(),
    sql`SELECT id, song, artist, luminate_id FROM placements`,
    getState("lastUpload"),
    getState("arLastUpload"),
    getState("missingTabs"),
  ]);
  const portfolios = all.filter(isRoster);
  const byPortfolio = Object.fromEntries(latest.map((x) => [x.portfolio_id, x]));
  // every id the clients' latest exports hold: a song in one of them is tracked, whichever portfolio
  // it was marked as added to
  const inAny = new Set(portfolios.flatMap((p) => (byPortfolio[p.luminate_id]?.entities || []).map((e) => e.id)));
  const placementBy = Object.fromEntries(placements.map((p) => [p.id, p]));
  const inExport = new Map(); // Luminate song id -> our portfolio id
  for (const p of portfolios) for (const e of songsIn(byPortfolio[p.luminate_id]?.entities || [])) inExport.set(e.id, p.id);
  const linked = new Set(placements.map((p) => p.luminate_id).filter(Boolean));
  const skip = new Set(ignored.map((r) => r.luminate_id));
  // a song whose copy on another client's page is linked takes that id at the next update: not offered
  const copyIds = new Map();
  for (const p of placements) if (p.luminate_id) { const k = `${normalizeTitle(p.song)}|${normalizeTitle(p.artist)}`; copyIds.set(k, new Set([...(copyIds.get(k) || []), p.luminate_id])); }
  const waiting = placements.filter((p) => !p.luminate_id && copyIds.get(`${normalizeTitle(p.song)}|${normalizeTitle(p.artist)}`)?.size !== 1);
  const tBy = Object.fromEntries(tracking.map((t) => [t.placement_id, t]));
  const unlinked = [];
  for (const p of portfolios) {
    for (const e of songsIn(byPortfolio[p.luminate_id]?.entities || [])) {
      if (linked.has(e.id) || skip.has(e.id)) continue;
      const t = normalizeTitle(e.name);
      unlinked.push({ luminateId: e.id, name: e.name, portfolioId: p.id, streams: e.atd, suggestions: waiting.filter((x) => t && normalizeTitle(x.song) === t).map((x) => x.id) });
    }
  }
  // a song offered under "which song is this?" is in an export under its title (only not linked by
  // itself: two rows or two songs share the title), so it's never "missing", nor added again
  const offered = new Set(unlinked.flatMap((u) => u.suggestions));
  return {
    cap: PORTFOLIO_CAP,
    portfolios: portfolios.map((p) => {
      const x = byPortfolio[p.luminate_id];
      const ents = x?.entities || [];
      const c = counts(ents);
      const madeAt = x ? new Date(x.exported_at || x.uploaded_at).getTime() : null;
      // marked as added since that export, so not in it yet: still takes up room. Marked before it and
      // still not in any export: "missing" (add it again?), which takes none.
      const pending = new Set(), missing = new Set();
      for (const t of tracking) {
        const song = placementBy[t.placement_id];
        if (t.portfolio_id !== p.id || t.skip || !song || (song.luminate_id && inAny.has(song.luminate_id))) continue;
        const before = madeAt !== null && t.added_at && new Date(t.added_at).getTime() < madeAt;
        if (before && offered.has(song.id)) continue;
        (before ? missing : pending).add(groupKey(song, t));
      }
      return {
        id: p.id, luminateId: p.luminate_id, name: p.name, url: p.url, kind: p.kind, capacity: p.capacity, sort: p.sort,
        songCount: c.songs, artistCount: c.artists, releaseCount: c.releases, otherCount: c.others, otherTypes: c.otherTypes, usedCount: c.entities,
        pendingCount: pending.size, missingCount: missing.size, totalStreams: sum(songsIn(ents)),
        exportedAt: x?.exported_at || null, uploadedAt: x?.uploaded_at || null, fileName: x?.file_name || "",
      };
    }),
    tracking: Object.fromEntries(Object.entries(tBy).map(([id, t]) => [id, {
      isrc: t.isrc, isrcSource: t.isrc_source, isrcCheckedAt: t.isrc_checked_at, portfolioId: t.portfolio_id, addedAt: t.added_at, skip: t.skip,
    }])),
    inPortfolio: Object.fromEntries(inExport),
    unlinked,
    lastUpload,
    arLastUpload,
    missingTabs: missingTabs || [],
    alertsConnected: !!alertsChannel(),
  };
}
