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
import { toSeries, valueAt, addDays as addUtcDays } from "../data/math";
import { weekOfRows, weekOfHistory, seriesOfRows, seriesOfHistory, weekLabel, addDays, LUM_SRC } from "../data/lum";
import { teamOf, expiryOf, SOON_DAYS, GRACE_DAYS } from "./trackers";
import { accessFor } from "../roles";
import * as D from "../data/direct";
import { personKey } from "../names";

// ---------------------------------------------------------------- constants (the owner can ask to change these)
// a row counts as a mover only when its earlier reading clears this floor (tiny numbers swing by huge %)
export const FLOOR = { streams: 1000, monthly_listeners: 1000, followers: 100, subscribers: 100, videos: 50 };
export const MOVERS_N = 5;
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
export const TEAM_LUMINATE_NAME = "Team (from Luminate)";
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
  if (v === "youtube-api") return "YouTube Data API";
  if (v === "spotify-api" || v === "spotify-web-api") return "Spotify Web API";
  if (v.startsWith("apify/")) return v.includes("instagram") ? "Apify Instagram" : "Apify";
  if (v.includes("/")) return `Apify ${v.split("/")[0]}`;
  return v;
}

// ---------------------------------------------------------------- pure: one number's cell
const gap = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const pct = (d, base) => (d == null || base == null || !(base > 0) ? null : (d / base) * 100);
// snaps: [{ value, taken_at, source, approx }] of ONE entity, platform and metric.
//   v, at, src, approx         the newest reading
//   d1 / prevV / prevAt / g1   the change from the day before (UTC days, as lib/data/math.js); g1 = the % of the number
//   p1                         a level: the same %; a running total: today's gain against the day before's gain
//   d7 / w7v / w7At / p7       a level: now against 7 days ago (±2); a running total: the last 7 days' gain, and the
//                              % against the 7 days before
//   why1 / why7                why a change isn't there yet
export function cellOf(snaps, { cumulative = false, slack = 2 } = {}) {
  const list = (snaps || []).filter((s) => Number.isFinite(Number(s.value))).sort((a, b) => new Date(a.taken_at) - new Date(b.taken_at));
  if (!list.length) return null;
  const series = toSeries(list);
  const newest = list[list.length - 1];
  const at = (day) => { let x = null; for (const s of list) if (iso(s.taken_at).slice(0, 10) === day) x = s; return x; };
  const [day, v] = series[series.length - 1];
  const out = { v, at: iso(newest.taken_at), day, src: sourceLabel(newest.source), approx: !!newest.approx, d1: null, p1: null, g1: null, prevV: null, prevAt: null, d7: null, p7: null, g7: null, w7v: null, w7At: null, why1: "", why7: "", n: series.length, since: series[0][0] };
  const prev = series.length > 1 ? series[series.length - 2] : null;
  if (prev && gap(prev[0], day) === 1) {
    out.d1 = v - prev[1]; out.prevV = prev[1]; out.prevAt = iso(at(prev[0]).taken_at); out.g1 = pct(out.d1, prev[1]);
    if (!cumulative) out.p1 = out.g1;
    else {
      const pp = series.length > 2 ? series[series.length - 3] : null;
      const g0 = pp && gap(pp[0], prev[0]) === 1 ? prev[1] - pp[1] : null;
      out.p1 = g0 != null && g0 > 0 ? ((out.d1 - g0) / g0) * 100 : null;
    }
  } else out.why1 = series.length < 2 ? "Needs a second day" : "Needs readings on two days in a row";
  const w0 = valueAt(series.slice(0, -1), addUtcDays(day, -7), slack);
  if (w0) {
    out.w7v = w0[1]; out.w7At = iso(at(w0[0]).taken_at); out.d7 = v - w0[1]; out.g7 = pct(out.d7, w0[1]);
    if (!cumulative) out.p7 = out.g7;
    else {
      const w1 = valueAt(series.filter((p) => p[0] < w0[0]), addUtcDays(w0[0], -7), slack);
      const last = w1 ? w0[1] - w1[1] : null;
      out.lastWeek = last;
      out.p7 = last != null && last > 0 ? ((out.d7 - last) / last) * 100 : null;
    }
  } else out.why7 = `Needs readings 7 days apart (from ${shortDay(addUtcDays(series[0][0], 7))})`;
  return out;
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDay = (day) => { const [, m, d] = String(day).slice(0, 10).split("-").map(Number); return `${MON[m - 1]} ${d}`; };

// ---------------------------------------------------------------- pure: the movers
// rows: list rows (with m); -> { up, down }: the 5 biggest % rises and drops from the day before, each row's
// every number that clears its floor (a row can show once per number)
export function dayMovers(rows, { n = MOVERS_N } = {}) {
  const c = [];
  for (const r of rows) for (const k of KIND_METRICS[r.kind] || []) {
    const x = r.m?.[k];
    if (!x || x.d1 == null || x.g1 == null || !(x.prevV >= FLOOR[MET[k].metric])) continue;
    c.push({ key: r.key, name: r.name, kind: r.kind, image: r.image, metric: k, label: MET[k].label, from: x.prevV, to: x.v, fromAt: x.prevAt, toAt: x.at, d: x.d1, pct: x.g1, src: x.src, approx: x.approx, spark: k === MAIN[r.kind] ? (r.spark || []).slice(-14) : [] });
  }
  const by = (a, b) => Math.abs(b.pct) - Math.abs(a.pct) || Math.abs(b.d) - Math.abs(a.d);
  return { up: c.filter((x) => x.d > 0).sort(by).slice(0, n), down: c.filter((x) => x.d < 0).sort(by).slice(0, n), n: c.length };
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
        ? { key: r.key, name: r.name, kind: r.kind, metric: tab, label: m.label, thisWeek: x.d7, lastWeek: x.lastWeek, d: x.d7 - x.lastWeek, pct: x.p7, src: x.src, from: x.w7At, to: x.at }
        : { key: r.key, name: r.name, kind: r.kind, metric: tab, label: m.label, thisWeek: x.v, lastWeek: x.w7v, d: x.d7, pct: x.g7, src: x.src, from: x.w7At, to: x.at });
    } else if (tab === "streams" && r.lum?.week && r.lum.week.pct != null && r.lum.week.last >= FLOOR.streams) {
      const w = r.lum.week;
      c.push({ key: r.key, name: r.name, kind: r.kind, metric: tab, label: "Luminate streams, week", thisWeek: w.v, lastWeek: w.last, d: w.v - w.last, pct: w.pct, src: w.src, lum: true, weeks: `${w.label} vs ${w.lastLabel}`, from: w.from, to: w.to });
    }
  }
  const by = (a, b) => Math.abs(b.pct) - Math.abs(a.pct) || Math.abs(b.d) - Math.abs(a.d);
  return { up: c.filter((x) => x.pct > 0).sort(by).slice(0, n), down: c.filter((x) => x.pct < 0).sort(by).slice(0, n), n: c.length };
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
  const [entries, tracked, clients, sounds, users] = await Promise.all([
    rowsOrNoneIfNoTable(sql`SELECT * FROM ar_tracker WHERE removed_at IS NULL ORDER BY added_at, id`),
    rowsOrNoneIfNoTable(sql`SELECT * FROM ar_tracked`),
    sql`SELECT id, name, photo, spotify, instagram, tiktok, youtube, on_roster FROM clients`,
    rowsOrNoneIfNoTable(sql`SELECT clip_id, title, author, cover, url, added_by FROM radar_sounds`),
    sql`SELECT id, name, email, role, staff_role, access FROM users WHERE role = 'staff' ORDER BY id`,
  ]);
  const rosterBySpotify = new Map();
  for (const c of clients) { const sp = c.on_roster && spotifyId(c.spotify, "artist"); if (sp) rosterBySpotify.set(sp, c); }
  const ctx = { tracked: new Map(tracked.map((t) => [t.id, t])), clients: new Map(clients.map((c) => [c.id, c])), sounds: new Map(sounds.map((s) => [s.clip_id, s])), rosterBySpotify };
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
    return {
      key: g.subjects[0], subjects: g.subjects, kind: g.kind, name, artist: g.artist || "", image: g.image || "", genre: g.genre || "", roster: !!g.roster, clientId: g.clientId || null,
      trackedId: tracked?.id || null, entityId: g.entityId || null, luminateId: tracked?.luminate_id || "", isrc: tracked?.isrc || "",
      addedBy, names, addedAt: g.addedAt,
      tracking: g.roster ? { state: "live", never: true, roster: true } : { state: g.state, never: !!g.never, daysLeft: g.daysLeft ?? null, graceLeft: g.graceLeft ?? null, endsAt: g.endsAt || null },
      match, candidates: match === "name" ? arr(tracked?.match_candidates) : [], links, stage: tracked?.stage || null, notes: tracked?.notes || "",
      clip: g.clip || null,
    };
  });
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
      if (c) { r.m[k] = c; continue; }
      const linked = k === "tiktok" ? !!r.links.tiktok : k === "instagram" ? !!r.links.instagram : k === "youtube" ? !!r.links.youtube : true;
      r.m[k] = { none: r.kind === "artist" && r.match === "name" && m.platform === "spotify" ? "Spotify match to confirm"
        : !linked ? `No ${m.label.split(" ")[0]} linked` : off ? "Needs a first reading (automatic updates are off)" : "Needs a first reading" };
    }
    const main = r.m[MAIN[r.kind]];
    const series = id ? toSeries(by.get(`${id}|${MET[MAIN[r.kind]].platform}|${MET[MAIN[r.kind]].metric}`) || []) : [];
    r.spark = series.slice(-30);
    r.lum = lum.byRow.get(r.key) || null;
    const mo = r.kind === "artist" && id ? momentum.get(id) : null;
    r.momentum = r.kind !== "artist" ? null : mo ? { score: mo.score, trend: mo.trend, why: mo.why, delta: mo.delta } : { score: null, trend: null, why: r.match === "name" ? "Spotify match to confirm" : "Needs a second day of numbers" };
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

// the person tabs: Everyone, then the Luminate list, then every A&R staff member (even with 0)
function peopleOf(rows, staff) {
  const n = new Map();
  for (const r of rows) for (const id of new Set(r.addedBy.map((w) => w.id))) n.set(id, (n.get(id) || 0) + 1);
  const people = staff.map((u) => ({ id: u.id, name: displayName(u), n: n.get(u.id) || 0 }));
  if (n.has(TEAM_LUMINATE)) people.unshift({ id: TEAM_LUMINATE, name: TEAM_LUMINATE_NAME, n: n.get(TEAM_LUMINATE), team: true });
  for (const r of rows) for (const w of r.addedBy) if (!people.some((p) => p.id === w.id)) people.push({ id: w.id, name: w.name, n: n.get(w.id) || 0 });
  return [{ id: "", name: "Everyone", n: rows.length, all: true }, ...people.sort((a, b) => (b.team ? 1 : 0) - (a.team ? 1 : 0) || b.n - a.n || a.name.localeCompare(b.name))];
}

// one row as the page gets it (and nothing else: no money)
const rowOut = (r) => ({
  key: r.key, subjects: r.subjects, kind: r.kind, name: r.name, artist: r.artist, image: r.image, genre: r.genre, roster: r.roster, clientId: r.clientId, trackedId: r.trackedId,
  entityId: entityOf(r), isrc: r.isrc, addedBy: r.addedBy, names: r.names, addedAt: r.addedAt, tracking: r.tracking, match: r.match, candidates: r.candidates,
  m: r.m, lum: r.lum, momentum: r.momentum, spark: r.spark, links: r.links, stage: r.stage, main: r.main,
});

// ---------------------------------------------------------------- the views
export const VIEWS = ["home", "team", "mine", "watch", "songs", "sounds", "confirm"];
export async function arLists({ view = "team", person = "", user = null, now = Date.now() } = {}) {
  const { entries, ctx, users } = await loadBase();
  const usersById = new Map(users.map((u) => [u.id, u]));
  let rows = baseRows(entries, ctx, usersById, now);
  const people = peopleOf(rows, arStaff(users));
  const pick = {
    team: () => (person ? rows.filter((r) => r.addedBy.some((w) => w.id === person)) : rows),
    mine: () => rows.filter((r) => r.addedBy.some((w) => w.id === user?.id)),
    watch: () => rows.filter((r) => r.kind === "artist"),
    songs: () => rows.filter((r) => r.kind === "song"),
    sounds: () => rows.filter((r) => r.kind === "sound"),
    confirm: () => rows.filter((r) => r.kind === "artist" && r.match === "name"),
    home: () => rows,
  }[view] || (() => rows);
  rows = pick();
  const ids = [...new Set(rows.map(entityOf).filter(Boolean))];
  const [snaps, lum, momentum] = await Promise.all([loadSnaps(ids, { now }), loadLum(rows), rows.some((r) => r.kind === "artist") ? loadMomentum() : new Map()]);
  withNumbers(rows, snaps, lum, momentum);
  const asOf = asOfOf(rows);
  if (view === "home") return homeOf(rows, entries, usersById, { now, asOf, snaps });
  return { view, person: person || null, me: user?.id || null, asOf, people, refresh: refreshOn(), rows: rows.map(rowOut) };
}

// A&R Home
async function homeOf(rows, entries, usersById, { now, asOf, snaps }) {
  // freshness: each source's newest reading among the lists' rows, and Luminate's last history day
  const src = {};
  for (const s of snaps) { const k = `${s.platform}:${s.metric}`; if (!src[k] || iso(s.taken_at) > src[k]) src[k] = iso(s.taken_at); }
  const fresh = {
    streams: src["spotify:streams"] || null, listeners: src["spotify:monthly_listeners"] || null, tiktok: src["tiktok:followers"] || src["tiktok:videos"] || null,
    instagram: src["instagram:followers"] || null, youtube: src["youtube:subscribers"] || null, luminate: asOf.lumAtd || asOf.lum || null, refresh: refreshOn(),
  };
  const live = rows;
  const tiles = {
    artists: live.filter((r) => r.kind === "artist").length, songs: live.filter((r) => r.kind === "song").length, sounds: live.filter((r) => r.kind === "sound").length,
    addedThisWeek: entries.filter((e) => inThisWeek(e.added_at, now)).length,
    expiring: live.reduce((a, r) => a + r.addedBy.filter((w) => !w.never && (w.state === "soon" || w.state === "expired")).length, 0),
    toConfirm: live.filter((r) => r.kind === "artist" && r.match === "name").length,
  };
  const day = dayMovers(live);
  const week = {};
  for (const [tab] of WEEK_TABS) week[tab] = weekMovers(live, tab);
  // the first day a 7-day comparison can exist
  const firstDay = snaps.length ? iso(snaps[0].taken_at).slice(0, 10) : null;
  const weekFrom = firstDay ? shortDay(addUtcDays(firstDay, 7)) : null;
  // new adds this week, by who (in the order of their first add); the rows each opens
  const keyOf = new Map(); for (const r of live) for (const s of r.subjects) keyOf.set(s, r);
  const adds = [];
  for (const e of entries.filter((x) => inThisWeek(x.added_at, now))) {
    const name = ownerName(e, usersById);
    let p = adds.find((a) => a.id === e.owner_id);
    if (!p) { p = { id: e.owner_id, name, n: 0, items: [], last: null }; adds.push(p); }
    const r = keyOf.get(e.subject);
    p.n++; if (r && !p.items.some((i) => i.key === r.key)) p.items.push({ key: r.key, name: r.name, kind: r.kind, at: iso(e.added_at) });
    if (!p.last || iso(e.added_at) > p.last) p.last = iso(e.added_at);
  }
  for (const p of adds) p.items.sort((a, b) => String(b.at).localeCompare(String(a.at))); // newest first
  // about to expire: 7 days or less, and the expired ones still in their grace
  const expiring = [];
  for (const r of live) for (const w of r.addedBy) if (!w.never && (w.state === "soon" || w.state === "expired")) expiring.push({ key: r.key, name: r.name, kind: r.kind, who: w.name, ownerId: w.id, entryId: w.entryId, state: w.state, daysLeft: w.daysLeft, graceLeft: w.graceLeft, endsAt: expiryOf({ expires_at: null, ...entries.find((e) => e.id === w.entryId) }, now).endsAt || null });
  expiring.sort((a, b) => (a.state === "expired" ? -1 : 0) - (b.state === "expired" ? -1 : 0) || (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  // adds per week, the last 8 New York weeks, one count per person
  const mondays = []; let m = nyMonday(now); for (let i = 0; i < 8; i++) { mondays.unshift(m); m = addDays(m, -7); }
  const all = await rowsOrNoneIfNoTable(sql`SELECT owner_id, owner_name, added_at FROM ar_tracker WHERE added_at >= ${iso(new Date(`${mondays[0]}T00:00:00Z`).getTime() - DAY)}`);
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
  try { weights = await (await import("./momentum")).momentumWeights(); } catch { weights = null; }
  return { view: "home", weights, asOf, fresh, tiles, movers: { day, week, weekFrom, tabs: WEEK_TABS }, adds, expiring, addsByWeek: { weeks, people: [...who].map(([id, name]) => ({ id, name })) }, nextUpdate, rows: live.length };
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
  if (r.match === "name" && r.trackedId && r.candidates.length < 3 && D.spotifyConfigured() && !(checkedAt.get(r.trackedId) > now - 12 * 3600e3)) {
    checkedAt.set(r.trackedId, now);
    const more = await moreCandidates({ id: r.trackedId, name: r.name, have: r.candidates }).catch(() => null);
    if (more) r.candidates = more;
  }
  const id = entityOf(r);
  const [snaps, lum, momentum, modes] = await Promise.all([loadSnaps(id ? [id] : [], { days: null }), loadLum([r]), r.kind === "artist" ? loadMomentum() : new Map(),
    id ? rowsOrNoneIfNoTable(sql`SELECT entity_id, mode, until FROM data_refresh WHERE entity_id = ${id}`) : []]);
  withNumbers([r], snaps, lum, momentum);
  const series = {};
  for (const [k, platform, metric, label] of METRICS) {
    const s = toSeries(snaps.filter((x) => x.platform === platform && x.metric === metric));
    if (s.length) series[k] = { label, points: s, src: sourceLabel(snaps.filter((x) => x.platform === platform && x.metric === metric).pop()?.source) };
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
const checkedAt = new Map();
// up to 3 same-name Spotify artists for a row (personKey: "Burger Marty" = "BurgerMarty"); saved on the row
async function moreCandidates({ id, name, have }) {
  const found = (await D.spotifyArtistSearch(name)).filter((a) => personKey(a.name) === personKey(name) && !have.some((h) => h.id === a.id));
  if (!found.length) return null;
  const next = [...have, ...found.slice(0, 3 - have.length).map((a) => ({ id: a.id, name: a.name, image: a.image || "" }))];
  await sql`UPDATE ar_tracked SET match_candidates = ${JSON.stringify(next)}::jsonb WHERE id = ${id} AND match = 'name'`;
  return next;
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

// "That's them": the Spotify artist becomes the row's link (the engine starts tracking it on its next pass)
export async function confirmMatch({ id, spotifyId: sp, by = "" }) {
  if (!/^[A-Za-z0-9]{22}$/.test(String(sp || ""))) throw Object.assign(new Error("That isn't a Spotify artist."), { status: 400 });
  const [t] = await sql`SELECT id, kind, match, match_candidates FROM ar_tracked WHERE id = ${String(id)} AND removed_at IS NULL`;
  if (!t || t.kind !== "artist") throw Object.assign(new Error("That one isn't on the Watchlist any more."), { status: 404 });
  const c = arr(t.match_candidates).find((x) => x.id === sp);
  await sql`UPDATE ar_tracked SET spotify = ${`https://open.spotify.com/artist/${sp}`}, match = 'confirmed', match_candidates = '[]'::jsonb,
    photo = CASE WHEN photo = '' THEN ${String(c?.image || "").startsWith("https://i.scdn.co/") ? c.image : ""} ELSE photo END WHERE id = ${t.id}`;
  return { ok: true, by };
}
// "Not them": the candidate goes (the next check may offer another same-name artist)
export async function notThem({ id, spotifyId: sp }) {
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
export async function toOutreach({ id }) {
  const [t] = await sql`SELECT id, kind, stage FROM ar_tracked WHERE id = ${String(id)} AND removed_at IS NULL`;
  if (!t) throw Object.assign(new Error("That one isn't on the Watchlist any more."), { status: 404 });
  if (t.kind !== "artist") throw Object.assign(new Error("Only an artist goes on the outreach board."), { status: 400 });
  if (t.stage) return { ok: true, stage: t.stage, already: true };
  await sql`UPDATE ar_tracked SET stage = 'reach' WHERE id = ${t.id} AND stage IS NULL`;
  return { ok: true, stage: "reach" };
}
export { SOON_DAYS, GRACE_DAYS };
