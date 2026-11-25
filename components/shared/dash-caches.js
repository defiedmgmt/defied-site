// The dashboard's in-memory caches (kept while the app is open), here on their own so the app shell can
// clear them at sign-in and sign-out without loading the dashboard itself (list B #11).
import { forgetBoot } from "./boot";
import { clearJsonCache, jsonCacheEntries, seedJsonCache } from "../ui/fetch-cache";
// /api/ar's last answer: Summary, Watchlist and Board share it while it's under 30s old; a save
// always reads it again (loadPg() with no argument)
export const arPgCache = { d: null, at: 0 };

// The Dashboard's last answers, kept while the app is open: coming back to it draws them at once and a
// fresh copy loads quietly ("updated 7:34 PM" says how fresh the money is). Only good answers are kept.
export const dashCache = {};
// sign-in and sign-out start clean (the same tab can sign in as someone else)
// (2026-11-24, speed) and so do the reads on their way (components/shared/boot.js), the GET cache (components/ui/fetch-cache.js) and this
// tab's saved copy below (the scope is set again when the next account's dataset lands)
export function clearDashCaches() {
  dashCache.home = null; dashCache.top = null; dashCache.ar = null; dashCache.acct = null; cuCache.d = null; syncCache.d = null; syncCache.at = 0; arPgCache.d = null; arPgCache.at = 0;
  forgetBoot(); clearJsonCache(); clearStoredDash();
}

// ClickUp's open tasks on the dashboard's eight lists (GET /api/tasks), kept while the app is open and
// read again whenever Home or To do opens. Done ✓ takes a task off at once; a failed write puts it back.
export const cuCache = { d: null };
// The Sync view's checks (GET /api/sync): Home's pill, To do's sync rows and Site › Sync. They read
// the sheets and Stripe, so a fresh answer is kept for two minutes.
export const syncCache = { d: null, at: 0 };

// (2026-11-24, speed) A reload draws the last answers at once. The display-only ones (the Dashboard's money and accounting card, This week,
// the A&R counts, Money's badge, ClickUp's tasks, the Sync checks, and a few first screens' GETs) are copied into this tab's sessionStorage as
// the page is left (pagehide, or the tab hidden) and put back when the same account's dataset lands again; every one is then read again
// behind it, as on any tab switch. Never the dataset itself, the song facts, the split fixes or the true-up (what the dashboard acts on by
// itself). One user's copy is never another's: it's saved under the account AND what it may use (scope: the user id with the role, sections
// and own artists from that fresh dataset), anything under another scope is thrown away unread, and sign-in and sign-out remove it.
// Older than 30 minutes, or over the size limits: not kept. Storage blocked (a private window): nothing is kept, nothing breaks.
export const DASH_STORE_KEY = "defied:dash:v1";
const STORE_MAX_AGE = 30 * 60 * 1000, MAX_ENTRY = 400000, MAX_TOTAL = 1500000;
export const STORED_GETS = ["/api/data?home=1", "/api/accounting", "/api/ar-lists?view=home", "/api/roster-catalog"];
let scope = null, listening = false;
export function cacheScopeOf(userId, access) {
  if (!userId) return null;
  const a = access && typeof access === "object" ? access : null;
  return [userId, a ? a.role || "" : "-", a ? [].concat(a.sections || []).join(",") : "", a?.ownOnly ? "own" : "all", a ? [].concat(a.clientIds || []).join(",") : ""].join("|");
}
export function clearStoredDash() {
  scope = null;
  try { for (let i = sessionStorage.length - 1; i >= 0; i--) { const k = sessionStorage.key(i); if (k && k.startsWith("defied:dash:")) sessionStorage.removeItem(k); } } catch { /* storage blocked */ }
}
// the signed-in account's dataset just landed: its saved copy (only one saved under this same scope, under 30 minutes old) fills what's empty
export function setCacheScope(userId, access) {
  const next = cacheScopeOf(userId, access);
  if (!next || next === scope) return;
  scope = next;
  listen();
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(DASH_STORE_KEY) || "null"); } catch { saved = null; }
  if (!saved || saved.scope !== next || !(Date.now() - Number(saved.at) < STORE_MAX_AGE) || !saved.c || typeof saved.c !== "object") {
    try { sessionStorage.removeItem(DASH_STORE_KEY); } catch { /* storage blocked */ }
    return;
  }
  const c = saved.c;
  if (!dashCache.home && c.home) dashCache.home = c.home;
  if (!dashCache.top && c.top) dashCache.top = c.top;
  if (!dashCache.ar && c.ar) dashCache.ar = c.ar;
  if (!dashCache.acct && c.acct) dashCache.acct = c.acct;
  if (!cuCache.d && c.tasks) cuCache.d = c.tasks;
  // drawn at once and read again (at 0: not "fresh for two minutes")
  if (!syncCache.d && c.sync) { syncCache.d = c.sync; syncCache.at = 0; }
  seedJsonCache(Object.fromEntries(Object.entries(c).filter(([k]) => k.startsWith("/api/") && STORED_GETS.includes(k))));
}
export function saveDashCaches() {
  if (!scope) return;
  const all = { home: dashCache.home, top: dashCache.top, ar: dashCache.ar, acct: dashCache.acct, tasks: cuCache.d, sync: syncCache.d, ...jsonCacheEntries(STORED_GETS) };
  const c = {};
  let total = 0;
  for (const [k, v] of Object.entries(all)) {
    if (v == null) continue;
    let t;
    try { t = JSON.stringify(v); } catch { continue; }
    if (!t || t.length > MAX_ENTRY || total + t.length > MAX_TOTAL) continue;
    total += t.length; c[k] = v;
  }
  try { sessionStorage.setItem(DASH_STORE_KEY, JSON.stringify({ scope, at: Date.now(), c })); } catch { /* storage full or blocked */ }
}
function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("pagehide", saveDashCaches);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveDashCaches(); });
}
