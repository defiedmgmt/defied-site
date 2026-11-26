// (2026-11-26 review) staff's one "as of" line for the streams on every Roster page (the Overview, Catalog, a client's page and its song window): the day the streams are from, as the
// client's own portal and the share card say it, not the day the site last read the pub sheet (that is the Overview's Refresh numbers title). day: the sheet's (db.streamsOn, Luminate's
// last numbers) unless the caller knows better (a song Spotify's plays stand in for: lib/portal-streams.js streamsDay).
// (2026-11-26, the owner, review finding BMR-5) staff's streams date reads the same everywhere: "Streams as of <day>", never "Updated <the day the site last read the pub sheet>".
// No day at all: no line (until then it fell back to "Updated <that day>", which put the two wordings side by side again).
// Its own small file, with no imports, so the client's portal, which draws a client's page too, carries only this and not Catalog's code
export const streamsLine = (db, day = db?.streamsOn) =>
  day ? `Streams as of ${new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : "";
