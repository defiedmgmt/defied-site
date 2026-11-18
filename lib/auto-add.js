// (2026-11-17, the owner: "the new songs can go on the pub sheet w the assumed splits and i can go back and update it if
// necessary") A roster artist's new Spotify release goes on the site and on the pub sheet by itself, the way Add Song puts it
// there, with the assumed split (lib/splits.js filledSplits: the rule Add Song fills in for staff). The nightly cron runs it
// (pages/api/cron/daily.js, before the sheet pull, so the pull reads the new rows back); To do's "songs added automatically"
// list (lib/auto-added.js) is where the owner checks each one and presses OK.
//   planAutoAdds  reads only: the songs to add, the ones left out and why, and how many wait for the next run
//   runAutoAdds   adds them: each song is the same placement INSERT as a save of the songs (lib/placement-rows.js) and the same
//                 pub sheet row write as the song editor's push (lib/sheet-push.js, behind pages/api/sheets-push.js: a client's
//                 own tab found or claimed, a full tab given more rows, every write guarded and read back), then remembered in
//                 app_state "autoAdded" ({ [Spotify track id]: { placementId, clientId, at, checked?, pending? } }), which is what
//                 keeps a song the owner deletes from coming back. The first thing that goes wrong stops the run and is said in its report
//                 (a song already added stays: like Add Song, a failed sheet write never undoes the site's save).
// (2026-11-18) Half-added songs finish. On Nov 18 the 9th song's row hit Google's per-minute Sheets quota: its card was on the site, with no row on the pub sheet
// and no record here, so every later run saw "on the site" and nobody would ever have written the row. Now a song is remembered as PENDING ({ pending: true })
// right after its INSERT and before its sheet write, and remembered again without it once the row is written. Every run starts with the pending ones (the same
// push of the client's own share, the assumed split already on the card) before it plans new songs, and To do's "added automatically" list leaves a pending
// one out until then (lib/auto-added.js): it is not on the pub sheet yet, and Songs to update already says so.
// (2026-11-18) A run spends at most MAX_READS of Google's 60 Sheets reads a minute (the dashboard, the other crons and the other sheets share them):
// pushSongRows costs READS_PER_SONG a song (tests/fix-1118.mjs counts them on a fake Sheets client and fails if this number goes stale), so a run writes at most
// five rows; the rest wait for the next night, counted in `waiting`. The cron runs it last (pages/api/cron/daily.js), after the steps that must have the quota.
// A song is one whose catalog row (lib/data/engine.js readCatalogs: data_entities kind 'track', origin 'catalog', its roster
// artist as parent) was released in the last 30 days (New York days), is on no song of the site (its Spotify id in a link, or
// the same ISRC when both are known), was never added by this before, and whose title (version tags, " - Single" and "feat. X" left out) is
// none of that client's songs: those are versions or re-uploads, said in the report and left alone. Oldest release first, 25 a run.
// AUTO_ADD_SONGS=off stops it (default on). Server-only.
// (2026-11-18) addOneSong is one song's add, the loop body of runAutoAdds, and addSong is the same for one song at a time: Possible placements
// (lib/credits/add.js) adds a song when a Publishing staff member presses Add on it, by the same path and with the same assumed split. Nothing in
// lib/credits ever calls either one by itself: what the credits scan finds only appears in To do.
import { sql as dbSql } from "./db";
import { claimState, dropState, getState } from "./app-state";
import { filledSplits } from "./splits";
import { titleKey } from "./duplicates";
import { spotifyId } from "./data/sources";
import { nyDay } from "./todo-rank";
import { findByName, ownerOf } from "./names";
import { uid } from "./id";
import { loadClientTabNames } from "./sheets";
import { placementRow, insertPlacement } from "./placement-rows";
import { pushSongRows } from "./sheet-push";
import { pendingAutoAdds } from "./auto-added";

export const WINDOW_DAYS = 30;
export const MAX_PER_RUN = 25;
// Sheets reads of ONE song through lib/sheet-push.js pushSongRows on a client's own tab, a row to add: the tab list, the Site Sync ID column, the title column
// (twice: the title match and the first empty row), the whole tab as formulas before the write and the same again after it. A run stops starting songs
// when that many more would take it past MAX_READS (Google allows 60 reads a minute to this account, shared with everything else that reads the sheets)
export const READS_PER_SONG = 7;
export const MAX_READS = 40;
const LOCK = "autoAdd:run", LEASE_MIN = 5; // one run at a time; a run that never finished frees it after this long
const SHEET_ENV = ["GOOGLE_SHEETS_CLIENT_EMAIL", "GOOGLE_SHEETS_PRIVATE_KEY", "GOOGLE_SHEET_ID"]; // what Add Song's sheet write needs (lib/sheets.js)

export const autoAddOn = () => !/^(off|false|0|no)$/i.test(String(process.env.AUTO_ADD_SONGS ?? "").trim());

const DAY = 864e5;
const dayNum = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY;
const daysBack = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10);
// the whole days a release is before today; null for a date that isn't a calendar day (Spotify gives "2026-11" or "2026" for old ones)
const ageOf = (today, release) => (/^\d{4}-\d{2}-\d{2}$/.test(String(release || "")) && Number.isFinite(dayNum(release)) ? dayNum(today) - dayNum(release) : null);
// a title as two songs are compared on: lib/duplicates.js titleKey (version tags, " - Single" and a trailing "feat. X" left out)
const cleanIsrc = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// The assumed split Add Song fills in for a new song: the client's own row at 0%, completed by the owner's rule from the artist line
// (lib/splits.js filledSplits). `others`: the other producers credited on the song (lib/credits), named beside the client so the producer side divides
// among them the way the rule does for a song typed in with them listed; the plan itself never has any. The split, or null when the rule can't give
// the client a share of a split that adds up to 100 (then the same split without `others` is tried)
export function assumedSplit(client, artist, others = []) {
  const make = (names) => filledSplits([{ id: uid(), name: client.name, role: client.role || "", percent: 0 }, ...names.map((n) => ({ id: uid(), name: n, role: "Producer", percent: 0 }))],
    { client: { name: client.name, credit: client.credit || "", role: client.role || "" }, artist });
  const fits = (splits) => { const own = findByName(splits, client.name); return own && Number(own.percent) > 0 && splits.reduce((a, s) => a + Number(s.percent || 0), 0) === 100 ? splits : null; };
  return (others.length && fits(make(others))) || fits(make([]));
}

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
    // the assumed split, as Add Song fills it in for a new song (components/portal/ClientPortal.jsx startAdd + saveSong)
    const artist = String(t.artist || "").trim() || client.name;
    const splits = assumedSplit(client, artist);
    if (!splits) {
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

// app_state "autoAdded": this song's entry as a whole (a key written again replaces its entry, every other key stays as it is)
const remember = (key, entry) => dbSql`INSERT INTO app_state (key, value, updated_at) VALUES ('autoAdded', jsonb_build_object(${key}::text, ${JSON.stringify(entry)}::jsonb), now())
  ON CONFLICT (key) DO UPDATE SET value = app_state.value || EXCLUDED.value, updated_at = now()`;
// a thrown error as [its words, what is known of the write]: Google refusing a call carries the read-back of the write (err.readBack)
const caught = (err) => { const back = err?.readBack; return [String(err?.message || err).slice(0, 300), back ? { checked: true, ...(back.ok ? {} : { alarm: back.alarm }) } : {}]; };

// A song's row on its client's own tab of the pub sheet (lib/sheet-push.js pushSongRows, as the song editor's push does it): the song as the site holds it
// (saved: { client_id, splits }), and only the client's own share goes, under the name of their tab (ClientPortal.jsx pushShare). c: the client (a row of
// known). -> { res } (the push's answer, status 200) or { fail: why, more? }
async function writeRow({ id, song, artist, saved, c, known, live, by }) {
  const mine = saved && findByName(saved.splits || [], c.name);
  if (!mine) return { fail: "the song's split has no share for the client" };
  const res = await pushSongRows({ placementId: id, song, artist, luminateId: "", splits: [{ name: c.sheet_tab_name || c.name, percent: mine.percent }], liveIds: [...live],
    saved, known, whose: (name) => ownerOf(known, name, saved.client_id), by });
  if (res.status !== 200) return { fail: res.body?.error || `The pub sheet write answered ${res.status}.`, more: { refused: !!res.body?.refused, written: !!res.body?.written } };
  return { res };
}

// One song onto the site and the pub sheet, the way Add Song does it: the placement INSERT (lib/placement-rows.js, as a save of the songs), then it is remembered in
// app_state "autoAdded" as PENDING (2026-11-18), then its row on the client's own tab (lib/sheet-push.js, as the song editor's push), then it is remembered again,
// no longer pending, so To do lists it for a check. A write that fails leaves it pending: the next run finishes it (runAutoAdds). The nightly run below and
// Possible placements' Add button (addSong) both come through here. a: one entry of planAutoAdds' `add` list (a.rememberAs: the key it is remembered under, the
// Spotify track id when it has none: a song added for two clients on one release can't share one key); known and live: lib/sheets.js loadClientTabNames and the ids
// of the site's songs (each one made is added to live); at: the time it's remembered with; by: who is writing, for the tab lock's note.
// -> { added: { song, client, spotifyId, placementId, tab, row, tabCreated }, alarm? }, or { fail: { step, error, more } }: the first thing that went wrong (a song
// already inserted stays, like Add Song: a failed sheet write never undoes the site's save)
export async function addOneSong(a, { known, live, at, by = "the nightly auto-add" }) {
  let step = "adding the song to the site";
  const fail = (error, more = {}) => ({ fail: { step, error, more } });
  try {
    const c = known.find((x) => x.id === a.clientId);
    if (!c) return fail("the client isn't on the site any more");
    const id = uid(), key = a.rememberAs || a.spotifyId;
    // Add Song's own INSERT of a song (a save of the songs, pages/api/dashboard-data.js), for this one song
    await insertPlacement(placementRow({ id, clientId: a.clientId, song: a.song, artist: a.artist, releaseDate: a.releaseDate, link: a.link, cover: a.cover, notable: false, luminateId: "", splits: a.splits }));
    live.add(id);
    // pending first, so a sheet write that can't be made (Google's quota, a refusal) leaves a note for the next run instead of a song nobody will finish
    step = "remembering it";
    await remember(key, { placementId: id, clientId: a.clientId, at, pending: true });
    step = "writing its row on the pub sheet";
    const [saved] = await dbSql`SELECT client_id, splits FROM placements WHERE id = ${id}`;
    const w = await writeRow({ id, song: a.song, artist: a.artist, saved, c, known, live, by });
    if (w.fail) return fail(w.fail, w.more);
    step = "remembering it";
    await remember(key, { placementId: id, clientId: a.clientId, at });
    const r0 = w.res.body.results?.[0] || {};
    // a formula that changed with the write comes back as `alarm`: said loudly by the caller
    return { added: { song: a.song, client: a.clientName, spotifyId: a.spotifyId, placementId: id, tab: r0.tab, row: r0.row, tabCreated: !!r0.tabCreated }, ...(w.res.body.alarm ? { alarm: w.res.body.alarm } : {}) };
  } catch (err) {
    return fail(...caught(err));
  }
}

// One PENDING song's row, the pub sheet write an earlier run (or an Add button) was stopped before: the same push as addOneSong's, of the client's own share in the
// split the card holds now (the assumed one, unless someone edited it), then the entry again without `pending`. e: its entry (pendingAutoAdds), p: its card as the
// site holds it ({ id, client_id, song, artist, splits }). -> { finished: { song, client, spotifyId, placementId, tab, row, tabCreated }, alarm? } or { fail: { step, error, more } }
async function finishOne(e, p, { known, live, by }) {
  let step = "writing its row on the pub sheet";
  const fail = (error, more = {}) => ({ fail: { step, error, more } });
  try {
    const c = known.find((x) => x.id === p.client_id);
    if (!c) return fail("the client isn't on the site any more");
    const w = await writeRow({ id: p.id, song: p.song, artist: p.artist, saved: { client_id: p.client_id, splits: p.splits }, c, known, live, by });
    if (w.fail) return fail(w.fail, w.more);
    step = "remembering it";
    await remember(e.key, { placementId: p.id, clientId: e.clientId || p.client_id, at: e.at });
    const r0 = w.res.body.results?.[0] || {};
    return { finished: { song: p.song, client: c.name, spotifyId: e.key, placementId: p.id, tab: r0.tab, row: r0.row, tabCreated: !!r0.tabCreated }, ...(w.res.body.alarm ? { alarm: w.res.body.alarm } : {}) };
  } catch (err) {
    return fail(...caught(err));
  }
}

// Finishes what is pending, then adds what planAutoAdds plans. -> { added: [{ song, client, spotifyId, placementId, tab, row, tabCreated }], skipped, waiting, finished?, error?, alarm? },
// or { off }, { skipped } (the pub sheet isn't set up), { busy } (another run is going). `finished`: the pending songs whose row this run wrote (same fields as `added`).
// budgetMs: stops starting new songs after this long (the cron has 60 seconds in all, and a song is about eight Sheets calls); the rest wait for the next run, counted in
// `waiting`. A run also stops starting songs once another would take its estimated Sheets reads past MAX_READS (READS_PER_SONG a song, pending ones too): same.
export async function runAutoAdds({ now = new Date(), budgetMs = 15000 } = {}) {
  if (!autoAddOn()) return { off: "AUTO_ADD_SONGS=off" };
  const missing = SHEET_ENV.filter((k) => !String(process.env[k] || "").trim());
  if (missing.length) return { skipped: `The pub sheet isn't set up here (${missing.join(", ")}), so no song was added.` };
  if (!(await claimState(LOCK, LEASE_MIN, { at: new Date().toISOString(), by: "auto-add" }))) return { busy: true };
  try {
    const start = Date.now(), at = new Date(now).toISOString(), by = "the nightly auto-add";
    const out = { added: [], skipped: [], waiting: 0 };
    let reads = 0, world = null;
    // the clients' tab names for the push, and every song's id (the push's liveIds: what the browser sends as the page's own list): read once, and only when a row is to be written
    const load = async () => world || (world = await Promise.all([loadClientTabNames(), dbSql`SELECT id FROM placements`.then((r) => new Set(r.map((x) => x.id)))]));
    const spent = () => Date.now() - start > budgetMs || reads + READS_PER_SONG > MAX_READS; // no time, or no Sheets reads, left for one more song
    const stopped = (who, f) => {
      console.error(`auto-add: "${who.song}" (${who.client}) stopped at ${f.step}: ${f.error}`);
      out.error = { song: who.song, client: who.client, spotifyId: who.spotifyId, step: f.step, error: f.error, ...f.more };
      return out;
    };
    // 1. the pending songs first: on the site, their row not on the pub sheet yet. What can't be finished tonight (no time, no reads left) stays pending
    const pending = pendingAutoAdds(await getState("autoAdded"));
    if (pending.length) {
      const [known, live] = await load();
      const cards = await dbSql`SELECT id, client_id, song, artist, splits FROM placements WHERE id = ANY(${pending.map((e) => e.placementId)})`;
      for (const e of pending) {
        if (spent()) break;
        const p = cards.find((x) => x.id === e.placementId);
        // the card was deleted since: there is no row to write; the entry stays, no longer pending, so the song is never added again
        if (!p) { await remember(e.key, { placementId: e.placementId, clientId: e.clientId, at: e.at }); continue; }
        const r = await finishOne(e, p, { known, live, by });
        reads += READS_PER_SONG;
        if (r.fail) return stopped({ song: p.song, client: known.find((x) => x.id === p.client_id)?.name || "", spotifyId: e.key }, r.fail);
        (out.finished ||= []).push(r.finished);
        if (r.alarm) { out.alarm = r.alarm; console.error(`auto-add: ${r.alarm}`); return out; } // a formula that changed with the write: nothing more is written tonight
      }
    }
    // 2. the new songs
    const plan = await planAutoAdds({ now });
    out.skipped = plan.skipped;
    out.waiting = plan.waiting;
    if (!plan.add.length) return out;
    const [known, live] = await load();
    for (let i = 0; i < plan.add.length; i++) {
      const a = plan.add[i];
      if (spent()) { out.waiting += plan.add.length - i; break; }
      const r = await addOneSong(a, { known, live, at, by });
      reads += READS_PER_SONG;
      if (r.fail) return stopped({ song: a.song, client: a.clientName, spotifyId: a.spotifyId }, r.fail);
      out.added.push(r.added);
      // a formula that changed with the write is said loudly, and nothing more is written tonight
      if (r.alarm) { out.alarm = r.alarm; console.error(`auto-add: ${r.alarm}`); break; }
    }
    return out;
  } finally { await dropState(LOCK).catch(() => {}); }
}

// One song, now: a Publishing staff member pressed Add on a possible placement (lib/credits/add.js). The same add as the run above, one at a time with it
// (the same lock), whatever AUTO_ADD_SONGS says (that switch is for what happens by itself). a: as in addOneSong. -> addOneSong's answer, or { skipped } (the pub
// sheet isn't set up here), { busy } (the nightly run, or another Add, is writing)
export async function addSong(a, { now = new Date(), by = "an Add button" } = {}) {
  const missing = SHEET_ENV.filter((k) => !String(process.env[k] || "").trim());
  if (missing.length) return { skipped: `The pub sheet isn't set up here (${missing.join(", ")}), so no song was added.` };
  if (!(await claimState(LOCK, LEASE_MIN, { at: new Date().toISOString(), by }))) return { busy: true };
  try {
    const [known, live] = await Promise.all([loadClientTabNames(), dbSql`SELECT id FROM placements`.then((r) => new Set(r.map((x) => x.id)))]);
    return await addOneSong(a, { known, live, at: new Date(now).toISOString(), by });
  } finally { await dropState(LOCK).catch(() => {}); }
}
