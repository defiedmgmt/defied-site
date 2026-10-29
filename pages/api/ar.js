// Staff-only A&R data from Postgres alone: the board can draw from this first, and it keeps working
// while the pub sheet can't be read. GET = every prospect with its follow-up, socials and tracked
// songs (?summary=1: the counts for the sidebar badge and the Dashboard's tasks; ?events=<id>: one
// prospect's History for the panel, newest first). GET also carries the Watchlist: tracked artists and
// songs (ar_tracked), each A&R portfolio's newest export (arLists, streams only) and who matches which
// row (watch, sorted by week-on-week %, with Summary's top lists) and who you added that no A&R list
// has yet (toLuminate; ?summary=1 carries it too, for the Dashboard). POST takes one {action} that never touches the sheet. Pub-sheet changes go through
// /api/ar-write; tracked artists and songs are saved here alone, so they can never reach the sheet.
import { sql } from "../../lib/db";
import { requireStaff, requireSameOrigin } from "../../lib/session";
import { arSummary, arWatchNow, mergeProspect, trackedOut, checkTracked, ArError } from "../../lib/ar";
import { uid } from "../../lib/id";

// the panel's History: plain sentences only (the cells stay server-side); pending ones are left out
// until the next load settles them
const UNDOABLE = ["edit", "status", "contact", "song", "given", "undo"];
async function eventsOf(prospectId) {
  const rows = await sql`SELECT id, at, by, kind, text, status FROM ar_events WHERE prospect_id = ${prospectId} AND status <> 'pending' ORDER BY at DESC LIMIT 40`;
  // nothing from before a merge offers Undo: those cells may be the other record's (the server refuses it too)
  let merged = false;
  return rows.map((e) => {
    const out = { id: e.id, at: e.at, by: e.by, kind: e.kind, text: e.text, status: e.status, undoable: !merged && e.status === "done" && UNDOABLE.includes(e.kind) };
    if (e.kind === "merge") merged = true;
    return out;
  });
}

const STAGE_WORDS = { reach: "To reach out", reached: "Reached out", talking: "Talking", offer: "Offer sent", signed: "Signed", passed: "Passed" };
const event = (id, by, kind, text) => sql`INSERT INTO ar_events (id, prospect_id, by, kind, text) VALUES (${uid()}, ${id}, ${by}, ${kind}, ${text})`;
const trackedRow = async (id) => {
  const [t] = await sql`SELECT *, last_contact::text AS last_contact_day, follow_up::text AS follow_up_day FROM ar_tracked WHERE id = ${id} AND removed_at IS NULL`;
  if (!t) throw new ArError(404, "That one was removed somewhere else. Reload to see the latest.");
  return t;
};
// (ar_events.prospect_id holds the tracked row's id for these: History reads them the same way)
async function trackedAct(action, b, by) {
  if (action === "addTracked") {
    const v = checkTracked(b, { isNew: true }), id = uid();
    await sql`INSERT INTO ar_tracked (id, kind, name, artist, handle, spotify, isrc, genre, notes, luminate_id, person_id, stage, last_contact, created_by)
      VALUES (${id}, ${v.kind}, ${v.name}, ${v.artist}, ${v.handle}, ${v.spotify}, ${v.isrc}, ${v.genre}, ${v.notes}, ${v.luminateId}, ${v.personId ?? null}, ${v.stage ?? null}, ${v.lastContact || null}, ${by})`;
    await event(id, by, "created", `${by} added ${v.name} to the Watchlist.`);
    return { ok: true, tracked: trackedOut(await trackedRow(id)) };
  }
  const t = await trackedRow(String(b.id || ""));
  if (action === "editTracked") {
    const v = checkTracked(b, { isNew: false });
    const c = (k, col) => (v[k] !== undefined ? v[k] : t[col]);
    await sql`UPDATE ar_tracked SET name = ${c("name", "name")}, artist = ${c("artist", "artist")}, handle = ${c("handle", "handle")}, spotify = ${c("spotify", "spotify")},
      isrc = ${c("isrc", "isrc")}, genre = ${c("genre", "genre")}, notes = ${c("notes", "notes")}, luminate_id = ${c("luminateId", "luminate_id")},
      person_id = ${v.personId !== undefined ? v.personId : t.person_id}, last_contact = ${v.lastContact !== undefined ? v.lastContact || null : t.last_contact_day} WHERE id = ${t.id}`;
    await event(t.id, by, "edit", `${by} changed ${t.name}'s details.`);
  } else if (action === "stageTracked") {
    const { stage } = checkTracked({ stage: b.stage ?? null }, { isNew: false });
    if (stage === t.stage) return { ok: true, tracked: trackedOut(t) };
    await sql`UPDATE ar_tracked SET stage = ${stage} WHERE id = ${t.id}`;
    await event(t.id, by, "status", stage ? `${by} moved ${t.name} to ${STAGE_WORDS[stage]}.` : `${by} took ${t.name} off the board.`);
  } else if (action === "removeTracked") {
    await sql`UPDATE ar_tracked SET removed_at = now() WHERE id = ${t.id}`;
    await event(t.id, by, "remove", `${by} removed ${t.name} from the Watchlist.`);
    return { ok: true };
  } else throw new ArError(400, "Unknown action.");
  return { ok: true, tracked: trackedOut(await trackedRow(t.id)) };
}

// a producer's own row in an A&R Artists list ("Their Luminate numbers"): Postgres only
async function linkLuminate(b, by) {
  const prospectId = String(b.prospectId || ""), luminateId = String(b.luminateId || "").trim().slice(0, 64);
  const [p] = await sql`SELECT id, name FROM ar_prospects WHERE id = ${prospectId} AND merged_into IS NULL`;
  if (!p) throw new ArError(404, "That prospect was removed somewhere else. Reload to see the latest.");
  await sql`UPDATE ar_tracking SET removed_at = now(), updated_at = now() WHERE prospect_id = ${p.id} AND kind = 'artist' AND removed_at IS NULL`;
  if (luminateId) await sql`INSERT INTO ar_tracking (id, prospect_id, kind, name, luminate_id, via) VALUES (${uid()}, ${p.id}, 'artist', ${p.name}, ${luminateId}, 'ar')`;
  await event(p.id, by, "luminate", luminateId ? `${by} linked ${p.name} to their row in the A&R Artists list.` : `${by} unlinked ${p.name}'s Luminate numbers.`);
  return { ok: true };
}

async function act(body, by) {
  const { action } = body;
  if (action === "mergeProspect") return mergeProspect(String(body.fromId || ""), String(body.intoId || ""), by);
  if (action === "dismissFirstRun") {
    await sql`UPDATE app_state SET value = value || '{"dismissed": true}'::jsonb, updated_at = now() WHERE key = 'arFirstRun'`;
    return { ok: true };
  }
  if (["addTracked", "editTracked", "stageTracked", "removeTracked"].includes(action)) return trackedAct(action, body, by);
  if (action === "linkLuminate") return linkLuminate(body, by);
  throw new ArError(400, "Unknown action.");
}

export default async function handler(req, res) {
  const session = await requireStaff(req, res);
  if (!session) return;
  try {
    if (req.method === "GET" && req.query.events) return res.status(200).json({ events: await eventsOf(String(req.query.events)) });
    if (req.method === "GET" && req.query.summary) return res.status(200).json(await arSummary());
    if (req.method === "GET") {
      const { state, tracked, arLists, watch, toLuminate } = await arWatchNow();
      return res.status(200).json({ ...state, tracked, arLists, watch, toLuminate });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    if (!requireSameOrigin(req, res)) return;
    return res.status(200).json(await act(req.body || {}, session.user.name || session.user.email || "staff"));
  } catch (err) {
    if (err instanceof ArError) return res.status(err.status).json({ error: err.message, ...err.extra });
    console.error("ar route failed:", err);
    return res.status(502).json({ error: "Couldn't load the A&R data just now — try again in a minute." });
  }
}
