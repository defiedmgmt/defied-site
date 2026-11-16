// (2026-11-15) Adding someone puts them everywhere at once, and says so in one line (components/dash/people-added.jsx). The owner: "whenever
// you add a manager or client it should make an account and sync it everywhere at once just default it to be not visible". After a save
// that ADDED a person (Site › Users › Add, Site › Website › Roster › Add, the Clients tab's Add client, Site › Website › Team › Add) the
// browser runs the people link at once (POST /api/people-sync { action: "link" }): the server's own run after the save has made their
// account, team entry or hidden client, and this one writes INFO (the manager on L, or the client's row with its commission blank). This
// is the line about it, the parts with no screen in them (tests/manager-artists.mjs runs it). It is built from what exists NOW (the site's
// copy and INFO, read again after the run), not from one run's list of what it made, because the run after the save has made the
// rest already. (Plain loops: see components/dash/manager-artists.js on Next's minifier.)
import { personKey } from "../../lib/names";
import { nearManager } from "./manager-artists";

// said when the run couldn't finish the sheet now (someone else is linking, the sheet is away, the account can't write it): the sync check
// and the nightly run finish it
const madeIn = (list, key) => {
  for (const x of list || []) if (personKey(x) === key) return true;
  return false;
};
// the run's flags that are about this person (a name near another, a row that couldn't be written), each { key, text, fix }
function flagsAbout(link, name, key) {
  const out = [];
  for (const f of link.flags || []) {
    if (!f || !f.text) continue;
    if (String(f.text).toLowerCase().indexOf(name.toLowerCase()) >= 0 || String(f.key || "").indexOf(key) >= 0) out.push(f);
  }
  return out;
}
export const LATER = "Saved. The accounting sheet will catch up in a couple of minutes.";

// who: { kind: "staff" | "client" | "login" | "team", id, name, pick?, noLogin? }
//   staff   a new staff account (Users › Add, or an INFO manager made an account): id is the user's; pick is the form's role
//           (founder, comanager, intern); noLogin is whether it has no password yet
//   client  a new client (Roster › Add, Clients › Add client): id is the client's
//   login   a new client login in Users (its client is whoever it is linked to): the account alone
//   team    a new team page entry (Site › Website › Team › Add): id is the entry's; account is what its Account select said (comanager, intern, none): the
//           link makes that account and puts a Co-manager on INFO's list
// link: what linkNow gave: { created: { clients, users, staff }, sheet: { infoClients, infoManagers }, flags } | { busy } | { error }
// db: the site's copy as it reads now (users, staff, clients), or null; info: INFO as it reads now (GET /api/people-sync's info), or null
// -> { text, flags, later }: text is "Added everywhere: account (no login yet), accounting sheet, team page (hidden)." or LATER; flags are
// the run's own flags about this person (a commission left blank, a name near another), each { key, text, fix }
export function addedLine({ who, link, db, info }) {
  if (!link || link.busy || link.error) return { text: LATER, flags: [], later: true };
  const name = String(who.name || "").trim(), key = personKey(name);
  const users = (db && db.users) || [], staff = (db && db.staff) || [], clients = (db && db.clients) || [];
  const managers = (info && info.managers) || [], roster = (info && info.roster) || [];
  const parts = [];
  let wantSheet = false, hasSheet = false;
  if (who.kind === "staff") {
    parts.push(who.noLogin ? "account (no login yet)" : "account");
    wantSheet = who.pick === "comanager" || who.pick === "founder";
    for (const m of managers) if (m.name === name) hasSheet = true;
    if (madeIn(link.sheet && link.sheet.infoManagers, key)) hasSheet = true;
    if (wantSheet && hasSheet) parts.push("accounting sheet");
    let team = null;
    for (const t of staff) if (t.userId === who.id) team = t;
    if (team) parts.push(team.visible === false ? "team page (hidden)" : "team page");
    else if (madeIn(link.created && link.created.staff, key)) parts.push("team page (hidden)");
    // a name near one that is on INFO's list is never added to it (nearManager): said, not "the sheet will catch up"
    const near = wantSheet && !hasSheet ? nearManager(managers, name) : null;
    if (near) return { text: `Added everywhere: ${parts.join(", ")}. ${name} isn't on the accounting sheet's manager list (it has ${near.name}).`, flags: flagsAbout(link, name, key), later: false };
  } else if (who.kind === "client") {
    let acct = null, c = null;
    for (const u of users) if (u.role === "client" && u.clientId === who.id) acct = u;
    for (const x of clients) if (x.id === who.id) c = x;
    if (acct) parts.push(acct.noLogin ? "client account (no login yet)" : "client account");
    else if (madeIn(link.created && link.created.users, key)) parts.push("client account (no login yet)");
    wantSheet = true;
    let rate = null;
    for (const r of roster) if (r.clientId === who.id) { hasSheet = true; rate = r.rate; }
    if (madeIn(link.sheet && link.sheet.infoClients, key)) hasSheet = true;
    if (hasSheet) parts.push(rate == null ? "accounting sheet" : `accounting sheet (commission ${Math.round(Number(rate) * 10000) / 100}%)`);
    if (c) parts.push(c.onRoster === false ? "roster (hidden)" : "roster");
  } else if (who.kind === "team") {
    // a team entry added by hand: the link makes its account (a Co-manager, no login) and puts them on INFO's manager list
    let t = null, u = null;
    for (const x of staff) if (x.id === who.id) t = x;
    if (t) for (const x of users) if (x.id === t.userId) u = x;
    // (2026-11-15) which account: the one Site › Team's Account said (an Intern is never on INFO's list; "No account" makes none)
    if (u) parts.push(`${u.staffRole === "intern" ? "Intern account" : "Co-manager account"}${u.noLogin ? " (no login yet)" : ""}`);
    wantSheet = !!u && (u.staffRole === "comanager" || u.staffRole === "founder");
    for (const m of managers) if (m.name === name) hasSheet = true;
    if (madeIn(link.sheet && link.sheet.infoManagers, key)) hasSheet = true;
    if (wantSheet && hasSheet) parts.push("accounting sheet");
    if (t) parts.push(t.visible === false ? "team page (hidden)" : "team page");
    if (!u && who.account === "none") parts.push("no account");
  } else {
    parts.push(who.noLogin === false ? "account" : "account (no login yet)");
  }
  const flags = flagsAbout(link, name, key);
  if (wantSheet && !hasSheet) {
    // the run said why it couldn't write them (INFO's client list full, Annual Summary not reading that row yet, writing off): that needs a person,
    // not a couple of minutes, so it isn't promised; the flag under the line says what to do
    for (const f of flags) if (f.kind === "sheet") return { text: `Saved. ${name} isn't on the accounting sheet yet.`, flags, later: true };
    return { text: LATER, flags, later: true };
  }
  return { text: `Added everywhere: ${parts.join(", ")}.`, flags, later: false };
}
