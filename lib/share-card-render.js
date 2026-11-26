// The share card's picture (2026-11-13, the owner: "a cool image that they can save w like defied logo and branding and
// colors and shit w all their total streams (gross) and like their biggest songs and stuff and those songs streams").
// 2026-11-14, the owner: "make the export post screen look cooler maybe add images of the song or something": each top
// song's cover art sits in its row. 2026-11-26, the owner: "make it load way quicker, make the background black, also make
// it as of the export date": the card is on plain black (the blurred cover behind it, the light from above and the faint D
// are gone, and with them most of the drawing time: blurs are what resvg is slow at) and says the day it's made.
// Draws a client's stats (lib/share-card.js shareStats) as a PNG with next/og (Satori + resvg, in Node). Nothing here
// reads a database or the network: GET /api/share-card and scripts/render-share-card.mjs both call it. Imports only
// packages and node: built-ins, so plain node can load it (the script does).
//
// The layout itself (cardElement, cardText, the text rules, FORMATS, LAYOUT, cardDay) is lib/share-card-layout.js, which
// the portal also loads to draw the card at once while this makes the PNG; everything it exports is exported here too.
//   cardElement(stats, format, assets)  the card as React elements (the server's assets by default)
//   cardText(stats, assets)             what the card says, cleaned for its fonts
//   renderCardPng(stats, format, opts)  the PNG's bytes (a picture Satori can't decode is left out, not the whole card)
//   loadAssets(root)                    the fonts and brand images, read once from disk (root/public, as on Vercel:
//                                       next.config.js traces these files into /api/share-card's function)
//   warmEngine()                        starts next/og's engine (its two WebAssembly modules) without drawing anything
//                                       real: the route calls it while it reads the numbers, so a cold start's engine
//                                       load isn't added on top of them
//   shrinkPicture(dataUri, side)        a PNG or JPEG drawn down to side x side px (cover-fit) as a PNG data: URI, so a
//                                       2.5 MB photo isn't decoded again for every card it's on; null when it can't be
import fs from "node:fs";
import path from "node:path";
import { createElement as h } from "react";
// "next/og.js", not "next/og": Next 14 has no exports map, so plain node (the script) needs the file name; webpack takes either
import * as og from "next/og.js";
// (with its file name, as next/og.js above: plain node, which the script is, doesn't add ".js" the way webpack does)
import { cardElement as layoutElement, cardText as layoutText, fontInfo, formatOf, FORMATS } from "./share-card-layout.js";

export * from "./share-card-layout.js";

// the layout's two, with the server's own fonts and logo when none are given
export const cardElement = (stats, format = "story", assets = loadAssets()) => layoutElement(stats, format, assets);
export const cardText = (stats, assets = loadAssets()) => layoutText(stats, assets);

// ---- assets ----------------------------------------------------------------------------------------------------------
const OG_FONT = "node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf";
export const ASSET_FILES = {
  suntage: "public/fonts/suntage.otf", // the site's display font (styles/app.css @font-face Suntage)
  noto: OG_FONT, // next/og's own bundled font, for song titles (Suntage is capitals only); public/fonts/share-noto.ttf is the same file, for the portal's preview
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

// ---- drawing -----------------------------------------------------------------------------------------------------------
const div = (style, ...children) => h("div", { style: { display: "flex", ...style } }, ...children);
const photoOk = (v) => /^data:image\/(png|jpe?g);base64,/i.test(String(v || ""));
const ImageResponse = () => og.ImageResponse || og.default?.ImageResponse;
// the element as PNG bytes (a Buffer); throws when Satori or resvg can't
async function draw(element, size, fonts) {
  const IR = ImageResponse();
  const buf = Buffer.from(await new IR(element, { ...size, ...(fonts ? { fonts } : {}) }).arrayBuffer());
  if (!buf.length) throw new Error("The card came out empty.");
  return buf;
}

// next/og loads its engine the first time it draws (two WebAssembly modules, ~0.3 s on a cold start): a 1 x 1 blank gets
// that going. Once per process; never throws (the real card would then say what's wrong)
let warming = null;
export function warmEngine() {
  if (!warming) warming = draw(div({ width: 1, height: 1, backgroundColor: "#000" }), { width: 1, height: 1 }).then(() => true, () => false);
  return warming;
}

// A PNG or JPEG data: URI drawn down to side x side px (object-fit cover, as the card draws it), as a PNG data: URI (the
// caller decides when a picture is big enough to be worth it: lib/share-card.js cardPicture). null when it isn't a picture
// Satori can decode.
export async function shrinkPicture(src, side) {
  if (!photoOk(src)) return null;
  const s = Math.max(1, Math.round(side));
  try {
    const png = await draw(h("img", { src, width: s, height: s, style: { width: s, height: s, objectFit: "cover" } }), { width: s, height: s });
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

// The card as PNG bytes (a Buffer). opts: { assets, root } (root: where public/ and node_modules/ are; the request's
// working directory by default). A picture Satori can't decode (a file that starts like a JPEG and isn't one: it throws
// "Invalid JPEG") doesn't cost the card: each picture is tried on its own, and the card is drawn again without the ones
// that fail (a cover then becomes the D tile), so one bad file never turns into "Couldn't make the card".
export async function renderCardPng(stats, format = "story", { assets, root } = {}) {
  const a = assets || loadAssets(root);
  const f = formatOf(format);
  try {
    return await draw(layoutElement(stats, f, a), FORMATS[f], a.fonts);
  } catch (err) {
    const bad = new Set();
    for (const src of new Set([stats?.photo, ...(stats?.songs || []).map((s) => s?.cover)].filter(photoOk))) {
      try { await draw(div({ width: 8, height: 8 }, h("img", { src, width: 8, height: 8 })), { width: 8, height: 8 }); } catch { bad.add(src); }
    }
    if (!bad.size) throw err;
    console.error(`share card: ${bad.size} picture(s) didn't decode, drawn without them:`, err?.message || err);
    const songs = (stats.songs || []).map((s) => (bad.has(s?.cover) ? { ...s, cover: null } : s));
    return draw(layoutElement({ ...stats, photo: bad.has(stats.photo) ? null : stats.photo, songs }, f, a), FORMATS[f], a.fonts);
  }
}
