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

export const PORTFOLIO_CAP = 100;
const STREAM_TAB = "STREAM DATA";
const ATD = "activity to date";
const YTD = "year to date";
const THIS_PERIOD = "this period";
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
  const col = { type: h.indexOf("Entity Type"), id: h.indexOf("Entity ID"), name: h.indexOf("Entity Name"), period: h.indexOf("Period"), streams: h.indexOf("Streams (Current)") };
  if (col.id < 0 || col.period < 0 || col.streams < 0) {
    return { error: `"${fileName}" is missing Luminate's Entity ID / Period / Streams columns. Download it again from the portfolio page.` };
  }
  const byId = new Map();
  for (const r of rows.slice(1)) {
    const id = String(r[col.id] || "").trim();
    if (!id || r.length <= col.period) continue;
    const e = byId.get(id) || { id, name: col.name >= 0 ? r[col.name] || "" : "", type: col.type >= 0 ? r[col.type] || "" : "", atd: null, ytd: null, period: null };
    const period = String(r[col.period]).trim().toLowerCase();
    if (period === ATD) e.atd = count(r[col.streams]);
    else if (period === YTD) e.ytd = count(r[col.streams]);
    else if (period === THIS_PERIOD) e.period = count(r[col.streams]);
    byId.set(id, e);
  }
  const entities = [...byId.values()].filter((e) => e.atd !== null);
  if (!entities.length) return { error: `"${fileName}" has no "Activity to Date" rows. Check the export's settings and download it again.` };
  return { portfolioId, fileName, exportedAt: exportedAtOf(fileName), entities };
}

const isSong = (e) => !e.type || /^song$/i.test(e.type);
const songsIn = (entities) => entities.filter(isSong);
const sum = (list) => list.reduce((a, e) => a + (e.atd || 0), 0);

// An all-time count never goes down. If it did for many songs, the export
// was most likely made for one country instead of Worldwide: refuse it, so a
// wrong file can't overwrite everyone's numbers. (The period setting doesn't
// change "Activity to Date", so it only earns a note.)
export function checkExport(next, prev) {
  const notes = [];
  const songs = songsIn(next.entities);
  const offPeriod = songs.filter((e) => e.period !== null && e.period !== e.atd).length;
  if (songs.length && offPeriod / songs.length > 0.5) notes.push("The export's time period wasn't All time. That's fine, the all-time numbers were used.");
  if (!prev) return { block: null, notes };
  const before = new Map(prev.map((e) => [e.id, e.atd || 0]));
  const both = songs.filter((e) => before.has(e.id));
  const dropped = both.filter((e) => e.atd < before.get(e.id) * 0.98);
  const was = both.reduce((a, e) => a + before.get(e.id), 0), now = sum(both);
  if (both.length >= 5 && (dropped.length / both.length > 0.2 || now < was * 0.95)) {
    const pct = was ? Math.round((1 - now / was) * 100) : 0;
    return {
      block: `All-time streams went DOWN for ${dropped.length} of ${both.length} songs${pct > 0 ? ` (${pct}% lower in total)` : ""}. That usually means the export wasn't set to Worldwide. Check the settings and download it again.`,
      notes,
    };
  }
  const gone = prev.filter((e) => isSong(e) && !next.entities.some((x) => x.id === e.id)).length;
  if (gone) notes.push(`${gone} song${gone === 1 ? " that was" : "s that were"} in the last export ${gone === 1 ? "isn't" : "aren't"} in this one.`);
  return { block: null, notes };
}

async function latestExports() {
  return sql`
    SELECT DISTINCT ON (portfolio_id) id, portfolio_id, file_name, exported_at, uploaded_at, uploaded_by, song_count, total_streams, entities
    FROM luminate_exports ORDER BY portfolio_id, exported_at DESC NULLS LAST, uploaded_at DESC
  `;
}

// the portfolio record an export belongs to: by Luminate id, else the one portfolio staff added
// without an id yet (they pasted a link with no POR… in it), else a new one
async function portfolioFor(lumId) {
  const all = await sql`SELECT * FROM luminate_portfolios ORDER BY sort, created_at`;
  const hit = all.find((p) => p.luminate_id === lumId);
  if (hit) return hit;
  const unnamed = all.filter((p) => !p.luminate_id);
  if (unnamed.length === 1) {
    await sql`UPDATE luminate_portfolios SET luminate_id = ${lumId} WHERE id = ${unnamed[0].id}`;
    return { ...unnamed[0], luminate_id: lumId };
  }
  const p = { id: newId(), luminate_id: lumId, name: `Portfolio ${all.length + 1}`, sort: all.length };
  await sql`INSERT INTO luminate_portfolios (id, luminate_id, name, sort) VALUES (${p.id}, ${p.luminate_id}, ${p.name}, ${p.sort}) ON CONFLICT (luminate_id) DO NOTHING`;
  return (await sql`SELECT * FROM luminate_portfolios WHERE luminate_id = ${lumId}`)[0];
}

// Takes in parsed exports (oldest first, so the newest of each portfolio ends up last). Returns one
// result per file: { fileName, portfolioId, status: "taken"|"older"|"blocked", message, notes, songs }.
export async function takeExports(parsed, { by = "", force = false } = {}) {
  const results = [];
  const order = [...parsed].sort((a, b) => String(a.exportedAt || "").localeCompare(String(b.exportedAt || "")));
  for (const x of order) {
    const [prev] = await sql`
      SELECT exported_at, entities FROM luminate_exports WHERE portfolio_id = ${x.portfolioId}
      ORDER BY exported_at DESC NULLS LAST, uploaded_at DESC LIMIT 1
    `;
    const base = { fileName: x.fileName, portfolioId: x.portfolioId, songs: songsIn(x.entities).length };
    if (prev?.exported_at && x.exportedAt && new Date(prev.exported_at) >= new Date(x.exportedAt)) {
      results.push({ ...base, status: "older", message: "Already have this export or a newer one, so it was skipped." });
      continue;
    }
    const check = checkExport(x, prev?.entities);
    if (check.block && !force) { results.push({ ...base, status: "blocked", message: check.block, notes: check.notes }); continue; }
    const portfolio = await portfolioFor(x.portfolioId);
    const takenOn = (x.exportedAt || new Date().toISOString()).slice(0, 10);
    const songs = songsIn(x.entities);
    const queries = [sql`
      INSERT INTO luminate_exports (id, portfolio_id, file_name, exported_at, uploaded_by, song_count, total_streams, entities)
      VALUES (${newId()}, ${x.portfolioId}, ${x.fileName}, ${x.exportedAt}, ${by}, ${songs.length}, ${sum(songs)}, ${JSON.stringify(x.entities)})
    `];
    for (const e of x.entities) {
      queries.push(sql`
        INSERT INTO stream_snapshots (luminate_id, taken_on, streams, ytd) VALUES (${e.id}, ${takenOn}, ${e.atd}, ${e.ytd})
        ON CONFLICT (luminate_id, taken_on) DO UPDATE SET streams = EXCLUDED.streams, ytd = EXCLUDED.ytd
      `);
    }
    await sql.transaction(queries);
    results.push({ ...base, status: "taken", portfolioName: portfolio?.name || x.portfolioId, notes: check.notes, forced: !!(check.block && force) });
  }
  return results;
}

// STREAM DATA = the newest export of every portfolio, written the way the sheet's own script writes
// it: [Entity ID, Entity Name, Owners, all-time streams, "portfolio ATD"], biggest first. Rows already
// there from a portfolio the dashboard has no export of yet are kept, so taking in one portfolio
// never blanks out another's songs. Written over the old rows first and the leftover tail cleared
// after, so a failed write leaves the old numbers in place instead of an empty tab.
export async function rebuildStreamData() {
  const sheets = getSheetsClient(), spreadsheetId = getSheetId();
  const map = new Map();
  for (const x of await latestExports()) for (const e of x.entities) map.set(e.id, [e.id, e.name || "", "", e.atd || 0, "portfolio ATD"]);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${qt(STREAM_TAB)}'!A2:E`, valueRenderOption: "UNFORMATTED_VALUE" });
  const existing = (res.data.values || []).filter((r) => r[0]);
  const kept = existing.filter((r) => !map.has(String(r[0])));
  const out = [...map.values(), ...kept.map((r) => [r[0], r[1] ?? "", r[2] ?? "", Number(r[3]) || 0, r[4] ?? ""])];
  out.sort((a, b) => b[3] - a[3]);
  if (out.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: `'${qt(STREAM_TAB)}'!A2:E${out.length + 1}`, valueInputOption: "RAW", requestBody: { values: out },
    });
  }
  const oldLast = (res.data.values || []).length + 1;
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
export async function autoLink() {
  const [placements, tracking, ignored, latest] = await Promise.all([
    sql`SELECT id, song, artist, luminate_id FROM placements`,
    sql`SELECT * FROM song_tracking`,
    sql`SELECT luminate_id FROM luminate_ignored`,
    latestExports(),
  ]);
  const portfolios = await sql`SELECT id, luminate_id FROM luminate_portfolios`;
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
    const portfolio = portfolios.find((p) => p.luminate_id === x.portfolio_id);
    if (!portfolio) continue;
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
  if (links.length) {
    await sql.transaction(links.map((l) => sql`UPDATE placements SET luminate_id = ${l.luminateId} WHERE id = ${l.placementId} AND luminate_id = ''`));
  }
  return links;
}

// growth per Luminate id from the snapshots: the newest count, the gain since about a week before it
// (the closest snapshot 5-10 days earlier), this year's count, and up to a year of points to draw
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

// Everything the dashboard's Luminate page draws.
export async function lumState() {
  const [portfolios, tracking, ignored, latest, placements, lastUpload, missingTabs] = await Promise.all([
    sql`SELECT * FROM luminate_portfolios ORDER BY sort, created_at`,
    sql`SELECT * FROM song_tracking`,
    sql`SELECT luminate_id FROM luminate_ignored`,
    latestExports(),
    sql`SELECT id, song, artist, luminate_id FROM placements`,
    getState("lastUpload"),
    getState("missingTabs"),
  ]);
  const byPortfolio = Object.fromEntries(latest.map((x) => [x.portfolio_id, x]));
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
  return {
    cap: PORTFOLIO_CAP,
    portfolios: portfolios.map((p) => {
      const x = byPortfolio[p.luminate_id];
      const songs = songsIn(x?.entities || []);
      const inFile = new Set(songs.map((e) => e.id));
      // marked as added since that export, so not in it yet: still take up room
      const pending = new Set(tracking.filter((t) => t.portfolio_id === p.id && !t.skip
        && !inFile.has(placements.find((q) => q.id === t.placement_id)?.luminate_id)).map((t) => groupKey(placements.find((q) => q.id === t.placement_id) || {}, t)));
      return {
        id: p.id, luminateId: p.luminate_id, name: p.name, url: p.url, kind: p.kind, capacity: p.capacity, sort: p.sort,
        songCount: songs.length, pendingCount: pending.size, totalStreams: sum(songs),
        exportedAt: x?.exported_at || null, uploadedAt: x?.uploaded_at || null, fileName: x?.file_name || "",
      };
    }),
    tracking: Object.fromEntries(Object.entries(tBy).map(([id, t]) => [id, {
      isrc: t.isrc, isrcSource: t.isrc_source, isrcCheckedAt: t.isrc_checked_at, portfolioId: t.portfolio_id, addedAt: t.added_at, skip: t.skip,
    }])),
    inPortfolio: Object.fromEntries(inExport),
    unlinked,
    lastUpload,
    missingTabs: missingTabs || [],
  };
}
