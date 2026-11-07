// List B #4, the automated numbers: where each number comes from. Pure (no database, no network), shared
// by the server (lib/data/engine.js), the dashboard (Numbers) and the real-data script.
//   SOURCES   one per kind of number: what it measures, how often, its monthly budget, its adapters
//   ADAPTERS  the scraper or API behind a source, all with the same small shape:
//               actor  the Apify actor (none: a free API called directly, lib/data/direct.js)
//               price  USD at the FREE-plan price (Starter is a little lower): { start, per } target
//               input(targets)  the actor's input for [{ ref, url, kind }]
//               parse(items)    [{ key, metric, value, approx?, isrc?, alt?, name?, artist?, image? }]
//             key is the target's ref, lowercased; alt are other ids the answer is known by
// A broken scraper is swapped for another of its source's adapters in Numbers › Sources (data_settings);
// a new one is one more entry here. Sample outputs: S/r8/step0-tech.json (real runs, 2026-11-04).

export const METRIC_LABEL = {
  "spotify:streams": "Spotify streams, global",
  "spotify:monthly_listeners": "Spotify monthly listeners",
  "spotify:followers": "Spotify followers",
  "instagram:followers": "Instagram followers",
  "tiktok:followers": "TikTok followers",
  "tiktok:videos": "TikTok videos with this sound",
  "youtube:subscribers": "YouTube subscribers",
  "youtube:views": "YouTube views, all videos",
};
export const metricLabel = (platform, metric) => METRIC_LABEL[`${platform}:${metric}`] || `${platform} ${metric}`;

export const SCHEDULE_DAYS = { daily: 1, weekly: 7 };

// link = the data_links platform a target needs; kind = the entity kind it applies to
export const SOURCES = {
  spotify_streams: { label: "Spotify streams per song", platform: "spotify", link: "spotify", kind: "track", metrics: ["streams"], schedule: "daily", softCapUsd: 10, adapters: ["eduair94", "beatanalytics"] },
  spotify_listeners: { label: "Spotify monthly listeners", platform: "spotify", link: "spotify", kind: "artist", metrics: ["monthly_listeners", "followers"], schedule: "weekly", softCapUsd: 1, adapters: ["eduair94", "beatanalytics"] },
  instagram: { label: "Instagram followers", platform: "instagram", link: "instagram", kind: "artist", metrics: ["followers"], schedule: "weekly", softCapUsd: 1, adapters: ["apify-instagram"] },
  tiktok: { label: "TikTok followers", platform: "tiktok", link: "tiktok", kind: "artist", metrics: ["followers"], schedule: "weekly", softCapUsd: 1.5, adapters: ["clockworks", "apidojo"] },
  tiktok_sound: { label: "TikTok sound videos", platform: "tiktok", link: "tiktok_sound", kind: "sound", metrics: ["videos"], schedule: "weekly", softCapUsd: 3, adapters: ["khadinakbar", "clockworks-sound"] },
  youtube: { label: "YouTube subscribers and views", platform: "youtube", link: "youtube", kind: "artist", metrics: ["subscribers", "views"], schedule: "daily", softCapUsd: 0, adapters: ["youtube-api"] },
  spotify_catalog: { label: "Spotify catalogs and new releases", platform: "spotify", link: "spotify", kind: "artist", metrics: [], schedule: "daily", softCapUsd: 0, adapters: ["spotify-api"], rosterOnly: true },
};
export const SOURCE_KEYS = Object.keys(SOURCES);
export const TOTAL_CAP_USD = 18; // all sources together, a month (Apify Starter includes $19; owner OK 2026-11-06)
export const MAX_PER_RUN = 500; // targets in one Apify run (330 roster songs today)

// ---- small readers of links
const lc = (s) => String(s ?? "").trim().toLowerCase();
export const spotifyId = (url, type) => {
  const m = new RegExp(`(?:open\\.spotify\\.com/(?:intl-[a-z-]+/)?${type || "(?:track|artist|album)"}/|spotify:${type || "(?:track|artist|album)"}:)([A-Za-z0-9]{22})`).exec(String(url || ""));
  return m ? m[1] : "";
};
export const handleOf = (s, host) => {
  const v = String(s || "").trim();
  if (!v) return "";
  const m = new RegExp(`${host.replace(".", "\\.")}/@?([A-Za-z0-9._-]{1,40})`, "i").exec(v);
  const h = (m ? m[1] : v).replace(/^@/, "").replace(/[/?#].*$/, "");
  return /^[A-Za-z0-9._-]{1,40}$/.test(h) && !/^(p|reel|explore|video|music|tag)$/i.test(h) ? h : "";
};
// YouTube: a channel id (UC…), else the @handle; /user/ and /c/ names are tried as handles
export const youtubeRef = (url) => {
  const v = String(url || "");
  const id = /\/channel\/(UC[A-Za-z0-9_-]{22})/.exec(v);
  if (id) return id[1];
  const h = /youtube\.com\/(?:@|c\/|user\/)([A-Za-z0-9._-]{2,60})/i.exec(v) || /^@([A-Za-z0-9._-]{2,60})$/.exec(v.trim());
  return h ? `@${h[1]}` : "";
};
export const soundId = (url) => {
  const v = String(url || "").trim();
  const m = /tiktok\.com\/music\/[^?#]*?-?(\d{15,22})(?:[/?#]|$)/i.exec(v) || /^(\d{15,22})$/.exec(v);
  return m ? m[1] : "";
};
const num = (v) => { if (v == null || v === "") return null; const n = typeof v === "string" ? Number(v.replace(/[, ]/g, "")) : Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null; };
// Spotify shows no play count under 1,000 plays, and the scrapers report that as 0: no number, not a zero
// (a 0 today and 1,200 tomorrow would look like 1,200 in a day)
const plays = (v) => { const n = num(v); return n > 0 ? n : null; };
const out = (key, metric, value, extra = {}) => (value == null ? [] : [{ key: lc(key), metric, value, ...extra }]);
const spUrl = (t) => `https://open.spotify.com/${t.kind === "artist" ? "artist" : "track"}/${t.ref}`;
const soundUrl = (t) => (/tiktok\.com\/music\//.test(t.url || "") ? t.url : `https://www.tiktok.com/music/x-${t.ref}`);

export const ADAPTERS = {
  // one item per link: a track's playCount (+ ISRC, and the id Spotify relinked it to), an artist's
  // monthly listeners and followers; $0.001 an item
  eduair94: {
    actor: "eduair94/spotify-scraper", price: { start: 0, per: 0.001 },
    input: (ts) => ({ category: "auto", queries: ts.map(spUrl), maxResultsPerQuery: 1, concurrency: 10 }),
    parse: (items) => items.filter((i) => i && i.ok !== false).flatMap((i) => {
      const key = spotifyId(i.query) || i.linkedFromId || i.id;
      const alt = [i.id, i.linkedFromId].filter(Boolean).map(lc);
      if (i.category === "track" || i.type === "track") return out(key, "streams", plays(i.playCount), { isrc: i.isrc || "", alt, image: i.imageUrl || "", releaseDate: i.releaseDate || "" });
      if (i.category === "artist_overview" || i.type === "artist") return [...out(key, "monthly_listeners", num(i.monthlyListeners), { alt, image: i.imageUrl || "", name: i.name || "" }), ...out(key, "followers", num(i.followers), { alt })];
      return [];
    }),
  },
  // the most used one: $0.004 a link; a track's streamCount, an artist's monthlyListeners + followers
  beatanalytics: {
    actor: "beatanalytics/spotify-play-count-scraper", price: { start: 0, per: 0.004 },
    input: (ts) => ({ urls: ts.map((t) => ({ url: spUrl(t) })) }),
    parse: (items) => items.flatMap((i) => {
      const key = spotifyId(i?._url) || i?.id;
      if (!key) return [];
      if (i._type === "track") return out(key, "streams", plays(i.streamCount), { alt: [lc(i.id)] });
      if (i._type === "artist") return [...out(key, "monthly_listeners", num(i.monthlyListeners), { alt: [lc(i.id)], name: i.name || "" }), ...out(key, "followers", num(i.followers), { alt: [lc(i.id)] })];
      return [];
    }),
  },
  // Apify's own Instagram actor: $0.0026 a profile (profilePicUrl is a signed link that expires: not kept)
  "apify-instagram": {
    actor: "apify/instagram-profile-scraper", price: { start: 0, per: 0.0026 },
    input: (ts) => ({ usernames: ts.map((t) => t.ref) }),
    parse: (items) => items.flatMap((i) => out(i?.username || handleOf(i?.inputUrl, "instagram.com"), "followers", num(i?.followersCount), { name: i?.fullName || "" })),
  },
  // $0.0003 a post; the exact follower count rides on every post. maxItems is a total over all the
  // usernames, so 3 posts each. The backup: on the Free plan it stopped at 10 posts (2 of 11 profiles)
  apidojo: {
    actor: "apidojo/tiktok-profile-scraper", price: { start: 0, per: 0.0009 },
    input: (ts) => ({ usernames: ts.map((t) => t.ref), maxItems: ts.length * 3 }),
    parse: (items) => items.flatMap((i) => out(i?.channel?.username || i?.inputSource, "followers", num(i?.channel?.followers))),
  },
  // the default: the most used TikTok actor, one video per profile ($0.003); its follower count can be
  // rounded (72,100 for 72,058), so it's shown as "about"
  clockworks: {
    actor: "clockworks/tiktok-profile-scraper", price: { start: 0, per: 0.003 },
    input: (ts) => ({ profiles: ts.map((t) => t.ref), resultsPerPage: 1, profileScrapeSections: ["videos"], profileSorting: "latest", excludePinnedPosts: false }),
    parse: (items) => items.flatMap((i) => out(i?.authorMeta?.name || i?.input, "followers", num(i?.authorMeta?.fans), { approx: true })),
  },
  // the exact count of videos made with a sound (userCount): $0.003 a sound
  khadinakbar: {
    actor: "khadinakbar/tiktok-sound-scraper", price: { start: 0.00005, per: 0.003 },
    input: (ts) => ({ soundUrls: ts.map(soundUrl), outputMode: "sounds", maxSounds: ts.length, maxVideosPerSound: 1, maxPagesPerSound: 1 }),
    parse: (items) => items.filter((i) => i && (i.recordType || "sound") === "sound").flatMap((i) => out(i.clipId || soundId(i.inputValue), "videos", num(i.userCount), { name: i.title || "", artist: i.author || "", image: i.coverUrl || "" })),
  },
  // backup: the count comes rounded, as a string ("29000" for 29,042): shown as "about"
  "clockworks-sound": {
    actor: "clockworks/tiktok-sound-scraper", price: { start: 0, per: 0.005 },
    input: (ts) => ({ musics: ts.map(soundUrl), resultsPerPage: 1 }),
    parse: (items) => items.flatMap((i) => out(i?.musicMeta?.musicId || soundId(i?.input), "videos", num(i?.searchMusic?.videos), { approx: true, name: i?.musicMeta?.musicName || "", artist: i?.musicMeta?.musicAuthor || "" })),
  },
  // free APIs, called directly (lib/data/direct.js)
  "youtube-api": { actor: "", price: { start: 0, per: 0 } },
  "spotify-api": { actor: "", price: { start: 0, per: 0 } },
};

export const estUsd = (adapter, n) => { const p = ADAPTERS[adapter]?.price || { start: 0, per: 0 }; return n > 0 ? p.start + p.per * n : 0; };
// the most one run may charge (Apify's maxTotalChargeUsd stops it there): half again the estimate, plus a cent
export const runCapUsd = (adapter, n) => Math.round((estUsd(adapter, n) * 1.5 + 0.01) * 1000) / 1000;

// the saved settings over the defaults: { [source]: { adapter, schedule, softCapUsd } }, { totalCapUsd }
export function sourceSettings(saved = {}) {
  const s = saved && typeof saved === "object" ? saved : {};
  const res = {};
  for (const [k, d] of Object.entries(SOURCES)) {
    const o = s[k] && typeof s[k] === "object" ? s[k] : {};
    res[k] = {
      adapter: d.adapters.includes(o.adapter) ? o.adapter : d.adapters[0],
      schedule: SCHEDULE_DAYS[o.schedule] ? o.schedule : d.schedule,
      softCapUsd: Number.isFinite(Number(o.softCapUsd)) && Number(o.softCapUsd) >= 0 && o.softCapUsd !== "" && o.softCapUsd != null ? Math.min(Number(o.softCapUsd), 19) : d.softCapUsd,
    };
  }
  return res;
}

// about what a month of this schedule costs: targets x price x runs a month (campaign ones daily)
export function monthlyEstimate(adapter, schedule, n, campaignN = 0) {
  const runs = 30 / SCHEDULE_DAYS[schedule];
  const regular = Math.max(0, n - campaignN);
  return (regular ? estUsd(adapter, regular) * runs : 0) + (campaignN ? estUsd(adapter, campaignN) * 30 : 0);
}
