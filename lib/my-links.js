// A client's own links (2026-11-11, the owner: "a way for clients to add their own links to their socials as well if
// there isnt one or like swap a pre-existing one"): the four their numbers come from, as the client's profile keeps
// them (Site › Roster): Instagram and TikTok as handles, YouTube and Spotify as links. Pure; POST /api/my-links saves.
// Spotify can be added but not swapped by a client: the songs we track (and pay to read) come from that artist page.
import { parseLink, PLATFORM_LABEL } from "./links/parse";

export const MY_LINKS = ["spotify", "instagram", "tiktok", "youtube"];
const HOW = {
  spotify: "On your Spotify artist page tap ⋯ › Share › Copy link to artist, and paste it here.",
  instagram: "Your Instagram handle, or the link to your profile.",
  tiktok: "Your TikTok handle, or the link to your profile.",
  youtube: "Your channel's link, or its @handle.",
};
export const myLinkHint = (platform) => HOW[platform] || "";
const aOr = (label) => `${/^[AEIOU]/.test(label) ? "an" : "a"} ${label}`;

// text -> { store, url, ref } (store: what goes on the client's profile), { short } (a spotify.link / TikTok short
// link to open first), or { error }
export function myLinkOf(platform, text) {
  const label = PLATFORM_LABEL[platform];
  if (!label) return { error: "That isn't a link we keep." };
  const raw = String(text ?? "").trim();
  if (!raw) return { error: `Paste your ${label} link.` };
  const l = parseLink(raw);
  if (l?.short) return l.platform === platform ? { short: l } : { error: `That's ${aOr(PLATFORM_LABEL[l.platform])} link. Paste your ${label} here.` };
  if (l) {
    if (l.platform !== platform) return { error: `That's ${aOr(PLATFORM_LABEL[l.platform])} link. Paste your ${label} here.` };
    if (l.kind === "song" || l.kind === "album") return { error: `That's a ${l.kind}. ${HOW.spotify}` };
    if (l.kind === "sound" || l.kind === "video" || l.fromVideo) return { error: `That's a ${l.kind === "sound" ? "sound" : "video"}. Paste your ${label} profile${platform === "youtube" ? " (your channel)" : ""} instead.` };
    if (platform === "spotify") return { store: l.url, url: l.url, ref: l.id };
    if (platform === "youtube") return { store: l.url, url: l.url, ref: l.id };
    return { store: l.id, url: l.url, ref: l.id };
  }
  // not a link: a handle ("name", "@name"); Spotify needs its link
  if (/[/:]/.test(raw) || /\.(com|am|be|link)\b/i.test(raw)) return { error: `That isn't ${aOr(label)} profile link. ${HOW[platform]}` };
  if (platform === "spotify") return { error: HOW.spotify };
  const h = raw.replace(/^@/, "");
  if (platform === "youtube") return /^[A-Za-z0-9._-]{2,60}$/.test(h) ? { store: `https://www.youtube.com/@${h}`, url: `https://www.youtube.com/@${h}`, ref: `@${h}` } : { error: `That isn't a YouTube handle. ${HOW.youtube}` };
  if (!/^[A-Za-z0-9._]{1,30}$/.test(h) || /^\.|\.$/.test(h)) return { error: `That isn't ${aOr(label)} handle. ${HOW[platform]}` };
  const ref = h.toLowerCase();
  return { store: ref, url: platform === "instagram" ? `https://www.instagram.com/${ref}/` : `https://www.tiktok.com/@${ref}`, ref };
}
