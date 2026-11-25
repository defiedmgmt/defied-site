// The Sync view (r7, scratchpad sync-audit/REPORT.md): is everything the dashboard reads in step with
// where it comes from? Each check is one line, green or amber (null = it couldn't be checked just now),
// with the fix when the app has one. Reads only, but for the INFO check's copy of the managers (below). Server-only.
//   pubSheet   the site's songs vs the pub sheet's MASTER (streams and money, client by client)
//   splits     each song's own share vs its writer-tab row (from the last sheet pull), songs not on the sheet
//   stripe     Stripe payments the accounting sheet's Income tab doesn't have
//   info       the accounting sheet's INFO client list vs the site's clients, and each client's manager (2026-11-13).
//              When the managers differ, the site copies INFO's again by itself first (at most every 2 minutes): the
//              one write here, to clients.manager, the same as Site › Users' "Update from the sheet"
//   clickup    overdue ClickUp tasks on the dashboard's lists
//   arSheet    (r11) the A&R sheet, a one-way copy: Off, when it was last written and how many rows, or the error
//   room       (2026-11-13) empty song rows on each writer tab, from the nightly check (lib/sheet-rows.js keepRoom)
//   scheduleA  (2026-11-20) the Schedule A sheet (lib/schedule-a.js), Publishing accounts: when it last synced, its songs and the ones only on the sheet, the link and a
//              Sync Schedule A now button; amber when the last sync failed. A change waiting (a save inside the 2-minute gap) or a failed run is caught up here first
//   alerts     (2026-11-17) the last 7 days of failed-job alerts (lib/alerts.js), Money accounts only; never amber
// (List B #3: Luminate is gone, and with it the STREAM DATA and "OUTREACH vs the Luminate A&R lists"
// checks. The pub sheet's STREAM DATA tab is left as it is: nothing here or anywhere writes it now.)
import { masterOverview } from "./sheet-cache";
import { sql } from "./db";
import { getSheetsClient, getSheetId, readMasterRollup } from "./sheets";
import { ownerOf, personKey } from "./names";
import { readSheetFacts } from "./sheet-facts-store";
import { moneyState } from "./money";
import { accountingSheetId } from "./accounting";
import { sameManager } from "./roles";
import { allTasks } from "./clickup-tasks";
import { trackerSheetStatus } from "./ar/tracker-sheet";
import { getState, claimState } from "./app-state";
import { refreshManagers } from "./info-managers";
import { ROOM_KEY, ROOM_MIN, ROOM_ADD } from "./sheet-rows";
import { tabLink } from "./sheets";
import { infoOwnerOf, withInfoNames } from "./info-links";
import { runPeopleLink, lastPeopleLink, autolinkOn } from "./people-link";
import { ALERTS_KEY, WHY, alertGate, recentAlerts } from "./alerts";
import { scheduleACheck } from "./schedule-a";
import { ROUNDING_GAP } from "./pct";

const s = (n, one, many) => (n === 1 ? one : many);
// The INFO check's "Open the sheet" link. ACCOUNTING_SHEET_LINK_ID, when set, is used ONLY to build that
// link (never to read or write): a preview reads a stand-in sheet but can still open the real one (r10, H17).
export const sheetLinkId = () => String(process.env.ACCOUNTING_SHEET_LINK_ID || "").trim() || accountingSheetId();
export const sheetUrl = () => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetLinkId())}/edit`;
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const usd = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nyDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
const nyWhen = (d) => new Date(d).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// --- pure comparisons (unit-tested in tests/sync-checks-unit.mjs) ---------------------------------
// MASTER's writer rows against the site's own sums per client. rows: readMasterRollup().rows;
// placements: DB rows; clients: DB rows (id, name, sheet_tab_name). Only clients MASTER has a row for; covered: how
// many rows matched a client, missing: clients with songs here and no MASTER row (2026-11-13: skipped before, so a
// MASTER whose writer table wasn't found compared nothing and said "match").
export function comparePubSheet({ rows = [], placements = [], clients = [] }) {
  const sums = new Map();
  for (const p of placements) {
    const x = sums.get(p.client_id) || { streams: 0, revenue: 0, fee: 0 };
    x.streams += Number(p.streams) || 0; x.revenue += Number(p.revenue) || 0; x.fee += Number(p.admin_fee) || 0;
    sums.set(p.client_id, x);
  }
  const streams = [], money = [], seen = new Set();
  let site = { streams: 0, revenue: 0, fee: 0 }, sheet = { streams: 0, revenue: 0, fee: 0 };
  for (const r of rows) {
    const c = ownerOf(clients, r.sheetTab || r.writer);
    if (!c) continue;
    seen.add(c.id);
    const x = sums.get(c.id) || { streams: 0, revenue: 0, fee: 0 };
    site = { streams: site.streams + x.streams, revenue: site.revenue + x.revenue, fee: site.fee + x.fee };
    sheet = { streams: sheet.streams + r.grossStreams, revenue: sheet.revenue + r.grossRevenue, fee: sheet.fee + r.adminFee };
    if (Math.abs(x.streams - r.grossStreams) > 1) streams.push(c.name);
    if (Math.abs(x.revenue - r.grossRevenue) > 1 || Math.abs(x.fee - r.adminFee) > 1) money.push(c.name);
  }
  return { streams, money, site, sheet, covered: seen.size, missing: clients.filter((c) => sums.has(c.id) && !seen.has(c.id)).map((c) => c.name) };
}

// Each song's own share against the share on its writer-tab row (sheet facts), and songs on a client
// whose tab was read that have no row. (2026-11-23, the owner: "its important to be exact") Only a hair is rounding now, 0.05 of a point
// (33.33 vs 33.3333, was 0.5); 33 vs 1/3 is a difference.
// (2026-11-13) offBy: those songs by client ({ client, songs }); unread: clients with songs whose tab the last pull
// didn't read (no facts at all would otherwise be a green "every share matches")
export function compareSplits({ placements = [], clients = [], facts = { songs: {}, clients: {} } }) {
  const byId = new Map(clients.map((c) => [c.id, c]));
  const differ = [], offSheet = [], offBy = new Map(), unread = new Set();
  for (const p of placements) {
    const c = byId.get(p.client_id);
    if (!c) continue;
    if (facts.clients?.[p.client_id] == null) { unread.add(c.name); continue; }
    const f = facts.songs?.[p.id];
    if (!f) { offSheet.push(p.song); offBy.set(c.name, [...(offBy.get(c.name) || []), p.song]); continue; }
    const keys = new Set([personKey(c.name), personKey(c.credit)].filter(Boolean));
    const own = (p.splits || []).find((x) => keys.has(personKey(x.name)));
    const mine = own ? Number(own.percent) || 0 : 0;
    const theirs = f.share == null ? 0 : Number(f.share);
    if (Math.abs(mine - theirs) > ROUNDING_GAP) differ.push({ song: p.song, client: c.name, site: mine, sheet: f.share });
  }
  return { differ, offSheet, offBy: [...offBy].map(([client, songs]) => ({ client, songs })), unread: [...unread] };
}

// INFO's names against the site's clients. Site only: on the roster, or with songs. INFO only: a real
// client name no site client has, hidden ones included (a hidden client on INFO is there on purpose),
// and never INFO's company row ("General / Company", for income that isn't one client's). A name with
// Income rows is a past client kept on INFO on purpose (the owner's call: its old payments stay typed to it).
const NOT_A_CLIENT = /^(general|company|defied)\b|\bcompany$/i;
// (2026-11-13) siteOnlyIds: those clients' ids, so the fix can open the first one's form (Website › Roster)
export function compareInfo({ info = [], clients = [], placements = [], incomeClients = [] }) {
  const withSongs = new Set(placements.map((p) => p.client_id));
  const site = clients.filter((c) => c.on_roster || withSongs.has(c.id));
  const infoKeys = new Set(info.map(personKey));
  // (2026-11-14) a client's stored link to its INFO name (clients.info_name) counts as one of its names
  const siteKeys = new Set(clients.flatMap((c) => [personKey(c.name), personKey(c.credit), personKey(c.sheet_tab_name), personKey(c.info_name)].filter(Boolean)));
  const paidKeys = new Set(incomeClients.map(personKey).filter(Boolean));
  info = info.filter((n) => !NOT_A_CLIENT.test(String(n).trim()));
  const missing = site.filter((c) => ![c.name, c.credit, c.sheet_tab_name, c.info_name].some((n) => n && infoKeys.has(personKey(n))));
  return { siteOnly: missing.map((c) => c.name), siteOnlyIds: missing.map((c) => c.id), infoOnly: info.filter((n) => !siteKeys.has(personKey(n)) && !paidKeys.has(personKey(n))) };
}

// (2026-11-13, live: INFO gives bucketboy1021 to Magnus and the site had no manager, so his own-artists view missed it;
// INFO's "Caden" is no staff login, the intern's is "Cayden") Each INFO client's Assigned Manager against the site's
// copy (clients.manager, which refreshManagers in lib/info-managers.js writes from INFO, matched the same way), and every
// manager INFO names that no staff login goes by (lib/roles.js sameManager, the own-artists rule). roster: [{ name,
// manager }] from INFO; clients: DB rows with manager; staff: the staff logins' names. (2026-11-13, people sync: a
// manager with no login is fine, Caden has none on purpose: infoCheck names them but no longer calls it out of sync)
export function compareManagers({ roster = [], clients = [], staff = [] }) {
  const differ = [], noLogin = [], seen = new Set(), live = roster.map((r) => r.name);
  for (const r of roster) {
    const c = NOT_A_CLIENT.test(r.name) ? null : infoOwnerOf(clients, r.name, live);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    if (personKey(r.manager) !== personKey(c.manager)) differ.push({ client: c.name, info: r.manager, site: c.manager || "" });
    if (r.manager && !staff.some((n) => sameManager(r.manager, n))) noLogin.push({ client: c.name, manager: r.manager });
  }
  return { differ, noLogin };
}

// INFO's roster in ONE read (2026-11-13: incomeOptions took 2-3 reads of the shared Google quota for the names alone):
// the names the Income formulas look up (INFO!$C$4:$C$43) and each one's Assigned Manager (E). -> { roster: [{ row,
// name, manager }], problem, gap }. (2026-11-13 review) Row 3's headers are read with it: C3 and E3 not "Artists /
// Clients" and "Assigned Manager" is a problem (INFO's columns moved), never a roster read from the wrong columns. gap:
// the first blank C row between two names (the site's copy of the managers stops there), or null.
export const INFO_ROSTER_RANGE = "INFO!C3:F43";
export function infoRosterOf(values) {
  const rows = values || [], head = rows[0] || [];
  const want = [[0, "C3", /^artists?\s*\/\s*clients?$/i, "Artists / Clients"], [2, "E3", /^assigned\s+manager$/i, "Assigned Manager"]];
  const off = want.find(([i, , re]) => !re.test(String(head[i] ?? "").trim()));
  if (off) return { roster: [], gap: null, problem: `INFO's ${off[1]} reads "${String(head[off[0]] ?? "").trim() || "blank"}", not "${off[3]}". INFO's columns may have moved.` };
  const all = rows.slice(1, 41).map((r, i) => ({ row: 4 + i, name: String(r?.[0] ?? "").trim(), manager: String(r?.[2] ?? "").trim() }));
  const last = all.findLastIndex((r) => r.name), first = all.findIndex((r) => r.name);
  const hole = first < 0 ? null : all.slice(first, last + 1).find((r) => !r.name);
  return { roster: all.filter((r) => r.name), gap: hole ? hole.row : null, problem: null };
}
export async function readInfoRoster({ sheets = getSheetsClient(), spreadsheetId = accountingSheetId() } = {}) {
  const got = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: [INFO_ROSTER_RANGE], valueRenderOption: "UNFORMATTED_VALUE" });
  return infoRosterOf((got.data.valueRanges || [])[0]?.values || []);
}

const list = (xs, n = 3) => (xs.length > n ? `${xs.slice(0, n).join(", ")} and ${xs.length - n} more` : xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] || "");
const failed = (id, what) => ({ id, ok: null, text: `Couldn't check ${what} just now.` });

// --- the checks ----------------------------------------------------------------------------------
// money: false (an account without Money, the intern on Site › Sync, 2026-11-13): the same check without a dollar figure
export async function pubSheetCheck(db, { money = true, fresh = false } = {}) {
  try {
    // (2026-11-20) the MASTER overview's saved copy (lib/sheet-cache.js), the same one the Clients tab reads
    // ("Pull from the sheet" asks for MASTER itself; a copy kept only because the read failed and older than 15 minutes is "couldn't check")
    const ov = await (fresh ? masterOverview({ fresh: true }) : masterOverview());
    if (ov.stale && Date.now() - ov.readAt > 15 * 60 * 1000) return { id: "pubSheet", ok: null, text: "Couldn't read the pub sheet's MASTER tab just now." };
    const roll = ov.v.rollup;
    const r = comparePubSheet({ rows: roll.rows, placements: db.placements, clients: db.clients });
    // (2026-11-13) a read that compared nothing (no "Writer" table, MASTER's all-zero glitch, no row matching a client)
    // is "couldn't check", never a green "match: 0 streams"
    if (!r.covered || roll.totals?.rosterGrossStreams === 0) return { id: "pubSheet", ok: null, text: "Couldn't read the writer table on the pub sheet's MASTER tab just now." };
    // ("none", not "no row": readMasterRollup also drops a writer row whose tab has no songs logged yet)
    const off = r.missing.length ? `${list(r.missing)} ${s(r.missing.length, "has", "have")} songs on the site but none on MASTER` : "";
    // r10 fix: the fee as Publishing shows it (the site's own sum); a cent or so of sheet rounding is named, not hidden
    if (!r.streams.length && !r.money.length && !off) {
      if (!money) return { id: "pubSheet", ok: true, text: `Site and pub sheet match: ${fmt(r.sheet.streams)} streams.` };
      // the fee Publishing shows: MASTER's own CATALOG TO DATE (else the rows added up); a few cents of rounding said
      const fee = Number.isFinite(Number(roll.totals?.catalogToDate)) && Number(roll.totals.catalogToDate) > 0 ? Number(roll.totals.catalogToDate) : r.sheet.fee;
      const cents = Math.round(Math.abs(r.site.fee - fee) * 100);
      return { id: "pubSheet", ok: true, text: `Site and pub sheet match: ${fmt(r.sheet.streams)} streams, ${usd(fee)} fee${cents ? ` (the songs' own fees add up to within ${cents}¢ of it: rounding)` : ""}.` };
    }
    const parts = [r.streams.length && `streams differ for ${list(r.streams)}`,
      r.money.length && (money ? `money is ${usd(r.site.fee)} fee on the site vs ${usd(r.sheet.fee)} on the sheet` : `money differs for ${list(r.money)}`), off].filter(Boolean);
    // (a missing MASTER row, or songs missing from the tab, is set up on the sheet: a pull doesn't add them)
    return { id: "pubSheet", ok: false, text: `Site vs pub sheet: ${parts.join("; ")}.`, ...(r.streams.length || r.money.length ? { fix: { kind: "pull", label: "Pull from the sheet" } } : {}) };
  } catch (err) { console.error("sync: pub sheet", err); return failed("pubSheet", "the pub sheet"); }
}

async function splitsCheck(db) {
  try {
    const [facts, [read]] = await Promise.all([readSheetFacts(), sql`SELECT max(synced_at) AS at FROM sheet_client_facts`.catch(() => [{}])]);
    const r = compareSplits({ placements: db.placements, clients: db.clients, facts });
    // (2026-11-13) no tab read at all is "couldn't check", not green; a client whose tab wasn't read is named
    if (!Object.keys(facts.clients || {}).length) return { id: "splits", ok: null, text: "Couldn't check the splits: the last sheet pull read no writer tabs." };
    if (!r.differ.length && !r.offSheet.length && !r.unread.length) return { id: "splits", ok: true, text: "Every song's share matches its row on the pub sheet." };
    // r10 fix: the same split as To do's lines (no split here, the sheet has one; or a different share), and "not on
    // the sheet" said as what it is: no row on the writer's tab in the last sheet read
    const none = r.differ.filter((x) => !x.site), other = r.differ.filter((x) => x.site);
    const parts = [none.length && `${none.length} ${s(none.length, "song has", "songs have")} no split here but a share on the sheet (${list(none.map((x) => x.song), 2)})`,
      other.length && `${other.length} ${s(other.length, "song's share differs", "songs' shares differ")} from the sheet (${list(other.map((x) => x.song), 2)})`,
      // (2026-11-13, live: "38 songs have no row on its writer's tab", all GloryTonio's) named by client, with when the
      // sheet was read: a push since then shows at the next pull
      r.offSheet.length && (r.offBy.length === 1
        ? `${r.offSheet.length} ${s(r.offSheet.length, "song has", "songs have")} no row on ${r.offBy[0].client}'s tab in the last sheet read${read?.at ? ` (${nyWhen(read.at)})` : ""}: ${list(r.offSheet, 2)}`
        : `${r.offSheet.length} songs have no row on their writer's tab in the last sheet read${read?.at ? ` (${nyWhen(read.at)})` : ""}: ${r.offBy.map((x) => `${x.client} ${x.songs.length}`).join(", ")}`),
      r.unread.length && (r.unread.length === 1 ? `${r.unread[0]}'s tab wasn't read in the last sheet pull` : `${r.unread.length} clients' tabs weren't read in the last sheet pull (${list(r.unread)})`)].filter(Boolean);
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

// found: how many of each kind, so To do's panel says the right fix (2026-11-13: it always said "add the missing names",
// for a name that was on INFO only). Managers are compared only when db.clients carries them.
// (2026-11-13, people sync) Amber only for a client on one side only or a manager that differs. Managers that differ
// are copied from INFO first (refreshManagers, at most once every REFRESH_MIN minutes across every server copy), then
// compared again, so nobody has to press "Update from the sheet". A manager with no site login is said in the detail,
// green, with a way to Site › Users. A client on the site only: the fix opens that client's form, where the
// accounting section adds them to INFO. (2026-11-13 review) The copy is refreshManagers' own read (columns found by
// header, the same rule as the nightly cron), never this check's read. INFO's row-3 headers not where they should be,
// or a blank row between clients, is amber, saying which, and nothing is copied.
const REFRESH_KEY = "peopleSync:refresh", REFRESH_MIN = 2;
export async function infoCheck(db, m) {
  if (!accountingSheetId()) return { id: "info", ok: null, text: "The accounting sheet isn't connected yet." };
  try {
    const managed = db.clients.every((c) => "manager" in c);
    const sheets = getSheetsClient();
    // (2026-11-14) the staff users with no login yet (no email or no password: lib/people-link.js makes one for a manager
    // on INFO): a manager whose only account is one of those is "account ready, no password yet"
    const [read, staff, pending] = await Promise.all([readInfoRoster({ sheets }), managed ? sql`SELECT name FROM users WHERE role = 'staff'` : [],
      managed ? sql`SELECT id, name FROM users WHERE role = 'staff' AND (email IS NULL OR email = '' OR password_hash IS NULL OR password_hash = '')`.catch(() => []) : []]);
    const sheet = { kind: "url", label: "Open the sheet ↗", url: sheetUrl() };
    if (read.problem) {
      return { id: "info", ok: false, text: `Couldn't compare INFO with the site: ${read.problem}`, detail: "Nothing was copied from it. Put INFO's headers back on row 3, then check again.", found: { columns: 1 }, fix: sheet };
    }
    const { roster, gap } = read;
    const r = compareInfo({ info: roster.map((x) => x.name), clients: db.clients, placements: db.placements, incomeClients: (m.acct?.rows || []).map((x) => x.client) });
    // the names that can sign in: every staff name, less one for each account with no login yet
    const staffNames = staff.map((u) => u.name).filter(Boolean);
    for (const p of pending || []) { const i = staffNames.indexOf(p.name); if (i >= 0) staffNames.splice(i, 1); }
    let clients = db.clients;
    let g = managed ? compareManagers({ roster, clients, staff: staffNames }) : { differ: [], noLogin: [] };
    // (a blank row between clients: the copy would stop there and take the managers under it away, so it isn't run)
    if (g.differ.length && !gap && (await claimState(REFRESH_KEY, REFRESH_MIN).catch(() => false))) {
      try {
        const out = await refreshManagers({ sheets });
        if (out.ok) {
          clients = await withInfoNames(await sql`SELECT id, name, credit, sheet_tab_name, on_roster, manager FROM clients`);
          g = compareManagers({ roster, clients, staff: staffNames });
        }
      } catch (err) { console.error("sync: info managers", err); }
    }
    // a manager INFO names with no login, once however many clients they have: "Caden (prodzo)". (2026-11-14) One whose
    // account is ready (made by the people link, no password yet) says so, with a way to that account; one with no
    // account at all says that
    const nobody = [...g.noLogin.reduce((a, x) => a.set(x.manager, [...(a.get(x.manager) || []), x.client]), new Map())];
    const ready = nobody.map(([who]) => ({ who, u: (pending || []).find((p) => sameManager(who, p.name)) })).filter((x) => x.u);
    const none = nobody.map(([who]) => who).filter((who) => !ready.some((x) => x.who === who));
    const loginNote = [ready.length && `${list(ready.map((x) => x.who))}: ${s(ready.length, "account", "accounts")} ready, no password yet.`, none.length && `${list(none)} ${s(none.length, "has", "have")} no site account yet.`].filter(Boolean).join(" ");
    const users = ready.length ? { kind: "go", tab: "site", sub: `users:${ready[0].u.id}`, label: ready.length === 1 ? `Open ${ready[0].who}'s account` : "Site › Users" } : { kind: "go", tab: "site", sub: "users", label: "Site › Users" };
    const gapText = gap ? `INFO has a blank row (C${gap}) between clients. The site stops reading INFO there, so the clients under it lose their manager here. Fill or remove that gap on INFO.` : "";
    if (!r.siteOnly.length && !r.infoOnly.length && !g.differ.length && !gap) {
      return { id: "info", ok: true, text: "INFO lists the same clients and managers as the site.", ...(loginNote ? { detail: loginNote, fix: users, found: { noLogin: nobody.length } } : {}) };
    }
    const parts = [gap && `a blank row (C${gap}) between clients`, r.siteOnly.length && `${r.siteOnly.length} on the site only`, r.infoOnly.length && `${r.infoOnly.length} on INFO only`,
      g.differ.length && `${g.differ.length} ${s(g.differ.length, "client's manager differs", "clients' managers differ")}`].filter(Boolean);
    const detail = [gapText, r.siteOnly.length && `On the site only: ${list(r.siteOnly, 6)}.`, r.infoOnly.length && `On INFO only: ${list(r.infoOnly, 6)}.`,
      g.differ.length && `Managers: ${list(g.differ.map((x) => `${x.client} (INFO says ${x.info || "none"}, the site ${x.site || "none"})`), 6)}.`, loginNote].filter(Boolean).join(" ");
    const what = g.differ.length || gap ? "don't match" : "list different clients";
    // a client on the site only: their form, where "Add to the accounting sheet" is; the sheet's link stays beside it
    // (a gap is fixed on the sheet: its link first)
    const fix = r.siteOnlyIds.length && !gap ? { kind: "go", tab: "site", sub: `roster:${r.siteOnlyIds[0]}/accounting`, label: `Add ${r.siteOnly[0]} to the sheet` } : sheet;
    return { id: "info", ok: false, text: `The accounting sheet's INFO tab and the site ${what}: ${parts.join(", ")}.`, detail, found: { siteOnly: r.siteOnly.length, infoOnly: r.infoOnly.length, managers: g.differ.length, noLogin: nobody.length, ...(gap ? { gap } : {}) }, fix, ...(fix.kind === "go" ? { also: sheet } : {}) };
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
    // (2026-11-13, live: a reload burst's 429s made Home say "3 things out of sync") a list ClickUp didn't answer for just
    // now (busy or down) is "couldn't check", never out of sync
    if (down.length === lists.length) return failed("clickup", "ClickUp");
    if (down.length) return { id: "clickup", ok: null, text: `Couldn't read ${down.length} ClickUp ${s(down.length, "list", "lists")} just now (${list(down.map((l) => l.name), 8)}).${late.length ? ` ${late.length} ${s(late.length, "task is", "tasks are")} overdue on the others.` : ""}` };
    if (!late.length) return { id: "clickup", ok: true, text: "No overdue ClickUp tasks." };
    return { id: "clickup", ok: false, text: `${late.length} ClickUp ${s(late.length, "task is", "tasks are")} overdue (${list(late.map((t) => t.name), 2)}).`, fix: { kind: "todo", area: "clickup", label: "Review" } };
  } catch (err) { console.error("sync: clickup", err); return failed("clickup", "ClickUp"); }
}

// (r11) the A&R sheet: its own last write (app_state), no Google call here. Off and "not written yet" are neither
// green nor amber; an error is amber, with "Open the sheet ↗" when there's a link
async function arSheetCheck() {
  try {
    const st = await trackerSheetStatus();
    return { id: "arSheet", ok: !st.on ? null : st.error ? false : st.at ? true : null, text: st.text, ...(st.error && st.url ? { fix: { kind: "url", label: "Open the sheet ↗", url: st.url } } : {}), ...(st.url ? { url: st.url } : {}) };
  } catch (err) { console.error("sync: A&R sheet", err); return failed("arSheet", "the A&R sheet"); }
}

// (2026-11-13) the writer tabs' empty song rows, as the nightly check left them (no Google call here). Amber when a
// tab that's running low couldn't be given more (its layout, Google, writes off) or a read-back after adding them
// found something different; else green, with the fewest and what was added. Not checked yet: neither
export async function roomCheck() {
  try {
    const st = await getState(ROOM_KEY);
    if (!st?.room) return { id: "room", ok: null, text: "Empty rows on the writer tabs: not checked yet. The nightly sync checks them." };
    const min = st.min || ROOM_MIN, add = st.add || ROOM_ADD, when = nyWhen(st.at);
    // the nightly check stopped (the cron, or a run that threw): said, never an old green
    if (Date.now() - Date.parse(st.at) > 36 * 3600000) return { id: "room", ok: null, text: `Empty rows on the writer tabs: last checked ${when}. The nightly sync hasn't checked them since.` };
    const counted = st.room.filter((x) => x.free != null).sort((a, b) => a.free - b.free);
    const low = counted.filter((x) => x.free < min);
    const stuck = [...(st.refused || []).map((x) => ({ tab: x.tab, text: x.reason })), ...(st.failed || []).map((x) => ({ tab: x.tab, text: `Adding rows to the ${x.tab} tab failed: ${x.error}` })),
      ...(st.alarms || (st.extended || []).filter((x) => x.alarm).map((x) => ({ tab: x.tab, text: x.alarm })))];
    const link = (tab) => { const t = st.room.find((x) => x.tab === tab); try { return t?.sheetId != null ? tabLink(getSheetId(), t.sheetId) : null; } catch { return null; } };
    const fixFor = (tab) => { const url = link(tab); return url ? { fix: { kind: "url", label: "Open the sheet ↗", url } } : {}; };
    const left = (xs) => list(xs.map((x) => `${x.tab} ${x.free}`), 4);
    if (stuck.length) return { id: "room", ok: false, text: `Writer tabs: ${stuck.length === 1 ? "one needs" : `${stuck.length} need`} a look (checked ${when}). Empty rows left: ${left(low.length ? low : counted.slice(0, 1))}.`, detail: stuck.map((x) => x.text).join(" "), ...fixFor(stuck[0].tab) };
    if (low.length && st.off) return { id: "room", ok: false, text: `Writer tabs running low on empty rows: ${left(low)}. Adding rows is off (PUB_SHARE_WRITES), checked ${when}.`, ...fixFor(low[0].tab) };
    const added = (st.extended || []).map((x) => `${x.tab} (+${x.added})`);
    const fewest = counted[0];
    const base = fewest ? `Every writer tab has room for new songs: the fewest empty rows is ${fewest.free}, on ${fewest.tab} (checked ${when}).` : `No writer tabs to check (${when}).`;
    return { id: "room", ok: true, text: `${base} A tab under ${min} gets ${add} more that night.${added.length ? ` Rows added: ${list(added, 4)}.` : ""}${low.length ? ` Next to get more: ${left(low)}.` : ""}` };
  } catch (err) { console.error("sync: room", err); return failed("room", "the writer tabs' empty rows"); }
}

// (2026-11-17) the last 7 days of failed-job alerts (lib/alerts.js: the nightly update, the data refresh, the Monday digest), as app_state "alertsSent" keeps
// them: read only, no Google call. Never amber (a failure fixed on Tuesday would keep Home's pill amber until the next Monday): green with none, grey
// with some. Said too when alerts can't be posted (a switch off, no channel): a failure is then only in the logs
export async function alertsCheck(now = Date.now()) {
  try {
    const sent = recentAlerts(await getState(ALERTS_KEY), now);
    const gate = alertGate();
    const day = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
    const lines = sent.map((a) => `${day(a.day)} · ${a.job}: ${a.step}`);
    const shown = lines.length > 6 ? `${lines.slice(0, 6).join("; ")} and ${lines.length - 6} more` : lines.join("; ");
    const closed = gate ? `Job alerts aren't posted to ClickUp: ${WHY[gate]}, so a failed nightly or weekly job is only in the logs.` : "";
    if (!sent.length) return gate ? { id: "alerts", ok: null, text: closed } : { id: "alerts", ok: true, text: "No job alerts in the last 7 days." };
    return { id: "alerts", ok: null, text: gate ? `${closed} Sent in the last 7 days: ${shown}.` : `${sent.length} job ${s(sent.length, "alert", "alerts")} in the last 7 days: ${shown}.` };
  } catch (err) { console.error("sync: alerts", err); return failed("alerts", "the job alerts"); }
}

// Every check at once; one that fails says so on its own line
// money: false (an account without Money, lib/roles.js) leaves out the Stripe and INFO checks and their reads, and the
// pub sheet's dollar figures
// publishing: false (an account without Publishing) leaves out the Schedule A line, whose button writes that sheet
// empire: the account sees the EMPIRE copy (lib/schedule-a.js seesEmpire: a Founder with Money and every artist): only then does the Schedule A line carry its EMPIRE part
export async function syncChecks({ now = Date.now(), money = true, fresh = false, publishing = true, empire = false } = {}) {
  const [placements, clients0] = await Promise.all([sql`SELECT id, client_id, song, streams, revenue, admin_fee, splits FROM placements`, sql`SELECT id, name, credit, sheet_tab_name, on_roster, manager FROM clients`]);
  const clients = await withInfoNames(clients0);
  const db = { placements, clients };
  const m = money ? await moneyState().catch(() => ({ pay: {}, acct: {}, match: null })) : null;
  // (2026-11-14) the people link (at most every 2 minutes) beside the other checks, Money only (it reads and writes INFO)
  const checks = await Promise.all([pubSheetCheck(db, { money, fresh }), splitsCheck(db), roomCheck(), ...(m ? [stripeCheck(m), infoCheck(db, m)] : []), clickupCheck(now), arSheetCheck(), ...(publishing ? [scheduleACheck({ now, empire })] : []), ...(money ? [peopleCheck(), alertsCheck(now)] : [])]);
  return { at: new Date(now).toISOString(), checks, outOfSync: checks.filter((c) => c.ok === false).length };
}

// (2026-11-14) One person, same info everywhere (lib/people-link.js): the logins, the roster, the team page and INFO.
// The Sync check runs the link itself at most every 2 minutes (across every server copy), then shows the last run:
// green when there's nothing to look at, amber with each thing (items: a sentence and its fix each) when there is.
// A flag that's only information (kind "info") doesn't make it amber.
const LINK_KEY = "peopleSync:auto", LINK_MIN = 2;
export function peopleLine(last, { on = true, waiting = false } = {}) {
  if (!on) return { id: "people", ok: null, text: "Linking people across the site and INFO is off (PEOPLE_AUTOLINK)." };
  // (2026-11-14 review) the first run is a person's: a preview of who'd be added, then "Add them"
  if (waiting || !last?.at) return { id: "people", ok: null, text: "People: not linked yet. Press Sync people now to see who would be added first.", waiting: true };
  const items = (last.flags || []).map((f) => ({ key: f.key, kind: f.kind, text: f.text, ...(f.fix ? { fix: f.fix.kind === "sheet" ? { kind: "url", label: f.fix.label, url: sheetUrl() } : f.fix } : {}), ...(f.pair ? { pair: f.pair } : {}),
    // (2026-11-16) the near flag's link ("Same person") and a team value's apply ("Use it for the login") go through too:
    // without them people-link.jsx never shows those two buttons
    ...(f.link ? { link: f.link } : {}), ...(f.apply ? { apply: f.apply } : {}) }));
  const made = [...(last.created?.clients || []), ...(last.created?.users || []), ...(last.created?.staff || [])].length + (last.sheet?.infoClients?.length || 0) + (last.sheet?.infoManagers?.length || 0);
  const when = nyWhen(last.at);
  const real = items.filter((x) => x.kind !== "info");
  if (last.error) return { id: "people", ok: false, text: `People: ${last.error}`, items };
  if (!real.length) return { id: "people", ok: true, text: `Logins, the roster, the team page and INFO list the same people (checked ${when}).${made ? ` ${made} added hidden at the last run.` : ""}`, ...(items.length ? { items } : {}) };
  return { id: "people", ok: false, text: `People: ${real.length} ${s(real.length, "thing", "things")} to look at (checked ${when}).`, items };
}
export async function peopleCheck() {
  try {
    const on = autolinkOn();
    let last = await lastPeopleLink(), waiting = false;
    if (on && (await claimState(LINK_KEY, LINK_MIN).catch(() => false))) {
      const r = await runPeopleLink({ by: "the sync check", auto: true }).catch((err) => { console.error("sync: people link", err); return null; });
      if (r?.at) last = r;
      if (r?.waiting) waiting = true;
    }
    return peopleLine(last, { on, waiting });
  } catch (err) { console.error("sync: people", err); return failed("people", "the people links"); }
}
