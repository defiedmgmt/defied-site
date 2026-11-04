// The pub sheet's STREAM DATA tab, fed by the new numbers (the owner, 2026-11-04: "replace those luminate streams
// with the new method"). Luminate used to fill it; since list B #3 nothing did, so its streams stayed at Oct 29.
//
// Layout (unchanged): row 1 headers, then one row per Luminate song id from A2:
//   A Luminate ID · B Title · C Artist / Owner · D All-Time Streams (ATD) · E Source
// The ONLY formulas that read the tab are column C of every writer tab:
//   =IFERROR(INDEX('STREAM DATA'!$D:$D, MATCH($M5, 'STREAM DATA'!$A:$A, 0)), 0)
// so a song's streams are found by its Luminate ID (the writer tab's column M) in A, and read from D. Earnings,
// fees, MASTER's totals and the advance calculator all follow from those C cells.
//
// What this writes, and nothing else: D and E of rows whose Luminate ID has a Spotify number, and the label in
// G1 (outside A:A and D:D, the only ranges any formula reads). A, B, C, the row order and the row count never
// change, so every MATCH still lands on its row. A row with no Spotify number keeps Luminate's last count.
//
// Two modes (STREAM_SHEET_MODE), because Luminate counted every platform and Spotify is one of them:
//   "estimate" (default)  Spotify plays x the song's own ratio: its Oct 29 Luminate total over its Spotify count
//                         nearest that day (the first Spotify count we have), i.e. Luminate's number grown with the
//                         song's Spotify plays. A song with no ratio of its own takes the catalog's median ratio, or
//                         Spotify alone when there is no median. A ratio under 1x or over 20x is still the song's own
//                         (so nothing jumps) but is flagged: its match is worth a look.
//   "spotify"             Spotify plays as they are (lower than Luminate's all-platform counts). When two Luminate
//                         rows share one Spotify song (a single and its song), only the bigger one takes the count;
//                         the other keeps its number, so nothing is counted twice.
// Behind STREAM_SHEET_WRITES (default off): with it off nothing is read or written here.
// The monthly true-up (lib/trueup.js): once a real Luminate file is applied, estimate mode uses each song's newest
// ratio from it, and on and after its day (until a newer Spotify count) the sheet shows Luminate's real total.
import { sql, rowsOrNoneIfNoTable } from "./db";
import { getSheetsClient, getSheetId } from "./sheets";
import { getState, setState } from "./app-state";
import { trueUpInputs } from "./trueup";

export const STREAM_TAB = "STREAM DATA";
export const LABEL_CELL = "G1";
const on = (v) => /^(on|true|1|yes)$/i.test(String(v || "").trim());
export const streamSheetOn = () => on(process.env.STREAM_SHEET_WRITES);
export const streamSheetMode = () => (String(process.env.STREAM_SHEET_MODE || "").trim().toLowerCase() === "spotify" ? "spotify" : "estimate");
// a ratio outside this is likely a wrong match or a count that hadn't caught up: used, but flagged
export const RATIO_MIN = 1, RATIO_MAX = 20;
export const SOURCE = { own: "Spotify x own ratio", median: "Spotify x median ratio", spotify: "Spotify", kept: "portfolio ATD", trueup: "Luminate true-up" };

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const nyDayOf = (d) => (d ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d)) : "");
const day = (d) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" }).format(new Date(d));

// Pure. rows: STREAM DATA A2:E as read (unformatted). seeds: [{ lum_id, entity_id, atd }] (lum_history, the
// clients' songs). latest / first: Map entity_id -> { value, taken_at }: the newest Spotify play count, and the
// one nearest the Luminate day. trueups: Map lum_id -> { total, on, ratio } (the newest monthly true-up). Returns
// every row's outcome and the cells to write (only the ones that change).
export function planStreamData({ rows = [], seeds = [], latest = new Map(), first = new Map(), trueups = new Map(), mode = "estimate", now = new Date() }) {
  const byLum = new Map();
  for (const s of seeds) if (s.lum_id && s.entity_id && !byLum.has(s.lum_id)) byLum.set(String(s.lum_id), s);
  const ratioOf = (id) => {
    const t = trueups.get(id);
    if (Number(t?.ratio) > 0) return Number(t.ratio); // the newest true-up's ratio
    const s = byLum.get(id), f = s && first.get(s.entity_id);
    const atd = Number(s?.atd), sp = Number(f?.value);
    if (!(atd > 0) || !(sp > 0)) return null;
    return atd / sp;
  };
  // spotify mode: the row with the biggest Luminate number takes a Spotify song shared by several rows
  const lead = new Map();
  for (const r of rows) {
    const id = String(r?.[0] || "").trim(), e = byLum.get(id)?.entity_id;
    if (e && (!lead.has(e) || (Number(r[3]) || 0) > lead.get(e).n)) lead.set(e, { id, n: Number(r[3]) || 0 });
  }
  const own = [];
  for (const r of rows) { const x = ratioOf(String(r?.[0] || "")); if (x != null) own.push(x); }
  const med = median(own);
  const out = [], cells = [];
  rows.forEach((r, i) => {
    const id = String(r?.[0] || "").trim();
    if (!id) return;
    const row = i + 2, old = Number(r[3]) || 0, oldSource = String(r[4] ?? "");
    const s = byLum.get(id), sp = s ? latest.get(s.entity_id) : null;
    const base = { row, id, title: String(r[1] ?? ""), old, spotify: sp ? Number(sp.value) : null, spotifyAt: sp?.taken_at || null };
    let value = old, how = "kept", ratio = null;
    if (sp && Number(sp.value) > 0) {
      if (mode === "spotify") { if (lead.get(s.entity_id)?.id === id) { value = Math.round(Number(sp.value)); how = "spotify"; } else how = "kept"; }
      else {
        const mine = ratioOf(id);
        ratio = mine ?? med;
        how = mine != null ? "own" : med != null ? "median" : "spotify";
        value = Math.round(Number(sp.value) * (ratio ?? 1));
      }
    }
    // the true-up: no Spotify count since its day (or none at all), so its real total is the number
    const tu = mode === "estimate" ? trueups.get(id) : null;
    if (tu && Number(tu.total) > 0 && (!sp || !(Number(sp.value) > 0) || nyDayOf(sp.taken_at) <= tu.on)) { value = Math.round(Number(tu.total)); how = "trueup"; }
    const source = how === "kept" ? oldSource : SOURCE[how];
    const odd = ratio != null && how === "own" && (ratio < RATIO_MIN || ratio > RATIO_MAX);
    out.push({ ...base, value, how, ratio, source, odd, shared: mode === "spotify" && !!s && lead.get(s?.entity_id)?.id !== id });
    if (how !== "kept" && (value !== old || source !== oldSource)) cells.push({ range: `'${STREAM_TAB}'!D${row}:E${row}`, values: [[value, source]] });
  });
  const label = mode === "spotify"
    ? `Streams: Spotify plays (Spotify only), updated ${day(now)}`
    : `Streams: Spotify x ratio estimate (all platforms), updated ${day(now)}`;
  return { mode, rows: out, cells, label, median: med, ownRatios: own.length };
}

// The DB side of the plan: the clients' Luminate songs that have a Spotify match, their newest Spotify play
// count, and the count nearest their Luminate day (none before migration 012: nothing to write).
export async function streamInputs() {
  const seeds = await rowsOrNoneIfNoTable(sql`SELECT lum_id, entity_id, atd, atd_on::text AS atd_on FROM lum_history
    WHERE area = 'roster' AND entity_id IS NOT NULL AND status = 'matched'`);
  const ids = [...new Set(seeds.map((s) => s.entity_id))];
  const trueups = await trueUpInputs();
  if (!ids.length) return { seeds, latest: new Map(), first: new Map(), trueups };
  const [newest, nearest] = await Promise.all([
    sql`SELECT DISTINCT ON (entity_id) entity_id, value, taken_at FROM data_snapshots
      WHERE platform = 'spotify' AND metric = 'streams' AND value > 0 AND entity_id = ANY(${ids}) ORDER BY entity_id, taken_at DESC`,
    sql`SELECT DISTINCT ON (s.entity_id) s.entity_id, s.value, s.taken_at FROM data_snapshots s
      JOIN lum_history h ON h.entity_id = s.entity_id AND h.area = 'roster' AND h.atd_on IS NOT NULL
      WHERE s.platform = 'spotify' AND s.metric = 'streams' AND s.value > 0 AND s.entity_id = ANY(${ids})
      ORDER BY s.entity_id, abs(extract(epoch from (s.taken_at - h.atd_on::timestamptz))), s.taken_at`,
  ]);
  const m = (rows) => new Map(rows.map((r) => [r.entity_id, { value: Number(r.value), taken_at: r.taken_at }]));
  return { seeds: seeds.map((s) => ({ ...s, atd: s.atd == null ? null : Number(s.atd) })), latest: m(newest), first: m(nearest), trueups };
}

// Writes the plan: D:E of the rows that change and the G1 label, in one batchUpdate (RAW). Reads A2:E first and
// writes by those row numbers straight after, so a row is only ever written where its own Luminate ID is.
// { dryRun } plans without writing. With STREAM_SHEET_WRITES off it does nothing at all.
export async function writeStreamData({ now = new Date(), dryRun = false, mode = streamSheetMode() } = {}) {
  if (!streamSheetOn()) return { skipped: "STREAM_SHEET_WRITES is off" };
  const sheets = getSheetsClient(), spreadsheetId = getSheetId();
  const [read, inputs] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId, range: `'${STREAM_TAB}'!A2:E`, valueRenderOption: "UNFORMATTED_VALUE" }),
    streamInputs(),
  ]);
  const plan = planStreamData({ rows: read.data.values || [], ...inputs, mode, now });
  const counts = { own: 0, median: 0, spotify: 0, kept: 0, trueup: 0 };
  for (const r of plan.rows) counts[r.how]++;
  const summary = { mode, rows: plan.rows.length, changed: plan.cells.length, ...counts, medianRatio: plan.median, label: plan.label };
  if (dryRun) return { ...summary, dryRun: true, plan };
  const label = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${STREAM_TAB}'!${LABEL_CELL}` }).then((r) => r.data.values?.[0]?.[0] || "").catch(() => "");
  const data = [...plan.cells, ...(label === plan.label ? [] : [{ range: `'${STREAM_TAB}'!${LABEL_CELL}`, values: [[plan.label]] }])];
  if (data.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data } });
  const state = { at: now.toISOString(), mode, rows: plan.rows.length, written: plan.cells.length, ...counts, medianRatio: plan.median };
  await setState("streamSheet", state);
  return { ...summary, written: plan.cells.length };
}

// Publishing's one-line status (staff only): which numbers the sheet's streams are, and whether it's on.
export async function streamSheetStatus() {
  const mode = streamSheetMode(), word = mode === "spotify" ? "Spotify plays" : "Spotify estimate";
  if (!streamSheetOn()) return { on: false, mode, text: `Sheet streams: ${word} (off until you turn it on)` };
  const st = await getState("streamSheet").catch(() => null);
  if (!st?.at) return { on: true, mode, text: `Sheet streams: ${word} (on, updates after the next numbers refresh)` };
  return { on: true, mode: st.mode || mode, at: st.at, text: `Sheet streams: ${st.mode === "spotify" ? "Spotify plays" : "Spotify estimate"}, updated ${day(st.at).replace(/, \d{4}$/, "")}` };
}
