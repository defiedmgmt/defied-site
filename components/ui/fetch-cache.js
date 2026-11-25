// GET reads cached in memory for the life of the tab (list B #10, cell data): a screen opened again draws its
// last answer at once and reads it again behind it (stale-while-revalidate), so switching tabs on a phone
// doesn't wait on the network. Nothing is kept across a reload or in storage.
// Any POST / PUT / PATCH / DELETE to /api/, from anywhere in the app, empties the cache before it goes out, so
// a save is never followed by an old answer. (The app's writes are plain fetch() calls in many places, so the
// cache watches window.fetch once instead of each of them having to remember.)
// (2026-11-24, speed) A read the dashboard's first request already has on its way (components/shared/boot.js) is taken from there; a read the
// sidebar started as the pointer reached a section (prefetchJson) is joined instead of asked twice; and the last answers of a few first
// screens are kept in this tab's sessionStorage by components/shared/dash-caches.js (jsonCacheEntries / seedJsonCache), so a reload draws
// them at once and reads them again behind it. Sign-in and sign-out empty all of it (clearJsonCache).
import { bootFetch } from "../shared/boot";

const cache = new Map();
const inflight = new Map(); // url -> { p, at }: a prefetch on its way
const prefetched = new Map(); // url -> when a prefetch filled it: a read within 10 s of that uses it as the fresh answer
let watching = false;
// a response read once, by whoever asks first (a prefetch and the read that joins it share it)
const wrap = (r) => { let jp = null; return { ok: r.ok, status: r.status, json: () => (jp = jp || r.json()) }; };
function watchWrites() {
  if (watching || typeof window === "undefined" || typeof window.fetch !== "function") return;
  watching = true;
  const orig = window.fetch;
  window.fetch = function (input, init) {
    const method = String(init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      const url = typeof input === "string" ? input : input?.url || String(input);
      if (url.includes("/api/")) { cache.clear(); inflight.clear(); prefetched.clear(); }
    }
    return orig.apply(this, arguments);
  };
}

// swrJson(url, onData, { keep, anyStatus }): calls onData(cached) right away when there is a good answer from
// before, then reads url (no-store) and calls onData(fresh) when keep(fresh) says it's a good answer (default:
// any JSON that isn't { error }); a bad answer is not cached and leaves what's on screen alone. Resolves with
// the fresh JSON either way, so the caller can say what went wrong. Rejects on a network error, or on a
// non-2xx unless anyStatus (then a non-2xx's JSON body resolves like any other answer).
export function swrJson(url, onData, { keep = (j) => j != null && !j.error, anyStatus = false } = {}) {
  watchWrites();
  const hit = cache.get(url);
  const pf = prefetched.get(url);
  prefetched.delete(url);
  if (hit && pf && Date.now() - pf < 10000 && keep(hit)) { onData(hit, { cached: false }); return Promise.resolve(hit); }
  if (hit) onData(hit, { cached: true });
  // a prefetch of this url that started in the last 10 s is this read (one request, not two)
  const pre = inflight.get(url);
  const got = pre && Date.now() - pre.at < 10000 ? pre.p : bootFetch(url).then(wrap);
  if (pre) inflight.delete(url);
  return got
    .then((r) => (r.ok || anyStatus ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((j) => { if (keep(j)) { cache.set(url, j); onData(j, { cached: false }); } else cache.delete(url); return j; });
}
// start reading url now (the pointer is on its section's button), unless it's cached or already on its way; swrJson joins it
export function prefetchJson(url) {
  watchWrites();
  if (typeof window === "undefined" || cache.has(url) || inflight.has(url)) return;
  const p = fetch(url, { cache: "no-store" }).then(wrap);
  const mine = { p, at: Date.now() };
  inflight.set(url, mine);
  // never consumed (the section wasn't opened): its answer still fills the cache, and the slot is freed
  p.then((r) => (r.ok ? r.json() : null)).then((j) => { if (inflight.get(url) === mine) { inflight.delete(url); if (j != null && !j.error) { cache.set(url, j); prefetched.set(url, Date.now()); } } })
    .catch(() => { if (inflight.get(url) === mine) inflight.delete(url); });
}
// the cached answers of these urls ({ url: json }), and back (only where nothing newer is cached): components/shared/dash-caches.js
export const jsonCacheEntries = (urls) => Object.fromEntries(urls.filter((u) => cache.has(u)).map((u) => [u, cache.get(u)]));
export function seedJsonCache(entries) { watchWrites(); for (const [u, j] of Object.entries(entries || {})) if (j != null && !cache.has(u)) cache.set(u, j); }
// the cached answer for url, or undefined (for a useState initial value, so the first paint has it)
export const peekJson = (url) => { watchWrites(); return cache.get(url); };
export const clearJsonCache = () => { cache.clear(); inflight.clear(); prefetched.clear(); };
