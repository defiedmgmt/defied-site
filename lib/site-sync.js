// The sheet -> site sync without a browser: what the Clients tab's
// fullSiteSync (components/App.jsx) does in a staff member's tab, done on the
// server, so a new Luminate export or the nightly job updates every client's
// numbers with nobody signed in. Same matching, same new-song import, same
// claim-back. It only writes the columns it owns (streams, revenue, admin fee,
// Luminate ID, total streams, the sync time), so an edit saved meanwhile stays.
import { sql, rowsOrNoneIfNoTable } from "./db";
import {
  getSheetsClient, getSheetId, listTabs, findTab, loadClientTabNames, tabsOfOthers, readTabRows, writeSyncId, normalizeTitle,
} from "./sheets";
import { ownerOf } from "./names";
import { setState } from "./app-state";
import { sheetFactQueries, saveSheetFacts } from "./sheet-facts-store";

const uid = () => Math.random().toString(36).slice(2, 10);
// kept identical to sheetSongId in components/App.jsx: the browser and this job bring a song in
// from the sheet under the same id, so two syncs that overlap save it once
const sheetSongId = (clientId, title) => {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (const ch of `${clientId}:${title}`) { const c = ch.codePointAt(0); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x5bd1e995); }
  return [a, b].map((h) => ((h >>> 0) % 1679616).toString(36).padStart(4, "0")).join("");
};

export async function syncSiteFromSheet() {
  const sheets = getSheetsClient(), spreadsheetId = getSheetId();
  const [clients, placements, notOurs] = await Promise.all([
    sql`SELECT * FROM clients ORDER BY roster_order, id`,
    sql`SELECT * FROM placements`,
    rowsOrNoneIfNoTable(sql`SELECT client_id, song_key FROM not_ours`),
  ]);
  const tabs = await listTabs(sheets, spreadsheetId);
  const known = await loadClientTabNames();
  const rowsByClient = {}, totals = {}, tabOf = {}, missing = [];
  for (const c of clients) {
    const tabName = (c.sheet_tab_name || c.name || "").trim();
    const me = known.find((k) => k.id === c.id) || ownerOf(known, tabName);
    const tab = findTab(tabs, tabName, tabsOfOthers(known, me));
    if (!tab) { rowsByClient[c.id] = []; totals[c.id] = 0; missing.push(c.name); continue; }
    const rows = await readTabRows(sheets, spreadsheetId, tab.title);
    rowsByClient[c.id] = rows;
    totals[c.id] = rows.reduce((s, r) => s + r.grossStreams, 0);
    tabOf[c.id] = tab.title;
  }
  const syncedAt = new Date().toISOString();

  // stored the way the live site's pull stores them (the sheet's shown values): money to the cent, a new
  // card's share to one decimal (33.3, as the tab shows 1/3). The exact values stay in the sheet facts.
  const cents = (n) => Math.round((Number(n) || 0) * 100 + (n >= 0 ? 1e-9 : -1e-9)) / 100;
  const share1 = (n) => Math.round((Number(n) || 0) * 10 + 1e-9) / 10;
  // pullAndMergeSheetData's matching: Site Sync ID, then Luminate ID, then a free row with the title
  const claimed = new Set();
  const live = new Set(placements.map((p) => p.id));
  const freeForTitle = (r) => !r.syncId || !live.has(r.syncId.split(":")[0]);
  const updates = [];
  for (const p of placements) {
    const rows = rowsByClient[p.client_id] || [];
    const row = rows.find((r) => r.syncId && r.syncId.split(":")[0] === p.id)
      || (p.luminate_id ? rows.find((r) => r.luminateId && r.luminateId === p.luminate_id) : null)
      || rows.find((r) => freeForTitle(r) && normalizeTitle(r.song) === normalizeTitle(p.song));
    if (!row) continue;
    claimed.add(`${p.client_id}:${row.row}`);
    const next = { streams: row.grossStreams, revenue: cents(row.grossRevenue), adminFee: cents(row.adminFee), luminateId: row.luminateId || p.luminate_id };
    if (Number(p.streams) !== next.streams || Number(p.revenue) !== next.revenue || Number(p.admin_fee) !== next.adminFee || p.luminate_id !== next.luminateId) {
      updates.push({ id: p.id, ...next });
    }
  }

  // fullSiteSync's import: a row no song claimed, with a title the client doesn't already have
  const created = [], claims = [];
  for (const c of clients) {
    // a title removed as "not ours" counts as already there, so it's never imported again
    const seen = new Set([...placements.filter((p) => p.client_id === c.id).map((p) => normalizeTitle(p.song)), ...notOurs.filter((r) => r.client_id === c.id).map((r) => r.song_key)]);
    for (const row of rowsByClient[c.id] || []) {
      if (claimed.has(`${c.id}:${row.row}`)) continue;
      const title = normalizeTitle(row.song);
      if (seen.has(title)) continue;
      seen.add(title);
      const key = sheetSongId(c.id, title);
      const id = live.has(key) ? uid() : key;
      created.push({
        id, client_id: c.id, song: row.song, artist: row.artist || c.name, luminate_id: row.luminateId || "",
        // a blank Writer Share on the sheet comes in as 0%, never an invented 100%: the splits task flags it
        splits: [{ id: uid(), name: c.name, role: c.role || "", percent: share1(row.writerShare) }],
        streams: row.grossStreams, revenue: cents(row.grossRevenue), admin_fee: cents(row.adminFee),
      });
      const tabName = c.sheet_tab_name || c.name;
      claims.push({ clientId: c.id, tabName, row: row.row, syncId: `${id}:${tabName.toLowerCase()}` });
    }
  }

  // a client deleted since the read takes its songs with it: the FK would refuse those inserts
  const stillThere = new Set((await sql`SELECT id FROM clients`).map((c) => c.id));
  const kept = created.filter((p) => stillThere.has(p.client_id));
  const queries = [
    ...updates.map((u) => sql`UPDATE placements SET streams = ${u.streams}, revenue = ${u.revenue}, admin_fee = ${u.adminFee}, luminate_id = ${u.luminateId} WHERE id = ${u.id}`),
    ...kept.map((p) => sql`
      INSERT INTO placements (id, client_id, song, artist, release_date, link, cover, notable, luminate_id, streams, revenue, admin_fee, splits)
      VALUES (${p.id}, ${p.client_id}, ${p.song}, ${p.artist}, '', '', '', false, ${p.luminate_id}, ${p.streams}, ${p.revenue}, ${p.admin_fee}, ${JSON.stringify(p.splits)})
      ON CONFLICT (id) DO NOTHING
    `),
    ...clients.filter((c) => Number(c.total_streams) !== totals[c.id]).map((c) => sql`UPDATE clients SET total_streams = ${totals[c.id]} WHERE id = ${c.id}`),
    sql`UPDATE site_settings SET last_synced_at = ${syncedAt} WHERE id = 1`,
  ];
  await sql.transaction(queries);

  for (const cl of claims.filter((c) => stillThere.has(c.clientId))) {
    const me = ownerOf(known, cl.tabName, cl.clientId);
    const tab = findTab(tabs, cl.tabName, tabsOfOthers(known, me));
    // r11 launch: stamping Sync IDs on the real pub sheet is its own gate (off: the next sync matches by title)
    if (tab && process.env.SITE_SYNC_SHEET_WRITES === "on") await writeSyncId(sheets, spreadsheetId, tab.title, cl.row, cl.syncId);
  }
  // what the sheet says per song and per client (rows, writer shares, Net Streams), for Songs to update
  // and the net streams the pages show; a client without a tab has none (the pages fall back to an estimate)
  const after = [...placements, ...kept], liveNow = new Set(after.map((p) => p.id));
  await saveSheetFacts(clients.filter((c) => stillThere.has(c.id)).flatMap((c) => sheetFactQueries(c.id, tabOf[c.id] || null, after.filter((p) => p.client_id === c.id), rowsByClient[c.id] || [], liveNow)));
  await setState("missingTabs", missing); // the Dashboard's task list reads it
  return { syncedAt, updated: updates.length, created: kept.length, missingTabs: missing };
}
