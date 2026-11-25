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
export const RECENT_DAYS = 7; // a new song's latest week of readings (songPace `forward`)
const DAY = 864e5;
export const trackOf = (link) => (String(link || "").match(/track\/([A-Za-z0-9]{22})/) || [])[1] || "";

// The readings in the window, by entity: Map entity_id -> [{ t (ms), v }] (any order). snaps [{entity_id, value, taken_at}] (spotify streams)
export function readsOf(snaps, now = Date.now()) {
  const since = now - WINDOW_DAYS * DAY;
  const reads = new Map();
  for (const s of snaps || []) {
    const t = new Date(s.taken_at).getTime(), v = Number(s.value);
    if (!Number.isFinite(t) || t < since || t > now || !(v > 0)) continue;
    if (!reads.has(s.entity_id)) reads.set(s.entity_id, []);
    reads.get(s.entity_id).push({ t, v });
  }
  return reads;
}

// (2026-11-21) One song's pace: the unit paceByClient adds up, now also what the EMPIRE page needs song by song (lib/empire-deal.js). p: a placements row, client: { name }
// (the share is found by findByName on the splits), reads: readsOf's answer. -> { track (Spotify track id or ""), key (what counts a recording once), share (0 to 1),
// life (lifetime streams, all platforms), real (measured from readings), perYear (net streams a year when real, else 0: the measured pace), forward (the pace to PLAN
// on when real, else 0: see below), launch (the hold below took something off), rule (the sheet's rule for it: life × share × runRate), isNew (real, and out under
// NEW_SONG_DAYS), from / to (the readings' first and last day, real only) }
//
// (2026-11-24, audit) `forward`: a song's daily counts from its first NEW_SONG_DAYS (its launch) are not annualised at face value. A 20-day-old song's 28-day window × 365,
// slowed only B8 a year after, came out at 61× the sheet's rule for it and its 18-month advance at about twice what a launch drop would allow.
// (2026-11-25) The song's own readings are the ground: it plans on the LOWER of its window's pace and the pace of its latest RECENT_DAYS of readings (× 365, scaled the same
// way), so a launch spike in the first days of the window drops out and nothing from outside the song (no mature-song rule) is imposed. (The first version held it to the
// sheet's B9 × lifetime: too harsh for a song just out.) Never more than before: a song still growing keeps its window's pace. The latest week needs readings at least
// MIN_DAYS apart inside it and a count that didn't go down; without that (two readings only, a gap) the song is as measured, and the page still calls it rough.
// Only the share of its readings window that lies inside its first NEW_SONG_DAYS is held; the rest counts as measured, so instead of jumping at day 90 the pace climbs
// evenly to the measured one over the WINDOW_DAYS after it (each day 1/28 of the way). No release date: as measured (it can't be told new).
// perYear (what paceByClient adds up, and today's rate for filling the days between two counts) stays the measured pace.
export function songPace(p, client, reads, runRate, now = Date.now()) {
  const tid = trackOf(p.link);
  const share = (Number(findByName(p.splits || [], client.name)?.percent) || 0) / 100;
  const life = Math.max(Number(p.streams) || 0, 0);
  const rs = tid ? (reads.get(`t:${tid}`) || []).slice().sort((a, b) => a.t - b.t) : [];
  const first = rs[0], last = rs[rs.length - 1];
  const days = first && last ? (last.t - first.t) / DAY : 0;
  const out = { track: tid, key: tid || `p:${p.id}`, share, life, real: false, perYear: 0, forward: 0, launch: false, rule: life * share * (Number(runRate) || 0), isNew: false, from: null, to: null };
  if (rs.length >= 2 && days >= MIN_DAYS && last.v >= first.v) {
    const perDay = (last.v - first.v) / days;
    const ratio = Math.min(Math.max(life > 0 ? life / last.v : 1, 1), MAX_RATIO);
    out.real = true;
    out.perYear = perDay * 365 * ratio * share;
    out.forward = out.perYear;
    const rel = Date.parse(String(p.release_date || "").slice(0, 10));
    out.isNew = Number.isFinite(rel) && now - rel < NEW_SONG_DAYS * DAY;
    if (Number.isFinite(rel)) {
      const end = rel + NEW_SONG_DAYS * DAY;                                       // the day its launch is over
      const inLaunch = Math.min(Math.max((end - first.t) / (last.t - first.t), 0), 1); // the share of the readings window inside its first NEW_SONG_DAYS
      // its latest week: the first reading inside the last RECENT_DAYS (half a day of slack: the cron reads at about the same hour, not to the minute) to the last
      const wk = rs.find((x) => x.t >= last.t - (RECENT_DAYS + 0.5) * DAY);
      const wkDays = wk ? (last.t - wk.t) / DAY : 0;
      if (inLaunch > 0 && wkDays >= MIN_DAYS && last.v >= wk.v) {
        const latest = ((last.v - wk.v) / wkDays) * 365 * ratio * share;
        out.forward = Math.min(out.perYear, inLaunch * Math.min(out.perYear, latest) + (1 - inLaunch) * out.perYear); // (the outer min: never above, not even by a rounding)
      }
    }
    out.launch = out.forward < out.perYear;
    out.from = new Date(first.t).toISOString().slice(0, 10);
    out.to = new Date(last.t).toISOString().slice(0, 10);
  }
  return out;
}

// Pure. clients [{id, name}], placements [{id, client_id, song, link, streams, splits, release_date}], snaps [{entity_id, value, taken_at}]
// (spotify streams, any order), runRate (B9 fraction), now (ms) -> Map clientId -> pace
export function paceByClient({ clients, placements, snaps, runRate, now = Date.now() }) {
  const reads = readsOf(snaps, now);
  const out = new Map();
  for (const c of clients || []) {
    const mine = (placements || []).filter((p) => p.client_id === c.id);
    const seen = new Set();
    const r = { clientId: c.id, songs: 0, tracked: 0, lifetimeNet: 0, trackedLifetimeNet: 0, realPerYear: 0, rulePerYear: 0, newSongPerYear: 0, from: null, to: null };
    for (const p of mine) {
      const key = trackOf(p.link) || `p:${p.id}`;
      if (seen.has(key)) continue; // the same recording twice on one client counts once
      seen.add(key);
      const sp = songPace(p, c, reads, runRate, now);
      r.songs++;
      r.lifetimeNet += sp.life * sp.share;
      if (sp.real) {
        r.tracked++;
        r.trackedLifetimeNet += sp.life * sp.share;
        r.realPerYear += sp.perYear;
        if (sp.isNew) r.newSongPerYear += sp.perYear;
        if (!r.from || sp.from < r.from) r.from = sp.from;
        if (!r.to || sp.to > r.to) r.to = sp.to;
      } else {
        r.rulePerYear += sp.rule;
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

// The Spotify readings in the window for these entities ("t:<track id>"), oldest first (the second read of readPaces, and of the EMPIRE page)
export const readSnaps = (sql, ids, now = Date.now()) => sql`SELECT entity_id, value, taken_at FROM data_snapshots WHERE platform = 'spotify' AND metric = 'streams' AND entity_id = ANY(${ids}) AND taken_at > ${new Date(now - WINDOW_DAYS * DAY).toISOString()} ORDER BY taken_at`;

// The database reads for paceByClient: every client's placements and the last WINDOW_DAYS of Spotify stream readings for their tracks
export async function readPaces({ sql, clients, runRate, now = Date.now() }) {
  const placements = await sql`SELECT id, client_id, song, link, streams, splits, release_date::text AS release_date FROM placements`;
  const ids = [...new Set(placements.map((p) => trackOf(p.link)).filter(Boolean).map((t) => `t:${t}`))];
  const snaps = ids.length ? await readSnaps(sql, ids, now) : [];
  return paceByClient({ clients, placements, snaps, runRate, now });
}
