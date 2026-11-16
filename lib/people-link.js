// One person, same info everywhere (2026-11-14). The owner wants the managers and clients kept in step both ways across
// the site's logins (users), the public site (the clients roster, the staff_bios team page) and the accounting sheet's
// INFO tab: someone added in one place appears in the others by itself, hidden and with no login, until a Founder
// turns them on. A PURE planner (planPeopleLink, tests/people-link.mjs) and an applier (applyPeopleLink), run together
// by runPeopleLink: after a dashboard save that touches the people (pages/api/dashboard-data.js), from the Sync check
// at most every 2 minutes (lib/sync-checks.js), from the nightly cron, and from Site › Sync's "Sync people now"
// (POST /api/people-sync { action: "link" }).
//
// The rules (a person on one side with nobody on the other):
//   a  a client row on INFO (not the company row)          -> a hidden client (on_roster false), linked to the row
//   b  a real site client not on INFO (on the roster, or     -> INFO C = their name, D = 20% (DEFAULT_COMMISSION: the
//      with songs, or with a client login)                     owner, 2026-11-15, "commission is always going to be 20
//                                                               percent"), E/F blank (saveClientToInfo, never growing Annual
//                                                               Summary: a person does that). A flag "commission not set" is
//                                                               only for a row whose D is blank (rule below)
//   c  a client on INFO, or real, with no client login row  -> a client user, no email, no password
//   d  a client user linked to no client                    -> linked to the client of that name, else a hidden client
//   e  a manager on INFO's list (L4:L13) with no staff user -> a Co-manager (own artists only), no email, no password
//   f  a Co-manager not on INFO's list                       -> the next free L cell (addManagerToInfo); full: a flag. (2026-11-15) Never a
//                                                               Founder: one goes on the list through Site > Users' form, when given artists
//   g  a staff user with no team page entry                 -> a hidden team entry, linked to the user
//   h  a team page entry with no user                       -> the account Site > Team's "Account" said (app_state 'peopleSync:accounts',
//                                                               saved in the same transaction as the entry): a Co-manager user (the entry's
//                                                               email if no one has it), an Intern user, or none. No answer: NO account, a flag
//                                                               that asks (never a default Co-manager). Rule f puts only a Co-manager on INFO's list
// Matching is personKey / sameManager / email only, links first (clients.info_name, users.client_id,
// staff_bios.user_id, and app_state's mlink for a user and their name on INFO's list). A near miss (personKey within 1
// edit (an adjacent swap being one), 2 when the shorter is 6+ letters or 4-5 letters with the same first letter; or one inside the
// other, the shorter 4+ letters, or a name that begins the other, 3+ letters: "Mag" and "Magnus") makes NOTHING: it's a flag, "X on INFO looks like Y on the site: same
// person?", answered with "Two different people" (app_state) or by linking them. Caden (prodzo's manager) and Cayden
// (the intern) are two people: the owner said so (TWO_PEOPLE).
// Removals never spread: app_state 'peopleSync:seen' keeps every side of every pairing it has seen. A partner is made
// only for someone never seen; a seen person whose partner is gone is a flag ("X was removed from the site, still on
// INFO"), never a new partner and never a delete. The first run marks everything as seen while it makes the backfill.
// The same info: a linked user's and team entry's names follow each other (the site only; INFO's names are never
// written, a difference is a flag). (2026-11-14 review) A team entry's name goes to its login only when the save that
// changed it came from an account with Users (a Founder for a Founder's login), and only the fields that save changed.
// An email is never copied either way by itself (a team page email is public, a login's is how they sign in): a
// difference is a flag with "Use it for the login" (applyTeamValue) for an account allowed to change that login.
// The first run is a person's (2026-11-14 review): until Site › Sync's "Sync people now" has been confirmed once (a
// preview first: runPeopleLink dryRun), the automatic runs only log that they're waiting.
// Concurrency: one run at a time (claimState 'peopleSync:link'), everything read again inside it; the rows it makes
// have fixed ids ('auto-<kind>-…') and go in with ON CONFLICT DO NOTHING, so two runs can't make anyone twice.
// Off with PEOPLE_AUTOLINK=off. Writing to the sheet also needs ACCOUNTING_SHEET_WRITES (lib/accounting-log.js).
// Server-only, but planPeopleLink is pure.
import { sql } from "./db";
import { personKey, ownerOf, findByName } from "./names";
import { sameManager, roleOf, ROLES } from "./roles";
import { getState, setState, claimState } from "./app-state";
import { infoLayout, saveClientToInfo, addManagerToInfo, DEFAULT_COMMISSION, LAST_ROW, LAST_MANAGER } from "./people-sync";
import { getSheetsClient } from "./sheets";
import { accountingSheetId } from "./accounting";
import { logWritesOn } from "./accounting-log";

export const SEEN_KEY = "peopleSync:seen", LAST_KEY = "peopleSync:last", LINK_LOCK = "peopleSync:link", ADDED_KEY = "peopleSync:added", ACCOUNTS_KEY = "peopleSync:accounts";
const LEASE_MIN = 3;
// the company row and Defied itself are never a client (the same rule as the Sync check's compareInfo)
const NOT_A_CLIENT = /^(general|company|defied)\b|\bcompany$/i;
// a login that isn't a person is never put on INFO's managers list or the team page
const NOT_A_PERSON = /^(admin|administrator|test|defied|info|team|staff|general)\b/i;
// (the owner, 2026-11-13) prodzo's manager Caden and the intern Cayden are two people
export const TWO_PEOPLE = [["Caden", "Cayden"]];
export const autolinkOn = () => String(process.env.PEOPLE_AUTOLINK ?? "").trim().toLowerCase() !== "off";

const str = (v) => String(v ?? "").trim();
const pk = personKey;
const first = (s) => str(s).split(/\s+/)[0] || "";
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(e));
// a short tag for a value (a flag about one particular difference: "Leave it" hides that one, a new one is asked again)
const hashOf = (v) => { let h = 5381; for (const ch of String(v ?? "")) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0; return h.toString(36); };
export const pairKey = (a, b) => [pk(a), pk(b)].sort().join("|");
// the same person: sameManager either way (a first name finds a full one: "Magnus" is "Magnus Gutmann")
export const samePerson = (a, b) => sameManager(a, b) || sameManager(b, a);
// the optimal string alignment distance (Damerau-Levenshtein): an adjacent swap is ONE edit ("Jamie" / "Jaime", "Brian" / "Brain")
function edits(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = [];
  for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
// a near miss: not the same personKey, but one edit away (a letter added, dropped or changed, or two neighbours swapped: "Jamie" / "Jaime", "Brian" /
// "Brain", "Caden" / "Cayden", "Kai" / "Kay"); or two edits away when the shorter name is 6+ letters ("Jordan" / "Jordyn", "Magnus" / "Marcus"), or 4-5
// letters and the two begin with the same letter ("Dani" / "Danny", "Sean" / "Shawn": but not "Hank" / "Dani", two letters changed from the first);
// or one inside the other when the shorter is 4+ letters; or one beginning the other from 3 letters ("Mag" / "Magnus": a short name for a long one).
// A 3-letter name is never two edits from a near miss: "Dani" and "Kai", "Ella" and "Ena" are not. (2026-11-15)
export function nearMiss(a, b) {
  const x = pk(a), y = pk(b);
  const short = Math.min(x.length, y.length);
  if (!x || !y || x === y || short < 3) return false;
  const s = x.length <= y.length ? x : y, l = x.length <= y.length ? y : x;
  if (l.startsWith(s) || (short >= 4 && l.includes(s))) return true;
  const d = edits(x, y);
  return d <= 1 || (d === 2 && (short >= 6 || (short >= 4 && x[0] === y[0])));
}
// the state as stored (or none yet)
export function readSeen(v) {
  const o = v && typeof v === "object" ? v : {};
  return {
    started: !!o.started, keys: new Set(Array.isArray(o.keys) ? o.keys : []), mlink: o.mlink && typeof o.mlink === "object" ? { ...o.mlink } : {},
    base: o.base && typeof o.base === "object" ? o.base : {}, distinct: new Set(Array.isArray(o.distinct) ? o.distinct : []), dismissed: new Set(Array.isArray(o.dismissed) ? o.dismissed : []),
  };
}
// a free fixed id: the wanted one, or with -2, -3 … when another row has it already
function freeId(want, taken) {
  if (!taken.has(want)) { taken.add(want); return want; }
  for (let i = 2; ; i++) if (!taken.has(`${want}-${i}`)) { taken.add(`${want}-${i}`); return `${want}-${i}`; }
}

// --- the planner (pure) ----------------------------------------------------------------------------------------------
// info: lib/people-sync.js infoLayout of INFO!A1:M45 (FORMULA), or null when INFO couldn't be read (then nothing that
// needs INFO is planned, flagged or forgotten). clients: rows (id, name, sheet_tab_name, on_roster, info_name, credit).
// users: rows (id, email, has_hash or password_hash, role, name, client_id, staff_role). staff: staff_bios rows (id,
// name, email, role, user_id, visible). placementCounts: { clientId: songs }. seen: app_state 'peopleSync:seen' (null:
// the first run). actor: the save that started this run ({ users, founder, staffChanges: { staffId: [the fields it changed] },
// addedClients: [ids of clients a person has just added] }), or null. -> { create: { clients, users, staff, infoClients, infoManagers }, link, update, flags, seen, pending }:
// seen is the state to keep once the database part is in; pending, the keys each sheet write adds when it goes in.
export function planPeopleLink({ info = null, clients = [], users = [], staff = [], placementCounts = {}, seen = null, actor = null, addedClients = [], accounts = {} } = {}) {
  const was = readSeen(seen);
  const had = (k) => was.keys.has(k);
  const keys = new Set();
  const two = (a, b) => was.distinct.has(pairKey(a, b)) || TWO_PEOPLE.some(([x, y]) => pairKey(x, y) === pairKey(a, b));
  const out = { create: { clients: [], users: [], staff: [], infoClients: [], infoManagers: [] }, link: [], update: [], flags: [], pending: { infoClients: {}, infoManagers: {} } };
  const flagKeys = new Set();
  const flag = (key, kind, text, extra = {}) => {
    if (flagKeys.has(key) || was.dismissed.has(key)) return;
    flagKeys.add(key);
    out.flags.push({ key, kind, text, ...extra });
  };
  const userFix = (u, label = `Open ${u.name || "the login"}`) => ({ kind: "go", tab: "site", sub: `users:${u.id}`, label });
  const clientFix = (c, label = `Open ${c.name}`) => ({ kind: "go", tab: "site", sub: `roster:${c.id}`, label });
  const teamFix = (t, label = `Open ${t.name}`) => ({ kind: "go", tab: "site", sub: `staff:${t.id}`, label });
  const sheetFix = { kind: "sheet", label: "Open the sheet ↗" };
  // a near miss: asked once per pair, with what "Two different people" stores (pair) and what "Same person" links (link)
  const near = (a, b, where, fix, link) => flag(`near:${pairKey(a, b)}`, "near", `${a} ${where[0]} looks like ${b} ${where[1]}: same person? Nothing was added for ${a} until that's answered.`, { fix, pair: [a, b], link });

  const C = clients.map((c) => ({ id: c.id, name: str(c.name), sheet_tab_name: str(c.sheet_tab_name), on_roster: !!c.on_roster, info_name: str(c.info_name), credit: str(c.credit) }));
  const U = users.map((u) => ({ id: u.id, email: str(u.email).toLowerCase(), hasHash: !!(u.has_hash ?? u.password_hash), login: !!str(u.email) && !!(u.has_hash ?? u.password_hash), role: u.role, name: str(u.name), clientId: u.client_id || null, staffRole: u.staff_role || null }));
  const T = staff.map((s) => ({ id: s.id, name: str(s.name), email: str(s.email).toLowerCase(), role: str(s.role), userId: str(s.user_id), visible: s.visible !== false }));
  const ids = { clients: new Set(C.map((c) => c.id)), users: new Set(U.map((u) => u.id)), staff: new Set(T.map((t) => t.id)) };
  const anyFounder = U.some((u) => u.role === "staff" && u.staffRole === "founder");
  const roleOfU = (u) => roleOf(u.staffRole, anyFounder);
  const staffUsers = () => U.filter((u) => u.role === "staff");
  const infoOk = !!info && !info.problem && Array.isArray(info.roster);
  const R = infoOk ? info.roster.filter((r) => !r.company && !NOT_A_CLIENT.test(r.name) && pk(r.name)) : [];
  const M = infoOk ? (info.managers || []).filter((m) => pk(m.name)) : [];
  const songs = (c) => Number(placementCounts[c.id]) > 0;
  const loginClients = () => new Set(U.filter((u) => u.role === "client" && u.login && u.clientId).map((u) => u.clientId));
  // (2026-11-15) a client a PERSON has added (addedClients: the ones the dashboard said it added, kept in app_state 'peopleSync:added', and
  // actor.addedClients: the ones this very save added) is real too: it starts hidden, with no songs and no login, so by itself it would be left
  // alone (a test client is never put on INFO). Kept, so a run that couldn't finish (busy, the sheet away) is finished by the next one.
  const added = new Set([...(Array.isArray(addedClients) ? addedClients : []), ...(Array.isArray(actor?.addedClients) ? actor.addedClients : [])]);
  const real = (c) => c.on_roster || songs(c) || loginClients().has(c.id) || added.has(c.id);

  // 1. INFO's client rows and the site's clients: the stored link first, then the name (ownerOf)
  const rowClient = new Map(), clientRow = new Map();
  const pairRow = (r, c) => { rowClient.set(r, c); clientRow.set(c.id, r); };
  if (infoOk) {
    const liveKeys = new Set(R.map((r) => pk(r.name)));
    for (const r of R) {
      const c = findByName(C.filter((x) => x.info_name && !clientRow.has(x.id)), r.name, (x) => x.info_name);
      if (c) pairRow(r, c);
    }
    for (const r of R) {
      if (rowClient.has(r)) continue;
      const c = ownerOf(C.filter((x) => !clientRow.has(x.id) && !(x.info_name && liveKeys.has(pk(x.info_name)))), r.name);
      if (c) pairRow(r, c);
    }
    for (const [r, c] of rowClient) {
      if (c.info_name !== r.name) { out.link.push({ kind: "client-info", clientId: c.id, infoName: r.name, name: c.name }); c.info_name = r.name; }
      // a client renamed on the site: still their row (the link), and said, since the sheet's own formulas match names
      if (!ownerOf([c], r.name)) flag(`differ:client:${c.id}`, "differ", `${c.name} on the site is ${r.name} on INFO (row ${r.row}). INFO's names are never changed from here: rename one of them so they match.`, { fix: clientFix(c) });
    }
    // a: an INFO client with nobody on the site
    for (const r of R) {
      const k = `ci:info:${pk(r.name)}`;
      if (rowClient.has(r)) { keys.add(k); continue; }
      if (had(k)) { flag(`gone:${k}`, "removed", `${r.name} was removed from the site, but is still on INFO (row ${r.row}). Nothing was changed: remove them from INFO too, or add them back on the site.`, { fix: sheetFix }); continue; }
      const same = ownerOf(C, r.name);
      if (same) { flag(`dup:info:${pk(r.name)}`, "duplicate", `INFO lists ${r.name} on row ${r.row} and again on row ${clientRow.get(same.id)?.row ?? "?"}: the site has them once, as ${same.name}.`, { fix: sheetFix }); continue; }
      const like = C.find((c) => [c.name, c.sheet_tab_name, c.info_name].some((n) => n && nearMiss(n, r.name) && !two(n, r.name)));
      if (like) { near(r.name, like.name, ["on INFO", "on the site"], clientFix(like), { kind: "client-info", clientId: like.id, infoName: r.name }); continue; }
      const id = freeId(`auto-client-${pk(r.name)}`, ids.clients);
      const c = { id, name: r.name, sheet_tab_name: "", on_roster: false, info_name: r.name, credit: "" };
      C.push(c); pairRow(r, c);
      out.create.clients.push({ id, name: r.name, on_roster: false, info_name: r.name, why: "a" });
      keys.add(k); keys.add(`ci:client:${id}`);
    }
    // commission: a client row whose D is blank
    for (const r of R) if (r.raw ? str(r.raw.D) === "" : r.rate == null) flag(`commission:${pk(r.name)}`, "commission", `Commission not set for ${r.name} on INFO (row ${r.row}): type their Comm. Rate in column D.`, { fix: sheetFix });
  }

  // d: a client login linked to no client
  const nearClients = new Set();
  for (const u of U.filter((x) => x.role === "client")) {
    const k = `cu:user:${u.id}`;
    if (u.clientId && C.some((c) => c.id === u.clientId)) { keys.add(k); continue; }
    if (had(k)) { flag(`gone:${k}`, "removed", `${u.name || "A client login"}'s client was removed from the site, so the login isn't linked to a client now. Nothing was changed.`, { fix: userFix(u) }); continue; }
    if (!pk(u.name)) { flag(`noname:${u.id}`, "noname", "A client login has no name and no client, so nothing was made for it. Give it a name or link it to a client.", { fix: userFix(u, "Open the login") }); continue; }
    const hit = ownerOf(C, u.name);
    // (2026-11-14 review) a login with a password would see that client's songs: linked by its name only when it has
    // none yet, else asked ("same person?", answered with "Same person", the pair action)
    if (hit && u.hasHash) { nearClients.add(hit.id); flag(`same:user-client:${u.id}:${hit.id}`, "near", `${u.name} (a client login with a password, linked to no client) has the same name as the client ${hit.name}: same person? It isn't linked until that's answered.`, { fix: userFix(u), pair: [u.name, hit.name], link: { kind: "user-client", userId: u.id, clientId: hit.id } }); continue; }
    if (hit) { out.link.push({ kind: "user-client", userId: u.id, clientId: hit.id, name: u.name }); u.clientId = hit.id; keys.add(k); continue; }
    const like = C.find((c) => [c.name, c.sheet_tab_name].some((n) => n && nearMiss(n, u.name) && !two(n, u.name)));
    if (like) { nearClients.add(like.id); near(u.name, like.name, ["(a client login)", "on the site"], userFix(u), { kind: "user-client", userId: u.id, clientId: like.id }); continue; }
    const id = freeId(`auto-client-${pk(u.name)}`, ids.clients);
    C.push({ id, name: u.name, sheet_tab_name: "", on_roster: false, info_name: "", credit: "" });
    out.create.clients.push({ id, name: u.name, on_roster: false, info_name: "", why: "d" });
    out.link.push({ kind: "user-client", userId: u.id, clientId: id, name: u.name });
    u.clientId = id; keys.add(k); keys.add(`cu:client:${id}`);
  }

  // b: a real site client that isn't on INFO
  if (infoOk) {
    let room = info.nextClientRow == null ? 0 : LAST_ROW - info.nextClientRow + 1;
    const full = [];
    for (const c of C) {
      const k = `ci:client:${c.id}`;
      if (clientRow.has(c.id)) { keys.add(k); continue; }
      if (NOT_A_CLIENT.test(c.name) || !pk(c.name)) continue;
      if (had(k)) { flag(`gone:${k}`, "removed", `${c.name} was removed from INFO, but is still on the site. Nothing was changed: add them back on INFO, or delete them on the site.`, { fix: clientFix(c) }); continue; }
      if (!real(c)) continue;
      const taken = R.find((r) => ownerOf([c], r.name));
      if (taken) { flag(`taken:${c.id}`, "duplicate", `${c.name} matches ${taken.name} on INFO (row ${taken.row}), which is ${rowClient.get(taken)?.name || "another client"}'s row. Nothing was added.`, { fix: clientFix(c) }); continue; }
      const like = R.find((r) => [c.name, c.sheet_tab_name].some((n) => n && nearMiss(n, r.name) && !two(n, r.name)));
      if (like) { near(c.name, like.name, ["on the site", `on INFO (row ${like.row})`], clientFix(c), { kind: "client-info", clientId: c.id, infoName: like.name }); continue; }
      if (room <= 0) { full.push(c.name); continue; }
      room--;
      out.create.infoClients.push({ clientId: c.id, name: c.name });
      out.pending.infoClients[c.id] = [k, `ci:info:${pk(c.name)}`];
    }
    if (full.length) flag("full:clients", "full", `INFO's client list is full (rows 4 to ${LAST_ROW}), so ${full.join(", ")} ${full.length === 1 ? "isn't" : "aren't"} on it. Make room on INFO.`, { fix: sheetFix });
  }

  // c: a client on INFO, or real, with no client login row
  const hasUser = new Set(U.filter((u) => u.role === "client" && u.clientId).map((u) => u.clientId));
  for (const c of C) {
    if (!(clientRow.has(c.id) || real(c)) || NOT_A_CLIENT.test(c.name) || !pk(c.name)) continue;
    const k = `cu:client:${c.id}`;
    if (hasUser.has(c.id)) { keys.add(k); continue; }
    if (had(k)) { flag(`gone:${k}`, "removed", `${c.name}'s client account was deleted on the site. Nothing was made again.`, { fix: clientFix(c) }); continue; }
    if (nearClients.has(c.id)) continue;
    const id = freeId(`auto-cu-${c.id}`, ids.users);
    U.push({ id, email: "", login: false, role: "client", name: c.name, clientId: c.id, staffRole: null });
    out.create.users.push({ id, role: "client", name: c.name, client_id: c.id, staff_role: null, access: {}, email: null, why: "c" });
    hasUser.add(c.id); keys.add(k); keys.add(`cu:user:${id}`);
  }

  // 2. INFO's managers and the staff users: the stored link (mlink) first, then sameManager
  const mUser = new Map(), userM = new Map(), mlink = {};
  const pairM = (m, u) => { mUser.set(m, u); userM.set(u.id, m); mlink[u.id] = pk(m.name); };
  const unclear = new Set();
  const newStaff = new Map(); // id -> its create record, so a team entry found for it can give it the email
  if (infoOk) {
    for (const m of M) {
      const u = staffUsers().find((x) => was.mlink[x.id] === pk(m.name) && !userM.has(x.id));
      if (u) pairM(m, u);
    }
    for (const m of M) {
      if (mUser.has(m)) continue;
      const hits = staffUsers().filter((u) => !userM.has(u.id) && sameManager(m.name, u.name));
      if (hits.length === 1) pairM(m, hits[0]);
      else if (hits.length > 1) { unclear.add(m); flag(`unclear:m:${pk(m.name)}`, "unclear", `${m.name} on INFO's manager list matches ${hits.length} logins (${hits.map((u) => u.name).join(", ")}), so nothing was linked. Give them different names.`, { fix: userFix(hits[0]) }); }
    }
    for (const [m, u] of mUser) if (!sameManager(m.name, u.name)) flag(`differ:m:${u.id}`, "differ", `${u.name}'s login is ${m.name} on INFO's manager list. Their own-artists view matches on the name, so make the two the same (INFO's names are never changed from here).`, { fix: userFix(u) });
    // e: a manager on INFO with no staff user
    for (const m of M) {
      const k = `mu:info:${pk(m.name)}`;
      if (mUser.has(m)) { keys.add(k); continue; }
      if (unclear.has(m)) continue;
      if (had(k)) { flag(`gone:${k}`, "removed", `${m.name}'s site account was removed, but they're still on INFO's manager list (L${m.row}). Nothing was changed.`, { fix: sheetFix }); continue; }
      const same = staffUsers().find((u) => sameManager(m.name, u.name));
      if (same) { flag(`dup:m:${pk(m.name)}`, "duplicate", `INFO's manager list has ${m.name} (L${m.row}) and ${userM.get(same.id)?.name || "another name"} for the same login, ${same.name}.`, { fix: sheetFix }); continue; }
      const like = staffUsers().find((u) => [u.name, first(u.name)].some((n) => nearMiss(n, m.name) && !two(n, m.name)));
      if (like) { near(m.name, like.name, ["on INFO's manager list", "on the site"], userFix(like), { kind: "user-manager", userId: like.id, infoName: m.name }); continue; }
      const id = freeId(`auto-staff-${pk(m.name)}`, ids.users);
      const u = { id, email: "", login: false, role: "staff", name: m.name, clientId: null, staffRole: "comanager" };
      U.push(u); pairM(m, u);
      const rec = { id, role: "staff", name: m.name, client_id: null, staff_role: "comanager", access: { ownOnly: true }, email: null, why: "e" };
      out.create.users.push(rec); newStaff.set(id, rec);
      keys.add(k); keys.add(`mu:user:${id}`);
    }
  }

  // 3. The team page and the staff users: the stored link, then the email, then the name
  const teamUser = new Map(), userTeam = new Map();
  const pairT = (t, u, how) => {
    teamUser.set(t, u); userTeam.set(u.id, t);
    if (how) { out.link.push({ kind: "team-user", staffId: t.id, userId: u.id, name: t.name }); t.userId = u.id; }
    // a user made just now for an INFO manager takes the team entry's email (rule h's), when nobody has it
    const rec = newStaff.get(u.id);
    if (rec && !rec.email && validEmail(t.email) && !U.some((x) => x.email === t.email)) { rec.email = t.email; u.email = t.email; }
  };
  const unclearT = new Set();
  for (const t of T) {
    const u = t.userId && U.find((x) => x.id === t.userId);
    if (u && !userTeam.has(u.id)) pairT(t, u, false);
  }
  for (const t of T) {
    if (teamUser.has(t) || !t.email) continue;
    const hits = staffUsers().filter((u) => !userTeam.has(u.id) && u.email && u.email === t.email);
    if (hits.length === 1) pairT(t, hits[0], true);
  }
  for (const t of T) {
    if (teamUser.has(t) || !pk(t.name)) continue;
    const hits = staffUsers().filter((u) => !userTeam.has(u.id) && samePerson(u.name, t.name));
    if (hits.length === 1) pairT(t, hits[0], true);
    else if (hits.length > 1) { unclearT.add(t.id); hits.forEach((u) => unclearT.add(u.id)); flag(`unclear:t:${t.id}`, "unclear", `${t.name} on the team page matches ${hits.length} logins (${hits.map((u) => u.name).join(", ")}), so nothing was linked.`, { fix: teamFix(t) }); }
  }
  // h: a team entry with no user. (2026-11-15) The account made is the one Site > Team's "Account" said: a Co-manager (and on INFO's list, rule f), an
  // Intern (Site only, never on INFO), or none at all. The answer is app_state 'peopleSync:accounts' ({ teamId: "comanager" | "intern" | "none" }),
  // saved in the same transaction as the entry itself (pages/api/dashboard-data.js), so a run can't read the entry without it. An entry nobody has
  // answered for gets NO account and a flag that asks: never a default Co-manager.
  const acctOf = (id) => { const v = accounts && accounts[id]; return v === "comanager" || v === "intern" || v === "none" ? v : null; };
  for (const t of T) {
    const k = `ut:staff:${t.id}`;
    if (teamUser.has(t)) { keys.add(k); continue; }
    if (!pk(t.name) || unclearT.has(t.id)) continue;
    const want = acctOf(t.id);
    if (want === "none") continue; // the person said "No account": none is made, none is asked about
    if (had(k)) { flag(`gone:${k}`, "removed", `${t.name}'s site account was removed, but they're still on the team page. Nothing was changed.`, { fix: teamFix(t) }); continue; }
    const same = staffUsers().find((u) => samePerson(u.name, t.name));
    if (same) { flag(`dup:t:${t.id}`, "duplicate", `The team page lists ${t.name} again: ${same.name}'s login already has ${userTeam.get(same.id)?.name ? `the entry "${userTeam.get(same.id).name}"` : "an entry"}.`, { fix: teamFix(t) }); continue; }
    const like = staffUsers().find((u) => [u.name, first(u.name)].some((n) => (nearMiss(n, t.name) || nearMiss(n, first(t.name))) && !two(n, t.name)));
    if (like) { near(t.name, like.name, ["on the team page", "(a login)"], teamFix(t), { kind: "team-user", staffId: t.id, userId: like.id }); continue; }
    if (!want) { flag(`ask:acct:${t.id}`, "account", `${t.name} on the team page has no account: pick Manager, Intern or No account.`, { fix: teamFix(t) }); continue; }
    const id = freeId(`auto-staff-${pk(t.name)}`, ids.users);
    const email = validEmail(t.email) && !U.some((x) => x.email === t.email) ? t.email : null;
    const u = { id, email: email || "", login: false, role: "staff", name: t.name, clientId: null, staffRole: want };
    U.push(u);
    out.create.users.push({ id, role: "staff", name: t.name, client_id: null, staff_role: want, access: want === "comanager" ? { ownOnly: true } : {}, email, why: "h" });
    pairT(t, u, true);
    keys.add(k); keys.add(`ut:user:${id}`);
  }

  // f: a Co-manager who isn't on INFO's manager list (2026-11-15: not a Founder: one goes on it through Site > Users' form, when given artists)
  if (infoOk) {
    let room = info.nextManagerRow == null ? 0 : LAST_MANAGER - info.nextManagerRow + 1;
    const full = [];
    for (const u of staffUsers()) {
      const k = `mu:user:${u.id}`;
      if (userM.has(u.id)) { keys.add(k); continue; }
      const role = roleOfU(u);
      if (role !== "comanager" || !pk(u.name)) continue;
      if (NOT_A_PERSON.test(u.name)) { flag(`notperson:${u.id}`, "info", `${u.name} isn't put on INFO's manager list: it doesn't look like a person's name.`, { fix: userFix(u) }); continue; }
      if ([...unclear].some((m) => sameManager(m.name, u.name))) continue;
      if (had(k)) { flag(`gone:${k}`, "removed", `${u.name} was taken off INFO's manager list, but still has a site account. Nothing was changed.`, { fix: userFix(u) }); continue; }
      const same = M.find((m) => sameManager(m.name, u.name) || personKey(m.name) === personKey(u.name));
      if (same) { flag(`dup:fm:${u.id}`, "duplicate", `${u.name}'s login has the name ${same.name} on INFO's manager list (L${same.row}), which is ${mUser.get(same)?.name ? `${mUser.get(same).name}'s` : "another login's"}. Nothing was added to INFO.`, { fix: userFix(u) }); continue; }
      const like = M.find((m) => [u.name, first(u.name)].some((n) => nearMiss(m.name, n) && !two(m.name, n)));
      if (like) { near(u.name, like.name, ["(a login)", `on INFO's manager list (L${like.row})`], userFix(u), { kind: "user-manager", userId: u.id, infoName: like.name }); continue; }
      if (room <= 0) { full.push(u.name); continue; }
      room--;
      out.create.infoManagers.push({ userId: u.id, name: u.name });
      out.pending.infoManagers[u.id] = [k, `mu:info:${pk(u.name)}`];
    }
    if (full.length) flag("full:managers", "full", `INFO's manager list is full (L4 to L${LAST_MANAGER}), so ${full.join(", ")} ${full.length === 1 ? "isn't" : "aren't"} on it.`, { fix: sheetFix });
  }

  // g: a staff user with no team page entry
  for (const u of staffUsers()) {
    const k = `ut:user:${u.id}`;
    if (userTeam.has(u.id)) { keys.add(k); continue; }
    if (!pk(u.name) || NOT_A_PERSON.test(u.name) || unclearT.has(u.id)) continue;
    if (had(k)) { flag(`gone:${k}`, "removed", `${u.name} was taken off the team page, but still has a site account. Nothing was changed (an entry can stay hidden instead).`, { fix: userFix(u) }); continue; }
    // (2026-11-14 review) a team entry by that name already (another login's): a duplicate flag, never a second entry
    const same = T.find((t) => samePerson(t.name, u.name));
    if (same) { flag(`dup:tg:${u.id}`, "duplicate", `The team page has ${same.name} already${teamUser.get(same) ? `, linked to ${teamUser.get(same).name}'s ${teamUser.get(same).login ? "login" : "account"}` : ""}: no second entry was made for ${u.name}'s login.`, { fix: teamFix(same) }); continue; }
    const like = T.find((t) => [t.name, first(t.name)].some((n) => (nearMiss(n, u.name) || nearMiss(n, first(u.name))) && !two(n, u.name)));
    if (like) { near(u.name, like.name, ["(a login)", "on the team page"], userFix(u), { kind: "team-user", staffId: like.id, userId: u.id }); continue; }
    const id = freeId(`auto-team-${u.id}`, ids.staff);
    // (2026-11-14 review) no email: a team page email is public, the person's login one isn't for it
    const t = { id, name: u.name, email: "", role: ROLES[roleOfU(u)]?.label || "", userId: u.id, visible: false };
    T.push(t); teamUser.set(t, u); userTeam.set(u.id, t);
    out.create.staff.push({ id, name: u.name, email: "", role: t.role, visible: false, user_id: u.id, why: "g" });
    keys.add(k); keys.add(`ut:staff:${id}`);
  }

  // 4. The same info: a linked user and team entry (name, email), and a client and the client login that follows it.
  // Each pair's last values in step are kept (base); the side that changed since is copied, when allowed.
  const base = {};
  const created = new Set([...out.create.users.map((u) => u.id), ...out.create.staff.map((s) => s.id)]);
  for (const [t, u] of teamUser) {
    if (created.has(t.id) || created.has(u.id)) { base[`t:${t.id}`] = { name: { u: u.name, t: t.name }, email: { u: u.email, t: t.email } }; continue; }
    const b = was.base[`t:${t.id}`] || {}, nb = {};
    const founderLogin = u.role === "staff" && roleOfU(u) === "founder";
    // what this save changed on this entry (actor.staffChanges: { staffId: ["name", "email"] }); a run no save started: nothing
    const changedNow = Array.isArray(actor?.staffChanges?.[t.id]) ? actor.staffChanges[t.id] : [];
    const mayChangeLogin = !!actor?.users && (!founderLogin || !!actor.founder);
    for (const f of ["name", "email"]) {
      const uv = u[f], tv = t[f], bf = b[f];
      if (uv === tv || !bf) { nb[f] = { u: uv, t: tv }; continue; }
      const inStep = bf.u === bf.t, uMoved = uv !== bf.u, tMoved = tv !== bf.t;
      const ask = (text) => flag(`differ:t:${t.id}:${f}:${hashOf(tv)}`, "differ", text, { fix: userFix(u), apply: { staffId: t.id, field: f }, founderLogin });
      if (uMoved && !tMoved) {
        // the login changed: the team entry's name follows it when the two were the same; an email never does
        if (inStep && f === "name") { out.update.push({ table: "staff_bios", id: t.id, field: f, from: tv, to: uv, name: u.name }); nb[f] = { u: uv, t: uv }; }
        else nb[f] = { u: uv, t: tv };
        continue;
      }
      if (tMoved && !uMoved && inStep) {
        // the team entry changed: its name goes to the login only when this very save changed it, from an account
        // allowed to change that login; an email never goes by itself (and an older change waiting here never does)
        if (f === "name" && changedNow.includes("name") && mayChangeLogin && pk(tv)) { out.update.push({ table: "users", id: u.id, field: f, from: uv, to: tv, name: u.name }); nb[f] = { u: tv, t: tv }; continue; }
        ask(f === "name"
          ? `${u.name}'s name on the team page is ${tv} now; their login still says ${uv}. Someone who can change that login can use it for the login, or change one of them.`
          : `${t.name}'s email on the team page changed, and isn't the one their login signs in with. It's never copied by itself: use it for the login only if it's the address they sign in with.`);
        nb[f] = bf; continue;
      }
      if (uMoved && tMoved) ask(`${t.name}'s ${f} was changed on the team page and on their login, differently. Make them the same.`);
      nb[f] = uMoved && tMoved ? bf : { u: uv, t: tv };
    }
    base[`t:${t.id}`] = nb;
  }
  for (const u of U.filter((x) => x.role === "client" && x.clientId)) {
    const c = C.find((x) => x.id === u.clientId);
    if (!c) continue;
    const b = was.base[`c:${u.id}`];
    if (b && c.name !== b.c && u.name === b.u && b.u === b.c && pk(c.name) && !created.has(u.id)) {
      out.update.push({ table: "users", id: u.id, field: "name", from: u.name, to: c.name, name: c.name });
      base[`c:${u.id}`] = { c: c.name, u: c.name };
    } else base[`c:${u.id}`] = { c: c.name, u: u.name };
  }

  // the state to keep: the keys of everyone still here (a side that couldn't be read keeps what it had)
  const exists = (k) => {
    const [rel, side, ...rest] = k.split(":"), id = rest.join(":");
    if (side === "client") return C.some((c) => c.id === id);
    if (side === "user") return U.some((u) => u.id === id);
    if (side === "staff") return T.some((t) => t.id === id);
    if (side === "info") return !infoOk || (rel === "mu" ? M : R).some((x) => pk(x.name) === id);
    return false;
  };
  const kept = new Set([...[...was.keys].filter(exists), ...keys]);
  const userIds = new Set(U.map((u) => u.id));
  const ml = infoOk ? mlink : Object.fromEntries(Object.entries(was.mlink).filter(([id]) => userIds.has(id)));
  out.seen = { v: 1, started: true, keys: [...kept].sort(), mlink: ml, base, distinct: [...was.distinct], dismissed: [...was.dismissed], at: null };
  return out;
}

// --- reading and applying ------------------------------------------------------------------------------------------
const INFO_RANGE = "INFO!A1:M45";
// Everything the planner needs, read fresh: the people tables, songs per client, the seen state, and INFO (FORMULA, the
// layout lib/people-sync.js plans its writes from). INFO that can't be read is null, with why.
// timeoutMs: how long INFO's read may take (a dashboard save waits on it: Google slow or down is "INFO not compared")
export async function readPeopleInput({ sheets = null, spreadsheetId = accountingSheetId(), timeoutMs = 20000 } = {}) {
  const [clients, users, staff, counts, seen, added, accounts] = await Promise.all([
    sql`SELECT id, name, sheet_tab_name, on_roster, info_name, credit FROM clients ORDER BY roster_order, id`,
    sql`SELECT id, email, (password_hash IS NOT NULL AND password_hash <> '') AS has_hash, role, name, client_id, staff_role FROM users ORDER BY id`,
    sql`SELECT id, name, email, role, user_id, visible FROM staff_bios ORDER BY id`,
    sql`SELECT client_id, count(*)::int AS n FROM placements GROUP BY client_id`,
    getState(SEEN_KEY),
    getState(ADDED_KEY).catch(() => null),
    getState(ACCOUNTS_KEY).catch(() => null),
  ]);
  let info = null, infoError = null, S = sheets;
  if (!spreadsheetId) infoError = "The accounting sheet isn't connected yet.";
  else {
    try {
      S = sheets || getSheetsClient();
      let timer;
      const late = new Promise((_, no) => { timer = setTimeout(() => no(new Error("Google took too long")), timeoutMs); });
      const got = await Promise.race([S.spreadsheets.values.get({ spreadsheetId, range: INFO_RANGE, valueRenderOption: "FORMULA" }), late]).finally(() => clearTimeout(timer));
      const grid = got.data.values || [];
      info = infoLayout(grid);
      if (info.problem) { infoError = info.problem; info = null; }
    } catch (err) { infoError = `Couldn't read INFO just now (${err?.message || err}).`; info = null; }
  }
  return { clients, users, staff, placementCounts: Object.fromEntries(counts.map((r) => [r.client_id, r.n])), seen, addedClients: Array.isArray(added?.ids) ? added.ids : [], accounts: accounts && typeof accounts === "object" ? accounts : {}, info, infoError, sheets: S, spreadsheetId };
}
// (2026-11-15) Site > Team's "Account" answers live in app_state 'peopleSync:accounts' ({ teamId: "comanager" | "intern" | "none" }), written by
// pages/api/dashboard-data.js in the SAME transaction as the team rows (a jsonb merge: INSERT ... ON CONFLICT DO UPDATE SET value = app_state.value ||
// EXCLUDED.value), so there is no moment when an entry exists without its answer, and nothing waits for a lock. accountsMerge builds that statement.
export const accountsMerge = (map) => sql`INSERT INTO app_state (key, value, updated_at) VALUES (${ACCOUNTS_KEY}, ${JSON.stringify(map)}::jsonb, now())
  ON CONFLICT (key) DO UPDATE SET value = app_state.value || EXCLUDED.value, updated_at = now()`;
// the same for the clients a person has added: one atomic append to the list of ids (the planner reads a set, so a repeat is harmless)
export const addedMerge = (ids) => sql`INSERT INTO app_state (key, value, updated_at) VALUES (${ADDED_KEY}, ${JSON.stringify({ ids })}::jsonb, now())
  ON CONFLICT (key) DO UPDATE SET value = jsonb_build_object('ids', COALESCE(app_state.value->'ids', '[]'::jsonb) || (EXCLUDED.value->'ids')), updated_at = now()`;
// Answers for people who are gone are dropped when a run saves: one statement each, against the tables as they are NOW, and only when the answers
// weren't touched in the last minute (a save that is just committing its own answer is never caught between the two)
async function pruneAnswers() {
  try {
    await sql`UPDATE app_state SET value = COALESCE((SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(app_state.value) AS e WHERE e.key IN (SELECT id FROM staff_bios)), '{}'::jsonb)
      WHERE key = ${ACCOUNTS_KEY} AND updated_at < now() - interval '1 minute'`;
    await sql`UPDATE app_state SET value = jsonb_build_object('ids', COALESCE((SELECT jsonb_agg(DISTINCT t.x) FROM jsonb_array_elements_text(COALESCE(app_state.value->'ids', '[]'::jsonb)) AS t(x) WHERE t.x IN (SELECT id FROM clients)), '[]'::jsonb))
      WHERE key = ${ADDED_KEY} AND updated_at < now() - interval '1 minute'`;
  } catch (err) { console.error("people link: prune answers", err); }
}
// Which account each of INFO's managers has, by the planner's own pairing (the stored link first, then sameManager when exactly one login matches):
// the managers list Site > Users shows (a manager with no account is a row of it) reads this, so it agrees with what the link does. managers: [{ row, name }],
// users: [{ id, name, role }], mlink: the seen state's { userId: personKey of the INFO name }. -> the managers with `account: { id, name } | null`
// (a name that matches several logins has the first of them: the planner flags it and makes nothing)
export function managerAccounts(managers, users, mlink) {
  const staff = [], taken = new Set(), got = new Map(), ml = mlink && typeof mlink === "object" ? mlink : {};
  for (const u of users || []) if (u && u.role === "staff") staff.push(u);
  for (const m of managers || []) {
    for (const u of staff) if (ml[u.id] === pk(m.name) && !taken.has(u.id) && !got.has(m)) { got.set(m, u); taken.add(u.id); }
  }
  for (const m of managers || []) {
    if (got.has(m)) continue;
    const hits = [];
    for (const u of staff) if (!taken.has(u.id) && sameManager(m.name, u.name)) hits.push(u);
    if (hits.length) { got.set(m, hits[0]); if (hits.length === 1) taken.add(hits[0].id); }
  }
  const out = [];
  for (const m of managers || []) out.push({ ...m, account: got.has(m) ? { id: got.get(m).id, name: got.get(m).name } : null });
  return out;
}
// The clients a person has just added (the dashboard says so: the save that added them, and the run it asks for right after): kept as real
// for every later run (the save that added them writes it in its own transaction, pages/api/dashboard-data.js; the browser's run right after asks
// again, pages/api/people-sync.js: one atomic append either way). Never throws.
export async function rememberAdded(ids) {
  const list = (Array.isArray(ids) ? ids : []).map((x) => String(x)).filter(Boolean).slice(0, 20);
  if (!list.length) return;
  try { await addedMerge(list); } catch (err) { console.error("people link: remember added", err); }
}

// The plan's database part in ONE transaction (rows first, then links and copies), then its sheet writes one at a time
// (each its own lock, read-back and alarm in lib/people-sync.js), then the seen state. -> { created, linked, updated,
// sheet, flags, error? }. A transaction that fails changes nothing and keeps nothing (the next run plans again).
// sheet: false leaves the sheet writes for the next run (a dashboard save doesn't wait on Google); they stay unseen.
export async function applyPeopleLink(plan, { sheets = null, spreadsheetId = accountingSheetId(), by = "people sync", writes = logWritesOn(), sheet = true } = {}) {
  const res = { created: { clients: [], users: [], staff: [] }, linked: plan.link.length, updated: plan.update.length, sheet: { infoClients: [], infoManagers: [] }, flags: [...plan.flags] };
  const q = [], kinds = [];
  for (const c of plan.create.clients) {
    q.push(sql`INSERT INTO clients (id, name, on_roster, roster_order, info_name) VALUES (${c.id}, ${c.name}, false, (SELECT COALESCE(max(roster_order), -1) + 1 FROM clients), ${c.info_name || ""}) ON CONFLICT (id) DO NOTHING RETURNING id, name`);
    kinds.push("clients");
  }
  for (const u of plan.create.users) {
    q.push(sql`INSERT INTO users (id, email, password_hash, role, name, client_id, staff_role, access) VALUES (${u.id}, ${u.email || null}, NULL, ${u.role}, ${u.name}, ${u.client_id || null}, ${u.staff_role || null}, ${JSON.stringify(u.access || {})}) ON CONFLICT DO NOTHING RETURNING id, name`);
    kinds.push("users");
  }
  for (const s of plan.create.staff) {
    q.push(sql`INSERT INTO staff_bios (id, name, role, email, user_id, visible) VALUES (${s.id}, ${s.name}, ${s.role || ""}, ${s.email || ""}, ${s.user_id || ""}, false) ON CONFLICT (id) DO NOTHING RETURNING id, name`);
    kinds.push("staff");
  }
  for (const l of plan.link) {
    if (l.kind === "client-info") q.push(sql`UPDATE clients SET info_name = ${l.infoName} WHERE id = ${l.clientId}`);
    else if (l.kind === "user-client") q.push(sql`UPDATE users SET client_id = ${l.clientId} WHERE id = ${l.userId} AND role = 'client' AND client_id IS NULL`);
    else if (l.kind === "team-user") q.push(sql`UPDATE staff_bios SET user_id = ${l.userId} WHERE id = ${l.staffId} AND user_id = ''`);
    else continue;
    kinds.push("link");
  }
  // a copy lands only where the old value is still there (a save since wins)
  for (const x of plan.update) {
    if (x.table === "staff_bios" && x.field === "name") q.push(sql`UPDATE staff_bios SET name = ${x.to} WHERE id = ${x.id} AND name = ${x.from}`);
    else if (x.table === "staff_bios" && x.field === "email") q.push(sql`UPDATE staff_bios SET email = ${x.to} WHERE id = ${x.id} AND lower(email) = ${x.from}`);
    else if (x.table === "users" && x.field === "name") q.push(sql`UPDATE users SET name = ${x.to} WHERE id = ${x.id} AND name = ${x.from}`);
    else if (x.table === "users" && x.field === "email") q.push(sql`UPDATE users SET email = ${x.to} WHERE id = ${x.id} AND lower(COALESCE(email, '')) = ${x.from} AND NOT EXISTS (SELECT 1 FROM users o WHERE lower(o.email) = ${x.to} AND o.id <> ${x.id})`);
    else continue;
    kinds.push("update");
  }
  const seen = { ...plan.seen, keys: new Set(plan.seen.keys), mlink: { ...plan.seen.mlink } };
  if (q.length) {
    try {
      const got = await sql.transaction(q);
      got.forEach((rows, i) => { if (res.created[kinds[i]] && Array.isArray(rows) && rows[0]) res.created[kinds[i]].push(rows[0].name); });
    } catch (err) {
      console.error("people link: couldn't save", err);
      res.error = "Couldn't save the people just now, so nothing was changed. It tries again at the next sync.";
      return res;
    }
  }
  // (2026-11-14 review) what was seen is kept as soon as the rows are in, before any sheet write (a run cut short
  // there never makes the same people again); kept again after the sheet writes with what they added
  const keepSeen = async () => {
    try { await saveSeen(seen); return true; }
    catch (err) { console.error("people link: seen state", err); res.error = "The people were saved, but what was seen couldn't be kept. It's checked again at the next sync."; return false; }
  };
  if (!(await keepSeen())) return res;
  // the sheet, one write at a time (each checks INFO again first)
  const sheetCreates = plan.create.infoClients.length + plan.create.infoManagers.length;
  const note = (key, text, fix = { kind: "sheet", label: "Open the sheet ↗" }) => res.flags.push({ key, kind: "sheet", text, fix });
  if (sheetCreates && !sheet) res.sheetLater = [...plan.create.infoClients, ...plan.create.infoManagers].map((x) => x.name);
  else if (sheetCreates && !writes) note("sheet:off", `Writing to the accounting sheet is off (ACCOUNTING_SHEET_WRITES), so ${[...plan.create.infoClients, ...plan.create.infoManagers].map((x) => x.name).join(", ")} ${sheetCreates === 1 ? "isn't" : "aren't"} on INFO yet.`);
  else if (sheetCreates) {
    for (const ic of plan.create.infoClients) {
      try {
        const r = await saveClientToInfo({ clientId: ic.clientId, mode: "add", rate: DEFAULT_COMMISSION, manager: "", cut: null, noGrow: true }, { by, sheets, spreadsheetId });
        if (r.ok) {
          await sql`UPDATE clients SET info_name = ${ic.name} WHERE id = ${ic.clientId}`.catch((err) => console.error("people link: info_name", err));
          (plan.pending.infoClients[ic.clientId] || []).forEach((k) => seen.keys.add(k));
          res.sheet.infoClients.push(ic.name);
          if (r.alarm) note(`alarm:${ic.clientId}`, r.alarm);
        } else note(`sheet:${ic.clientId}`, `${ic.name} isn't on INFO yet: ${r.refused || r.alarm}`);
      } catch (err) { console.error("people link: INFO client", err); note(`sheet:${ic.clientId}`, `${ic.name} isn't on INFO yet: ${err?.sentence ? err.message : "the sheet said no just now"}.`); }
    }
    for (const im of plan.create.infoManagers) {
      try {
        const r = await addManagerToInfo(im.name, { by, sheets, spreadsheetId });
        if (r.ok) {
          seen.mlink[im.userId] = pk(r.name);
          (plan.pending.infoManagers[im.userId] || []).forEach((k) => seen.keys.add(k));
          res.sheet.infoManagers.push(im.name);
        } else note(`sheet:m:${im.userId}`, `${im.name} isn't on INFO's manager list yet: ${r.refused || r.alarm}`);
      } catch (err) { console.error("people link: INFO manager", err); note(`sheet:m:${im.userId}`, `${im.name} isn't on INFO's manager list yet: the sheet said no just now.`); }
    }
  }
  if (res.sheet.infoClients.length || res.sheet.infoManagers.length) await keepSeen();
  await pruneAnswers();
  return res;
}
// The seen state written over what's stored, keeping any answer given meanwhile ("Two different people", "Leave it",
// "Same person" for a manager): they're unions, never lost to a run that read the state before them
async function saveSeen(seen) {
  const now = (await getState(SEEN_KEY)) || {};
  await setState(SEEN_KEY, {
    ...seen, keys: [...seen.keys].sort(), at: new Date().toISOString(),
    distinct: [...new Set([...(now.distinct || []), ...(seen.distinct || [])])],
    dismissed: [...new Set([...(now.dismissed || []), ...(seen.dismissed || [])])],
    mlink: { ...(now.mlink || {}), ...(seen.mlink || {}) },
  });
}

// One thing at a time on the people (a run, an answer): app_state 'peopleSync:link'. waits: how many times to wait
// waitMs for the other first. -> what fn gave, or { busy, refused }.
const BUSY = "The people are being linked right now. Try again in a minute.";
export async function withLinkLock(by, fn, { waits = 0, waitMs = 1500 } = {}) {
  for (let i = 0; !(await claimState(LINK_LOCK, LEASE_MIN, { at: new Date().toISOString(), by: by || "" })); i++) {
    if (i >= waits) return { busy: true, refused: BUSY };
    await new Promise((r) => setTimeout(r, waitMs));
  }
  try { return await fn(); } finally {
    await sql`UPDATE app_state SET updated_at = now() - interval '1 day' WHERE key = ${LINK_LOCK}`.catch((err) => console.error("people link: lock not released", err));
  }
}

// What Site › Sync shows of the last run (app_state 'peopleSync:last'), kept short
function summary(res, at, infoError) {
  return { at, created: res.created, linked: res.linked, updated: res.updated, sheet: res.sheet, sheetLater: res.sheetLater || [], flags: res.flags, infoError: infoError || null, error: res.error || null };
}

// One run: the lock, everything read again inside it, the plan, the writes. -> the summary, or { off } / { busy } /
// { waiting }. dryRun: plan only (nothing written, no lock): { plan, preview, first }. auto: a run nobody asked for
// (the Sync check, the cron, a dashboard save): until a person has confirmed the first run (the seen state's started),
// it only logs that it's waiting.
export const WAITING = "people link: waiting for the first Sync people now (Site › Sync)";
export async function runPeopleLink({ actor = null, by = "people sync", sheets = null, spreadsheetId = accountingSheetId(), dryRun = false, sheet = true, timeoutMs = 20000, auto = false, waits = 0 } = {}) {
  if (!autolinkOn() && !dryRun) return { off: true };
  if (dryRun) {
    const input = await readPeopleInput({ sheets, spreadsheetId, timeoutMs });
    const plan = planPeopleLink({ ...input, actor });
    return { plan, preview: previewOf(plan), first: !input.seen?.started, infoError: input.infoError };
  }
  if (auto && !(await getState(SEEN_KEY))?.started) { console.log(WAITING); return { waiting: true }; }
  const got = await withLinkLock(by, async () => {
    const input = await readPeopleInput({ sheets, spreadsheetId, timeoutMs });
    if (auto && !input.seen?.started) { console.log(WAITING); return { waiting: true }; }
    const plan = planPeopleLink({ ...input, actor });
    const res = await applyPeopleLink(plan, { sheets: input.sheets, spreadsheetId, by, sheet });
    if (input.infoError) res.flags.unshift({ key: "info:read", kind: "info", text: `INFO wasn't compared this time: ${input.infoError}` });
    const out = summary(res, new Date().toISOString(), input.infoError);
    await setState(LAST_KEY, out).catch((err) => console.error("people link: last run", err));
    return out;
  }, { waits });
  return got.busy ? { busy: true } : got;
}

// What a run would do, names only (no email, no id): Site › Sync's "This will add: …" before "Add them"
export function previewOf(plan) {
  const names = (xs) => xs.map((x) => x.name).filter(Boolean);
  const kind = (u) => (u.role === "client" ? "client login" : ROLES[u.staff_role]?.label || "staff");
  const add = { clients: names(plan.create.clients), users: plan.create.users.map((u) => ({ name: u.name, kind: kind(u) })), team: names(plan.create.staff), infoClients: names(plan.create.infoClients), infoManagers: names(plan.create.infoManagers) };
  return {
    ...add, count: add.clients.length + add.users.length + add.team.length + add.infoClients.length + add.infoManagers.length,
    links: plan.link.length, updates: plan.update.map((x) => ({ name: x.name, what: `${x.table === "users" ? "login" : "team page"} ${x.field}` })),
    flags: plan.flags.map((f) => ({ kind: f.kind, text: f.text })),
  };
}

// After a dashboard save (pages/api/dashboard-data.js): never throws, never holds the save up for an error
export async function linkAfterSave(actor, { sheet = false } = {}) {
  try {
    const r = await runPeopleLink({ actor, by: "a dashboard save", sheet, timeoutMs: 4000, auto: true });
    if (r?.error) console.error("people link after a save:", r.error);
    return r;
  } catch (err) { console.error("people link after a save:", err); return null; }
}

// Site › Sync's answers to a flag: "Two different people" (a near miss never asked again, and the planner may make
// them), and "Leave it" (a removed flag not shown again). Both kept in the seen state.
// (2026-11-14 review) under the run's lock, so an answer and a run never write over each other
export async function rememberAnswer({ distinct = null, dismiss = null }, { waits = 4, waitMs = 1500 } = {}) {
  return withLinkLock("an answer", () => answer({ distinct, dismiss }), { waits, waitMs });
}
async function answer({ distinct, dismiss }) {
  const was = (await getState(SEEN_KEY)) || {};
  const next = { ...was, distinct: [...new Set([...(was.distinct || []), ...(distinct ? [pairKey(distinct[0], distinct[1])] : [])])], dismissed: [...new Set([...(was.dismissed || []), ...(dismiss ? [String(dismiss)] : [])])] };
  await setState(SEEN_KEY, next);
  // the last run's flags without the one answered, so Site › Sync shows it gone at once
  const last = await getState(LAST_KEY);
  if (last?.flags) await setState(LAST_KEY, { ...last, flags: last.flags.filter((f) => f.key !== dismiss && !(distinct && f.kind === "near" && f.pair && pairKey(f.pair[0], f.pair[1]) === pairKey(distinct[0], distinct[1]))) });
  return { ok: true };
}
export const lastPeopleLink = () => getState(LAST_KEY);

// Site › Sync's "Same person" for a near miss: the two linked, so every run pairs them from now on (the names stay as
// they are). link: a near flag's { kind, ... }. -> { ok } or { refused }.
export async function linkPair(link = {}, { waits = 4, waitMs = 1500 } = {}) {
  return withLinkLock("a link", () => pair(link), { waits, waitMs });
}
async function pair(link) {
  const k = link.kind, id = (v) => String(v ?? "").slice(0, 120);
  if (k === "team-user") {
    const [t] = await sql`SELECT id, user_id FROM staff_bios WHERE id = ${id(link.staffId)}`, [u] = await sql`SELECT id FROM users WHERE id = ${id(link.userId)} AND role = 'staff'`;
    if (!t || !u) return { refused: "One of the two isn't here any more. Reload the page." };
    if (t.user_id && t.user_id !== u.id) return { refused: "That team entry is linked to another login already." };
    await sql`UPDATE staff_bios SET user_id = ${u.id} WHERE id = ${t.id}`;
  } else if (k === "user-client") {
    const [u] = await sql`SELECT id, client_id FROM users WHERE id = ${id(link.userId)} AND role = 'client'`, [c] = await sql`SELECT id FROM clients WHERE id = ${id(link.clientId)}`;
    if (!u || !c) return { refused: "One of the two isn't here any more. Reload the page." };
    if (u.client_id && u.client_id !== c.id) return { refused: "That login is linked to another client already." };
    await sql`UPDATE users SET client_id = ${c.id} WHERE id = ${u.id}`;
  } else if (k === "client-info") {
    const [c] = await sql`SELECT id FROM clients WHERE id = ${id(link.clientId)}`, name = str(link.infoName).slice(0, 120);
    if (!c || !name) return { refused: "That client isn't here any more. Reload the page." };
    await sql`UPDATE clients SET info_name = ${name} WHERE id = ${c.id}`;
  } else if (k === "user-manager") {
    const [u] = await sql`SELECT id FROM users WHERE id = ${id(link.userId)} AND role = 'staff'`, name = str(link.infoName);
    if (!u || !pk(name)) return { refused: "That login isn't here any more. Reload the page." };
    const was = (await getState(SEEN_KEY)) || {};
    await setState(SEEN_KEY, { ...was, mlink: { ...(was.mlink || {}), [u.id]: pk(name) } });
  } else return { refused: "Unknown link." };
  const last = await getState(LAST_KEY);
  if (last?.flags) await setState(LAST_KEY, { ...last, flags: last.flags.filter((f) => !(f.kind === "near" && f.link && JSON.stringify(f.link) === JSON.stringify(link))) });
  return { ok: true };
}

// (2026-11-14 review) Site › Sync's "Use it for the login": a team entry's name or email put on its login, by an account
// with Users (a Founder for a Founder's login), under the lock. Never done by a run by itself for an email. -> { ok,
// text } or { refused }.
export async function applyTeamValue({ staffId, field } = {}, actor = {}, { waits = 4, waitMs = 1500 } = {}) {
  if (!["name", "email"].includes(field)) return { refused: "Unknown field." };
  return withLinkLock("use it for the login", async () => {
    const [t] = await sql`SELECT id, name, email, user_id FROM staff_bios WHERE id = ${String(staffId ?? "").slice(0, 120)}`;
    if (!t?.user_id) return { refused: "That team entry isn't linked to a login. Reload the page." };
    const [u] = await sql`SELECT id, role, staff_role, name, email FROM users WHERE id = ${t.user_id}`;
    if (!u) return { refused: "That login isn't here any more. Reload the page." };
    const anyFounder = (await sql`SELECT 1 FROM users WHERE staff_role = 'founder' LIMIT 1`).length > 0;
    const founderLogin = u.role === "staff" && roleOf(u.staff_role, anyFounder) === "founder";
    if (!actor?.users) return { refused: "Changing a login needs Users access." };
    if (founderLogin && !actor.founder) return { refused: "Only a Founder can change a Founder's login." };
    const v = field === "email" ? str(t.email).toLowerCase() : str(t.name);
    if (field === "email" && !validEmail(v)) return { refused: "The team page's email isn't an email address, so the login wasn't changed." };
    if (field === "name" && !pk(v)) return { refused: "The team page's name is blank, so the login wasn't changed." };
    try {
      if (field === "email") await sql`UPDATE users SET email = ${v} WHERE id = ${u.id}`;
      else await sql`UPDATE users SET name = ${v} WHERE id = ${u.id}`;
    } catch (err) {
      if (err?.code === "23505") return { refused: "Another login has that email, so this one wasn't changed." };
      throw err;
    }
    const last = await getState(LAST_KEY);
    if (last?.flags) await setState(LAST_KEY, { ...last, flags: last.flags.filter((f) => !(f.apply && f.apply.staffId === t.id && f.apply.field === field)) });
    return { ok: true, text: `${u.name || t.name}'s login ${field} is the team page's now.` };
  }, { waits, waitMs });
}
