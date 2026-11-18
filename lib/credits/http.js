// The calls out of lib/credits, in one place: the clock, the pause between two calls to one host, the timeout, and the fakes a test passes in (fetch, wait,
// clock). Nothing here knows what a call is for. An error line never carries a key (an API key sits in the address of a YouTube call). Server-only.
import { spotifyRead } from "../data/direct";

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export const SPOTIFY_GAP_MS = 120; // lib/isrc.js asks Spotify for 100 between calls; a little more, since a scan makes many in a row

// no key in a message: "key=AIza…" in an address is cut to "key=…"
export const clean = (err) => String(err?.message || err || "").replace(/([?&]key=)[^&\s"')]+/gi, "$1…").slice(0, 200);

export function makeCtx(o = {}) {
  const clock = o.clock || Date.now;
  // a call never waits longer than what is left of the run (o.deadline, a clock time) and 1.5 s over, so one that hangs can't carry a run far past its budget
  const bound = (ms) => (o.deadline ? Math.max(1500, Math.min(ms, o.deadline - clock() + 1500)) : ms);
  const sleep = o.wait || pause;
  // read at the call, so a test that replaces globalThis.fetch is heard
  const doFetch = o.fetch || ((...a) => globalThis.fetch(...a));
  const next = new Map();
  // Calls to one host start at least gapMs apart. The slot is taken before anything is awaited, so two callers at once get two slots, not the same one.
  async function gate(host, gapMs) {
    const t = clock();
    const slot = Math.max(t, next.get(host) || 0);
    next.set(host, slot + gapMs);
    if (slot > t) await sleep(slot - t);
  }
  // one GET: { status, ok, body (parsed JSON, as "json"), text (as "text"), retryAfter }. A network error or a timeout throws (the message without any key)
  async function get(url, { host, gap = 0, headers = {}, timeout = 15000, as = "json" } = {}) {
    if (gap) await gate(host, gap);
    let res;
    try { res = await doFetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(bound(timeout)) }); } catch (err) { throw new Error(clean(err)); }
    const text = await res.text();
    let body = null;
    if (as === "json") { try { body = text ? JSON.parse(text) : null; } catch { body = null; } }
    return { status: res.status, ok: res.ok, body, text: as === "text" ? text : undefined, retryAfter: res.headers?.get?.("retry-after") ?? null };
  }
  // Spotify's Web API through lib/data/direct.js (the app's client-credentials token): { status, body, retryAfter }
  const spotify = o.spotify || (async (path) => { await gate("api.spotify.com", SPOTIFY_GAP_MS); return spotifyRead(path, { timeout: bound(20000) }); });
  // how much of the run is left, in ms (the caller's deadline, a clock time): a call that needs a pause and an answer isn't started without it
  const left = () => (o.deadline ? o.deadline - clock() : Infinity);
  return { clock, sleep, gate, get, spotify, left, now: () => new Date(clock()) };
}
