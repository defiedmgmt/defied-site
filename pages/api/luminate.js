// The dashboard's Luminate page: portfolios, each song's ISRC and portfolio,
// linking Luminate's songs to ours. Staff only. GET returns lumState(); POST
// takes one { action, ... } at a time.
import { sql } from "../../lib/db";
import { requireStaff, requireSameOrigin } from "../../lib/session";
import { lumState, portfolioIdOf, writeLuminateIds, knownAreas, isAR, isRoster } from "../../lib/luminate";
import { afterExports } from "../../lib/luminate-run";
import { syncSiteFromSheet } from "../../lib/site-sync";
import { findIsrc, cleanIsrc, ISRC_RE } from "../../lib/isrc";

const newId = () => Math.random().toString(36).slice(2, 10);
const ids = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x).slice(0, 500) : []);
const upsertTracking = (id, set) => sql`
  INSERT INTO song_tracking (placement_id, isrc, isrc_source, isrc_checked_at, portfolio_id, added_at, skip, updated_at)
  VALUES (${id}, ${set.isrc ?? ""}, ${set.isrc_source ?? ""}, ${set.isrc_checked_at ?? null}, ${set.portfolio_id ?? null}, ${set.added_at ?? null}, ${set.skip ?? false}, now())
  ON CONFLICT (placement_id) DO UPDATE SET
    isrc = CASE WHEN ${"isrc" in set} THEN EXCLUDED.isrc ELSE song_tracking.isrc END,
    isrc_source = CASE WHEN ${"isrc" in set} THEN EXCLUDED.isrc_source ELSE song_tracking.isrc_source END,
    isrc_checked_at = CASE WHEN ${"isrc_checked_at" in set} THEN EXCLUDED.isrc_checked_at ELSE song_tracking.isrc_checked_at END,
    portfolio_id = CASE WHEN ${"portfolio_id" in set} THEN EXCLUDED.portfolio_id ELSE song_tracking.portfolio_id END,
    added_at = CASE WHEN ${"portfolio_id" in set} THEN EXCLUDED.added_at ELSE song_tracking.added_at END,
    skip = CASE WHEN ${"skip" in set} THEN EXCLUDED.skip ELSE song_tracking.skip END,
    updated_at = now()
`;

async function act(body, session) {
  const { action } = body;
  if (action === "savePortfolio") {
    const name = String(body.name || "").trim().slice(0, 80);
    const url = String(body.url || "").trim().slice(0, 600);
    const capacity = Math.max(1, Math.min(1000, parseInt(body.capacity, 10) || 100));
    // this page holds the clients' portfolios only: the batch-1 "A&R watchlist" kind is gone
    if (body.kind && body.kind !== "roster") return [400, { error: "This page is for the clients' portfolios only. A&R portfolios are recognized from their exports and kept for the A&R tab." }];
    const kind = "roster";
    if (!name) return [400, { error: "Give the portfolio a name." }];
    if (url && !/^https:\/\//i.test(url)) return [400, { error: "The link should start with https://" }];
    const lumId = portfolioIdOf(url) || (body.luminateId ? portfolioIdOf(body.luminateId) : null);
    if (lumId) {
      const known = (await knownAreas()).get(lumId);
      if (isAR(known?.area)) return [400, { error: `That's the ${known.name || "A&R"} portfolio. Its exports are kept for the A&R tab, so it can't be added here.` }];
      const [other] = await sql`SELECT id, name FROM luminate_portfolios WHERE luminate_id = ${lumId} AND id <> ${body.id || ""}`;
      if (other) return [400, { error: `That's the same Luminate portfolio as "${other.name}".` }];
    }
    if (body.id) {
      const [cur] = await sql`SELECT * FROM luminate_portfolios WHERE id = ${body.id}`;
      if (!cur) return [404, { error: "That portfolio was removed." }];
      await sql`UPDATE luminate_portfolios SET name = ${name}, url = ${url}, capacity = ${capacity}, kind = ${kind}, luminate_id = ${lumId || cur.luminate_id} WHERE id = ${body.id}`;
    } else {
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM luminate_portfolios`;
      await sql`INSERT INTO luminate_portfolios (id, luminate_id, name, url, kind, capacity, sort) VALUES (${newId()}, ${lumId}, ${name}, ${url}, ${kind}, ${capacity}, ${n})`;
    }
    return [200, { ok: true }];
  }
  if (action === "removePortfolio") {
    const [p] = await sql`SELECT * FROM luminate_portfolios WHERE id = ${body.id || ""}`;
    if (!p) return [200, { ok: true }];
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM song_tracking WHERE portfolio_id = ${p.id}`;
    const [{ x }] = await sql`SELECT count(*)::int AS x FROM luminate_exports WHERE portfolio_id = ${p.luminate_id || "-"}`;
    if (n || x) return [400, { error: "Songs are already filed under this portfolio, so it can't be removed. Rename it instead." }];
    await sql`DELETE FROM luminate_portfolios WHERE id = ${p.id}`;
    return [200, { ok: true }];
  }
  if (action === "setIsrc") {
    const isrc = cleanIsrc(body.isrc);
    if (isrc && !ISRC_RE.test(isrc)) return [400, { error: "An ISRC is 12 letters and numbers, like USUM72506269." }];
    await sql.transaction(ids(body.placementIds).map((id) => upsertTracking(id, { isrc, isrc_source: isrc ? "manual" : "", isrc_checked_at: new Date().toISOString() })));
    return [200, { ok: true, isrc }];
  }
  if (action === "findIsrcs") {
    // groups: [[ids of one song across clients' pages], …]; a few per call keeps each request short
    const groups = (Array.isArray(body.groups) ? body.groups : []).map(ids).filter((g) => g.length).slice(0, 8);
    const all = groups.flat();
    const songs = Object.fromEntries((await sql`SELECT id, song, artist FROM placements WHERE id = ANY(${all})`).map((p) => [p.id, p]));
    const results = {};
    for (const g of groups) {
      const p = songs[g[0]];
      if (!p) continue;
      let hit = null, error = null;
      try { hit = await findIsrc({ song: p.song, artist: p.artist }); } catch (err) { error = err.message; }
      if (error) { results[g[0]] = { error }; continue; } // Deezer down: try again later, nothing saved
      const at = new Date().toISOString();
      await sql.transaction(g.map((id) => upsertTracking(id, hit ? { isrc: hit.isrc, isrc_source: "deezer", isrc_checked_at: at } : { isrc_checked_at: at })));
      results[g[0]] = hit ? { isrc: hit.isrc, match: hit.match, title: hit.title, artist: hit.artist } : { notFound: true };
    }
    return [200, { results }];
  }
  if (action === "markAdded" || action === "unmark") {
    const list = ids(body.placementIds);
    let portfolioId = null;
    if (action === "markAdded") {
      const [p] = await sql`SELECT id, kind FROM luminate_portfolios WHERE id = ${body.portfolioId || ""}`;
      if (!p) return [400, { error: "Pick the portfolio you added them to." }];
      if (!isRoster(p)) return [400, { error: "Clients' songs can only be marked as added to a clients' portfolio." }];
      portfolioId = p.id;
    }
    const at = portfolioId ? new Date().toISOString() : null;
    await sql.transaction(list.map((id) => upsertTracking(id, { portfolio_id: portfolioId, added_at: at })));
    return [200, { ok: true }];
  }
  if (action === "skip") {
    await sql.transaction(ids(body.placementIds).map((id) => upsertTracking(id, { skip: !!body.skip })));
    return [200, { ok: true }];
  }
  if (action === "ignore") {
    const lumId = String(body.luminateId || "").trim();
    if (!lumId) return [400, { error: "Missing Luminate id." }];
    if (body.ignore === false) await sql`DELETE FROM luminate_ignored WHERE luminate_id = ${lumId}`;
    else await sql`INSERT INTO luminate_ignored (luminate_id) VALUES (${lumId}) ON CONFLICT DO NOTHING`;
    return [200, { ok: true }];
  }
  if (action === "link") {
    // one Luminate song onto one song (every client page it's on), or "" to unlink
    const lumId = String(body.luminateId || "").trim();
    const list = ids(body.placementIds);
    if (!list.length) return [400, { error: "Pick the song to link." }];
    if (lumId) {
      // an A&R portfolio's row is a prospect's, never a client song's numbers
      const [ar] = await sql`
        SELECT 1 FROM luminate_ar_held h, jsonb_array_elements(h.entities) e WHERE e->>'id' = ${lumId}
          AND NOT EXISTS (SELECT 1 FROM luminate_exports x, jsonb_array_elements(x.entities) f WHERE f->>'id' = ${lumId}) LIMIT 1
      `;
      if (ar) return [400, { error: "That Luminate row is in an A&R portfolio, not a clients' one, so it can't be linked to a client's song here." }];
      const taken = await sql`SELECT song FROM placements WHERE luminate_id = ${lumId} AND id <> ALL(${list})`;
      if (taken.length) return [400, { error: `That Luminate song is already linked to "${taken[0].song}".` }];
    }
    // linking only fills a blank: a copy of the song that already has a (different) Luminate id keeps
    // it — changing one is done on purpose, in the song's own form
    const rows = await sql`SELECT id, luminate_id FROM placements WHERE id = ANY(${list})`;
    const fill = rows.filter((r) => (lumId ? !r.luminate_id || r.luminate_id === lumId : true)).map((r) => r.id);
    if (!fill.length) return [400, { error: "That song is already linked to another Luminate song. Change it from the song's own Edit form." }];
    await sql.transaction(fill.map((id) => sql`UPDATE placements SET luminate_id = ${lumId} WHERE id = ${id}`));
    const sheet = await writeLuminateIds(fill.map((id) => ({ placementId: id, luminateId: lumId })));
    const sync = await syncSiteFromSheet();
    return [200, { ok: true, sheet, sync }];
  }
  if (action === "resync") {
    const run = await afterExports({ by: session.user.name || session.user.email || "staff" });
    return [run.error ? 502 : 200, { ...run, error: run.error || undefined }];
  }
  return [400, { error: "Unknown action." }];
}

export default async function handler(req, res) {
  const session = await requireStaff(req, res);
  if (!session) return;
  try {
    if (req.method === "GET") return res.status(200).json(await lumState());
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    if (!requireSameOrigin(req, res)) return;
    const [status, json] = await act(req.body || {}, session);
    return res.status(status).json(json);
  } catch (err) {
    console.error("luminate route failed:", err);
    return res.status(502).json({ error: err.message || "Something went wrong — nothing else was changed." });
  }
}
