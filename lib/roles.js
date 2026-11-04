// Roles and permissions (list B #1), the pure part: the dashboard's sections, the three staff presets,
// and what one account may use. Shared by the server's one check (lib/access.js, every API route) and
// the dashboard (components/App.jsx hides what an account can't use). No imports but names.js.
import { personKey } from "./names";

// [key, label]: one per sidebar tab, plus Users (Site › Users, i.e. user management)
export const SECTIONS = [
  ["home", "Home"], ["todo", "To do"], ["publishing", "Publishing"], ["money", "Money"],
  ["ar", "A&R"], ["site", "Site"], ["users", "Users"],
];
const ALL = SECTIONS.map(([k]) => k);
export const sectionLabel = (k) => SECTIONS.find(([id]) => id === k)?.[1] || k;

export const ROLES = {
  founder: { label: "Founder", sections: ALL },
  comanager: { label: "Co-manager", sections: ALL.filter((k) => k !== "money" && k !== "users") },
  intern: { label: "Intern", sections: ["site"] },
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
  // "only their own artists" is a Co-manager's option
  const ownOnly = role === "comanager" && !!(access && access.ownOnly);
  if (ownOnly) for (const k of WHOLE_ROSTER) on.delete(k);
  return { role, sections: ALL.filter((k) => on.has(k)), ownOnly, manager: ownOnly ? String(name || "").trim() : "" };
}

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
  if (role === "comanager" && access?.ownOnly) out.ownOnly = true;
  return out;
}

// Is `manager` (a client's, from the accounting sheet's INFO tab) this account's name? The sheet
// uses first names ("Magnus"), so an account named "Magnus Hale" matches on its first word too.
const firstKey = (s) => personKey(String(s ?? "").trim().split(/\s+/)[0]);
export const sameManager = (manager, name) => {
  const m = personKey(manager);
  return !!m && !!personKey(name) && (m === personKey(name) || m === firstKey(name));
};
