// The one authenticated data endpoint the whole staff/client dashboard reads
// from and writes through (it replaced the client-side `db` object that once
// shipped in the JS bundle and lived in localStorage). What a staff account
// reads and writes follows its role and sections (lib/roles.js, lib/access.js). A client session
// only ever receives their own client record + their own placements, with
// revenue/admin_fee/luminate_id stripped (the old client UI just didn't
// *render* those fields — the data was always present regardless of role,
// which is exactly the gap this closes). Nothing here is reachable without
// a valid session.
import bcrypt from "bcryptjs";
import { sql, rowsOrNoneIfNoTable } from "../../lib/db";
import { requireSameOrigin, restampSession } from "../../lib/session";
import { requireAccess, limited, ownSet, refreshManagers } from "../../lib/access";
import { roleOf, cleanAccess, ROLE_KEYS, sectionLabel, sameManager } from "../../lib/roles";
import { readSheetFacts } from "../../lib/sheet-facts-store";
import { afterAction } from "../../lib/area-tasks";
import { MAX_DATA_BYTES } from "../../lib/image-links";
import { streamsOn } from "../../lib/streams-on";
import { mgmtListOf } from "../../lib/clickup-tasks";
import { ownLinkOf } from "../../lib/commission";
import { linkAfterSave, accountsMerge, addedMerge } from "../../lib/people-link";

// photos uploaded before list B #2 are data: URIs inside the rows (new ones are Blob links,
// /api/upload-image), so Next's default 1 MB body cap turned every staff save into a 413 once ~5-8 had
// been uploaded. Vercel's own request cap is 4.5 MB.
export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

// ...and Vercel cuts off any response over 4.5 MB too, so the staff GET, which
// sends every row (and any photo still inside one), must stay under it or the dashboard can't even
// load to remove one. A save that would take it past this is refused (one that
// shrinks it always goes through). /api/public-data is a subset of the same
// rows, so it stays under as well. It was 3.5 MB while every photo was inside the data; with links
// the reply is a few hundred KB (lib/image-links.js).
const MAX_DATASET_BYTES = MAX_DATA_BYTES;
const TOO_BIG = "That's too much to save — the photos and covers are over the size limit. Remove or shrink some images and try again.";
// a client can't see or shrink what fills it (other clients' photos and covers): they're told to ask
const TOO_BIG_CLIENT = "Your change couldn't be saved right now — please let the Defied team know.";

function toClient(row) {
  return {
    id: row.id, name: row.name, role: row.role, credit: row.credit, bio: row.bio, photo: row.photo,
    spotify: row.spotify, apple: row.apple, instagram: row.instagram, tiktok: row.tiktok,
    youtube: row.youtube, soundcloud: row.soundcloud, sheetTabName: row.sheet_tab_name,
    totalStreams: Number(row.total_streams), onRoster: row.on_roster,
  };
}
function toPlacement(row, { redact } = {}) {
  const base = {
    id: row.id, clientId: row.client_id, song: row.song, artist: row.artist,
    releaseDate: row.release_date, link: row.link, cover: row.cover, notable: row.notable,
    splits: row.splits, streams: Number(row.streams),
  };
  if (redact) return base; // no revenue, admin_fee, or luminate_id for a client session
  return { ...base, luminateId: row.luminate_id, revenue: Number(row.revenue), adminFee: Number(row.admin_fee) };
}
function toStaffBio(row) {
  // (2026-11-14, people link) visible: on the public team page; userId: the login it belongs to (read only here)
  return { id: row.id, name: row.name, role: row.role, credit: row.credit, bio: row.bio, photo: row.photo, email: row.email, instagram: row.instagram, visible: row.visible !== false, userId: row.user_id || "" };
}
function toUser(row, lastLogin = null) {
  // never send password_hash to the client, ever — not even to a staff session
  // (2026-11-10) Site › Users says when each login last signed in and when its password was last set
  // (2026-11-14) noLogin: no email or no password yet (a person the site knows who can't sign in)
  return { id: row.id, email: row.email || null, role: row.role, name: row.name, clientId: row.client_id, lastLoginAt: lastLogin, passwordChangedAt: row.password_changed_at || null, noLogin: !row.email || !row.password_hash };
}
function toSubmission(row) {
  // (2026-11-10) its music link and Dropbox files: shown in Site › Messages, never written back from a save
  return { id: row.id, name: row.name, email: row.email, instagram: row.instagram, subject: row.subject, message: row.message, at: row.created_at, read: row.read,
    musicLink: row.music_link || "", files: Array.isArray(row.files) ? row.files : [], filesStatus: row.files_status || "" };
}
function toNotable(row) {
  return { id: row.id, song: row.song, artist: row.artist, client: row.client, cover: row.cover, releaseDate: row.release_date, link: row.link };
}

// What each INSERT in handlePost stores for an incoming object. The size
// guard reads these back through the same toX mappers the GET uses, so it
// measures exactly what the next GET will send.
const clientRow = (c, i) => ({
  id: c.id, name: c.name, role: c.role || "", credit: c.credit || "", bio: c.bio || "", photo: c.photo || "",
  spotify: c.spotify || "", apple: c.apple || "", instagram: c.instagram || "", tiktok: c.tiktok || "",
  youtube: c.youtube || "", soundcloud: c.soundcloud || "", sheet_tab_name: c.sheetTabName || "",
  total_streams: c.totalStreams || 0, on_roster: !!c.onRoster, roster_order: i,
});
const placementRow = (p) => ({
  id: p.id, client_id: p.clientId, song: p.song || "", artist: p.artist || "", release_date: p.releaseDate || "",
  link: p.link || "", cover: p.cover || "", notable: !!p.notable, luminate_id: p.luminateId || "",
  streams: p.streams || 0, revenue: p.revenue || 0, admin_fee: p.adminFee || 0, splits: p.splits || [],
});
// visible: null when the row didn't say (a tab from before it existed): the stored value stays
const staffRow = (s) => ({ id: s.id, name: s.name || "", role: s.role || "", credit: s.credit || "", bio: s.bio || "", photo: s.photo || "", email: s.email || "", instagram: s.instagram || "", visible: s && "visible" in s ? !!s.visible : null });
// (2026-11-14) no email is NULL (a person with no login yet), never "": UNIQUE allows any number of NULLs
const normEmail = (e) => String(e ?? "").trim().toLowerCase() || null;
const userRow = (u) => ({ password_changed_at: u.pwAt || null, clickup_user_id: u.cuId || "", id: u.id, email: normEmail(u.email), password_hash: u.hash || null, role: u.role, name: u.name || "", client_id: u.clientId || null, staff_role: u.staffRole || null, access: u.access || {} });
const submissionRow = (s) => ({ id: s.id, name: s.name || "", email: s.email || "", instagram: s.instagram || "", subject: s.subject || "", message: s.message || "", created_at: s.at || new Date().toISOString(), read: !!s.read });
const notableRow = (n) => ({ id: n.id, song: n.song || "", artist: n.artist || "", client: n.client || "", cover: n.cover || "", release_date: n.releaseDate || "", link: n.link || "" });
const insertPlacement = (r) => sql`
  INSERT INTO placements (id, client_id, song, artist, release_date, link, cover, notable, luminate_id, streams, revenue, admin_fee, splits)
  VALUES (${r.id}, ${r.client_id}, ${r.song}, ${r.artist}, ${r.release_date}, ${r.link}, ${r.cover}, ${r.notable}, ${r.luminate_id}, ${r.streams}, ${r.revenue}, ${r.admin_fee}, ${JSON.stringify(r.splits)})
`;

// Everything a staff session's GET returns — and what the size guard weighs.
// the day the pub sheet's streams are from (streamsOn) is lib/streams-on.js's, shared with the share card

async function staffPayload() {
  // (2026-11-14) asOf: the database's time before anything is read. A save sends it back, and a row missing from that
  // save is deleted only when it's older than this copy (a row the server added since is never wiped)
  const [{ t: asOf }] = await sql`SELECT now() AS t`;
  const [clients, placements, staff, users, submissions, notableReleases, [settings], notOurs, sheetFacts, lumDay, logins] = await Promise.all([
    sql`SELECT * FROM clients ORDER BY roster_order`,
    sql`SELECT * FROM placements`,
    sql`SELECT * FROM staff_bios ORDER BY sort_order NULLS LAST, created_at, id`,
    sql`SELECT * FROM users`,
    sql`SELECT * FROM submissions ORDER BY created_at DESC`,
    sql`SELECT * FROM notable_releases`,
    sql`SELECT about_text, last_synced_at FROM site_settings WHERE id = 1`,
    rowsOrNoneIfNoTable(sql`SELECT client_id, song_key, song, luminate_id, removed_at FROM not_ours ORDER BY removed_at`),
    readSheetFacts(),
    streamsOn(),
    sql`SELECT lower(email) AS email, max(attempted_at) AS at FROM login_attempts WHERE success GROUP BY lower(email)`,
  ]);
  const lastLogin = new Map(logins.map((r) => [r.email, r.at]));
  return {
    role: "staff",
    asOf: asOf instanceof Date ? asOf.toISOString() : String(asOf),
    clients: clients.map(toClient),
    placements: placements.map((p) => toPlacement(p)),
    staff: staff.map(toStaffBio),
    users: users.map((u) => toUser(u, (u.email && lastLogin.get(String(u.email).toLowerCase())) || null)),
    submissions: submissions.map(toSubmission),
    notableReleases: notableReleases.map(toNotable),
    site: { about: settings.about_text },
    sheetSync: { lastSyncedAt: settings.last_synced_at },
    streamsOn: lumDay,
    // songs removed as "not ours": the browser's sheet sync skips their titles (staff only)
    notOurs: notOurs.map((r) => ({ clientId: r.client_id, songKey: r.song_key, song: r.song, luminateId: r.luminate_id || "", removedAt: r.removed_at })),
    // what the pub sheet says per song and per client (lib/sheet-facts.js), from the last pull
    sheetFacts,
  };
}

// Would this write take the staff GET past MAX_DATASET_BYTES, and make it
// bigger than it is now? `change(now)` gives the tables it replaces, as the GET
// would send them. With `clientIds` (the clients left after it), a removed
// client's songs go too (ON DELETE CASCADE) and their login is unlinked.
async function growsPastLimit(change, clientIds) {
  const now = await staffPayload();
  const after = { ...now, ...change(now) };
  if (clientIds) {
    after.placements = after.placements.filter((p) => clientIds.has(p.clientId));
    after.users = after.users.map((u) => (u.clientId && !clientIds.has(u.clientId) ? { ...u, clientId: null } : u));
  }
  const size = Buffer.byteLength(JSON.stringify(after));
  return size > MAX_DATASET_BYTES && size > Buffer.byteLength(JSON.stringify(now));
}

// The staff GET for one account (lib/roles.js): a table its sections don't cover comes back empty,
// an account limited to its own artists gets only theirs, and the logins (with each one's role and
// overrides) only with Users. `access` says what the dashboard shows.
export function payloadFor(full, users, a) {
  const can = (k) => a.sections.includes(k);
  const out = { ...full, access: { role: a.role, sections: a.sections, ownOnly: a.ownOnly, manager: a.manager || "", mgmtList: a.mgmtList || null, payLink: a.payLink || null } };
  out.clients = full.clients.map((c, i) => ({ ...c, manager: full.managers?.[c.id] || "" }));
  delete out.managers;
  out.users = can("users") ? users : [];
  if (!can("site")) out.submissions = [];
  // the money columns are Publishing's (the fee each song earns)
  if (!can("publishing")) out.placements = full.placements.map(({ luminateId, revenue, adminFee, ...p }) => p);
  // (2026-11-10) and the money is the Founders' (Money access): a Co-manager gets the songs without it
  else if (!can("money")) out.placements = full.placements.map(({ revenue, adminFee, ...p }) => p);
  if (a.ownOnly) {
    const mine = new Set(a.clientIds || []);
    out.clients = out.clients.filter((c) => mine.has(c.id));
    out.placements = out.placements.filter((p) => mine.has(p.clientId));
    const songs = new Set(out.placements.map((p) => p.id));
    out.notOurs = (full.notOurs || []).filter((r) => mine.has(r.clientId));
    out.sheetFacts = {
      songs: Object.fromEntries(Object.entries(full.sheetFacts?.songs || {}).filter(([id]) => songs.has(id))),
      clients: Object.fromEntries(Object.entries(full.sheetFacts?.clients || {}).filter(([id]) => mine.has(id))),
    };
  }
  return out;
}
// each login with its role and overrides, for Site › Users (a column the roles migration adds: none before it)
async function usersWithRoles() {
  const rows = await sql`SELECT id, staff_role, access FROM users`.catch((err) => { if (err?.code === "42703") return []; throw err; });
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}
async function managersOf() {
  const rows = await sql`SELECT id, manager FROM clients`.catch((err) => { if (err?.code === "42703") return []; throw err; });
  return Object.fromEntries(rows.map((r) => [r.id, r.manager || ""]));
}

async function handleGet(req, res, session) {
  const { role, clientId } = session.user;

  if (role === "staff") {
    const [full, extra, managers] = await Promise.all([staffPayload(), req.access.sections.includes("users") ? usersWithRoles() : {}, managersOf()]);
    const users = full.users.map((u) => ({ ...u, staffRole: extra[u.id]?.staff_role || null, access: extra[u.id]?.access || {} }));
    // mgmtList: this login's own ClickUp list, for My to-do (lib/clickup-tasks.js); payLink: its own pay link, for My
    // payments (lib/commission.js)
    return res.status(200).json(payloadFor({ ...full, managers }, users, { ...req.access, mgmtList: mgmtListOf(session.user.name), payLink: ownLinkOf(session.user.name)?.key || null }));
  }

  // client: own record + own placements only, redacted
  const [clients, placements, [settings], sheetFacts, lumDay] = await Promise.all([
    sql`SELECT * FROM clients WHERE id = ${clientId}`,
    sql`SELECT * FROM placements WHERE client_id = ${clientId}`,
    sql`SELECT last_synced_at FROM site_settings WHERE id = 1`,
    readSheetFacts(clientId),
    streamsOn(),
  ]);
  if (!clients[0]) return res.status(404).json({ error: "Client record not found." });
  return res.status(200).json({
    role: "client",
    client: toClient(clients[0]),
    placements: placements.map((p) => toPlacement(p, { redact: true })),
    sheetSync: { lastSyncedAt: settings.last_synced_at },
    streamsOn: lumDay,
    // their own songs' rows and their own net streams on the sheet: streams and shares only, no money
    sheetFacts,
  });
}

// (2026-11-14) What a staff save changes about who's who: lib/people-link.js runs after it when anything did (a row
// added or removed, a name, email, role or client link changed, a client put on or off the roster). staffChanges: each
// team entry's fields this save changes ({ id: ["name", "email"] }): a login's name may follow only those, with Users.
async function peopleChanges(body, { priorClients, priorUsers, userQueryData, mine }) {
  let touched = false;
  const staffChanges = {}, addedClients = [], accounts = {};
  if (priorClients && Array.isArray(body.clients)) {
    const base = mine ? priorClients.filter((c) => mine.has(c.id)) : priorClients, was = new Map(base.map((c) => [c.id, c]));
    // (2026-11-15) a client this save adds is one a person has just made: the link treats it as real from now on, hidden or not
    for (const c of body.clients) if (c && c.id && !was.has(c.id) && !(mine && priorClients.some((p) => p.id === c.id))) addedClients.push(String(c.id));
    if (body.clients.length !== base.length || body.clients.some((c) => { const w = was.get(c.id); return !w || (c.name || "") !== (w.name || "") || !!c.onRoster !== !!w.on_roster; })) touched = true;
  }
  if (userQueryData && priorUsers) {
    const was = new Map(priorUsers.map((u) => [u.id, u]));
    if (userQueryData.length !== priorUsers.length || userQueryData.some((u) => { const w = was.get(u.id); return !w || (u.name || "") !== (w.name || "") || normEmail(u.email) !== (w.email || null) || u.role !== w.role || (u.clientId || null) !== (w.client_id || null) || (u.staffRole || null) !== (w.staff_role || null); })) touched = true;
  }
  if (Array.isArray(body.staff)) {
    const prior = await sql`SELECT id, name, email FROM staff_bios`, was = new Map(prior.map((x) => [x.id, x]));
    for (const x of body.staff) {
      const w = was.get(x.id), f = !w ? ["name", "email"] : ["name", "email"].filter((k) => (x[k] || "") !== (w[k] || ""));
      if (f.length) staffChanges[x.id] = f;
    }
    if (Object.keys(staffChanges).length || body.staff.length !== prior.length) touched = true;
    // (2026-11-15) Site › Team's "Account" for an entry (a new one always says; an old one only when it was changed), written with the rows (below)
    for (const x of body.staff) if (x && x.id && (x.account === "comanager" || x.account === "intern" || x.account === "none") && Object.keys(accounts).length < 20) accounts[String(x.id)] = x.account;
    if (Object.keys(accounts).length) touched = true;
  }
  return { touched, staffChanges, addedClients, accounts };
}

// Mirrors the old commit({...db, someKey: newValue}) shape: the body may
// contain any subset of these keys, each fully replacing that table (or,
// for a client session, just their own slice of placements). Low write
// volume, small dataset, single-writer-at-a-time in practice — full-table
// replace per key is simpler and safer here than diffing/patching, and is
// still strictly more consistent than the old one-copy-per-browser model.
//
// Every DELETE+reinsert sequence below is built as an array of query
// objects and executed via sql.transaction(), not individually-awaited
// calls — a mid-loop failure (a bad value, a constraint violation) used to
// leave that table (and, since commit() always spreads the *entire* db,
// every table processed before the one that failed) truncated with only a
// partial reinsert and no rollback. Verified against a real UNIQUE
// violation: the old pattern loses data, sql.transaction() leaves the
// table completely unchanged.
async function handlePost(req, res, session) {
  if (!requireSameOrigin(req, res)) return;
  const { role, clientId } = session.user;
  const body = req.body || {};

  if (role !== "staff") {
    // the frontend's commit() always sends the full {...db, changedKey}
    // spread, so other keys (role, client, sheetSync) will be present —
    // that's fine, only placements is ever actually written for a client;
    // everything else in the body is silently ignored, never applied.
    if (!Array.isArray(body.placements)) return res.status(400).json({ error: "placements[] is required." });
    // reject outright rather than silently filtering: a payload carrying
    // someone else's clientId (forged, or a stale/buggy client state) must
    // never be allowed to fall through to a full delete-and-replace of this
    // client's own rows with an incomplete list — that would silently wipe
    // real placements instead of just failing loudly.
    if (body.placements.some((p) => p.clientId !== clientId)) {
      return res.status(403).json({ error: "Placement clientId mismatch." });
    }
    // luminate_id / revenue / admin_fee are staff-only fields a client
    // session never receives (see toPlacement's redact) — every placement
    // object the client's browser holds is missing them, always. Trusting
    // the client's copy for those columns here silently zeroed them out on
    // *any* client save (editing one song rewrote every one of that
    // client's placements). Look up what's actually in the database right
    // now and keep it, regardless of what the client's payload carries.
    const existing = await sql`SELECT id, luminate_id, revenue, admin_fee FROM placements WHERE client_id = ${clientId}`;
    const existingById = Object.fromEntries(existing.map((r) => [r.id, r]));
    const rows = body.placements.map((p) => {
      const prior = existingById[p.id];
      return { ...placementRow({ ...p, clientId }), luminate_id: prior ? prior.luminate_id : "", revenue: prior ? Number(prior.revenue) : 0, admin_fee: prior ? Number(prior.admin_fee) : 0 };
    });
    const queries = [sql`DELETE FROM placements WHERE client_id = ${clientId}`, ...rows.map(insertPlacement)];
    try {
      const tooBig = await growsPastLimit((now) => ({
        placements: now.placements.filter((p) => p.clientId !== clientId).concat(rows.map((r) => toPlacement(r))),
      }));
      if (tooBig) return res.status(413).json({ error: TOO_BIG_CLIENT });
      await sql.transaction(queries);
    } catch (err) {
      console.error("client placements save failed:", err);
      return res.status(502).json({ error: "Save failed — your existing songs were not changed." });
    }
    return res.status(200).json({ ok: true });
  }

  // what this account may write (lib/roles.js): a table its sections don't cover refuses the whole
  // save, before anything is built or written
  const a = req.access, can = (k) => a.sections.includes(k);
  const NEEDS = { clients: ["publishing", "site"], placements: ["publishing"], staff: ["site"], notableReleases: ["site"], submissions: ["site"], users: ["users"], site: ["site"], sheetSync: ["publishing"] };
  for (const [k, need] of Object.entries(NEEDS)) {
    if (!(k in body) || body[k] == null) continue;
    if (!need.some(can)) return res.status(403).json({ error: `Your account can't change ${sectionLabel(need[0])}, so nothing was saved. A Founder can turn it on in Site › Users.` });
  }
  const mine = limited(req) ? ownSet(req) : null;
  // an account limited to its own artists marks only its own pull, not the whole site's
  if (mine) delete body.sheetSync;
  const NOT_YOURS = "That isn't one of your artists, so nothing was saved.";
  // (2026-11-14, people link) the copy this save was built on (the GET's asOf, AppRoot's commit sends it back). The
  // server adds rows by itself now (lib/people-link.js): a users, clients or team row missing from this save is deleted
  // only when it's older than that copy, so a row added since is never wiped. No asOf (a tab from before): refused
  // when it leaves a row out (below). The DELETEs below say the same in SQL (never later than the database's own now), 2 seconds back
  // so a row whose insert was still landing as the copy was read isn't taken for one the tab saw.
  const asOf = typeof body.asOf === "string" && Number.isFinite(Date.parse(body.asOf)) ? new Date(body.asOf).toISOString() : null;
  const deletable = (row) => !!asOf && new Date(row.created_at).getTime() < Date.parse(asOf) - 2000;
  // (2026-11-14 review) a save with no asOf (a tab from before) that leaves out a login, client or team row that exists
  // meant a delete under the old rule: refused, nothing written, so the page is reloaded first. One that leaves nothing
  // out goes through (it deletes nothing).
  if (!asOf) {
    const sentIds = (rows) => new Set(rows.map((r) => r?.id));
    const leftOut = (rows, list, scope = null) => { const sent = sentIds(list); return rows.some((r) => (!scope || scope.has(r.id)) && !sent.has(r.id)); };
    const checks = [];
    if (Array.isArray(body.users)) checks.push(sql`SELECT id FROM users`.then((r) => leftOut(r, body.users)));
    if (Array.isArray(body.clients)) checks.push(sql`SELECT id FROM clients`.then((r) => leftOut(r, body.clients, mine)));
    if (Array.isArray(body.staff)) checks.push(sql`SELECT id FROM staff_bios`.then((r) => leftOut(r, body.staff)));
    if ((await Promise.all(checks)).some(Boolean)) {
      console.warn("dashboard-data: a save with no asOf (a tab from before) left out rows that exist: refused");
      return res.status(409).json({ error: "This page is out of date. Reload it and try again." });
    }
  }
  let priorClients = null;
  if ("clients" in body) {
    if (!Array.isArray(body.clients)) return res.status(400).json({ error: "clients[] is required." });
    priorClients = await sql`SELECT id, name, on_roster, sheet_tab_name, total_streams, roster_order, created_at FROM clients`;
    const sent = new Set(body.clients.map((c) => c.id));
    // limited: their own artists only, none added or deleted; Site without Publishing: deleting an
    // artist (their songs go with them) needs Publishing
    if (mine && body.clients.some((c) => !mine.has(c.id))) return res.status(403).json({ error: NOT_YOURS });
    const gone = priorClients.filter((c) => (mine ? mine.has(c.id) : true) && !sent.has(c.id) && deletable(c));
    if (gone.length && (mine || !can("publishing"))) return res.status(403).json({ error: "Deleting an artist needs Clients for every artist, so nothing was saved." });
  }
  if ("placements" in body) {
    if (!Array.isArray(body.placements)) return res.status(400).json({ error: "placements[] is required." });
    if (mine && body.placements.some((p) => !mine.has(p.clientId))) return res.status(403).json({ error: NOT_YOURS });
  }

  // password hashing (bcrypt) is CPU-bound JS work, not a DB call, so it has
  // to happen before the query array is built below — sql.transaction()
  // takes only query objects, nothing that awaits in between.
  let userQueryData = null, priorUsers = null;
  if ("users" in body) {
    if (!Array.isArray(body.users)) return res.status(400).json({ error: "users[] is required." });
    const MIN_PASSWORD_LENGTH = 8;
    const weakPassword = body.users.find((u) => u.password && u.password.trim() && u.password.trim().length < MIN_PASSWORD_LENGTH);
    if (weakPassword) {
      return res.status(400).json({ error: `Password for ${weakPassword.email || "that user"} must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    }
    // (2026-11-14) a password needs an email to sign in with, and two logins can't share one
    const noEmail = body.users.find((u) => u.password && u.password.trim() && !normEmail(u.email));
    if (noEmail) return res.status(400).json({ error: `Add ${noEmail.name ? `${noEmail.name}'s` : "their"} email first: a password needs an email to sign in with.` });
    const emails = body.users.map((u) => normEmail(u.email)).filter(Boolean);
    const twice = emails.find((e, i) => emails.indexOf(e) !== i);
    if (twice) return res.status(400).json({ error: `Two logins have the email ${twice}. An email can be on one login only.` });
    // password_hash is never sent to the client (see toUser), so UsersAdmin's
    // edit form only ever carries a plaintext `password` field when someone
    // actually typed a new one — blank means "keep the existing hash".
    // (2026-11-14) A user with no password (new, or made by lib/people-link.js) is a person with no login yet: kept,
    // never skipped. They get a set-password link once they have an email.
    const existing = await sql`SELECT id, email, role, name, client_id, password_hash, staff_role, access, password_changed_at, clickup_user_id, created_at FROM users`;
    priorUsers = existing;
    const hashById = Object.fromEntries(existing.map((u) => [u.id, u.password_hash]));
    // if the incoming list has nobody left who can sign in as staff (a staff login with a password), nobody could ever
    // sign in to fix that again short of a direct database edit. Covers deleting the last staff account, demoting it to
    // client, and (2026-11-14) staff with no password yet, who don't count.
    // (2026-11-14 review) …and an email to sign in with
    if (!body.users.some((u) => u.role === "staff" && (hashById[u.id] || (u.password && u.password.trim())) && normEmail(u.email))) {
      return res.status(400).json({ error: "At least one staff account must exist — can't delete or demote the last one." });
    }
    // Roles (lib/roles.js): only a Founder sets anyone's role or overrides; anyone else's save keeps what's
    // stored (an older tab sending no role keeps it too). A Founder's own login is a Founder's to change.
    const prior = Object.fromEntries(existing.map((u) => [u.id, u]));
    const anyFounder = existing.some((u) => u.role === "staff" && u.staff_role === "founder");
    const isFounderRow = (u) => u.role === "staff" && roleOf(u.staff_role, anyFounder) === "founder";
    const founderSave = a.role === "founder";
    // (2026-11-15) a NEW login for someone who has a staff login already is refused, nothing saved. The same name is a second account for them. A Co-manager or a
    // Founder is also matched by FIRST NAME (the own-artists rule: "Ella Kim" would be "Ella"'s artists' manager too, and the people link pairs them), so one is
    // refused when its first name is an existing staff login's; an Intern or a Client has no artists to mix up, so only the exact name is refused (an Intern "Ella
    // Kim" next to "Ella" is fine). It also catches a login the people link made while this tab was open (auto-staff-…: a row this tab's copy never had).
    // Editing an existing login is never checked.
    for (const u of body.users) {
      const name = String(u?.name || "").trim();
      if (!u || prior[u.id] || !name) continue;
      const newRole = u.role === "client" ? "client" : roleOf(founderSave && "staffRole" in u && ROLE_KEYS.includes(u.staffRole) ? u.staffRole : null, anyFounder);
      const same = existing.find((e) => e.role === "staff" && e.id !== u.id && String(e.name || "").trim().toLowerCase() === name.toLowerCase());
      if (same) return res.status(400).json({ error: `${name} already has an account.` });
      if (newRole === "comanager" || newRole === "founder") {
        const first = existing.find((e) => e.role === "staff" && e.id !== u.id && (sameManager(e.name, name) || sameManager(name, e.name)));
        if (first) return res.status(400).json({ error: `${name} would be matched to ${first.name}'s artists: the site matches managers by first name. Edit ${first.name}'s login, or use a different first name.` });
      }
    }
    if (!founderSave) {
      const sent = new Map(body.users.map((u) => [u.id, u]));
      const touched = existing.filter(isFounderRow).some((f) => {
        const u = sent.get(f.id);
        return !u || u.role !== f.role || (normEmail(u.email) || "") !== (f.email || "") || (u.name || "") !== (f.name || "") || (u.password && u.password.trim());
      });
      if (touched) return res.status(403).json({ error: "Only a Founder can change or delete a Founder's login, so nothing was saved." });
    }
    userQueryData = [];
    for (const u of body.users) {
      let hash = hashById[u.id] || null;
      const typed = !!(u.password && u.password.trim());
      if (typed) hash = await bcrypt.hash(u.password.trim(), 12);
      const was = prior[u.id];
      // (2026-11-10) kept through the save (it rewrites every row): when the password was set, the ClickUp id
      const pwAt = typed ? new Date().toISOString() : was?.password_changed_at || null, cuId = was?.clickup_user_id || "";
      let staffRole = null, access = {};
      if (u.role === "staff") {
        staffRole = founderSave && "staffRole" in u ? (ROLE_KEYS.includes(u.staffRole) ? u.staffRole : null) : (was?.staff_role ?? null);
        access = founderSave && "access" in u ? cleanAccess(roleOf(staffRole, true), u.access) : (was?.access || {});
      }
      userQueryData.push({ ...u, hash, typed, staffRole, access, pwAt, cuId });
    }
    if (userQueryData.some((u) => u.staffRole === "founder")) {
      // the first Founder set by hand: the Founder saving it (a Founder only because nobody was yet) stays one
      const me = userQueryData.find((u) => u.id === session.user.id && u.role === "staff" && !u.staffRole);
      if (me && founderSave) me.staffRole = "founder";
    } else if (anyFounder) {
      return res.status(400).json({ error: "There has to be at least one Founder, so nothing was saved." });
    }
  }

  const people = await peopleChanges(body, { priorClients, priorUsers, userQueryData, mine });
  const queries = [];

  // "clients" MUST be handled before "placements" (a placement's client_id
  // FK needs the client row to exist first for a same-request new client +
  // new song). It's also an UPSERT, not delete-all-then-reinsert: clients
  // is the one table other tables have real FKs into (placements CASCADE,
  // users SET NULL) — commit() always spreads the full db, so this key is
  // present on essentially every staff save, and a blind DELETE FROM
  // clients was cascading through those FKs on every single one of them.
  // That wiped all 140 real placements in production, restored from
  // migrate.mjs, then — before the fix could even deploy — a second stray
  // request hit the same still-live buggy code and SET NULL'd a client
  // user's client_id via the same cascade; repaired by hand. An upsert
  // only ever deletes a client that's genuinely gone from the new list
  // (an intentional delete, whose own placements/tab-release cleanup
  // already ran client-side in deleteClientCascade before this request),
  // so a client that's simply being edited/reordered is never deleted at
  // all and nothing referencing it ever cascades.
  // An account limited to its own artists sends only theirs: nothing else is deleted, and each keeps
  // its place in the roster. Without Publishing, a client's sheet tab and stream total stay as stored.
  const priorById = new Map((priorClients || []).map((c) => [c.id, c]));
  const rowFor = (c, i) => {
    const r = clientRow(c, i), was = priorById.get(c.id);
    if (mine && was) r.roster_order = was.roster_order;
    if (!can("publishing") && was) { r.sheet_tab_name = was.sheet_tab_name; r.total_streams = Number(was.total_streams); }
    return r;
  };
  if ("clients" in body) {
    const ids = body.clients.map((c) => c.id);
    // (2026-11-15) the clients this save adds are real to the people link from now on: written in this transaction (peopleSync:added), never apart from it
    if (people.addedClients.length) queries.push(addedMerge(people.addedClients));
    if (!mine && asOf) queries.push(ids.length ? sql`DELETE FROM clients WHERE id != ALL(${ids}) AND created_at < LEAST(${asOf}::timestamptz, now()) - interval '2 seconds'` : sql`DELETE FROM clients WHERE created_at < LEAST(${asOf}::timestamptz, now()) - interval '2 seconds'`);
    for (let i = 0; i < body.clients.length; i++) {
      const c = rowFor(body.clients[i], i);
      queries.push(sql`
        INSERT INTO clients (id, name, role, credit, bio, photo, spotify, apple, instagram, tiktok, youtube, soundcloud, sheet_tab_name, total_streams, on_roster, roster_order)
        VALUES (${c.id}, ${c.name}, ${c.role}, ${c.credit}, ${c.bio}, ${c.photo}, ${c.spotify}, ${c.apple}, ${c.instagram}, ${c.tiktok}, ${c.youtube}, ${c.soundcloud}, ${c.sheet_tab_name}, ${c.total_streams}, ${c.on_roster}, ${c.roster_order})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, role = EXCLUDED.role, credit = EXCLUDED.credit, bio = EXCLUDED.bio,
          photo = EXCLUDED.photo, spotify = EXCLUDED.spotify, apple = EXCLUDED.apple, instagram = EXCLUDED.instagram,
          tiktok = EXCLUDED.tiktok, youtube = EXCLUDED.youtube, soundcloud = EXCLUDED.soundcloud,
          sheet_tab_name = EXCLUDED.sheet_tab_name, total_streams = EXCLUDED.total_streams,
          on_roster = EXCLUDED.on_roster, roster_order = EXCLUDED.roster_order
      `);
    }
  }
  if ("placements" in body) {
    queries.push(mine ? sql`DELETE FROM placements WHERE client_id = ANY(${[...mine]})` : sql`DELETE FROM placements`);
    // an account without Money never got each song's money columns: they keep what's stored (2026-11-10)
    const kept = can("money") ? null : new Map((await sql`SELECT id, revenue, admin_fee FROM placements`).map((r) => [r.id, r]));
    for (const p of body.placements) {
      const row = placementRow(p);
      if (kept) { const was = kept.get(row.id); row.revenue = was ? Number(was.revenue) : 0; row.admin_fee = was ? Number(was.admin_fee) : 0; }
      queries.push(insertPlacement(row));
    }
  }
  // (2026-11-14) the team page and the logins: an upsert, and a row missing from the save deleted only when older than
  // the copy it was built on (asOf, above), never "delete all and insert again" (that wiped rows the server had added).
  // The team page keeps the order it was sent in (sort_order); a team row's login link (user_id) is the server's.
  if ("staff" in body) {
    if (!Array.isArray(body.staff)) return res.status(400).json({ error: "staff[] is required." });
    const rows = body.staff.map(staffRow), ids = rows.map((s) => s.id);
    // (2026-11-15) Site > Team's "Account" answers for these entries, in THIS transaction (peopleSync:accounts, an atomic jsonb merge): no run can read an
    // entry without its answer, and nothing waits for the people link's lock
    if (Object.keys(people.accounts).length) queries.push(accountsMerge(people.accounts));
    if (asOf) queries.push(ids.length ? sql`DELETE FROM staff_bios WHERE id != ALL(${ids}) AND created_at < LEAST(${asOf}::timestamptz, now()) - interval '2 seconds'` : sql`DELETE FROM staff_bios WHERE created_at < LEAST(${asOf}::timestamptz, now()) - interval '2 seconds'`);
    rows.forEach((s, i) => {
      queries.push(sql`
        INSERT INTO staff_bios (id, name, role, credit, bio, photo, email, instagram, visible, sort_order)
        VALUES (${s.id}, ${s.name}, ${s.role}, ${s.credit}, ${s.bio}, ${s.photo}, ${s.email}, ${s.instagram}, COALESCE(${s.visible}::boolean, true), ${i})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, credit = EXCLUDED.credit, bio = EXCLUDED.bio,
          photo = EXCLUDED.photo, email = EXCLUDED.email, instagram = EXCLUDED.instagram, sort_order = EXCLUDED.sort_order,
          visible = CASE WHEN ${s.visible}::boolean IS NULL THEN staff_bios.visible ELSE EXCLUDED.visible END
      `);
    });
  }
  if (userQueryData) {
    const ids = userQueryData.map((u) => u.id);
    if (asOf) queries.push(sql`DELETE FROM users WHERE id != ALL(${ids}) AND created_at < LEAST(${asOf}::timestamptz, now()) - interval '2 seconds'`);
    // a password only where one was typed: a blank keeps the stored one (also one set by a set-password link meanwhile)
    for (const u of userQueryData) {
      const r = userRow(u);
      queries.push(sql`
        INSERT INTO users (id, email, password_hash, role, name, client_id, staff_role, access, password_changed_at, clickup_user_id)
        VALUES (${r.id}, ${r.email}, ${r.password_hash}, ${r.role}, ${r.name}, ${r.client_id}, ${r.staff_role}, ${JSON.stringify(r.access)}, ${r.password_changed_at}, ${r.clickup_user_id})
        ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role, name = EXCLUDED.name, client_id = EXCLUDED.client_id,
          staff_role = EXCLUDED.staff_role, access = EXCLUDED.access,
          password_hash = CASE WHEN ${u.typed} THEN EXCLUDED.password_hash ELSE users.password_hash END,
          password_changed_at = CASE WHEN ${u.typed} THEN EXCLUDED.password_changed_at ELSE users.password_changed_at END
      `);
    }
  }
  if ("submissions" in body) {
    // (2026-11-10) an upsert, not delete-all-and-insert: a message's music link, files and ClickUp post stay as stored,
    // and a message that arrived after this tab loaded (newer than everything it sent) is never deleted by its save
    const rows = body.submissions.map(submissionRow);
    const ids = rows.map((s) => s.id);
    const newest = rows.map((s) => s.created_at).filter(Boolean).sort().pop() || null;
    queries.push(ids.length ? sql`DELETE FROM submissions WHERE id != ALL(${ids}) AND (${newest}::timestamptz IS NULL OR created_at <= ${newest}::timestamptz)` : sql`DELETE FROM submissions WHERE created_at < now() - interval '1 minute'`);
    for (const s of rows) {
      queries.push(sql`
        INSERT INTO submissions (id, name, email, instagram, subject, message, created_at, read)
        VALUES (${s.id}, ${s.name}, ${s.email}, ${s.instagram}, ${s.subject}, ${s.message}, ${s.created_at}, ${s.read})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, instagram = EXCLUDED.instagram,
          subject = EXCLUDED.subject, message = EXCLUDED.message, read = EXCLUDED.read
      `);
    }
  }
  if ("notableReleases" in body) {
    queries.push(sql`DELETE FROM notable_releases`);
    for (const n of body.notableReleases.map(notableRow)) {
      queries.push(sql`
        INSERT INTO notable_releases (id, song, artist, client, cover, release_date, link)
        VALUES (${n.id}, ${n.song}, ${n.artist}, ${n.client}, ${n.cover}, ${n.release_date}, ${n.link})
      `);
    }
  }
  if (body.site) {
    queries.push(sql`UPDATE site_settings SET about_text = ${body.site.about || ""} WHERE id = 1`);
  }
  if (body.sheetSync) {
    queries.push(sql`UPDATE site_settings SET last_synced_at = ${body.sheetSync.lastSyncedAt || null} WHERE id = 1`);
  }

  if (queries.length) {
    // the GET's own mappers over what's about to be stored (a submission's
    // time and the sync time come back from the database as Dates)
    const at = (v) => (v ? new Date(v) : null);
    const change = (now) => ({
      ...("clients" in body && { clients: mine
        ? now.clients.map((c) => { const i = body.clients.findIndex((x) => x.id === c.id); return i < 0 ? c : toClient(rowFor(body.clients[i], i)); })
        : body.clients.map((c, i) => toClient(rowFor(c, i))) }),
      ...("placements" in body && { placements: (mine ? now.placements.filter((p) => !mine.has(p.clientId)) : []).concat(body.placements.map((p) => toPlacement(placementRow(p)))) }),
      ...("staff" in body && { staff: body.staff.map((s) => toStaffBio(staffRow(s))) }),
      ...(userQueryData && { users: userQueryData.map((u) => toUser(userRow(u))) }),
      ...("submissions" in body && { submissions: body.submissions.map(submissionRow).map((s) => toSubmission({ ...s, created_at: at(s.created_at) })) }),
      ...("notableReleases" in body && { notableReleases: body.notableReleases.map((n) => toNotable(notableRow(n))) }),
      ...(body.site && { site: { about: body.site.about || "" } }),
      ...(body.sheetSync && { sheetSync: { lastSyncedAt: at(body.sheetSync.lastSyncedAt) } }),
    });
    try {
      // (the clients this save leaves: what it sent, and any it can't delete: added since its copy)
      if (await growsPastLimit(change, "clients" in body && !mine ? new Set([...body.clients.map((c) => c.id), ...priorClients.filter((c) => !deletable(c)).map((c) => c.id)]) : null)) {
        return res.status(413).json({ error: TOO_BIG });
      }
      await sql.transaction(queries);
    } catch (err) {
      console.error("dashboard-data save failed:", err);
      return res.status(502).json({ error: "Save failed — nothing was changed." });
    }
  }

  // a staff member who just typed a new password for their own account stays
  // signed in here; their other sessions end (see getCurrentSession)
  const own = userQueryData?.find((u) => u.id === session.user.id && u.password && u.password.trim());
  if (own) await restampSession(session, own.hash);
  // (2026-11-13, live: bucketboy1021 added after the 8 AM cron had no manager, so Magnus's own-artists view missed it) a
  // staff save that adds a client copies every client's manager from INFO now, one sheet read, not at the next cron
  if (role === "staff" && "clients" in body && body.clients.some((c) => !priorById.has(c.id))) {
    try { const m = await refreshManagers(); if (m.connected && m.error) console.error("managers after a new client:", m.error); } catch (err) { console.error("managers after a new client:", err); }
  }
  // a staff save that changed songs or clients: the Publishing ClickUp task follows (CLICKUP_TASK_WRITES only)
  if (role === "staff" && (body.placements || body.clients)) await afterAction(["publishing"]);
  // (2026-11-14) one person, same info everywhere (lib/people-link.js): a save that added, removed or renamed someone
  // (a login, a client, a team entry) puts them in the other places now, hidden and with no login. Its sheet writes
  // wait for the next Sync check or the nightly run; a team entry this account changed may change its login only with
  // Users (a Founder for a Founder's).
  if (role === "staff" && people.touched) await linkAfterSave({ users: can("users"), founder: a.role === "founder", staffChanges: people.staffChanges, addedClients: people.addedClients }, { sheet: false });

  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  // every staff account, and clients (their own portal: handled above, unchanged); what a staff account
  // may read and write is checked per table (lib/roles.js)
  const session = await requireAccess(req, res, null, { clients: true });
  if (!session) return;
  if (req.method === "GET") return handleGet(req, res, session);
  if (req.method === "POST") return handlePost(req, res, session);
  return res.status(405).json({ error: "GET or POST only" });
}
