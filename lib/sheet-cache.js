// (2026-11-20) One saved copy of a sheet read that every server shares, for the pages someone is waiting on ("its taking a long time to load
// everytime"). Google lets this service account read 60 times a minute, shared by the dashboard, the crons and the three sheets; a dashboard
// load read the pub sheet's MASTER tab again and again (4 reads each time, 17 times in 6 minutes on 11-20), went over the quota, and each page
// then sat through 28 s of waiting and still failed. Now:
//  - a read is kept in app_state ("sheetCache:<spreadsheet>:<name>": { readAt, v }) for TTL_MS and served from there by every server;
//  - any write to that spreadsheet through lib/sheets.js marks it written ("sheetCache:<spreadsheet>:written": { at }, after the write is done),
//    and a copy read before that is not served again: what the site writes shows on the next load;
//  - an edit someone makes in Google Sheets itself shows within TTL_MS;
//  - the read itself doesn't sit out the quota (lib/sheets.js withSheetsQuick: one more try after 1.5 s), and when it fails the last good copy
//    is served instead, marked stale with its time; with no copy at all the error is the caller's, as before;
//  - two pages asking at once on one server share one read; a slower read never replaces a newer copy (readAt only moves forward).
// Only for reads nothing writes from: a writer reads the sheet itself (lib/sheet-push.js and the rest are untouched).
import { sql } from "./db";
import { withSheetsQuick, isQuotaError, getSheetsClient, getSheetId, readMasterRollup, readMasterLinks, readAssumptions } from "./sheets";

export const TTL_MS = 3 * 60 * 1000;
// (review, 11-20) the last good copy stands in only for a passing failure (Google's quota, a 5xx, a dropped connection, MASTER's
// all-zero glitch) and only while it's under MAX_STALE_MS old; anything else (access lost, a renamed tab) is the caller's error, as before
export const MAX_STALE_MS = 15 * 60 * 1000;
export const passing = (err) => !!err?.transient || isQuotaError(err) || Number(err?.response?.status || err?.status) >= 500
  || /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|network/i.test(String(err?.code || "") + " " + String(err?.message || ""));
const PREFIX = "sheetCache:";
const entryKey = (sheetId, name) => `${PREFIX}${sheetId}:${name}`;
const markKey = (sheetId) => `${PREFIX}${sheetId}:written`;
const inflight = new Map();

// -> { v, readAt (ms), stale, cached, error? }
export async function cachedSheetRead(sheetId, name, read, { ttlMs = TTL_MS, fresh = false, now = Date.now } = {}) {
  const k = entryKey(sheetId, name);
  let entry = null, writtenAt = 0;
  try {
    const rows = await sql`SELECT key, value FROM app_state WHERE key = ANY(${[k, markKey(sheetId)]})`;
    for (const r of rows) { if (r.key === k) entry = r.value; else writtenAt = Number(r.value?.at) || 0; }
  } catch (err) { console.error("sheet cache: couldn't read the saved copy", err?.message || err); }
  const good = !!entry && entry.v !== undefined && entry.v !== null && Number.isFinite(Number(entry.readAt));
  if (!fresh && good && Number(entry.readAt) > writtenAt && now() - Number(entry.readAt) < ttlMs) return { v: entry.v, readAt: Number(entry.readAt), stale: false, cached: true };
  // a read already going is joined only when it started after the last write and this isn't a fresh read
  const flight = inflight.get(k);
  if (flight && !fresh && flight.readAt > writtenAt) return flight.p;
  const readAt = now();
  const p = (async () => {
    let v;
    try {
      v = await withSheetsQuick(read);
    } catch (err) {
      if (!good || !passing(err) || now() - Number(entry.readAt) > MAX_STALE_MS) throw err;
      console.error(`sheet cache: reading ${name} failed (${String(err?.message || err).slice(0, 160)}); serving the copy from ${new Date(Number(entry.readAt)).toISOString()}`);
      return { v: entry.v, readAt: Number(entry.readAt), stale: true, cached: true, error: String(err?.message || err) };
    }
    try {
      await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${k}, ${JSON.stringify({ readAt, v })}::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
        WHERE coalesce((app_state.value->>'readAt')::bigint, 0) < ${readAt}`;
    } catch (err) { console.error("sheet cache: couldn't save the copy", err?.message || err); }
    return { v, readAt, stale: false, cached: false };
  })().finally(() => { if (inflight.get(k)?.p === p) inflight.delete(k); });
  inflight.set(k, { p, readAt });
  return p;
}

// lib/sheets.js calls this after every write to a spreadsheet (its time only moves forward)
export async function markSheetWritten(sheetId, at = Date.now()) {
  if (!sheetId) return;
  await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${markKey(sheetId)}, ${JSON.stringify({ at })}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    WHERE coalesce((app_state.value->>'at')::bigint, 0) < ${at}`;
}

// The pub sheet's MASTER overview (the Clients tab's rollup, the folder link, the ASSUMPTIONS levers): the four reads /api/sheets-master made
// on every call, now one saved copy. A rollup with writers but an all-zero roster total is MASTER's known transient glitch (readMasterRollup
// already reads twice): never saved, so the last good copy is served instead.
export async function masterOverview({ fresh = false, sheets = null, spreadsheetId = null } = {}) {
  const client = sheets || getSheetsClient(), id = spreadsheetId || getSheetId();
  return cachedSheetRead(id, "master", async () => {
    const rollup = await readMasterRollup(client, id);
    if (rollup.rows.length && !rollup.totals?.rosterGrossStreams) throw Object.assign(new Error("MASTER came back with an all-zero roster total"), { transient: true });
    const links = await readMasterLinks(client, id);
    const assumptions = await readAssumptions(client, id).catch(() => ({}));
    return { rollup, links, assumptions };
  }, { fresh });
}
