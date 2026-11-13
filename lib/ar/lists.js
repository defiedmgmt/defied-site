// A&R as lists (r10, the owner's "strictly a list and tracker and watcher, like a spreadsheet"). Server only.
// One builder for every A&R view (GET /api/ar-lists):
//   home     the trends: day-over-day and week-on-week movers, new adds by who, about to expire, adds per week
//   team     everyone's adds, one row per thing, with the names of who added it (person=<userId>: one person's)
//   mine     the signed-in person's own list
//   watch    artists · songs (songs) · confirm (artists whose Spotify match a person still has to confirm)
//   sounds   TikTok sounds
//   item     one row's drawer: every metric's full series and the Luminate history (read-only)
// Every number is worked out here from data_snapshots (Spotify / TikTok / Instagram / YouTube, dated) and the
// Luminate history (lum_points / lum_history, read through lib/data/lum.js's helpers, never mixed with
// Spotify). The page only draws them. No money anywhere: no value, share or estimate fields.
// A number that doesn't exist yet stays null with the plain reason ("Needs a second day"); nothing is made up.
import { dataSql as sql, refreshOn } from "../data/engine";
import { rowsOrNoneIfNoTable } from "../db";
import { spotifyId, handleOf, youtubeRef } from "../data/sources";
import { toSeries, weekOver, addDays as addUtcDays } from "../data/math";
import { weekOfRows, weekOfHistory, seriesOfRows, seriesOfHistory, weekLabel, addDays, LUM_SRC } from "../data/lum";
import { teamOf, expiryOf, lumEntities, entityOfTracked, SOON_DAYS, GRACE_DAYS } from "./trackers";
import { accessFor } from "../roles";
import * as D from "../data/direct";
import { personKey } from "../names";

// ---------------------------------------------------------------- constants (the owner can ask to change these)
// a row counts as a mover only when its earlier reading clears this floor (tiny numbers swing by huge %)
export const FLOOR = { streams: 1000, monthly_listeners: 1000, followers: 100, subscribers: 100, videos: 50 };
export const MOVERS_N = 5;
// momentum (and its column, panel section and weights) waits for this many New York days of readings
export const MOMENTUM_DAYS = 7;
// the numbers a row can have: [key, platform, metric, header, cumulative (a running total) or a level]
export const METRICS = [
  ["listeners", "spotify", "monthly_listeners", "Spotify monthly listeners", false],
  ["streams", "spotify", "streams", "Spotify streams", true],
  ["spfollowers", "spotify", "followers", "Spotify followers", false],
  ["tiktok", "tiktok", "followers", "TikTok followers", false],
  ["instagram", "instagram", "followers", "Instagram followers", false],
  ["youtube", "youtube", "subscribers", "YouTube subscribers", false],
  ["videos", "tiktok", "videos", "TikTok videos with this sound", true],
];
const MET = Object.fromEntries(METRICS.map(([k, platform, metric, label, cumulative]) => [k, { k, platform, metric, label, cumulative }]));
const KIND_METRICS = { artist: ["listeners", "spfollowers", "tiktok", "instagram", "youtube"], song: ["streams"], sound: ["videos"] };
export const MAIN = { artist: "listeners", song: "streams", sound: "videos" };
// Home's week-on-week tabs
export const WEEK_TABS = [["streams", "Streams"], ["listeners", "Monthly listeners"], ["tiktok", "TikTok followers"], ["instagram", "Instagram followers"], ["youtube", "YouTube subscribers"], ["videos", "Sound videos"]];
export const TEAM_LUMINATE = "team:luminate";
export const TEAM_LUMINATE_NAME = "Old list (imported)"; // r11 fix: the old Luminate watchlist, not a person (was "Luminate import")
const DAY = 864e5;
const iso = (t) => new Date(t).toISOString();
const NY = "America/New_York";

// ---------------------------------------------------------------- names
// users.name (trimmed); else the email's part before "@", with a capital first letter. Never an email.
export function displayName(u) {
  if (!u) return "";
  if (u.id === TEAM_LUMINATE) return TEAM_LUMINATE_NAME;
  const n = String(u.name || "").trim();
  if (n) return n;
  const local = String(u.email || "").split("@")[0].trim();
  return local ? local[0].toUpperCase() + local.slice(1) : "";
}
// who an entry is: the live users row by owner_id (so renaming someone fixes all their rows); owner_name only
// as a fallback, and never an email address
export function ownerName(e, usersById) {
  if (e.owner_id === TEAM_LUMINATE) return TEAM_LUMINATE_NAME;
  const u = usersById.get(e.owner_id);
  if (u) return displayName(u) || "Team";
  const n = String(e.owner_name || "").trim();
  return n && !n.includes("@") ? n : n.includes("@") ? displayName({ email: n }) : "Team";
}

// ---------------------------------------------------------------- source labels
export function sourceLabel(s) {
  const v = String(s || "");
  if (!v) return "";
  // r10 fix: by platform, the way the owner knows them ("Spotify, via Apify"), never a scraper's account name
  if (v === "youtube-api") return "YouTube";
  if (v === "spotify-api" || v === "spotify-web-api") return "Spotify";
  const plat = /instagram/i.test(v) ? "Instagram" : /tiktok/i.test(v) ? "TikTok" : /youtube/i.test(v) ? "YouTube" : /spotify|eduair94|beatanalytics/i.test(v) ? "Spotify" : "";
  if (v.includes("/") || v.startsWith("apify")) return plat ? `${plat}, via Apify` : "Apify";
  return v;
}

// ---------------------------------------------------------------- pure: one number's cell
const gap = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const pct = (d, base) => (d == null || base == null || !(base > 0) ? null : (d / base) * 100);
// a scraper's "approx" number is only shown as "about" when it really is rounded: TikTok gives exact counts under
// 10,000 and "12.4K" above (r10 fix: Liyakk!'s 6,299 is exact)
// the step a rounded reading moves in: "72.1K" = 100, "1.2M" = 100,000
export const roundStep = (v) => (Math.abs(Number(v)) >= 1e6 ? 1e5 : 100);
const rounded = (x) => !!x?.approx && Number(x.value) >= 10000 && Number(x.value) % 100 === 0;
// [[New York day, the day's last value]], oldest first: lib/data/math.js toSeries, so A&R and Home count the same days
// (2026-11-13)
export function nySeries(snaps) {
  return toSeries(snaps || []);
}
// snaps: [{ value, taken_at, source, approx }] of ONE entity, platform and metric.
//   v, at, src, approx         the newest reading
//   d1 / prevV / prevAt / g1   the change from the day before (New York days, as lib/data/math.js); g1 = the % of the number
//   p1                         a level: the same %; a running total: today's gain against the day before's gain
//   d7 / w7v / w7At / p7       a level: now against 7 days ago; a running total: the last 7 days' gain, and the % against
//                              the 7 days before (lastWeek), per day. Both from lib/data/math.js weekOver, Home's week too
//                              (2026-11-13: A&R looked 2 days either way for every metric, so with Nov 6 missing a 4-day
//                              "last week" made steady songs rise 60-80%); a daily series looks 1 day either way, a weekly 2
//   why1 / why7                why a change isn't there yet
// r10 fix: days are New York days (a 7 PM reading is that day's, not the next UTC day's), and the last two
// readings' change (rd / rPrevV / rPrevAt) is kept too, so two readings on one day read as what they are
export function cellOf(snaps, { cumulative = false, slack } = {}) {
  const list = (snaps || []).filter((s) => Number.isFinite(Number(s.value))).sort((a, b) => new Date(a.taken_at) - new Date(b.taken_at));
  if (!list.length) return null;
  const series = nySeries(list);
  const newest = list[list.length - 1];
  const at = (day) => { let x = null; for (const s of list) if (nyDay(s.taken_at) === day) x = s; return x; };
  const [day, v] = series[series.length - 1];
  const out = { v, at: iso(newest.taken_at), day, src: sourceLabel(newest.source), approx: rounded(newest), d1: null, p1: null, g1: null, prevV: null, prevAt: null, d7: null, p7: null, g7: null, w7v: null, w7At: null, why1: "", why7: "", n: series.length, since: series[0][0], reads: list.length, rd: null, rg: null, rPrevV: null, rPrevAt: null };
  if (list.length > 1) {
    const p = list[list.length - 2], pv = Number(p.value);
    out.rd = Number(newest.value) - pv; out.rPrevV = pv; out.rPrevAt = iso(p.taken_at); out.rg = pct(out.rd, pv); out.rPrevApprox = rounded(p);
  }
  const prev = series.length > 1 ? series[series.length - 2] : null;
  if (prev && gap(prev[0], day) === 1) {
    out.d1 = v - prev[1]; out.prevV = prev[1]; out.prevAt = iso(at(prev[0]).taken_at); out.g1 = pct(out.d1, prev[1]); out.prevApprox = rounded(at(prev[0]));
    if (!cumulative) out.p1 = out.g1;
    else {
      const pp = series.length > 2 ? series[series.length - 3] : null;
      const g0 = pp && gap(pp[0], prev[0]) === 1 ? prev[1] - pp[1] : null;
      out.p1 = g0 != null && g0 > 0 ? ((out.d1 - g0) / g0) * 100 : null;
    }
  } else out.why1 = series.length < 2 ? `Needs a second day (from ${shortDay(addUtcDays(day, 1))})` : "Needs readings on two days in a row";
  const wk = weekOver(series, { slack }), w0 = wk.w0;
  if (w0) {
    out.w7v = w0[1]; out.w7At = iso(at(w0[0]).taken_at); out.d7 = v - w0[1]; out.g7 = pct(out.d7, w0[1]);
    if (!cumulative) out.p7 = out.g7;
    else { out.lastWeek = wk.lastWeek; out.p7 = wk.pct == null ? null : wk.pct * 100; }
  } else out.why7 = `Needs readings 7 days apart (from ${shortDay(addUtcDays(series[0][0], 7))})`;
  return out;
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDay = (day) => { const [, m, d] = String(day).slice(0, 10).split("-").map(Number); return `${MON[m - 1]} ${d}`; };

// ---------------------------------------------------------------- pure: the movers
// rows: list rows (with m); -> { up, down }: the 5 biggest % rises and drops from the day before, each row's
// every number that clears its floor (a row can show once per number)
// r10 fix: "day over day" only when the two readings fall on different New York days (mode "day"); until then the
// last two readings, labelled with their times (mode "readings", e.g. Nov 4, 7 AM -> 7 PM), so a 12-hour change
// never reads as a day. span: the earliest and latest reading time among the rows shown.
export function dayMovers(rows, { n = MOVERS_N } = {}) {
  const pick = (mode) => {
    const c = [];
    for (const r of rows) for (const k of KIND_METRICS[r.kind] || []) {
      const x = r.m?.[k];
      if (!x || x.untracked) continue;
      const d = mode === "day" ? x.d1 : x.rd, g = mode === "day" ? x.g1 : x.rg, fromV = mode === "day" ? x.prevV : x.rPrevV, fromAt = mode === "day" ? x.prevAt : x.rPrevAt;
      if (d == null || g == null || !(fromV >= FLOOR[MET[k].metric])) continue;
      // r11 fix: a rounded reading ("72.1K" -> "72.0K") moves by its rounding step without anything having changed,
      // so a change no bigger than that step isn't a mover; a bigger one is shown as "about"
      const approx = !!(x.approx || (mode === "day" ? x.prevApprox : x.rPrevApprox));
      if (approx && Math.abs(d) <= roundStep(Math.max(fromV, x.v))) continue;
      c.push({ key: r.key, name: r.name, kind: r.kind, type: r.type, image: r.image, metric: k, label: MET[k].label, from: fromV, to: x.v, fromAt, toAt: x.at, d, pct: g, src: x.src, approx, spark: k === MAIN[r.kind] && (r.spark || []).length >= 3 ? r.spark.slice(-14) : [] });
    }
    return c;
  };
  let mode = "day", c = pick("day");
  if (!c.length) { c = pick("readings"); mode = c.length ? "readings" : "day"; }
  const by = (a, b) => Math.abs(b.pct) - Math.abs(a.pct) || Math.abs(b.d) - Math.abs(a.d);
  const span = c.length ? { from: c.map((x) => x.fromAt).sort()[0], to: c.map((x) => x.toAt).sort().pop() } : null;
  return { up: c.filter((x) => x.d > 0).sort(by).slice(0, n), down: c.filter((x) => x.d < 0).sort(by).slice(0, n), n: c.length, mode, span };
}
// one metric tab: Spotify / social readings 7 days apart; the Streams tab falls back to a row's last real Luminate
// week (all platforms, labelled) until it has Spotify streams 14 days apart. Never mixed into another tab.
export function weekMovers(rows, tab, { n = MOVERS_N } = {}) {
  const c = [];
  const m = MET[tab];
  for (const r of rows) {
    const x = r.m?.[tab];
    if (x && x.d7 != null && (m.cumulative ? x.p7 != null : x.g7 != null) && x.w7v >= FLOOR[m.metric]) {
      c.push(m.cumulative
        ? { key: r.key, name: r.name, kind: r.kind, type: r.type, image: r.image, metric: tab, label: m.label, thisWeek: x.d7, lastWeek: x.lastWeek, d: x.d7 - x.lastWeek, pct: x.p7, src: x.src, from: x.w7At, to: x.at }
        : { key: r.key, name: r.name, kind: r.kind, type: r.type, image: r.image, metric: tab, label: m.label, thisWeek: x.v, lastWeek: x.w7v, d: x.d7, pct: x.g7, src: x.src, from: x.w7At, to: x.at });
    } else if (tab === "streams" && r.lum?.week && r.lum.week.pct != null && r.lum.week.last >= FLOOR.streams) {
      const w = r.lum.week;
      c.push({ key: r.key, name: r.name, kind: r.kind, type: r.type, image: r.image, metric: tab, label: "Luminate streams, week", thisWeek: w.v, lastWeek: w.last, d: w.v - w.last, pct: w.pct, src: w.src, lum: true, weeks: `${w.label} vs ${w.lastLabel}`, from: w.from, to: w.to });
    }
  }
  const by = (a, b) => Math.abs(b.pct) - Math.abs(a.pct) || Math.abs(b.d) - Math.abs(a.d);
  // r10 fix: rows are ranked only against rows of the same two weeks. Readings 7 days apart are the top group; each
  // Luminate week pair is its own group (newest first), headed once ("Luminate, Oct 23–29 vs Oct 16–22")
  const live = c.filter((x) => !x.lum);
  const pairs = [...new Set(c.filter((x) => x.lum).map((x) => x.weeks))];
  const groups = pairs.map((weeks) => {
    const g = c.filter((x) => x.lum && x.weeks === weeks);
    return { weeks, lum: true, from: g[0].from, to: g[0].to, thisLabel: weeks.split(" vs ")[0], lastLabel: weeks.split(" vs ")[1] || "", up: g.filter((x) => x.pct > 0).sort(by).slice(0, n), down: g.filter((x) => x.pct < 0).sort(by).slice(0, n), n: g.length };
  }).sort((a, b) => String(b.to).localeCompare(String(a.to)));
  return { up: live.filter((x) => x.pct > 0).sort(by).slice(0, n), down: live.filter((x) => x.pct < 0).sort(by).slice(0, n), n: c.length, groups };
}

// the day each tab's week on week can start: its own metric's first reading (New York day) + 7 days, or + 14 for a
// running total (streams, sound videos: the % needs the week before too); only a day still ahead, else the page says
// what it needs (2026-11-13: one date for every tab, so Streams said "starts Nov 11" on Nov 13 with no rows).
// snaps: oldest first. -> { streams: "Nov 18", videos: "Nov 24" }
export function weekFromOf(snaps, now) {
  const out = {};
  for (const [tab] of WEEK_TABS) {
    const m = MET[tab], first = snaps.find((s) => s.platform === m.platform && s.metric === m.metric);
    const on = first && addUtcDays(nyDay(first.taken_at), m.cumulative ? 14 : 7);
    if (on && on > nyDay(now)) out[tab] = shortDay(on);
  }
  return out;
}

// ---------------------------------------------------------------- pure: New York weeks
const nyParts = (t) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: NY, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", hour12: false }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
export const nyDay = (t) => { const p = nyParts(t); return `${p.year}-${p.month}-${p.day}`; };
const WD = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
// the New York day of the Monday that starts t's week
export const nyMonday = (t) => addDays(nyDay(t), -WD[nyParts(t).weekday]);
// "since Monday 00:00 New York": compares New York days, so no offset maths
export const inThisWeek = (t, now) => nyDay(t) >= nyMonday(now);

// ---------------------------------------------------------------- loading
const arr = (v) => (Array.isArray(v) ? v : typeof v === "string" ? JSON.parse(v || "[]") : []);
async function loadBase() {
  const [entries, tracked, clients, sounds, users, lumEntity] = await Promise.all([
    rowsOrNoneIfNoTable(sql`SELECT * FROM ar_tracker WHERE removed_at IS NULL ORDER BY added_at, id`),
    rowsOrNoneIfNoTable(sql`SELECT * FROM ar_tracked`),
    sql`SELECT id, name, role, photo, spotify, instagram, tiktok, youtube, on_roster FROM clients`,
    rowsOrNoneIfNoTable(sql`SELECT clip_id, title, author, cover, url, added_by FROM radar_sounds`),
    sql`SELECT id, name, email, role, staff_role, access FROM users WHERE role = 'staff' ORDER BY id`,
    lumEntities(),
  ]);
  const rosterBySpotify = new Map();
  for (const c of clients) { const sp = c.on_roster && spotifyId(c.spotify, "artist"); if (sp) rosterBySpotify.set(sp, c); }
  const ctx = { tracked: new Map(tracked.map((t) => [t.id, t])), clients: new Map(clients.map((c) => [c.id, c])), sounds: new Map(sounds.map((s) => [s.clip_id, s])), rosterBySpotify, lumEntity };
  return { entries, ctx, users };
}
// staff with A&R (the person tabs list every one of them, even with nothing added yet)
export function arStaff(users) {
  const anyFounder = users.some((u) => u.staff_role === "founder");
  return users.filter((u) => accessFor({ staffRole: u.staff_role, access: u.access, name: u.name }, { anyFounder }).sections.includes("ar"));
}

// a sound's title until the paid count names it: the link's own slug ("Jersey-Club-Remix-7301…" -> "Jersey Club
// Remix"), else "TikTok sound 7301…"; never a made-up title
export function soundTitle(s, clip) {
  if (s?.title) return s.title;
  const m = /tiktok\.com\/music\/([^/?#]+)/.exec(String(s?.url || ""));
  const slug = m ? decodeURIComponent(m[1]).replace(new RegExp(`-?${clip}$`), "").replace(/-/g, " ").trim() : "";
  return slug && slug.toLowerCase() !== "x" && !/^original sound$/i.test(slug) ? slug : `TikTok sound ${String(clip).slice(0, 6)}…`;
}

// the rows, before numbers: teamOf's groups with live names, the tracked row's extra fields and the links
function baseRows(entries, ctx, usersById, now) {
  const groups = teamOf(entries, ctx, { now });
  return groups.map((g) => {
    const tracked = g.subjects.map((s) => (s.startsWith("w:") ? ctx.tracked.get(s.slice(2)) : null)).find(Boolean) || null;
    const client = g.clientId ? ctx.clients.get(g.clientId) : null;
    const sound = g.kind === "sound" ? ctx.sounds.get(g.clip) : null;
    const addedBy = g.who.map((w) => {
      const e = entries.find((x) => x.id === w.entryId) || {};
      return { id: w.ownerId, entryId: w.entryId, name: ownerName(e, usersById), at: w.addedAt, days: w.days, state: w.state, daysLeft: w.daysLeft ?? null, never: !!w.never, graceLeft: w.graceLeft ?? null, source: e.source || "" };
    });
    // merged names, earliest first, each once
    const names = [...new Set(addedBy.map((w) => w.name))];
    const links = {};
    const sp = tracked?.spotify || client?.spotify || (g.kind !== "sound" ? g.link : "");
    if (sp && /spotify\.com/.test(sp)) links.spotify = sp.split("?")[0];
    const ig = tracked?.instagram || client?.instagram || (tracked && /instagram/.test(tracked.handle || "") ? tracked.handle : "");
    const igh = handleOf(ig, "instagram.com"); if (igh) links.instagram = `https://www.instagram.com/${igh}`;
    const tt = tracked?.tiktok || client?.tiktok;
    const tth = handleOf(tt, "tiktok.com"); if (tth) links.tiktok = `https://www.tiktok.com/@${tth}`;
    const yt = tracked?.youtube || client?.youtube; if (yt && youtubeRef(yt)) links.youtube = /^https?:/.test(yt) ? yt : `https://www.youtube.com/${yt}`;
    if (g.kind === "sound") links.tiktok = sound?.url && /tiktok\.com\/music\//.test(sound.url) ? sound.url : `https://www.tiktok.com/music/x-${g.clip}`;
    const match = tracked?.match || "";
    const name = g.kind === "sound" ? soundTitle(sound, g.clip) : g.name;
    const t = typeOf(g, tracked, client);
    return {
      key: g.subjects[0], subjects: g.subjects, kind: g.kind, name, artist: g.artist || "", image: g.image || "", genre: g.genre || "", roster: !!g.roster, clientId: g.clientId || null,
      trackedId: tracked?.id || null, entityId: g.entityId || null, luminateId: tracked?.luminate_id || "", isrc: tracked?.isrc || "",
      addedBy, names, addedAt: g.addedAt,
      tracking: g.roster ? { state: "live", never: true, roster: true } : { state: g.state, never: !!g.never, daysLeft: g.daysLeft ?? null, graceLeft: g.graceLeft ?? null, endsAt: g.endsAt || null },
      match, candidates: match === "name" ? arr(tracked?.match_candidates) : [], links, stage: tracked?.stage || null, notes: tracked?.notes || "",
      clip: g.clip || null, type: t.type, typeKnown: t.known,
    };
  });
}

// r11 (A2): what a row is, for its colour chip: artist | producer | song | sound. A roster row takes the roster's role
// (clients.role, e.g. "Producer"); a Watchlist artist takes ar_tracked.role (set in its drawer or the paste box);
// one nobody has set yet shows "artist" (it IS a Spotify artist profile), with known = false.
export const ROLES = ["artist", "producer"];
export function typeOf(g, tracked, client) {
  if (g.kind === "song" || g.kind === "sound") return { type: g.kind, known: true };
  const cr = String(client?.role || "").trim();
  if (g.roster && cr) return { type: /producer/i.test(cr) ? "producer" : "artist", known: true };
  const tr = String(tracked?.role || "").trim().toLowerCase();
  if (ROLES.includes(tr)) return { type: tr, known: true };
  return { type: "artist", known: false };
}

// the entity whose numbers a row shows; an artist whose Spotify match isn't confirmed has none yet
const entityOf = (r) => (r.kind === "artist" && r.match === "name" ? null : r.entityId);

async function loadSnaps(ids, { days = 45, now = Date.now() } = {}) {
  if (!ids.length) return [];
  if (days == null) return rowsOrNoneIfNoTable(sql`SELECT entity_id, platform, metric, value, taken_at, source, approx FROM data_snapshots WHERE entity_id = ANY(${ids}) ORDER BY taken_at`);
  const from = iso(new Date(now).getTime() - days * DAY);
  return rowsOrNoneIfNoTable(sql`SELECT entity_id, platform, metric, value, taken_at, source, approx FROM data_snapshots WHERE entity_id = ANY(${ids}) AND taken_at >= ${from} ORDER BY taken_at`);
}
// Luminate per row, by its Luminate id (a seeded Watchlist row) or a roster artist's client id: the newest full week
// (lum_points, else lum_history's last export) and the all-time total. All platforms, never mixed with Spotify.
async function loadLum(rows) {
  const lumIds = [...new Set(rows.map((r) => r.luminateId).filter(Boolean))];
  const clientIds = [...new Set(rows.filter((r) => r.roster && r.clientId).map((r) => r.clientId))];
  if (!lumIds.length && !clientIds.length) return { byRow: new Map(), hist: [] };
  const hist = await rowsOrNoneIfNoTable(sql`SELECT lum_id, kind, client_id, entity_id, matched_by, status, atd, atd_on::text AS atd_on, week, series FROM lum_history
    WHERE lum_id = ANY(${lumIds}) OR (kind = 'artist' AND client_id = ANY(${clientIds}))`);
  const ids = hist.map((h) => h.lum_id);
  const pts = ids.length ? await rowsOrNoneIfNoTable(sql`SELECT lum_id AS key, lum_id, kind, grain, location, period_from::text AS "from", period_to::text AS "to", value::float8 AS v FROM lum_points WHERE lum_id = ANY(${ids}) AND grain IN ('week', 'atd')`) : [];
  const weeks = { ...weekOfHistory(hist.filter((h) => h.status !== "skipped").map((h) => ({ ...h, key: h.lum_id }))), ...weekOfRows(pts.filter((p) => p.grain === "week")) };
  const atdOf = new Map();
  for (const p of pts.filter((x) => x.grain === "atd")) { const c = atdOf.get(p.lum_id); if (!c || p.to > c.on) atdOf.set(p.lum_id, { v: p.v, on: p.to }); }
  const byRow = new Map();
  for (const r of rows) {
    const h = hist.find((x) => (r.luminateId && x.lum_id === r.luminateId) || (r.roster && x.client_id === r.clientId && x.kind === "artist"));
    if (!h) continue;
    const w = weeks[h.lum_id];
    const atd = atdOf.get(h.lum_id) && (!h.atd_on || atdOf.get(h.lum_id).on >= h.atd_on) ? atdOf.get(h.lum_id) : h.atd != null ? { v: Number(h.atd), on: h.atd_on } : null;
    byRow.set(r.key, {
      lumId: h.lum_id,
      week: w ? { v: w.v, last: w.last, pct: w.pct, from: w.from, to: w.to, src: w.src, label: weekLabel(w.from, w.to), lastLabel: weekLabel(addDays(w.from, -7), addDays(w.to, -7)) } : null,
      atd: atd?.v ?? null, on: atd?.on || null, src: LUM_SRC,
    });
  }
  return { byRow, hist, pts };
}

async function loadMomentum() {
  try { const M = await import("./momentum"); return await M.computeMomentum({}); } catch { return new Map(); }
}

// numbers, Luminate and momentum onto the rows
function withNumbers(rows, snaps, lum, momentum) {
  const by = new Map();
  for (const s of snaps) { const k = `${s.entity_id}|${s.platform}|${s.metric}`; (by.get(k) || by.set(k, []).get(k)).push(s); }
  const off = !refreshOn();
  for (const r of rows) {
    const id = entityOf(r);
    r.m = {};
    for (const k of KIND_METRICS[r.kind] || []) {
      const m = MET[k];
      const c = id ? cellOf(by.get(`${id}|${m.platform}|${m.metric}`), { cumulative: m.cumulative }) : null;
      // r10 fix: a song matched by its ISRC isn't tracked until someone says it's the right song: its reading shows,
      // labelled, and it never counts as a mover
      if (c && r.kind === "song" && r.match === "isrc") { Object.assign(c, { untracked: c.reads === 1 ? "One reading, not tracked yet" : "Not tracked yet", d1: null, d7: null, rd: null, why1: "Not tracked until the match is confirmed", why7: "Not tracked until the match is confirmed" }); }
      if (c) { r.m[k] = c; continue; }
      const linked = k === "tiktok" ? !!r.links.tiktok : k === "instagram" ? !!r.links.instagram : k === "youtube" ? !!r.links.youtube : true;
      r.m[k] = { none: r.kind === "artist" && r.match === "name" && m.platform === "spotify" ? "Spotify match to confirm"
        : !linked ? `No ${m.label.split(" ")[0]} linked` : off ? "Needs a first reading (automatic updates are off)" : "Needs a first reading" };
    }
    const main = r.m[MAIN[r.kind]];
    const series = id ? nySeries(by.get(`${id}|${MET[MAIN[r.kind]].platform}|${MET[MAIN[r.kind]].metric}`) || []) : [];
    r.spark = series.slice(-30);
    r.lum = lum.byRow.get(r.key) || null;
    // r10 fix (the owner's #8: wait for real data): a momentum score only once the row has a week of readings
    // (7 New York days); before that there is no score at all, and the page hides the column
    const mo = r.kind === "artist" && id && series.length >= MOMENTUM_DAYS ? momentum.get(id) : null;
    r.momentum = r.kind !== "artist" ? null : mo ? { score: mo.score, trend: mo.trend, why: mo.why, delta: mo.delta } : { score: null, trend: null, why: r.match === "name" ? "Spotify match to confirm" : "Needs a week of readings" };
    r.main = main?.v ?? null;
  }
  return rows;
}

// "as of" per column: the newest reading in it
function asOfOf(rows) {
  const out = {};
  for (const r of rows) for (const [k, c] of Object.entries(r.m || {})) if (c?.at && (!out[k] || c.at > out[k])) out[k] = c.at;
  const lumOn = rows.map((r) => r.lum?.week?.to).filter(Boolean).sort().pop();
  if (lumOn) out.lum = lumOn;
  const atdOn = rows.map((r) => r.lum?.on).filter(Boolean).sort().pop();
  if (atdOn) out.lumAtd = atdOn;
  return out;
}

// the person chips: Everyone, then the Luminate import, then each person who added something here (r10 fix: a
// person with nothing on this list has no chip, so test and unused logins never show)
function peopleOf(rows, staff) {
  const n = new Map();
  for (const r of rows) for (const id of new Set(r.addedBy.map((w) => w.id))) n.set(id, (n.get(id) || 0) + 1);
  const people = staff.filter((u) => n.get(u.id)).map((u) => ({ id: u.id, name: displayName(u), n: n.get(u.id) || 0 }));
  if (n.has(TEAM_LUMINATE)) people.unshift({ id: TEAM_LUMINATE, name: TEAM_LUMINATE_NAME, n: n.get(TEAM_LUMINATE), team: true });
  for (const r of rows) for (const w of r.addedBy) if (!people.some((p) => p.id === w.id)) people.push({ id: w.id, name: w.name, n: n.get(w.id) || 0 });
  return [{ id: "", name: "Everyone", n: rows.length, all: true }, ...people.sort((a, b) => (b.team ? 1 : 0) - (a.team ? 1 : 0) || b.n - a.n || a.name.localeCompare(b.name))];
}

// one row as the page gets it (and nothing else: no money)
const rowOut = (r) => ({
  key: r.key, subjects: r.subjects, kind: r.kind, name: r.name, artist: r.artist, image: r.image, genre: r.genre, roster: r.roster, clientId: r.clientId, trackedId: r.trackedId,
  entityId: entityOf(r), isrc: r.isrc, addedBy: r.addedBy, names: r.names, addedAt: r.addedAt, tracking: r.tracking, match: r.match, candidates: r.candidates,
  m: r.m, lum: r.lum, momentum: r.momentum, spark: r.spark, links: r.links, stage: r.stage, main: r.main, type: r.type, typeKnown: r.typeKnown,
});
// the rows still to confirm: artists Luminate only named, and songs matched by their ISRC (r10 fix: a Yes on each)
const toConfirm = (r) => (r.kind === "artist" && r.match === "name") || (r.kind === "song" && r.match === "isrc");

// ---------------------------------------------------------------- the views
export const VIEWS = ["home", "team", "mine", "watch", "songs", "sounds", "confirm"];
export async function arLists({ view = "team", person = "", user = null, now = Date.now() } = {}) {
  const { entries, ctx, users } = await loadBase();
  const usersById = new Map(users.map((u) => [u.id, u]));
  let rows = baseRows(entries, ctx, usersById, now);
  // r10 fix (N7): Watchlist is everyone's list (Team folded in): Artists / Songs / To confirm, each with person
  // chips counted on that tab's rows (person=<userId> filters it); Mine (My A&R) is the signed-in person's
  const pick = {
    team: () => rows,
    mine: () => rows.filter((r) => r.addedBy.some((w) => w.id === user?.id)),
    watch: () => rows.filter((r) => r.kind === "artist"),
    songs: () => rows.filter((r) => r.kind === "song"),
    sounds: () => rows.filter((r) => r.kind === "sound"),
    confirm: () => rows.filter(toConfirm),
    home: () => rows,
  }[view] || (() => rows);
  rows = pick();
  const people = peopleOf(rows, arStaff(users));
  if (person && view !== "mine" && view !== "home") rows = rows.filter((r) => r.addedBy.some((w) => w.id === person));
  const ids = [...new Set(rows.map(entityOf).filter(Boolean))];
  const [snaps, lum, momentum] = await Promise.all([loadSnaps(ids, { now }), loadLum(rows), rows.some((r) => r.kind === "artist") ? loadMomentum() : new Map()]);
  withNumbers(rows, snaps, lum, momentum);
  const asOf = asOfOf(rows);
  if (view === "home") return homeOf(rows, entries, usersById, { now, asOf, snaps });
  return { view, person: person || null, me: user?.id || null, asOf, people, refresh: refreshOn(), momentumReady: rows.some((r) => r.momentum?.score != null), rows: rows.map(rowOut) };
}

// A&R Home
async function homeOf(rows, entries, usersById, { now, asOf, snaps }) {
  // freshness: each source's newest reading among the lists' rows, and Luminate's last history day
  const src = {};
  for (const s of snaps) { const k = `${s.platform}:${s.metric}`; if (!src[k] || iso(s.taken_at) > src[k]) src[k] = iso(s.taken_at); }
  const fresh = {
    streams: src["spotify:streams"] || null, listeners: src["spotify:monthly_listeners"] || null, tiktok: src["tiktok:followers"] || src["tiktok:videos"] || null,
    instagram: src["instagram:followers"] || null, youtube: src["youtube:subscribers"] || null, luminate: asOf.lum || asOf.lumAtd || null, luminateAtd: asOf.lumAtd || null, refresh: refreshOn(), // r10 fix: the weeks' last day (Oct 29), and the all-time total's own day beside it
  };
  const live = rows;
  const tiles = {
    artists: live.filter((r) => r.kind === "artist").length, songs: live.filter((r) => r.kind === "song").length, sounds: live.filter((r) => r.kind === "sound").length,
    addedThisWeek: entries.filter((e) => inThisWeek(e.added_at, now)).length,
    expiring: live.reduce((a, r) => a + r.addedBy.filter((w) => !w.never && (w.state === "soon" || w.state === "expired")).length, 0),
    toConfirm: live.filter(toConfirm).length,
  };
  const day = dayMovers(live);
  const week = {};
  for (const [tab] of WEEK_TABS) week[tab] = weekMovers(live, tab);
  const weekFrom = weekFromOf(snaps, now);
  // new adds this week, by who (in the order of their first add); the rows each opens
  const keyOf = new Map(); for (const r of live) for (const s of r.subjects) keyOf.set(s, r);
  const adds = [];
  for (const e of entries.filter((x) => inThisWeek(x.added_at, now))) {
    const name = ownerName(e, usersById);
    let p = adds.find((a) => a.id === e.owner_id);
    if (!p) { p = { id: e.owner_id, name, n: 0, items: [], last: null }; adds.push(p); }
    const r = keyOf.get(e.subject);
    p.n++; if (r && !p.items.some((i) => i.key === r.key)) p.items.push({ key: r.key, name: r.name, kind: r.kind, type: r.type, at: iso(e.added_at) });
    if (!p.last || iso(e.added_at) > p.last) p.last = iso(e.added_at);
  }
  for (const p of adds) p.items.sort((a, b) => String(b.at).localeCompare(String(a.at))); // newest first
  // about to expire: 7 days or less, and the expired ones still in their grace
  const expiring = [];
  for (const r of live) for (const w of r.addedBy) if (!w.never && (w.state === "soon" || w.state === "expired")) expiring.push({ key: r.key, name: r.name, kind: r.kind, type: r.type, who: w.name, ownerId: w.id, entryId: w.entryId, state: w.state, daysLeft: w.daysLeft, graceLeft: w.graceLeft, endsAt: expiryOf({ expires_at: null, ...entries.find((e) => e.id === w.entryId) }, now).endsAt || null });
  expiring.sort((a, b) => (a.state === "expired" ? -1 : 0) - (b.state === "expired" ? -1 : 0) || (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  // adds per week, the last 8 New York weeks, one count per person
  const mondays = []; let m = nyMonday(now); for (let i = 0; i < 8; i++) { mondays.unshift(m); m = addDays(m, -7); }
  // (r10 fix: the Luminate import isn't anyone's add, so it's left out of the weekly bars)
  const all = (await rowsOrNoneIfNoTable(sql`SELECT owner_id, owner_name, added_at FROM ar_tracker WHERE added_at >= ${iso(new Date(`${mondays[0]}T00:00:00Z`).getTime() - DAY)}`)).filter((e) => e.owner_id !== TEAM_LUMINATE);
  const weeks = mondays.map((w) => ({ week: w, label: shortDay(w), by: {} }));
  const who = new Map();
  for (const e of all) {
    const w = nyMonday(e.added_at), wk = weeks.find((x) => x.week === w);
    if (!wk) continue;
    const name = ownerName(e, usersById);
    who.set(e.owner_id, name);
    wk.by[e.owner_id] = (wk.by[e.owner_id] || 0) + 1;
  }
  const nextUpdate = fresh.refresh ? "tomorrow" : null;
  let weights = null;
  const momentumReady = live.some((r) => r.momentum?.score != null);
  if (momentumReady) { try { weights = await (await import("./momentum")).momentumWeights(); } catch { weights = null; } }
  return { view: "home", weights, momentumReady, asOf, fresh, tiles, movers: { day, week, weekFrom, tabs: WEEK_TABS.map(([k, label]) => [k, label, MET[k].cumulative ? 14 : 7]) }, adds, expiring, addsByWeek: { weeks, people: [...who].map(([id, name]) => ({ id, name })) }, nextUpdate, rows: live.length };
}

// one row's drawer: its row, every metric's full series, the Luminate history (read-only), campaign mode
export async function arItem({ key, user = null, now = Date.now() } = {}) {
  const { entries, ctx, users } = await loadBase();
  const usersById = new Map(users.map((u) => [u.id, u]));
  const rows = baseRows(entries, ctx, usersById, now);
  let r = rows.find((x) => x.key === key || x.subjects.includes(key));
  if (!r && /^w:/.test(key)) {
    // taken off everyone's list: say so (its numbers stay; adding it again brings them back)
    return { gone: true, key };
  }
  if (!r) return { gone: true, key };
  // a name match to confirm: look for the other same-name Spotify artists once (free search; 12h per row per server)
  if (r.match === "name" && r.trackedId && D.spotifyConfigured() && !(checkedAt.get(r.trackedId) > now - 12 * 3600e3)) {
    checkedAt.set(r.trackedId, now);
    const more = r.candidates.length < 3 ? await moreCandidates({ id: r.trackedId, name: r.name, have: r.candidates }).catch(() => null) : null;
    if (more) r.candidates = more;
    // r10 fix: what tells same-name profiles apart: monthly listeners (the free Spotify page) and the newest release
    if (r.candidates.some((c) => !c.info)) {
      const next = await candidateInfo(r.candidates).catch(() => null);
      if (next) { r.candidates = next; await sql`UPDATE ar_tracked SET match_candidates = ${JSON.stringify(next)}::jsonb WHERE id = ${r.trackedId} AND match = 'name'`.catch(() => {}); }
    }
  }
  // r10 fix: a row with no photo gets its Spotify photo / cover saved once (free Web API)
  if (!r.image && r.trackedId && D.spotifyConfigured() && !(photoAt.get(r.trackedId) > now - 12 * 3600e3)) {
    photoAt.set(r.trackedId, now);
    const sp = spotifyId(r.links.spotify, r.kind === "song" ? "track" : "artist");
    const x = sp ? await (r.kind === "song" ? D.spotifyTrack(sp) : D.spotifyArtist(sp)).catch(() => null) : null;
    if (x?.image && /^https:\/\/i\.scdn\.co\//.test(x.image)) {
      r.image = x.image;
      await sql`UPDATE ar_tracked SET photo = ${x.image} WHERE id = ${r.trackedId} AND photo = ''`.catch(() => {});
    }
  }
  const id = entityOf(r);
  const [snaps, lum, momentum, modes] = await Promise.all([loadSnaps(id ? [id] : [], { days: null }), loadLum([r]), r.kind === "artist" ? loadMomentum() : new Map(),
    id ? rowsOrNoneIfNoTable(sql`SELECT entity_id, mode, until FROM data_refresh WHERE entity_id = ${id}`) : []]);
  withNumbers([r], snaps, lum, momentum);
  const series = {};
  for (const [k, platform, metric, label] of METRICS) {
    const raw = snaps.filter((x) => x.platform === platform && x.metric === metric);
    const s = nySeries(raw); // r10 fix: New York days, as the table
    if (s.length) series[k] = { label, points: s, src: sourceLabel(raw[raw.length - 1]?.source), reads: raw.length, firstAt: iso(raw[0].taken_at), lastAt: iso(raw[raw.length - 1].taken_at) };
  }
  // the Luminate history: lum_points when loaded, else lum_history's all-time series and last export's two weeks
  let lumSeries = [];
  const lr = lum.byRow.get(r.key);
  if (lr) {
    const pts = await rowsOrNoneIfNoTable(sql`SELECT lum_id, kind, grain, location, period_from::text AS "from", period_to::text AS "to", value::float8 AS v FROM lum_points WHERE lum_id = ${lr.lumId}`);
    lumSeries = seriesOfRows(pts);
    if (!lumSeries.length) lumSeries = seriesOfHistory(lum.hist.filter((h) => h.lum_id === lr.lumId));
  }
  const mode = modes[0] ? { mode: modes[0].mode, until: modes[0].until } : { mode: "auto" };
  return { row: rowOut(r), notes: r.notes, series, lumSeries, mode, canCampaign: !!id && r.kind !== "song", me: user?.id || null };
}

// ---------------------------------------------------------------- matching (seeded rows)
const checkedAt = new Map(), photoAt = new Map();
// up to 3 same-name Spotify artists for a row (personKey: "Burger Marty" = "BurgerMarty"); saved on the row
async function moreCandidates({ id, name, have }) {
  const found = (await D.spotifyArtistSearch(name)).filter((a) => personKey(a.name) === personKey(name) && !have.some((h) => h.id === a.id));
  if (!found.length) return null;
  const next = [...have, ...found.slice(0, 3 - have.length).map((a) => ({ id: a.id, name: a.name, image: a.image || "" }))];
  await sql`UPDATE ar_tracked SET match_candidates = ${JSON.stringify(next)}::jsonb WHERE id = ${id} AND match = 'name'`;
  return next;
}
// each candidate's monthly listeners as the free Spotify page says them ("7.1K", rounded by Spotify) and its newest
// release (Web API, free); a candidate keeps info: { listeners, latest, releases, at } (null parts when unread)
export async function candidateInfo(cands, { page = spotifyPageListeners } = {}) {
  return Promise.all((cands || []).map(async (c) => {
    if (c.info) return c;
    const [listeners, rel] = await Promise.all([page(c.id).catch(() => null), D.spotifyReleases(c.id, { max: 10 }).catch(() => null)]);
    const own = (rel || []).filter((x) => !x.artists?.length || x.artists.includes(c.id));
    return { ...c, info: { listeners: listeners || null, latest: own[0] ? { name: own[0].name, releaseDate: own[0].releaseDate } : null, releases: rel ? own.length : null, at: iso(Date.now()) } };
  }));
}
// "Artist · 7.1K monthly listeners." on open.spotify.com/artist/<id> (no key; Spotify rounds it)
export async function spotifyPageListeners(id) {
  if (!/^[A-Za-z0-9]{22}$/.test(String(id))) return null;
  const r = await fetch(`https://open.spotify.com/artist/${id}`, { headers: { "user-agent": "Mozilla/5.0 (compatible; DefiedSite/1.0)" }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) return null;
  const html = (await r.text()).slice(0, 400000);
  const m = /<meta[^>]+property="og:description"[^>]+content="[^"]*?([\d.,]+[KMB]?) monthly listeners/i.exec(html);
  return m ? m[1] : null;
}
// verifyMatches(): a song matched by ISRC keeps its link only while Spotify's ISRC still equals Luminate's; an
// artist matched by name gets up to 2 more same-name Spotify artists to choose from. Run by the daily tick (once a
// day) and the seed step. Spotify Web API only (free); with no keys it does nothing.
export async function verifyMatches({ now = Date.now(), force = false } = {}) {
  if (!D.spotifyConfigured()) return { skipped: "no Spotify keys" };
  if (!force) {
    const [last] = await rowsOrNoneIfNoTable(sql`SELECT value FROM data_settings WHERE key = 'ar_match_check'`);
    const at = last?.value?.at ? new Date(last.value.at).getTime() : 0;
    if (now - at < 20 * 3600e3) return { skipped: "checked today" };
  }
  let rows;
  try { rows = await sql`SELECT t.id, t.kind, t.name, t.spotify, t.match, t.match_candidates, h.isrc AS lum_isrc FROM ar_tracked t LEFT JOIN lum_history h ON h.lum_id = t.luminate_id WHERE t.removed_at IS NULL AND t.match IN ('isrc', 'name')`; }
  catch (err) { if (err?.code === "42703" || err?.code === "42P01") return { skipped: "before migration 017" }; throw err; }
  const out = { songs: 0, cleared: 0, artists: 0, added: 0 };
  for (const t of rows) {
    try {
      if (t.kind === "song" && t.match === "isrc") {
        const sp = spotifyId(t.spotify, "track"); if (!sp || !t.lum_isrc) continue;
        const x = await D.spotifyTrack(sp); out.songs++;
        if (x && String(x.isrc || "").toUpperCase() !== String(t.lum_isrc).toUpperCase()) {
          await sql`UPDATE ar_tracked SET spotify = '', match = 'name', match_candidates = ${JSON.stringify([{ id: sp, name: x.name || "", image: x.image || "" }])}::jsonb WHERE id = ${t.id}`; out.cleared++;
        }
      } else if (t.kind === "artist" && t.match === "name") {
        const have = arr(t.match_candidates);
        if (have.length >= 3) continue;
        out.artists++;
        const next = await moreCandidates({ id: t.id, name: t.name, have });
        if (next) out.added += next.length - have.length;
      }
    } catch (err) { out.error = String(err?.message || err).slice(0, 160); }
  }
  await sql`INSERT INTO data_settings (key, value, updated_at) VALUES ('ar_match_check', ${JSON.stringify({ at: iso(now), ...out })}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  return out;
}

// "That's them": the Spotify artist becomes the row's link (the engine starts tracking it on its next pass).
// r10 fix: a song matched by its ISRC gets the same Yes: it becomes confirmed and its numbers switch on now
export async function confirmMatch({ id, spotifyId: sp, by = "" }) {
  const [s] = await sql`SELECT id, kind, name, artist, spotify, match FROM ar_tracked WHERE id = ${String(id)} AND removed_at IS NULL`;
  if (s?.kind === "song") {
    const tid = spotifyId(s.spotify, "track");
    if (!tid || s.match !== "isrc") throw Object.assign(new Error("That song has no match to confirm."), { status: 400 });
    await sql`UPDATE ar_tracked SET match = 'confirmed' WHERE id = ${s.id}`;
    await activateSong({ id: `t:${tid}`, name: s.name, artist: s.artist, url: `https://open.spotify.com/track/${tid}`, ref: tid });
    return { ok: true, by, active: true };
  }
  if (!/^[A-Za-z0-9]{22}$/.test(String(sp || ""))) throw Object.assign(new Error("That isn't a Spotify artist."), { status: 400 });
  const [t] = await sql`SELECT id, kind, match, match_candidates FROM ar_tracked WHERE id = ${String(id)} AND removed_at IS NULL`;
  if (!t || t.kind !== "artist") throw Object.assign(new Error("That one isn't on the Watchlist any more."), { status: 404 });
  const c = arr(t.match_candidates).find((x) => x.id === sp);
  await sql`UPDATE ar_tracked SET spotify = ${`https://open.spotify.com/artist/${sp}`}, match = 'confirmed', match_candidates = '[]'::jsonb,
    photo = CASE WHEN photo = '' THEN ${String(c?.image || "").startsWith("https://i.scdn.co/") ? c.image : ""} ELSE photo END WHERE id = ${t.id}`;
  // r11 fix: tracked from now on (its daily monthly listeners), on the entity its readings are already on
  // (l:<Luminate id> for an old-list artist), without waiting for the engine's next syncEntities pass
  const [row] = await sql`SELECT id, name, spotify, luminate_id FROM ar_tracked WHERE id = ${t.id}`;
  await activateEntity({ id: entityOfTracked(row, await lumEntities()), kind: "artist", name: row?.name || c?.name || "", url: `https://open.spotify.com/artist/${sp}`, ref: sp });
  return { ok: true, by, active: true };
}
// the confirmed song's tracked entity, on now (what the engine's syncEntities would do on its next pass)
const activateSong = (x) => activateEntity({ ...x, kind: "track" });
async function activateEntity({ id, kind, name, artist, url, ref }) {
  await sql`INSERT INTO data_entities (id, kind, name, artist, image, clients, origins, active) VALUES (${id}, ${kind}, ${name || ""}, ${artist || ""}, '', '[]'::jsonb, '["watchlist"]'::jsonb, true)
    ON CONFLICT (id) DO UPDATE SET active = true, origins = CASE WHEN data_entities.origins @> '["watchlist"]'::jsonb THEN data_entities.origins ELSE data_entities.origins || '["watchlist"]'::jsonb END, updated_at = now()`;
  await sql`INSERT INTO data_links (entity_id, platform, ref, url) VALUES (${id}, 'spotify', ${ref}, ${url}) ON CONFLICT (entity_id, platform) DO UPDATE SET ref = EXCLUDED.ref, url = EXCLUDED.url`;
}
// "Not them": the candidate goes (the next check may offer another same-name artist); a song matched by ISRC loses
// that Spotify link (paste the right one to fix it)
export async function notThem({ id, spotifyId: sp }) {
  const [s] = await sql`SELECT id, kind, match FROM ar_tracked WHERE id = ${String(id)} AND removed_at IS NULL`;
  if (s?.kind === "song" && s.match === "isrc") {
    await sql`UPDATE ar_tracked SET spotify = '', match = '' WHERE id = ${s.id}`;
    return { ok: true, left: 0, cleared: true };
  }
  const [t] = await sql`SELECT id, match_candidates FROM ar_tracked WHERE id = ${String(id)} AND removed_at IS NULL`;
  if (!t) throw Object.assign(new Error("That one isn't on the Watchlist any more."), { status: 404 });
  const next = arr(t.match_candidates).filter((x) => x.id !== sp);
  await sql`UPDATE ar_tracked SET match_candidates = ${JSON.stringify(next)}::jsonb WHERE id = ${t.id}`;
  return { ok: true, left: next.length };
}
// the drawer's notes (saved on blur) and "Add to outreach" (a Watchlist artist goes on the board's first stage)
export async function saveNotes({ id, notes }) {
  const [t] = await sql`UPDATE ar_tracked SET notes = ${String(notes ?? "").slice(0, 4000)} WHERE id = ${String(id)} AND removed_at IS NULL RETURNING id`;
  if (!t) throw Object.assign(new Error("That one isn't on the Watchlist any more."), { status: 404 });
  return { ok: true };
}
// r11 (A2): an artist's type, from its drawer's Artist/Producer switch (or the paste box's, on add: onlyIfUnset, so
// adding your name to a row never changes what someone else set). A roster row's type is the roster's role.
export async function setRole({ id, role, onlyIfUnset = false }) {
  const r = String(role || "").toLowerCase();
  if (!ROLES.includes(r)) throw Object.assign(new Error("Pick Artist or Producer."), { status: 400 });
  try {
    const [t] = onlyIfUnset
      ? await sql`UPDATE ar_tracked SET role = ${r} WHERE id = ${String(id)} AND kind = 'artist' AND removed_at IS NULL AND role IS NULL RETURNING id, role`
      : await sql`UPDATE ar_tracked SET role = ${r} WHERE id = ${String(id)} AND kind = 'artist' AND removed_at IS NULL RETURNING id, role`;
    if (!t && !onlyIfUnset) throw Object.assign(new Error("That one isn't on the Watchlist any more."), { status: 404 });
    return { ok: true, role: t?.role || null };
  } catch (e) {
    // the deploy can land before db/migrations 018-arui-role.sql: say so instead of a 503
    if (e?.code === "42703") throw Object.assign(new Error("Artist or Producer can be saved once the database update has run."), { status: 409 });
    throw e;
  }
}
// (r11: toOutreach went with Outreach; ar_tracked.stage stays, nothing sets it any more)
export { SOON_DAYS, GRACE_DAYS };
