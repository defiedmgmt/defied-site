// (2026-11-15) Site › Users' list: the order people are shown in and what the viewer remembers about it (components/dash/admin.jsx,
// UsersAdmin and Editor), the parts with no screen in them. The owner said: "hidden by default in users can we have a sort feature to
// make it easier". This is display only: db.users keeps the order it was loaded in (that is the order a save writes back); nothing
// here is ever committed.
// (2026-11-15, one place) the list is by Role by default (Founder, Co-manager, Intern, Client, then by name), a "Sort by" control above it
// and the heads both change it, and the managers on the accounting sheet with no account yet are rows of it (sheetOnlyManagers).
// (Plain loops, and comparators that read only their own two arguments: see components/dash/manager-artists.js on Next's minifier.)
import { sameManager } from "../../lib/roles";

// localStorage, one key each, per viewer (a convenience only: every read and write is in a try, and the page works without them)
export const FOLD_KEY = "dm-users-nologin"; // "open" | "closed"
export const SORT_KEY = "dm-users-sort"; // { by, dir }

// the sorts, and which way a first click on each runs: dir 1 is the key's own ascending (A to Z, Founder first), -1 its descending
// (Last sign-in starts newest first, which is descending by date)
const KEYS = ["access", "name", "signin"];
const firstDir = (by) => (by === "signin" ? -1 : 1);

// what a click on a column head or a "Sort by" choice does: another one starts at its first direction, the same one reverses
export function nextSort(cur, by) {
  if (cur && cur.by === by) return { by, dir: cur.dir === 1 ? -1 : 1 };
  return { by, dir: firstDir(by) };
}

// the "Sort by" control: its choices in order, and the one in force when nothing was ever picked (Role: Founder first)
export const SORT_CHOICES = [["access", "Role"], ["name", "Name"], ["signin", "Last sign-in"]];
export const DEFAULT_SORT = { by: "access", dir: 1 };
// what a choice's arrow means in words (the tooltip and the screen reader's): "Role, Founder first"
const WORDS = { access: ["Founder first", "Client first"], name: ["A to Z", "Z to A"], signin: ["oldest first", "newest first"] };
export function sortWords(by, dir) {
  const w = WORDS[by];
  return w ? w[dir === -1 ? 1 : 0] : "";
}

// ---- remembered choices ----------------------------------------------------------------------------------------------
export function loadSort() {
  try {
    const v = JSON.parse(window.localStorage.getItem(SORT_KEY) || "null");
    if (v && KEYS.indexOf(v.by) >= 0 && (v.dir === 1 || v.dir === -1)) return { by: v.by, dir: v.dir };
  } catch { /* storage blocked, or not JSON: the default order */ }
  return { by: DEFAULT_SORT.by, dir: DEFAULT_SORT.dir };
}
export function saveSort(s) {
  try { window.localStorage.setItem(SORT_KEY, JSON.stringify({ by: s.by, dir: s.dir })); } catch { /* storage blocked: it just isn't remembered */ }
}
export function loadOpen() {
  try { return window.localStorage.getItem(FOLD_KEY) === "open"; } catch { return false; } // folded unless they opened it
}
export function saveOpen(open) {
  try { window.localStorage.setItem(FOLD_KEY, open ? "open" : "closed"); } catch { /* storage blocked: it just isn't remembered */ }
}

// ---- the order -------------------------------------------------------------------------------------------------------
const COLLATE = new Intl.Collator("en", { sensitivity: "base" }); // case-insensitive ("kai" and "Kai" tie)
const RANK = { founder: 0, comanager: 1, intern: 2, client: 3 };

// the name they go by, else the email (a person with neither has "", and goes last)
export function nameOf(u) {
  const n = String(u.name || "").trim();
  return n || String(u.email || "").trim();
}
// when they last signed in, as a number: never (or not a date) is below every date
function whenOf(u) {
  const t = u.lastLoginAt ? Date.parse(u.lastLoginAt) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
}
// then by name, A to Z whichever way the column runs, a blank name last, then as they came
function thenName(a, b) {
  if (a.name === "" && b.name !== "") return 1;
  if (b.name === "" && a.name !== "") return -1;
  return COLLATE.compare(a.name, b.name) || a.i - b.i;
}
function byName(a, b) {
  if (a.name === "" || b.name === "") return thenName(a, b);
  return a.s * COLLATE.compare(a.name, b.name) || thenName(a, b);
}
function byNumber(a, b) {
  if (a.n < b.n) return -a.s;
  if (a.n > b.n) return a.s;
  return thenName(a, b);
}

// users in the order the list shows them: the ones who can sign in, then the ones with no login yet (each group sorted
// on its own). by: "name" | "access" | "signin" | null (the order given). pickOf(u): "founder" | "comanager" | "intern" | "client"
export function orderUsers(users, by, dir, pickOf) {
  const s = dir === -1 ? -1 : 1, groups = [[], []];
  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const rec = { u, i, s, name: nameOf(u), n: 0 };
    if (by === "access") { const r = RANK[pickOf(u)]; rec.n = r === undefined ? 4 : r; }
    else if (by === "signin") rec.n = whenOf(u);
    groups[u.noLogin ? 1 : 0].push(rec);
  }
  const out = [];
  for (let g = 0; g < 2; g++) {
    const rows = groups[g];
    if (by === "name") rows.sort(byName);
    else if (by === "access" || by === "signin") rows.sort(byNumber);
    for (let k = 0; k < rows.length; k++) out.push(rows[k].u);
  }
  return out;
}

// INFO's managers with no account here, as rows for the list: one for each name on INFO's manager list that has no staff account. It has one when the
// server says so (GET /api/people-sync gives each manager `account`: { id, name } by the people link's own pairing, the stored link first, so a renamed
// login or one answered "Same person" counts) and that login is still here, or when a staff login is the same person by the site's own-artists rule
// (lib/roles.js sameManager: "Magnus Hale" is "Magnus", "Cayden" is not "Caden"; this is also what keeps a row from showing after its account was just
// made, before INFO is read again). Each row is a Co-manager with no login yet whose Edit opens the new-user form filled in, so one Save makes the
// account (components/dash/admin.jsx). managers: GET /api/people-sync's info.managers, [{ row, name, account? }]; users: db.users
export function sheetOnlyManagers(managers, users) {
  const out = [];
  for (const m of managers || []) {
    const name = String(m.name || "").trim();
    if (!name) continue;
    let has = false;
    if (m.account && m.account.id) for (const u of users || []) if (u.id === m.account.id) { has = true; break; }
    if (!has) for (const u of users || []) if (u.role === "staff" && sameManager(name, u.name)) { has = true; break; }
    if (!has) out.push({ id: `sheet:${name}`, sheetOnly: true, noLogin: true, email: "", name, role: "staff", staffRole: "comanager", access: {}, clientId: null, lastLoginAt: null, passwordChangedAt: null });
  }
  return out;
}
