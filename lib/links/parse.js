// List B #7, the "paste a link" box: what a pasted link is. Pure (no network, no database), shared by the
// server (lib/links/resolve.js) and the box itself (components/LinkBox.jsx shows "Spotify song" while it
// looks the link up).
//   parseLink(text) -> { platform, kind, id, url, key, short? } or null
//     platform  spotify | tiktok | instagram | youtube
//     kind      song | artist | sound | profile | channel | video
//     id        Spotify id, TikTok clip id, a handle (no @), a YouTube channel id (UC…), @handle or video id
//     url       the link written the one way we store it
//     key       platform:kind:id (lowercased): the cache key, and how "already tracked" is matched
//     short     a short link (spotify.link, vm.tiktok.com, youtu.be is not one) that has to be opened first
//     fromVideo a TikTok video link: its maker's profile (the box says to open the video's sound for the sound)

const HANDLE = /^[A-Za-z0-9._]{1,30}$/;
const IG_NOT_PROFILES = new Set(["p", "reel", "reels", "explore", "stories", "accounts", "tv", "direct", "about", "developer", "legal"]);
const YT_NOT_HANDLES = new Set(["watch", "shorts", "playlist", "results", "feed", "channel", "c", "user", "embed", "live"]);

export const PLATFORM_LABEL = { spotify: "Spotify", tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" };
export const KIND_LABEL = {
  "spotify:song": "Spotify song", "spotify:artist": "Spotify artist", "tiktok:sound": "TikTok sound", "tiktok:profile": "TikTok profile",
  "instagram:profile": "Instagram profile", "youtube:channel": "YouTube channel", "youtube:video": "YouTube video",
};
export const kindLabel = (l) => KIND_LABEL[`${l?.platform}:${l?.kind}`] || "Link";
// Which kinds of link each box takes (a song form takes songs; the roster takes people)
export const PERSON_KINDS = ["artist", "profile", "channel"];
// r11: a TikTok video (pasted, or where a short link went): the sound is the sound link's job
export const VIDEO_NOTE = "That's a TikTok video. Open its sound and copy the sound's link.";

const mk = (platform, kind, id, url, extra = {}) => ({ platform, kind, id, url, key: `${platform}:${kind}:${String(id).toLowerCase()}`, ...extra });

export function parseLink(text) {
  const raw = String(text ?? "").trim().replace(/^<|>$/g, "");
  if (!raw) return null;
  // spotify:track:… URIs and a bare @handle are not URLs
  const uri = /^spotify:(track|artist):([A-Za-z0-9]{22})$/.exec(raw);
  if (uri) return uri[1] === "track" ? mk("spotify", "song", uri[2], `https://open.spotify.com/track/${uri[2]}`) : mk("spotify", "artist", uri[2], `https://open.spotify.com/artist/${uri[2]}`);
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^(www|m|open|music|vm|vt)\./, (m) => (m === "vm." || m === "vt." ? m : ""));
  const parts = u.pathname.split("/").filter(Boolean);

  if (host === "spotify.com") {
    const p = parts[0]?.startsWith("intl-") ? parts.slice(1) : parts;
    const id = /^[A-Za-z0-9]{22}$/.test(p[1] || "") ? p[1] : "";
    if (p[0] === "track" && id) return mk("spotify", "song", id, `https://open.spotify.com/track/${id}`);
    if (p[0] === "artist" && id) return mk("spotify", "artist", id, `https://open.spotify.com/artist/${id}`);
    if (p[0] === "album" && id) return { platform: "spotify", kind: "album", id, url: `https://open.spotify.com/album/${id}`, key: `spotify:album:${id.toLowerCase()}` };
    return null;
  }
  if (host === "spotify.link" && parts[0]) return { platform: "spotify", kind: "short", id: parts[0], url: `https://spotify.link/${parts[0]}`, key: `spotify:short:${parts[0]}`, short: true };

  if (host === "vm.tiktok.com" || host === "vt.tiktok.com" || (host === "tiktok.com" && parts[0] === "t")) {
    const code = host === "tiktok.com" ? parts[1] : parts[0];
    // (r11) opened exactly as TikTok shares it: with its trailing slash when it had one (the owner's .../t/ZP9…/)
    const slash = u.pathname.endsWith(`${code}/`) ? "/" : "";
    return code ? { platform: "tiktok", kind: "short", id: code, url: `https://${host === "tiktok.com" ? "www.tiktok.com/t" : host}/${code}${slash}`, key: `tiktok:short:${code}`, short: true } : null;
  }
  if (host === "tiktok.com") {
    if (parts[0] === "music") {
      // /music/<title>-<id> (any query after it, e.g. a share link's ?_d=…&share_music_id=<id>, is dropped); a
      // /music/<title> without the id takes share_music_id
      const m = /(\d{15,22})$/.exec(parts[1] || "");
      if (m) return mk("tiktok", "sound", m[1], `https://www.tiktok.com/music/${parts[1]}`);
      const sid = /^\d{15,22}$/.test(u.searchParams.get("share_music_id") || "") ? u.searchParams.get("share_music_id") : "";
      return sid && parts[1] ? mk("tiktok", "sound", sid, `https://www.tiktok.com/music/${parts[1]}-${sid}`) : null;
    }
    const h = (parts[0] || "").replace(/^@/, "");
    if (!parts[0]?.startsWith("@") || !HANDLE.test(h)) return null;
    // a video link: its maker's profile (the sound on it is the sound link's job)
    return mk("tiktok", "profile", h.toLowerCase(), `https://www.tiktok.com/@${h.toLowerCase()}`, parts[1] === "video" ? { fromVideo: true } : {});
  }

  if (host === "instagram.com" || host === "instagr.am") {
    const h = parts[0];
    if (!h || IG_NOT_PROFILES.has(h.toLowerCase()) || !HANDLE.test(h)) return null;
    return mk("instagram", "profile", h.toLowerCase(), `https://www.instagram.com/${h.toLowerCase()}/`);
  }

  if (host === "youtu.be") {
    const id = /^[A-Za-z0-9_-]{11}$/.test(parts[0] || "") ? parts[0] : "";
    return id ? mk("youtube", "video", id, `https://www.youtube.com/watch?v=${id}`) : null;
  }
  if (host === "youtube.com") {
    const v = u.searchParams.get("v");
    if (parts[0] === "watch" && /^[A-Za-z0-9_-]{11}$/.test(v || "")) return mk("youtube", "video", v, `https://www.youtube.com/watch?v=${v}`);
    if ((parts[0] === "shorts" || parts[0] === "live" || parts[0] === "embed") && /^[A-Za-z0-9_-]{11}$/.test(parts[1] || "")) return mk("youtube", "video", parts[1], `https://www.youtube.com/watch?v=${parts[1]}`);
    if (parts[0] === "channel" && /^UC[A-Za-z0-9_-]{22}$/.test(parts[1] || "")) return { ...mk("youtube", "channel", parts[1], `https://www.youtube.com/channel/${parts[1]}`), key: `youtube:channel:${parts[1]}` };
    const h = parts[0]?.startsWith("@") ? parts[0].slice(1) : (parts[0] === "c" || parts[0] === "user") ? parts[1] : "";
    if (h && /^[A-Za-z0-9._-]{2,60}$/.test(h) && !YT_NOT_HANDLES.has(h.toLowerCase())) return mk("youtube", "channel", `@${h}`, `https://www.youtube.com/@${h}`);
    return null;
  }
  return null;
}

// What a box with `kinds` (["song"], PERSON_KINDS, …) says to a link it doesn't take, or "" when it takes it
export function wrongKind(l, kinds) {
  if (!l || !kinds?.length || kinds.includes(l.kind)) return "";
  if (l.platform === "tiktok" && l.fromVideo) return VIDEO_NOTE;
  if (kinds.includes("song") && !kinds.includes("artist")) return l.platform === "spotify" && l.kind === "artist" ? "That's an artist link. Paste the song's Spotify link." : "Paste a Spotify song link here.";
  if (kinds.includes("sound")) return "Paste a TikTok sound link (tiktok.com/music/…).";
  if (l.kind === "song") return "That's a song link. Paste the artist's Spotify page, or their Instagram, TikTok or YouTube.";
  if (l.kind === "sound") return "That's a TikTok sound. Paste the artist's profile here.";
  if (l.kind === "video") return "That's a video. Paste the artist's YouTube channel here.";
  if (l.kind === "album") return "That's an album. Paste the artist's Spotify page.";
  return "That link can't be added here.";
}

// A handle written the way the roster stores it (Site › Roster keeps full links)
export const profileUrl = (platform, handle) => {
  const h = String(handle || "").replace(/^@/, "");
  if (!h) return "";
  if (platform === "instagram") return `https://www.instagram.com/${h}/`;
  if (platform === "tiktok") return `https://www.tiktok.com/@${h}`;
  if (platform === "youtube") return /^UC[A-Za-z0-9_-]{22}$/.test(h) ? `https://www.youtube.com/channel/${h}` : `https://www.youtube.com/@${h}`;
  if (platform === "spotify") return `https://open.spotify.com/artist/${h}`;
  return "";
};

// Handles written in a bio or a description ("IG: stackkie", "Instagram: Stackkie", "ig-Ohitzyakk",
// links to instagram.com / tiktok.com / youtube.com / open.spotify.com). Returns parsed links.
export function linksInText(text) {
  const t = String(text || "");
  const out = [];
  const seen = new Set();
  const add = (l, why) => { if (l && !seen.has(l.key)) { seen.add(l.key); out.push({ ...l, why }); } };
  for (const m of t.matchAll(/(?:https?:\/\/)?(?:www\.)?(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?artist\/[A-Za-z0-9]{22}|instagram\.com\/[A-Za-z0-9._]{1,30}|tiktok\.com\/@[A-Za-z0-9._]{1,30}|youtube\.com\/(?:@[A-Za-z0-9._-]{2,60}|channel\/UC[A-Za-z0-9_-]{22}))/gi)) add(parseLink(m[0]), "link");
  for (const m of t.matchAll(/\b(?:ig|insta(?:gram)?)\s*[:\-–=]\s*@?([A-Za-z0-9._]{2,30})/gi)) add(parseLink(`instagram.com/${m[1].replace(/\.$/, "")}`), "bio");
  for (const m of t.matchAll(/\b(?:tt|tik ?tok)\s*[:\-–=]\s*@?([A-Za-z0-9._]{2,30})/gi)) add(parseLink(`tiktok.com/@${m[1].replace(/\.$/, "")}`), "bio");
  for (const m of t.matchAll(/\b(?:yt|youtube)\s*[:\-–=]\s*@([A-Za-z0-9._-]{2,60})/gi)) add(parseLink(`youtube.com/@${m[1].replace(/\.$/, "")}`), "bio");
  return out;
}
