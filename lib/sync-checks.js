// The Sync view (r7, scratchpad sync-audit/REPORT.md): is everything the dashboard reads in step with
// where it comes from? Each check is one line, green or amber (null = it couldn't be checked just now),
// with the fix when the app has one. Reads only: nothing here writes anywhere. Server-only.
//   pubSheet   the site's songs vs the pub sheet's MASTER (streams and money, client by client)
//   splits     each song's own share vs its writer-tab row (from the last sheet pull), songs not on the sheet
//   stripe     Stripe payments the accounting sheet's Income tab doesn't have
//   info       the accounting sheet's INFO client list vs the site's clients
//   clickup    overdue ClickUp tasks on the dashboard's lists
// (List B #3: Luminate is gone, and with it the STREAM DATA and "OUTREACH vs the Luminate A&R lists"
// checks. The pub sheet's STREAM DATA tab is left as it is: nothing here or anywhere writes it now.)
import { sql } from "./db";
import { getSheetsClient, getSheetId, readMasterRollup } from "./sheets";
import { ownerOf, personKey } from "./names";
import { readSheetFacts } from "./sheet-facts-store";
import { moneyState } from "./money";
import { incomeOptions } from "./accounting-log";
import { accountingSheetId } from "./accounting";
import { allTasks } from "./clickup-tasks";

const s = (n, one, many) => (n === 1 ? one : many);
// The INFO check's "Open the sheet" link. ACCOUNTING_SHEET_LINK_ID, when set, is used ONLY to build that
// link (never to read or write): a preview reads a stand-in sheet but can still open the real one (r10, H17).
export const sheetLinkId = () => String(process.env.ACCOUNTING_SHEET_LINK_ID || "").trim() || accountingSheetId();
export const sheetUrl = () => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetLinkId())}/edit`;
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const usd = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nyDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);

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

// INFO's names against the site's clients. Site only: on the roster, or with songs. INFO only: a real
// client name no site client has, hidden ones included (a hidden client on INFO is there on purpose),
// and never INFO's company row ("General / Company", for income that isn't one client's).
const NOT_A_CLIENT = /^(general|company|defied)\b|\bcompany$/i;
export function compareInfo({ info = [], clients = [], placements = [] }) {
  const withSongs = new Set(placements.map((p) => p.client_id));
  const site = clients.filter((c) => c.on_roster || withSongs.has(c.id));
  const infoKeys = new Set(info.map(personKey));
  const siteKeys = new Set(clients.flatMap((c) => [personKey(c.name), personKey(c.credit), personKey(c.sheet_tab_name)].filter(Boolean)));
  info = info.filter((n) => !NOT_A_CLIENT.test(String(n).trim()));
  return { siteOnly: site.filter((c) => ![c.name, c.credit, c.sheet_tab_name].some((n) => n && infoKeys.has(personKey(n)))).map((c) => c.name), infoOnly: info.filter((n) => !siteKeys.has(personKey(n))) };
}

const list = (xs, n = 3) => (xs.length > n ? `${xs.slice(0, n).join(", ")} and ${xs.length - n} more` : xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] || "");
const failed = (id, what) => ({ id, ok: null, text: `Couldn't check ${what} just now.` });

// --- the checks ----------------------------------------------------------------------------------
async function pubSheetCheck(db) {
  try {
    const roll = await readMasterRollup(getSheetsClient(), getSheetId());
    const r = comparePubSheet({ rows: roll.rows, placements: db.placements, clients: db.clients });
    // r10 fix: the fee as Publishing shows it (the site's own sum); a cent or so of sheet rounding is named, not hidden
    if (!r.streams.length && !r.money.length) {
      const cents = Math.round(Math.abs(r.site.fee - r.sheet.fee) * 100);
      return { id: "pubSheet", ok: true, text: `Site and pub sheet match: ${fmt(r.sheet.streams)} streams, ${usd(r.site.fee)} fee${cents ? ` (within ${cents}¢: the sheet rounds each row)` : ""}.` };
    }
    const parts = [r.streams.length && `streams differ for ${list(r.streams)}`, r.money.length && `money is ${usd(r.site.fee)} fee on the site vs ${usd(r.sheet.fee)} on the sheet`].filter(Boolean);
    return { id: "pubSheet", ok: false, text: `Site vs pub sheet: ${parts.join("; ")}.`, fix: { kind: "pull", label: "Pull from the sheet" } };
  } catch (err) { console.error("sync: pub sheet", err); return failed("pubSheet", "the pub sheet"); }
}

async function splitsCheck(db) {
  try {
    const r = compareSplits({ placements: db.placements, clients: db.clients, facts: await readSheetFacts() });
    if (!r.differ.length && !r.offSheet.length) return { id: "splits", ok: true, text: "Every song's share matches its row on the pub sheet." };
    // r10 fix: the same split as To do's lines (no split here, the sheet has one; or a different share), and "not on
    // the sheet" said as what it is: no row on the writer's tab in the last sheet read
    const none = r.differ.filter((x) => !x.site), other = r.differ.filter((x) => x.site);
    const parts = [none.length && `${none.length} ${s(none.length, "song has", "songs have")} no split here but a share on the sheet (${list(none.map((x) => x.song), 2)})`,
      other.length && `${other.length} ${s(other.length, "song's share differs", "songs' shares differ")} from the sheet (${list(other.map((x) => x.song), 2)})`,
      r.offSheet.length && `${r.offSheet.length} ${s(r.offSheet.length, "song has", "songs have")} no row on its writer's tab in the last sheet read (${list(r.offSheet, 2)})`].filter(Boolean);
    return { id: "splits", ok: false, text: `${parts.join(" · ")}.`, fix: { kind: "todo", area: "roster", label: "Review" } };
  } catch (err) { console.error("sync: splits", err); return failed("splits", "the splits"); }
}

async function stripeCheck(m) {
  if (!m.pay.connected || !m.acct.connected) return { id: "stripe", ok: null, text: "Stripe or the accounting sheet isn't connected yet." };
  if (!m.match) return failed("stripe", "Stripe against the Income tab");
  const n = m.match.unlogged.length;
  if (!n) return { id: "stripe", ok: true, text: "Every Stripe payment is in the Income tab." };
  // r10 fix: what they paid and Defied's share of it, the number Money's "not logged yet" line shows
  const share = (m.match.unlogged || []).reduce((a, p) => a + (Number(p.fee) || 0), 0);
  return { id: "stripe", ok: false, text: `${n} Stripe ${s(n, "payment isn't", "payments aren't")} in the Income tab (${usd(m.match.unloggedTotal / 100)} paid, ${usd(share / 100)} of it Defied's share).`, fix: { kind: "todo", area: "money", label: "Log them" } };
}

async function infoCheck(db, m) {
  if (!accountingSheetId()) return { id: "info", ok: null, text: "The accounting sheet isn't connected yet." };
  try {
    const opts = await incomeOptions({ rows: m.acct?.rows || [] });
    const r = compareInfo({ info: opts.clients, clients: db.clients, placements: db.placements });
    if (!r.siteOnly.length && !r.infoOnly.length) return { id: "info", ok: true, text: "INFO lists the same clients as the site." };
    const parts = [r.siteOnly.length && `${r.siteOnly.length} on the site only`, r.infoOnly.length && `${r.infoOnly.length} on INFO only`].filter(Boolean);
    const detail = [r.siteOnly.length && `On the site only: ${list(r.siteOnly, 6)}.`, r.infoOnly.length && `On INFO only: ${list(r.infoOnly, 6)}.`].filter(Boolean).join(" ");
    return { id: "info", ok: false, text: `The accounting sheet's INFO tab and the site list different clients: ${parts.join(", ")}.`, detail, fix: { kind: "url", label: "Open the sheet ↗", url: sheetUrl() } };
  } catch (err) { console.error("sync: info", err); return failed("info", "INFO"); }
}

async function clickupCheck(now) {
  try {
    const { lists, tasks } = await allTasks();
    const today = nyDay(new Date(now));
    const late = tasks.filter((t) => t.due && nyDay(new Date(t.due)) < today);
    const down = lists.filter((l) => l.error), hidden = down.filter((l) => l.noAccess);
    // r10 (C2): a list Defied Bot isn't shared on is never "fine": it's named, and the fix is in ClickUp
    if (hidden.length) {
      const lateText = late.length ? ` ${late.length} ClickUp ${s(late.length, "task is", "tasks are")} overdue on the others.` : "";
      return { id: "clickup", ok: false, text: `Defied Bot can't see ${hidden.length} ClickUp ${s(hidden.length, "list", "lists")}: ${list(hidden.map((l) => l.name), 8)}. Share ${s(hidden.length, "it", "them")} with Defied Bot in ClickUp.${lateText}`,
        detail: "Until then those lists look empty here. In ClickUp, share the space or folder each one is in with Defied Bot (Edit, so Done ✓ and New task work), then Check again.", fix: { kind: "todo", area: "clickup", label: "See the lists" }, lists: hidden.map((l) => l.key) };
    }
    if (down.length === lists.length) return failed("clickup", "ClickUp");
    if (down.length) return { id: "clickup", ok: false, text: `Couldn't read ${down.length} ClickUp ${s(down.length, "list", "lists")} just now (${list(down.map((l) => l.name), 8)}).${late.length ? ` ${late.length} ${s(late.length, "task is", "tasks are")} overdue on the others.` : ""}`, fix: { kind: "todo", area: "clickup", label: "Review" } };
    if (!late.length) return { id: "clickup", ok: true, text: "No overdue ClickUp tasks." };
    return { id: "clickup", ok: false, text: `${late.length} ClickUp ${s(late.length, "task is", "tasks are")} overdue (${list(late.map((t) => t.name), 2)}).`, fix: { kind: "todo", area: "clickup", label: "Review" } };
  } catch (err) { console.error("sync: clickup", err); return failed("clickup", "ClickUp"); }
}

// Every check at once; one that fails says so on its own line
// money: false (an account without Money, lib/roles.js) leaves out the Stripe and INFO checks and their reads
export async function syncChecks({ now = Date.now(), money = true } = {}) {
  const [placements, clients] = await Promise.all([sql`SELECT id, client_id, song, streams, revenue, admin_fee, splits FROM placements`, sql`SELECT id, name, credit, sheet_tab_name, on_roster FROM clients`]);
  const db = { placements, clients };
  const m = money ? await moneyState().catch(() => ({ pay: {}, acct: {}, match: null })) : null;
  const checks = await Promise.all([pubSheetCheck(db), splitsCheck(db), ...(m ? [stripeCheck(m), infoCheck(db, m)] : []), clickupCheck(now)]);
  return { at: new Date(now).toISOString(), checks, outOfSync: checks.filter((c) => c.ok === false).length };
}
