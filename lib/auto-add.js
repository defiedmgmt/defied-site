// (2026-11-17, the owner: "the new songs can go on the pub sheet w the assumed splits and i can go back and update it if
// necessary") A roster artist's new Spotify release goes on the site and on the pub sheet by itself, the way Add Song puts it
// there, with the assumed split (lib/splits.js filledSplits: the rule Add Song fills in for staff). The nightly cron runs it
// (pages/api/cron/daily.js, before the sheet pull, so the pull reads the new rows back); To do's "songs added automatically"
// list (lib/auto-added.js) is where the owner checks each one and presses OK.
//   planAutoAdds  reads only: the songs to add, the ones left out and why, and how many wait for the next run
//   runAutoAdds   adds them: each song is the same placement INSERT as a save of the songs (lib/placement-rows.js) and the same
//                 pub sheet row write as the song editor's push (lib/sheet-push.js, behind pages/api/sheets-push.js: a client's
//                 own tab found or claimed, a full tab given more rows, every write guarded and read back), then remembered in
//                 app_state "autoAdded" ({ [Spotify track id]: { placementId, clientId, at, checked? } }), which is what keeps a
//                 song the owner deletes from coming back. The first thing that goes wrong stops the run and is said in its report
//                 (a song already added stays: like Add Song, a failed sheet write never undoes the site's save).
// A song is one whose catalog row (lib/data/engine.js readCatalogs: data_entities kind 'track', origin 'catalog', its roster
// artist as parent) was released in the last 30 days (New York days), is on no song of the site (its Spotify id in a link, or
// the same ISRC when both are known), was never added by this before, and whose title (version tags, " - Single" and "feat. X" left out) is
// none of that client's songs: those are versions or re-uploads, said in the report and left alone. Oldest release first, 25 a run.
// AUTO_ADD_SONGS=off stops it (default on). Server-only.
import { sql as dbSql } from "./db";
import { claimState, dropState } from "./app-state";
import { filledSplits } from "./splits";
import { baseTitle } from "./duplicates";
import { spotifyId } from "./data/sources";
import { nyDay } from "./todo-rank";
import { findByName, ownerOf } from "./names";
import { uid } from "./id";
import { loadClientTabNames } from "./sheets";
import { placementRow, insertPlacement } from "./placement-rows";
import { pushSongRows } from "./sheet-push";

export const WINDOW_DAYS = 30;
export const MAX_PER_RUN = 25;
const LOCK = "autoAdd:run", LEASE_MIN = 5; // one run at a time; a run that never finished frees it after this long
const SHEET_ENV = ["GOOGLE_SHEETS_CLIENT_EMAIL", "GOOGLE_SHEETS_PRIVATE_KEY", "GOOGLE_SHEET_ID"]; // what Add Song's sheet write needs (lib/sheets.js)

export const autoAddOn = () => !/^(off|false|0|no)$/i.test(String(process.env.AUTO_ADD_SONGS ?? "").trim());

const DAY = 864e5;
const dayNum = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY;
const daysBack = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10);
// the whole days a release is before today; null for a date that isn't a calendar day (Spotify gives "2026-11" or "2026" for old ones)
const ageOf = (today, release) => (/^\d{4}-\d{2}-\d{2}$/.test(String(release || "")) && Number.isFinite(dayNum(release)) ? dayNum(today) - dayNum(release) : null);
// a title as two songs are compared on: no version tags (lib/duplicates.js baseTitle), no " - Single", and no trailing "feat. X" (Spotify's
// "Song (feat. X)" is the site's "Song": its featured artist is on the artist line, and the sheet's own matcher, lib/sheets.js normalizeTitle, reads them as one)
const titleKey = (s) => { const t = baseTitle(String(s || "").replace(/\s+-\s+single\s*$/i, "")); return t.replace(/\s+(feat|ft|featuring)\s+.*$/, "").trim() || t; };
const cleanIsrc = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// -> { add: [{ spotifyId, clientId, clientName, song, artist, releaseDate, link, cover, splits }], skipped: [{ spotifyId, clientId,
// clientName, song, releaseDate, reason }], waiting }. Reads only; `sql` is the database (a test's fake)
export async function planAutoAdds({ now = new Date(), sql = dbSql } = {}) {
  const today = nyDay(now), from = daysBack(today, WINDOW_DAYS);
  const plan = { add: [], skipped: [], waiting: 0 };
  // the roster's artists with a Spotify artist link: the catalog is read for them only
  const roster = (await sql`SELECT id, name, credit, role, sheet_tab_name, spotify FROM clients WHERE on_roster`).filter((c) => spotifyId(c.spotify, "artist"));
  if (!roster.length) return plan;
  const byClient = new Map(roster.map((c) => [c.id, c]));
  const [tracks, placements, tracking, autoAdded] = await Promise.all([
    sql`SELECT id, name, artist, image, release_date, isrc, parent_id FROM data_entities
      WHERE kind = 'track' AND active AND origins @> '["catalog"]'::jsonb AND parent_id = ANY(${roster.map((c) => `a:${c.id}`)}) AND release_date >= ${from}`,
    sql`SELECT id, client_id, song, artist, link FROM placements`,
    sql`SELECT placement_id, isrc FROM song_tracking WHERE isrc <> ''`,
    sql`SELECT value FROM app_state WHERE key = 'autoAdded'`.then((r) => r[0]?.value),
  ]);
  const added = autoAdded && typeof autoAdded === "object" && !Array.isArray(autoAdded) ? autoAdded : {};
  const links = placements.map((p) => String(p.link || ""));
  const siteIsrc = new Set(tracking.map((t) => cleanIsrc(t.isrc)).filter(Boolean));
  // each client's titles: its songs on the site, then the ones this run takes (an original and its slowed version released together
  // are one song for the site, not two cards)
  const titles = new Map();
  const note = (clientId, song) => {
    const k = titleKey(song);
    if (!k) return;
    if (!titles.has(clientId)) titles.set(clientId, new Map());
    if (!titles.get(clientId).has(k)) titles.get(clientId).set(k, String(song).trim());
  };
  for (const p of placements) note(p.client_id, p.song);
  const eligible = [], isrcTaken = new Map();
  // oldest release first (then by title, so the order never depends on what the database returned first)
  const oldestFirst = [...tracks].sort((a, b) => String(a.release_date).localeCompare(String(b.release_date)) || String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)));
  for (const t of oldestFirst) {
    const sid = /^t:([A-Za-z0-9]{22})$/.exec(String(t.id || ""))?.[1];
    const client = byClient.get(String(t.parent_id || "").replace(/^a:/, ""));
    const age = ageOf(today, t.release_date), song = String(t.name || "").trim();
    if (!sid || !client || !song || age == null || age < 0 || age > WINDOW_DAYS) continue;
    // already on the site (its Spotify id in any song's link, or the same ISRC), or added by this before (and maybe deleted since)
    if (added[sid] || links.some((l) => l.includes(sid))) continue;
    const isrc = cleanIsrc(t.isrc);
    if (isrc && siteIsrc.has(isrc)) continue;
    const base = { spotifyId: sid, clientId: client.id, clientName: client.name, song, releaseDate: t.release_date };
    const same = titles.get(client.id)?.get(titleKey(song));
    if (same) { plan.skipped.push({ ...base, reason: `same title as ${same}` }); continue; }
    if (isrc && isrcTaken.has(isrc)) { plan.skipped.push({ ...base, reason: `same ISRC as ${isrcTaken.get(isrc)}` }); continue; }
    // the assumed split, as Add Song fills it in for a new song (components/portal/ClientPortal.jsx startAdd + saveSong): the client's own
    // row at 0%, completed by the owner's rule from the artist line
    const artist = String(t.artist || "").trim() || client.name;
    const splits = filledSplits([{ id: uid(), name: client.name, role: client.role || "", percent: 0 }], { client: { name: client.name, credit: client.credit || "", role: client.role || "" }, artist });
    const own = findByName(splits, client.name);
    if (!own || !(Number(own.percent) > 0) || splits.reduce((a, s) => a + Number(s.percent || 0), 0) !== 100) {
      plan.skipped.push({ ...base, reason: `no assumed split for ${client.name} (${client.role ? `their role is ${client.role}` : "no role is set"})` });
      continue;
    }
    eligible.push({ ...base, artist, link: `https://open.spotify.com/track/${sid}`, cover: /^https?:\/\//i.test(String(t.image || "")) ? String(t.image) : "", splits });
    note(client.id, song);
    if (isrc) isrcTaken.set(isrc, song);
  }
  plan.waiting = Math.max(0, eligible.length - MAX_PER_RUN);
  plan.add = eligible.slice(0, MAX_PER_RUN);
  return plan;
}

// Adds what planAutoAdds plans. -> { added: [{ song, client, spotifyId, placementId, tab, row, tabCreated }], skipped, waiting, error?, alarm? },
// or { off }, { skipped } (the pub sheet isn't set up), { busy } (another run is going). budgetMs: stops starting new songs after this long
// (the cron has 60 seconds in all, and a song is about ten Sheets calls); the rest wait for the next run, counted in `waiting`.
export async function runAutoAdds({ now = new Date(), budgetMs = 15000 } = {}) {
  if (!autoAddOn()) return { off: "AUTO_ADD_SONGS=off" };
  const missing = SHEET_ENV.filter((k) => !String(process.env[k] || "").trim());
  if (missing.length) return { skipped: `The pub sheet isn't set up here (${missing.join(", ")}), so no song was added.` };
  if (!(await claimState(LOCK, LEASE_MIN, { at: new Date().toISOString(), by: "auto-add" }))) return { busy: true };
  try {
    const start = Date.now(), at = new Date(now).toISOString();
    const plan = await planAutoAdds({ now });
    const out = { added: [], skipped: plan.skipped, waiting: plan.waiting };
    if (!plan.add.length) return out;
    // the clients' tab names for the push, and every song's id (the push's liveIds: what the browser sends as the page's own list)
    const [known, live] = await Promise.all([loadClientTabNames(), dbSql`SELECT id FROM placements`.then((r) => new Set(r.map((x) => x.id)))]);
    for (let i = 0; i < plan.add.length; i++) {
      const a = plan.add[i];
      if (Date.now() - start > budgetMs) { out.waiting += plan.add.length - i; break; }
      let step = "adding the song to the site";
      const stop = (why, more = {}) => { console.error(`auto-add: "${a.song}" (${a.clientName}) stopped at ${step}: ${why}`); out.error = { song: a.song, client: a.clientName, spotifyId: a.spotifyId, step, error: why, ...more }; return out; };
      try {
        const c = known.find((x) => x.id === a.clientId);
        if (!c) return stop("the client isn't on the site any more");
        const id = uid();
        // Add Song's own INSERT of a song (a save of the songs, pages/api/dashboard-data.js), for this one song
        await insertPlacement(placementRow({ id, clientId: a.clientId, song: a.song, artist: a.artist, releaseDate: a.releaseDate, link: a.link, cover: a.cover, notable: false, luminateId: "", splits: a.splits }));
        live.add(id);
        step = "writing its row on the pub sheet";
        // the song as the site holds it, and only the client's own share goes to the sheet, under the name of their tab (ClientPortal.jsx pushShare)
        const [saved] = await dbSql`SELECT client_id, splits FROM placements WHERE id = ${id}`;
        const mine = saved && findByName(saved.splits || [], c.name);
        if (!mine) return stop("the song's split has no share for the client");
        const res = await pushSongRows({ placementId: id, song: a.song, artist: a.artist, luminateId: "", splits: [{ name: c.sheet_tab_name || c.name, percent: mine.percent }], liveIds: [...live],
          saved, known, whose: (name) => ownerOf(known, name, saved.client_id), by: "the nightly auto-add" });
        if (res.status !== 200) return stop(res.body?.error || `The pub sheet write answered ${res.status}.`, { refused: !!res.body?.refused, written: !!res.body?.written });
        step = "remembering it";
        await dbSql`INSERT INTO app_state (key, value, updated_at) VALUES ('autoAdded', jsonb_build_object(${a.spotifyId}::text, ${JSON.stringify({ placementId: id, clientId: a.clientId, at })}::jsonb), now())
          ON CONFLICT (key) DO UPDATE SET value = app_state.value || EXCLUDED.value, updated_at = now()`;
        const r0 = res.body.results?.[0] || {};
        out.added.push({ song: a.song, client: a.clientName, spotifyId: a.spotifyId, placementId: id, tab: r0.tab, row: r0.row, tabCreated: !!r0.tabCreated });
        // a formula that changed with the write is said loudly, and nothing more is written tonight
        if (res.body.alarm) { out.alarm = res.body.alarm; console.error(`auto-add: ${res.body.alarm}`); break; }
      } catch (err) {
        const back = err?.readBack;
        return stop(String(err?.message || err).slice(0, 300), back ? { checked: true, ...(back.ok ? {} : { alarm: back.alarm }) } : {});
      }
    }
    return out;
  } finally { await dropState(LOCK).catch(() => {}); }
}
