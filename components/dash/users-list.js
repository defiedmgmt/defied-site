// (2026-11-15) Site › Users' list: the order people are shown in and what the viewer remembers about it (components/dash/admin.jsx,
// UsersAdmin and Editor), the parts with no screen in them. The owner said: "hidden by default in users can we have a sort feature to
// make it easier". This is display only: db.users keeps the order it was loaded in (that is the order a save writes back); nothing
// here is ever committed.
// (Plain loops, and comparators that read only their own two arguments: see components/dash/manager-artists.js on Next's minifier.)

// localStorage, one key each, per viewer (a convenience only: every read and write is in a try, and the page works without them)
export const FOLD_KEY = "dm-users-nologin"; // "open" | "closed"
export const SORT_KEY = "dm-users-sort"; // { by, dir }

// the sorts, and which way a first click on each runs: dir 1 is the key's own ascending (A to Z, Founder first), -1 its descending
// (Last sign-in starts newest first, which is descending by date)
const KEYS = ["name", "access", "signin"];
const firstDir = (by) => (by === "signin" ? -1 : 1);

// what a click on a column head does: another column starts at its first direction, the same column reverses
export function nextSort(cur, by) {
  if (cur && cur.by === by) return { by, dir: cur.dir === 1 ? -1 : 1 };
  return { by, dir: firstDir(by) };
}

// the phone's picker: one option per (key, direction), and the default order; values "name:1", "signin:-1", "" for the default
export const SORT_OPTIONS = [
  ["", "Default order"],
  ["name:1", "Name (A to Z)"], ["name:-1", "Name (Z to A)"],
  ["access:1", "Access (Founder first)"], ["access:-1", "Access (Client first)"],
  ["signin:-1", "Last sign-in (newest first)"], ["signin:1", "Last sign-in (oldest first)"],
];
export const sortValue = (s) => (s && s.by ? `${s.by}:${s.dir}` : "");
export function sortFromValue(v) {
  const m = /^(name|access|signin):(1|-1)$/.exec(v || "");
  return m ? { by: m[1], dir: Number(m[2]) } : { by: null, dir: 1 };
}

// ---- remembered choices ----------------------------------------------------------------------------------------------
export function loadSort() {
  try {
    const v = JSON.parse(window.localStorage.getItem(SORT_KEY) || "null");
    if (v && KEYS.indexOf(v.by) >= 0 && (v.dir === 1 || v.dir === -1)) return { by: v.by, dir: v.dir };
  } catch { /* storage blocked, or not JSON: the default order */ }
  return { by: null, dir: 1 };
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
