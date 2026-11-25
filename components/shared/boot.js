// (2026-11-24, speed) A dashboard visit's first reads, started at once and answered together. Before, a page waited for the sign-in check,
// then the dataset, then made its 8-11 other calls (each its own server function, each able to wake up cold): about 2 s to the last card.
// Now the app shell (components/app/AppRoot.jsx) starts two GET /api/boot requests the moment a /dashboard address opens (the session cookie
// is what authenticates every read, so nothing waits for /api/auth/me): one for what the first screen can't draw without (the session, the
// dataset and the song facts To do counts from), one for everything else, so a slow read never holds the sidebar back, even if the answer
// arrives in one piece. The server answers each read with that route's own handler (lib/boot.js: the same role checks) and sends each one as
// it's ready. The code that makes a call asks bootFetch(url) instead of fetch(url): the read already on its way is handed over (once), else
// it's an ordinary request, exactly as before.
//
// The same module also says when a section's data was last read (markLoaded / loadedRecently), so going back to a tab within 30 s draws
// what it has instead of asking again.
// (2026-11-25, review) Every read is stamped when it STARTS (stamp()): its answer counts only if nothing happened since (fate()). A write in
// between (any POST/PUT/PATCH/DELETE to /api/) means "read again" (readFresh does), so a change is never followed by an answer from before
// it, and such an answer never counts as recent. A sign-in or sign-out in between means "drop": the last account's answers never fill the
// next one's caches; its boot requests are cancelled. A boot's answer also says whose it is (X-Boot-User), and it's only handed to the
// account this tab is signed in as.
// (2026-11-25, live) A write counts when its answer says something changed: the watch sees every POST/PUT/PATCH/DELETE to /api/ go out,
// and when its answer comes back with X-Defied-Changed: 0 (the Dashboard's background sheet pull that wasn't due, { skipped }) nothing is
// forgotten; any other answer, or none, is a change and forgets as before. While a write is on its way, a read that lands waits for its
// answer before it counts (settledFate), so a read from before a real write is still never shown after it, and one from before a no-op
// isn't thrown away. (Before, the background pull's POST, a 60 ms "not due", dropped every boot answer still on its way: 9 reads asked again.)

const parts = new Map(); // url -> { p: Promise<{ s, b, who } | null>, at }
const loaded = new Map(); // key -> { at, gen }
const running = new Set(); // the boot requests on their way (AbortControllers): cancelled at sign-in and sign-out
let gen = 0; // moves on with every write and every sign-in / sign-out
let sgen = 0; // moves on with every sign-in / sign-out
let user; // the account this tab is signed in as: undefined until the session check answers, null when nobody
let pending = 0; // writes on their way
let idle = null; // { p, done }: resolves when no write is on its way
const changeListeners = new Set(); // told when a write changed something (components/ui/fetch-cache.js empties its cache)
export const BOOT_MAX_AGE = 15000; // a read handed over only to code that asks within 15 s of its answer arriving
export const RECENT_MS = 30000;
// a read the boot hasn't answered this long after it started is asked for on its own (the server gives up on it at 9 s: lib/boot.js; tests set it lower)
export const bootWait = { ms: 12000 };

// the timings of the last boot, for measuring in the browser's console: window.__dashBoot
const trace = (k, v) => { try { const t = (window.__dashBoot = window.__dashBoot || { parts: {} }); if (k) t.parts[k] = v; return t; } catch { return {}; } };

let watching = false;
// a write's answer: did it change anything? Only an answer that says X-Defied-Changed: 0 didn't; a failed request may have, so it counts
export const changedBy = (res) => !(res && typeof res.headers?.get === "function" && res.headers.get("x-defied-changed") === "0");
// (2026-11-25, review PERF2-1) a write sent with X-Defied-Background: 1 (the Dashboard's background sheet pull, catalog-data.js) never holds a read:
// it reads every artist's tab, seconds, and the boot's reads used to wait for all of it. Its answer still forgets what was read before it when it
// changed something (or never came), as any write's does.
export const isBackgroundWrite = (init) => {
  const h = init?.headers;
  if (!h) return false;
  if (typeof h.get === "function") return h.get("x-defied-background") === "1";
  return Object.entries(h).some(([k, v]) => String(k).toLowerCase() === "x-defied-background" && String(v) === "1");
};
export function watchWrites() {
  if (watching || typeof window === "undefined" || typeof window.fetch !== "function") return;
  watching = true;
  const orig = window.fetch;
  window.fetch = function (input, init) {
    const method = String(init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
    const url = typeof input === "string" ? input : input?.url || String(input);
    if (method === "GET" || method === "HEAD" || !url.includes("/api/")) return orig.apply(this, arguments);
    if (isBackgroundWrite(init)) return orig.apply(this, arguments).then((res) => { if (changedBy(res)) forgetBoot(); return res; }, (err) => { forgetBoot(); throw err; });
    if (!pending++) { let done; idle = { p: new Promise((r) => { done = r; }), done: () => done() }; }
    const settle = (changed) => { if (changed) forgetBoot(); if (!--pending) { const i = idle; idle = null; i?.done(); } };
    // decided before the caller sees the answer: code that awaits a save and then reads again reads after the forgetting, never before it
    return orig.apply(this, arguments).then((res) => { settle(changedBy(res)); return res; }, (err) => { settle(true); throw err; });
  };
}
// resolves once no write is on its way (at once when none is)
export const writesSettled = () => (pending && idle ? idle.p.then(() => writesSettled()) : Promise.resolve());
// fate(t), decided once the writes on their way have answered: a read that lands while one is going waits to know whether it changed anything
export async function settledFate(t) { await writesSettled(); return fate(t); }
// told whenever a write changed something (not for a write that changed nothing, nor for a sign-in or sign-out: those clear everything themselves)
export function onDataChange(fn) { changeListeners.add(fn); return () => changeListeners.delete(fn); }
// a write (or, with session, a sign-in or sign-out): nothing read before it is handed over or counted as recent; at a sign-in or sign-out
// the boot requests still on their way are cancelled too
export function forgetBoot({ session = false } = {}) {
  gen++; parts.clear(); loaded.clear();
  for (const fn of changeListeners) { try { fn({ session }); } catch { /* a listener's own problem */ } }
  if (session) {
    sgen++;
    for (const c of running) { try { c.abort(); } catch { /* already done */ } }
    running.clear();
  }
}
// the account this tab is signed in as (AppRoot: when the session check answers, at sign-in, at sign-out); another account than before
// is a sign-in: everything of the last one's still on its way is dropped
export function setBootUser(id) {
  const next = id ? String(id) : null;
  if (user !== undefined && user !== next) forgetBoot({ session: true });
  user = next;
}
// stamp(): taken as a read starts. fate(stamp): what its answer may do now: "apply" (nothing happened since), "again" (a write since: read
// again), "drop" (a sign-in or sign-out since: never use it)
export const stamp = () => ({ g: gen, s: sgen });
export const fate = (t) => (!t || t.s !== sgen ? "drop" : t.g !== gen ? "again" : "apply");

// A dashboard address -> the reads its first screen makes, in two requests. first: what the sidebar can't be drawn without (the session, the
// dataset) and what To do's rows and Done for you count from (the song facts, the split fixes, the old portfolios' list); rest: the shell's
// counts (ClickUp, Money's badge, the true-up, A&R) and the section's own reads, the database-heavy ones included (This week, the spikes,
// A&R Home's lists), so none of them can hold the first screen back. Every account asks for the same list: the server answers each read
// with that route's own checks (a read this account can't use comes back refused, as it would on its own, and nothing uses it).
const SHELL_FIRST = ["/api/dashboard-data", "/api/songs", "/api/split-fixes", "/api/data?seeds=1"];
const SHELL_REST = ["/api/tasks", "/api/accounting?counts=1", "/api/trueup", "/api/ar?summary=1"];
// the Sync checks (sheets, Stripe, ClickUp, and their 2-minutely INFO and people link) only where they're on the first screen: Dashboard,
// To do and Site. Anywhere else the sidebar's count reads them a little later (todo-data.js useSyncChecks)
export const SYNC_TABS = ["home", "todo", "site"];
const SECTION_READS = {
  home: ["/api/data?home=1", "/api/growth?top=1", "/api/home", "/api/sync"],
  todo: ["/api/sync"],
  site: ["/api/sync"],
  money: ["/api/accounting"],
  ar: ["/api/ar-lists?view=home"],
};
const MONEY_ACCOUNTING_SUBS = [null, "overview", "payments", "mine"];
// (2026-11-25, live) where the Dashboard starts its background sheet pull (StaffDashboard: Dashboard, To do, Roster), whether one is due
// comes with the boot, so a pull that isn't due costs no request at all (catalog-data.js fullSiteSync)
export const PULL_DUE_URL = "/api/sheets-pull?due=1";
const PULL_TABS = ["home", "todo", "catalog"];
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
// -> [first reads, the rest] for one address; me: the session check too (not after a sign-in, which already knows it)
export function bootPlan(pathname, { me = true } = {}) {
  const at = bootSectionOf(pathname);
  if (!at) return [[], []];
  let own = SECTION_READS[at.tab] || [];
  // Money reads the accounting numbers on its Overview, All payments and My payments (its deal pills read their own data); A&R's other
  // views read their own lists
  if (at.tab === "money" && !MONEY_ACCOUNTING_SUBS.includes(at.sub)) own = [];
  if (at.tab === "ar" && at.sub) own = [];
  return [[...(me ? ["/api/auth/me"] : []), ...SHELL_FIRST], [...SHELL_REST, ...own, ...(PULL_TABS.includes(at.tab) ? [PULL_DUE_URL] : [])]];
}

// one /api/boot request for these reads; each read's answer is handed to the first bootFetch(url) that asks for it
function bootRequest(urls) {
  const mine = urls.filter((u) => !parts.has(u));
  if (!mine.length) return;
  const waiting = new Map();
  const at = Date.now();
  for (const u of mine) { let resolve; const e = { p: null, at, arrived: 0 }; e.p = new Promise((r) => { resolve = (v) => { e.arrived = Date.now(); r(v); }; }); parts.set(u, e); waiting.set(u, resolve); }
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  if (ctl) running.add(ctl);
  let who; // whose answers these are (the X-Boot-User header: the session the server checked)
  const settle = (u, part) => { const done = waiting.get(u); if (!done) return; waiting.delete(u); done(part); };
  const take = (line) => {
    let j;
    try { j = JSON.parse(line); } catch { return; }
    if (!waiting.has(j?.u)) return;
    trace(j.u, { s: j.s, serverMs: j.ms, at: Math.round((typeof performance !== "undefined" ? performance.now() : 0) - t0), ...(j.f ? { fallback: true } : {}) });
    // f: the server gave up on this read (it took too long): it's asked for on its own, now
    settle(j.u, !j.f && Number.isInteger(j.s) && j.s >= 200 && j.s <= 599 ? { s: j.s, b: j.b, who } : null);
  };
  // a read with no line bootWait.ms after the boot started (a stream that stalled): asked for on its own; nothing is left to wait for
  const backstop = setTimeout(() => { for (const u of [...waiting.keys()]) settle(u, null); try { ctl?.abort(); } catch { /* done */ } }, bootWait.ms);
  fetch(`/api/boot?${mine.map((u) => `u=${encodeURIComponent(u)}`).join("&")}`, { cache: "no-store", headers: { Accept: "text/plain" }, ...(ctl ? { signal: ctl.signal } : {}) })
    .then((res) => { if (!res.ok) return null; who = res.headers?.get?.("x-boot-user") ?? undefined; return readLines(res, take); })
    .catch(() => {})
    // a read with no line (the request failed, was cancelled, the function ended): its own request, as before
    .finally(() => { clearTimeout(backstop); if (ctl) running.delete(ctl); for (const u of [...waiting.keys()]) settle(u, null); });
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

// start a dashboard address's first reads (two requests: what the first screen needs, the rest)
export function startBoot(pathname, opts) {
  if (typeof window === "undefined" || typeof fetch !== "function") return;
  watchWrites();
  const [first, rest] = bootPlan(pathname, opts);
  trace(null).startedAt = Math.round(typeof performance !== "undefined" ? performance.now() : 0);
  bootRequest(first);
  bootRequest(rest);
}

// fetch(url), unless that read is already on its way in a boot request: then its answer, as a Response like fetch's (status and JSON).
// Handed over once; one that came back with nothing, came too late, or is another account's than this tab's is an ordinary request.
export function bootFetch(url, init) {
  watchWrites();
  const plain = () => fetch(url, { cache: "no-store", ...init });
  const e = parts.get(url);
  if (e) parts.delete(url);
  // (2026-11-25) too old: an answer that ARRIVED over BOOT_MAX_AGE ago (one still on its way is always waited for: a slow cold boot is still
  // the read the page asked for, and asking again would only double it)
  if (!e || (e.arrived && Date.now() - e.arrived > BOOT_MAX_AGE) || (init?.method && String(init.method).toUpperCase() !== "GET")) return plain();
  const t = stamp();
  return e.p.then((part) => {
    // (the session check's own answer is exempt: it is what says who this tab is signed in as)
    if (!part || fate(t) === "drop" || (url !== "/api/auth/me" && user !== undefined && part.who !== undefined && part.who !== (user || ""))) return plain();
    return new Response(part.b === undefined ? null : JSON.stringify(part.b), { status: part.s, headers: { "Content-Type": "application/json" } });
  });
}
// a read still waiting to be handed over (tests, and the shell's own checks)
export const bootPending = (url) => parts.has(url);

// GET url (from the boot when it has it) for the dashboard's caches -> { ok, status, j, t }, the answer to a read that started after
// anything that happened since: a write while it was on its way reads it again (at most twice more), a sign-in or sign-out resolves
// { dropped: true } (nothing to show, nothing to cache). t is the stamp of the read that answered (markLoaded(key, t)).
export async function readFresh(url, init) {
  let last = null;
  for (let i = 0; i < 3; i++) {
    const t = stamp();
    let r, j = null;
    try {
      r = await bootFetch(url, init);
      j = await r.json().catch(() => null);
    } catch (err) {
      const f = await settledFate(t);
      if (f === "drop") return { dropped: true };
      if (f === "again") continue;
      throw err;
    }
    const f = await settledFate(t);
    if (f === "drop") return { dropped: true };
    last = { ok: r.ok, status: r.status, j, t };
    if (f === "apply") return last;
  }
  // writes kept coming: the last answer (it started after the earlier ones), not counted as recent (its stamp is out of date)
  return last;
}

// when a section's data was last read well: going back within RECENT_MS draws what it has and asks nothing (a write in between asks again).
// t: the stamp of the read that brought it; a read that started before a write or a sign-in is never counted
export function markLoaded(key, t) { watchWrites(); if (fate(t) !== "apply") return; loaded.set(key, { at: Date.now(), gen }); }
export function loadedRecently(key, ms = RECENT_MS) { const x = loaded.get(key); return !pending && !!x && x.gen === gen && Date.now() - x.at < ms; }
// read well at least once since the page opened (and since the last write)
export const loadedOnce = (key) => loaded.has(key);
