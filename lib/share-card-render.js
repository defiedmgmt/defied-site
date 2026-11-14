// The share card's picture (2026-11-13, the owner: "a cool image that they can save w like defied logo and branding and
// colors and shit w all their total streams (gross) and like their biggest songs and stuff and those songs streams").
// Draws a client's stats (lib/share-card.js shareStats) as a PNG with next/og (Satori + resvg, in Node). Nothing here
// reads a database or the network: GET /api/share-card and scripts/render-share-card.mjs both call it. Imports only
// packages and node: built-ins, so plain node can load it (the script does).
//
//   cardElement(stats, format, assets)  the card as React elements (pure)
//   renderCardPng(stats, format, opts)  the PNG's bytes
//   loadAssets(root)                    the fonts and brand images, read once from disk (root/public, as on Vercel:
//                                       next.config.js traces these files into /api/share-card's function)
//   cleanText / fitText / fitSize       the text rules: every character drawn is one the font has (an emoji, a
//                                       script the fonts don't cover, a control character is dropped or swapped for
//                                       its plain letter), and anything too long ends in "…"
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
const LAYOUT = {
  story: { pad: 88, top: 112, bottom: 92, mark: 160, photo: 208, name: [92, 44], label: 28, hero: [216, 96], rowH: 124, rank: 30, title: 43, num: 38, panelPadX: 44, gap: 84, foot: 24 },
  post: { pad: 72, top: 64, bottom: 60, mark: 100, photo: 128, name: [72, 36], label: 22, hero: [160, 76], rowH: 86, rank: 24, title: 33, num: 30, panelPadX: 34, gap: 44, foot: 20 },
};
const LS_LABEL = 0.16; // the dashboard's small capitals: letter-spaced (.12em there, a little more at poster size)

const div = (style, ...children) => h("div", { style: { display: "flex", ...style } }, ...children);
const photoOk = (v) => /^data:image\/(png|jpe?g);base64,/i.test(String(v || ""));

// stats: { name, photo?, grossStreams, songs: [{ title, streams }], asOf: "YYYY-MM-DD" } (lib/share-card.js)
// The logo at the top, the date at the bottom, and between them, centred: the name, the total, the top songs.
export function cardElement(stats, format = "story", assets = loadAssets()) {
  const f = formatOf(format), { width, height } = FORMATS[f], L = LAYOUT[f];
  const { display, body } = assets;
  const inner = width - L.pad * 2;
  const photo = photoOk(stats?.photo) ? stats.photo : null;
  const gap = Math.round(photo ? L.gap * 0.72 : L.gap); // a photo takes some of the room between the parts
  const name = cleanText(stats?.name, display);
  const nameFit = name ? fitName(name, display, { max: L.name[0], min: L.name[1], width: inner * 0.96, ls: 0.02 }) : null;
  const heroFit = fitSize(commas(stats?.grossStreams), display, { max: L.hero[0], min: L.hero[1], width: inner * 0.96 });
  const songs = (stats?.songs || []).slice(0, 5).map((s, i) => ({ rank: String(i + 1).padStart(2, "0"), title: cleanText(s.title, body) || "Untitled", streams: commas(s.streams) }));
  // the numbers' column: as wide as the widest number, so every title stops at the same place and every number ends
  // on the same right edge
  const numW = Math.ceil(Math.max(0, ...songs.map((s) => display.width(s.streams, L.num))) * 1.02) + 4;
  const rankW = Math.ceil(display.width("00", L.rank) * 1.1) + L.rank;
  const NUM_GAP = 28;
  const titleW = inner - 4 - L.panelPadX * 2 - rankW - numW - NUM_GAP;
  const asOf = dayWords(stats?.asOf);
  // letter-spaced capitals: CSS adds the spacing after the last letter too, so a centred line is nudged back by half of
  // it and a right-aligned one by all of it, to sit where it looks like it sits
  const spaced = (text, size, color, align = "left", extra = {}) => {
    const ls = size * LS_LABEL;
    return div({ fontFamily: "Suntage", fontSize: size, letterSpacing: ls, color, whiteSpace: "nowrap", ...(align === "center" ? { paddingLeft: ls } : align === "right" ? { marginRight: -ls } : {}), ...extra }, text);
  };
  const markW = Math.round(L.mark * assets.wordmarkRatio);

  return div(
    { width, height, flexDirection: "column", alignItems: "center", position: "relative", backgroundColor: C.bg, color: C.ink, fontFamily: "Noto Sans", padding: `${L.top}px ${L.pad}px ${L.bottom}px` },
    // light from above, as the site's chrome catches it, and the D, large and faint, behind everything
    div({ position: "absolute", left: 0, top: 0, width, height, backgroundImage: "radial-gradient(ellipse 90% 55% at 50% 0%, rgba(255,255,255,0.13), rgba(255,255,255,0.03) 45%, rgba(0,0,0,0) 70%)" }),
    h("img", { src: assets.mark, width: Math.round(height * 0.62 * assets.markRatio), height: Math.round(height * 0.62), style: { position: "absolute", right: -Math.round(width * 0.42), bottom: -Math.round(height * 0.08), opacity: 0.05 } }),
    // the wordmark (the logo with DEFIED on it)
    h("img", { src: assets.wordmark, width: markW, height: L.mark, style: { flexShrink: 0 } }),
    div({ flexDirection: "column", alignItems: "center", justifyContent: "center", flexGrow: 1, width: inner, paddingTop: Math.round(L.gap * 0.5), paddingBottom: Math.round(L.gap * 0.5) },
      // who
      photo && div({ width: L.photo + 8, height: L.photo + 8, borderRadius: L.photo, padding: 4, backgroundImage: C.chromeBorder, marginBottom: Math.round(gap * 0.45), flexShrink: 0 },
        h("img", { src: photo, width: L.photo, height: L.photo, style: { width: L.photo, height: L.photo, borderRadius: L.photo, objectFit: "cover" } })),
      nameFit && div({ flexDirection: "column", alignItems: "center", flexShrink: 0 },
        ...nameFit.lines.map((line) => div({ fontFamily: "Suntage", fontSize: nameFit.size, letterSpacing: nameFit.size * 0.02, paddingLeft: nameFit.size * 0.02, lineHeight: 1.12, color: C.ink, whiteSpace: "nowrap" }, line))),
      // the streams
      div({ flexDirection: "column", alignItems: "center", marginTop: nameFit ? gap : 0, flexShrink: 0 },
        spaced("TOTAL STREAMS", L.label, C.ink4, "center"),
        div({ marginTop: Math.round(L.label * 0.5), fontFamily: "Suntage", fontSize: heroFit.size, lineHeight: 1.08, whiteSpace: "nowrap", backgroundImage: C.chrome, backgroundClip: "text", color: "transparent" }, heroFit.text),
      ),
      // the biggest songs
      songs.length > 0 && div({ flexDirection: "column", marginTop: gap, width: inner, flexShrink: 0 },
        spaced(songs.length === 1 ? "TOP SONG" : "TOP SONGS", L.label, C.ink4, "left", { marginBottom: Math.round(L.label * 0.7), paddingLeft: 4 }),
        div({ flexDirection: "column", backgroundColor: C.s1, border: `2px solid ${C.line2}`, borderRadius: 28, padding: `0 ${L.panelPadX}px` },
          ...songs.map((s, i) => div(
            { height: L.rowH, alignItems: "center", borderTop: i ? `2px solid ${C.line}` : "none", flexShrink: 0 },
            div({ width: rankW, flexShrink: 0, fontFamily: "Suntage", fontSize: L.rank, color: i === 0 ? C.ink3 : C.off, letterSpacing: L.rank * 0.06 }, s.rank),
            div({ width: titleW, flexShrink: 0, fontSize: L.title, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, fitText(s.title, body, L.title, titleW - 2)),
            div({ width: numW, flexShrink: 0, marginLeft: NUM_GAP, justifyContent: "flex-end", fontFamily: "Suntage", fontSize: L.num, color: i === 0 ? C.ink : C.ink2, whiteSpace: "nowrap" }, s.streams),
          )),
        ),
      ),
    ),
    // where it's from and what day it says
    div({ width: inner, flexShrink: 0, justifyContent: "space-between", alignItems: "center", paddingTop: Math.round(L.foot * 1.2), borderTop: `2px solid ${C.line2}` },
      spaced("DEFIEDMGMT.COM", L.foot, C.ink3),
      asOf ? spaced(`AS OF ${asOf}`, L.foot, C.ink4, "right") : null,
    ),
  );
}

// The card as PNG bytes (a Buffer). opts: { assets, root } (root: where public/ and node_modules/ are; the request's
// working directory by default)
export async function renderCardPng(stats, format = "story", { assets, root } = {}) {
  const a = assets || loadAssets(root);
  const f = formatOf(format);
  const ImageResponse = og.ImageResponse || og.default?.ImageResponse;
  const res = new ImageResponse(cardElement(stats, f, a), { ...FORMATS[f], fonts: a.fonts });
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("The card came out empty.");
  return buf;
}
