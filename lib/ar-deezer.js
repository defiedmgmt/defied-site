// The A&R artists' Deezer pages (Deezer's free public API, no key): fans, and the tracks they're
// credited on. An artist with no Spotify artist link (only songs, like ninopba) is followed through
// those songs: arWatchOf adds up their listed songs into one "songs only" row. Also the
// A&R songs' ISRCs, found the way the clients' are (lib/isrc.js). Read-only to Deezer; writes only
// ar_deezer / isrc_candidates / ar_tracked.isrc (when sure). Server-only.
import { sql, rowsOrNoneIfNoTable } from "./db";
import { personKey } from "./names";
import { lookupIsrc, cleanIsrc } from "./isrc";

const DEEZER = "https://api.deezer.com";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function deezer(path, o) {
  await (o.wait || wait)(120); // Deezer allows 50 calls per 5 seconds
  const res = await (o.fetch || fetch)(`${DEEZER}${path}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Deezer answered ${res.status}`);
  const j = await res.json();
  if (j?.error) throw new Error(j.error.message || "Deezer error");
  return j;
}

// One name -> its Deezer page { deezerId, name, fans, picture, tracks: [{ title, isrc, deezerId }] }, or
// { deezerId: "" } when no page has that name (by the app's name rule; the one with the most fans wins)
export async function deezerPage(name, o = {}) {
  const key = personKey(name);
  if (!key) return { deezerId: "" };
  const r = await deezer(`/search/artist?q=${encodeURIComponent(name)}&limit=10`, o);
  const a = (r.data || []).filter((x) => personKey(x.name) === key).sort((x, y) => (y.nb_fan || 0) - (x.nb_fan || 0))[0];
  if (!a) return { deezerId: "" };
  const top = await deezer(`/artist/${a.id}/top?limit=100`, o);
  const tracks = (top.data || []).map((t) => ({ title: t.title || "", isrc: cleanIsrc(t.isrc), deezerId: String(t.id) }));
  return { deezerId: String(a.id), name: a.name, fans: Number.isFinite(a.nb_fan) ? a.nb_fan : null, picture: a.picture_medium || "", tracks };
}

// Looks up the tracked artists whose page wasn't read in 6 days (never read first), `limit` a run, or
// just `ids`. Returns { looked, found }.
export async function refreshDeezer({ limit = 8, ids = null, ...o } = {}) {
  const rows = ids
    ? await sql`SELECT id, name FROM ar_tracked WHERE id = ANY(${ids}) AND kind = 'artist' AND removed_at IS NULL`
    : await rowsOrNoneIfNoTable(sql`
      SELECT t.id, t.name FROM ar_tracked t LEFT JOIN ar_deezer d ON d.person = 't:' || t.id
      WHERE t.kind = 'artist' AND t.removed_at IS NULL AND (d.person IS NULL OR d.checked_at < now() - interval '6 days')
      ORDER BY d.checked_at NULLS FIRST, t.created_at LIMIT ${limit}
    `);
  const out = { looked: 0, found: 0 };
  for (const t of rows) {
    const p = await deezerPage(t.name, o);
    out.looked++;
    if (p.deezerId) out.found++;
    await sql`INSERT INTO ar_deezer (person, deezer_id, name, fans, picture, tracks, checked_at)
      VALUES (${`t:${t.id}`}, ${p.deezerId}, ${p.name || ""}, ${p.fans ?? null}, ${p.picture || ""}, ${JSON.stringify(p.tracks || [])}, now())
      ON CONFLICT (person) DO UPDATE SET deezer_id = EXCLUDED.deezer_id, name = EXCLUDED.name, fans = EXCLUDED.fans, picture = EXCLUDED.picture, tracks = EXCLUDED.tracks, checked_at = now()`;
  }
  return out;
}

// person -> { deezerId, fans, picture, url, tracks } for arWatchOf (nothing before the migration)
export async function deezerPages() {
  const rows = await rowsOrNoneIfNoTable(sql`SELECT person, deezer_id, fans, picture, tracks FROM ar_deezer WHERE deezer_id <> ''`);
  return Object.fromEntries(rows.map((r) => [r.person, { deezerId: r.deezer_id, fans: r.fans == null ? null : Number(r.fans), picture: r.picture, url: `https://www.deezer.com/artist/${r.deezer_id}`, tracks: r.tracks || [] }]));
}

// A few A&R songs with no ISRC a run (it finds the song on Spotify: search isrc:…): sure ones are
// saved on the song, the rest offered as candidates ("ar:<id>"). Returns { looked, found, offered }.
export async function refreshArIsrcs({ limit = 5, ...o } = {}) {
  const rows = await rowsOrNoneIfNoTable(sql`
    SELECT t.id, t.name, t.artist, t.spotify FROM ar_tracked t LEFT JOIN isrc_candidates c ON c.item = 'ar:' || t.id
    WHERE t.kind = 'song' AND t.removed_at IS NULL AND t.isrc = '' AND (c.item IS NULL OR c.checked_at < now() - interval '14 days')
    ORDER BY c.checked_at NULLS FIRST, t.created_at LIMIT ${limit}
  `);
  const out = { looked: 0, found: 0, offered: 0 };
  for (const t of rows) {
    const r = await lookupIsrc({ song: t.name, artist: t.artist, link: t.spotify }, o);
    if (r.failed) break;
    out.looked++;
    if (r.hit) { out.found++; await sql`UPDATE ar_tracked SET isrc = ${r.hit.isrc} WHERE id = ${t.id} AND isrc = ''`; }
    else if (r.candidates.length) out.offered++;
    await sql`INSERT INTO isrc_candidates (item, song, artist, candidates) VALUES (${`ar:${t.id}`}, ${t.name}, ${t.artist}, ${JSON.stringify(r.hit ? [] : r.candidates)})
      ON CONFLICT (item) DO UPDATE SET candidates = EXCLUDED.candidates, checked_at = now()`;
  }
  return out;
}
