// The Sync view (r7, scratchpad sync-audit/REPORT.md): is everything the dashboard reads in step with
// where it comes from? Each check is one line, green or amber (null = it couldn't be checked just now),
// with the fix when the app has one. Reads only: nothing here writes anywhere. Server-only.
//   pubSheet   the site's songs vs the pub sheet's MASTER (streams and money, client by client)
//   splits     each song's own share vs its writer-tab row (from the last sheet pull), songs not on the sheet
//   streamData STREAM DATA vs the newest Luminate exports, and how old those exports are
//   stripe     Stripe payments the accounting sheet's Income tab doesn't have
//   info       the accounting sheet's INFO client list vs the site's clients
//   outreach   OUTREACH vs the Luminate A&R lists (both ways)
//   clickup    overdue ClickUp tasks on the dashboard's lists
import { sql } from "./db";
import { getSheetsClient, getSheetId, readMasterRollup } from "./sheets";
import { ownerOf, personKey } from "./names";
import { streamDataRows, streamDataNow } from "./luminate";
import { readSheetFacts } from "./sheet-facts-store";
import { moneyState } from "./money";
import { incomeOptions } from "./accounting-log";
import { accountingSheetId } from "./accounting";
import { arWatchNow } from "./ar";
import { allTasks } from "./clickup-tasks";

const s = (n, one, many) => (n === 1 ? one : many);
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const usd = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const DAY = 864e5;
const nyDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
const shortDay = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

// --- pure comparisons (unit-tested in tests/sync-checks-unit.mjs) ---------------------------------
// MASTER's writer rows against the site's own sums per client. rows: readMasterRollup().rows;
// placements: DB rows; clients: DB rows (id, name, sheet_tab_name). Only clients MASTER has a row for.
export function comparePubSheet({ rows = [], placements = [], clients = [] }) {
  const sums = new Map();
  for (const p of placements) {
    const x = sums.get(p.client_id) || { streams: 0, revenue: 0, fee: 0 };
    x.streams += Number(p.streams) || 0; x.revenue += Number(p.revenue) || 0; x.fee += Number(p.admin_fee) || 0;
    sums.set(p.client_id, x);
  }
  const streams = [], money = [];
  let site = { streams: 0, revenue: 0, fee: 0 }, sheet = { streams: 0, revenue: 0, fee: 0 };
  for (const r of rows) {
    const c = ownerOf(clients, r.sheetTab || r.writer);
    if (!c) continue;
    const x = sums.get(c.id) || { streams: 0, revenue: 0, fee: 0 };
    site = { streams: site.streams + x.streams, revenue: site.revenue + x.revenue, fee: site.fee + x.fee };
    sheet = { streams: sheet.streams + r.grossStreams, revenue: sheet.revenue + r.grossRevenue, fee: sheet.fee + r.adminFee };
    if (Math.abs(x.streams - r.grossStreams) > 1) streams.push(c.name);
    if (Math.abs(x.revenue - r.grossRevenue) > 1 || Math.abs(x.fee - r.adminFee) > 1) money.push(c.name);
  }
  return { streams, money, site, sheet };
}

// Each song's own share against the share on its writer-tab row (sheet facts), and songs on a client
// whose tab was read that have no row. A third of a percent is rounding (33 vs 1/3), not a difference.
export function compareSplits({ placements = [], clients = [], facts = { songs: {}, clients: {} } }) {
  const byId = new Map(clients.map((c) => [c.id, c]));
  const differ = [], offSheet = [];
  for (const p of placements) {
    const c = byId.get(p.client_id);
    if (!c || facts.clients?.[p.client_id] == null) continue;
    const f = facts.songs?.[p.id];
    if (!f) { offSheet.push(p.song); continue; }
    const keys = new Set([personKey(c.name), personKey(c.credit)].filter(Boolean));
    const own = (p.splits || []).find((x) => keys.has(personKey(x.name)));
    const mine = own ? Number(own.percent) || 0 : 0;
    const theirs = f.share == null ? 0 : Number(f.share);
    if (Math.abs(mine - theirs) > 0.5) differ.push({ song: p.song, client: c.name, site: mine, sheet: f.share });
  }
  return { differ, offSheet };
}

// STREAM DATA's rows ([id, name, owners, streams, …]) against what the newest exports say
export function compareStreamData({ values = [], latest = [] }) {
  const want = streamDataRows(latest);
  const have = new Map(values.filter((r) => r[0]).map((r) => [String(r[0]), Number(r[3]) || 0]));
  let behind = 0, gap = 0;
  for (const [id, row] of want) {
    const h = have.get(String(id));
    if (h === undefined || Math.abs(h - row[3]) > 0) { behind++; gap += row[3] - (h || 0); }
  }
  return { behind, gap };
}

// INFO's names against the site's clients (on the roster, or with songs)
export function compareInfo({ info = [], clients = [], placements = [] }) {
  const withSongs = new Set(placements.map((p) => p.client_id));
  const site = clients.filter((c) => c.on_roster || withSongs.has(c.id));
  const infoKeys = new Set(info.map(personKey));
  const siteKeys = new Set(site.flatMap((c) => [personKey(c.name), personKey(c.credit), personKey(c.sheet_tab_name)].filter(Boolean)));
  return { siteOnly: site.filter((c) => ![c.name, c.credit, c.sheet_tab_name].some((n) => n && infoKeys.has(personKey(n)))).map((c) => c.name), infoOnly: info.filter((n) => !siteKeys.has(personKey(n))) };
}

const list = (xs, n = 3) => (xs.length > n ? `${xs.slice(0, n).join(", ")} and ${xs.length - n} more` : xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] || "");
const failed = (id, what) => ({ id, ok: null, text: `Couldn't check ${what} just now.` });

// --- the checks ----------------------------------------------------------------------------------
async function pubSheetCheck(db) {
  try {
    const roll = await readMasterRollup(getSheetsClient(), getSheetId());
    const r = comparePubSheet({ rows: roll.rows, placements: db.placements, clients: db.clients });
    if (!r.streams.length && !r.money.length) return { id: "pubSheet", ok: true, text: `Site and pub sheet match: ${fmt(r.sheet.streams)} streams, ${usd(r.sheet.fee)} fee.` };
    const parts = [r.streams.length && `streams differ for ${list(r.streams)}`, r.money.length && `money is ${usd(r.site.fee)} fee on the site vs ${usd(r.sheet.fee)} on the sheet`].filter(Boolean);
    return { id: "pubSheet", ok: false, text: `Site vs pub sheet: ${parts.join("; ")}.`, fix: { kind: "pull", label: "Pull from the sheet" } };
  } catch (err) { console.error("sync: pub sheet", err); return failed("pubSheet", "the pub sheet"); }
}

async function splitsCheck(db) {
  try {
    const r = compareSplits({ placements: db.placements, clients: db.clients, facts: await readSheetFacts() });
    if (!r.differ.length && !r.offSheet.length) return { id: "splits", ok: true, text: "Every song's share matches its row on the pub sheet." };
    const parts = [r.differ.length && `${r.differ.length} ${s(r.differ.length, "song's share differs", "songs' shares differ")} from the sheet (${list(r.differ.map((x) => x.song), 2)})`,
      r.offSheet.length && `${r.offSheet.length} ${s(r.offSheet.length, "song isn't", "songs aren't")} on the sheet`].filter(Boolean);
    return { id: "splits", ok: false, text: `${parts.join(" · ")}.`, fix: { kind: "todo", area: "roster", label: "Review" } };
  } catch (err) { console.error("sync: splits", err); return failed("splits", "the splits"); }
}

async function streamDataCheck(now) {
  try {
    const { values, latest } = await streamDataNow();
    const r = compareStreamData({ values, latest });
    const newest = latest.map((x) => x.exported_at && new Date(x.exported_at).getTime()).filter(Boolean).sort().pop() || null;
    const age = newest ? (now - newest) / DAY : null;
    if (r.behind) return { id: "streamData", ok: false, text: `STREAM DATA is behind the newest exports: ${r.behind} ${s(r.behind, "song", "songs")}${r.gap ? `, ${r.gap > 0 ? "+" : ""}${fmt(r.gap)} streams` : ""}.`, fix: { kind: "resync", label: "Update the sheet" } };
    if (age === null) return { id: "streamData", ok: false, text: "No Luminate export has been dropped in yet.", fix: { kind: "todo", area: "luminate", label: "Drop exports" } };
    if (age > 8) return { id: "streamData", ok: false, text: `STREAM DATA matches the newest exports, but those are from ${shortDay(newest)} (${Math.floor(age)} days ago).`, fix: { kind: "todo", area: "luminate", label: "Drop new exports" } };
    return { id: "streamData", ok: true, text: `STREAM DATA matches the newest exports (${shortDay(newest)}).` };
  } catch (err) { console.error("sync: stream data", err); return failed("streamData", "STREAM DATA"); }
}

async function stripeCheck(m) {
  if (!m.pay.connected || !m.acct.connected) return { id: "stripe", ok: null, text: "Stripe or the accounting sheet isn't connected yet." };
  if (!m.match) return failed("stripe", "Stripe against the Income tab");
  const n = m.match.unlogged.length;
  if (!n) return { id: "stripe", ok: true, text: "Every Stripe payment is in the Income tab." };
  return { id: "stripe", ok: false, text: `${n} Stripe ${s(n, "payment isn't", "payments aren't")} in the Income tab (${usd(m.match.unloggedTotal / 100)} paid).`, fix: { kind: "todo", area: "money", label: "Log them" } };
}

async function infoCheck(db, m) {
  if (!accountingSheetId()) return { id: "info", ok: null, text: "The accounting sheet isn't connected yet." };
  try {
    const opts = await incomeOptions({ rows: m.acct?.rows || [] });
    const r = compareInfo({ info: opts.clients, clients: db.clients, placements: db.placements });
    if (!r.siteOnly.length && !r.infoOnly.length) return { id: "info", ok: true, text: "INFO lists the same clients as the site." };
    const parts = [r.siteOnly.length && `on the site only: ${list(r.siteOnly)}`, r.infoOnly.length && `on INFO only: ${list(r.infoOnly)}`].filter(Boolean);
    return { id: "info", ok: false, text: `INFO vs the site's clients: ${parts.join("; ")}.`, fix: { kind: "url", label: "Open the sheet ↗", url: `https://docs.google.com/spreadsheets/d/${accountingSheetId()}/edit` } };
  } catch (err) { console.error("sync: info", err); return failed("info", "INFO"); }
}

async function outreachCheck() {
  try {
    const { watch, toLuminate } = await arWatchNow();
    // in a Luminate A&R list but not on OUTREACH or the Watchlist: keep tracking them (the owner), so only said
    const loose = (watch?.people || []).filter((r) => !r.ref).map((r) => r.name).filter(Boolean);
    const n = toLuminate?.count || 0;
    if (!n && !loose.length) return { id: "outreach", ok: true, text: "OUTREACH and the Luminate A&R lists match." };
    if (!n) return { id: "outreach", ok: true, text: `OUTREACH is in the Luminate A&R lists. ${loose.length} more in the lists only (${list(loose)}), tracked from there.` };
    return { id: "outreach", ok: false, text: `${toLuminate.text}${loose.length ? ` ${loose.length} more are in the lists but not on OUTREACH.` : ""}`, fix: { kind: "todo", area: "ar", label: "Add them" } };
  } catch (err) { console.error("sync: outreach", err); return failed("outreach", "OUTREACH"); }
}

async function clickupCheck(now) {
  try {
    const { lists, tasks } = await allTasks();
    const today = nyDay(new Date(now));
    const late = tasks.filter((t) => t.due && nyDay(new Date(t.due)) < today);
    const down = lists.filter((l) => l.error);
    if (down.length === lists.length) return failed("clickup", "ClickUp");
    if (!late.length) return { id: "clickup", ok: true, text: `No overdue ClickUp tasks${down.length ? ` (${down.length} ${s(down.length, "list", "lists")} couldn't be read)` : ""}.` };
    return { id: "clickup", ok: false, text: `${late.length} ClickUp ${s(late.length, "task is", "tasks are")} overdue (${list(late.map((t) => t.name), 2)}).`, fix: { kind: "todo", area: "clickup", label: "See them" } };
  } catch (err) { console.error("sync: clickup", err); return failed("clickup", "ClickUp"); }
}

// Every check at once; one that fails says so on its own line
export async function syncChecks({ now = Date.now() } = {}) {
  const [placements, clients] = await Promise.all([sql`SELECT id, client_id, song, streams, revenue, admin_fee, splits FROM placements`, sql`SELECT id, name, credit, sheet_tab_name, on_roster FROM clients`]);
  const db = { placements, clients };
  const m = await moneyState().catch(() => ({ pay: {}, acct: {}, match: null }));
  const checks = await Promise.all([pubSheetCheck(db), splitsCheck(db), streamDataCheck(now), stripeCheck(m), infoCheck(db, m), outreachCheck(), clickupCheck(now)]);
  return { at: new Date(now).toISOString(), checks, outOfSync: checks.filter((c) => c.ok === false).length };
}
