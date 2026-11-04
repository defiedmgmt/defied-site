import { useState, useEffect } from "react";

/* ------------------------------------------------------------------ */
/*  PUBLIC — shared data helpers                                        */
/* ------------------------------------------------------------------ */
export const PUBLIC_LINKS = [["about", "About"], ["team", "Team"], ["roster", "Roster"], ["contact", "Contact"]];
// next/image `sizes` for roster cards — the artist panel reuses this exact
// string for its first paint so the browser hands back the already-decoded
// grid image (same srcset pick) and the card→panel morph never lands on an
// empty frame while the panel-sized photo is still downloading.
// 3x phones get a ~2x photo: it looks the same at card size for about half the bytes (browsers
// without the resolution query fall through to 46vw).
export const CARD_SIZES = "(max-width: 599px) and (min-resolution: 2.5dppx) 29vw, (max-width: 599px) 46vw, (max-width: 899px) 31vw, (max-width: 1199px) 23vw, 260px";
// localStorage copy of /api/public-data — bump the version whenever that payload's shape changes
export const PUBLIC_CACHE_KEY = "dm-public-data-v2";
// …and how long a saved copy may stand in: past a day a visit waits for the fresh one instead
export const PUBLIC_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
// Saves each good answer as the copy the next visit starts from. An error answer (the API sends 502 JSON
// when the database fails) or an odd one resolves to null and never replaces good data.
export const fetchPublicData = () => fetch("/api/public-data")
  .then((r) => { if (!r.ok) throw new Error(`public-data ${r.status}`); return r.json(); })
  .then((d) => {
    if (!Array.isArray(d?.clients)) throw new Error("public-data: unexpected shape");
    try { localStorage.setItem(PUBLIC_CACHE_KEY, JSON.stringify({ ...d, savedAt: Date.now() })); } catch { /* storage full or blocked */ }
    return d;
  })
  .catch(() => null);
// Requested as soon as this module runs (PageShell's preload has it in flight already), so it lands
// sooner and overwrites the saved copy even if this visit never manages to draw it (PageGuard drops a
// copy a page can't draw).
export const publicDataRequest = typeof window === "undefined" ? null : fetchPublicData();
// how often a tab coming back into view may ask for the site data again
export const PUBLIC_REFRESH_MS = 60 * 1000;

// one rule for "is this the same person" wherever a client/writer/split name is compared (never song
// titles), kept identical to lib/names.js: accents and punctuation drop out and a "!" standing in for
// an i counts as one, so Stack!e, STACK!E and Stackie are "stackie" and Stacke ("stacke") is someone else
export const personKey = (s) => String(s ?? "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase()
  .replace(/(\p{L})!(?=\p{L})/gu, "$1i").replace(/[^\p{L}\p{N}]+/gu, "");
// the entry of `list` that `name` refers to: an exact (case-insensitive) match always wins over a personKey one
export const findByName = (list, name, nameOf = (x) => x.name) => {
  const n = String(name ?? "").trim().toLowerCase(), k = personKey(name);
  return (n && list.find((x) => String(nameOf(x) ?? "").trim().toLowerCase() === n)) || (k && list.find((x) => personKey(nameOf(x)) === k)) || null;
};
// a client's own split on a song (what their own streams/revenue share comes from)
export const ownSplit = (p, client) => (client?.name ? findByName(p?.splits || [], client.name) : null);

// a roster member's ?artist= key: "Stack!e" → stackie, "Beyoncé" → beyonce. Letters and digits of any
// alphabet stay; a name with none (emoji only) falls back to the record's id, so every card opens
const nameKey = (person) => personKey(person?.name) || String(person?.id || "");
export const slugOf = (person) => person?.slug || nameKey(person);
// links shared before the key counted "!" as an i (?artist=stacke) still open the same panel, as long
// as no one's own key is that
const legacyKey = (person) => String(person?.name || "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
export const bySlug = (clients, slug) => (slug ? clients.find((c) => slugOf(c) === slug) || clients.find((c) => legacyKey(c) === slug) || null : null);
// Two names can reduce to the same key ("Stack!e" and "Stackie", or one name typed twice): the first
// on the roster keeps it and the others add their record id, so every card still opens its own panel
export function withSlugs(d) {
  const seen = new Set();
  return {
    ...d,
    clients: d.clients.map((c) => {
      const key = nameKey(c);
      const slug = seen.has(key) ? `${key}-${c.id}` : key;
      seen.add(key);
      return { ...c, slug };
    }),
  };
}
// a card's placeholder letter: the first whole character (an emoji, not half of one), or "?" for no name
export const initialOf = (name) => ([...String(name || "").trim()][0] || "?").toUpperCase();
const splitNames = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
// "Presidential (with Jenn Carter, Kyle Richh, TaTa)" -> "Presidential"
export const cleanTitle = (song) => String(song || "").replace(/\s*[([](?:with|feat\.?|ft\.?)\s[^)\]]*[)\]]/gi, "").trim();
const primaryArtist = (artist) => splitNames(artist)[0] || "";
export const sameName = (a, b) => !!findByName([a], b, (x) => x);

// streaming links are typed in on the dashboard: only ever hand a real web address to an href.
// One pasted without its https:// ("open.spotify.com/artist/…") gets it back; anything else is dropped.
export const webLink = (url) => {
  const u = String(url || "").trim();
  if (/^https?:\/\//i.test(u)) return u;
  return /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#]\S*)?$/i.test(u) ? `https://${u}` : null;
};

export function creditsOf(publicData) {
  const clients = publicData?.clients || [];
  return (publicData?.notableReleases || [])
    .filter((r) => r.song && r.artist)
    .map((r) => ({
      id: r.id, artist: primaryArtist(r.artist), title: cleanTitle(r.song), cover: r.cover, href: webLink(r.link),
      // the roster producers on it, on the same rule as the release cards' "Prod." chips
      prod: rosterCreditsOn(r, clients).filter((c) => c.prod).map((c) => c.name),
    }));
}
// what a screen reader hears for one credit: "Q&A by Drake, produced by Stack!e"
export const creditText = (c) => `${c.title} by ${c.artist}${c.prod.length ? `, produced by ${c.prod.join(" and ")}` : ""}`;

// Spotify serves every cover at 640/300/64px under the same id. The credit strips show it small and
// lift it on hover, so they get the 64px and 300px files. A dashboard upload (data:) is already in the
// page data, so it shows as it is; other hosts get no cover rather than a full-size download.
const coverSet = (url) => /^https:\/\/i\.scdn\.co\/image\/ab67616d0000b273/.test(url || "")
  ? `${url.replace("ab67616d0000b273", "ab67616d00004851")} 64w, ${url.replace("ab67616d0000b273", "ab67616d00001e02")} 300w` : null;

// One placement, credited the way a tracklist would: the cover, the artist, then the song in quotes
// and the roster producer. `sizes` is the cover's size at rest, `lift` its size once it lifts on hover.
export function Credit({ c, sizes, lift }) {
  const set = coverSet(c.cover);
  const upload = !set && /^data:image\//i.test(c.cover || "");
  // "Prod. prodbylandn" says prod twice: names that already start with it stand alone
  const prodWord = c.prod.every((n) => /^prod/i.test(n)) ? "" : "Prod. ";
  return (
    <>
      {(set || upload) && (
        <span className="cr-cov">
          {set
            ? <img srcSet={set} sizes={sizes} data-lift={lift} alt="" width="64" height="64" decoding="async" draggable={false} />
            : <img src={c.cover} alt="" width="64" height="64" decoding="async" draggable={false} />}
        </span>
      )}
      <span className="cr-txt">
        <b className="cr-artist"><Glyphs text={c.artist} amp /></b>
        <span className="cr-sub">
          <span className="cr-song">“<Glyphs text={c.title} amp />”</span>
          {c.prod.length > 0 && <span className="cr-prod">{prodWord}<Glyphs text={c.prod.join(" & ")} amp /></span>}
        </span>
      </span>
    </>
  );
}

// The Home band's headline numbers. Written here rather than on the dashboard, so they only change with
// a deploy: every one is checked against its source (in the comment beside it) before it goes in.
export const STATS = [
  // Billboard 200 dated May 30, 2026: MAID OF HONOUR debuted at No. 3 (ICEMAN 1, HABIBTI 2); Stack!e is one of
  // the credited producers on "Q&A" (ca.billboard.com chart-beat; Wikipedia, Maid of Honour track listing)
  { num: "#3", label: "Billboard 200", ctx: "Drake “Q&A” · Prod. Stack!e", text: "Number 3 on the Billboard 200: Drake's Maid of Honour, with Q&A produced by Stack!e" },
  // the roster PDF (2026): the producers' stream totals added up
  { num: "150M+", label: "Streams", ctx: "Across the roster", text: "Over 150 million streams across the roster" },
  // Billboard, chart dated June 28, 2025: No. 1 Top Rap Albums and Top R&B/Hip-Hop Albums (No. 3 on the Billboard 200)
  { num: "#1", label: "Top Rap Albums", ctx: "Lil Tecca “Dopamine”", text: "Number 1 on Billboard's Top Rap Albums: Dopamine by Lil Tecca" },
  // the roster PDF (2026): 122 placements across the ten producers listed, before songs two of them share
  { num: "100+", label: "Placements", ctx: "And counting", text: "Over 100 placements and counting" },
];
// One headline number, set like a credit: the figure in chrome, then what it is and where it's from as a two-line caption
export function Stat({ s }) {
  return (
    <span className="st">
      <b className="st-num">{s.num}</b>
      <span className="st-cap">
        <span className="st-label"><Glyphs text={s.label} amp /></span>
        <span className="st-ctx"><Glyphs text={s.ctx} amp /></span>
      </span>
    </span>
  );
}

// Emoji (keycaps, flags, pictographs, skin-tone and ZWJ sequences) get a span of their own: inside
// chrome text (a gradient clipped to transparent glyphs) a colour emoji would paint as a blank silver tile
// (built at runtime so a browser without \p{…} support gets plain text instead of a dead page)
const EMOJI_SEQ = (() => {
  try {
    return new RegExp("([#*\\d]\uFE0F?\u20E3|\\p{Regional_Indicator}{2}|(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\uFE0F)\\p{Emoji_Modifier}?(?:\u200D(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\uFE0F?)\\p{Emoji_Modifier}?)*)", "u");
  } catch { return /(?!)/; }
})();
// `amp`: Suntage's "&" reads as an 8 ("Q8A"), so in the credit strips it's set in the body face instead
export function Glyphs({ text, amp = false }) {
  const parts = String(text ?? "").split(EMOJI_SEQ);
  const plain = (part, k) => (amp && part.includes("&")
    ? part.split("&").flatMap((bit, j) => (j ? [<span className="amp" key={`${k}-${j}`}>&</span>, bit] : [bit]))
    : part);
  if (parts.length === 1) return plain(parts[0], 0);
  return parts.map((part, k) => (k % 2 ? <span className="emo" key={k}>{part}</span> : plain(part, k)));
}
// the same, for text written straight into the DOM (the decoded panel name)
export function glyphNodes(text) {
  return String(text).split(EMOJI_SEQ).map((part, k) => {
    if (!(k % 2)) return part;
    const s = document.createElement("span");
    s.className = "emo";
    s.textContent = part;
    return s;
  });
}

// roster members credited on a release. "Prod." only when the data actually
// supports it: they're a Producer on the roster AND not a listed artist on
// the song — otherwise just their name, never a guessed role.
export function rosterCreditsOn(release, clients) {
  return splitNames(release.client).map((name) => {
    const c = findByName(clients, name);
    const onArtist = splitNames(release.artist).some((a) => sameName(a, name));
    return { name, prod: !!c && /producer/i.test(c.role || "") && !onArtist };
  });
}

export const isProducer = (c) => /producer/i.test(c.role || "");
export const isArtist = (c) => /artist/i.test(c.role || "");

// tiny app-wide toast — fired from anywhere with toast("COPIED"), rendered once by <Toast/>
export const toast = (text) => window.dispatchEvent(new CustomEvent("dm-toast", { detail: text }));
export function Toast() {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    let t;
    const on = (e) => { setMsg({ text: e.detail, k: Date.now() }); clearTimeout(t); t = setTimeout(() => setMsg(null), 1700); };
    window.addEventListener("dm-toast", on);
    return () => { window.removeEventListener("dm-toast", on); clearTimeout(t); };
  }, []);
  return (
    <div className="toast-wrap" aria-live="polite">
      {msg && <div className="toast" key={msg.k}>{msg.text}</div>}
    </div>
  );
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand("copy"); } catch { /* ignore */ }
    ta.remove();
    return true;
  }
}

export const XIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77L17.75 3zm-1.08 16.17h1.7L7.4 4.73H5.58l11.09 14.44z" />
  </svg>
);
