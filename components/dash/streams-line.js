import { streamsAsOf } from "./ui";

// (2026-11-26 review) staff's one "as of" line for the streams on every Roster page (the Overview, Catalog, a client's page and its song window): the day the streams are from, as the
// client's own portal and the share card say it, not the day the site last read the pub sheet (that is the Overview's Refresh numbers title). day: the sheet's (db.streamsOn, Luminate's
// last numbers) unless the caller knows better (a song Spotify's plays stand in for: lib/portal-streams.js streamsDay). No day at all: the day the site last read the sheet; nothing read: "".
// Its own small file so the client's portal, which draws a client's page too, carries only this and not Catalog's code
export const streamsLine = (db, day = db?.streamsOn) =>
  day ? `Streams as of ${new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : streamsAsOf({ pulledAt: db?.sheetSync?.lastSyncedAt });
