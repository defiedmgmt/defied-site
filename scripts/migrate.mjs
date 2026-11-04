// Applies db/migrations/*.sql to the database at DATABASE_URL: each file once, in file-name order
// (001-…, 002-…), each in its own transaction together with its row in schema_migrations, so a file
// that fails changes nothing and is tried again on the next run. A file is recorded only once it has
// fully applied.
//
// Additive only: a migration with DROP, TRUNCATE or DELETE in it (outside comments and quotes) is
// refused before anything runs, and this script itself never drops or deletes anything. Every
// migration is also written to be safe to run again (IF NOT EXISTS), so a database where some were
// run by hand before this existed (the live one) just gets them recorded.
//
//   node scripts/migrate.mjs            apply what's new (DATABASE_URL must be set)
//   node scripts/migrate.mjs --dry-run  say what would run, change nothing
//   node scripts/migrate.mjs --build    the build's own call (package.json "build"): runs only on a
//                                       Vercel production build, or anywhere with MIGRATE_ON_BUILD=on
// MIGRATE_ON_BUILD=off skips the build's call. It reads no .env file: only the environment it's given.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const TABLE = `CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

// One SQL text as pieces: code, comments (-- …, /* … */), and quoted text ('…', "…", E'…',
// $$…$$, $tag$…$tag$). One pass, so a quote inside a comment or a semicolon inside a string can't
// confuse what comes after.
export function pieces(text) {
  const out = [];
  let i = 0, code = "";
  const n = text.length;
  const flush = () => { if (code) { out.push({ code: true, text: code }); code = ""; } };
  const take = (e) => { flush(); out.push({ code: false, text: text.slice(i, e) }); i = e; };
  while (i < n) {
    const c = text[i], d = text[i + 1];
    if (c === "-" && d === "-") { const j = text.indexOf("\n", i); take(j < 0 ? n : j); continue; }
    if (c === "/" && d === "*") { const j = text.indexOf("*/", i + 2); take(j < 0 ? n : j + 2); continue; }
    if (c === "'" || c === '"') {
      const esc = c === "'" && /[eE]/.test(text[i - 1] || "") && !/[\w$]/.test(text[i - 2] || "");
      let j = i + 1;
      for (; j < n; j++) {
        if (esc && text[j] === "\\") { j++; continue; }
        if (text[j] === c) { if (text[j + 1] === c) { j++; continue; } break; }
      }
      take(Math.min(j + 1, n)); continue;
    }
    if (c === "$" && !/\w/.test(text[i - 1] || "")) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i, i + 64));
      if (m) { const j = text.indexOf(m[0], i + m[0].length); take(j < 0 ? n : j + m[0].length); continue; }
    }
    code += c; i++;
  }
  flush();
  return out;
}
// The text with comments and everything quoted blanked out: what the keyword check reads
export const stripNoise = (text) => pieces(text).map((p) => (p.code ? p.text : " ")).join("");
// One SQL file into its statements, split on the semicolons in code. Comment-only pieces are dropped.
export function splitSql(text) {
  const out = [];
  let cur = "";
  const push = () => { if (stripNoise(cur).trim()) out.push(cur.trim()); cur = ""; };
  for (const p of pieces(text)) {
    if (!p.code) { cur += p.text; continue; }
    const parts = p.text.split(";");
    parts.forEach((x, k) => { cur += x; if (k < parts.length - 1) push(); });
  }
  push();
  return out;
}
// The first keyword that would take something away, or null
export function forbidden(text) {
  const m = /\b(DROP|TRUNCATE|DELETE)\b/i.exec(stripNoise(text));
  return m ? m[1].toUpperCase() : null;
}

export const listMigrations = (dir = DIR) => fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

// db: { query(text, params) -> rows, transaction([[text, params], …]) } (Neon's HTTP driver, or PGlite
// in the tests). Returns { applied: [names], skipped: [names already recorded], dryRun }.
export async function migrate({ db, dir = DIR, dryRun = false, log = console.log } = {}) {
  const files = listMigrations(dir);
  const texts = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]));
  // every file is checked before anything runs
  for (const f of files) {
    const bad = forbidden(texts[f]);
    if (bad) throw new Error(`${f} has ${bad} in it. Migrations here only add, so nothing was run.`);
  }
  if (dryRun) {
    let done = new Set();
    try { done = new Set((await db.query("SELECT name FROM schema_migrations", [])).map((r) => r.name)); } catch (err) { if (err?.code !== "42P01") throw err; }
    const pending = files.filter((f) => !done.has(f));
    log(pending.length ? `Would apply ${pending.length}: ${pending.join(", ")}` : "Nothing to apply.");
    return { applied: [], pending, skipped: files.filter((f) => done.has(f)), dryRun: true };
  }
  await db.query(TABLE, []);
  const done = new Set((await db.query("SELECT name FROM schema_migrations", [])).map((r) => r.name));
  const applied = [], skipped = [];
  for (const f of files) {
    if (done.has(f)) { skipped.push(f); continue; }
    const statements = splitSql(texts[f]);
    try {
      // the row first: a second build running at the same moment waits on it, then finds it taken
      await db.transaction([["INSERT INTO schema_migrations (name) VALUES ($1)", [f]], ...statements.map((s) => [s, []])]);
      applied.push(f);
      log(`applied ${f} (${statements.length} statement${statements.length === 1 ? "" : "s"})`);
    } catch (err) {
      if (err?.code === "23505") { skipped.push(f); log(`${f} was applied by another run just now`); continue; }
      throw new Error(`${f} failed, so it changed nothing: ${err?.message || err}`);
    }
  }
  log(applied.length ? `Migrations: ${applied.length} applied, ${skipped.length} already there.` : `Migrations: all ${skipped.length} already there.`);
  return { applied, skipped, dryRun: false };
}

// Should this run go ahead? { run, why }
export function shouldRun(argv, env) {
  if (!argv.includes("--build")) return { run: true, why: "run by hand" };
  if (env.MIGRATE_ON_BUILD === "off") return { run: false, why: "MIGRATE_ON_BUILD=off" };
  if (env.MIGRATE_ON_BUILD === "on") return { run: true, why: "MIGRATE_ON_BUILD=on" };
  if (env.VERCEL && env.VERCEL_ENV === "production") return { run: true, why: "Vercel production build" };
  return { run: false, why: env.VERCEL ? `a Vercel ${env.VERCEL_ENV || "non-production"} build` : "a local build (set MIGRATE_ON_BUILD=on to run it here)" };
}

// Neon's HTTP driver as the `db` migrate() takes
export async function neonDb(url) {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  return {
    query: (text, params = []) => sql.query(text, params),
    transaction: (items) => sql.transaction(items.map(([text, params]) => sql.query(text, params))),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const go = shouldRun(argv, process.env);
  if (!go.run) { console.log(`Migrations skipped: ${go.why}.`); return; }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL isn't set, so the migrations can't run. The build stops here rather than deploy code the database isn't ready for.");
  await migrate({ db: await neonDb(url), dryRun: argv.includes("--dry-run") });
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((err) => { console.error(`Migrations stopped: ${err.message}`); process.exit(1); });
}
