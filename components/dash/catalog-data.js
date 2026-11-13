import { songSplit } from "../../lib/splits";
import { shareFixes, shareDiffers } from "../../lib/split-fixes";
import { dupeIds } from "./helpers";
import { splitsToFix, uid } from "./ui";

// Publishing's data side the shell, To do and the portal need: the background sheet sync and the
// split lists (list B #11: apart from Publishing's screens in catalog.jsx).

/* staff: full client catalog with splits ------------------------------ */
// keep in sync with lib/sheets.js's normalizeTitle — staff often hand-type
// a "(feat. X)" tag onto the sheet's title cell that the site never stores,
// so a title match has to tolerate that tag or it never links up.
export const normalizeTitle = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  .replace(/\s+(feat|ft|featuring)\s+.*$/, "").trim();

// db.sheetSync is when the site last synced from the sheet (kept in the
// database, shared by every device), so "is this data current" can't just
// mean "has it ever synced" — a sync a while ago (including before some bug
// fix that only affects sync logic itself) would otherwise sit stale
// indefinitely with no way to notice. Both silent background auto-syncs
// (CatalogAdmin, ClientPortal) re-check against this instead of a one-time
// gate, so nobody has to remember to press a button for routine staleness.
// (2026-11-13) 30 minutes, not 5: each pull reads every client's tab (18 of Google's 60 reads a minute, shared with
// the rest of the dashboard), the daily cron pulls too, and Refresh numbers always pulls. pages/api/sheets-pull.js
// skips a background pull when one started in the last 30 minutes, here or in another browser.
const SYNC_STALE_MS = 30 * 60 * 1000;
export const isSheetSyncStale = (db) => {
  const at = db.sheetSync?.lastSyncedAt;
  return !at || Date.now() - new Date(at).getTime() > SYNC_STALE_MS;
};

// Shared by the Overview page's "Sync Streams" flow (via fullSiteSync) and
// each portal's silent background refresh (see the auto-sync effects
// below) — pulls sheet rows for the given clients and merges streams/
// revenue/adminFee/luminateId onto matching placements. Doesn't create new
// placements or claim rows back to the sheet; fullSiteSync layers that on
// top using rowsByClient.
// stored the way the live site's pull stores them (the sheet's shown values): money to the cent, a new
// card's share to one decimal (33.3, as the tab shows 1/3), the same as lib/site-sync.js
const toCents = (n) => Math.round((Number(n) || 0) * 100 + (n >= 0 ? 1e-9 : -1e-9)) / 100;
const toShare1 = (n) => Math.round((Number(n) || 0) * 10 + 1e-9) / 10;
async function pullAndMergeSheetData(db, clients, { background = false } = {}) {
  const res = await fetch("/api/sheets-pull", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
    body: JSON.stringify({ clients: clients.map((c) => ({ id: c.id, name: c.name, sheetTabName: c.sheetTabName })), ...(background ? { background: true } : {}) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Sync failed");
  if (data.skipped) return { skipped: true };

  const totalsByClient = {};
  const rowsByClient = {};
  for (const c of data.clients) {
    totalsByClient[c.clientId] = c.totalStreams;
    rowsByClient[c.clientId] = c.rows;
  }
  const claimedRows = new Set(); // `${clientId}:${row}` — rows already matched to a placement below
  // a row's syncId only means something if the placement it names still
  // exists — if that placement was deleted/re-added since the last push,
  // the row is really unclaimed even though its Site Sync ID column isn't
  // blank, so title-fallback needs to be able to reclaim it too.
  const livePlacementIds = new Set(db.placements.map((p) => p.id));
  const rowIsAvailableForTitleMatch = (r) => !r.syncId || !livePlacementIds.has(r.syncId.split(":")[0]);
  const placements = db.placements.map((p) => {
    const rows = rowsByClient[p.clientId] || [];
    // same priority as the push side: an exact syncId always wins; next,
    // the Luminate ID is the one field that identifies the actual song
    // regardless of what's sitting in the sheet's Site Sync ID column —
    // if this placement's id ever changed (deleted and re-added, a stale
    // duplicate that got merged), its old syncId may now be stuck on a row
    // that isn't "unclaimed" by the title-fallback's definition, so
    // streams/revenue would never update again without this; finally, fall
    // back to a row with a matching title that's genuinely unclaimed OR
    // whose syncId points at a placement that no longer exists (see
    // rowIsAvailableForTitleMatch above) — a placement with no locally-
    // stored Luminate ID at all would otherwise never be able to reclaim
    // its own row through either of the first two paths.
    const bySyncId = rows.find((r) => r.syncId && r.syncId.split(":")[0] === p.id);
    const byLuminateId = !bySyncId && p.luminateId
      ? rows.find((r) => r.luminateId && r.luminateId === p.luminateId)
      : null;
    const row = bySyncId || byLuminateId
      || rows.find((r) => rowIsAvailableForTitleMatch(r) && normalizeTitle(r.song) === normalizeTitle(p.song));
    if (!row) return p;
    claimedRows.add(`${p.clientId}:${row.row}`);
    return {
      ...p,
      streams: row.grossStreams,
      revenue: toCents(row.grossRevenue),
      adminFee: toCents(row.adminFee),
      // the sheet wins here, not fill-blanks-only like everything else on
      // this route — staff correct/update Luminate IDs directly on the
      // sheet as part of the weekly refresh, and a fill-blanks rule would
      // mean a sheet-side correction could never take effect once any
      // value (even a wrong one) was ever set. Only falls back to the
      // site's own value when the sheet cell is genuinely blank — e.g.
      // staff typed it on the site before it ever reached the sheet.
      luminateId: row.luminateId || p.luminateId,
    };
  });

  return { data, totalsByClient, rowsByClient, claimedRows, placements };
}

// a song brought in from the sheet gets an id made from its client + title, so two syncs that
// overlap (two staff, or Sync Streams pressed while the Clients-tab sync still runs) save one
// song, not two: the second save finds that id already there and just updates it
const sheetSongId = (clientId, title) => {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (const ch of `${clientId}:${title}`) { const c = ch.codePointAt(0); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x5bd1e995); }
  return [a, b].map((h) => ((h >>> 0) % 1679616).toString(36).padStart(4, "0")).join("");
};

// Full site-wide sync — merges sheet data onto existing placements (via
// pullAndMergeSheetData) AND picks up any genuinely new song staff typed
// straight into the sheet, claiming its row back with a Site Sync ID.
// Shared by the "Sync from sheet" button and the Overview page's "Sync
// Streams" button, which chains this right after refreshing STREAM DATA so
// one click keeps both the sheet and the site current — see runStreamSync.
// It starts from the server's latest copy, not the tab's (which only falls in
// when that can't be fetched): a song added elsewhere since the tab loaded is
// matched to its sheet row instead of coming in again as a stripped duplicate.
// Saved as the base, that copy makes the save carry only the sync's own
// changes, so an edit made during the pull stays.
// background (the Dashboard's own pull on a stale copy): the server may skip it, a pull having started lately ({ skipped })
export async function fullSiteSync(tabDb, commit, { background = false } = {}) {
  const latest = await fetch("/api/dashboard-data", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const db = latest?.role === "staff" ? latest : tabDb;
  const pulled = await pullAndMergeSheetData(db, db.clients, { background });
  if (pulled.skipped) return { missing: [], skipped: true };
  const { data, totalsByClient, rowsByClient, claimedRows, placements } = pulled;

  // a client's tab can hold more than one row for the same title (an old
  // duplicate row from before this feature existed, a re-typed entry,
  // etc.) — the match above only ever claims ONE row per placement, so
  // track every title a client already has on the site and skip the
  // rest rather than importing each leftover duplicate as a new song.
  const existingTitles = new Map(); // clientId -> Set(normalizedTitle)
  // a title removed as "not ours" counts as already there, so its leftover row is never imported again
  for (const p of [...db.placements.map((x) => ({ clientId: x.clientId, key: normalizeTitle(x.song) })), ...(db.notOurs || []).map((x) => ({ clientId: x.clientId, key: x.songKey }))]) {
    const set = existingTitles.get(p.clientId) || new Set();
    set.add(p.key);
    existingTitles.set(p.clientId, set);
  }

  // any row left over in a client's own tab — after both the syncId/title
  // match above AND the already-tracked-title check — is a genuinely new
  // song staff typed straight into the sheet. Bring it onto the site,
  // then stamp its Site Sync ID so future syncs match it directly.
  const created = [];
  const claims = [];
  for (const c of db.clients) {
    const rows = rowsByClient[c.id] || [];
    // seen tracks titles claimed *within this pass* too — two unclaimed
    // rows sharing a title (a re-typed duplicate, a copy-paste mistake)
    // must only ever produce one new placement, not one each.
    const seen = existingTitles.get(c.id) || new Set();
    for (const row of rows) {
      if (claimedRows.has(`${c.id}:${row.row}`)) continue;
      const title = normalizeTitle(row.song);
      if (seen.has(title)) continue;
      seen.add(title);
      const key = sheetSongId(c.id, title);
      const id = db.placements.some((p) => p.id === key) ? uid() : key;
      created.push({
        id, clientId: c.id, song: row.song, artist: row.artist || c.name,
        releaseDate: "", link: "", cover: "", notable: false,
        luminateId: row.luminateId || "",
        // a blank Writer Share on the sheet comes in as 0%, never an invented 100%: the splits task flags it
        splits: [{ id: uid(), name: c.name, role: c.role || "", percent: toShare1(row.writerShare) }],
        streams: row.grossStreams, revenue: toCents(row.grossRevenue), adminFee: toCents(row.adminFee),
      });
      const tabName = c.sheetTabName || c.name;
      claims.push({ tab: tabName, row: row.row, syncId: `${id}:${tabName.toLowerCase()}` });
    }
  }

  const clients = db.clients.map((c) => ({ ...c, totalStreams: totalsByClient[c.id] ?? c.totalStreams }));
  const saved = await commit({ ...db, placements: [...placements, ...created], clients, sheetSync: { lastSyncedAt: data.syncedAt } }, db);
  // songs that never reached the site get no Site Sync IDs on the sheet
  if (!saved) throw new Error("The sheet was read, but the synced numbers couldn't be saved — try again.");
  const onSite = new Set(saved.placements.map((p) => p.id));
  const kept = claims.filter((c) => onSite.has(c.syncId.split(":")[0]));

  if (kept.length) {
    fetch("/api/sheets-claim", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
      body: JSON.stringify({ claims: kept }),
    }).catch((err) => console.error("Claim-back failed:", err));
  }
  // the cards just imported have no sheet facts yet (the pull above ran before they existed), so they'd read as
  // having no row: read those clients' tabs once more, which keeps their facts (a read of the sheet only)
  const got = [...new Set(created.filter((p) => onSite.has(p.id)).map((p) => p.clientId))].map((id) => db.clients.find((c) => c.id === id)).filter(Boolean);
  if (got.length) {
    await fetch("/api/sheets-pull", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
      body: JSON.stringify({ clients: got.map((c) => ({ id: c.id, name: c.name, sheetTabName: c.sheetTabName })) }),
    }).catch(() => {}); // the next pull keeps them instead
  }

  // a client whose tab couldn't be found by name gets nothing synced at
  // all, with no other signal that anything's wrong — surface it here so
  // staff know to set that client's "Sheet tab name" override.
  const missing = data.clients.filter((c) => !c.tabFound).map((c) => db.clients.find((x) => x.id === c.clientId)?.name).filter(Boolean);
  return { missing };
}

// Read-only roster-wide rollup — the landing view of Publishing, before
// staff pick an individual client. Pulls the MASTER tab's own precomputed
// per-writer totals directly (rather than re-deriving them from placements)
// so the numbers always match the sheet exactly, including the 3-year
// forecast columns the site doesn't otherwise track anywhere.
// every song whose splits don't add up, in two groups (lib/splits.js): "Assumed (even split)" is the owner's
// even default, ready to Confirm; "Needs a look" can't be completed evenly, so Fix opens its editor. Confirm is
// the song editor's Save (the site, then the client's own share to their writer tab); nothing reaches the
// sheet before it. This isn't ours clears out a song that was never ours
// the two shares with one clear answer (lib/split-fixes.js), from the last sheet pull's facts
export const shareFixesOf = (db) => shareFixes({ placements: db.placements || [], clients: db.clients || [], facts: db.sheetFacts || {}, makeId: uid });
export const shareDiffersOf = (db) => shareDiffers({ placements: db.placements || [], clients: db.clients || [], facts: db.sheetFacts || {} });
export function splitsToConfirm(db, songInfo = null) {
  const assumed = [], look = [];
  // a card in a possible duplicate pair waits for the merge card: confirming the kept one first would
  // keep its even default and drop the other card's named split, and Save on the other one adds a sheet row
  const held = dupeIds(db, songInfo);
  // (r7) no split here while the sheet has 100%: To do's own "Use the sheet's split" row, not a split to review
  for (const x of shareFixesOf(db).site) held.add(x.p.id);
  for (const g of splitsToFix(db)) {
    for (const p of g.songs) {
      if (held.has(p.id)) continue;
      const r = songSplit(p, g.client);
      (r.status === "assumed" ? assumed : look).push({ p, client: g.client, r });
    }
  }
  // (2026-11-10) a split that adds up here, but its client's share isn't the sheet's: the split to Confirm (r.differ)
  for (const x of shareDiffersOf(db)) if (!held.has(x.p.id)) assumed.push(x);
  // one flat list, biggest streams first across every client (the client is named on each row)
  const byStreams = (a, b) => (b.p.streams || 0) - (a.p.streams || 0) || (a.client?.name || "").localeCompare(b.client?.name || "") || (a.p.song || "").localeCompare(b.p.song || "");
  assumed.sort(byStreams); look.sort(byStreams);
  return { assumed, look, all: [...assumed, ...look].sort(byStreams) };
}
