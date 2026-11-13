// The Sync view (r7, scratchpad sync-audit/REPORT.md): is everything the dashboard reads in step with
// where it comes from? Each check is one line, green or amber (null = it couldn't be checked just now),
// with the fix when the app has one. Reads only: nothing here writes anywhere. Server-only.
//   pubSheet   the site's songs vs the pub sheet's MASTER (streams and money, client by client)
//   splits     each song's own share vs its writer-tab row (from the last sheet pull), songs not on the sheet
//   stripe     Stripe payments the accounting sheet's Income tab doesn't have
//   info       the accounting sheet's INFO client list vs the site's clients, and each client's manager (2026-11-13)
//   clickup    overdue ClickUp tasks on the dashboard's lists
//   arSheet    (r11) the A&R sheet, a one-way copy: Off, when it was last written and how many rows, or the error
//   room       (2026-11-13) empty song rows on each writer tab, from the nightly check (lib/sheet-rows.js keepRoom)
// (List B #3: Luminate is gone, and with it the STREAM DATA and "OUTREACH vs the Luminate A&R lists"
// checks. The pub sheet's STREAM DATA tab is left as it is: nothing here or anywhere writes it now.)
import { sql } from "./db";
import { getSheetsClient, getSheetId, readMasterRollup } from "./sheets";
import { ownerOf, personKey } from "./names";
import { readSheetFacts } from "./sheet-facts-store";
import { moneyState } from "./money";
import { accountingSheetId } from "./accounting";
import { sameManager } from "./roles";
import { allTasks } from "./clickup-tasks";
import { trackerSheetStatus } from "./ar/tracker-sheet";
import { getState } from "./app-state";
import { ROOM_KEY, ROOM_MIN, ROOM_ADD } from "./sheet-rows";
import { tabLink } from "./sheets";

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
// whose tab was read that have no row. A third of a percent is rounding (33 vs 1/3), not a difference.
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
    if (Math.abs(mine - theirs) > 0.5) differ.push({ song: p.song, client: c.name, site: mine, sheet: f.share });
  }
  return { differ, offSheet, offBy: [...offBy].map(([client, songs]) => ({ client, songs })), unread: [...unread] };
}

// INFO's names against the site's clients. Site only: on the roster, or with songs. INFO only: a real
// client name no site client has, hidden ones included (a hidden client on INFO is there on purpose),
// and never INFO's company row ("General / Company", for income that isn't one client's). A name with
// Income rows is a past client kept on INFO on purpose (the owner's call: its old payments stay typed to it).
const NOT_A_CLIENT = /^(general|company|defied)\b|\bcompany$/i;
export function compareInfo({ info = [], clients = [], placements = [], incomeClients = [] }) {
  const withSongs = new Set(placements.map((p) => p.client_id));
  const site = clients.filter((c) => c.on_roster || withSongs.has(c.id));
  const infoKeys = new Set(info.map(personKey));
  const siteKeys = new Set(clients.flatMap((c) => [personKey(c.name), personKey(c.credit), personKey(c.sheet_tab_name)].filter(Boolean)));
  const paidKeys = new Set(incomeClients.map(personKey).filter(Boolean));
  info = info.filter((n) => !NOT_A_CLIENT.test(String(n).trim()));
  return { siteOnly: site.filter((c) => ![c.name, c.credit, c.sheet_tab_name].some((n) => n && infoKeys.has(personKey(n)))).map((c) => c.name), infoOnly: info.filter((n) => !siteKeys.has(personKey(n)) && !paidKeys.has(personKey(n))) };
}

// (2026-11-13, live: INFO gives bucketboy1021 to Magnus and the site had no manager, so his own-artists view missed it;
// INFO's "Caden" is no staff login, the intern's is "Cayden") Each INFO client's Assigned Manager against the site's
// copy (clients.manager, which refreshManagers in lib/access.js writes from INFO, matched the same way), and every
// manager INFO names that no staff login goes by (lib/roles.js sameManager, the own-artists rule). roster: [{ name,
// manager }] from INFO; clients: DB rows with manager; staff: the staff logins' names.
export function compareManagers({ roster = [], clients = [], staff = [] }) {
  const differ = [], noLogin = [], seen = new Set();
  for (const r of roster) {
    const c = NOT_A_CLIENT.test(r.name) ? null : ownerOf(clients, r.name);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    if (personKey(r.manager) !== personKey(c.manager)) differ.push({ client: c.name, info: r.manager, site: c.manager || "" });
    if (r.manager && !staff.some((n) => sameManager(r.manager, n))) noLogin.push({ client: c.name, manager: r.manager });
  }
  return { differ, noLogin };
}

// INFO's roster in ONE read (2026-11-13: incomeOptions took 2-3 reads of the shared Google quota for the names alone):
// the names the Income formulas look up (INFO!$C$4:$C$43) and each one's Assigned Manager (E)
export async function readInfoRoster({ sheets = getSheetsClient(), spreadsheetId = accountingSheetId() } = {}) {
  const got = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: ["INFO!C4:F43"], valueRenderOption: "UNFORMATTED_VALUE" });
  return ((got.data.valueRanges || [])[0]?.values || []).map((r) => ({ name: String(r?.[0] ?? "").trim(), manager: String(r?.[2] ?? "").trim() })).filter((r) => r.name);
}

const list = (xs, n = 3) => (xs.length > n ? `${xs.slice(0, n).join(", ")} and ${xs.length - n} more` : xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] || "");
const failed = (id, what) => ({ id, ok: null, text: `Couldn't check ${what} just now.` });

// --- the checks ----------------------------------------------------------------------------------
// money: false (an account without Money, the intern on Site › Sync, 2026-11-13): the same check without a dollar figure
export async function pubSheetCheck(db, { money = true } = {}) {
  try {
    const roll = await readMasterRollup(getSheetsClient(), getSheetId());
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
export async function infoCheck(db, m) {
  if (!accountingSheetId()) return { id: "info", ok: null, text: "The accounting sheet isn't connected yet." };
  try {
    const managed = db.clients.every((c) => "manager" in c);
    const [roster, staff] = await Promise.all([readInfoRoster(), managed ? sql`SELECT name FROM users WHERE role = 'staff'` : []]);
    const r = compareInfo({ info: roster.map((x) => x.name), clients: db.clients, placements: db.placements, incomeClients: (m.acct?.rows || []).map((x) => x.client) });
    const g = managed ? compareManagers({ roster, clients: db.clients, staff: staff.map((u) => u.name).filter(Boolean) }) : { differ: [], noLogin: [] };
    if (!r.siteOnly.length && !r.infoOnly.length && !g.differ.length && !g.noLogin.length) return { id: "info", ok: true, text: "INFO lists the same clients and managers as the site." };
    // a manager INFO names with no login, once however many clients they have: "Caden (prodzo)"
    const nobody = [...g.noLogin.reduce((a, x) => a.set(x.manager, [...(a.get(x.manager) || []), x.client]), new Map())];
    const parts = [r.siteOnly.length && `${r.siteOnly.length} on the site only`, r.infoOnly.length && `${r.infoOnly.length} on INFO only`,
      g.differ.length && `${g.differ.length} ${s(g.differ.length, "client's manager differs", "clients' managers differ")}`, nobody.length && `${nobody.length} ${s(nobody.length, "manager has", "managers have")} no staff login`].filter(Boolean);
    const detail = [r.siteOnly.length && `On the site only: ${list(r.siteOnly, 6)}.`, r.infoOnly.length && `On INFO only: ${list(r.infoOnly, 6)}.`,
      g.differ.length && `Managers: ${list(g.differ.map((x) => `${x.client} (INFO says ${x.info || "none"}, the site ${x.site || "none"})`), 6)}.`,
      nobody.length && `No staff login is called ${nobody.map(([who, cs]) => `${who} (${list(cs)})`).join(" or ")}.`].filter(Boolean).join(" ");
    const what = g.differ.length || nobody.length ? "don't match" : "list different clients";
    return { id: "info", ok: false, text: `The accounting sheet's INFO tab and the site ${what}: ${parts.join(", ")}.`, detail, found: { siteOnly: r.siteOnly.length, infoOnly: r.infoOnly.length, managers: g.differ.length, noLogin: nobody.length }, fix: { kind: "url", label: "Open the sheet ↗", url: sheetUrl() } };
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

// Every check at once; one that fails says so on its own line
// money: false (an account without Money, lib/roles.js) leaves out the Stripe and INFO checks and their reads, and the
// pub sheet's dollar figures
export async function syncChecks({ now = Date.now(), money = true } = {}) {
  const [placements, clients] = await Promise.all([sql`SELECT id, client_id, song, streams, revenue, admin_fee, splits FROM placements`, sql`SELECT id, name, credit, sheet_tab_name, on_roster, manager FROM clients`]);
  const db = { placements, clients };
  const m = money ? await moneyState().catch(() => ({ pay: {}, acct: {}, match: null })) : null;
  const checks = await Promise.all([pubSheetCheck(db, { money }), splitsCheck(db), roomCheck(), ...(m ? [stripeCheck(m), infoCheck(db, m)] : []), clickupCheck(now), arSheetCheck()]);
  return { at: new Date(now).toISOString(), checks, outOfSync: checks.filter((c) => c.ok === false).length };
}
