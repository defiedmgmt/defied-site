// Moves the photos and covers still stored inside the database (data: URIs) into the Vercel Blob store,
// and puts each one's link in its place (list B #2). A launch step, run once by hand after the deploy.
//
//   node scripts/migrate-images-to-blob.mjs                  dry run: lists what it would move, changes nothing
//   node scripts/migrate-images-to-blob.mjs --apply          uploads them, keeps a backup, swaps in the links
//   node scripts/migrate-images-to-blob.mjs --apply --backup <file>    where the backup goes
//   node scripts/migrate-images-to-blob.mjs --restore <file>  puts the old values from a backup back
//
// Needs DATABASE_URL, and BLOB_READ_WRITE_TOKEN for --apply. It reads no .env file.
// Safe to run again: a file's name is its content's hash (the same image lands on the same file), and only
// values that are still data: URIs are touched. Each swap checks the row still holds the value it read, so
// a photo changed in the dashboard meanwhile is left alone. The backup (every old value in full, written
// before anything changes) is how to undo it.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The app's lib/*.js are ES modules in a package with no "type", so plain node warns once per file
// while reading them. That one warning is left out here; every other warning still prints.
for (const l of process.listeners("warning")) process.off("warning", l);
process.on("warning", (w) => { if (w?.code !== "MODULE_TYPELESS_PACKAGE_JSON") console.warn(`${w.name}: ${w.message}`); });
const { IMAGE_COLUMNS, isInline, sniffImage } = await import("../lib/image-links.js");
const { imagePath, decodeDataUri } = await import("../lib/images.js");

const MISSING = new Set(["42P01", "42703"]); // a table or column this database doesn't have yet
const kb = (n) => `${Math.round(n / 1024).toLocaleString("en-US")} KB`;

// Every data: URI in an image column: [{ table, column, id, old, bytes, type, ext, pathname, problem? }]
export async function scan(db) {
  const out = [];
  for (const { table, column } of IMAGE_COLUMNS) {
    let rows;
    try { rows = await db.query(`SELECT id, ${column} AS v FROM ${table} WHERE ${column} LIKE 'data:%' ORDER BY id`, []); }
    catch (err) { if (MISSING.has(err?.code)) continue; throw err; }
    for (const r of rows) {
      const item = { table, column, id: r.id, old: r.v };
      const d = isInline(r.v) ? decodeDataUri(r.v) : null;
      const kind = d && sniffImage(d.bytes);
      if (!kind) { out.push({ ...item, problem: "not an image this can move (left as it is)" }); continue; }
      out.push({ ...item, bytes: d.bytes, type: kind.type, ext: kind.ext, pathname: imagePath(d.bytes, kind.ext) });
    }
  }
  return out;
}

// db: { query(text, params) -> rows, transaction([[text, params], ...]) -> [rows, ...] }
// putFile: @vercel/blob's put (or a stand-in). Returns a summary; with apply, also { backupPath, swapped, changed }.
export async function migrateImages({ db, putFile, apply = false, backupPath, log = console.log } = {}) {
  const found = await scan(db);
  const movable = found.filter((x) => !x.problem);
  const per = {};
  for (const x of movable) { const k = `${x.table}.${x.column}`; per[k] = per[k] || { n: 0, bytes: 0 }; per[k].n++; per[k].bytes += x.bytes.length; }
  const total = movable.reduce((s, x) => s + x.bytes.length, 0);
  for (const x of found.filter((y) => y.problem)) log(`  ${x.table}.${x.column} ${x.id}: ${x.problem}`);
  if (!movable.length) {
    log("Nothing to move: no photo or cover is stored inside the database.");
    return { found: found.length, movable: 0, uploaded: 0, swapped: 0, changed: 0, apply };
  }
  for (const [k, v] of Object.entries(per)) log(`  ${k.padEnd(24)} ${String(v.n).padStart(4)} image${v.n === 1 ? " " : "s"}  ${kb(v.bytes)}`);
  log(`${movable.length} image${movable.length === 1 ? "" : "s"}, ${kb(total)} in all.`);
  if (!apply) {
    log("Dry run: nothing was uploaded or changed. Run again with --apply to move them.");
    return { found: found.length, movable: movable.length, bytes: total, uploaded: 0, swapped: 0, changed: 0, apply };
  }

  // 1. upload: one file per distinct image
  const urls = new Map();
  for (const x of movable) {
    if (urls.has(x.pathname)) continue;
    const blob = await putFile(x.pathname, x.bytes, { access: "public", contentType: x.type, addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 31536000 });
    if (!blob?.url) throw new Error(`the store gave no link for ${x.pathname}, so nothing in the database was changed`);
    urls.set(x.pathname, blob.url);
  }
  log(`Uploaded ${urls.size} file${urls.size === 1 ? "" : "s"}${urls.size < movable.length ? ` (${movable.length - urls.size} were the same image as another)` : ""}.`);

  // 2. the backup, before anything in the database changes
  const rows = movable.map((x) => ({ table: x.table, column: x.column, id: x.id, url: urls.get(x.pathname), old: x.old }));
  const file = backupPath || path.resolve(`image-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify({ takenAt: new Date().toISOString(), rows }, null, 1), { mode: 0o600, flag: "wx" });
  log(`Backup of the old values: ${file}`);

  // 3. the swap, in one transaction; a row whose value changed since the scan is left alone
  const res = await db.transaction(rows.map((r) => [`UPDATE ${r.table} SET ${r.column} = $1 WHERE id = $2 AND ${r.column} = $3 RETURNING id`, [r.url, r.id, r.old]]));
  const swapped = res.filter((x) => x.length).length;
  log(`Swapped in ${swapped} link${swapped === 1 ? "" : "s"}.${swapped < rows.length ? ` ${rows.length - swapped} changed in the dashboard meanwhile and were left alone.` : ""}`);
  return { found: found.length, movable: movable.length, bytes: total, uploaded: urls.size, swapped, changed: rows.length - swapped, backupPath: file, apply };
}

// Puts the old values from a backup back, only where the row still holds the link this script put there
export async function restore({ db, backupPath, log = console.log }) {
  const { rows } = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  const res = await db.transaction(rows.map((r) => [`UPDATE ${r.table} SET ${r.column} = $1 WHERE id = $2 AND ${r.column} = $3 RETURNING id`, [r.old, r.id, r.url]]));
  const n = res.filter((x) => x.length).length;
  log(`Put back ${n} of ${rows.length}.${n < rows.length ? ` ${rows.length - n} had changed since and were left alone.` : ""}`);
  return { restored: n, of: rows.length };
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL isn't set.");
  const { neonDb } = await import("./migrate.mjs");
  const db = await neonDb(url);
  const host = (() => { try { return new URL(url.replace(/^postgres(ql)?:/, "http:")).hostname; } catch { return "?"; } })();
  console.log(`Database: ${host}`);
  if (opt("--restore")) return restore({ db, backupPath: opt("--restore") });
  const apply = argv.includes("--apply");
  let putFile = null;
  if (apply) {
    const token = String(process.env.BLOB_READ_WRITE_TOKEN || "").trim();
    if (!token) throw new Error("BLOB_READ_WRITE_TOKEN isn't set, so there's nowhere to upload to.");
    console.log(`Blob store: ${token.split("_")[3] || "?"}`);
    ({ put: putFile } = await import("@vercel/blob"));
  }
  await migrateImages({ db, putFile, apply, backupPath: opt("--backup") });
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((err) => { console.error(`Stopped: ${err.message}`); process.exit(1); });
}
