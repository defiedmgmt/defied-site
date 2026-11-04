// List B #4: the calls out. Server only. Keys are read at call time and never logged or returned.
//   Apify:   start a run (with its own charge cap and, when set up, a webhook back to us), read a run,
//            read its items, read the account's usage against its monthly limit
//   YouTube: channels' subscribers and views (Data API, 1 unit per call of up to 50 channels)
//   Spotify: an artist's releases and each release's songs (Web API, client credentials; development
//            mode pages are 10 long and batch lookups are refused, so it reads one at a time)
const APIFY = "https://api.apify.com/v2";
const TIMEOUT = 20000;

async function getJson(url, opts = {}) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(opts.timeout || TIMEOUT) });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { status: r.status, ok: r.ok, body, retryAfter: r.headers.get("retry-after") };
}
// an error line without anything secret in it
const why = (r, what) => `${what}: ${r.status}${r.body?.error?.message ? ` ${String(r.body.error.message).slice(0, 160)}` : ""}`;

// ---------------------------------------------------------------- Apify
const apifyHeaders = () => ({ Authorization: `Bearer ${process.env.APIFY_TOKEN}`, "Content-Type": "application/json" });
export const apifyConfigured = () => !!String(process.env.APIFY_TOKEN || "").trim();

// the run's webhook: Apify calls it when the run ends, so the numbers land without waiting for the next
// cron. Only with DATA_HOOK_SECRET set; the address is DATA_HOOK_URL, else the production site's.
export function hookFor() {
  const secret = String(process.env.DATA_HOOK_SECRET || "").trim();
  const base = process.env.DATA_HOOK_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/api/data-hook` : "");
  if (!secret || !base) return null;
  return [{ eventTypes: ["ACTOR.RUN.SUCCEEDED", "ACTOR.RUN.FAILED", "ACTOR.RUN.ABORTED", "ACTOR.RUN.TIMED_OUT"], requestUrl: `${base}${base.includes("?") ? "&" : "?"}secret=${encodeURIComponent(secret)}` }];
}

// a run may take a while (200 songs): it isn't waited for, so 15 minutes is fine
export async function apifyStart(actor, input, { capUsd, timeoutSecs = 900 }) {
  const q = new URLSearchParams({ maxTotalChargeUsd: String(capUsd), timeout: String(timeoutSecs), memory: "1024" });
  const hooks = hookFor();
  if (hooks) q.set("webhooks", Buffer.from(JSON.stringify(hooks)).toString("base64"));
  const r = await getJson(`${APIFY}/acts/${actor.replace("/", "~")}/runs?${q}`, { method: "POST", headers: apifyHeaders(), body: JSON.stringify(input) });
  if (!r.ok || !r.body?.data?.id) throw new Error(why(r, `Apify didn't start ${actor}`));
  return r.body.data; // { id, status, defaultDatasetId, startedAt, … }
}
export async function apifyRun(runId) {
  const r = await getJson(`${APIFY}/actor-runs/${encodeURIComponent(runId)}`, { headers: apifyHeaders() });
  if (!r.ok || !r.body?.data) throw new Error(why(r, "Apify run"));
  return r.body.data;
}
export async function apifyItems(datasetId, limit = 5000) {
  const r = await getJson(`${APIFY}/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&limit=${limit}`, { headers: apifyHeaders(), timeout: 60000 });
  if (!r.ok || !Array.isArray(r.body)) throw new Error(why(r, "Apify items"));
  return r.body;
}
// { usageUsd, limitUsd, cycleEnd }: what the account has spent this cycle against its hard monthly limit
export async function apifyLimits() {
  const r = await getJson(`${APIFY}/users/me/limits`, { headers: apifyHeaders() });
  const d = r.body?.data;
  if (!r.ok || !d) throw new Error(why(r, "Apify limits"));
  return { usageUsd: Number(d.current?.monthlyUsageUsd) || 0, limitUsd: Number(d.limits?.maxMonthlyUsageUsd) || 0, cycleEnd: d.monthlyUsageCycle?.endAt || null };
}
export const TERMINAL = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);

// ---------------------------------------------------------------- YouTube
export const youtubeConfigured = () => !!String(process.env.YOUTUBE_API_KEY || "").trim();
// targets [{ key, ref }] (ref a UC… id or an @handle) -> [{ key, values:[{metric,value}], name, channelId }]
export async function youtubeStats(targets) {
  const key = process.env.YOUTUBE_API_KEY;
  const base = "https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet";
  const res = [];
  const take = (item, t) => {
    const st = item?.statistics || {};
    const values = [];
    if (!st.hiddenSubscriberCount && st.subscriberCount != null) values.push({ metric: "subscribers", value: Number(st.subscriberCount) });
    if (st.viewCount != null) values.push({ metric: "views", value: Number(st.viewCount) });
    res.push({ key: t.key, values: values.filter((v) => Number.isFinite(v.value)), name: item?.snippet?.title || "", image: item?.snippet?.thumbnails?.medium?.url || "", channelId: item?.id || "" });
  };
  const ids = targets.filter((t) => t.ref.startsWith("UC"));
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const r = await getJson(`${base}&id=${chunk.map((t) => t.ref).join(",")}&key=${encodeURIComponent(key)}`);
    if (!r.ok) throw new Error(why(r, "YouTube"));
    for (const t of chunk) { const it = (r.body?.items || []).find((x) => x.id === t.ref); if (it) take(it, t); }
  }
  for (const t of targets.filter((x) => x.ref.startsWith("@"))) {
    const r = await getJson(`${base}&forHandle=${encodeURIComponent(t.ref.slice(1))}&key=${encodeURIComponent(key)}`);
    if (!r.ok) throw new Error(why(r, "YouTube"));
    if (r.body?.items?.[0]) take(r.body.items[0], t);
  }
  return res;
}

// ---------------------------------------------------------------- Spotify Web API
export const spotifyConfigured = () => !!(String(process.env.SPOTIFY_CLIENT_ID || "").trim() && String(process.env.SPOTIFY_CLIENT_SECRET || "").trim());
let tok = null;
export const resetSpotifyToken = () => { tok = null; };
async function spotifyToken() {
  if (tok && tok.until > Date.now() + 60000) return tok.value;
  const basic = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString("base64");
  const r = await getJson("https://accounts.spotify.com/api/token", { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  if (!r.ok || !r.body?.access_token) throw new Error(`Spotify sign-in: ${r.status}`);
  tok = { value: r.body.access_token, until: Date.now() + (Number(r.body.expires_in) || 3600) * 1000 };
  return tok.value;
}
export class RateLimited extends Error {}
async function spGet(path) {
  const r = await getJson(`https://api.spotify.com/v1${path}`, { headers: { Authorization: `Bearer ${await spotifyToken()}` } });
  if (r.status === 429) throw new RateLimited(`Spotify asked us to wait ${r.retryAfter || "a while"}`);
  if (!r.ok) throw new Error(why(r, "Spotify"));
  return r.body;
}
// every release an artist is on (their albums and singles, and others' releases they appear on), newest
// first: [{ id, name, releaseDate, image, group }]
export async function spotifyReleases(artistId, { max = 60 } = {}) {
  const outList = [];
  for (let offset = 0; offset < max; offset += 10) {
    const b = await spGet(`/artists/${artistId}/albums?include_groups=album,single,appears_on&limit=10&offset=${offset}`);
    for (const a of b?.items || []) outList.push({ id: a.id, name: a.name, releaseDate: a.release_date || "", image: (a.images || []).find((x) => x.width && x.width <= 320)?.url || a.images?.[0]?.url || "", artists: (a.artists || []).map((x) => x.id) });
    if (!b?.next) break;
  }
  return outList.sort((a, b) => (a.releaseDate < b.releaseDate ? 1 : -1));
}
// a release's songs: [{ id, name, artists:[{id,name}] }]
export async function spotifyAlbumTracks(albumId, { max = 50 } = {}) {
  const list = [];
  for (let offset = 0; offset < max; offset += 10) {
    const b = await spGet(`/albums/${albumId}/tracks?limit=10&offset=${offset}`);
    for (const t of b?.items || []) list.push({ id: t.id, name: t.name, artists: (t.artists || []).map((a) => ({ id: a.id, name: a.name })) });
    if (!b?.next) break;
  }
  return list;
}
