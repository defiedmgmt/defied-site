// Roles and permissions (list B #1), the server part: the one check every API route makes
// (requireAccess), and each client's manager from the accounting sheet's INFO tab. Server-only.
// The presets and the rules themselves are lib/roles.js. The sign-in and the session don't change:
// users.role is still "staff" or "client", and this only reads two more columns of the same row.
import { sql } from "./db";
import { requireUser } from "./session";
import { accessFor, sameManager, sectionLabel } from "./roles";

const NOT_SET_UP = "42703"; // undefined column: the roles migration hasn't run

// What this staff account may use, as lib/roles.js's accessFor gives it, plus clientIds (the ids of
// its own artists) when it's limited to them. Before the roles migration every staff account is a
// Founder, which is how the site has always worked.
export async function loadAccess(user) {
  let row;
  try {
    [row] = await sql`SELECT staff_role, access, name, EXISTS (SELECT 1 FROM users WHERE staff_role = 'founder') AS any_founder FROM users WHERE id = ${user.id}`;
  } catch (err) {
    if (err?.code !== NOT_SET_UP) throw err;
    return accessFor({}, { anyFounder: false });
  }
  const a = accessFor({ staffRole: row?.staff_role, access: row?.access, name: row?.name }, { anyFounder: !!row?.any_founder });
  if (a.ownOnly) a.clientIds = await ownClientIds(a.manager);
  return a;
}

// The clients whose manager (INFO's Assigned Manager) is this name; none for a blank name
export async function ownClientIds(name) {
  if (!String(name || "").trim()) return [];
  const rows = await sql`SELECT id, manager FROM clients WHERE manager <> ''`;
  return rows.filter((r) => sameManager(r.manager, name)).map((r) => r.id);
}

// The one check at the top of every dashboard API route (the public ones, sign-in and the cron have
// their own). `need`: a section, or a list of them (any one will do). Returns the session, with what
// the account may use in req.access ({ role, sections, ownOnly, clientIds }), or null after a 401
// (not signed in, or a client on a staff route), a 403 (a staff account without that section) or a
// 503 (the database didn't answer).
//   clients: a client session may call this route too (it keeps them to their own client itself)
//   whole:   the route works on every artist at once, so an account limited to its own is refused
export async function requireAccess(req, res, need, { clients = false, whole = false } = {}) {
  const session = await requireUser(req, res);
  if (!session) return null;
  if (session.user.role !== "staff") {
    if (clients) { req.access = { role: "client", sections: [], ownOnly: false }; return session; }
    res.status(401).json({ error: "Staff sign-in required." });
    return null;
  }
  try {
    // kept on the request, never on the session (that would seal it into the cookie)
    req.access = await loadAccess(session.user);
  } catch (err) {
    console.error("access check failed:", err);
    res.status(503).json({ error: "Couldn't check your sign-in — try again in a minute." });
    return null;
  }
  const list = need == null ? [] : [].concat(need);
  if (list.length && !list.some((k) => req.access.sections.includes(k))) {
    res.status(403).json({ error: `Your account can't use ${sectionLabel(list[0])}. A Founder can turn it on in Site › Users.` });
    return null;
  }
  if (whole && req.access.ownOnly) {
    res.status(403).json({ error: "This works on every artist at once, and your account sees only your own artists." });
    return null;
  }
  return session;
}

// For the routes that serve client data: may this request see that client? (Always, unless limited.)
export const limited = (req) => !!req.access?.ownOnly;
export const ownSet = (req) => new Set(req.access?.clientIds || []);
export const mayUseClient = (req, clientId) => !limited(req) || ownSet(req).has(clientId);

// --- each client's manager, from the accounting sheet's INFO tab ------------------------------------
// (2026-11-13) parseInfoManagers, managersByClient and refreshManagers live in lib/info-managers.js now (so the Sync
// check and lib/people-sync.js can use them without this file's session code); every caller here still works.
export { parseInfoManagers, managersByClient, refreshManagers } from "./info-managers";
