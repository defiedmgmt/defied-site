// What a Publishing staff member does with a possible placement in To do (pages/api/songs.js, the same permission as "OK" on the songs added automatically):
//   Add        puts the song on the site and the pub sheet the way Add Song does, with the assumed split (lib/auto-add.js addSong: the same placement INSERT, the
//              same pub sheet row, remembered in "autoAdded" so it also shows in To do's "songs added automatically: check the splits"). This is the ONLY way a
//              credits suggestion becomes a song: nothing here or in the scan does it by itself.
//   Not ours   remembers the song for that client for good (app_state creditsNotOurs) and takes the suggestion off the list: it is never suggested again.
// Each answers [status, json] for the route. Server-only.
import { sql as dbSql } from "../db";
import { getState } from "../app-state";
import { spotifyTrack } from "../data/direct";
import { songOnSite } from "../duplicates";
import { nyDay } from "../todo-rank";
import { assumedSplit, addSong } from "../auto-add";
import { KEYS, addNotOurs, dropFound } from "./state";
import { POSSIBLE_KEY } from "./possible";

export async function addPossible({ key, by = "", now = new Date(), sql = dbSql } = {}) {
  if (!POSSIBLE_KEY.test(String(key || ""))) return [400, { error: "Pick the song first." }];
  const found = (await getState(KEYS.found)) || {};
  const s = found[key];
  if (!s || typeof s !== "object") return [404, { error: "That possible placement isn't there any more (it was added, or said not to be ours). Reload the page." }];
  const [client] = await sql`SELECT id, name, credit, role, on_roster FROM clients WHERE id = ${s.clientId}`;
  if (!client || !client.on_roster) { await dropFound([key], sql); return [409, { error: "That client isn't on the roster any more, so the song wasn't added." }]; }
  const [placements, tracking] = await Promise.all([
    sql`SELECT id, client_id, song, link FROM placements WHERE client_id = ${client.id}`,
    sql`SELECT placement_id, isrc FROM song_tracking WHERE isrc <> ''`,
  ]);
  const isrcBy = new Map(tracking.map((t) => [t.placement_id, t.isrc]));
  // already one of the client's (added by hand since): nothing to add
  const already = songOnSite({ clientId: client.id, spotifyId: s.spotifyId, isrc: s.isrc, title: s.song }, placements, (id) => isrcBy.get(id) || "");
  if (already) { await dropFound([key], sql); return [200, { ok: true, already }]; }
  const artist = String(s.artist || "").trim() || client.name;
  const splits = assumedSplit(client, artist, Array.isArray(s.others) ? s.others : []);
  if (!splits) return [409, { error: `There's no assumed split for ${client.name} (${client.role ? `their role is ${client.role}` : "no role is set"}). Add the song from their page instead.` }];
  // the cover is Spotify's (one read); the song is added without it when Spotify doesn't answer
  let cover = "";
  try { cover = (await spotifyTrack(s.spotifyId))?.image || ""; } catch { cover = ""; }
  // the song is remembered in "autoAdded" under its Spotify id; a song added for a second client on the same release gets its own key
  const taken = ((await getState("autoAdded")) || {})[s.spotifyId];
  const rememberAs = taken && typeof taken === "object" && taken.clientId !== client.id ? `${s.spotifyId}:${client.id}` : s.spotifyId;
  const r = await addSong({ spotifyId: s.spotifyId, clientId: client.id, clientName: client.name, song: s.song, artist, releaseDate: s.releaseDate || "", link: `https://open.spotify.com/track/${s.spotifyId}`,
    cover: /^https?:\/\//i.test(cover) ? cover : "", splits, rememberAs }, { now, by: by || "an Add button" });
  if (r.busy) return [409, { error: "A song is being added right now. Try again in a minute." }];
  if (r.skipped) return [409, { error: r.skipped }];
  if (r.fail) {
    // the song is on the site from the first step on (like Add Song, a failed sheet write never undoes the site's save): its row is Songs to update's to find
    const onSite = r.fail.step !== "adding the song to the site";
    if (onSite) await dropFound([key], sql).catch(() => {});
    return [502, { error: `${r.fail.error}${onSite ? " The song is on the site, but its pub sheet row isn't written: it shows under Songs to update." : ""}`, added: onSite, ...(r.fail.more?.alarm ? { alarm: r.fail.more.alarm } : {}) }];
  }
  await dropFound([key], sql).catch(() => {});
  return [200, { ok: true, placementId: r.added.placementId, tab: r.added.tab, row: r.added.row, ...(r.alarm ? { alarm: r.alarm } : {}) }];
}

export async function dismissPossible({ key, now = new Date(), sql = dbSql } = {}) {
  if (!POSSIBLE_KEY.test(String(key || ""))) return [400, { error: "Pick the song first." }];
  // both in one transaction: the memory and the list never disagree
  await sql.transaction([addNotOurs(key, nyDay(now), sql), dropFound([key], sql)]);
  return [200, { ok: true }];
}
