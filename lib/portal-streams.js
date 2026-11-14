// A client's streams the way their portal shows them (components/portal/ClientPortal.jsx SongManager), and the share
// card that has to say the same numbers (lib/share-card.js). Pure: the browser and the server both call it, so the
// page and the card can't disagree. No imports.
//
// Gross Streams = every song's streams from the pub sheet, plus, for a song the sheet has no streams for yet, Spotify's
// all-time plays standing in for it (2026-11-11, the owner: "can we use the spotify numbers for now until theyre on
// luminate"). A song Spotify was asked about but shows no count for is "Under 1,000" (Spotify doesn't count below that).

// a placement's Spotify track as the numbers' entity key (t:<id>), or null
export const trackKey = (link) => {
  const m = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]{22})/.exec(String(link || ""));
  return m ? `t:${m[1]}` : null;
};

// The automated numbers' songs for one artist (GET /api/my-numbers or /api/data: [{ id, ids?, under1k, streams }]) by
// every Spotify id they're known by. (2026-11-13) a song is listed once, under one Spotify id: a copy that links another
// id of the same song (ids, lib/data/engine.js sameSongIds) is found by that one too; a song's own id wins.
export const spotSongsOf = (list) => {
  const songs = Array.isArray(list) ? list : [];
  return new Map([...songs.flatMap((x) => (x.ids || []).map((k) => [k, x])), ...songs.map((x) => [x.id, x])]);
};

// Spotify standing in for one song: { n } (its plays), { under1k: true }, or null (the sheet has streams for it, or
// Spotify has nothing). growth: GET /api/growth's { [placementId]: { latest } }, or null while it loads
export function spotifyStandIn(p, growth, spotSongs) {
  if (p.streams > 0) return null;
  const g = growth?.[p.id]?.latest, x = spotSongs?.get(trackKey(p.link));
  const n = g > 0 ? g : x?.streams?.latest > 0 ? x.streams.latest : null;
  return n ? { n } : x?.under1k ? { under1k: true } : null;
}

// The portal's whole rollup for one client's songs:
//   gross       Gross Streams as the page shows it (sheet + the Spotify stand-ins)
//   sheetGross  the pub sheet's streams alone
//   spotifyFill { n: songs Spotify stands in for, plays }
//   songs       [{ p, sp, streams, under1k }] in the order given; streams is the number the song's window shows
// (No net streams: the site shows none to anyone, 2026-11-13, so nothing here works them out.)
export function portalStreams(songs, { growth = null, spotSongs = null } = {}) {
  let sheetGross = 0;
  const spotifyFill = { n: 0, plays: 0 };
  const rows = [];
  for (const p of songs || []) {
    sheetGross += p.streams || 0;
    const sp = spotifyStandIn(p, growth, spotSongs);
    if (sp?.n) {
      spotifyFill.n += 1;
      spotifyFill.plays += sp.n;
    }
    rows.push({ p, sp, streams: sp?.n ?? (p.streams || 0), under1k: !!sp?.under1k });
  }
  return { gross: sheetGross + spotifyFill.plays, sheetGross, spotifyFill, songs: rows };
}

// The biggest songs, for the share card: the ones with a number (an "Under 1,000" song has none), biggest first, a
// tie by title. [{ title, streams }]
export function topSongs(rows, limit = 5) {
  return (rows || [])
    .filter((r) => !r.under1k && r.streams > 0)
    .map((r) => ({ title: String(r.p?.song || "").trim() || "Untitled", streams: Math.round(r.streams) }))
    .sort((a, b) => b.streams - a.streams || a.title.localeCompare(b.title))
    .slice(0, limit);
}

// The share card's file name, the same from the server (GET /api/share-card) and the portal's Save image:
// defied-<name>-streams.png ("Stack!e" -> defied-stack-e-streams.png)
export function shareFileName(name) {
  const slug = String(name ?? "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
  return `defied-${slug || "artist"}-streams.png`;
}
