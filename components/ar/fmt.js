// A&R lists (r10): the few formatting helpers every A&R view shares. Dates and times read in New York.
export const NY = "America/New_York";
export const n0 = (v) => (v == null || !Number.isFinite(Number(v)) ? "" : Math.round(Number(v)).toLocaleString("en-US"));
export const signed = (v) => (v == null ? "" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(Math.round(v)).toLocaleString("en-US")}`);
export const pctText = (p) => (p == null ? "" : Math.abs(p) < 0.05 ? "0.0%" : `${p > 0 ? "▲" : "▼"} ${Math.abs(p).toFixed(1)}%`);
export const pctSigned = (p) => (p == null ? "" : `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p).toFixed(1)}%`);
export const dirOf = (p) => (p == null || Math.abs(p) < 0.05 ? "flat" : p > 0 ? "up" : "down");
// short numbers for cards and chips (12.4K, 1.2M)
export const short = (v) => {
  if (v == null) return "";
  const n = Number(v), a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${Math.round(n / 1e3)}K`;
  return n0(n);
};
const day0 = (t) => (/^\d{4}-\d{2}-\d{2}$/.test(String(t)) ? new Date(`${t}T12:00:00Z`) : new Date(t));
// "Nov 4"
export const dayText = (t) => (t ? day0(t).toLocaleDateString("en-US", { timeZone: /^\d{4}-\d{2}-\d{2}$/.test(String(t)) ? "UTC" : NY, month: "short", day: "numeric" }) : "");
// "Nov 4, 7:02 AM"
export const atText = (t) => (t ? new Date(t).toLocaleString("en-US", { timeZone: NY, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
// two readings' times: "Nov 4, 7 AM → 7 PM" on one New York day, else "Nov 4 → Nov 5" (r10 fix)
const hourText = (t) => new Date(t).toLocaleString("en-US", { timeZone: NY, hour: "numeric" }); // "7 AM" (each cell's tooltip has the minute)
export const spanText = (from, to) => (!from || !to ? "" : nyDayOf(from) === nyDayOf(to) ? `${dayText(from)}, ${hourText(from)} → ${hourText(to)}` : `${dayText(from)} → ${dayText(to)}`);
export const nyDayOf = (t) => (t ? new Intl.DateTimeFormat("en-CA", { timeZone: NY, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t)) : "");
export const KIND_LABEL = { artist: "Artist", song: "Song", sound: "Sound" };
// r11 (A2): the four colour-coded types (ar-grid.css --type-*). An artist nobody has typed yet is an Artist.
export const TYPES = ["artist", "producer", "song", "sound"];
export const TYPE_LABEL = { artist: "Artist", producer: "Producer", song: "Song", sound: "TikTok sound" };
export const TYPE_PLURAL = { artist: "Artists", producer: "Producers", song: "Songs", sound: "TikTok sounds" };
export const typeOf = (r) => (TYPES.includes(r?.type) ? r.type : r?.kind === "artist" || !r?.kind ? "artist" : r.kind);
export const kindLabel = (r) => `${TYPE_LABEL[typeOf(r)] || r.kind}${r.roster ? " · Roster" : ""}`;
// how long it's tracked: "30d · 12 left" / "Expired · Renew" / "No end date" / "Roster"
export function trackingText(t, entry) {
  const e = entry || t;
  if (!e) return "";
  if (t?.roster) return "Roster";
  if (e.never) return "No end date";
  if (e.state === "expired") return "Expired";
  return `${e.days ? `${e.days}d · ` : ""}${e.daysLeft} left`;
}
export const post = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "defied-site" }, body: JSON.stringify(body) })
  .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok || j.error) throw new Error(j.error || "That didn't save — try again."); return j; });
// one localStorage key per grid (a per-viewer convenience only; it can come back empty)
export const store = {
  get(k, d) { try { const v = window.localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// a mover's words, the same on A&R Home and the Dashboard's This week › A&R (r11 fix): its grey line names the number
// short ("Spotify followers · 5,197 → 5,806"; a rounded reading "TikTok · about 72.1K → 72.0K") and the line under
// the pill counts it ("+609 followers", "≈ −100 followers")
export const UNIT = { listeners: "listeners", streams: "streams", spfollowers: "followers", tiktok: "followers", instagram: "followers", youtube: "subscribers", videos: "videos" };
export const ROW_LABEL = { listeners: "Listeners", streams: "Streams", spfollowers: "Spotify followers", tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", videos: "Sound videos" };
// "72.1K", "1.2M" (one decimal, as TikTok and Instagram round them)
export const k1 = (v) => { const n = Number(v), a = Math.abs(n); return a >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n0(n); };
export const moverSub = (x, label = ROW_LABEL[x.metric] || x.label) => `${label} · ${x.approx ? `about ${k1(x.from)} → ${k1(x.to)}` : `${n0(x.from)} → ${n0(x.to)}`}`;
export const moverAmount = (x) => `${x.approx ? "≈ " : ""}${signed(x.d)} ${UNIT[x.metric] || ""}`.trim();

// A&R Home (r11): Week on week, one metric at a time: readings 7 days apart first; Streams falls back to each row's last real
// Luminate week until then. The groups (one per pair of weeks) are merged into one Up and one Down list.
export function weekLists(wk, n = 5) {
  const by = (a, b) => Math.abs(b.pct) - Math.abs(a.pct) || Math.abs(b.d) - Math.abs(a.d);
  const lum = (k) => (wk.groups || []).flatMap((g) => g[k]).sort(by);
  const up = [...(wk.up || []), ...lum("up")].slice(0, n), down = [...(wk.down || []), ...lum("down")].slice(0, n);
  const pairs = [...new Set([...up, ...down].filter((x) => x.lum).map((x) => x.weeks))];
  return { up, down, pairs, live: [...up, ...down].some((x) => !x.lum) };
}

// r11 fix: the same, as sections that are each ranked on their own: readings 7 days apart first, then one section per
// pair of Luminate weeks, newest first (an old-list row's Oct 16–22 is never ranked against a Trend Report row's
// Oct 23–29). At most n rows per half in all; a section with nothing left in either half is dropped.
export function weekSections(wk, n = 5) {
  const secs = [{ lum: false, weeks: "", up: wk.up || [], down: wk.down || [] }, ...(wk.groups || []).map((g) => ({ lum: true, weeks: g.weeks, up: g.up || [], down: g.down || [] }))];
  const cap = (k) => { let left = n; return secs.map((s) => { const l = s[k].slice(0, Math.max(0, left)); left -= l.length; return l; }); };
  const ups = cap("up"), downs = cap("down");
  return secs.map((s, i) => ({ ...s, up: ups[i], down: downs[i] })).filter((s) => s.up.length || s.down.length);
}
