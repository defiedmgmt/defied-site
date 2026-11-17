// A song's row in the placements table, and the INSERT that writes it. The staff and client saves in
// pages/api/dashboard-data.js (the song editor's Add Song and Save) and lib/auto-add.js (a roster artist's new
// release) store a song through these two, so a song comes out the same whichever way it was made. Server-only.
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
