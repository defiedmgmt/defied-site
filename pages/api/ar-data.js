// Staff-only A&R data: the OUTREACH / ADVANCE CALCULATOR / ASSUMPTIONS tabs read as one unformatted
// snapshot, each row matched to the dashboard's permanent prospect id (lib/ar.js reconcile: it also
// takes in prospects typed into the sheet by hand and notices rows sorted, renamed or cleared there,
// and writes nothing to the sheet), plus the signed clients' Net Streams for the Advance
// calculator, and each one's `pace` (the streams a year they earn today, lib/advance-pace.js): only to an
// account with Money access, which is who can open it, and to one limited to its own artists only
// theirs (signedClientsFor). When the sheet can't be read, the prospects come
// from what it last said (stale) and saving pauses. ?check=1 is the read-only Sheet check. Writes go
// through /api/ar-write.
import { withSheetsQuick } from "../../lib/sheets";
import { sql } from "../../lib/db";
import { requireAccess } from "../../lib/access";
import { seesNetStreams } from "../../lib/roles";
import { findByName } from "../../lib/names";
import { readArSheet, readChecks, sheetCheck, sheetProspect, seenProspect, settlePending } from "../../lib/ar-sheet";
import { reconcile, OUTREACH_STATUSES, OUTREACH_TAB, ADVANCE_TAB } from "../../lib/ar";
import { getState } from "../../lib/app-state";
import { tabLink, getSheetId } from "../../lib/sheets";
import { readSheetFacts } from "../../lib/sheet-facts-store";
import { netStreamsOf } from "../../lib/sheet-facts";
import { readPaces } from "../../lib/advance-pace";

// The same net streams a client's page shows (components/App.jsx SongManager): the sheet's own figure
// from the last pull (MASTER's writer table, build G3), else the estimate — each placement's streams ×
// that client's own split %, summed across their whole catalog (netFromSheet false).
async function readSignedClientsWithNetStreams() {
  const [clients, placements, facts] = await Promise.all([
    sql`SELECT id, name FROM clients ORDER BY roster_order`,
    sql`SELECT client_id, streams, splits FROM placements`,
    readSheetFacts(),
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
  return Array.from(byClient.values()).map((c) => {
    const net = netStreamsOf(facts.clients[c.id], c.netStreams);
    return { ...c, netStreams: net.value, netFromSheet: net.fromSheet };
  });
}

// Which signed clients this account gets, with their gross and net streams: the Advance calculator's (Clients ›
// Advance calculator, Money access only). Net streams go with the money (lib/roles.js seesNetStreams, 2026-11-13), so
// an account without Money gets none, and an account limited to its own artists gets only theirs ("no other artist's
// number reaches it", as /api/sheets-master). access: requireAccess's req.access
export function signedClientsFor(access, list) {
  if (!seesNetStreams(access)) return [];
  if (!access.ownOnly) return list;
  const mine = new Set(access.clientIds || []);
  return list.filter((c) => mine.has(c.id));
}

// (2026-11-20) Each of those clients with `pace`: the streams a year they earn today, from real daily readings (lib/advance-pace.js), for the Advance
// calculator (lib/advance-model.js) to start from. Run on the clients an account already gets (signedClientsFor), so no other artist's number goes
// out; one more pair of reads per request. runRate: the sheet's ASSUMPTIONS!B9 for the songs without readings (0 when the sheet couldn't be read).
// A failed read leaves `pace: null` and the calculator falls back to the sheet's rule: it still works.
async function withPace(list, runRate) {
  if (!list.length) return list;
  try {
    const paces = await readPaces({ sql, clients: list, runRate: Number(runRate) || 0 });
    return list.map((c) => ({ ...c, pace: paces.get(c.id) ?? null }));
  } catch (err) {
    console.error("ar-data pace read failed:", err);
    return list.map((c) => ({ ...c, pace: null }));
  }
}

async function offBoard() {
  const rows = await sql`SELECT id, name, removed_at, removed_by FROM ar_prospects WHERE removed_at IS NOT NULL AND merged_into IS NULL ORDER BY removed_at DESC`;
  return rows.map((r) => ({ id: r.id, name: r.name, removedAt: r.removed_at, why: r.removed_by === "sheet" ? "gone from the sheet" : "removed" }));
}

export default async function handler(req, res) {
  const session = await requireAccess(req, res, "ar");
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
    // (2026-11-20) quick: on Google's quota it falls back to the database's copy below at once instead of 28 s later
    try { read = await withSheetsQuick(() => readArSheet()); } catch (err) {
      // Google's own wording ("Internal error encountered.") means nothing on the A&R tab: logged here
      console.error("ar-data sheet read failed:", err);
    }
    // (read only for an account that may have them)
    const signedClients = seesNetStreams(req.access)
      ? await withPace(signedClientsFor(req.access, await readSignedClientsWithNetStreams()), read?.assumptions?.runRate) : [];
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
        firstRun: await firstRun(), assumptions: null, recoupTargetMonths: null, budget: null, totals: null,
        statuses, statusSource: meta?.statusSource || "built-in",
        prospects: recs.map((r) => seenProspect(r, statuses)), offBoard: await offBoard(), givenMismatch: [], changesToCheck: [], signedClients,
      });
    }

    const rec = await reconcile(read, { readAtDb });
    const changesToCheck = await settlePending(read);
    // what the last Sheet check found, so the Board's "N sheet problems" counts what the check lists. That
    // check is only as fresh as its last run, so each problem it found is asked again of this read where
    // it can be: a cell fixed in the sheet stops counting at once. Tabs (this read found them) and the
    // checks the read's own problems repeat are left to the read. Headers and formulas need cells this
    // read doesn't fetch: they keep the check's answer and its time (the link re-runs the check).
    const lastCheck = await getState("arSheetCheck");
    const again = readChecks(read, read.raw.adv);
    const LEFT_TO_READ = new Set(["tabs", "statuses", "advanceRows", "assumptions", "totalRow"]);
    const checkProblems = (lastCheck?.checks || []).filter((c) => !c.ok && !LEFT_TO_READ.has(c.id)).map((c) => again[c.id] || c).filter((c) => !c.ok)
      .map((c) => ({ id: c.id, text: c.text, ...(c.fix ? { fix: c.fix } : {}), ...(!again[c.id] && lastCheck.checkedAt ? { checkedAt: lastCheck.checkedAt } : {}) }));
    return res.status(200).json({
      sheet: { ok: true, readAt: read.readAt, stale: false, links: read.links, layout: read.layout, problems: [...read.problems, ...rec.problems], checkProblems },
      firstRun: await firstRun(),
      assumptions: read.assumptions, recoupTargetMonths: read.recoupTargetMonths, budget: read.budget,
      totals: read.totals, // OUTREACH's row 1-2: the pipeline's totals as the sheet works them out
      statuses: read.statuses, statusSource: read.statusSource,
      prospects: read.rows.map((r) => sheetProspect(rec.byRow.get(r.row) ?? null, r, read.statuses)),
      offBoard: await offBoard(), givenMismatch: rec.givenMismatch, changesToCheck, signedClients,
    });
  } catch (err) {
    console.error("ar-data failed:", err);
    return res.status(502).json({ error: "Couldn't load the A&R data just now — try again in a minute." });
  }
}
