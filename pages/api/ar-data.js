// Staff-only A&R data: the OUTREACH / ADVANCE CALCULATOR / ASSUMPTIONS tabs read as one unformatted
// snapshot, each row matched to the dashboard's permanent prospect id (lib/ar.js reconcile: it also
// takes in prospects typed into the sheet by hand and notices rows sorted, renamed or cleared there,
// and writes nothing to the sheet), plus every signed client's Net Streams for the Advance
// calculator. When the sheet can't be read, the prospects come from what it last said (stale) and
// saving pauses. ?check=1 is the read-only Sheet check. Writes go through /api/ar-write.
import { sql } from "../../lib/db";
import { requireStaff } from "../../lib/session";
import { findByName } from "../../lib/names";
import { readArSheet, sheetCheck, sheetProspect, seenProspect, settlePending } from "../../lib/ar-sheet";
import { reconcile, OUTREACH_STATUSES, OUTREACH_TAB, ADVANCE_TAB } from "../../lib/ar";
import { getState } from "../../lib/luminate";
import { tabLink, getSheetId } from "../../lib/sheets";

// Same math as SongManager's own catalog summary (components/App.jsx) —
// net streams is each placement's streams × that client's own split %,
// summed across their whole catalog. Kept in sync by hand since one lives
// server-side (Postgres) and the other client-side (already-loaded db).
async function readSignedClientsWithNetStreams() {
  const [clients, placements] = await Promise.all([
    sql`SELECT id, name FROM clients ORDER BY roster_order`,
    sql`SELECT client_id, streams, splits FROM placements`,
  ]);
  const byClient = new Map(clients.map((c) => [c.id, { id: c.id, name: c.name, grossStreams: 0, netStreams: 0 }]));
  for (const p of placements) {
    const entry = byClient.get(p.client_id);
    if (!entry) continue;
    const streams = Number(p.streams) || 0;
    entry.grossStreams += streams;
    const mine = findByName(p.splits || [], entry.name); // same rule as SongManager's ownSplit
    entry.netStreams += streams * ((Number(mine?.percent) || 0) / 100);
  }
  return Array.from(byClient.values()).map((c) => ({ ...c, netStreams: Math.round(c.netStreams) }));
}

async function offBoard() {
  const rows = await sql`SELECT id, name, removed_at, removed_by FROM ar_prospects WHERE removed_at IS NOT NULL AND merged_into IS NULL ORDER BY removed_at DESC`;
  return rows.map((r) => ({ id: r.id, name: r.name, removedAt: r.removed_at, why: r.removed_by === "sheet" ? "gone from the sheet" : "removed" }));
}

export default async function handler(req, res) {
  const session = await requireStaff(req, res);
  if (!session) return;
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  if (req.query.check) {
    try {
      return res.status(200).json(await sheetCheck());
    } catch (err) {
      console.error("ar sheet check failed:", err);
      return res.status(502).json({ error: "Couldn't read the pub sheet just now — try again in a minute." });
    }
  }

  try {
    // the database's clock before the sheet is read: a save that overlapped this read is noticed
    const [{ t: readAtDb }] = await sql`SELECT now() AS t`;
    let read = null;
    try { read = await readArSheet(); } catch (err) {
      // Google's own wording ("Internal error encountered.") means nothing on the A&R tab: logged here
      console.error("ar-data sheet read failed:", err);
    }
    const signedClients = await readSignedClientsWithNetStreams();
    // the one-time "found N prospects" card, until [Got it]
    const firstRun = async () => { const f = await getState("arFirstRun"); return f && !f.dismissed ? { found: f.found } : null; };

    if (!read) {
      const [recs, meta, [{ at }]] = await Promise.all([
        sql`SELECT * FROM ar_prospects WHERE removed_at IS NULL AND merged_into IS NULL AND outreach_row IS NOT NULL ORDER BY outreach_row`,
        getState("arSheetCheck"),
        sql`SELECT max(sheet_seen_at) AS at FROM ar_prospects`,
      ]);
      const statuses = meta?.statuses || OUTREACH_STATUSES;
      const id = getSheetId(), ids = meta?.tabIds || {};
      return res.status(200).json({
        sheet: {
          ok: false, readAt: null, stale: true, seenAt: at,
          links: { outreach: ids[OUTREACH_TAB] != null ? tabLink(id, ids[OUTREACH_TAB]) : null, advanceCalculator: ids[ADVANCE_TAB] != null ? tabLink(id, ids[ADVANCE_TAB]) : null },
          layout: null, problems: [],
        },
        firstRun: await firstRun(), assumptions: null, recoupTargetMonths: null, budget: null,
        statuses, statusSource: meta?.statusSource || "built-in",
        prospects: recs.map((r) => seenProspect(r, statuses)), offBoard: await offBoard(), givenMismatch: [], changesToCheck: [], signedClients,
      });
    }

    const rec = await reconcile(read, { readAtDb });
    const changesToCheck = await settlePending(read);
    return res.status(200).json({
      sheet: { ok: true, readAt: read.readAt, stale: false, links: read.links, layout: read.layout, problems: [...read.problems, ...rec.problems] },
      firstRun: await firstRun(),
      assumptions: read.assumptions, recoupTargetMonths: read.recoupTargetMonths, budget: read.budget,
      statuses: read.statuses, statusSource: read.statusSource,
      prospects: read.rows.map((r) => sheetProspect(rec.byRow.get(r.row) ?? null, r, read.statuses)),
      offBoard: await offBoard(), givenMismatch: rec.givenMismatch, changesToCheck, signedClients,
    });
  } catch (err) {
    console.error("ar-data failed:", err);
    return res.status(502).json({ error: "Couldn't load the A&R data just now — try again in a minute." });
  }
}
