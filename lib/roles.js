// Roles and permissions (list B #1), the pure part: the dashboard's sections, the three staff presets,
// and what one account may use. Shared by the server's one check (lib/access.js, every API route) and
// the dashboard (components/App.jsx hides what an account can't use). No imports but names.js.
import { personKey, nearMiss, twoPeople } from "./names";

// [key, label]: one per sidebar tab, plus Users (Site › Users, i.e. user management). (r11: "home" is the
// Dashboard again; the order stays, it is the order the server lists an account's sections in)
export const SECTIONS = [
  ["home", "Dashboard"], ["todo", "To do"], ["publishing", "Clients"], ["money", "Money"],
  ["ar", "A&R"], ["site", "Site"], ["users", "Users"],
];
const ALL = SECTIONS.map(([k]) => k);
export const sectionLabel = (k) => SECTIONS.find(([id]) => id === k)?.[1] || k;

export const ROLES = {
  founder: { label: "Founder", sections: ALL },
  // (2026-11-10) the owner: "on default i want co managers to see their clients and A&R"; money is the Founders'
  comanager: { label: "Co-manager", sections: ["publishing", "ar"] },
  // (2026-11-16) the owner: interns start with A&R too (an Intern already saved with no overrides gets it as well: presets apply when read)
  intern: { label: "Intern", sections: ["ar", "site"] },
};
export const ROLE_KEYS = Object.keys(ROLES);

// Sections that work on every artist at once: off for an account limited to its own artists, whatever
// its overrides say. (None since Luminate went, list B #3; the routes that do still say so themselves.)
export const WHOLE_ROSTER = [];

// The dashboard's tab ids and To do's areas, as sections
export const TAB_SECTION = { home: "home", todo: "todo", catalog: "publishing", money: "money", ar: "ar", site: "site" };
export const AREA_SECTION = { money: "money", roster: "publishing", ar: "ar", clickup: "todo", site: "site" };

// A staff account's preset: the one stored, else (not set yet) a Co-manager once any Founder exists,
// else a Founder, so a database nobody has been made a Founder in yet works exactly as before.
export const roleOf = (staffRole, anyFounder) => (ROLES[staffRole] ? staffRole : anyFounder ? "comanager" : "founder");

// What one staff account may use: { role, sections, ownOnly, manager }.
//   staffRole  users.staff_role
//   access     users.access: { sections: { money: true, ar: false, ... }, ownOnly }
//   name       users.name: a limited Co-manager's artists are the clients whose manager is this name
// A Founder always keeps Users, so there's always someone who can manage the logins.
export function accessFor({ staffRole, access, name } = {}, { anyFounder = false } = {}) {
  const role = roleOf(staffRole, anyFounder);
  const over = access && typeof access === "object" && access.sections && typeof access.sections === "object" ? access.sections : {};
  const on = new Set(ROLES[role].sections);
  for (const k of ALL) {
    if (over[k] === true) on.add(k);
    else if (over[k] === false) on.delete(k);
  }
  if (role === "founder") on.add("users");
  // "only their own artists" is a Co-manager's option, on unless it's been turned off (2026-11-10)
  const ownOnly = role === "comanager" && !(access && access.ownOnly === false);
  if (ownOnly) for (const k of WHOLE_ROSTER) on.delete(k);
  return { role, sections: ALL.filter((k) => on.has(k)), ownOnly, manager: ownOnly ? String(name || "").trim() : "" };
}

// (2026-11-15) Site › Team's "Account" for a NEW entry, from the Role text typed on it: an intern or an assistant ("A&R Intern", "Manager's Assistant") is an
// Intern first; otherwise a manager (a Founder, A&R, management) is a Manager (a Co-manager account, on INFO's manager list); anyone else an Intern
// (A&R and Site, not on INFO). The form's select starts here; the person can change it.
export const teamAccountOf = (roleText) => {
  const r = String(roleText ?? "");
  return /intern|assistant/i.test(r) ? "intern" : /manager|founder|a&r|management/i.test(r) ? "comanager" : "intern";
};

// Only the overrides that differ from the preset, so changing someone's role later moves them onto
// the new preset instead of carrying old choices that just repeat the old one
export function cleanAccess(role, access) {
  const base = new Set((ROLES[role] || ROLES.comanager).sections);
  const sections = {};
  const over = access?.sections || {};
  for (const k of ALL) if (typeof over[k] === "boolean" && over[k] !== base.has(k)) sections[k] = over[k];
  if (role === "founder") delete sections.users;
  const out = {};
  if (Object.keys(sections).length) out.sections = sections;
  if (role === "comanager" && access?.ownOnly === false) out.ownOnly = false; // on is the default
  return out;
}

// Is `manager` (a client's, from the accounting sheet's INFO tab) this account's name? The sheet
// uses first names ("Magnus"), so an account named "Magnus Hale" matches on its first word too.
const firstKey = (s) => personKey(String(s ?? "").trim().split(/\s+/)[0]);
export const sameManager = (manager, name) => {
  const m = personKey(manager);
  return !!m && !!personKey(name) && (m === personKey(name) || m === firstKey(name));
};

// (2026-11-15) The entry on INFO's manager list that `name` is near but not exactly: the same person by the rule above either way round ("Hank Rivers" and "Hank"),
// or a near miss (lib/names.js nearMiss: "Jaime" next to "Jamie", "Mag" next to "Magnus"), except a pair the owner has said are two people (TWO_PEOPLE: Caden and
// Cayden). null when there is none. The form (components/dash/manager-artists.js nearManager) shows it as a warning and never adds the name to the list; the
// server's "manager" action (lib/people-sync.js planManager) refuses it the same way. managers: GET /api/people-sync's info.managers, [{ row, name }]
export function nearManagerEntry(managers, name) {
  const n = String(name ?? "").trim();
  if (!n) return null;
  for (const m of managers || []) {
    if (m.name === n) continue;
    if (sameManager(m.name, n) || sameManager(n, m.name)) return m;
    if (nearMiss(m.name, n) && !twoPeople(m.name, n)) return m;
  }
  return null;
}

// (2026-11-13, the owner: "u can hide net streams for founders too lets keep it simple thats just for spreadsheet
// calculation") No page shows net streams to anyone, a Founder included: not a client's page or its song window, not the
// Overview. They are the pub sheet's working number, and the Advance calculator's input (components/dash/advance.jsx), the one
// place that still uses them. So the net streams /api/ar-data sends for it, and /api/sheets-master sends in its rows and
// totals, go only to an account with Money access (a Founder unless a Founder has changed it), the same rule the money
// follows, since the Pub earnings are worked out from the net streams. access: requireAccess's req.access ({ sections });
// none known: no net
export const seesNetStreams = (access) => Array.isArray(access?.sections) && access.sections.includes("money");
