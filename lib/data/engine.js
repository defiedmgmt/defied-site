// List B #4, the automated numbers: what to track, when it's due, and the runs that fetch it. Server only.
//   syncEntities()    the roster's artists (their Spotify / Instagram / TikTok / YouTube links), their songs
//                     with a Spotify link, the A&R watchlist's Spotify artists and songs, and everything matched
//                     from the old Luminate portfolios (lum_history, lib/data/seeds.js) -> data_entities
//   planDue()         what each source should ask about now: daily or weekly per source (Numbers › Sources),
//                     daily for an artist or sound in campaign mode, nothing for one switched off
//   startApifyRuns()  one Apify run per source with work due, inside its monthly budget, the total budget and
//                     the Apify account's hard limit; each run has its own charge cap. Runs are async: they're
//                     collected by the next cron tick, or at once by Apify's webhook (pages/api/data-hook.js)
//   collectRuns()     reads finished runs into dated snapshots. A failed run writes nothing, so the last good
//                     numbers stay (the page says "last updated <date>"), and its songs are asked again next time
//   runDirect()       the free APIs, in the same tick: YouTube, and the Spotify catalogs (new releases)
//   tick()            the cron: collect, sync, free APIs, then start what's due
// Nothing here runs a paid scraper unless DATA_REFRESH is "on" (default off) and APIFY_TOKEN is set.
import crypto from "node:crypto";
import { sql as dbSql, rowsOrNoneIfNoTable } from "../db";
import { SOURCES, SOURCE_KEYS, ADAPTERS, SCHEDULE_DAYS, MAX_PER_RUN, TOTAL_CAP_USD, sourceSettings, estUsd, runCapUsd, spotifyId, handleOf, youtubeRef } from "./sources";
import * as D from "./direct";

// the real-data script points this at a copy of the database; everything else uses lib/db.js
let sqlImpl = dbSql;
export const useSql = (fn) => { sqlImpl = fn || dbSql; };
const sql = (...a) => sqlImpl(...a);
export const dataSql = sql;

const HOUR = 3600000, DAY = 24 * HOUR;
export const refreshOn = () => /^(on|true|1|yes)$/i.test(String(process.env.DATA_REFRESH || "").trim());
const newId = () => `r${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
const arr = (v) => (Array.isArray(v) ? v : typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []);
const iso = (d) => new Date(d).toISOString();
const notInline = (s) => (String(s || "").startsWith("data:") ? "" : String(s || ""));
const SYNCED = ["roster", "placement", "watchlist", "luminate"];
const ALBUMS_PER_TICK = 25;
export const STALE_AFTER_HOURS = 6;

// ---------------------------------------------------------------- settings
export async function loadSettings() {
  const rows = await rowsOrNoneIfNoTable(sql`SELECT key, value FROM data_settings`);
  const v = Object.fromEntries(rows.map((r) => [r.key, typeof r.value === "string" ? JSON.parse(r.value) : r.value]));
  const total = Number(v.caps?.totalUsd);
  return { sources: sourceSettings(v.sources), totalCapUsd: Number.isFinite(total) && total >= 0 ? Math.min(total, 19) : TOTAL_CAP_USD, account: v.apify_account || null };
}
export async function saveSetting(key, value) {
  await sql`INSERT INTO data_settings (key, value, updated_at) VALUES (${key}, ${JSON.stringify(value)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

// ---------------------------------------------------------------- what is tracked
export async function syncEntities() {
  const [clients, placements, watch, existing, seeds, owners] = await Promise.all([
    sql`SELECT id, name, photo, spotify, instagram, tiktok, youtube, on_roster FROM clients`,
    sql`SELECT client_id, song, artist, link, cover FROM placements WHERE link LIKE ${"%spotify.com/%track/%"}`,
    // (r10 A&R lists: + the artist's confirmed other profiles, migration 017; before it, the Spotify link only)
    rowsOrNoneIfNoTable(sql`SELECT id, kind, name, artist, spotify, instagram, tiktok, youtube, match FROM ar_tracked WHERE removed_at IS NULL AND (spotify <> '' OR instagram <> '' OR tiktok <> '' OR youtube <> '')`)
      .catch((err) => { if (err?.code !== "42703") throw err; return sql`SELECT id, kind, name, artist, spotify FROM ar_tracked WHERE removed_at IS NULL AND spotify <> ''`; }),
    sql`SELECT id, origins, clients FROM data_entities`,
    // the old Luminate portfolios' rows matched to Spotify (none before migration 012)
    rowsOrNoneIfNoTable(sql`SELECT kind, name, artist, spotify_id, spotify_image, entity_id, client_id, placement_ids, socials FROM lum_history WHERE status = 'matched' AND entity_id IS NOT NULL AND spotify_id <> ''`),
    sql`SELECT id, client_id FROM placements`,
  ]);
  const roster = new Set(clients.filter((c) => c.on_roster).map((c) => c.id));
  const want = new Map();
  const add = (id, base, origin, clientId, links) => {
    const w = want.get(id) || { id, ...base, clients: new Set(), origins: new Set(), links: {} };
    if (!w.name && base.name) Object.assign(w, base, { clients: w.clients, origins: w.origins, links: w.links });
    w.origins.add(origin);
    if (clientId) w.clients.add(clientId);
    Object.assign(w.links, links);
    want.set(id, w);
  };
  for (const c of clients) {
    if (!c.on_roster) continue;
    const l = {};
    const sp = spotifyId(c.spotify, "artist"); if (sp) l.spotify = { ref: sp, url: `https://open.spotify.com/artist/${sp}` };
    const ig = handleOf(c.instagram, "instagram.com"); if (ig) l.instagram = { ref: ig, url: `https://www.instagram.com/${ig}` };
    const tt = handleOf(c.tiktok, "tiktok.com"); if (tt) l.tiktok = { ref: tt, url: `https://www.tiktok.com/@${tt}` };
    const yt = youtubeRef(c.youtube); if (yt) l.youtube = { ref: yt, url: c.youtube };
    add(`a:${c.id}`, { kind: "artist", name: c.name, artist: "", image: notInline(c.photo) }, "roster", c.id, l);
  }
  for (const p of placements) {
    const id = spotifyId(p.link, "track");
    if (!id || !roster.has(p.client_id)) continue;
    add(`t:${id}`, { kind: "track", name: p.song, artist: p.artist, image: notInline(p.cover) }, "placement", p.client_id, { spotify: { ref: id, url: `https://open.spotify.com/track/${id}` } });
  }
  // list B #5: a Watchlist artist or song whose every tracker entry has run out isn't refreshed (it costs
  // nothing until someone renews it; its numbers stay)
  const paused = await import("../ar/trackers").then((T) => T.pausedSubjects()).catch(() => new Set());
  for (const w of watch) {
    if (paused.has(`w:${w.id}`)) continue;
    // r10 fix: a song matched by its ISRC waits for a person's Yes (A&R › Watchlist › To confirm) before it's tracked
    if (w.kind === "song" && w.match === "isrc") continue;
    const kind = w.kind === "song" ? "track" : "artist";
    const id = spotifyId(w.spotify, kind === "track" ? "track" : "artist");
    const l = id ? { spotify: { ref: id, url: `https://open.spotify.com/${kind}/${id}` } } : {};
    if (kind === "artist") {
      const ig = handleOf(w.instagram, "instagram.com"); if (ig) l.instagram = { ref: ig, url: `https://www.instagram.com/${ig}` };
      const tt = handleOf(w.tiktok, "tiktok.com"); if (tt) l.tiktok = { ref: tt, url: `https://www.tiktok.com/@${tt}` };
      const yt = youtubeRef(w.youtube); if (yt) l.youtube = { ref: yt, url: w.youtube };
    }
    if (!Object.keys(l).length || (kind === "track" && !id)) continue;
    add(kind === "track" ? `t:${id}` : `w:${w.id}`, { kind, name: w.name, artist: w.artist || "", image: "" }, "watchlist", null, l);
  }
  // Luminate's starting list: its songs (with the roster clients whose songs they are) and its artists
  // (a client, an A&R Watchlist artist, or one only the Artist Tracker had) with the socials staff gave them
  const ownerOf = new Map(owners.map((p) => [p.id, p.client_id]));
  for (const r of seeds) {
    if (r.kind === "artist") {
      const sp = r.spotify_id, so = typeof r.socials === "string" ? JSON.parse(r.socials || "{}") : r.socials || {};
      const l = { spotify: { ref: sp, url: `https://open.spotify.com/artist/${sp}` } };
      if (r.entity_id.startsWith("a:") && roster.has(r.entity_id.slice(2))) { add(r.entity_id, { kind: "artist", name: r.name, artist: "", image: "" }, "luminate", r.entity_id.slice(2), {}); continue; }
      const ig = handleOf(so.instagram, "instagram.com"); if (ig) l.instagram = { ref: ig, url: `https://www.instagram.com/${ig}` };
      const tt = handleOf(so.tiktok, "tiktok.com"); if (tt) l.tiktok = { ref: tt, url: `https://www.tiktok.com/@${tt}` };
      const yt = youtubeRef(so.youtube); if (yt) l.youtube = { ref: yt, url: so.youtube };
      add(r.entity_id, { kind: "artist", name: r.name, artist: "", image: notInline(r.spotify_image) }, "luminate", null, l);
    } else {
      const ids = Array.isArray(r.placement_ids) ? r.placement_ids : JSON.parse(r.placement_ids || "[]");
      const cs = [...new Set(ids.map((id) => ownerOf.get(id)).filter((c) => c && roster.has(c)))];
      const id = `t:${r.spotify_id}`;
      add(id, { kind: "track", name: r.name, artist: r.artist || "", image: notInline(r.spotify_image) }, "luminate", cs[0] || null, { spotify: { ref: r.spotify_id, url: `https://open.spotify.com/track/${r.spotify_id}` } });
      for (const c of cs.slice(1)) want.get(id).clients.add(c);
    }
  }
  const old = new Map(existing.map((e) => [e.id, e]));
  const rows = [];
  for (const w of want.values()) {
    const o = old.get(w.id);
    const keep = o ? arr(o.origins).filter((x) => !SYNCED.includes(x)) : [];
    const keepClients = o && keep.includes("catalog") ? arr(o.clients) : [];
    rows.push({ id: w.id, kind: w.kind, name: w.name || "", artist: w.artist || "", image: w.image || "", clients: [...new Set([...w.clients, ...keepClients])], origins: [...new Set([...keep, ...w.origins])] });
  }
  // gone from the roster / the songs / the watchlist: those origins go, and with none left it's inactive
  const gone = existing.filter((e) => !want.has(e.id) && arr(e.origins).some((x) => SYNCED.includes(x)))
    .map((e) => ({ id: e.id, origins: arr(e.origins).filter((x) => !SYNCED.includes(x)) }));
  if (rows.length) await sql`
    INSERT INTO data_entities (id, kind, name, artist, image, clients, origins, active)
    SELECT x.id, x.kind, x.name, x.artist, x.image, x.clients, x.origins, true
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(id text, kind text, name text, artist text, image text, clients jsonb, origins jsonb)
    ON CONFLICT (id) DO UPDATE SET
      name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE data_entities.name END,
      artist = CASE WHEN EXCLUDED.artist <> '' THEN EXCLUDED.artist ELSE data_entities.artist END,
      image = CASE WHEN EXCLUDED.image <> '' THEN EXCLUDED.image ELSE data_entities.image END,
      clients = EXCLUDED.clients, origins = EXCLUDED.origins, active = true, updated_at = now()`;
  if (gone.length) await sql`
    UPDATE data_entities e SET origins = g.origins, active = jsonb_array_length(g.origins) > 0, updated_at = now()
    FROM jsonb_to_recordset(${JSON.stringify(gone)}::jsonb) AS g(id text, origins jsonb) WHERE e.id = g.id`;
  // links: the synced ones as they are now; a link taken off a client's profile goes
  const links = [...want.values()].flatMap((w) => Object.entries(w.links).map(([platform, l]) => ({ entity_id: w.id, platform, ref: l.ref, url: l.url })));
  if (links.length) await sql`
    INSERT INTO data_links (entity_id, platform, ref, url)
    SELECT x.entity_id, x.platform, x.ref, x.url FROM jsonb_to_recordset(${JSON.stringify(links)}::jsonb) AS x(entity_id text, platform text, ref text, url text)
    ON CONFLICT (entity_id, platform) DO UPDATE SET ref = EXCLUDED.ref, url = EXCLUDED.url`;
  const artistIds = [...want.values()].filter((w) => w.id.startsWith("a:")).map((w) => w.id);
  const keepKeys = links.filter((l) => l.entity_id.startsWith("a:")).map((l) => `${l.entity_id}|${l.platform}`);
  if (artistIds.length) await sql`DELETE FROM data_links WHERE entity_id = ANY(${artistIds}) AND platform = ANY(${["spotify", "instagram", "tiktok", "youtube"]}) AND NOT ((entity_id || '|' || platform) = ANY(${keepKeys.length ? keepKeys : ["-"]}))`;
  return { tracked: rows.length, deactivated: gone.filter((g) => !g.origins.length).length };
}

// ---------------------------------------------------------------- state + plan
export async function loadState() {
  const [entities, links, checks, refresh, settings] = await Promise.all([
    rowsOrNoneIfNoTable(sql`SELECT id, kind, name, artist, image, release_date, isrc, parent_id, clients, origins, active, created_at FROM data_entities ORDER BY created_at, id`),
    rowsOrNoneIfNoTable(sql`SELECT entity_id, platform, ref, url FROM data_links`),
    rowsOrNoneIfNoTable(sql`SELECT entity_id, source, checked_at FROM data_checks`),
    rowsOrNoneIfNoTable(sql`SELECT entity_id, mode, until FROM data_refresh`),
    loadSettings(),
  ]);
  return { entities: entities.map((e) => ({ ...e, clients: arr(e.clients), origins: arr(e.origins) })), links, checks, refresh, settings };
}

// a live refresh setting: campaign / off, unless its end date has passed
export function modeFor(e, refresh, now = Date.now()) {
  const m = new Map(refresh.map((r) => [r.entity_id, r]));
  const live = (id) => { const r = id && m.get(id); return r && (!r.until || new Date(r.until).getTime() > now) ? r.mode : null; };
  const own = live(e.id);
  if (own) return own;
  // a song follows its artist's campaign (songs are daily anyway; an artist switched off stops its songs)
  const up = [e.parent_id, ...(e.clients || []).map((c) => `a:${c}`)].map(live).filter(Boolean);
  return up.includes("off") && !up.includes("campaign") ? "off" : up.includes("campaign") ? "campaign" : null;
}

// { [source]: [{ entityId, ref, url, kind, key, campaign }] }, campaign ones first, then the longest unasked
export function planDue({ now = new Date(), settings, entities, links, checks, refresh }) {
  const t = new Date(now).getTime();
  const byId = new Map(entities.map((e) => [e.id, e]));
  const linkOf = new Map(links.map((l) => [`${l.entity_id}|${l.platform}`, l]));
  const checked = new Map(checks.map((c) => [`${c.entity_id}|${c.source}`, new Date(c.checked_at).getTime()]));
  const due = {};
  for (const key of SOURCE_KEYS) {
    const S = SOURCES[key], cfg = settings.sources[key];
    const list = [], isrcs = new Set();
    for (const e of entities) {
      if (!e.active || e.kind !== S.kind) continue;
      if (S.rosterOnly && !e.origins.includes("roster")) continue;
      if (e.parent_id && byId.has(e.parent_id) && !byId.get(e.parent_id).active && !e.origins.some((o) => SYNCED.includes(o))) continue;
      const l = linkOf.get(`${e.id}|${S.link}`);
      if (!l) continue;
      if (e.isrc) { if (isrcs.has(e.isrc)) continue; isrcs.add(e.isrc); } // the same song under another Spotify id
      const mode = modeFor(e, refresh, t);
      if (mode === "off") continue;
      // (r10 A&R lists: a Watchlist artist's monthly listeners come daily, about $0.03 an artist a month at 0.1¢, so the
      // lists' day-over-day works; its TikTok and Instagram stay weekly unless campaign mode is on)
      const days = mode === "campaign" || (key === "spotify_listeners" && e.origins.includes("watchlist")) ? 1 : SCHEDULE_DAYS[cfg.schedule];
      const last = checked.get(`${e.id}|${key}`) || 0;
      if (last && t - last < days * DAY - 3 * HOUR) continue;
      list.push({ entityId: e.id, ref: l.ref, url: l.url, kind: e.kind, key: String(l.ref).toLowerCase(), campaign: mode === "campaign", last });
    }
    due[key] = list.sort((a, b) => Number(b.campaign) - Number(a.campaign) || a.last - b.last);
  }
  return due;
}

// this calendar month's spend per source (what Apify charged, else the estimate), and the total
export async function monthSpend(now = new Date()) {
  const d = new Date(now), start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const rows = await rowsOrNoneIfNoTable(sql`SELECT source, COALESCE(SUM(COALESCE(usd, est_usd)), 0)::float8 AS usd FROM data_runs WHERE started_at >= ${start.toISOString()} AND status <> 'skipped' GROUP BY source`);
  const out = { total: 0 };
  for (const r of rows) { out[r.source] = Number(r.usd) || 0; out.total += Number(r.usd) || 0; }
  return out;
}

// ---------------------------------------------------------------- snapshots
// parsed [{ key, metric, value, alt?, approx?, isrc?, … }] -> data_snapshots for the run's targets only
export async function writeValues(source, adapter, targets, parsed, { runId, takenAt, hits = null }) {
  const S = SOURCES[source];
  const byKey = new Map(targets.map((t) => [String(t.ref).toLowerCase(), t]));
  const rows = [], meta = [], seen = new Set();
  for (const p of parsed) {
    const t = byKey.get(p.key) || (p.alt || []).map((a) => byKey.get(a)).find(Boolean);
    if (!t || !S.metrics.includes(p.metric) || !Number.isFinite(p.value)) continue;
    const k = `${t.entityId}|${p.metric}`;
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push({ entity_id: t.entityId, platform: S.platform, metric: p.metric, value: Math.round(p.value), taken_at: iso(takenAt), source: ADAPTERS[adapter]?.actor || adapter, approx: !!p.approx, run_id: runId });
    if (p.isrc || p.name || p.artist || p.image || p.releaseDate) meta.push({ id: t.entityId, isrc: p.isrc || "", name: p.name || "", artist: p.artist || "", image: /^https:\/\/i\.scdn\.co\//.test(p.image || "") ? p.image : "", release_date: p.releaseDate || "" });
  }
  hits?.push(...new Set(rows.map((r) => r.entity_id)));
  if (rows.length) await sql`
    INSERT INTO data_snapshots (entity_id, platform, metric, value, taken_at, source, approx, run_id)
    SELECT x.entity_id, x.platform, x.metric, x.value, x.taken_at, x.source, x.approx, x.run_id
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(entity_id text, platform text, metric text, value bigint, taken_at timestamptz, source text, approx boolean, run_id text)
    ON CONFLICT DO NOTHING`;
  if (meta.length) await sql`
    UPDATE data_entities e SET
      isrc = CASE WHEN e.isrc = '' THEN m.isrc ELSE e.isrc END,
      name = CASE WHEN e.name = '' THEN m.name ELSE e.name END,
      artist = CASE WHEN e.artist = '' THEN m.artist ELSE e.artist END,
      image = CASE WHEN e.image = '' THEN m.image ELSE e.image END,
      release_date = CASE WHEN e.release_date = '' THEN m.release_date ELSE e.release_date END,
      updated_at = now()
    FROM jsonb_to_recordset(${JSON.stringify(meta)}::jsonb) AS m(id text, isrc text, name text, artist text, image text, release_date text) WHERE e.id = m.id`;
  return rows.length;
}
// asked and answered; a target that got no number this time (not found, or the scraper stopped early)
// is due again in a day, not after its whole week
export async function markAsked(source, targets, hits, at) {
  const got = new Set(hits);
  await markChecked(source, targets.filter((t) => got.has(t.entityId)).map((t) => t.entityId), at);
  const days = SCHEDULE_DAYS[(await loadSettings()).sources[source]?.schedule] || 1;
  if (days > 1) await markChecked(source, targets.filter((t) => !got.has(t.entityId)).map((t) => t.entityId), new Date(new Date(at).getTime() - (days - 1) * DAY));
  else await markChecked(source, targets.filter((t) => !got.has(t.entityId)).map((t) => t.entityId), at);
}
export async function markChecked(source, ids, at) {
  if (!ids.length) return;
  await sql`INSERT INTO data_checks (entity_id, source, checked_at) SELECT unnest(${ids}::text[]), ${source}, ${iso(at)}
    ON CONFLICT (entity_id, source) DO UPDATE SET checked_at = EXCLUDED.checked_at`;
}
const runRow = (r) => sql`INSERT INTO data_runs (id, source, adapter, actor, apify_run_id, dataset_id, status, targets, items, snapshots, est_usd, usd, error, started_at, finished_at)
  VALUES (${r.id}, ${r.source}, ${r.adapter}, ${r.actor || ""}, ${r.apifyRunId || null}, ${r.datasetId || null}, ${r.status}, ${JSON.stringify(r.targets || [])}::jsonb, ${r.items ?? null}, ${r.snapshots ?? null}, ${r.estUsd || 0}, ${r.usd ?? null}, ${String(r.error || "").slice(0, 300)}, ${iso(r.startedAt)}, ${r.finishedAt ? iso(r.finishedAt) : null})`;
// one "skipped" line a day per source is enough to say why it didn't run
async function skip(source, adapter, error, now) {
  const today = iso(now).slice(0, 10);
  const had = await sql`SELECT 1 FROM data_runs WHERE source = ${source} AND status = 'skipped' AND started_at >= ${`${today}T00:00:00Z`} LIMIT 1`;
  if (!had.length) await runRow({ id: newId(), source, adapter, status: "skipped", error, startedAt: now, finishedAt: now });
  return { source, skipped: error };
}

// ---------------------------------------------------------------- Apify: start, collect
export async function startApifyRuns({ now = new Date(), state } = {}) {
  if (!refreshOn()) return { off: true };
  if (!D.apifyConfigured()) return { noKey: true };
  const st = state || await loadState();
  const due = planDue({ ...st, now });
  const work = SOURCE_KEYS.filter((k) => ADAPTERS[st.settings.sources[k].adapter]?.actor && due[k].length);
  if (!work.length) return { started: [] };
  const open = new Set((await sql`SELECT source FROM data_runs WHERE status IN ('started', 'collecting')`).map((r) => r.source));
  const spent = await monthSpend(now);
  // the account's hard limit: without it, nothing starts
  let account = null;
  try { account = await D.apifyLimits(); await saveSetting("apify_account", { ...account, at: iso(now) }); }
  catch (err) { return { started: [], error: `Couldn't read the Apify account's limit, so nothing was started (${err.message}).` }; }
  const out = [];
  for (const key of work) {
    const S = SOURCES[key], cfg = st.settings.sources[key], ad = ADAPTERS[cfg.adapter];
    if (open.has(key)) { out.push({ source: key, waiting: true }); continue; }
    const left = Math.min(cfg.softCapUsd - (spent[key] || 0), st.settings.totalCapUsd - spent.total);
    const n = Math.min(due[key].length, MAX_PER_RUN, ad.price.per > 0 ? Math.floor((left - ad.price.start) / ad.price.per + 1e-9) : MAX_PER_RUN);
    if (n <= 0) { out.push(await skip(key, cfg.adapter, `This month's budget is used up (${S.label}: $${(spent[key] || 0).toFixed(2)} of $${cfg.softCapUsd}; all sources $${spent.total.toFixed(2)} of $${st.settings.totalCapUsd}).`, now)); continue; }
    const batch = due[key].slice(0, n), cap = runCapUsd(cfg.adapter, n), est = estUsd(cfg.adapter, n);
    if (account.limitUsd - account.usageUsd < cap) { out.push(await skip(key, cfg.adapter, `Apify's monthly limit is almost reached ($${account.usageUsd.toFixed(2)} of $${account.limitUsd}).`, now)); continue; }
    const id = newId();
    try {
      const run = await D.apifyStart(ad.actor, ad.input(batch), { capUsd: cap });
      await runRow({ id, source: key, adapter: cfg.adapter, actor: ad.actor, apifyRunId: run.id, datasetId: run.defaultDatasetId, status: "started", targets: batch.map((t) => ({ entityId: t.entityId, ref: t.ref })), estUsd: est, startedAt: now });
      account.usageUsd += cap; spent[key] = (spent[key] || 0) + est; spent.total += est;
      out.push({ source: key, started: batch.length, estUsd: est, capUsd: cap });
    } catch (err) {
      await runRow({ id, source: key, adapter: cfg.adapter, actor: ad.actor, status: "failed", error: err.message, startedAt: now, finishedAt: now });
      out.push({ source: key, error: err.message });
    }
  }
  return { started: out };
}

// what a finished run cost: its charged events x the actor's prices (they can post late: then the estimate)
const EVENT_PRICE = {
  eduair94: { "result-item": 0.001 }, beatanalytics: { "apify-default-dataset-item": 0.004 }, "apify-instagram": { profile: 0.0026, "about-account": 0.007 },
  apidojo: { "apify-default-dataset-item": 0.0003 }, clockworks: { result: 0.003 }, khadinakbar: { "apify-actor-start": 0.00005, "sound-scraped": 0.003, "video-scraped": 0.0015 }, "clockworks-sound": { result: 0.005 },
};
export function chargedUsd(adapter, run, fallback) {
  const p = EVENT_PRICE[adapter] || {};
  const ev = Object.entries(run?.chargedEventCounts || {}).reduce((a, [k, n]) => a + (p[k] || 0) * (Number(n) || 0), 0);
  const v = Math.max(ev, Number(run?.usageTotalUsd) || 0);
  return v > 0 ? Math.round(v * 10000) / 10000 : fallback;
}

async function finishRun(r, run, now) {
  const claimed = await sql`UPDATE data_runs SET status = 'collecting' WHERE id = ${r.id} AND status = 'started' RETURNING id`;
  if (!claimed.length) return { id: r.id, already: true }; // the webhook and the cron both came: once
  const targets = arr(r.targets);
  try {
    const items = run.defaultDatasetId || r.dataset_id ? await D.apifyItems(run.defaultDatasetId || r.dataset_id) : [];
    const usd = chargedUsd(r.adapter, run, Number(r.est_usd) || 0);
    if (run.status !== "SUCCEEDED" && !items.length) {
      await sql`UPDATE data_runs SET status = 'failed', items = 0, snapshots = 0, usd = ${usd}, error = ${`Apify said ${run.status}. The last numbers stay.`}, finished_at = ${iso(now)} WHERE id = ${r.id}`;
      return { id: r.id, failed: run.status };
    }
    // list B #6: the sound radar's runs have their own reader (lib/ar/radar.js)
    if (r.source === "radar" || r.source === "radar_sounds") {
      const R = await import("../ar/radar");
      const res = await R.readRadarRun(r, items, { takenAt: run.finishedAt || now, now });
      await sql`UPDATE data_runs SET status = 'done', items = ${items.length}, snapshots = ${res.snapshots}, usd = ${usd}, error = ${run.status !== "SUCCEEDED" ? `Apify said ${run.status}; kept what came back.` : ""}, finished_at = ${iso(now)} WHERE id = ${r.id}`;
      return { id: r.id, source: r.source, snapshots: res.snapshots };
    }
    const hits = [];
    const n = await writeValues(r.source, r.adapter, targets, ADAPTERS[r.adapter].parse(items), { runId: r.id, takenAt: run.finishedAt || now, hits });
    // the radar's free seed: the sounds on our tracked artists' latest TikTok videos
    if (r.source === "tiktok") await import("../ar/radar").then((R) => R.seedFromProfiles(items, targets)).catch((err) => console.error("radar seeds:", err));
    await markAsked(r.source, targets, hits, now);
    const miss = targets.length - hits.length;
    const note = run.status !== "SUCCEEDED" ? `Apify said ${run.status}; kept what came back.` : miss > 0 ? `${miss} had no number this time (asked again tomorrow).` : "";
    await sql`UPDATE data_runs SET status = 'done', items = ${items.length}, snapshots = ${n}, usd = ${usd}, error = ${note}, finished_at = ${iso(now)} WHERE id = ${r.id}`;
    return { id: r.id, source: r.source, snapshots: n };
  } catch (err) {
    // the items couldn't be read: try again next time (a run's dataset is kept for days)
    await sql`UPDATE data_runs SET status = 'started', error = ${String(err.message).slice(0, 300)} WHERE id = ${r.id}`;
    return { id: r.id, error: err.message };
  }
}
export async function collectRuns({ now = new Date() } = {}) {
  if (!D.apifyConfigured()) return { noKey: true };
  const open = await rowsOrNoneIfNoTable(sql`SELECT * FROM data_runs WHERE status = 'started' AND apify_run_id IS NOT NULL ORDER BY started_at`);
  const out = [];
  for (const r of open) {
    try {
      const run = await D.apifyRun(r.apify_run_id);
      if (D.TERMINAL.has(run.status)) out.push(await finishRun(r, run, now));
      else if (new Date(now) - new Date(r.started_at) > STALE_AFTER_HOURS * HOUR) {
        await sql`UPDATE data_runs SET status = 'failed', error = ${`It hadn't finished after ${STALE_AFTER_HOURS} hours. The last numbers stay.`}, finished_at = ${iso(now)} WHERE id = ${r.id} AND status = 'started'`;
        out.push({ id: r.id, failed: "stale" });
      } else out.push({ id: r.id, running: run.status });
    } catch (err) { out.push({ id: r.id, error: err.message }); }
  }
  return { collected: out };
}
// the webhook: only a run we started, and its numbers re-read from Apify (never taken from the call)
export async function collectApifyRun(apifyRunId, { now = new Date() } = {}) {
  const [r] = await sql`SELECT * FROM data_runs WHERE apify_run_id = ${String(apifyRunId)}`;
  if (!r) return { unknown: true };
  if (r.status !== "started") return { already: r.status };
  const run = await D.apifyRun(r.apify_run_id);
  if (!D.TERMINAL.has(run.status)) return { running: run.status };
  return finishRun(r, run, now);
}

// ---------------------------------------------------------------- the free APIs
export async function runDirect({ now = new Date(), state } = {}) {
  if (!refreshOn()) return { off: true };
  const st = state || await loadState();
  const due = planDue({ ...st, now });
  const out = {};
  if (due.youtube.length && D.youtubeConfigured()) {
    const id = newId(), targets = due.youtube.slice(0, 200);
    try {
      const res = await D.youtubeStats(targets.map((t) => ({ key: t.key, ref: t.ref })));
      const hits = [];
      const n = await writeValues("youtube", "youtube-api", targets, res.flatMap((r) => r.values.map((v) => ({ key: r.key, metric: v.metric, value: v.value }))), { runId: id, takenAt: now, hits });
      await markAsked("youtube", targets, hits, now);
      await runRow({ id, source: "youtube", adapter: "youtube-api", status: "done", targets: targets.map((t) => ({ entityId: t.entityId, ref: t.ref })), items: res.length, snapshots: n, usd: 0, error: res.length < targets.length ? `${targets.length - res.length} channel(s) not found.` : "", startedAt: now, finishedAt: new Date() });
      out.youtube = { channels: res.length, snapshots: n };
    } catch (err) {
      await runRow({ id, source: "youtube", adapter: "youtube-api", status: "failed", error: err.message, startedAt: now, finishedAt: new Date() });
      out.youtube = { error: err.message };
    }
  }
  if (due.spotify_catalog.length && D.spotifyConfigured()) out.catalog = await readCatalogs(due.spotify_catalog, st, now);
  return out;
}

// each roster artist's releases; songs on a release we haven't read yet become tracked songs (a
// release they only appear on: just their songs). The newest releases are read first.
export async function readCatalogs(targets, st, now = new Date()) {
  const id = newId();
  const byId = new Map(st.entities.map((e) => [e.id, e]));
  let albumsRead = 0, songs = 0, error = "";
  const done = [];
  for (const t of targets) {
    if (albumsRead >= ALBUMS_PER_TICK) break;
    const artist = byId.get(t.entityId);
    try {
      const releases = await D.spotifyReleases(t.ref);
      const seen = new Set((await sql`SELECT album_id FROM data_albums WHERE album_id = ANY(${releases.map((r) => r.id)})`).map((r) => r.album_id));
      const fresh = releases.filter((r) => !seen.has(r.id));
      let all = true;
      for (const rel of fresh) {
        if (albumsRead >= ALBUMS_PER_TICK) { all = false; break; }
        const tracks = await D.spotifyAlbumTracks(rel.id);
        const ours = rel.artists.includes(t.ref) ? tracks : tracks.filter((x) => x.artists.some((a) => a.id === t.ref));
        const rows = ours.map((x) => ({ id: `t:${x.id}`, name: x.name, artist: x.artists.map((a) => a.name).join(", "), image: rel.image, release_date: rel.releaseDate, parent_id: t.entityId, clients: artist?.clients || [], url: `https://open.spotify.com/track/${x.id}`, ref: x.id }));
        if (rows.length) {
          await sql`
            INSERT INTO data_entities (id, kind, name, artist, image, release_date, parent_id, clients, origins)
            SELECT x.id, 'track', x.name, x.artist, x.image, x.release_date, x.parent_id, x.clients, '["catalog"]'::jsonb
            FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(id text, name text, artist text, image text, release_date text, parent_id text, clients jsonb)
            ON CONFLICT (id) DO UPDATE SET
              origins = CASE WHEN data_entities.origins @> '["catalog"]'::jsonb THEN data_entities.origins ELSE data_entities.origins || '["catalog"]'::jsonb END,
              parent_id = COALESCE(data_entities.parent_id, EXCLUDED.parent_id),
              clients = (SELECT COALESCE(jsonb_agg(DISTINCT v), '[]'::jsonb) FROM jsonb_array_elements(data_entities.clients || EXCLUDED.clients) v),
              image = CASE WHEN data_entities.image = '' THEN EXCLUDED.image ELSE data_entities.image END,
              release_date = CASE WHEN data_entities.release_date = '' THEN EXCLUDED.release_date ELSE data_entities.release_date END,
              active = true, updated_at = now()`;
          await sql`
            INSERT INTO data_links (entity_id, platform, ref, url)
            SELECT x.id, 'spotify', x.ref, x.url FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(id text, ref text, url text)
            ON CONFLICT (entity_id, platform) DO NOTHING`;
        }
        await sql`INSERT INTO data_albums (album_id, artist_entity, name, release_date, tracks, read_at) VALUES (${rel.id}, ${t.entityId}, ${rel.name}, ${rel.releaseDate}, ${rows.length}, ${iso(now)}) ON CONFLICT (album_id) DO NOTHING`;
        albumsRead++; songs += rows.length;
      }
      if (all) done.push(t.entityId); // the rest of its releases next time
    } catch (err) {
      error = err instanceof D.RateLimited ? `${err.message}: the rest next time.` : err.message;
      break;
    }
  }
  await markChecked("spotify_catalog", done, now);
  await runRow({ id, source: "spotify_catalog", adapter: "spotify-api", status: error && !albumsRead ? "failed" : "done", targets: targets.map((t) => ({ entityId: t.entityId, ref: t.ref })), items: albumsRead, snapshots: 0, usd: 0, error, startedAt: now, finishedAt: new Date() });
  return { releases: albumsRead, songs, error: error || undefined };
}

// ---------------------------------------------------------------- the cron
// step "collect": only what's open, the free APIs and nothing new started (the second daily cron)
// One cron tick, then (STREAM_SHEET_WRITES on) the pub sheet's STREAM DATA from the numbers it brought in
export async function tick(opts = {}) {
  const report = await tickNumbers(opts);
  const S = await import("../stream-sheet");
  if (S.streamSheetOn()) report.streamSheet = await S.writeStreamData({ now: opts.now || new Date() }).catch((err) => ({ error: String(err?.message || err).slice(0, 200) }));
  return report;
}
async function tickNumbers({ now = new Date(), step = "all" } = {}) {
  const report = { at: iso(now), refresh: refreshOn() ? "on" : "off" };
  report.collect = await collectRuns({ now });
  // list B #5 and #8 (free): trackers past their grace period come off; today's momentum scores
  report.trackers = await import("../ar/trackers").then((T) => T.sweepTrackers({ now })).catch((err) => ({ error: String(err?.message || err).slice(0, 200) }));
  const momentum = () => import("../ar/momentum").then(async (M) => ({ scored: (await M.computeMomentum({ now, save: true })).size })).catch((err) => ({ error: String(err?.message || err).slice(0, 200) }));
  if (!refreshOn()) { report.momentum = await momentum(); return report; }
  // the old Luminate portfolios (lib/data/seeds.js): read in again (a person's answers stay), then a few
  // more Spotify matches (free), before what's tracked is worked out
  try {
    const S = await import("./seeds");
    report.seeds = { ...(await S.importSeeds()), match: await S.matchSeeds({ limit: 40 }) };
  } catch (err) { console.error("data seeds:", err); report.seeds = { error: err.message }; }
  report.sync = await syncEntities();
  report.direct = await runDirect({ now, state: await loadState() });
  if (step !== "collect") {
    report.start = await startApifyRuns({ now, state: await loadState() });
    report.radar = await import("../ar/radar").then((R) => R.startRadarScan({ now })).catch((err) => ({ error: String(err?.message || err).slice(0, 200) }));
  }
  report.momentum = await momentum();
  return report;
}

// ---------------------------------------------------------------- the dashboard's writes
export async function setMode(entityId, mode, { days = null, by = "" } = {}) {
  const [e] = await sql`SELECT id, kind FROM data_entities WHERE id = ${entityId}`;
  if (!e || e.kind === "track") return { error: "Campaign mode is for an artist or a sound." };
  if (mode === "auto") { await sql`DELETE FROM data_refresh WHERE entity_id = ${entityId}`; return { ok: true }; }
  if (!["campaign", "off"].includes(mode)) return { error: "Unknown mode." };
  const until = days ? new Date(Date.now() + Number(days) * DAY).toISOString() : null;
  await sql`INSERT INTO data_refresh (entity_id, mode, until, updated_by, updated_at) VALUES (${entityId}, ${mode}, ${until}, ${by}, now())
    ON CONFLICT (entity_id) DO UPDATE SET mode = EXCLUDED.mode, until = EXCLUDED.until, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  return { ok: true };
}
export async function addSound(clip, url, { by = "" } = {}) {
  await sql`INSERT INTO data_entities (id, kind, origins) VALUES (${`s:${clip}`}, 'sound', '["manual"]'::jsonb)
    ON CONFLICT (id) DO UPDATE SET active = true, origins = CASE WHEN data_entities.origins @> '["manual"]'::jsonb THEN data_entities.origins ELSE data_entities.origins || '["manual"]'::jsonb END, updated_at = now()`;
  await sql`INSERT INTO data_links (entity_id, platform, ref, url) VALUES (${`s:${clip}`}, 'tiktok_sound', ${clip}, ${url}) ON CONFLICT (entity_id, platform) DO NOTHING`;
  void by;
  return { ok: true, id: `s:${clip}` };
}
// a sound taken off: it stops refreshing, and its numbers are kept (adding it again brings them back)
export async function removeSound(entityId) {
  const r = await sql`UPDATE data_entities SET active = false, updated_at = now() WHERE id = ${entityId} AND kind = 'sound' RETURNING id`;
  return r.length ? { ok: true } : { error: "No such sound." };
}
