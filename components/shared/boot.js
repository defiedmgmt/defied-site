// (2026-11-24, speed) A dashboard visit's first reads, started at once and answered together. Before, a page waited for the sign-in check,
// then the dataset, then made its 8-11 other calls (each its own server function, each able to wake up cold): about 2 s to the last card.
// Now the app shell (components/app/AppRoot.jsx) starts two GET /api/boot requests the moment a /dashboard address opens (the session cookie
// is what authenticates every read, so nothing waits for /api/auth/me): one for the database reads the shell draws from, one for the slower
// ones (Stripe, the sheets, ClickUp), so a slow read never holds the sidebar back. The server answers each read with that route's own handler
// (lib/boot.js: the same role checks) and sends each one as it's ready. The code that makes a call asks bootFetch(url) instead of fetch(url):
// the read already on its way is handed over (once), else it's an ordinary request, exactly as before. Nothing here outlives a sign-in:
// clearDashCaches (sign-in, sign-out) drops whatever hasn't been handed over.
//
// The same module also says when a section's data was last read (markLoaded / loadedRecently), so going back to a tab within 30 s draws
// what it has instead of asking again. Any POST/PUT/PATCH/DELETE to /api/ (a save, a Done, a sync) forgets both, so a change is never
// followed by an answer from before it.

const parts = new Map(); // url -> { p: Promise<{ s, b } | null>, at }
const loaded = new Map(); // key -> { at, gen }
let gen = 0; // moves on with every write and every sign-in / sign-out
export const BOOT_MAX_AGE = 15000; // a read handed over only to code that asks within 15 s of the page opening
export const RECENT_MS = 30000;

// the timings of the last boot, for measuring in the browser's console: window.__dashBoot
const trace = (k, v) => { try { const t = (window.__dashBoot = window.__dashBoot || { parts: {} }); if (k) t.parts[k] = v; return t; } catch { return {}; } };

let watching = false;
function watchWrites() {
  if (watching || typeof window === "undefined" || typeof window.fetch !== "function") return;
  watching = true;
  const orig = window.fetch;
  window.fetch = function (input, init) {
    const method = String(init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      const url = typeof input === "string" ? input : input?.url || String(input);
      if (url.includes("/api/")) forgetBoot();
    }
    return orig.apply(this, arguments);
  };
}
// a write, a sign-in or a sign-out: nothing read before it is handed over or counted as recent
export function forgetBoot() { gen++; parts.clear(); loaded.clear(); }

// A dashboard address -> the reads its first screen makes. shell: what the sidebar and its counts read on every section (the dataset and
// the session first); then the section's own. Every account asks for the same list: the server answers each read with that route's own
// checks (a read this account can't use comes back refused, as it would on its own, and nothing uses it).
const SHELL_DB = ["/api/dashboard-data", "/api/songs", "/api/split-fixes", "/api/data?seeds=1", "/api/trueup", "/api/ar?summary=1"];
const SHELL_SLOW = ["/api/tasks", "/api/accounting?counts=1"];
// the Sync checks (sheets, Stripe, ClickUp, and their 2-minutely INFO and people link) only where they're on the first screen: Dashboard,
// To do and Site. Anywhere else the sidebar's count reads them a little later (todo-data.js useSyncChecks)
export const SYNC_TABS = ["home", "todo", "site"];
const SECTION_READS = {
  home: { db: ["/api/data?home=1", "/api/growth?top=1"], slow: ["/api/home", "/api/sync"] },
  todo: { slow: ["/api/sync"] },
  site: { slow: ["/api/sync"] },
  money: { slow: ["/api/accounting"] },
  ar: { db: ["/api/ar-lists?view=home"] },
};
const MONEY_ACCOUNTING_SUBS = [null, "overview", "payments", "mine"];
// the section an address opens (the same names as StaffDashboard's tabs; an old one's own address is good enough here)
export function bootSectionOf(pathname) {
  const [, root, t, sub] = String(pathname || "").split("?")[0].split("/");
  if (root !== "dashboard") return null;
  if (!t || t === "home" || t === "dashboard") return { tab: "home", sub: null };
  // (this file is in every page's code, public ones too: it names no deal; an old Deals address is one of Money's deal pills)
  if (t === "deals") return { tab: "money", sub: "deal" };
  if (t === "publishing") return { tab: "catalog", sub: sub || null };
  if (t === "numbers" || t === "luminate") return { tab: "site", sub: "sync" };
  let part = sub || null;
  try { part = part && decodeURIComponent(part); } catch { /* a malformed address: its raw text */ }
  return { tab: t, sub: part };
}
// -> [db reads, slow reads] for one address; me: the session check too (not after a sign-in, which already knows it)
export function bootPlan(pathname, { me = true } = {}) {
  const at = bootSectionOf(pathname);
  if (!at) return [[], []];
  const own = SECTION_READS[at.tab] || {};
  // Money reads the accounting numbers on its Overview, All payments and My payments (its deal pills read their own data); A&R's other
  // views read their own lists
  const slow = at.tab === "money" && !MONEY_ACCOUNTING_SUBS.includes(at.sub) ? [] : own.slow || [];
  const db = at.tab === "ar" && at.sub ? [] : own.db || [];
  return [[...(me ? ["/api/auth/me"] : []), ...SHELL_DB, ...db], [...SHELL_SLOW, ...slow]];
}

// one /api/boot request for these reads; each read's answer is handed to the first bootFetch(url) that asks for it
function bootRequest(urls) {
  const mine = urls.filter((u) => !parts.has(u));
  if (!mine.length) return;
  const waiting = new Map();
  const at = Date.now();
  for (const u of mine) { let resolve; const p = new Promise((r) => { resolve = r; }); parts.set(u, { p, at }); waiting.set(u, resolve); }
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  const take = (line) => {
    let j;
    try { j = JSON.parse(line); } catch { return; }
    const done = waiting.get(j?.u);
    if (!done) return;
    waiting.delete(j.u);
    trace(j.u, { s: j.s, serverMs: j.ms, at: Math.round((typeof performance !== "undefined" ? performance.now() : 0) - t0) });
    done(Number.isInteger(j.s) && j.s >= 200 && j.s <= 599 ? { s: j.s, b: j.b } : null);
  };
  fetch(`/api/boot?${mine.map((u) => `u=${encodeURIComponent(u)}`).join("&")}`, { cache: "no-store", headers: { Accept: "application/x-ndjson" } })
    .then((res) => (res.ok ? readLines(res, take) : null))
    .catch(() => {})
    // a read with no line (the request failed, the function ended): its own request, as before
    .finally(() => { for (const done of waiting.values()) done(null); });
}
// each complete line as it arrives (a browser without a readable body: all of them at the end)
export async function readLines(res, onLine) {
  if (!res.body || typeof res.body.getReader !== "function") { for (const l of String(await res.text()).split("\n")) if (l.trim()) onLine(l); return; }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) onLine(l); }
  }
  buf += dec.decode();
  if (buf.trim()) onLine(buf);
}

// start a dashboard address's first reads (two requests: the database ones, the slow ones)
export function startBoot(pathname, opts) {
  if (typeof window === "undefined" || typeof fetch !== "function") return;
  watchWrites();
  const [db, slow] = bootPlan(pathname, opts);
  trace(null).startedAt = Math.round(typeof performance !== "undefined" ? performance.now() : 0);
  bootRequest(db);
  bootRequest(slow);
}

// fetch(url), unless that read is already on its way in a boot request: then its answer, as a Response like fetch's (status and JSON).
// Handed over once; one that came back with nothing (or came too late) is an ordinary request.
export function bootFetch(url, init) {
  watchWrites();
  const plain = () => fetch(url, { cache: "no-store", ...init });
  const e = parts.get(url);
  if (e) parts.delete(url);
  if (!e || Date.now() - e.at > BOOT_MAX_AGE || (init?.method && String(init.method).toUpperCase() !== "GET")) return plain();
  return e.p.then((part) => (part ? new Response(part.b === undefined ? null : JSON.stringify(part.b), { status: part.s, headers: { "Content-Type": "application/json" } }) : plain()));
}
// a read still waiting to be handed over (tests, and the shell's own checks)
export const bootPending = (url) => parts.has(url);

// when a section's data was last read well: going back within RECENT_MS draws what it has and asks nothing (a write in between asks again)
export function markLoaded(key) { watchWrites(); loaded.set(key, { at: Date.now(), gen }); }
export function loadedRecently(key, ms = RECENT_MS) { const x = loaded.get(key); return !!x && x.gen === gen && Date.now() - x.at < ms; }
// read well at least once since the page opened (and since the last write)
export const loadedOnce = (key) => loaded.has(key);
