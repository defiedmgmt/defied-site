// A song's row in the placements table, and the statements that write it. The staff and client saves in
// pages/api/dashboard-data.js (the song editor's Add Song and Save) and lib/auto-add.js (a roster artist's new
// release) store a song through these, so a song comes out the same whichever way it was made. Server-only.
import { sql } from "./db";

// What an INSERT stores for a song as the site holds it (camelCase): the money columns are 0 until the sheet sync fills them
export const placementRow = (p) => ({
  id: p.id, client_id: p.clientId, song: p.song || "", artist: p.artist || "", release_date: p.releaseDate || "",
  link: p.link || "", cover: p.cover || "", notable: !!p.notable, luminate_id: p.luminateId || "",
  streams: p.streams || 0, revenue: p.revenue || 0, admin_fee: p.adminFee || 0, splits: p.splits || [],
});
export const insertPlacement = (r) => sql`
  INSERT INTO placements (id, client_id, song, artist, release_date, link, cover, notable, luminate_id, streams, revenue, admin_fee, splits)
  VALUES (${r.id}, ${r.client_id}, ${r.song}, ${r.artist}, ${r.release_date}, ${r.link}, ${r.cover}, ${r.notable}, ${r.luminate_id}, ${r.streams}, ${r.revenue}, ${r.admin_fee}, ${JSON.stringify(r.splits)})
`;

// (2026-11-18) A save of the songs writes only the songs that are new or changed, and deletes only the ones its page knew and left out
// (lib/known-ids.js): never "delete them all and insert them again". The id stays, so what is keyed by it (song_tracking, the sheet facts)
// stays. scope: the clients whose songs the save may change (a client's own, an account limited to its own artists'): a song of another client,
// with an id that is sent or named, is left as it is. null: any client's (an account with every artist)
export const upsertPlacement = (r, scope = null) => sql`
  INSERT INTO placements (id, client_id, song, artist, release_date, link, cover, notable, luminate_id, streams, revenue, admin_fee, splits)
  VALUES (${r.id}, ${r.client_id}, ${r.song}, ${r.artist}, ${r.release_date}, ${r.link}, ${r.cover}, ${r.notable}, ${r.luminate_id}, ${r.streams}, ${r.revenue}, ${r.admin_fee}, ${JSON.stringify(r.splits)})
  ON CONFLICT (id) DO UPDATE SET client_id = EXCLUDED.client_id, song = EXCLUDED.song, artist = EXCLUDED.artist, release_date = EXCLUDED.release_date,
    link = EXCLUDED.link, cover = EXCLUDED.cover, notable = EXCLUDED.notable, luminate_id = EXCLUDED.luminate_id, streams = EXCLUDED.streams,
    revenue = EXCLUDED.revenue, admin_fee = EXCLUDED.admin_fee, splits = EXCLUDED.splits
  WHERE ${scope}::text[] IS NULL OR placements.client_id = ANY(${scope}::text[])
`;
export const deletePlacements = (ids, scope = null) => sql`
  DELETE FROM placements WHERE id = ANY(${ids}) AND (${scope}::text[] IS NULL OR client_id = ANY(${scope}::text[]))
`;

// the splits as one string, whatever order their keys came in (the database gives jsonb back in its own key order)
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}` : JSON.stringify(v) ?? "null");
// whether two songs say the same, each as a row of the table (placementRow's, or what the database gives back: its numbers come as strings)
export const samePlacement = (a, b) => ["client_id", "song", "artist", "release_date", "link", "cover", "luminate_id"].every((k) => String(a[k] ?? "") === String(b[k] ?? ""))
  && !!a.notable === !!b.notable && ["streams", "revenue", "admin_fee"].every((k) => Number(a[k]) === Number(b[k])) && canon(a.splits || []) === canon(b.splits || []);
