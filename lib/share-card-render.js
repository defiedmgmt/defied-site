// The share card's picture (2026-11-13, the owner: "a cool image that they can save w like defied logo and branding and
// colors and shit w all their total streams (gross) and like their biggest songs and stuff and those songs streams").
// 2026-11-14, the owner: "make the export post screen look cooler maybe add images of the song or something": each top
// song's cover art sits in its row, and the biggest song's cover, blurred and darkened, is the card's backdrop.
// Draws a client's stats (lib/share-card.js shareStats) as a PNG with next/og (Satori + resvg, in Node). Nothing here
// reads a database or the network: GET /api/share-card and scripts/render-share-card.mjs both call it. Imports only
// packages and node: built-ins, so plain node can load it (the script does).
//
//   cardElement(stats, format, assets)  the card as React elements (pure). A song's cover is a PNG or JPEG data: URI
//                                       (lib/share-card.js loadCovers makes them); without one the song gets the D mark
//                                       on a dark tile, never another picture
//   cardText(stats, assets)             what the card says, cleaned for its fonts: the name (or why it can't be drawn)
//                                       and the songs it can draw (a title in an alphabet the fonts lack is left off),
//                                       each with the cover it came with
//   renderCardPng(stats, format, opts)  the PNG's bytes (a picture Satori can't decode is left out, not the whole card)
//   loadAssets(root)                    the fonts and brand images, read once from disk (root/public, as on Vercel:
//                                       next.config.js traces these files into /api/share-card's function)
//   cleanText / fitText / fitSize /     the text rules: every character drawn is one the font has (an emoji, a
//   fitName / fitTitle / fitTitles /    script the fonts don't cover, a control character is dropped or swapped for
//   drawable                            its plain letter); a name or title too long gets smaller, then two lines, and
//                                       only then ends in "…"; one that loses most of its letters isn't drawn at all;
//                                       the song titles of one card all share one size (fitTitles)
import fs from "node:fs";
import path from "node:path";
import { createElement as h } from "react";
// "next/og.js", not "next/og": Next 14 has no exports map, so plain node (the script) needs the file name; webpack takes either
import * as og from "next/og.js";

export const FORMATS = {
  story: { width: 1080, height: 1920 },
  post: { width: 1080, height: 1350 },
};
export const formatOf = (f) => (Object.hasOwn(FORMATS, String(f || "")) ? String(f) : "story");

// The dashboard's own tokens (styles/app.css: .app:not(.pub) and the public site's chrome)
const C = {
  bg: "#000000", s1: "#0b0b0c", s2: "#111113", line: "#1c1c1e", line2: "#2a2a2c", line3: "#3a3a3c",
  ink: "#f5f5f5", ink2: "#d4d4d6", ink3: "#a3a3a3", ink4: "#8a8a8a", off: "#5f5f61",
  chrome: "linear-gradient(180deg,#ffffff 0%,#ececec 36%,#8f8f8f 50%,#f6f6f6 63%,#c4c4c4 100%)",
  chromeBorder: "linear-gradient(135deg,#fafafa,#6b6b6b 30%,#e9e9e9 50%,#4a4a4a 70%,#d8d8d8)",
};

// ---- fonts: which characters each one has, and how wide a line is ------------------------------------------------
// Reads the font's own tables (cmap, hmtx, hhea, head). Widths leave out kerning, so callers keep a little slack.
export function fontInfo(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tables = {};
  for (let i = 0, n = dv.getUint16(4); i < n; i++) {
    const o = 12 + i * 16;
    tables[String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3))] = dv.getUint32(o + 8);
  }
  const upem = dv.getUint16(tables.head + 18) || 1000;
  const numH = dv.getUint16(tables.hhea + 34);
  const glyphs = new Map();
  const cmap = tables.cmap;
  for (let i = 0, n = dv.getUint16(cmap + 2); i < n; i++) {
    const off = cmap + dv.getUint32(cmap + 4 + i * 8 + 4), fmt = dv.getUint16(off);
    if (fmt === 4) {
      const seg2 = dv.getUint16(off + 6), ends = off + 14, starts = ends + seg2 + 2, deltas = starts + seg2, ranges = deltas + seg2;
      for (let s = 0; s < seg2 / 2; s++) {
        const end = dv.getUint16(ends + s * 2), start = dv.getUint16(starts + s * 2), delta = dv.getInt16(deltas + s * 2), ro = dv.getUint16(ranges + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let g;
          if (!ro) g = (c + delta) & 0xffff;
          else { g = dv.getUint16(ranges + s * 2 + ro + (c - start) * 2); if (g) g = (g + delta) & 0xffff; }
          if (g && !glyphs.has(c)) glyphs.set(c, g);
        }
      }
    } else if (fmt === 12) {
      for (let k = 0, groups = dv.getUint32(off + 12); k < groups; k++) {
        const b = off + 16 + k * 12, start = dv.getUint32(b), end = dv.getUint32(b + 4), g0 = dv.getUint32(b + 8);
        for (let c = start; c <= end; c++) if (g0 + (c - start) && !glyphs.has(c)) glyphs.set(c, g0 + (c - start));
      }
    }
  }
  const advance = (g) => dv.getUint16(tables.hmtx + 4 * Math.min(g, numH - 1));
  const CONTROL = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/u;
  return {
    // a character this font really draws (a control or format character never counts, even with a cmap entry)
    has: (ch) => ch === " " || (!CONTROL.test(ch) && glyphs.has(ch.codePointAt(0))),
    // the line's width in px at `size`, letterSpacing (px) after each character as CSS adds it
    width(text, size, letterSpacing = 0) {
      let units = 0, count = 0;
      for (const ch of String(text)) { const g = glyphs.get(ch.codePointAt(0)); units += g ? advance(g) : upem * 0.6; count++; }
      return (units / upem) * size + count * letterSpacing;
    },
  };
}

// ---- text rules ----------------------------------------------------------------------------------------------------
// a character a font lacks, as the plain one it stands for (curly quotes, dashes, odd spaces, a few letters that don't
// decompose); anything else missing goes through NFKD with its accents taken off, or is dropped
const SUBS = {
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-", "−": "-",
  "‘": "'", "’": "'", "‚": ",", "‛": "'", "“": "\"", "”": "\"", "„": "\"", "′": "'", "″": "\"",
  "…": "...", "•": "·",
  "Ł": "L", "ł": "l", "Đ": "D", "đ": "d", "ı": "i", "Ø": "O", "ø": "o", "Æ": "AE", "æ": "ae",
  "Œ": "OE", "œ": "oe", "ß": "ss", "Þ": "Th", "þ": "th", "Ð": "D", "ð": "d",
};
// Every character of `s` that `font` draws; the rest swapped or dropped. Spaces collapse, ends trimmed.
export function cleanText(s, font) {
  let out = "";
  for (const ch of String(s ?? "").normalize("NFC")) {
    if (/\s/u.test(ch)) { out += " "; continue; }
    if (font.has(ch)) { out += ch; continue; }
    const sub = SUBS[ch];
    if (sub && [...sub].every((c) => font.has(c))) { out += sub; continue; }
    const plain = ch.normalize("NFKD").replace(/\p{M}+/gu, "");
    if (plain && plain !== ch && [...plain].every((c) => font.has(c))) out += plain;
  }
  return out.replace(/\s+/g, " ").trim();
}

// `text` as it fits in maxWidth px: whole, or cut at a character and ended with "…"
export function fitText(text, font, size, maxWidth, letterSpacing = 0) {
  const t = String(text ?? "");
  if (font.width(t, size, letterSpacing) <= maxWidth) return t;
  const chars = [...t];
  let lo = 0, hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (font.width(chars.slice(0, mid).join("").trimEnd() + "…", size, letterSpacing) <= maxWidth) lo = mid; else hi = mid - 1;
  }
  return chars.slice(0, lo).join("").trimEnd() + "…";
}

// The biggest size from max down to min (2 px steps) at which `text` fits; at min it's cut with "…".
// ls: letter-spacing as a share of the size (em). { size, text }
export function fitSize(text, font, { max, min, width, ls = 0 }) {
  for (let size = max; size >= min; size -= 2) if (font.width(text, size, size * ls) <= width) return { size, text };
  return { size: min, text: fitText(text, font, min, width, min * ls) };
}

// A name: one line as big as it fits down to halfway between max and min; then two lines, split between words where
// the longer line is shortest, down to min; past that the lines are filled word by word and the last ends in "…".
// { size, lines }
export function fitName(text, font, { max, min, width, ls = 0 }) {
  const t = String(text ?? "");
  const w = (s, size) => font.width(s, size, size * ls);
  const mid = Math.max(min, Math.round((max + min) / 4) * 2);
  for (let size = max; size >= mid; size -= 2) if (w(t, size) <= width) return { size, lines: [t] };
  const words = t.split(" ");
  if (words.length < 2) {
    for (let size = mid; size >= min; size -= 2) if (w(t, size) <= width) return { size, lines: [t] };
    return { size: min, lines: [fitText(t, font, min, width, min * ls)] };
  }
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" "), longest = Math.max(w(a, 1), w(b, 1));
    if (!best || longest < best.longest) best = { a, b, longest };
  }
  for (let size = mid; size >= min; size -= 2) if (Math.max(w(best.a, size), w(best.b, size)) <= width) return { size, lines: [best.a, best.b] };
  let i = 1;
  while (i < words.length - 1 && w(words.slice(0, i + 1).join(" "), min) <= width) i++;
  return { size: min, lines: [fitText(words.slice(0, i).join(" "), font, min, width, min * ls), fitText(words.slice(i).join(" "), font, min, width, min * ls)] };
}

// A song title in its row: one line as big as it fits from max down to min; then two lines, as big as both fit whole
// from max2 (the biggest two lines the row has room for; max when not given) down to min, the first line taking as many
// words as fit; past that two lines at min, the second ending in "…". So a featured artist ("Sprinter (feat. Central
// Cee)") goes onto the second line instead of being cut off. { size, lines }
export function fitTitle(text, font, { max, min, width, max2 = max }) {
  const t = String(text ?? "");
  for (let size = max; size >= min; size--) if (font.width(t, size) <= width) return { size, lines: [t] };
  const words = t.split(" ");
  const firstLine = (size) => { let i = 0; while (i < words.length && font.width(words.slice(0, i + 1).join(" "), size) <= width) i++; return i; };
  for (let size = Math.min(max, max2); size >= min; size--) {
    const i = firstLine(size);
    if (i > 0 && i < words.length && font.width(words.slice(i).join(" "), size) <= width) return { size, lines: [words.slice(0, i).join(" "), words.slice(i).join(" ")] };
  }
  const i = firstLine(min);
  if (i > 0) return { size: min, lines: [words.slice(0, i).join(" "), fitText(words.slice(i).join(" "), font, min, width)] };
  // a first word longer than the whole line: broken where the line ends
  const chars = [...t];
  let k = 0;
  while (k < chars.length - 1 && font.width(chars.slice(0, k + 1).join(""), min) <= width) k++;
  return { size: min, lines: [chars.slice(0, k).join(""), fitText(chars.slice(k).join("").trimStart(), font, min, width)] };
}

// The song titles of one card, all at ONE size (2026-11-13, on a real card: short titles big, two shrunk to fit a line,
// which read as uneven). The size is the biggest at which every title fits as fitTitle fits it on its own: the smallest
// of the sizes fitTitle gives them, so a title that fits one line at 35 holds every other title at 35 or under, and one
// that only fits on two lines holds nobody down. Each is then set at that size by the same rules (fitTitle with max,
// max2 and min all that size): one line when it fits there, two lines when it still needs them, and "…" only when even
// the smallest size can't show it whole (that title then holds the whole card at min). Same options as fitTitle.
// [{ size, lines }] in the order given, every size the same
export function fitTitles(titles, font, opts) {
  const alone = titles.map((t) => fitTitle(t, font, opts));
  const size = alone.length ? Math.min(...alone.map((f) => f.size)) : opts.max;
  return titles.map((t) => fitTitle(t, font, { ...opts, max: size, max2: size, min: size }));
}

// Can the card say this? cleanText keeps only what the fonts draw. When that drops more than half the letters (a name or
// title in Japanese, Korean, Cyrillic, Greek… which the card's fonts don't have), what's left would read as a different
// name, so it isn't drawn at all: never a made-up "Untitled", never half a name. text: as stored; clean: cleanText's
const letters = (s) => (String(s ?? "").match(/[\p{L}\p{N}]/gu) || []).length;
export const drawable = (text, clean) => !!clean && letters(clean) * 2 >= letters(text);

// What the card says, cleaned for its fonts (stats as cardElement takes them):
//   name       the name to draw, or null
//   nameIssue  null; "blank" (no name); "letters" (in letters the fonts don't have). GET /api/share-card answers either
//              with a short line instead of sending out a card with no name on it
//   songs      [{ title, streams }]: the top songs it can draw, biggest first
//   leftOff    how many of the top songs were left off because their titles can't be drawn (the total still has them)
export function cardText(stats, assets = loadAssets()) {
  const raw = String(stats?.name ?? "").trim();
  const name = cleanText(raw, assets.display);
  const nameIssue = !raw ? "blank" : drawable(raw, name) ? null : "letters";
  const top = (stats?.songs || []).slice(0, 5);
  const songs = [];
  for (const s of top) {
    const title = cleanText(s?.title, assets.body);
    // a song's cover goes with it: lib/share-card.js loadCovers turns the stored link (cover, or the Spotify track) into
    // the picture, so the song a cover belongs to is the one drawn beside it even when another was left off
    if (drawable(s?.title, title)) songs.push({ title, streams: s.streams, cover: s.cover, track: s.track });
  }
  return { name: nameIssue ? null : name, nameIssue, songs, leftOff: top.length - songs.length };
}

export const commas = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
// "2026-11-13" -> "NOV 13, 2026" (a calendar day: no time zone can move it)
export const dayWords = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : "";
};

// ---- assets ----------------------------------------------------------------------------------------------------------
const OG_FONT = "node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf";
export const ASSET_FILES = {
  suntage: "public/fonts/suntage.otf", // the site's display font (styles/app.css @font-face Suntage)
  noto: OG_FONT, // next/og's own bundled font, for song titles (Suntage is capitals only)
  wordmark: "public/brand/wordmark.png", // public/brand/wordmark.webp as a PNG (Satori can't read WebP)
  mark: "public/brand/d.png", // the D
};
const cache = new Map();
export function loadAssets(root = process.cwd()) {
  if (cache.has(root)) return cache.get(root);
  const read = (k) => fs.readFileSync(path.join(root, ASSET_FILES[k]));
  const png = (k) => `data:image/png;base64,${read(k).toString("base64")}`;
  const suntage = read("suntage"), noto = read("noto");
  const a = {
    fonts: [
      { name: "Suntage", data: suntage, weight: 400, style: "normal" },
      { name: "Noto Sans", data: noto, weight: 400, style: "normal" },
    ],
    display: fontInfo(suntage),
    body: fontInfo(noto),
    wordmark: png("wordmark"), wordmarkRatio: 1100 / 365,
    mark: png("mark"), markRatio: 180 / 144,
  };
  cache.set(root, a);
  return a;
}

// ---- the card ------------------------------------------------------------------------------------------------------
// The sizes for each format. Everything is laid out from these, so story and post differ only here.
//   title [max, min]: a song title's size on one line; title2 the biggest for a title on two lines, which at TITLE_LH
//   leaves at least ROW_PAD above and below them in the row (rowH). One size is picked for all the titles of a card
//   (fitTitles), so no title is bigger than these allow it to be on its own
//   thumb: a song's cover in its row, a square centred in rowH; blur: the backdrop's blur radius (px)
export const LAYOUT = {
  story: { pad: 72, top: 104, bottom: 88, mark: 144, photo: 176, name: [92, 44], label: 28, hero: [216, 96], rowH: 124, thumb: 96, rank: 26, title: [43, 34], title2: 43, num: 32, panelPadX: 30, gap: 72, foot: 24, blur: 52 },
  post: { pad: 72, top: 60, bottom: 56, mark: 96, photo: 112, name: [72, 36], label: 22, hero: [160, 76], rowH: 90, thumb: 68, rank: 22, title: [33, 28], title2: 30, num: 28, panelPadX: 26, gap: 40, foot: 20, blur: 40 },
};
export const TITLE_LH = 1.1;
export const ROW_PAD = 10;
const LS_LABEL = 0.16; // the dashboard's small capitals: letter-spaced (.12em there, a little more at poster size)

// The backdrop: the biggest song's cover, much larger than the card (zoom: so the blur's soft edge falls outside it),
// blurred, pushed to full colour (saturate), then its tones squeezed into a dark band (contrast and brightness down) so
// the art gives the colour but never so much light that white text loses its ground, whatever the cover (a white one
// gives mid grey; the order matters: saturating last would light a bright colour up again), then shaded from the top
// down. next/og's Satori does CSS filters. The shade is what the wordmark, name, total and rows sit on.
const BACKDROP = {
  zoom: 1.1,
  filter: (blur) => `blur(${blur}px) saturate(4.5) contrast(0.7) brightness(0.66)`,
  shade: "linear-gradient(180deg, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0.22) 22%, rgba(0,0,0,0.48) 55%, rgba(0,0,0,0.88) 100%)",
};
// the panel and the covers' frames: white at low strength over whatever is behind (on plain black they come out as the
// dashboard's own greys), so the art is the colour and the brand stays chrome
const GLASS = {
  panel: "rgba(6,6,8,0.48)", border: "rgba(255,255,255,0.16)", hair: "rgba(255,255,255,0.10)", label: "rgba(255,255,255,0.8)",
  tile: "linear-gradient(145deg,#2c2c30,#0f0f11)", rim: "linear-gradient(135deg,rgba(255,255,255,0.30),rgba(255,255,255,0.07))",
};

const div = (style, ...children) => h("div", { style: { display: "flex", ...style } }, ...children);
// a photo or a cover is drawn only when it's one Satori can: a PNG or JPEG data: URI (lib/share-card.js loadPhoto makes them)
const photoOk = (v) => /^data:image\/(png|jpe?g);base64,/i.test(String(v || ""));

// stats: { name, photo?, grossStreams, songs: [{ title, streams, cover? }], asOf: "YYYY-MM-DD" } (lib/share-card.js)
// The logo at the top, the date at the bottom, and between them, centred: the name, the total, the top songs, each with
// its cover art beside it. Behind it all, the cover of the biggest song that has one (blurred, darkened).
export function cardElement(stats, format = "story", assets = loadAssets()) {
  const f = formatOf(format), { width, height } = FORMATS[f], L = LAYOUT[f];
  const { display, body } = assets;
  const inner = width - L.pad * 2;
  const photo = photoOk(stats?.photo) ? stats.photo : null;
  const gap = Math.round(photo ? L.gap * 0.72 : L.gap); // a photo takes some of the room between the parts
  const said = cardText(stats, assets);
  const nameFit = said.name ? fitName(said.name, display, { max: L.name[0], min: L.name[1], width: inner * 0.96, ls: 0.02 }) : null;
  const heroFit = fitSize(commas(stats?.grossStreams), display, { max: L.hero[0], min: L.hero[1], width: inner * 0.96 });
  const songs = said.songs.map((s, i) => ({ rank: String(i + 1).padStart(2, "0"), title: s.title, streams: commas(s.streams), cover: photoOk(s.cover) ? s.cover : null }));
  const art = songs.find((s) => s.cover)?.cover || null;
  // the numbers' column: as wide as the widest number, so every title stops at the same place and every number ends
  // on the same right edge. Then the row, left to right: rank, cover, title, number
  const numW = Math.ceil(Math.max(0, ...songs.map((s) => display.width(s.streams, L.num))) * 1.02) + 4;
  const rankW = Math.ceil(display.width("00", L.rank)) + Math.round(L.rank * 0.5);
  const NUM_GAP = 22, THUMB_GAP = Math.round(L.thumb * 0.19);
  const titleW = inner - 4 - L.panelPadX * 2 - rankW - L.thumb - THUMB_GAP - numW - NUM_GAP;
  // every title on one size: the biggest at which each fits (one line where it can, two where it must)
  const titleFits = fitTitles(songs.map((s) => s.title), body, { max: L.title[0], min: L.title[1], max2: L.title2, width: titleW - 2 });
  const asOf = dayWords(stats?.asOf);
  const labelColor = art ? GLASS.label : C.ink4;
  // letter-spaced capitals: CSS adds the spacing after the last letter too, so a centred line is nudged back by half of
  // it and a right-aligned one by all of it, to sit where it looks like it sits
  const spaced = (text, size, color, align = "left", extra = {}) => {
    const ls = size * LS_LABEL;
    return div({ fontFamily: "Suntage", fontSize: size, letterSpacing: ls, color, whiteSpace: "nowrap", ...(align === "center" ? { paddingLeft: ls } : align === "right" ? { marginRight: -ls } : {}), ...extra }, text);
  };
  const markW = Math.round(L.mark * assets.wordmarkRatio);

  // a song's cover in its row: a rounded square in a thin rim (the first song's rim chrome), or without a cover the D on
  // a dark tile. Every one the same outer size, so the rows keep to one grid whatever has a cover
  const R = Math.round(L.thumb * 0.22);
  const thumbOf = (cover, first) => {
    const rim = first ? 3 : 2, side = L.thumb - rim * 2, r = R - rim, dW = Math.round(side * 0.5);
    return div({ width: L.thumb, height: L.thumb, padding: rim, borderRadius: R, flexShrink: 0, marginRight: THUMB_GAP, backgroundImage: first ? C.chromeBorder : GLASS.rim, boxShadow: "0 10px 26px rgba(0,0,0,0.42)" },
      div({ width: side, height: side, borderRadius: r, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: "#0c0c0d", ...(cover ? {} : { backgroundImage: GLASS.tile }) },
        cover
          ? h("img", { src: cover, width: side, height: side, style: { width: side, height: side, objectFit: "cover" } })
          : h("img", { src: assets.mark, width: dW, height: Math.round(dW / assets.markRatio), style: { opacity: 0.9 } })));
  };

  const S = Math.round(Math.max(width, height) * BACKDROP.zoom);
  const backdrop = art
    ? [
      h("img", { src: art, width: S, height: S, style: { position: "absolute", left: Math.round((width - S) / 2), top: Math.round((height - S) / 2), width: S, height: S, objectFit: "cover", filter: BACKDROP.filter(L.blur) } }),
      div({ position: "absolute", left: 0, top: 0, width, height, backgroundImage: BACKDROP.shade }),
    ]
    : [];

  return div(
    { width, height, flexDirection: "column", alignItems: "center", position: "relative", backgroundColor: C.bg, color: C.ink, fontFamily: "Noto Sans", padding: `${L.top}px ${L.pad}px ${L.bottom}px` },
    ...backdrop,
    // light from above, as the site's chrome catches it, and the D, large and faint, behind everything
    div({ position: "absolute", left: 0, top: 0, width, height, backgroundImage: "radial-gradient(ellipse 90% 55% at 50% 0%, rgba(255,255,255,0.13), rgba(255,255,255,0.03) 45%, rgba(0,0,0,0) 70%)" }),
    h("img", { src: assets.mark, width: Math.round(height * 0.62 * assets.markRatio), height: Math.round(height * 0.62), style: { position: "absolute", right: -Math.round(width * 0.42), bottom: -Math.round(height * 0.08), opacity: art ? 0.04 : 0.05 } }),
    // the wordmark (the logo with DEFIED on it)
    h("img", { src: assets.wordmark, width: markW, height: L.mark, style: { flexShrink: 0 } }),
    div({ flexDirection: "column", alignItems: "center", justifyContent: "center", flexGrow: 1, width: inner, paddingTop: Math.round(L.gap * 0.5), paddingBottom: Math.round(L.gap * 0.5) },
      // who
      photo && div({ width: L.photo + 8, height: L.photo + 8, borderRadius: L.photo, padding: 4, backgroundImage: C.chromeBorder, marginBottom: Math.round(gap * 0.45), flexShrink: 0, boxShadow: "0 0 70px rgba(255,255,255,0.20)" },
        h("img", { src: photo, width: L.photo, height: L.photo, style: { width: L.photo, height: L.photo, borderRadius: L.photo, objectFit: "cover" } })),
      nameFit && div({ flexDirection: "column", alignItems: "center", flexShrink: 0 },
        ...nameFit.lines.map((line) => div({ fontFamily: "Suntage", fontSize: nameFit.size, letterSpacing: nameFit.size * 0.02, paddingLeft: nameFit.size * 0.02, lineHeight: 1.12, color: C.ink, whiteSpace: "nowrap" }, line))),
      // the streams
      div({ flexDirection: "column", alignItems: "center", marginTop: nameFit ? gap : 0, flexShrink: 0 },
        div({ alignItems: "center", justifyContent: "center", width: inner },
          div({ flexGrow: 1, height: 2, marginRight: Math.round(L.label * 0.9), backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.32))" }),
          spaced("TOTAL STREAMS", L.label, labelColor, "center"),
          div({ flexGrow: 1, height: 2, marginLeft: Math.round(L.label * 0.9), backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0.32), rgba(255,255,255,0))" })),
        div({ marginTop: Math.round(L.label * 0.5), fontFamily: "Suntage", fontSize: heroFit.size, lineHeight: 1.08, whiteSpace: "nowrap", backgroundImage: C.chrome, backgroundClip: "text", color: "transparent" }, heroFit.text),
      ),
      // the biggest songs
      songs.length > 0 && div({ flexDirection: "column", marginTop: gap, width: inner, flexShrink: 0 },
        div({ alignItems: "center", marginBottom: Math.round(L.label * 0.7), paddingLeft: 4 },
          spaced(songs.length === 1 ? "TOP SONG" : "TOP SONGS", L.label, labelColor),
          div({ flexGrow: 1, height: 2, marginLeft: Math.round(L.label * 0.9), backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0.32), rgba(255,255,255,0))" })),
        div({ flexDirection: "column", backgroundColor: GLASS.panel, border: `2px solid ${GLASS.border}`, borderRadius: 32, padding: `0 ${L.panelPadX}px` },
          ...songs.map((s, i) => div(
            { height: L.rowH, alignItems: "center", borderTop: i ? `2px solid ${GLASS.hair}` : "none", flexShrink: 0 },
            div({ width: rankW, flexShrink: 0, fontFamily: "Suntage", fontSize: L.rank, color: i === 0 ? C.ink2 : C.ink4, letterSpacing: L.rank * 0.06 }, s.rank),
            thumbOf(s.cover, i === 0),
            (() => {
              const t = titleFits[i];
              return div({ width: titleW, flexShrink: 0, flexDirection: "column", justifyContent: "center", fontSize: t.size, color: C.ink, ...(t.lines.length > 1 ? { lineHeight: TITLE_LH } : {}) },
                ...t.lines.map((line) => div({ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, line)));
            })(),
            div({ width: numW, flexShrink: 0, marginLeft: NUM_GAP, justifyContent: "flex-end", fontFamily: "Suntage", fontSize: L.num, color: i === 0 ? C.ink : C.ink2, whiteSpace: "nowrap" }, s.streams),
          )),
        ),
      ),
    ),
    // where it's from and what day it says
    div({ width: inner, flexShrink: 0, justifyContent: "space-between", alignItems: "center", paddingTop: Math.round(L.foot * 1.2), borderTop: `2px solid ${art ? GLASS.border : C.line2}` },
      spaced("DEFIEDMGMT.COM", L.foot, art ? "rgba(255,255,255,0.8)" : C.ink3),
      asOf ? spaced(`AS OF ${asOf}`, L.foot, labelColor, "right") : null,
    ),
  );
}

// The card as PNG bytes (a Buffer). opts: { assets, root } (root: where public/ and node_modules/ are; the request's
// working directory by default). A picture Satori can't decode (a file that starts like a JPEG and isn't one: it throws
// "Invalid JPEG") doesn't cost the card: each picture is tried on its own, and the card is drawn again without the ones
// that fail (a cover then becomes the D tile), so one bad file never turns into "Couldn't make the card".
export async function renderCardPng(stats, format = "story", { assets, root } = {}) {
  const a = assets || loadAssets(root);
  const f = formatOf(format);
  const ImageResponse = og.ImageResponse || og.default?.ImageResponse;
  const draw = async (element, size) => {
    const buf = Buffer.from(await new ImageResponse(element, { ...size, fonts: a.fonts }).arrayBuffer());
    if (!buf.length) throw new Error("The card came out empty.");
    return buf;
  };
  try {
    return await draw(cardElement(stats, f, a), FORMATS[f]);
  } catch (err) {
    const bad = new Set();
    for (const src of new Set([stats?.photo, ...(stats?.songs || []).map((s) => s?.cover)].filter(photoOk))) {
      try { await draw(div({ width: 8, height: 8 }, h("img", { src, width: 8, height: 8 })), { width: 8, height: 8 }); } catch { bad.add(src); }
    }
    if (!bad.size) throw err;
    console.error(`share card: ${bad.size} picture(s) didn't decode, drawn without them:`, err?.message || err);
    const songs = (stats.songs || []).map((s) => (bad.has(s?.cover) ? { ...s, cover: null } : s));
    return draw(cardElement({ ...stats, photo: bad.has(stats.photo) ? null : stats.photo, songs }, f, a), FORMATS[f]);
  }
}
