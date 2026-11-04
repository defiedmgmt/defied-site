// Keeps what the sheet pull read (lib/sheet-facts.js) in sheet_song_facts / sheet_client_facts
// (db/migrations/007-2026-12-sheet-facts.sql). Migrations now run on each production build (scripts/migrate.mjs); still:
// until the tables exist, saving does nothing and reading gives no facts (the pages then show the
// app's own estimate), and the pull itself never fails over them.
import { sql, rowsOrNoneIfNoTable } from "./db";
import { sheetFactsFor, sheetNet } from "./sheet-facts";

const noTable = (err) => err?.code === "42P01";

// one client's tab as just read: its songs' rows and its Net Streams. tab = null: no tab (facts cleared)
export function sheetFactQueries(clientId, tab, songs, rows, live) {
  const facts = tab ? sheetFactsFor(songs, rows, live) : [];
  return [
    sql`DELETE FROM sheet_song_facts WHERE client_id = ${clientId}`,
    ...facts.map((f) => sql`
      INSERT INTO sheet_song_facts (placement_id, client_id, sheet_row, sheet_share, net_streams, synced_at)
      VALUES (${f.placementId}, ${clientId}, ${f.row}, ${f.share}, ${f.net}, now())
      ON CONFLICT (placement_id, client_id) DO UPDATE SET sheet_row = EXCLUDED.sheet_row, sheet_share = EXCLUDED.sheet_share, net_streams = EXCLUDED.net_streams, synced_at = now()
    `),
    tab
      ? sql`INSERT INTO sheet_client_facts (client_id, tab, net_streams, synced_at) VALUES (${clientId}, ${tab}, ${sheetNet(rows)}, now())
            ON CONFLICT (client_id) DO UPDATE SET tab = EXCLUDED.tab, net_streams = EXCLUDED.net_streams, synced_at = now()`
      : sql`DELETE FROM sheet_client_facts WHERE client_id = ${clientId}`,
  ];
}

export async function saveSheetFacts(queries) {
  if (!queries.length) return;
  try { await sql.transaction(queries); } catch (err) {
    if (noTable(err)) return;
    console.error("sheet facts not saved:", err); // the pull's own result still stands
  }
}

// { songs: { placementId: { row, share, net } }, clients: { clientId: net } }; clientId limits it to one client
export async function readSheetFacts(clientId = null) {
  const [songs, clients] = await Promise.all([
    rowsOrNoneIfNoTable(clientId ? sql`SELECT * FROM sheet_song_facts WHERE client_id = ${clientId}` : sql`SELECT * FROM sheet_song_facts`),
    rowsOrNoneIfNoTable(clientId ? sql`SELECT * FROM sheet_client_facts WHERE client_id = ${clientId}` : sql`SELECT * FROM sheet_client_facts`),
  ]);
  const out = { songs: {}, clients: {} };
  for (const f of songs) out.songs[f.placement_id] = { row: f.sheet_row, share: f.sheet_share == null ? null : Number(f.sheet_share), net: Math.round(Number(f.net_streams) || 0) };
  for (const c of clients) out.clients[c.client_id] = Number(c.net_streams);
  return out;
}
