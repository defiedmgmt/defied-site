// (2026-11-20) Today's streaming pace for each signed client, from real data, for the advance calculator (lib/advance-model.js).
// Per song with a Spotify link and daily readings (data_snapshots spotify/streams, the cron reads them every day): the Spotify streams it
// gained a day between its first and last reading in the last WINDOW_DAYS (at least MIN_DAYS apart), × 365, scaled to all platforms by the
// song's own lifetime ratio (placements.streams, the pub sheet's all-platform figure, over its latest Spotify count; never below 1 and at
// most MAX_RATIO), × the client's split on it (the same rule as their page: findByName on the splits). A song without readings counts its
// lifetime net streams × the sheet's forward run-rate (ASSUMPTIONS!B9) instead, and the page says how much of the pace is real.
// Measured 11-20 across the roster: 32.7% of lifetime a year overall (the sheet assumes 30%), from 1.6% to 246.7% by client; songs out
// under 6 months ran at 217% of their lifetime a year, songs over a year old at 22-25%.
import { findByName } from "./names";

export const WINDOW_DAYS = 28;
export const MIN_DAYS = 5;
export const MAX_RATIO = 4;
export const NEW_SONG_DAYS = 90;
const DAY = 864e5;
const trackOf = (link) => (String(link || "").match(/track\/([A-Za-z0-9]{22})/) || [])[1] || "";

// Pure. clients [{id, name}], placements [{id, client_id, song, link, streams, splits, release_date}], snaps [{entity_id, value, taken_at}]
// (spotify streams, any order), runRate (B9 fraction), now (ms) -> Map clientId -> pace
export function paceByClient({ clients, placements, snaps, runRate, now = Date.now() }) {
  const since = now - WINDOW_DAYS * DAY;
  const reads = new Map();
  for (const s of snaps || []) {
    const t = new Date(s.taken_at).getTime(), v = Number(s.value);
    if (!Number.isFinite(t) || t < since || t > now || !(v > 0)) continue;
    if (!reads.has(s.entity_id)) reads.set(s.entity_id, []);
    reads.get(s.entity_id).push({ t, v });
  }
  const out = new Map();
  for (const c of clients || []) {
    const mine = (placements || []).filter((p) => p.client_id === c.id);
    const seen = new Set();
    const r = { clientId: c.id, songs: 0, tracked: 0, lifetimeNet: 0, trackedLifetimeNet: 0, realPerYear: 0, rulePerYear: 0, newSongPerYear: 0, from: null, to: null };
    for (const p of mine) {
      const tid = trackOf(p.link);
      const key = tid || `p:${p.id}`;
      if (seen.has(key)) continue; // the same recording twice on one client counts once
      seen.add(key);
      const share = (Number(findByName(p.splits || [], c.name)?.percent) || 0) / 100;
      const life = Math.max(Number(p.streams) || 0, 0);
      r.songs++;
      r.lifetimeNet += life * share;
      const rs = tid ? (reads.get(`t:${tid}`) || []).slice().sort((a, b) => a.t - b.t) : [];
      const first = rs[0], last = rs[rs.length - 1];
      const days = first && last ? (last.t - first.t) / DAY : 0;
      if (rs.length >= 2 && days >= MIN_DAYS && last.v >= first.v) {
        const perDay = (last.v - first.v) / days;
        const ratio = Math.min(Math.max(life > 0 ? life / last.v : 1, 1), MAX_RATIO);
        const perYear = perDay * 365 * ratio * share;
        r.tracked++;
        r.trackedLifetimeNet += life * share;
        r.realPerYear += perYear;
        const rel = Date.parse(String(p.release_date || "").slice(0, 10));
        if (Number.isFinite(rel) && now - rel < NEW_SONG_DAYS * DAY) r.newSongPerYear += perYear;
        const f = new Date(first.t).toISOString().slice(0, 10), l = new Date(last.t).toISOString().slice(0, 10);
        if (!r.from || f < r.from) r.from = f;
        if (!r.to || l > r.to) r.to = l;
      } else {
        r.rulePerYear += life * share * (Number(runRate) || 0);
      }
    }
    r.perYear = r.realPerYear + r.rulePerYear;
    // how much of the pace is measured, and how much of it comes from songs out under NEW_SONG_DAYS (those usually fall faster)
    r.realShare = r.perYear > 0 ? r.realPerYear / r.perYear : 0;
    r.newShare = r.perYear > 0 ? r.newSongPerYear / r.perYear : 0;
    r.lifetimeShareTracked = r.lifetimeNet > 0 ? r.trackedLifetimeNet / r.lifetimeNet : 0;
    // today's pace as a share of their lifetime net streams (the sheet's B9 for this person, measured)
    r.ofLifetime = r.lifetimeNet > 0 ? r.perYear / r.lifetimeNet : null;
    out.set(c.id, r);
  }
  return out;
}

// The database reads for paceByClient: every client's placements and the last WINDOW_DAYS of Spotify stream readings for their tracks
export async function readPaces({ sql, clients, runRate, now = Date.now() }) {
  const placements = await sql`SELECT id, client_id, song, link, streams, splits, release_date::text AS release_date FROM placements`;
  const ids = [...new Set(placements.map((p) => trackOf(p.link)).filter(Boolean).map((t) => `t:${t}`))];
  const snaps = ids.length
    ? await sql`SELECT entity_id, value, taken_at FROM data_snapshots WHERE platform = 'spotify' AND metric = 'streams' AND entity_id = ANY(${ids}) AND taken_at > ${new Date(now - WINDOW_DAYS * DAY).toISOString()} ORDER BY taken_at`
    : [];
  return paceByClient({ clients, placements, snaps, runRate, now });
}
