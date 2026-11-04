// Add artist from a pasted link (A&R): a Spotify artist link or an Instagram / TikTok profile becomes
// a name, a photo and a genre to fill the form with. Read-only, public pages only, no keys:
//   Spotify  open.spotify.com/artist/<id>: its og tags (name, photo)
//   Instagram instagram.com/<handle>: the handle, and its og title for the name when the page answers
//             (its photo links expire, so none is kept from there)
//   Deezer   the artist's page by that name (the app's name rule; the one with the most fans): photo
//             when Spotify gave none, fans, and the genre most of their albums are filed under
// Whatever a service doesn't answer is just left empty for a person to type. Server-only.
import { metaContent } from "./og";
import { personKey } from "./names";

const DEEZER = "https://api.deezer.com";
const UA = "Mozilla/5.0 (compatible; DefiedSite/1.0)";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;
const NOT_PROFILES = new Set(["p", "reel", "reels", "explore", "stories", "accounts", "tv", "direct"]);

// What a pasted link is, or null. Pure.
export function parseArtistLink(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^(www|m|open)\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  if (host === "spotify.com" || host === "spotify.link") {
    const i = parts.findIndex((p) => p === "artist");
    const id = i >= 0 ? parts[i + 1] : null;
    if (id && /^[A-Za-z0-9]{22}$/.test(id)) return { kind: "spotify", id, url: `https://open.spotify.com/artist/${id}` };
    return parts.includes("track") ? { kind: "spotifyTrack" } : null;
  }
  if (host === "instagram.com" || host === "instagr.am") {
    const h = parts[0];
    if (!h || NOT_PROFILES.has(h.toLowerCase()) || !HANDLE.test(h)) return null;
    return { kind: "instagram", handle: `@${h}`, url: `https://www.instagram.com/${h}/` };
  }
  if (host === "tiktok.com") {
    const h = (parts[0] || "").replace(/^@/, "");
    if (!parts[0]?.startsWith("@") || !HANDLE.test(h)) return null;
    return { kind: "tiktok", handle: `@${h}`, url: `https://www.tiktok.com/@${h}` };
  }
  return null;
}

async function page(url, o) {
  const res = await (o.fetch || fetch)(url, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(o.timeoutMs || 4000) });
  if (!res.ok) throw new Error(`answered ${res.status}`);
  return res.text();
}
async function deezer(path, o) {
  await (o.wait || wait)(120); // Deezer allows 50 calls per 5 seconds
  const res = await (o.fetch || fetch)(`${DEEZER}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(o.timeoutMs || 4000) });
  if (!res.ok) throw new Error(`Deezer answered ${res.status}`);
  const j = await res.json();
  if (j?.error) throw new Error(j.error.message || "Deezer error");
  return j;
}

// "Ziahfyah (@ziahfyah) • Instagram photos and videos" -> "Ziahfyah"
export function instagramName(title, handle) {
  const t = String(title || "").replace(/\s*[•·|-]\s*Instagram.*$/i, "").trim();
  const name = t.replace(/\s*\(@[^)]*\)\s*$/, "").trim();
  return name && name.toLowerCase() !== String(handle || "").replace(/^@/, "").toLowerCase() ? name : "";
}

// The artist's Deezer page by name: { deezerId, fans, picture, url, genre } or null (no page by that name)
export async function deezerArtist(name, o = {}) {
  const key = personKey(name);
  if (!key) return null;
  const r = await deezer(`/search/artist?q=${encodeURIComponent(name)}&limit=10`, o);
  const a = (r.data || []).filter((x) => personKey(x.name) === key).sort((x, y) => (y.nb_fan || 0) - (x.nb_fan || 0))[0];
  if (!a) return null;
  const out = { deezerId: String(a.id), fans: Number.isFinite(a.nb_fan) ? a.nb_fan : null, picture: a.picture_xl || a.picture_big || a.picture_medium || "", url: `https://www.deezer.com/artist/${a.id}`, genre: "" };
  try {
    // the genre most of their albums are filed under (Deezer files each album under one)
    const albums = await deezer(`/artist/${a.id}/albums?limit=25`, o);
    const n = new Map();
    for (const al of albums.data || []) if (Number(al.genre_id) > 0) n.set(al.genre_id, (n.get(al.genre_id) || 0) + 1);
    const top = [...n].sort((x, y) => y[1] - x[1])[0]?.[0];
    if (top) out.genre = String((await deezer(`/genre/${top}`, o)).name || "");
  } catch { /* no genre then */ }
  return out;
}

// The whole lookup. Returns { ok, kind, name, photo, genre, handle, spotify, fans, deezerUrl, missed: [...] }
// (missed = what couldn't be read, in plain words), or { ok: false, error } for a link it can't use.
export async function lookupArtist(link, o = {}) {
  const l = parseArtistLink(link);
  if (!l) return { ok: false, error: "Paste a Spotify artist link or an Instagram or TikTok profile." };
  if (l.kind === "spotifyTrack") return { ok: false, error: "That's a song link. Paste the artist's Spotify page (open it from their name)." };
  const out = { ok: true, kind: l.kind, name: "", photo: "", genre: "", handle: l.handle || "", spotify: l.kind === "spotify" ? l.url : "", fans: null, deezerUrl: "", missed: [] };
  if (l.kind === "spotify") {
    try {
      const html = await page(l.url, o);
      out.name = metaContent(html, "og:title").trim();
      const img = metaContent(html, "og:image");
      if (/^https:\/\//.test(img)) out.photo = img;
      if (!out.name) out.missed.push("Spotify");
    } catch { out.missed.push("Spotify"); }
  } else if (l.kind === "instagram") {
    try { out.name = instagramName(metaContent(await page(l.url, o), "og:title"), l.handle); } catch { /* signed-out pages often don't answer */ }
  }
  if (out.name) {
    try {
      const d = await deezerArtist(out.name, o);
      if (d) Object.assign(out, { fans: d.fans, deezerUrl: d.url, genre: d.genre, photo: out.photo || d.picture });
    } catch { out.missed.push("Deezer"); }
  }
  return out;
}
