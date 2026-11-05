// A&R lists (r10): the ONLY way to add, the same at the top of Team, Mine, Watchlist and Sounds. It wraps the shared
// paste box (components/LinkBox.jsx, listMode): paste a Spotify artist or song, a TikTok sound or profile, an
// Instagram profile, or a YouTube channel or video (a video becomes its channel's artist) -> a card at once from the
// free lookups -> one tap on "Add to my list" (30 / 60 / 90 days). Already yours: Open it. Someone else's: Add my
// name too (the same row). The confirmed other profiles are saved on the row, so their followers get tracked too.
// POST /api/ar-trackers {action: "add"}. A TikTok sound always lands in Sounds, whichever list it was pasted in.
import React, { useState } from "react";
import LinkBox from "../LinkBox";
import { post } from "./fmt";

// what a pasted link adds (the paste box's result: { link, card, links, already, days })
export function addBody(r) {
  const l = r?.link || {}, c = r?.card || {}, links = r?.links || {};
  const socials = { instagram: links.instagram || "", tiktok: links.tiktok || "", youtube: links.youtube || "" };
  if (l.platform === "tiktok" && l.kind === "sound") return { kind: "sound", url: l.url, clip: l.id, name: c.nameFrom === "link" ? "" : c.name || "", artist: c.artist || "" };
  if (l.platform === "spotify" && l.kind === "song") return { kind: "song", spotify: l.url, name: c.name || "", artist: c.artist || "", image: c.image || c.photo || "", isrc: c.isrc || "" };
  if (l.platform === "spotify" && l.kind === "artist") return { kind: "artist", spotify: l.url, name: c.name || "", image: c.photo || c.image || "", links: socials };
  if (l.platform === "youtube" && l.kind === "video") return { kind: "artist", name: c.artist || c.name || "", spotify: links.spotify || "", image: "", links: { ...socials, youtube: links.youtube || (c.channelId ? `https://www.youtube.com/channel/${c.channelId}` : "") } };
  // an Instagram / TikTok / YouTube profile: the artist by name, with that profile (and their Spotify, when confirmed)
  return { kind: "artist", name: String(c.name || "").replace(/^@/, ""), spotify: links.spotify || "", image: c.photo || "", links: socials };
}

export function ArPasteBar({ view, onAdded, onOpen }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const add = async (r) => {
    const body = addBody(r);
    setBusy(true); setMsg(null);
    try {
      const res = await post("/api/ar-trackers", { action: "add", days: r.days ?? 30, ...body });
      const name = body.name || r.card?.name || "it";
      const other = (r.already || []).find((a) => a.state === "other");
      const text = body.kind === "sound" && view !== "sounds" ? `Added to Sounds: ${name}${r.days ? ` · ${r.days} days` : ""}`
        : res.already ? `${name} is already on your list.`
        : other ? `Added your name to ${name} (with ${other.who})${r.days ? ` · ${r.days} days` : ""}`
        : `Added ${name} to your list${r.days ? ` · ${r.days} days` : " · Roster, never expires"}${res.restored ? ". Its earlier numbers are back." : ""}`;
      setMsg({ ok: true, text });
      onAdded?.(res, body);
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    setBusy(false);
  };
  return (
    <div className="ar-paste" data-ar-paste={view}>
      <LinkBox context={view === "sounds" ? "sounds" : "tracker"} listMode onAdd={add} busy={busy}
        kinds={view === "sounds" ? ["sound"] : ["artist", "profile", "channel", "video", "song", "sound"]}
        placeholder={view === "sounds" ? "Paste a TikTok sound link to track it" : "Paste a Spotify, TikTok, Instagram or YouTube link"}
        onOpen={(a) => onOpen?.(a.key || a.itemId)} />
      {msg && <p className={`ar-toast ${msg.ok ? "ok" : "err"}`} role="status" data-ar-toast>{msg.text}</p>}
    </div>
  );
}
