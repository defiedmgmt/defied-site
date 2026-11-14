// Draws a share card from a stats file, for checking the layout locally (2026-11-13). It never reads a database or
// the network: the numbers come from the file, the fonts and the logo from this repo.
//
//   node scripts/render-share-card.mjs <stats.json> [story|post] [out.png]
//
// stats.json: { "name": "Sample Artist", "grossStreams": 1234567, "asOf": "2026-11-13",
//               "songs": [{ "title": "Song One", "streams": 456789 }, ...], "photo": "data:image/png;base64,..." (optional) }
// Without out.png it writes <stats>-<format>.png beside the stats file.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const [statsPath, formatArg = "story", outArg] = process.argv.slice(2);
if (!statsPath) {
  console.error("Usage: node scripts/render-share-card.mjs <stats.json> [story|post] [out.png]");
  process.exit(2);
}
if (!["story", "post"].includes(formatArg)) {
  console.error(`The format is "story" or "post", not "${formatArg}".`);
  process.exit(2);
}

// next/og fetches a font or emoji from the internet for a character the given fonts lack. The card's text rules drop
// those first, so a fetch here means a rule missed one: it's refused and reported, never made.
const tried = [];
globalThis.fetch = async (url) => { tried.push(String(url)); throw new Error("render-share-card: no network"); };

const { renderCardPng, formatOf } = await import(path.join(ROOT, "lib/share-card-render.js"));
const stats = JSON.parse(fs.readFileSync(statsPath, "utf8"));
const format = formatOf(formatArg);
const out = outArg || statsPath.replace(/\.json$/i, "") + `-${format}.png`;
const png = await renderCardPng(stats, format, { root: ROOT });
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, png);
console.log(`${out} (${format}, ${png.length.toLocaleString("en-US")} bytes)`);
if (tried.length) {
  console.error(`It tried to fetch ${tried.length} thing(s) for characters the fonts lack: ${tried.join(", ")}`);
  process.exit(1);
}
