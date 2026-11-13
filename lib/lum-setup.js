// Setting up, on the pub sheet, the songs a monthly Luminate update found that the sheet can't show yet (the owner,
// 2026-11-12: "when its time to drag the luminate report its gonna tell me which ones need to be updated and update
// them across the pub sheet right ?"). A writer tab's streams are C = INDEX(STREAM DATA D, MATCH(M, STREAM DATA A)),
// so a song shows only when its row has its Luminate ID in M and STREAM DATA has a row with that ID. A song added on
// the site (Add song, a Spotify import) has neither, so an update's total for it never reached the sheet.
// For every song an update has a total for (trueup_points: its Luminate ID and its Spotify song):
//   M             each pub sheet row of the placements that link that Spotify song (found by the row's Site Sync ID)
//                 takes the Luminate ID when its M is blank. Left alone, and named: a placement or a row of it that
//                 holds another ID; a tab that would end up with two rows of the song (its streams would count
//                 twice); a Spotify song two Luminate IDs point at.
//   STREAM DATA   each ID those rows carry that's missing from column A gets a row after the last one: A ID · B Title ·
//                 C Artist · D the update's total · E "Luminate true-up". Rows are only ever added at the end, so
//                 every MATCH still lands on its row.
//   placements    luminate_id saved where it's blank, once every row of the placement carries the ID
//   siblings      (2026-11-13) a Spotify song no update has a total for yet, whose other cards already carry one
//                 Luminate ID (PG13k's Bod13s, Tears, Yoptunes, Fr, KIAB and Mariah Carey sat at 0 while the same
//                 tracks counted on Reallyindig0's, prodbyVK's and Jjxcksnn's pages): its blank cards and their rows
//                 take that ID, M and the placement as above, with every same rule. No STREAM DATA row is added for
//                 it (there's no total to put there); the next update that has one adds it
// Every M write goes through lib/sheet-guard.js (the tab read before and after; refused into a formula, the Total
// row or below, a row whose Site Sync ID moved); STREAM DATA's new rows are read back as well. Each write is logged
// on the newest update (trueup_runs.counts.setup), so its Undo clears them again (undoSetup). Behind
// STREAM_SHEET_WRITES (on or "monthly"), as the STREAM DATA writer is. Safe to run again: whatever is set already is
// skipped, so a run stopped by Google's per-minute read limit, or by its time, carries on where it stopped; To do
// shows what the last run left (app_state "lumSetup"). Server only.
import { sql, rowsOrNoneIfNoTable } from "./db";
import { getSheetsClient, getSheetId, listTabs } from "./sheets";
import { readFormulas, readBack, rowRefusal, cellAt } from "./sheet-guard";
import { getState, setState } from "./app-state";
import { STREAM_TAB, streamSheetMonthly } from "./stream-sheet";
import { spotifyId } from "./data/sources";

export const SOURCE_SET_UP = "Luminate true-up";
const MAX_ROWS = 2000; // what one read of a tab covers (lib/sheet-guard.js readFormulas, A1:N2000)
const qt = (title) => title.replace(/'/g, "''");
const str = (v) => String(v ?? "").trim();
const trackOf = (link) => { const id = spotifyId(link, "track"); return id ? `t:${id}` : null; };
const parse = (v) => (typeof v === "string" ? (() => { try { return JSON.parse(v) || {}; } catch { return {}; } })() : v || {});

// The Spotify songs each update total is for, once each: Map entity_id -> point. A Spotify song two Luminate IDs
// point at is left out (which ID its rows should carry isn't ours to guess).
function byEntity(points) {
  const ids = new Map();
  for (const p of points) if (p.entity_id && p.lum_id) (ids.get(p.entity_id) || ids.set(p.entity_id, []).get(p.entity_id)).push(p);
  const one = new Map(), two = [];
  for (const [e, ps] of ids) { const lums = [...new Set(ps.map((p) => str(p.lum_id)))]; if (lums.length === 1) one.set(e, ps[0]); else two.push({ entityId: e, lumIds: lums }); }
  return { one, two };
}

// Pure. points: [{ lum_id, entity_id, name, total }] (the newest per Luminate ID). placements: [{ id, song, artist,
// link, luminate_id }]. sheetRows: [{ tab, row, syncId, m }] (every writer tab's rows from 5 with a Site Sync ID or a
// Luminate ID). streamIds: Set of STREAM DATA's column A. A Spotify song no point is for, whose cards that carry a
// Luminate ID all carry the same one, while another card of it has none, is set up from them (a sibling: no total).
// { stamps: [{ tab, row, lumId, placementId, song, syncId }], others: [{ tab?, row?, placementId, song, has?, why }],
//   add: [{ lumId, title, artist, total }], db: [{ placementId, lumId }], two }
export function planSetup({ points = [], placements = [], sheetRows = [], streamIds = new Set() }) {
  const { one, two } = byEntity(points);
  const rowsOf = new Map(), withM = new Map();
  for (const r of sheetRows) {
    const pid = str(r.syncId).split(":")[0];
    if (pid) (rowsOf.get(pid) || rowsOf.set(pid, []).get(pid)).push(r);
    if (str(r.m)) (withM.get(str(r.m)) || withM.set(str(r.m), []).get(str(r.m))).push(r);
  }
  const stamps = [], others = [], db = [], need = new Map();
  // the siblings: Spotify songs no point is for, with one Luminate ID among their cards and a card without it (two IDs
  // on one song's cards: left out, as two points on one song are)
  const songs = new Map();
  for (const p of placements) { const t = trackOf(p.link); if (t && !one.has(t) && !two.some((x) => x.entityId === t)) (songs.get(t) || songs.set(t, []).get(t)).push(p); }
  const sibs = new Map();
  for (const [e, ps] of songs) {
    const lums = [...new Set(ps.map((p) => str(p.luminate_id)).filter(Boolean))];
    if (lums.length === 1 && ps.some((p) => !str(p.luminate_id))) sibs.set(e, { lum_id: lums[0], entity_id: e, sibling: true });
    else if (lums.length > 1) two.push({ entityId: e, lumIds: lums });
  }
  for (const [entityId, pt] of [...one, ...sibs]) {
    const lumId = str(pt.lum_id);
    const mine = [];
    for (const p of placements.filter((x) => trackOf(x.link) === entityId)) {
      const has = str(p.luminate_id);
      if (has && has !== lumId) { others.push({ placementId: p.id, song: p.song, has, why: "another" }); continue; }
      const rows = rowsOf.get(p.id) || [];
      // a row of it already carrying another ID: the whole song is left as it is (its rows never disagree)
      const clash = rows.find((r) => str(r.m) && str(r.m) !== lumId);
      if (clash) { others.push({ tab: clash.tab, row: clash.row, placementId: p.id, song: p.song, has: str(clash.m), why: "another" }); continue; }
      mine.push({ p, has, rows });
    }
    // a tab where two rows would carry this ID (two cards of the song, or a row typed in by hand): its streams would
    // count twice, so none of that tab's rows of it is written
    const onTab = new Map();
    for (const r of withM.get(lumId) || []) (onTab.get(r.tab) || onTab.set(r.tab, new Set()).get(r.tab)).add(`${r.row}`);
    for (const { rows } of mine) for (const r of rows) if (!str(r.m)) (onTab.get(r.tab) || onTab.set(r.tab, new Set()).get(r.tab)).add(`${r.row}`);
    const twice = new Set([...onTab].filter(([, rs]) => rs.size > 1).map(([t]) => t));
    for (const { p, has, rows } of mine) {
      const dup = rows.find((r) => twice.has(r.tab));
      if (dup) { others.push({ tab: dup.tab, row: dup.row, placementId: p.id, song: p.song, why: "twice" }); continue; }
      if (!rows.length) continue; // not on the sheet: nothing to show there yet (the next update sets it up once it is)
      for (const r of rows) {
        if (!str(r.m)) stamps.push({ tab: r.tab, row: r.row, lumId, placementId: p.id, song: p.song, syncId: str(r.syncId) });
        if (!pt.sibling && !need.has(lumId)) need.set(lumId, { lumId, title: pt.name || p.song || "", artist: p.artist || "", total: Math.round(Number(pt.total) || 0) });
      }
      if (!has) db.push({ placementId: p.id, lumId });
    }
  }
  const add = [...need.values()].filter((x) => !streamIds.has(x.lumId));
  return { stamps, others, add, db, two };
}

// the newest update point per Luminate ID that has a Spotify song, and the placements
async function setupInputs() {
  const [points, placements] = await Promise.all([
    rowsOrNoneIfNoTable(sql`SELECT DISTINCT ON (lum_id) lum_id, entity_id, name, total FROM trueup_points WHERE entity_id IS NOT NULL ORDER BY lum_id, total_on DESC, created_at DESC`),
    sql`SELECT id, client_id, song, artist, link, luminate_id FROM placements`,
  ]);
  return { points, placements };
}
const newestRun = async () => (await rowsOrNoneIfNoTable(sql`SELECT id, counts FROM trueup_runs ORDER BY applied_at DESC, id DESC LIMIT 1`))[0] || null;
// To do: what the last run left to set up, while its update is still the newest (null when off or nothing's left)
export async function setupPending() {
  if (!streamSheetMonthly()) return null;
  const [st, top] = await Promise.all([getState("lumSetup").catch(() => null), newestRun()]);
  return st && top && st.runId === top.id && st.left > 0 ? { n: st.left, names: st.names || [], at: st.at } : null;
}

const quotaHit = (err) => err?.code === 429 || err?.response?.status === 429 || /quota|rate limit/i.test(String(err?.message || ""));
// the run's log of what the setup wrote (Undo clears it): { m: [[tab, row, syncId, lumId]], sd: [[row, lumId]], db: [[placementId, lumId]] }
async function logWrites(runId, add) {
  const [r] = await sql`SELECT counts FROM trueup_runs WHERE id = ${runId}`;
  if (!r) return;
  const counts = parse(r.counts), log = counts.setup || { m: [], sd: [], db: [] };
  for (const k of ["m", "sd", "db"]) log[k] = [...(log[k] || []), ...(add[k] || [])];
  await sql`UPDATE trueup_runs SET counts = ${JSON.stringify({ ...counts, setup: log })} WHERE id = ${runId}`;
}

// Runs the setup for the newest update (runId: refused if that isn't the newest any more, e.g. it was undone).
// deadline (ms since 1970): stops before it, between tabs ({ more: true }). Returns { songs, names, stamped, added,
// saved, others, refused, alarms, left, quota?, more?, skipped? }
export async function setupNewSongs({ deadline = Date.now() + 40000, runId = null } = {}) {
  if (!streamSheetMonthly()) return { skipped: "STREAM_SHEET_WRITES is off" };
  const top = await newestRun();
  if (!top) return { skipped: "No update yet" };
  if (runId && runId !== top.id) return { error: "That update was undone, so nothing more is set up for it." };
  const sheets = getSheetsClient(), spreadsheetId = getSheetId();
  const out = { songs: 0, names: [], stamped: 0, added: 0, saved: 0, others: [], refused: [], alarms: [], left: 0 };
  const done = async (res) => { await setState("lumSetup", { runId: top.id, left: res.left || 0, names: res.leftNames || [], at: new Date().toISOString() }).catch(() => {}); delete res.leftNames; return res; };
  const { points, placements } = await setupInputs();
  if (!points.length) return done(out);
  let plan;
  try {
    const tabs = (await listTabs(sheets, spreadsheetId)).filter((t) => t.title !== STREAM_TAB);
    const read = await sheets.spreadsheets.values.batchGet({ spreadsheetId, valueRenderOption: "UNFORMATTED_VALUE",
      ranges: [`'${qt(STREAM_TAB)}'!A2:A`, ...tabs.map((t) => `'${qt(t.title)}'!M5:N400`)] });
    const [streamCol, ...vals] = read.data.valueRanges || [];
    const streamIds = new Set((streamCol?.values || []).map((r) => str(r?.[0])).filter(Boolean));
    const sheetRows = [];
    vals.forEach((v, i) => (v?.values || []).forEach((r, j) => { if (str(r?.[1]) || str(r?.[0])) sheetRows.push({ tab: tabs[i].title, row: 5 + j, m: r?.[0], syncId: r?.[1] }); }));
    plan = planSetup({ points, placements, sheetRows, streamIds });
  } catch (err) {
    if (quotaHit(err)) return done({ ...out, quota: true, left: 1 });
    throw err;
  }
  const songsOf = (xs) => [...new Map(xs.map((x) => [x.lumId, x.song || x.title])).values()];
  out.songs = new Set([...plan.stamps.map((s) => s.lumId), ...plan.add.map((a) => a.lumId)]).size;
  out.names = songsOf([...plan.stamps, ...plan.add]).slice(0, 8);
  out.others = plan.others.slice(0, 50);
  const wrote = new Set(), refusedRows = new Set();
  const leftNow = () => { const xs = plan.stamps.filter((s) => !wrote.has(`${s.tab}:${s.row}`) && !refusedRows.has(`${s.tab}:${s.row}`)); return { left: new Set(xs.map((s) => s.lumId)).size + (out.added < plan.add.length ? plan.add.length - out.added : 0), leftNames: songsOf(xs).slice(0, 5) }; };
  try {
    // STREAM DATA first, so a row's M finds its number the moment it's set
    if (plan.add.length) {
      const before = await readFormulas(sheets, spreadsheetId, STREAM_TAB);
      if (before.length >= MAX_ROWS) { out.alarms.push(`STREAM DATA has ${MAX_ROWS.toLocaleString()} rows or more, so no rows were added to it. Ask for the setup to read further.`); return done({ ...out, ...leftNow() }); }
      const inA = new Set(before.slice(1).map((r) => str(r?.[0])).filter(Boolean));
      const add = plan.add.filter((a) => !inA.has(a.lumId));
      let last = 1;
      before.forEach((r, i) => { if ((r || []).slice(0, 5).some((v) => str(v) !== "")) last = i + 1; });
      if (add.length) {
        const from = last + 1, to = last + add.length;
        await sheets.spreadsheets.values.update({ spreadsheetId, range: `'${qt(STREAM_TAB)}'!A${from}:E${to}`, valueInputOption: "RAW",
          requestBody: { values: add.map((a) => [a.lumId, a.title, a.artist, a.total, SOURCE_SET_UP]) } });
        await logWrites(top.id, { sd: add.map((a, i) => [from + i, a.lumId]) });
        const back = await readBack(sheets, spreadsheetId, STREAM_TAB, before, add.flatMap((a, i) => [{ cell: `A${from + i}`, text: a.lumId }, { cell: `D${from + i}`, value: a.total }]), { throwQuota: true });
        if (!back.ok) { out.alarms.push(back.alarm); return done({ ...out, ...leftNow() }); }
      }
      out.added = plan.add.length;
    }
    // M, one tab at a time, each through the guard
    for (const tab of [...new Set(plan.stamps.map((s) => s.tab))]) {
      if (Date.now() > deadline) return done({ ...out, more: true, ...leftNow() });
      const mine = plan.stamps.filter((s) => s.tab === tab);
      const before = await readFormulas(sheets, spreadsheetId, tab);
      const go = [];
      for (const s of mine) {
        const m = str(cellAt(before, s.row, "M"));
        const reason = str(cellAt(before, s.row, "N")) !== s.syncId ? `Row ${s.row} of the ${tab} tab isn't ${s.song}'s any more, so its Luminate ID wasn't written.`
          : m && m !== s.lumId ? `M${s.row} on the ${tab} tab holds another Luminate ID now, so it was left as it is.`
          : rowRefusal(before, tab, s.row, ["M"], { M: s.lumId });
        if (reason) { out.refused.push({ tab, row: s.row, song: s.song, reason }); refusedRows.add(`${tab}:${s.row}`); }
        else if (m === s.lumId) wrote.add(`${tab}:${s.row}`);
        else go.push(s);
      }
      if (!go.length) continue;
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: go.map((s) => ({ range: `'${qt(tab)}'!M${s.row}`, values: [[s.lumId]] })) } });
      for (const s of go) wrote.add(`${tab}:${s.row}`);
      out.stamped += go.length;
      await logWrites(top.id, { m: go.map((s) => [tab, s.row, s.syncId, s.lumId]) });
      const back = await readBack(sheets, spreadsheetId, tab, before, go.map((s) => ({ cell: `M${s.row}`, text: s.lumId })), { throwQuota: true });
      if (!back.ok) { out.alarms.push(back.alarm); return done({ ...out, ...leftNow() }); }
    }
  } catch (err) {
    if (quotaHit(err)) { const l = leftNow(); return done({ ...out, quota: true, ...l, left: Math.max(1, l.left) }); }
    throw err;
  }
  // last: the placements' own Luminate ID (blank ones only, every row of theirs set), so the next update finds them by it
  const bad = new Set(plan.stamps.filter((s) => refusedRows.has(`${s.tab}:${s.row}`)).map((s) => s.placementId));
  const db = plan.db.filter((d) => !bad.has(d.placementId));
  if (db.length) {
    await sql.transaction(db.map((d) => sql`UPDATE placements SET luminate_id = ${d.lumId} WHERE id = ${d.placementId} AND coalesce(luminate_id, '') = ''`));
    await logWrites(top.id, { db: db.map((d) => [d.placementId, d.lumId]) });
    out.saved = db.length;
  }
  return done({ ...out, left: 0 });
}

// Undo of an update: what its setup wrote, cleared again where it still reads what was written (an M someone changed
// since, or a row that moved, is left as it is). Called before the run is deleted; a stop on Google's read limit
// returns { quota } with nothing deleted, so Undo can be pressed again. { cleared, rows, ids, kept, quota? }
export async function undoSetup(run) {
  const raw = parse(run?.counts).setup;
  const out = { cleared: 0, rows: 0, ids: 0, kept: 0 };
  if (!raw || !(raw.m?.length || raw.sd?.length || raw.db?.length)) return out;
  // once each (a run carried on after a stop can have logged a cell twice)
  const uniq = (xs, key) => [...new Map((xs || []).map((x) => [key(x), x])).values()];
  const log = { m: uniq(raw.m, (x) => `${x[0]}|${x[1]}`), sd: uniq(raw.sd, (x) => `${x[0]}`), db: uniq(raw.db, (x) => `${x[0]}`) };
  const sheets = getSheetsClient(), spreadsheetId = getSheetId();
  try {
    for (const tab of [...new Set((log.m || []).map((x) => x[0]))]) {
      const mine = log.m.filter((x) => x[0] === tab);
      const before = await readFormulas(sheets, spreadsheetId, tab);
      const go = mine.filter(([, row, syncId, lumId]) => str(cellAt(before, row, "M")) === lumId && str(cellAt(before, row, "N")) === syncId && !rowRefusal(before, tab, row, ["M"], {}, "cleared"));
      out.kept += mine.length - go.length;
      if (!go.length) continue;
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: go.map(([, row]) => ({ range: `'${qt(tab)}'!M${row}`, values: [[""]] })) } });
      out.cleared += go.length;
      const back = await readBack(sheets, spreadsheetId, tab, before, go.map(([, row]) => ({ cell: `M${row}`, blank: true })), { throwQuota: true });
      if (!back.ok) out.alarm = back.alarm;
    }
    if (log.sd?.length) {
      const before = await readFormulas(sheets, spreadsheetId, STREAM_TAB);
      const go = log.sd.filter(([row, lumId]) => str(cellAt(before, row, "A")) === lumId);
      if (go.length) {
        await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: go.map(([row]) => ({ range: `'${qt(STREAM_TAB)}'!A${row}:E${row}`, values: [["", "", "", "", ""]] })) } });
        out.rows = go.length;
      }
    }
  } catch (err) {
    if (quotaHit(err)) return { ...out, quota: true };
    throw err;
  }
  if (log.db?.length) {
    await sql.transaction(log.db.map(([pid, lumId]) => sql`UPDATE placements SET luminate_id = '' WHERE id = ${pid} AND luminate_id = ${lumId}`));
    out.ids = log.db.length;
  }
  return out;
}
