// Each song's extra facts (lib/song-info.js): GET returns them; POST takes one { action, ... }: an ISRC
// typed in or picked, the ISRC finder run on a few songs, "This isn't ours", "Not the same song", and
// (2026-11-17) "Not on streaming" for one song and "OK" on a song added automatically (lib/auto-add.js), and
// (2026-11-18) "Add" and "Not ours" on a possible placement (lib/credits/add.js: the only way one becomes a song).
// Publishing only. (Luminate's page had these until list B #3; the ISRC lookups stayed.)
import { sql } from "../../lib/db";
import { requireSameOrigin } from "../../lib/session";
import { requireAccess, mayUseClient } from "../../lib/access";
import { songInfoState } from "../../lib/song-info";
import { lookupIsrc, cleanIsrc, ISRC_RE, SOURCES } from "../../lib/isrc";
import { normalizeTitle } from "../../lib/sheets";
import { afterAction } from "../../lib/area-tasks";
import { scheduleAAfterSave, settleWithin, SAVE_WAIT_MS } from "../../lib/schedule-a";
import { hitLink } from "../../lib/isrc-nightly";

const newId = () => Math.random().toString(36).slice(2, 10);
// the ISRC finder can take a few seconds a song (four services, each at its own pace): a call does
// what fits in this budget and says which songs are left (later: true) for the page to send again
export const config = { maxDuration: 60 };
const FIND_BUDGET_MS = 40000;
// what the finder offered for one song's ids, or [] to clear them (isrc_candidates; none before its migration)
const saveCandidates = (ids, p, list) => (list.length
  ? ids.map((id) => sql`INSERT INTO isrc_candidates (item, song, artist, candidates, checked_at) VALUES (${id}, ${p.song}, ${p.artist}, ${JSON.stringify(list)}, now())
      ON CONFLICT (item) DO UPDATE SET song = EXCLUDED.song, artist = EXCLUDED.artist, candidates = EXCLUDED.candidates, checked_at = now()`)
  : [sql`DELETE FROM isrc_candidates WHERE item = ANY(${ids})`]);
const clearCandidates = (ids) => sql`DELETE FROM isrc_candidates WHERE item = ANY(${ids})`.catch((err) => { if (err?.code !== "42P01") throw err; });
const ids = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x).slice(0, 500) : []);
// (2026-11-23) the Schedule A sheet shows each song's ISRC and link: a change to one is marked and run the way a save of the songs does it
// (lib/schedule-a.js scheduleAAfterSave: off with no sheet, at most one run in 2 minutes, never throws), and waited for 2 seconds at the most
const touchScheduleA = () => settleWithin(scheduleAAfterSave(), SAVE_WAIT_MS);
const upsertTracking = (id, set) => sql`
  INSERT INTO song_tracking (placement_id, isrc, isrc_source, isrc_checked_at, updated_at)
  VALUES (${id}, ${set.isrc ?? ""}, ${set.isrc_source ?? ""}, ${set.isrc_checked_at ?? null}, now())
  ON CONFLICT (placement_id) DO UPDATE SET
    isrc = CASE WHEN ${"isrc" in set} THEN EXCLUDED.isrc ELSE song_tracking.isrc END,
    isrc_source = CASE WHEN ${"isrc" in set} THEN EXCLUDED.isrc_source ELSE song_tracking.isrc_source END,
    isrc_checked_at = CASE WHEN ${"isrc_checked_at" in set} THEN EXCLUDED.isrc_checked_at ELSE song_tracking.isrc_checked_at END,
    updated_at = now()
`;
// (2026-11-17) "Not on streaming" = song_tracking.skip: taken down, unreleased, or only on SoundCloud/TikTok, so the song has no
// release date or link to find and no ISRC to look up. Only the flag is written (the ISRC columns stay as they are). No foreign key
// ties this row to the song (db/migrations/001), so a save of the songs, which rewrites them, leaves the flag alone.
const setSkip = (id, on) => sql`
  INSERT INTO song_tracking (placement_id, skip, updated_at) VALUES (${id}, ${on}, now())
  ON CONFLICT (placement_id) DO UPDATE SET skip = EXCLUDED.skip, updated_at = now()
`;
// One song's own flag, so it is checked song by song, by the rule that decides who may change the song (the same as
// pages/api/sheets-push.js): staff with Publishing (done by the route), an account limited to its own artists only theirs,
// and a client session only its own client's songs. Several ids at once (the same song on more than one page) all have to pass.
async function setNotOnStreaming(body, { req, session }) {
  const list = [...new Set(ids(body.placementIds))];
  if (!list.length) return [400, { error: "Pick the song first." }];
  if (typeof body.notOnStreaming !== "boolean") return [400, { error: "Say whether the song is on streaming." }];
  const isStaff = session.user.role === "staff";
  const rows = await sql`SELECT id, client_id FROM placements WHERE id = ANY(${list})`;
  if (rows.some((p) => (isStaff ? !mayUseClient(req, p.client_id) : p.client_id !== session.user.clientId))) {
    return [403, { error: isStaff ? "That song isn't one of your artists'." : "That isn't one of your songs." }];
  }
  // a song that was deleted meanwhile has nothing to mark
  if (rows.length !== list.length) return [404, { error: "That song isn't on the site any more. Reload the page and try again." }];
  await sql.transaction(list.map((id) => setSkip(id, body.notOnStreaming)));
  return [200, { ok: true, notOnStreaming: body.notOnStreaming }];
}

// (2026-11-17) "OK" on To do's "songs added automatically" list: that song's entry in app_state autoAdded gets checked: true. One statement
// per song, each changing only its own key inside the stored object (jsonb_set), so two people pressing OK at once, or a night's run
// adding more songs, never undo each other; a key that isn't there (or isn't an object) is left alone, so nothing is made up
const checkAutoAdded = (id) => sql`
  UPDATE app_state SET value = jsonb_set(value, ARRAY[${id}::text, 'checked'], 'true'::jsonb), updated_at = now()
  WHERE key = 'autoAdded' AND jsonb_typeof(value -> ${id}::text) = 'object'
`;

async function act(body, ctx) {
  const { action } = body;
  if (action === "notOnStreaming") return setNotOnStreaming(body, ctx);
  // (2026-11-18) a possible placement from the credits scan (lib/credits): Add puts it on the site and the pub sheet with the assumed split, Not ours keeps it
  // from ever being suggested again. The same permission as OK below: Publishing staff, not an account limited to its own artists (the list is every artist's)
  // (loaded when used: Add reaches the pub sheet's code, which the rest of this route never needs)
  if (action === "possibleAdd") return (await import("../../lib/credits/add")).addPossible({ key: body.key, by: ctx.session?.user?.name || ctx.session?.user?.email || "" });
  if (action === "possibleNotOurs") return (await import("../../lib/credits/add")).dismissPossible({ key: body.key });
  if (action === "autoChecked") {
    // the Spotify track ids that key autoAdded (22 letters and digits; a song added for a second client on one release is "<id>:<client id>")
    const list = [...new Set(ids(body.ids).filter((x) => /^[A-Za-z0-9]{22}(?::[A-Za-z0-9_-]{1,40})?$/.test(x)))];
    if (!list.length) return [400, { error: "Pick the song first." }];
    await sql.transaction(list.map(checkAutoAdded));
    return [200, { ok: true }];
  }
  if (action === "setIsrc") {
    const isrc = cleanIsrc(body.isrc);
    if (isrc && !ISRC_RE.test(isrc)) return [400, { error: "An ISRC is 12 letters and numbers, like USUM72506269." }];
    await sql.transaction(ids(body.placementIds).map((id) => upsertTracking(id, { isrc, isrc_source: isrc ? "manual" : "", isrc_checked_at: new Date().toISOString() })));
    await clearCandidates(ids(body.placementIds));
    await touchScheduleA();
    return [200, { ok: true, isrc }];
  }  if (action === "pickIsrc") {
    // one tap on a candidate the finder offered: saved with the source it came from
    const isrc = cleanIsrc(body.isrc);
    const source = Object.hasOwn(SOURCES, body.source) && body.source !== "manual" ? body.source : null;
    if (!ISRC_RE.test(isrc) || !source) return [400, { error: "Pick one of the songs offered." }];
    const list = ids(body.placementIds);
    if (!list.length) return [400, { error: "Pick the song first." }];
    await sql.transaction(list.map((id) => upsertTracking(id, { isrc, isrc_source: source, isrc_checked_at: new Date().toISOString() })));
    await clearCandidates(list);
    await touchScheduleA();
    return [200, { ok: true, isrc, source }];
  }  if (action === "findIsrcs") {
    // groups: [[ids of one song across clients' pages], …]. A sure hit is saved (with its source); else
    // up to 3 candidates are kept for one-tap picking (pickIsrc). A service that's down saves nothing.
    const groups = (Array.isArray(body.groups) ? body.groups : []).map(ids).filter((g) => g.length).slice(0, 8);
    const all = groups.flat();
    const songs = Object.fromEntries((await sql`SELECT id, song, artist, link FROM placements WHERE id = ANY(${all})`).map((p) => [p.id, p]));
    const results = {}, start = Date.now();
    let saved = false;
    for (const g of groups) {
      const p = songs[g[0]];
      if (!p) continue;
      if (Date.now() - start > FIND_BUDGET_MS) { results[g[0]] = { later: true }; continue; }
      let r;
      try { r = await lookupIsrc({ song: p.song, artist: p.artist, link: p.link }); } catch (err) { results[g[0]] = { error: err.message }; continue; }
      if (r.failed) { results[g[0]] = { error: r.errors[0]?.message || "The lookup failed" }; continue; } // try again later, nothing saved
      if (r.retry) { results[g[0]] = { error: "Spotify didn't answer, so nothing was saved. Try again in a few minutes." }; continue; }
      const at = new Date().toISOString();
      const q = g.map((id) => upsertTracking(id, r.hit ? { isrc: r.hit.isrc, isrc_source: r.hit.source, isrc_checked_at: at } : { isrc_checked_at: at }));
      await sql.transaction(q);
      // (2026-11-23) a sure hit that is on Spotify is also the link of the songs of this group that have none (lib/isrc-nightly.js, as the nightly run does it)
      const linkIds = g.filter((id) => songs[id] && !songs[id].link);
      const link = r.hit && linkIds.length ? await hitLink({ hit: r.hit, song: p.song, artist: p.artist }) : "";
      if (link) await sql`UPDATE placements SET link = ${link} WHERE id = ANY(${linkIds}) AND COALESCE(link, '') = ''`;
      if (r.hit) saved = true;
      await Promise.all(saveCandidates(g, p, r.hit ? [] : r.candidates)).catch((err) => { if (err?.code !== "42P01") throw err; });
      results[g[0]] = r.hit
        ? { isrc: r.hit.isrc, match: "exact", source: r.hit.source, title: r.hit.title, artist: r.hit.artist, cover: r.hit.cover }
        : { notFound: !r.candidates.length, candidates: r.candidates };
    }
    if (saved) await touchScheduleA();
    return [200, { results }];
  }  if (action === "notDuplicate") {
    // "Not the same song" on the merge card (build H1): the pair is kept in app_state so it's never asked about
    // again. Added to what's there in one statement, so two staff answering at once both stay
    const pair = ids(body.ids).map((x) => x.slice(0, 40));
    if (pair.length !== 2 || pair[0] === pair[1]) return [400, { error: "Two different songs are needed." }];
    const key = [...pair].sort().join("|");
    await sql`INSERT INTO app_state (key, value, updated_at) VALUES ('notDuplicates', jsonb_build_object(${key}::text, now()), now())
      ON CONFLICT (key) DO UPDATE SET value = app_state.value || EXCLUDED.value, updated_at = now()`;
    return [200, { ok: true }];
  }  if (action === "notOurs") {
    // "This isn't ours": noted once per client + title (with its old Luminate id when it had one), so
    // the sheet sync never brings it back
    const song = String(body.song || "").trim().slice(0, 300);
    const key = normalizeTitle(song);
    const lumId = String(body.luminateId || "").trim().slice(0, 80);
    const clientId = String(body.clientId || "").trim().slice(0, 40) || null;
    if (!key && !lumId) return [400, { error: "Missing the song's title." }];
    // a client's song: that client + title only (the same Luminate id on another client's page is that
    // client's own note). A Luminate-only song: its id, or its title when it has none
    const [cur] = clientId
      ? await sql`SELECT id FROM not_ours WHERE client_id = ${clientId} AND song_key = ${key} LIMIT 1`
      : await sql`
        SELECT id FROM not_ours WHERE client_id IS NULL AND (CASE WHEN ${!!lumId} THEN luminate_id = ${lumId} ELSE song_key = ${key} END) LIMIT 1
      `;
    const q = [cur
      ? sql`UPDATE not_ours SET luminate_id = coalesce(nullif(${lumId}, ''), luminate_id), placement_id = coalesce(${body.placementId || null}, placement_id) WHERE id = ${cur.id}`
      : sql`INSERT INTO not_ours (id, client_id, song, song_key, artist, luminate_id, placement_id)
          VALUES (${newId()}, ${clientId}, ${song || lumId}, ${key}, ${String(body.artist || "").slice(0, 300)}, ${lumId || null}, ${body.placementId ? String(body.placementId).slice(0, 40) : null})`];
    await sql.transaction(q);
    return [200, { ok: true }];
  }  return [400, { error: "Unknown action." }];
}

export default async function handler(req, res) {
  // every artist's songs at once (as the old Luminate route was): an account limited to its own artists is refused.
  // (2026-11-17) Except "Not on streaming": one song's own flag, which the song editor sets for its client (a client session)
  // and for an account limited to its own artists, each checked song by song in setNotOnStreaming
  const own = req.method === "POST" && req.body?.action === "notOnStreaming";
  const session = await requireAccess(req, res, "publishing", own ? { clients: true } : { whole: true });
  if (!session) return;
  try {
    if (req.method === "GET") return res.status(200).json(await songInfoState());
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    if (!requireSameOrigin(req, res)) return;
    const [status, json] = await act(req.body || {}, { req, session });
    // the Publishing ClickUp task follows what just changed (CLICKUP_TASK_WRITES only; a client's own change waits for the nightly run)
    if (status === 200 && session.user.role === "staff") await afterAction(["publishing"]);
    return res.status(status).json(json);
  } catch (err) {
    console.error("songs route failed:", err);
    return res.status(502).json({ error: err.message || "Something went wrong — nothing else was changed." });
  }
}
