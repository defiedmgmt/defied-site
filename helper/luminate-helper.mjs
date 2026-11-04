#!/usr/bin/env node
// Defied Luminate helper (runs on the owner's Mac; plain Node 20+, nothing to install).
// Watches the Downloads folder for Luminate portfolio exports (portfolio-export-POR….csv), waits
// until each file has stopped changing, sends them to the dashboard (POST /api/luminate-helper with
// this Mac's token), and moves each one the site answered for into "Downloads/Luminate (done)".
// The site checks every file the way the drop zone does and applies it by itself when the checks
// pass; anything it isn't sure about waits on the dashboard's Luminate page for a person.
//
//   node luminate-helper.mjs            keep watching (what launchd runs)
//   node luminate-helper.mjs --once     send what's there now, then stop
//   node luminate-helper.mjs --check    check the config and that the site knows this token
//
// Config: a JSON file at $HELPER_CONFIG, else ~/Library/Application Support/Defied Luminate Helper/config.json:
//   { "site": "https://www.defiedmgmt.com", "token": "<this Mac's token>", "device": "studio-mac",
//     "downloads": "~/Downloads", "doneDir": "~/Downloads/Luminate (done)" }
// Timings (ms, optional): settleMs 10000 (unchanged this long = downloaded), quietMs 45000 (wait for
// the other portfolios' files), scanMs 15000, pingMs 1800000 (check in), retryMs 60000 (first wait
// after a failure; it doubles up to 30x, and a refused token waits 30x at once).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const VERSION = "1.0.0";
export const EXPORT_RE = /^portfolio-export-POR[0-9A-F]{6,}-\d{12,14}( \(\d+\))?\.csv$/i;
const MAX_FILES = 12, MAX_BYTES = 3.5 * 1024 * 1024;
const home = (p) => String(p || "").replace(/^~(?=$|\/)/, os.homedir());
const now = () => new Date().toISOString();
const log = (...a) => console.log(`[${now()}]`, ...a);

export function loadConfig(file = process.env.HELPER_CONFIG || path.join(os.homedir(), "Library", "Application Support", "Defied Luminate Helper", "config.json")) {
  let c;
  try { c = JSON.parse(fs.readFileSync(file, "utf8")); } catch (err) { throw new Error(`Can't read the helper's config at ${file}: ${err.message}`); }
  if (!/^https?:\/\//.test(c.site || "")) throw new Error("config.site should be the dashboard's address, like https://www.defiedmgmt.com");
  if (!c.token || String(c.token).length < 24) throw new Error("config.token is missing (it's the token the site's LUMINATE_HELPER_TOKEN holds for this Mac)");
  const downloads = home(c.downloads || "~/Downloads");
  return {
    site: c.site.replace(/\/+$/, ""), token: String(c.token), device: String(c.device || os.hostname()).slice(0, 60),
    downloads, doneDir: home(c.doneDir || path.join(downloads, "Luminate (done)")),
    settleMs: c.settleMs ?? 10000, quietMs: c.quietMs ?? 45000, scanMs: c.scanMs ?? 15000, pingMs: c.pingMs ?? 1800000, retryMs: c.retryMs ?? 60000,
  };
}

// a free name in the done folder: "x.csv", then "x (2).csv", …
function freeName(dir, name) {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const ext = path.extname(name), base = name.slice(0, -ext.length);
  for (let i = 2; ; i++) if (!fs.existsSync(path.join(dir, `${base} (${i})${ext}`))) return `${base} (${i})${ext}`;
}

export function createHelper(cfg, { fetchImpl = fetch } = {}) {
  const seen = new Map(); // name -> { size, mtimeMs, stableAt }
  const sent = new Map(); // name -> mtimeMs: answered for (in case it couldn't be moved)
  let lastChange = Date.now(), restUntil = 0, failures = 0, lastPing = 0, busy = false;
  const headers = { Authorization: `Bearer ${cfg.token}`, "X-Helper-Device": cfg.device, "X-Helper-Version": VERSION };

  function scan() {
    let names = [];
    try { names = fs.readdirSync(cfg.downloads); } catch (err) { log(`can't read ${cfg.downloads}: ${err.message} (on a Mac, give node access to Downloads: see README.txt)`); return []; }
    const t = Date.now(), ready = [];
    for (const name of names) {
      if (!EXPORT_RE.test(name)) continue;
      let st;
      try { st = fs.statSync(path.join(cfg.downloads, name)); } catch { continue; }
      if (!st.isFile() || st.size === 0) continue;
      if (sent.get(name) === st.mtimeMs) continue;
      const cur = seen.get(name);
      if (!cur || cur.size !== st.size || cur.mtimeMs !== st.mtimeMs) { seen.set(name, { size: st.size, mtimeMs: st.mtimeMs, stableAt: null, since: t }); lastChange = t; continue; }
      // unchanged since the last look for settleMs: done downloading
      if (t - cur.since >= cfg.settleMs) { if (!cur.stableAt) { cur.stableAt = t; lastChange = t; } ready.push(name); }
    }
    for (const name of seen.keys()) if (!names.includes(name)) seen.delete(name);
    return ready;
  }

  function moveDone(name) {
    try {
      fs.mkdirSync(cfg.doneDir, { recursive: true });
      const to = freeName(cfg.doneDir, name);
      fs.renameSync(path.join(cfg.downloads, name), path.join(cfg.doneDir, to));
      seen.delete(name);
      return to;
    } catch (err) {
      log(`couldn't move ${name} to ${cfg.doneDir}: ${err.message}`);
      return null;
    }
  }

  async function send(names) {
    const files = [];
    let bytes = 0;
    for (const name of names.sort()) {
      if (files.length >= MAX_FILES) break;
      const text = fs.readFileSync(path.join(cfg.downloads, name), "utf8");
      if (files.length && bytes + text.length > MAX_BYTES) break;
      files.push({ name, text, mtimeMs: fs.statSync(path.join(cfg.downloads, name)).mtimeMs });
      bytes += text.length;
    }
    log(`sending ${files.length} file${files.length === 1 ? "" : "s"}: ${files.map((f) => f.name).join(", ")}`);
    let res, json = null;
    try {
      res = await fetchImpl(`${cfg.site}/api/luminate-helper`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ files: files.map(({ name, text }) => ({ name, text })) }) });
      json = await res.json().catch(() => null);
    } catch (err) {
      return rest(`the site didn't answer (${err.message})`);
    }
    if (res.status === 401 || res.status === 503) return rest(`the site said: ${json?.error || res.status}`, 30 * cfg.retryMs);
    // a 502 with per-file results means the files were taken in (the sheet update is what failed)
    if (!Array.isArray(json?.results)) return rest(`the site answered ${res.status}${json?.error ? `: ${json.error}` : ""}`);
    for (const r of json.results) {
      const f = files.find((x) => x.name === r.fileName);
      if (!f) continue;
      sent.set(f.name, f.mtimeMs);
      const to = moveDone(f.name);
      log(`${f.name}: ${r.status}${r.reason ? ` (${r.reason})` : ""}${to ? ` -> ${path.basename(cfg.doneDir)}/${to}` : ""}`);
    }
    if (json.error) log(`note from the site: ${json.error}`);
    // a file it sent but heard nothing about stays, and waits like after a failure (never sent in a loop)
    const missing = files.filter((f) => !json.results.some((r) => r.fileName === f.name));
    if (missing.length) rest(`the site didn't answer for ${missing.map((f) => f.name).join(", ")}`);
    else failures = 0;
    return json;
  }

  // waits a while after a failure: 1, 2, 4 … up to 30 minutes (or as long as asked)
  function rest(why, ms) {
    failures++;
    const wait = ms || Math.min(30 * cfg.retryMs, cfg.retryMs * 2 ** (failures - 1));
    restUntil = Date.now() + wait;
    log(`${why}. Trying again in ${wait >= 60000 ? `${Math.round(wait / 60000)} min` : `${Math.ceil(wait / 1000)} s`}.`);
    return null;
  }

  async function ping() {
    lastPing = Date.now();
    try {
      const res = await fetchImpl(`${cfg.site}/api/luminate-helper`, { headers });
      const json = await res.json().catch(() => null);
      if (!res.ok) log(`check-in refused: ${json?.error || res.status}`);
      return { ok: res.ok, status: res.status, json };
    } catch (err) { log(`check-in failed: ${err.message}`); return { ok: false, error: err.message }; }
  }

  // one look: send what's ready once nothing has changed for quietMs (several portfolios land together)
  async function tick({ force = false } = {}) {
    if (busy) return null;
    busy = true;
    try {
      if (Date.now() - lastPing >= cfg.pingMs) await ping();
      const ready = scan();
      if (!ready.length || Date.now() < restUntil) return null;
      const settling = [...seen.values()].some((s) => !s.stableAt);
      if (!force && (settling || Date.now() - lastChange < cfg.quietMs)) return null;
      return await send(ready);
    } finally { busy = false; }
  }

  return { scan, tick, ping, send, state: () => ({ seen: [...seen.keys()], sent: [...sent.keys()], restUntil, failures }) };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const cfg = loadConfig();
  const h = createHelper(cfg);
  if (args.has("--check")) {
    const r = await h.ping();
    console.log(r.ok ? `OK: ${cfg.site} knows this Mac as "${r.json?.device}".` : `Not OK: ${r.json?.error || r.error || r.status}`);
    process.exit(r.ok ? 0 : 1);
  }
  if (args.has("--once")) {
    // two looks settleMs apart, so a file still downloading isn't sent half-written
    h.scan();
    await new Promise((r) => setTimeout(r, cfg.settleMs));
    await h.tick({ force: true });
    return;
  }
  log(`Defied Luminate helper ${VERSION} watching ${cfg.downloads} for ${cfg.site} (as ${cfg.device})`);
  let timer = null;
  const soon = () => { clearTimeout(timer); timer = setTimeout(() => h.tick().catch((e) => log(`error: ${e.message}`)), 500); };
  try { fs.watch(cfg.downloads, { persistent: true }, (ev, name) => { if (name && EXPORT_RE.test(String(name))) soon(); }); } catch (err) { log(`can't watch ${cfg.downloads} (${err.message}); looking every ${cfg.scanMs / 1000} s instead`); }
  setInterval(() => h.tick().catch((e) => log(`error: ${e.message}`)), cfg.scanMs);
  await h.tick();
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("luminate-helper.mjs")) {
  main().catch((err) => { log(err.message); process.exit(1); });
}
