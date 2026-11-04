#!/usr/bin/env node
// Defied Luminate export bot. SHIPS OFF: it does nothing unless bot-config.json says "enabled": true,
// which only the owner should set, after reading README.txt (Luminate's terms restrict automated
// access: Terms of Use, March 2026, 2.3(h) and 2.3(i)).
//
// A fixed script, no AI in the loop: for each of the 4 portfolios it opens the portfolio's page in a
// Chrome profile of its own (the owner signs in to Luminate there once, with --sign-in), sets the time
// period to 1 week and the territory to Worldwide, presses Export CSV, and waits for the file to land
// in Downloads, where the Mac helper picks it up. It only ever navigates to those 4 pages and only
// clicks the period control, the territory control, their "1 Week" / "Worldwide" options and Export.
// Anything unexpected (signed out, a control missing or there twice, a dialog, a page it didn't open,
// no file) stops it at once: a screenshot is kept and the dashboard is told (ClickUp Dashboard Alerts).
//
//   node export-bot.mjs --sign-in   open the bot's own Chrome profile to sign in to Luminate (no clicks)
//   node export-bot.mjs --dry-run   every step but Export, with a screenshot per step
//   node export-bot.mjs             the real run (launchd's weekly job, only if installed with --with-bot)
//
// Needs puppeteer-core next to it (install.sh --with-bot puts it there) and Google Chrome.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const home = (p) => String(p || "").replace(/^~(?=$|\/)/, os.homedir());
const APP = path.join(os.homedir(), "Library", "Application Support", "Defied Luminate Helper");
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const DEFAULTS = {
  enabled: false,
  base: "https://app.luminatedata.com",
  chrome: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  profileDir: path.join(APP, "luminate-chrome-profile"),
  downloads: "~/Downloads",
  screenshotsDir: path.join(os.homedir(), "Library", "Logs", "Defied Luminate Helper", "bot"),
  helperConfig: path.join(APP, "config.json"), // the Mac helper's (site + token): how a stop reaches ClickUp
  headless: true,
  pauseMs: [1200, 3500], // a person's pace between steps
  downloadWaitMs: 90000,
  portfolios: [
    { name: "Admin Catalog 1", id: "POR2D7C3C99583C47AB97903870A7BF68B9" },
    { name: "Admin Catalog 2", id: "PORD63A45A7E3214C9BA012EAE23C93E274" },
    { name: "Artist Tracker", id: "POR069D735D69A24B35AEE8B7FF6D221BA4" },
    { name: "Song Tracker", id: "POR074E2117846F41B1A02150A26A5B0599" },
  ],
  // what the controls say on the page (exact words, case aside; "|" = either). The owner can adjust
  // these if Luminate renames a button: nothing else is ever clicked.
  ui: {
    signedIn: "Export CSV",                       // words a portfolio page shows only when signed in
    periodControl: "^(time period|period)\\b",    // the control that opens the period menu
    periodOption: "^(1 week|last 1 week|1w)$",
    territoryControl: "^(territory|market|location)\\b",
    territoryOption: "^(worldwide|global|all territories)$",
    exportButton: "^(export csv|export)$",
    exportConfirm: "",                            // a second button some export dialogs ask for ("" = none)
  },
};

export function loadBotConfig(file = process.env.BOT_CONFIG || path.join(APP, "bot-config.json")) {
  let c = {};
  if (fs.existsSync(file)) c = JSON.parse(fs.readFileSync(file, "utf8"));
  const cfg = { ...DEFAULTS, ...c, ui: { ...DEFAULTS.ui, ...(c.ui || {}) } };
  for (const k of ["profileDir", "downloads", "screenshotsDir", "helperConfig"]) cfg[k] = home(cfg[k]);
  cfg.base = String(cfg.base).replace(/\/+$/, "");
  if (!cfg.portfolios.every((p) => /^POR[0-9A-F]{16,}$/i.test(p.id))) throw new Error("bot-config portfolios need their POR… ids");
  return cfg;
}

class Stop extends Error { constructor(step, message) { super(message); this.step = step; } }

// the dashboard hears about a stop through the helper's own door (its site + token): one ClickUp line
async function report(cfg, step, message) {
  try {
    const h = JSON.parse(fs.readFileSync(cfg.helperConfig, "utf8"));
    const res = await fetch(`${String(h.site).replace(/\/+$/, "")}/api/luminate-helper`, {
      method: "POST", headers: { Authorization: `Bearer ${h.token}`, "Content-Type": "application/json", "X-Helper-Device": h.device || os.hostname() },
      body: JSON.stringify({ event: "botProblem", step, message }),
    });
    log(`told the dashboard (${res.status})`);
  } catch (err) { log(`couldn't tell the dashboard: ${err.message}`); }
}

function loadPuppeteer(cfg) {
  const req = createRequire(import.meta.url);
  for (const from of [cfg.puppeteerPath, "puppeteer-core"].filter(Boolean)) {
    try { return req(from); } catch {}
  }
  throw new Error("puppeteer-core isn't installed next to the bot. Run install.sh --with-bot.");
}

export async function runBot(cfg, { dryRun = false, signIn = false } = {}) {
  const base = new URL(cfg.base);
  if (!cfg.enabled) {
    log("The export bot is off (bot-config.json: \"enabled\": false). See README.txt before turning it on.");
    return { off: true };
  }
  const puppeteer = loadPuppeteer(cfg);
  fs.mkdirSync(cfg.profileDir, { recursive: true });
  const day = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const shots = path.join(cfg.screenshotsDir, `${day}${dryRun ? "-dry-run" : ""}`);
  fs.mkdirSync(shots, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: cfg.chrome, userDataDir: cfg.profileDir, headless: signIn ? false : cfg.headless ? "new" : false,
    defaultViewport: { width: 1440, height: 900 },
    args: ["--no-first-run", "--no-default-browser-check", "--disable-sync", "--disable-background-networking"],
  });
  if (signIn) {
    // the owner signs in by hand; the bot clicks nothing and waits for the window to close
    const page = (await browser.pages())[0] || (await browser.newPage());
    await page.goto(`${cfg.base}/`, { waitUntil: "domcontentloaded" }).catch(() => {});
    log("Sign in to Luminate in the window that opened, then close it.");
    await new Promise((r) => browser.on("disconnected", r));
    return { signedIn: true };
  }
  const done = [], steps = [];
  let n = 0;
  const pause = () => sleep(cfg.pauseMs[0] + Math.random() * (cfg.pauseMs[1] - cfg.pauseMs[0]));
  try {
    const cdp = await browser.target().createCDPSession();
    await cdp.send("Browser.setDownloadBehavior", { behavior: dryRun ? "deny" : "allow", downloadPath: cfg.downloads, eventsEnabled: true });
    const page = await browser.newPage();
    let unexpected = null;
    page.on("dialog", async (d) => { unexpected = `a dialog appeared ("${d.message().slice(0, 80)}")`; await d.dismiss().catch(() => {}); });
    // only Luminate's own address, ever: a page that leads anywhere else stops the run
    page.on("framenavigated", (f) => { if (f === page.mainFrame() && new URL(f.url()).origin !== base.origin && f.url() !== "about:blank") unexpected = `the page went to ${new URL(f.url()).origin}`; });
    const shot = async (label) => {
      const file = path.join(shots, `${String(++n).padStart(2, "0")}-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`);
      await page.screenshot({ path: file }).catch(() => {});
      steps.push({ label, file });
    };
    const check = (step) => { if (unexpected) throw new Stop(step, unexpected); };
    // the one element whose words match `pattern` among buttons, menu items and options; none or more
    // than one is unexpected. Returns its handle; the bot clicks nothing it didn't find this way.
    const only = async (step, pattern) => {
      const re = new RegExp(pattern, "i");
      const handles = await page.$$("button, [role=button], [role=menuitem], [role=option], [role=menuitemradio], [role=tab], a[href], li[data-value]");
      const hits = [];
      for (const h of handles) {
        const info = await h.evaluate((el) => {
          const r = el.getBoundingClientRect(), s = getComputedStyle(el);
          return { text: (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim(), visible: r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none", disabled: !!el.disabled || el.getAttribute("aria-disabled") === "true" };
        });
        if (info.visible && !info.disabled && re.test(info.text)) hits.push({ h, text: info.text });
      }
      if (hits.length !== 1) throw new Stop(step, hits.length ? `"${pattern}" matched ${hits.length} things on the page (${hits.map((x) => x.text).join(" / ").slice(0, 120)})` : `couldn't find "${pattern}" on the page`);
      return hits[0];
    };
    const click = async (step, pattern) => { const { h, text } = await only(step, pattern); await h.click(); await pause(); check(step); await shot(step); return text; };
    for (const p of cfg.portfolios) {
      const url = `${cfg.base}/portfolios/${p.id}`;
      await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
      await pause();
      await shot(`${p.name} opened`);
      check(`Open ${p.name}`);
      if (new URL(page.url()).pathname !== `/portfolios/${p.id}`) throw new Stop(`Open ${p.name}`, `Luminate showed ${new URL(page.url()).pathname} instead of the portfolio (signed out? run --sign-in)`);
      const body = await page.evaluate(() => document.body.innerText || "");
      if (!new RegExp(cfg.ui.signedIn, "i").test(body)) throw new Stop(`Open ${p.name}`, "the portfolio page doesn't look signed in (run --sign-in)");
      await click(`${p.name}: period menu`, cfg.ui.periodControl);
      await click(`${p.name}: 1 week`, cfg.ui.periodOption);
      const period = (await only(`${p.name}: check period`, cfg.ui.periodControl)).text;
      if (!/1 ?w/i.test(period)) throw new Stop(`${p.name}: check period`, `the period still reads "${period}"`);
      await click(`${p.name}: territory menu`, cfg.ui.territoryControl);
      await click(`${p.name}: worldwide`, cfg.ui.territoryOption);
      const territory = (await only(`${p.name}: check territory`, cfg.ui.territoryControl)).text;
      if (!/worldwide|global|all/i.test(territory)) throw new Stop(`${p.name}: check territory`, `the territory still reads "${territory}"`);
      if (dryRun) { log(`${p.name}: ready to export (dry run: Export not pressed)`); done.push({ ...p, dryRun: true }); continue; }
      const before = new Set(fs.readdirSync(cfg.downloads));
      const t0 = Date.now();
      await click(`${p.name}: export`, cfg.ui.exportButton);
      if (cfg.ui.exportConfirm) await click(`${p.name}: export (confirm)`, cfg.ui.exportConfirm);
      // its file in Downloads: portfolio-export-<this id>-<ms>.csv, new and no longer growing
      const want = new RegExp(`^portfolio-export-${p.id}-\\d{12,14}( \\(\\d+\\))?\\.csv$`, "i");
      let file = null, size = -1;
      while (Date.now() - t0 < cfg.downloadWaitMs) {
        const f = fs.readdirSync(cfg.downloads).find((x) => want.test(x) && !before.has(x));
        if (f) { const s = fs.statSync(path.join(cfg.downloads, f)).size; if (s > 0 && s === size) { file = f; break; } size = s; }
        await sleep(700);
      }
      if (!file) throw new Stop(`${p.name}: export`, "no export file came down within 90 seconds");
      log(`${p.name}: ${file}`);
      done.push({ ...p, file });
    }
    log(`done: ${done.length} of ${cfg.portfolios.length}${dryRun ? " (dry run)" : ""}. Screenshots: ${shots}`);
    return { ok: true, done, steps, shots };
  } catch (err) {
    const step = err.step || "run";
    log(`STOPPED at "${step}": ${err.message}`);
    try { const pages = await browser.pages(); await pages[pages.length - 1]?.screenshot({ path: path.join(shots, `${String(++n).padStart(2, "0")}-stopped.png`) }); } catch {}
    await report(cfg, step, err.message);
    return { ok: false, step, error: err.message, done, steps, shots };
  } finally {
    await browser.close().catch(() => {});
  }
}

if (process.argv[1]?.endsWith("export-bot.mjs")) {
  const args = new Set(process.argv.slice(2));
  const cfg = loadBotConfig();
  runBot(cfg, { dryRun: args.has("--dry-run"), signIn: args.has("--sign-in") })
    .then((r) => process.exit(r.off ? 2 : r.ok === false ? 1 : 0))
    .catch((err) => { log(err.message); process.exit(1); });
}
