// GET reads cached in memory for the life of the tab (list B #10, cell data): a screen opened again draws its
// last answer at once and reads it again behind it (stale-while-revalidate), so switching tabs on a phone
// doesn't wait on the network. Nothing is kept across a reload or in storage.
// Any POST / PUT / PATCH / DELETE to /api/, from anywhere in the app, empties the cache before it goes out, so
// a save is never followed by an old answer. (The app's writes are plain fetch() calls in many places, so the
// cache watches window.fetch once instead of each of them having to remember.)
const cache = new Map();
let watching = false;
function watchWrites() {
  if (watching || typeof window === "undefined" || typeof window.fetch !== "function") return;
  watching = true;
  const orig = window.fetch;
  window.fetch = function (input, init) {
    const method = String(init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      const url = typeof input === "string" ? input : input?.url || String(input);
      if (url.includes("/api/")) cache.clear();
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
  if (hit) onData(hit, { cached: true });
  return fetch(url, { cache: "no-store" })
    .then((r) => (r.ok || anyStatus ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((j) => { if (keep(j)) { cache.set(url, j); onData(j, { cached: false }); } else cache.delete(url); return j; });
}
// the cached answer for url, or undefined (for a useState initial value, so the first paint has it)
export const peekJson = (url) => { watchWrites(); return cache.get(url); };
export const clearJsonCache = () => cache.clear();
