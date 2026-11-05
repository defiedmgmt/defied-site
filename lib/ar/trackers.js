// List B #5, A&R trackers. Server only. Every staff account has its own tracker (ar_tracker rows with its
// users.id); together they are the team tracker, where the same artist added by two people is one entry
// with both names. What's tracked:
//   w:<ar_tracked id>  a Watchlist artist or song (the Watchlist and the Board keep reading ar_tracked)
//   a:<client id>      a roster artist: never expires
//   s:<clip id>        a TikTok sound (its numbers come from the engine, lib/data/engine.js, like Numbers' sounds)
// Each entry gets a length when it's added (30/60/90 days). When it runs out, the engine stops refreshing
// it (pausedSubjects(), so it costs nothing) and the page shows an expired icon with Renew; 14 days later
// sweepTrackers() removes it. Its numbers stay in data_snapshots, and adding the same artist, song or
// sound again restores the same row, so the history comes back.
// The contract the paste box (components/LinkBox.jsx) and the digests use: findTracked, listTracker,
// expiringSoon. Reads go through rowsOrNoneIfNoTable, so a deploy can land before migration 013.
import { dataSql as sql, addSound } from "../data/engine";
import { rowsOrNoneIfNoTable } from "../db";
import { spotifyId, soundId, handleOf, youtubeRef } from "../data/sources";
import { uid } from "../id";
import * as D from "../data/direct";
import { personKey } from "../names";

export const DURATIONS = [30, 60, 90];
export const DEFAULT_DAYS = 30;
export const GRACE_DAYS = 14;
export const SOON_DAYS = 7;
const DAY = 864e5;
const iso = (t) => new Date(t).toISOString();
const ms = (t) => (t == null ? null : typeof t === "number" ? t : new Date(t).getTime());
const nameKey = (name) => personKey(name) || String(name ?? "").trim().toLowerCase(); // lib/ar.js nameKey
export class TrackerError extends Error { constructor(status, message) { super(message); this.status = status; } }
// r11: the A&R sheet (lib/ar/tracker-sheet.js, a one-way copy) follows every change on the lists: a Log line per
// action and the Watchlist tab rewritten. A no-op unless AR_TRACKER_SHEET_WRITES is on; it never throws.
export const sheetAfter = (log = []) => import("./tracker-sheet").then((S) => S.afterListChange({ log })).catch(() => null);

// ---------------------------------------------------------------- pure: one entry's time left
// live | soon (a week or less left) | expired (in the grace period: Renew) | gone; never = no end date
export function expiryOf(e, now = Date.now()) {
  const t = ms(now);
  if (e.removed_at) return { state: "gone" };
  if (!e.expires_at) return { state: "live", never: true };
  const end = ms(e.expires_at), graceEnd = end + GRACE_DAYS * DAY;
  if (t < end) { const daysLeft = Math.max(1, Math.ceil((end - t) / DAY)); return { state: daysLeft <= SOON_DAYS ? "soon" : "live", daysLeft, endsAt: iso(end) }; }
  if (t < graceEnd) return { state: "expired", graceLeft: Math.max(1, Math.ceil((graceEnd - t) / DAY)), endsAt: iso(end), removeAt: iso(graceEnd) };
  return { state: "gone", endsAt: iso(end), removeAt: iso(graceEnd) };
}
const RANK = { live: 3, soon: 2, expired: 1, gone: 0 };
export const checkDays = (v) => {
  const d = v == null || v === "" ? DEFAULT_DAYS : Number(v);
  if (!DURATIONS.includes(d)) throw new TrackerError(400, "Pick 30, 60 or 90 days.");
  return d;
};

// what one subject is, for the page: name, image, link, and the key two people's adds merge on
// (the Spotify id when there is one, else the kind and the name)
export function subjectInfo(subject, { tracked, clients, sounds, rosterBySpotify }) {
  const [p, id] = [subject.slice(0, 1), subject.slice(2)];
  if (p === "w") {
    const t = tracked.get(id);
    if (!t) return null;
    const kind = t.kind === "song" ? "song" : "artist";
    const sp = spotifyId(t.spotify, kind === "song" ? "track" : "artist");
    const roster = kind === "artist" && sp ? rosterBySpotify.get(sp) : null;
    return { subject, kind, name: t.name, artist: t.artist || "", image: t.photo || "", link: t.spotify || "", spotifyId: sp, genre: t.genre || "", stage: t.stage || null,
      key: roster ? `artist:${sp}` : sp ? `${kind}:${sp}` : `${kind}:n:${nameKey(t.name)}${kind === "song" ? `|${nameKey(t.artist)}` : ""}`,
      roster: !!roster, clientId: roster?.id || null, entityId: kind === "artist" ? (roster ? `a:${roster.id}` : `w:${id}`) : sp ? `t:${sp}` : null, removed: !!t.removed_at };
  }
  if (p === "a") {
    const c = clients.get(id);
    if (!c) return null;
    const sp = spotifyId(c.spotify, "artist");
    return { subject, kind: "artist", name: c.name, artist: "", image: String(c.photo || "").startsWith("data:") ? "" : c.photo || "", link: c.spotify || "", spotifyId: sp,
      key: sp ? `artist:${sp}` : `artist:a:${id}`, roster: true, clientId: id, entityId: `a:${id}`, removed: false };
  }
  if (p === "s") {
    const s = sounds.get(id) || {};
    return { subject, kind: "sound", name: s.title || "TikTok sound", artist: s.author || "", image: s.cover || "", link: s.url || `https://www.tiktok.com/music/x-${id}`, clip: id,
      key: `sound:${id}`, roster: false, entityId: `s:${id}`, removed: false };
  }
  return null;
}

// the team tracker: entries grouped by what they track, each with everyone who added it (and when).
// state is the best of its entries (one person still tracking it keeps it live); a roster artist never expires.
export function teamOf(entries, ctx, { now = Date.now() } = {}) {
  const groups = new Map();
  for (const e of entries) {
    const info = subjectInfo(e.subject, ctx);
    if (!info) continue;
    const ex = info.roster ? { state: "live", never: true, roster: true } : expiryOf(e, now);
    if (ex.state === "gone") continue;
    const g = groups.get(info.key) || { ...info, subjects: [], who: [] };
    if (!g.subjects.includes(e.subject)) g.subjects.push(e.subject);
    if (info.roster && !g.roster) Object.assign(g, { roster: true, clientId: info.clientId, entityId: info.entityId });
    if (!g.image && info.image) g.image = info.image;
    g.who.push({ entryId: e.id, ownerId: e.owner_id, name: e.owner_name || "Team", addedAt: iso(e.added_at), days: e.days ?? null, ...ex });
    groups.set(info.key, g);
  }
  return [...groups.values()].map((g) => {
    g.who.sort((a, b) => ms(a.addedAt) - ms(b.addedAt));
    const best = g.who.reduce((a, w) => (RANK[w.state] > RANK[a.state] || (RANK[w.state] === RANK[a.state] && !a.never && (w.never || (w.daysLeft || 0) > (a.daysLeft || 0))) ? w : a), g.who[0]);
    return { ...g, addedAt: g.who[0].addedAt, state: g.roster ? "live" : best.state, never: g.roster || !!best.never, daysLeft: best.daysLeft ?? null, graceLeft: best.state === "expired" ? best.graceLeft : null,
      endsAt: best.endsAt || null, names: [...new Set(g.who.map((w) => w.name))] };
  });
}

// ---------------------------------------------------------------- reads
async function context() {
  const [tracked, clients, sounds] = await Promise.all([
    rowsOrNoneIfNoTable(sql`SELECT * FROM ar_tracked`),
    sql`SELECT id, name, photo, spotify, on_roster FROM clients`,
    rowsOrNoneIfNoTable(sql`SELECT clip_id, title, author, cover, url FROM radar_sounds`),
  ]);
  const rosterBySpotify = new Map();
  for (const c of clients) { const sp = c.on_roster && spotifyId(c.spotify, "artist"); if (sp) rosterBySpotify.set(sp, c); }
  return { tracked: new Map(tracked.map((t) => [t.id, t])), clients: new Map(clients.map((c) => [c.id, c])), sounds: new Map(sounds.map((s) => [s.clip_id, s])), rosterBySpotify };
}
const liveEntries = () => rowsOrNoneIfNoTable(sql`SELECT * FROM ar_tracker WHERE removed_at IS NULL ORDER BY added_at, id`);

// listTracker({ userId }) -> the team tracker's entries (userId null), or the ones that person tracks
// (each still shows everyone who has it). Newest first; the page re-sorts by momentum.
export async function listTracker({ userId = null, now = Date.now() } = {}) {
  const [entries, ctx] = await Promise.all([liveEntries(), context()]);
  const items = teamOf(entries, ctx, { now });
  const mine = userId == null ? items : items.filter((i) => i.who.some((w) => w.ownerId === userId));
  return mine.sort((a, b) => ms(b.addedAt) - ms(a.addedAt));
}
// expiringSoon({ userId, days }) -> that person's entries with `days` or fewer left, and the expired ones
// still in their grace period (soonest first)
export async function expiringSoon({ userId, days = SOON_DAYS, now = Date.now() } = {}) {
  const items = await listTracker({ userId, now });
  return items.map((i) => ({ ...i, mine: i.who.find((w) => w.ownerId === userId) }))
    .filter((i) => i.mine && !i.roster && !i.mine.never && (i.mine.state === "expired" || (i.mine.daysLeft != null && i.mine.daysLeft <= days)))
    .sort((a, b) => (a.mine.state === "expired" ? -1 : 0) - (b.mine.state === "expired" ? -1 : 0) || (a.mine.daysLeft ?? 0) - (b.mine.daysLeft ?? 0));
}
// findTracked({ spotifyArtistId, spotifyTrackId, tiktokSoundId, url }) -> [{ who, trackerOwnerId, itemId, kind }]
// for "already on Hank's tracker". A roster artist answers once as { who: "the roster", trackerOwnerId: null, roster: true }.
export async function findTracked({ spotifyArtistId = "", spotifyTrackId = "", tiktokSoundId = "", url = "" } = {}) {
  const a = spotifyArtistId || spotifyId(url, "artist"), t = spotifyTrackId || spotifyId(url, "track"), s = tiktokSoundId || soundId(url);
  if (!a && !t && !s) return [];
  const [entries, ctx] = await Promise.all([liveEntries(), context()]);
  const hit = (info) => (a && info.kind === "artist" && info.spotifyId === a) || (t && info.kind === "song" && info.spotifyId === t) || (s && info.kind === "sound" && info.clip === s);
  const out = [];
  for (const e of entries) {
    const info = subjectInfo(e.subject, ctx);
    if (!info || !hit(info) || expiryOf(e).state === "gone") continue;
    out.push({ who: (await whoOf(e)), trackerOwnerId: e.owner_id || null, itemId: e.id, kind: info.kind, subject: e.subject, state: expiryOf(e).state, addedAt: iso(e.added_at), key: info.key });
  }
  if (a && ctx.rosterBySpotify.has(a)) out.push({ who: "the roster", trackerOwnerId: null, itemId: `a:${ctx.rosterBySpotify.get(a).id}`, kind: "artist", subject: `a:${ctx.rosterBySpotify.get(a).id}`, roster: true, state: "live", rosterName: ctx.rosterBySpotify.get(a).name });
  return out;
}
// the live name of an entry's person (lib/ar/lists.js displayName: users.name, else the email's first part)
async function whoOf(e) {
  const { ownerName } = await import("./lists");
  const u = e.owner_id && e.owner_id !== "team:luminate" ? (await sql`SELECT id, name, email FROM users WHERE id = ${e.owner_id}`)[0] : null;
  return ownerName(e, new Map(u ? [[u.id, u]] : []));
}
// findRemoved({ spotifyArtistId, spotifyTrackId, tiktokSoundId }) -> the last entry taken off for it, when nobody
// has it now: "Was on Devin's list until Oct 30. Adding it brings its numbers back."
export async function findRemoved({ spotifyArtistId = "", spotifyTrackId = "", tiktokSoundId = "" } = {}) {
  const a = spotifyArtistId, t = spotifyTrackId, s = tiktokSoundId;
  if (!a && !t && !s) return null;
  const [gone, ctx] = await Promise.all([rowsOrNoneIfNoTable(sql`SELECT * FROM ar_tracker WHERE removed_at IS NOT NULL ORDER BY removed_at DESC LIMIT 400`), context()]);
  for (const e of gone) {
    const info = subjectInfo(e.subject, ctx);
    if (!info) continue;
    if ((a && info.kind === "artist" && info.spotifyId === a) || (t && info.kind === "song" && info.spotifyId === t) || (s && info.kind === "sound" && info.clip === s)) return { who: await whoOf(e), until: iso(e.removed_at), why: e.removed_why || "removed" };
  }
  return null;
}

// subjects whose every live entry has run out: the engine doesn't refresh them (a roster artist always is)
export async function pausedSubjects(now = Date.now()) {
  const rows = await rowsOrNoneIfNoTable(sql`SELECT subject, expires_at FROM ar_tracker WHERE removed_at IS NULL`);
  const by = new Map();
  for (const r of rows) { const live = !r.expires_at || ms(r.expires_at) > ms(now); by.set(r.subject, (by.get(r.subject) || false) || live); }
  return new Set([...by].filter(([s, live]) => !live && !s.startsWith("a:")).map(([s]) => s));
}

// ---------------------------------------------------------------- writes
// add({ user, kind, ... }) -> { ok, item, restored?, already? }. What's added:
//   { kind: "artist"|"song", spotify, name, artist, genre, image }  a Watchlist row (the same Spotify id, or
//       the same name with none, reuses the row already there, or one removed before: its history comes back)
//   { clientId }    a roster artist (never expires)
//   { kind: "sound", url | clip, name, artist, image }  a TikTok sound (the engine starts refreshing it)
export async function addToTracker({ user, days, ...b }) {
  if (!user?.id) throw new TrackerError(401, "Sign in again.");
  const d = b.clientId ? null : checkDays(days);
  let subject, kind, restored = false;
  if (b.clientId) {
    const [c] = await sql`SELECT id FROM clients WHERE id = ${String(b.clientId)} AND on_roster`;
    if (!c) throw new TrackerError(404, "That artist isn't on the roster.");
    subject = `a:${c.id}`; kind = "artist";
  } else if (b.kind === "sound") {
    const clip = soundId(b.clip || b.url);
    if (!clip) throw new TrackerError(400, "Paste a TikTok sound link (tiktok.com/music/…).");
    const url = /^https:\/\/(www\.)?tiktok\.com\/music\//.test(String(b.url || "")) ? String(b.url).trim().slice(0, 300) : `https://www.tiktok.com/music/x-${clip}`;
    await sql`INSERT INTO radar_sounds (clip_id, title, author, cover, url, seeds, added_by) VALUES (${clip}, ${String(b.name || "").slice(0, 200)}, ${String(b.artist || "").slice(0, 200)}, ${String(b.image || "").slice(0, 500)}, ${url}, '["manual"]'::jsonb, ${user.name || ""})
      ON CONFLICT (clip_id) DO UPDATE SET hidden_at = NULL, title = CASE WHEN radar_sounds.title = '' THEN EXCLUDED.title ELSE radar_sounds.title END,
        author = CASE WHEN radar_sounds.author = '' THEN EXCLUDED.author ELSE radar_sounds.author END`;
    await addSound(clip, url, { by: user.name || "" });
    subject = `s:${clip}`; kind = "sound";
  } else {
    kind = b.kind === "song" ? "song" : "artist";
    let name = String(b.name || "").trim().slice(0, 200);
    const sp = spotifyId(b.spotify, kind === "song" ? "track" : "artist");
    if (!name && !sp) throw new TrackerError(400, "Paste a Spotify link or type a name.");
    // a bare link: its name (and a song's artist, a photo) from Spotify's Web API (free)
    if (sp && !name && D.spotifyConfigured()) {
      const x = await (kind === "song" ? D.spotifyTrack(sp) : D.spotifyArtist(sp)).catch(() => null);
      if (x) { name = x.name || ""; if (kind === "song" && !b.artist) b.artist = (x.artists || []).map((a) => a.name).join(", "); if (!b.image) b.image = x.image || ""; }
    }
    // never a placeholder ("Spotify artist"): the paste box asks for the name when it couldn't read one
    if (!name) throw new TrackerError(400, "Type their name first: we couldn't read it from the link.");
    // a roster artist goes on as the roster artist
    if (kind === "artist" && sp) {
      const [c] = await sql`SELECT id FROM clients WHERE on_roster AND spotify LIKE ${`%${sp}%`} LIMIT 1`;
      if (c) return addToTracker({ user, clientId: c.id });
    }
    const links = cleanLinks(b.links);
    const all = await rowsOrNoneIfNoTable(sql`SELECT * FROM ar_tracked WHERE kind = ${kind} ORDER BY removed_at NULLS FIRST, created_at`);
    // the same Spotify id; else (an Instagram / TikTok / YouTube paste) the same profile; else the same name
    const sameSocial = (t) => kind === "artist" && Object.entries(links).some(([p, h]) => h && String(t[p] || "").toLowerCase() === h.toLowerCase());
    let same = all.find((t) => (sp ? spotifyId(t.spotify, kind === "song" ? "track" : "artist") === sp : sameSocial(t) || (!spotifyId(t.spotify) && nameKey(t.name) === nameKey(name) && (kind !== "song" || nameKey(t.artist) === nameKey(b.artist)))));
    // r10: a person pasting the Spotify link of a seeded row still to confirm (one of its choices, or an artist with
    // exactly its name) confirms it on that row: never a second row for the same artist
    if (!same && sp && kind === "artist") {
      const cand = all.find((t) => !t.removed_at && t.match === "name" && !spotifyId(t.spotify) && ((Array.isArray(t.match_candidates) ? t.match_candidates : JSON.parse(t.match_candidates || "[]")).some((c) => c.id === sp) || personKey(t.name) === personKey(name)));
      if (cand) { await sql`UPDATE ar_tracked SET spotify = ${`https://open.spotify.com/artist/${sp}`}, match = 'confirmed', match_candidates = '[]'::jsonb WHERE id = ${cand.id}`; same = { ...cand, spotify: sp }; }
    }
    if (same) {
      if (same.removed_at) { await sql`UPDATE ar_tracked SET removed_at = NULL WHERE id = ${same.id}`; restored = true; }
      await saveLinks(same.id, links, same);
      subject = `w:${same.id}`;
    } else {
      const id = uid();
      const link = sp ? `https://open.spotify.com/${kind === "song" ? "track" : "artist"}/${sp}` : "";
      const handle = links.instagram ? `@${links.instagram}` : links.tiktok ? `@${links.tiktok}` : "";
      await sql`INSERT INTO ar_tracked (id, kind, name, artist, handle, spotify, isrc, genre, created_by) VALUES (${id}, ${kind}, ${name}, ${String(b.artist || "").slice(0, 200)}, ${handle}, ${link}, ${kind === "song" ? String(b.isrc || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) : ""}, ${String(b.genre || "").slice(0, 60)}, ${user.name || ""})`;
      if (b.image && /^https:\/\//.test(String(b.image))) await sql`UPDATE ar_tracked SET photo = ${String(b.image).slice(0, 500)} WHERE id = ${id}`.catch((err) => { if (err?.code !== "42703") throw err; });
      await saveLinks(id, links, {});
      subject = `w:${id}`;
    }
  }
  // r11 (A2): the paste box's Artist/Producer pick on a Watchlist artist nobody has typed yet; saved before addEntry
  // so the A&R sheet's "Added" line and Watchlist tab already show it
  if (b.role && kind === "artist" && subject.startsWith("w:")) await import("./lists").then((L) => L.setRole({ id: subject.slice(2), role: b.role, onlyIfUnset: true })).catch(() => null);
  return addEntry({ user, subject, kind, days: d, restored });
}
// the artist's other profiles, as handles / channel refs: { instagram, tiktok, youtube } (only real links)
export function cleanLinks(l = {}) {
  const out = {};
  const ig = handleOf(l?.instagram, "instagram.com"); if (ig) out.instagram = ig.slice(0, 60);
  const tt = handleOf(l?.tiktok, "tiktok.com"); if (tt && !/^music$/i.test(tt)) out.tiktok = tt.slice(0, 60);
  const yt = l?.youtube && youtubeRef(l.youtube) ? String(l.youtube).trim().slice(0, 200) : ""; if (yt && /^https:\/\/(www\.)?youtube\.com\//.test(yt)) out.youtube = yt;
  return out;
}
// saved on the row (migration 017's columns) so the engine tracks their followers too; an empty field only
async function saveLinks(id, links, row) {
  for (const p of ["instagram", "tiktok", "youtube"]) {
    if (!links[p] || String(row?.[p] || "")) continue;
    await sql`UPDATE ar_tracked SET instagram = CASE WHEN ${p} = 'instagram' THEN ${links[p]} ELSE instagram END, tiktok = CASE WHEN ${p} = 'tiktok' THEN ${links[p]} ELSE tiktok END,
      youtube = CASE WHEN ${p} = 'youtube' THEN ${links[p]} ELSE youtube END WHERE id = ${id}`.catch((err) => { if (err?.code !== "42703") throw err; });
  }
}
// one person's entry for a subject (a second add by the same person renews it instead)
export async function addEntry({ user, subject, kind, days = DEFAULT_DAYS, restored = false, now = Date.now() }) {
  const roster = subject.startsWith("a:");
  const expires = roster || days == null ? null : iso(ms(now) + days * DAY);
  const [mine] = await sql`SELECT id, expires_at FROM ar_tracker WHERE owner_id = ${user.id} AND subject = ${subject} AND removed_at IS NULL`;
  if (mine) {
    if (!roster && mine.expires_at && expiryOf(mine, now).state !== "live") {
      await sql`UPDATE ar_tracker SET expires_at = ${expires}, days = ${days}, renewed_at = ${iso(now)} WHERE id = ${mine.id}`;
      await sheetAfter([{ action: "Renewed", userId: user.id, who: user.name || "", subject }]);
    }
    return { ok: true, already: true, entryId: mine.id, subject, restored };
  }
  const id = uid();
  await sql`INSERT INTO ar_tracker (id, owner_id, owner_name, subject, kind, days, added_at, expires_at) VALUES (${id}, ${user.id}, ${user.name || ""}, ${subject}, ${kind}, ${roster ? null : days}, ${iso(now)}, ${expires})`;
  await sql`UPDATE ar_tracker SET source = ${roster ? "roster" : "paste"} WHERE id = ${id}`.catch((err) => { if (err?.code !== "42703") throw err; }); // (before migration 017: no source column)
  await refreshState(subject, now);
  await sheetAfter([{ action: "Added", userId: user.id, who: user.name || "", subject }]);
  return { ok: true, entryId: id, subject, restored };
}
// Renew: every entry of this thing that has run out (or is about to) starts again, for its own length
export async function renew({ subject, entryId, user, days = null, now = Date.now() }) {
  const rows = entryId ? await sql`SELECT * FROM ar_tracker WHERE id = ${entryId} AND removed_at IS NULL` : await sql`SELECT * FROM ar_tracker WHERE subject = ANY(${[].concat(subject)}) AND removed_at IS NULL`;
  const due = rows.filter((e) => e.expires_at && expiryOf(e, now).state !== "live");
  if (!rows.length) throw new TrackerError(404, "That one isn't tracked any more. Add it again to bring its numbers back.");
  for (const e of due.length ? due : rows.filter((e) => e.expires_at && (!user || e.owner_id === user.id))) {
    const d = days != null ? checkDays(days) : e.days || DEFAULT_DAYS;
    await sql`UPDATE ar_tracker SET expires_at = ${iso(ms(now) + d * DAY)}, days = ${d}, renewed_at = ${iso(now)} WHERE id = ${e.id}`;
  }
  for (const s of new Set(rows.map((e) => e.subject))) await refreshState(s, now);
  await sheetAfter([...new Set(rows.map((e) => e.subject))].map((s) => ({ action: "Renewed", userId: user?.id, who: user?.name || "", subject: s })));
  return { ok: true, renewed: due.length || rows.length };
}
// one person's length for their entry (counted from today)
export async function setDays({ entryId, user, days, now = Date.now() }) {
  const d = checkDays(days);
  const [e] = await sql`SELECT * FROM ar_tracker WHERE id = ${entryId} AND removed_at IS NULL`;
  if (!e) throw new TrackerError(404, "That one isn't tracked any more.");
  if (e.subject.startsWith("a:")) throw new TrackerError(400, "Roster artists never expire.");
  if (user && e.owner_id !== user.id) throw new TrackerError(403, `That's on ${e.owner_name || "someone else"}'s tracker.`);
  await sql`UPDATE ar_tracker SET days = ${d}, expires_at = ${iso(ms(now) + d * DAY)}, renewed_at = ${iso(now)} WHERE id = ${e.id}`;
  await refreshState(e.subject, now);
  await sheetAfter([{ action: "Renewed", userId: user?.id || e.owner_id, who: user?.name || e.owner_name || "", subject: e.subject }]);
  return { ok: true };
}
// off one person's tracker (anyone's, from the team view, says whose it was). by / byId: who took it off (the Log's Who)
export async function removeEntry({ entryId, now = Date.now(), by = "", byId = null }) {
  const [e] = await sql`UPDATE ar_tracker SET removed_at = ${iso(now)}, removed_why = 'removed' WHERE id = ${entryId} AND removed_at IS NULL RETURNING *`;
  if (!e) throw new TrackerError(404, "That one was already taken off.");
  await settle([e.subject], now);
  await sheetAfter([{ action: "Removed", userId: byId || (by ? null : e.owner_id), who: by || e.owner_name || "", subject: e.subject }]);
  return { ok: true, subject: e.subject };
}

// a subject nobody tracks any more: a Watchlist row comes off the Watchlist (one an old Outreach board had moved
// on keeps its row: r11 removed Outreach, nothing reads ar_tracked.stage now), a sound stops refreshing. Their numbers stay.
async function settle(subjects, now) {
  for (const s of subjects) {
    const [left] = await sql`SELECT count(*)::int AS n FROM ar_tracker WHERE subject = ${s} AND removed_at IS NULL`;
    if (left.n > 0) { await refreshState(s, now); continue; }
    if (s.startsWith("w:")) await sql`UPDATE ar_tracked SET removed_at = ${iso(now)} WHERE id = ${s.slice(2)} AND removed_at IS NULL AND (stage IS NULL OR stage = 'passed')`;
    if (s.startsWith("s:")) await sql`UPDATE data_entities SET active = false, updated_at = now() WHERE id = ${s} AND kind = 'sound' AND NOT (origins @> '["radar"]'::jsonb)`;
  }
}
// a tracked sound refreshes while someone's entry is live (the engine reads data_entities.active for
// sounds); artists and songs are read by the engine's syncEntities through pausedSubjects()
async function refreshState(subject, now) {
  if (!subject.startsWith("s:")) return;
  const paused = (await pausedSubjects(now)).has(subject);
  await sql`UPDATE data_entities SET active = ${!paused}, updated_at = now() WHERE id = ${subject} AND kind = 'sound'`;
}
// the cron's daily pass: entries past their grace period are removed (why: expired), and every tracked
// sound's refreshing follows its entries
export async function sweepTrackers({ now = Date.now() } = {}) {
  const cut = iso(ms(now) - GRACE_DAYS * DAY);
  const gone = await rowsOrNoneIfNoTable(sql`UPDATE ar_tracker SET removed_at = ${iso(now)}, removed_why = 'expired' WHERE removed_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ${cut} AND subject NOT LIKE 'a:%' RETURNING subject`);
  await settle([...new Set(gone.map((g) => g.subject))], now);
  const paused = await pausedSubjects(now);
  const sounds = await rowsOrNoneIfNoTable(sql`SELECT DISTINCT subject FROM ar_tracker WHERE removed_at IS NULL AND subject LIKE 's:%'`);
  for (const { subject } of sounds) await sql`UPDATE data_entities SET active = ${!paused.has(subject)}, updated_at = now() WHERE id = ${subject} AND kind = 'sound' AND active <> ${!paused.has(subject)}`;
  // the seeded rows' Spotify matches (lib/ar/lists.js): once a day, Spotify Web API only
  const matches = await import("./lists").then((L) => L.verifyMatches({ now })).catch((err) => ({ error: String(err?.message || err).slice(0, 160) }));
  return { removed: gone.length, paused: paused.size, matches };
}
// who has a tracker (for the person filter): everyone with a live entry
export const peopleOf = (items) => {
  const m = new Map();
  for (const i of items) for (const w of i.who) if (!m.has(w.ownerId)) m.set(w.ownerId, { id: w.ownerId, name: w.name, n: 0 });
  for (const i of items) for (const id of new Set(i.who.map((w) => w.ownerId))) m.get(id).n++;
  return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
};
