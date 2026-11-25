import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { LogOut, ListMusic, RefreshCw, Handshake, LayoutDashboard, ListChecks, Receipt, MoreHorizontal, Globe, KeyRound, ClipboardList, Wallet } from "lucide-react";
import { MyTodoPage } from "./my-todo";
import { MyPaymentsPage } from "./my-payments";
import { ROLES, TAB_SECTION, AREA_SECTION } from "../../lib/roles";
import { fullSiteSync, isSheetSyncStale } from "./catalog-data";
import { useArSummary } from "./home-data";
import { TodoChip } from "./chips";
import { SECTION_CODE, HomeDashboard, TodoPage, CatalogAdmin, AccountingAdmin, ARAdmin, SiteAdmin } from "./sections";
import { todoItems, useAutoConfirm, useCuTasks, useSeeds, useSplitFixes, useSyncChecks } from "./todo-data";
import { Wordmark, revealChip } from "./ui";
import { useTrueUp, trueUpTodoItems } from "../trueup-data"; // TRUEUP-HOOK: the monthly Luminate true-up
import { canUse } from "./access";
export { canUse, TODO_AREAS } from "./access";
import { arSecOf } from "../shared/ar-routes";
import { PasswordCard } from "./password";
import { InstallApp } from "../shared/install-app";
import { bootSectionOf, loadedRecently, markLoaded, readFresh } from "../shared/boot";
import { dashCache, settleRestored } from "../shared/dash-caches";
import { prefetchJson } from "../ui/fetch-cache";

// r7: Home (numbers), To do (every to-do, finished in place), the dashboards, and Site (Website, Users,
// Messages, Sync). The old tabs and links keep working: placeOf says where each one lives now.
// r11: the order the owner asked for (Dashboard, To do, A&R, Money, Publishing, Site); "home" is the Dashboard
// (2026-11-23) Clients is called Roster (its id and address, /dashboard/catalog, are what they were). (2026-11-24, the owner: "maybe that whole deals tab can go in with money to make things less
// cluttered") Deals is not a tab any more: EMPIRE and the Advance calculator are Money's last two pills again, for the Founders who had Deals (seeDeals below)
const DASH_TABS = ["home", "todo", "mytodo", "mypay", "ar", "money", "catalog", "site"];
// (2026-11-24, speed) the section this address opens downloads its code now, beside its data (it used to wait for the dataset), and the
// pointer on a section's button starts its first read too (its code already did): Money's numbers, A&R Home's lists
if (typeof window !== "undefined") { const at0 = bootSectionOf(window.location.pathname); if (at0) SECTION_CODE[at0.tab]?.(); }
const SECTION_FIRST_READ = { money: "/api/accounting", ar: "/api/ar-lists?view=home" };
function placeOf(t, s) {
  const sub = typeof s === "string" && s ? s : null;
  if (t === "accounting") return sub === "log" || sub === "check" ? { tab: "todo", sub } : { tab: "money", sub: sub === "payments" ? "payments" : null };
  if (t === "website") return { tab: "site", sub };
  if (t === "publishing") return placeOf("catalog", sub);
  if (t === "dashboard") return { tab: "home", sub: null }; // r11: Home is called Dashboard again (/dashboard/dashboard)
  if (t === "users") return { tab: "site", sub: "users" };
  if (t === "subs") return { tab: "site", sub: "messages" };
  // (2026-11-21) the advance calculator moved to Money, (2026-11-23) the two EMPIRE pages went to Deals, a section of their own, and (2026-11-24) they came back: Money's pills EMPIRE
  // (/dashboard/money/empire) and Advance calculator (/dashboard/money/advance). Deals' addresses (/dashboard/deals and /deals/empire; /deals/advance) and the calculator's first ones,
  // /dashboard/catalog/advance, ?tab=catalog&sub=advance and "advance:<id>", open them there. An account without them (seeDeals) gets Money's Overview, or its first tab without Money.
  if (t === "deals") return { tab: "money", sub: sub === "advance" ? "advance" : "empire" };
  if (t === "catalog" && typeof sub === "string" && /^advance(:|$)/.test(sub)) return { tab: "money", sub: "advance" };
  // (r11: Publishing's ISRCs tab is gone; the finder opens inside To do, /dashboard/todo/isrc)
  if (t === "catalog" && ["splits", "update", "dupes", "isrc"].includes(sub)) return { tab: "todo", sub };
  // (2026-11-24, the owner: "maybe we dont need releases if we have catalog") Roster has no Releases pill: its address, /dashboard/catalog/releases, and any release desk name for it open Catalog (/dashboard/catalog/songs)
  if (/^(releases?|release[-_ ]?desk)$/i.test(String(t === "catalog" ? sub : t))) return { tab: "catalog", sub: "songs" };
  // (list B #3: the Luminate tab is gone; r10: so is Numbers, whose sources and cost are in Site › Sync now.
  // Their old links, /dashboard/numbers and ?tab=numbers or ?tab=luminate, open Site › Sync)
  if (t === "luminate" || t === "numbers") return { tab: "site", sub: "sync" };
  // (A&R r10: its old sub-pages open their new addresses, components/shared/ar-routes.js)
  if (t === "ar") return { tab: "ar", sub: arSecOf(sub) || null };
  const tab = DASH_TABS.includes(t) ? t : "home";
  return { tab, sub: tab !== "home" ? sub : null };
}
// a section's address: /dashboard/<tab>[/<sub>], and plain /dashboard for Home
// (A&R r10: a sub with more than one part, /ar/watch/by/<id> or /ar/item/<key>, is encoded one segment at a time)
export const dashPath = (t, s) => (t === "home" && !s ? "/dashboard" : `/dashboard/${t}${s ? `/${String(s).split("/").map(encodeURIComponent).join("/")}` : ""}`);
// where an address points: its path (/dashboard/<tab>/<sub>), or an old one's ?tab=&sub=
const dashPlaceOf = (q) => {
  const [t, ...rest] = [].concat(q?.section || []);
  return t ? placeOf(t, rest.length ? rest.join("/") : null) : placeOf(q?.tab, q?.sub);
};
export function StaffDashboard({ db, commit, reloadDb, logout, signingOut, name }) {
  // sub = where a link points inside the tab it opens ("advance", "client:<id>", To do's item or area):
  // read once as the tab mounts, so the sidebar always opens a tab on its usual start
  // Each section has its own address (list B #11): /dashboard/<tab>[/<sub>] (/dashboard/money/advance,
  // Home is plain /dashboard), so the browser's Back and Forward step through sections instead of leaving
  // the dashboard, and a reload stays where it was. An old address (/dashboard?tab=money&sub=advance,
  // or an old tab's name) opens the same place and is rewritten to its new one.
  const router = useRouter();
  const [{ tab, sub }, setAt] = useState(() => dashPlaceOf(router.query));
  const toUrl = (t, s, how = "push") => {
    const next = dashPath(t, s);
    if (next === window.location.pathname + window.location.search) return; // the same place: no extra Back step
    router[how](next, undefined, { shallow: true, scroll: false });
  };
  const setTab = (t) => { setAt({ tab: t, sub: null }); toUrl(t, null); };
  const go = (t0, s0 = null) => { const { tab: t, sub: s } = placeOf(t0, s0); setAt({ tab: t, sub: s }); toUrl(t, s); window.scrollTo(0, 0); };
  // Back / Forward (and a reload): the address says where to be; an old address is rewritten to its new place
  const section = [].concat(router.query.section || []).join("/");
  // r11 fix (phones): a sub-tab row that scrolls sideways shows the active tab, not a clipped one at its edge
  useEffect(() => {
    const t = setTimeout(() => document.querySelectorAll(".subnav .subpill.active, .subnav [aria-current=page]").forEach((el) => revealChip(el)), 120);
    return () => clearTimeout(t);
  }, [section]);
  useEffect(() => {
    if (!router.isReady) return;
    const at = dashPlaceOf(router.query);
    setAt((cur) => (cur.tab === at.tab && cur.sub === at.sub ? cur : at));
    if (dashPath(at.tab, at.sub) !== window.location.pathname + window.location.search) toUrl(at.tab, at.sub, "replace");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, section, router.query.tab, router.query.sub]);
  // each song's extra facts (GET /api/songs: ISRCs, the finder's guesses, the pairs that aren't the same
  // song, the sheet tabs the last pull couldn't find): loaded first, then again whenever Home or To do
  // opens and after anything that changes them. songInfoErr = it couldn't load, so the cards say so.
  const [songInfo, setSongInfo] = useState(null);
  const [songInfoErr, setSongInfoErr] = useState(false);
  const reloadSongInfo = () => {
    setSongInfoErr(false);
    // (2026-11-25) an answer from before a write was read again by readFresh; one from before a sign-in is never used
    return readFresh("/api/songs").then(({ dropped, ok, j, t }) => {
      if (dropped) return;
      if (ok && j?.tracking) { setSongInfo(j); markLoaded("songs", t); } else setSongInfoErr(true);
    }).catch(() => setSongInfoErr(true));
  };
  const can = (k) => canUse(db, k);
  const songInfoOff = !can("publishing");
  useEffect(() => {
    if (songInfoOff) return;
    // (2026-11-24) back on Home or To do within 30 s of the last read (and no save since): what it has
    if (!songInfo || ((tab === "home" || tab === "todo") && !loadedRecently("songs"))) reloadSongInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  // what the old Luminate portfolios' starting list still needs (list B #3): To do's two rows
  const seeds = useSeeds(tab, can("publishing") || can("ar"));
  // db.sheetSync is the site's last sheet sync (site_settings.last_synced_at
  // in the database) — a copy that's stale (never synced, or synced a while
  // ago, including before some bug fix here) would otherwise sit stale until
  // someone remembers to press a button. There's exactly one manual sync
  // action (Publishing's "Refresh numbers") — this silently keeps every
  // other view current in the background instead, whenever Home, To do or
  // Publishing opens on a stale copy. One run at a time: a quick hop from
  // one to the other doesn't start a second. (2026-11-13) Nor does a reload, or another
  // browser: the server skips it when a pull started in the last 30 minutes (background),
  // and this page then doesn't ask again on every tab for 5 minutes.
  const syncing = useRef(false), skippedAt = useRef(0);
  useEffect(() => {
    if ((tab !== "home" && tab !== "catalog" && tab !== "todo") || syncing.current || !can("publishing") || !isSheetSyncStale(db) || Date.now() - skippedAt.current < 5 * 60 * 1000) return;
    syncing.current = true;
    fullSiteSync(db, commit, { background: true }).then((r) => { if (r?.skipped) skippedAt.current = Date.now(); })
      .catch((err) => console.error("Background sync failed:", err)).finally(() => { syncing.current = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  // A&R's counts (follow-ups due), Money's (payments to
  // log, rows to check), ClickUp's open tasks and the sync checks: To do's rows, its one count in the
  // sidebar, Home's biggest tasks and each tab's count chip all come from these
  const arSum = useArSummary(tab === "todo" ? "home" : tab);
  const [acctN, setAcctN] = useState(() => (can("money") ? dashCache.acct || null : null));
  // (2026-11-25) every change of the counts (a read, Money's page, a payment logged from Home or To do) is the copy a reload starts from too
  const setAcct = (u) => setAcctN((x) => { const n = typeof u === "function" ? u(x) : u; dashCache.acct = n || null; return n; });
  const dropAcct = () => settleRestored("acct", false, () => setAcct(null));
  const loadAcctN = () => !can("money") ? Promise.resolve() : readFresh("/api/accounting?counts=1").then(({ dropped, ok, j, t }) => {
    if (dropped) return;
    if (ok && j?.counts) { setAcct(j.counts); markLoaded("acctN", t); settleRestored("acct", true); } else dropAcct();
  }).catch(dropAcct);
  // once as the dashboard opens, and again when To do opens (not within 30 s of the last read)
  const acctAsked = useRef(false);
  useEffect(() => { if (!acctAsked.current || (tab === "todo" && !loadedRecently("acctN"))) { acctAsked.current = true; loadAcctN(); } }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const cu = useCuTasks(tab);
  const sync = useSyncChecks(tab);
  const fixes = useSplitFixes();
  const doneForYou = useAutoConfirm({ db, commit, songInfo, fixes });
  const trueup = useTrueUp(tab, can("publishing") && !db?.access?.ownOnly); // TRUEUP-HOOK: its To do rows (GET /api/trueup)
  // only the areas this account may use (lib/roles.js)
  const todo = useMemo(() => todoItems({ db, songInfo, acct: acctN, ar: arSum, sync: sync.data, seeds: seeds.data }).concat(trueUpTodoItems(trueup.data)).filter((it) => can(AREA_SECTION[it.area] || "todo")), [db, songInfo, acctN, arSum, sync.data, seeds.data, trueup.data]); /* TRUEUP-HOOK: + the true-up rows */ // eslint-disable-line react-hooks/exhaustive-deps
  // r10 fix: every open ClickUp task To do lists counts (the pill, All and the badge said 0 next to "ClickUp · 2":
  // the two had no due date); due ones still rank first in Biggest tasks
  const cuDue = cu.data?.tasks || [];
  const todoN = todo.length + cuDue.length;
  const areaN = (a) => (a === "clickup" ? cuDue.length : todo.filter((it) => it.area === a).length);
  const ctx = { db, commit, reloadDb, songInfo, songInfoErr, songInfoOff, reloadSongInfo, onGo: go, cu, sync, ar: arSum, acct: acctN, reloadAcct: loadAcctN, setAcct, fixes, doneForYou, can, seeds };
  // (2026-11-23, 2026-11-24) the EMPIRE and Advance calculator pills of Money, for the one kind of account that has them: a Founder with Money access and every artist (the API refuses everyone else).
  // The Roster page's pointer line (catalog.jsx seeEmpire) is the same decision
  const seeDeals = can("money") && !db.access?.ownOnly && db.access?.role === "founder";
  // r11: Home is "Dashboard" again, in the owner's order (the phone bar has the same order)
  const allTabs = [
    ["home", "Dashboard", LayoutDashboard], ["todo", "To do", ListChecks, todoN],
    // (2026-11-11) My to-do: this login's own ClickUp list, for anyone who has one (components/dash/my-todo.jsx)
    ["mytodo", "My to-do", ClipboardList, 0, "clickup"],
    // (2026-11-11) My payments: what came in through this login's own pay link and what they keep (my-payments.jsx)
    ["mypay", "My payments", Wallet, 0, "money"],
    ["ar", "A&R", Handshake, 0, "ar"], ["money", "Money", Receipt, 0, "money"],
    // (2026-11-23, the owner: "Deals, Catalog, Release desk, Clients → Roster") Roster, the Clients tab renamed: its pills are Roster and Catalog
    ["catalog", "Roster", ListMusic, 0, "roster"], ["site", "Site", Globe, 0, "site"],
  ];
  // the tabs this account may use: Site holds Users too. Any other address opens the first of them.
  const tabs = allTabs.filter(([id]) => (id === "site" ? can("site") || can("users") : id === "mytodo" ? !!db.access?.mgmtList : id === "mypay" ? !!db.access?.payLink : can(TAB_SECTION[id])));
  // (2026-11-11, the owner: "make clients the first thing the co managers see") a Co-manager opens on Roster (it was Clients)
  if (db.access?.role === "comanager") tabs.sort(([a], [b]) => (b === "catalog") - (a === "catalog"));
  const at = tabs.some(([id]) => id === tab) ? tab : tabs[0]?.[0];
  // a page's own pickers (Publishing's client, Site's tab) update the address in place: one Back
  // step per section, not one per chip. The tab on screen, not the address's (2026-11-11 fix: a co-manager opens on
  // Clients at plain /dashboard, and a client they picked went to /dashboard/home/… and was dropped)
  const setSub = (s) => { setAt((cur) => (cur.tab === at && cur.sub === s ? cur : { tab: at, sub: s })); toUrl(at, s, "replace"); };
  // (2026-11-11, the owner: "for the founder accounts like hank its a lil too complicated ... total money and like my
  // money in the same group and like tasks can be all tasks and my tasks grouped together") a login with To do or Money
  // finds its own list or payments inside it, not as a tab of their own: To do behind an All / Mine switch, Money as a
  // tab of its own row ("is there a reason this is a seperate page and not just a new tab": Overview · All payments ·
  // My payments, /dashboard/money/mine)
  const paired = (id) => !!PAIRS[id] && tabs.some(([t]) => t === PAIRS[id]);
  const side = tabs.filter(([id]) => !paired(id));
  const home = paired(at) ? PAIRS[at] : at; // the sidebar tab that's lit
  const pair = (all) => { const mine = MINE_OF[all]; return tabs.some(([t]) => t === mine) && <PairSwitch all={all} mine={mine} at={at} setTab={setTab} />; };
  const myMoney = tabs.some(([t]) => t === "mypay");
  // My payments' own address opens it inside Money (as a pill) for a login that has Money
  useEffect(() => { if (at === "mypay" && paired("mypay")) { setAt({ tab: "money", sub: "mine" }); toUrl("money", "mine", "replace"); } }, [at]); // eslint-disable-line react-hooks/exhaustive-deps
  // the mouse on (or focus reaching) a section's button starts that section's first read, beside its code (only the sections this account has are drawn)
  const warm = (id) => { if (SECTION_FIRST_READ[id] && id !== home) prefetchJson(SECTION_FIRST_READ[id]); };
  const [pwOpen, setPwOpen] = useState(false); // "Password": each login changes its own (components/dash/password.jsx)
  // (2026-11-11, the owner: "get rid of the · own artists on each co managers page")
  const roleWord = db.access ? ROLES[db.access.role]?.label || "Staff" : "Staff — full edit access";
  // (2026-11-23, the owner: "name next to the role as well at the bottom") the signed-in person's name (users.name: the session's, pages/dashboard/[[...section]].jsx passes it) beside
  // their role, on the one line. No name known (or the old no-roles label above, too long to share the line): the role alone, drawn exactly as before. A Founder's label also shines (styles/app.css)
  const who = db.access ? String(name ?? "").trim() : "";
  return (
    <div className="dash">
      <aside className="dash-side">
        {/* r10 (H15): the logo stays in the dashboard (the Dashboard page), it doesn't leave for the public site */}
        <div className="dash-brand"><Link href="/dashboard" className="logo-link" aria-label="Dashboard" onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); go("home"); }}><Wordmark height={26} /></Link></div>
        <nav>
          {side.map(([id, label, Icon, badge, area]) => (
            <button key={id} className={[home === id && "active", PHONE_MORE.has(id) && "nav-more-item"].filter(Boolean).join(" ")} data-area={area} data-tab={id} aria-current={home === id ? "page" : undefined} onClick={() => setTab(id)} onPointerEnter={() => SECTION_CODE[id]?.()} onMouseEnter={() => warm(id)} onFocus={() => { SECTION_CODE[id]?.(); warm(id); }}>
              <Icon size={17} /> <span className="nav-label">{label}</span>
              {!!badge && <span className="nav-badge">{badge}</span>}
            </button>
          ))}
          <NavMore tabs={side.filter(([id]) => PHONE_MORE.has(id))} tab={home} badge={0} setTab={setTab} />
        </nav>
        <div className="dash-side-foot">
          <div className={who ? "dash-role dash-role-named" : "dash-role"} data-role={db.access?.role}>{who ? <><span className="dash-who" title={who}>{who}</span><span className="dash-role-dot" aria-hidden="true">·</span><span className="dash-role-word">{roleWord}</span></> : roleWord}</div>
          <button className="dash-out dash-pw" onClick={() => setPwOpen(true)} aria-label="Change your password" data-change-password><KeyRound size={16} /> <span className="dash-pw-label">Password</span></button>
          <button className="dash-out" onClick={logout} disabled={signingOut}>{signingOut ? <><RefreshCw size={16} className="spin" /> Signing out…</> : <><LogOut size={16} /> Sign out</>}</button>
        </div>
      </aside>
      <main className="dash-main">
        <InstallApp />
        {!at && <div className="admin-empty" data-no-sections>Your account has nothing turned on yet. Ask a Founder to turn on what you need in Site › Users.</div>}
        {at === "home" && <HomeDashboard ctx={ctx} todo={todo} cuTasks={cu.data?.tasks || []} todoN={todoN} onAcct={setAcct} />}
        {at === "todo" && <TodoPage ctx={ctx} todo={todo} sub={sub} onSub={setSub} areaN={areaN} mine={pair("todo")} />}
        {at === "mytodo" && (paired("mytodo") ? <MyTodoPage title="To do" mine={pair("todo")} /> : <MyTodoPage />)}
        {at === "mypay" && !paired("mypay") && <MyPaymentsPage />}
        {at === "money" && <AccountingAdmin sub={sub} onSub={setSub} onCounts={setAcct} myMoney={myMoney} empire={seeDeals} chip={can("todo") && <TodoChip n={areaN("money")} area="money" onGo={go} />} onGo={go} />}
        {at === "site" && <SiteAdmin ctx={ctx} sub={sub} onSub={setSub} chip={can("todo") && <TodoChip n={areaN("site")} area="site" onGo={go} />} />}
        {at === "catalog" && <CatalogAdmin db={db} commit={commit} reloadDb={reloadDb} songInfo={songInfo} reloadSongInfo={reloadSongInfo} sub={sub} onGo={go} onSub={setSub} chip={can("todo") && <TodoChip n={areaN("roster")} area="roster" onGo={go} />} />}
        {at === "ar" && <ARAdmin onGo={go} sub={sub} onSub={setSub} chip={can("todo") && <TodoChip n={areaN("ar")} area="ar" onGo={go} />} />}
      </main>
      {pwOpen && <PasswordCard onClose={() => setPwOpen(false)} />}
    </div>
  );
}

// the "My" tabs and the tab each one sits inside when the login has that one too, and To do's switch between them
const PAIRS = { mytodo: "todo", mypay: "money" };
const MINE_OF = { todo: "mytodo" };
const PAIR_WORDS = { todo: ["All tasks", "My tasks"] };
function PairSwitch({ all, mine, at, setTab }) {
  return (
    <span className="gainer-tabs pair-switch" role="tablist" aria-label="Whose tasks" data-pair={all}>
      {[all, mine].map((id, i) => <button key={id} role="tab" aria-selected={at === id} className={at === id ? "active" : ""} data-pair-tab={id} onClick={() => at !== id && setTab(id)}>{PAIR_WORDS[all][i]}</button>)}
    </span>
  );
}

// The phone tab bar's "More": the sections in a small menu above the bar (To do always stays in the bar,
// with the one count). Hidden on desktop, where the sidebar lists every section. r10: with Numbers gone the
// bar has room for Site itself, so "More" is empty and not drawn.
const PHONE_MORE = new Set([]);
function NavMore({ tabs, tab, badge, setTab }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const here = tabs.some(([id]) => id === tab);
  if (!tabs.length) return null;
  return (
    <div className="nav-more" ref={box}>
      <button type="button" className={here ? "active" : ""} aria-haspopup="menu" aria-expanded={open} data-nav-more onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal size={17} /> <span className="nav-label">More</span>
        {!!badge && <span className="nav-badge">{badge}</span>}
      </button>
      {open && (
        <div className="nav-more-menu" role="menu">
          {tabs.map(([id, label, Icon, n]) => (
            <button key={id} role="menuitem" className={tab === id ? "active" : ""} onClick={() => { setOpen(false); setTab(id); }}>
              <Icon size={17} /> <span>{label}</span>{!!n && <span className="nav-badge">{n}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
