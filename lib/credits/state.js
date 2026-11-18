// What lib/credits keeps in app_state (no migration), every blob bounded. The scan is the only writer of the first four (one run at a time, so a plain
// replace is safe); what a person decides in To do (Add, Not ours) changes creditsFound and creditsNotOurs one key at a time, in one statement each
// (the same atomic merge as lib/data/seeds.js seedRejects), so a decision made while a scan runs is never undone by it. Server-only.
//   creditsWatch   { at, tracks: { [Spotify track id]: "artistId,artistId" } }       the performing artists of the site's placements' tracks (lib/credits/watch.js);
//                                                                                    only the tracks the site has today
//   creditsScan    { day, apple: { pages, stop, errs }, youtube: { searches, stop }, batch: { ok, day }, spotifyUntil,
//                    artists: { [artist id]: "YYYY-MM-DD" }, albums: { [album id]: "YYYY-MM-DD" }, last }   today's budgets and why a source stopped, which artists
//                                                                                    were read when (the current watchlist only), the albums read (30 days), the last report
//   creditsTracks  { [Spotify track id]: { name, artist, ms, rel, aid, w, firstSeen, tries, lastTry, done, source, isrc?, apple?, bad?, yt?, matches? } }
//                                                                                    each new release seen, for KEEP_DAYS, at most CAPS.tracks
//   creditsFound   { [track id|client id]: { spotifyId, clientId, client, song, artist, releaseDate, isrc, source, roles, credit, alias, via, others, found } }
//                                                                                    the possible placements waiting in To do (Add or Not ours takes one out), at most CAPS.found
//   creditsNotOurs { [track id|client id]: "YYYY-MM-DD" }                            "Not ours", remembered for good (at most CAPS.notOurs, the oldest let go past it)
//   producerAliases { [client id]: [names] }                                         extra names for a roster client that staff add (a legal name): read here, never written
import { sql as dbSql } from "../db";
import { setState } from "../app-state";

export const KEYS = { watch: "creditsWatch", scan: "creditsScan", tracks: "creditsTracks", found: "creditsFound", notOurs: "creditsNotOurs", aliases: "producerAliases" };
export const CAPS = { tracks: 2000, found: 300, notOurs: 5000, albums: 4000 };
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

export async function readState(sql = dbSql) {
  const rows = await sql`SELECT key, value FROM app_state WHERE key = ANY(${Object.values(KEYS)})`;
  const by = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { watch: obj(by[KEYS.watch]), scan: obj(by[KEYS.scan]), tracks: obj(by[KEYS.tracks]), found: obj(by[KEYS.found]), notOurs: obj(by[KEYS.notOurs]), aliases: obj(by[KEYS.aliases]) };
}
// the scan's own blobs: replaced whole
export const saveBlob = (key, value) => setState(key, value);

// a person's decisions, one key at a time
export const addFound = (entries, sql = dbSql) => sql`INSERT INTO app_state (key, value, updated_at) VALUES ('creditsFound', ${JSON.stringify(entries)}::jsonb, now())
  ON CONFLICT (key) DO UPDATE SET value = app_state.value || EXCLUDED.value, updated_at = now()`;
export const dropFound = (keys, sql = dbSql) => sql`UPDATE app_state SET value = value - ${keys}::text[], updated_at = now() WHERE key = 'creditsFound'`;
export const addNotOurs = (key, day, sql = dbSql) => sql`INSERT INTO app_state (key, value, updated_at) VALUES ('creditsNotOurs', jsonb_build_object(${key}::text, ${day}::text), now())
  ON CONFLICT (key) DO UPDATE SET value = app_state.value || EXCLUDED.value, updated_at = now()`;
export const dropNotOurs = (keys, sql = dbSql) => sql`UPDATE app_state SET value = value - ${keys}::text[], updated_at = now() WHERE key = 'creditsNotOurs'`;

// the keys to let go of so an object stays within `cap`: the oldest by its sort value, then by key
export function overflow(map, cap, when = (v) => String(v?.found ?? v ?? "")) {
  const keys = Object.keys(map || {});
  if (keys.length <= cap) return [];
  return keys.sort((a, b) => when(map[b]).localeCompare(when(map[a])) || a.localeCompare(b)).slice(cap);
}
