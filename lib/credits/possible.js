// The possible placements waiting in To do (app_state "creditsFound", lib/credits/scan.js), as GET /api/songs (lib/song-info.js) sends them. Pure.
// A key is "<Spotify track id>|<client id>": one suggestion is one song for one client, so a song two of our clients are credited on is two of them.
export const POSSIBLE_KEY = /^[A-Za-z0-9]{22}\|[A-Za-z0-9_-]{1,40}$/;

// -> [{ key, spotifyId, clientId, client, song, artist, releaseDate, isrc, source ("apple" | "youtube"), roles, credit, alias, via, found }], the newest release first.
// Anything in the blob that isn't a suggestion is left out, so a bad value never reaches the page.
export function pendingPossible(found) {
  if (!found || typeof found !== "object" || Array.isArray(found)) return [];
  return Object.entries(found)
    .filter(([key, e]) => POSSIBLE_KEY.test(key) && e && typeof e === "object" && String(e.song || "").trim() && String(e.clientId || ""))
    .map(([key, e]) => ({
      key, spotifyId: key.split("|")[0], clientId: String(e.clientId), client: String(e.client || ""), song: String(e.song), artist: String(e.artist || ""), releaseDate: String(e.releaseDate || ""),
      isrc: String(e.isrc || ""), source: e.source === "youtube" ? "youtube" : "apple", roles: Array.isArray(e.roles) ? e.roles.map(String).slice(0, 8) : [], credit: String(e.credit || ""),
      alias: String(e.alias || ""), via: String(e.via || ""), found: String(e.found || ""),
    }))
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.song.localeCompare(b.song) || a.key.localeCompare(b.key));
}
