import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { LogOut, ListMusic, RefreshCw, Handshake, LayoutDashboard, ListChecks, Receipt, MoreHorizontal, Globe } from "lucide-react";
import { ROLES, TAB_SECTION, AREA_SECTION } from "../../lib/roles";
import { fullSiteSync, isSheetSyncStale } from "./catalog-data";
import { useArSummary } from "./home-data";
import { TodoChip } from "./chips";
import { SECTION_CODE, HomeDashboard, TodoPage, CatalogAdmin, AccountingAdmin, ARAdmin, SiteAdmin } from "./sections";
import { todoItems, useAutoConfirm, useCuTasks, useSeeds, useSplitFixes, useSyncChecks } from "./todo-data";
import { Wordmark } from "./ui";
import { useTrueUp, trueUpTodoItems } from "../trueup-data"; // TRUEUP-HOOK: the monthly Luminate true-up
import { canUse } from "./access";
export { canUse, TODO_AREAS } from "./access";
import { arSecOf } from "../shared/ar-routes";

// r7: Home (numbers), To do (every to-do, finished in place), the dashboards, and Site (Website, Users,
// Messages, Sync). The old tabs and links keep working: placeOf says where each one lives now.
// r11: the order the owner asked for (Dashboard, To do, A&R, Money, Publishing, Site); "home" is the Dashboard
const DASH_TABS = ["home", "todo", "ar", "money", "catalog", "site"];
function placeOf(t, s) {
  const sub = typeof s === "string" && s ? s : null;
  if (t === "accounting") return sub === "log" || sub === "check" ? { tab: "todo", sub } : { tab: "money", sub: sub === "payments" ? "payments" : null };
  if (t === "website") return { tab: "site", sub };
  if (t === "publishing") return placeOf("catalog", sub);
  if (t === "dashboard") return { tab: "home", sub: null }; // r11: Home is called Dashboard again (/dashboard/dashboard)
  if (t === "users") return { tab: "site", sub: "users" };
  if (t === "subs") return { tab: "site", sub: "messages" };
  // (r11: Publishing's ISRCs tab is gone; the finder opens inside To do, /dashboard/todo/isrc)
  if (t === "catalog" && ["splits", "update", "dupes", "isrc"].includes(sub)) return { tab: "todo", sub };
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
export function StaffDashboard({ db, commit, reloadDb, logout, signingOut }) {
  // sub = where a link points inside the tab it opens ("advance", "client:<id>", To do's item or area):
  // read once as the tab mounts, so the sidebar always opens a tab on its usual start
  // Each section has its own address (list B #11): /dashboard/<tab>[/<sub>] (/dashboard/catalog/advance,
  // Home is plain /dashboard), so the browser's Back and Forward step through sections instead of leaving
  // the dashboard, and a reload stays where it was. An old address (/dashboard?tab=catalog&sub=advance,
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
  // a page's own pickers (Publishing's client, Site's tab) update the address in place: one Back
  // step per section, not one per chip
  const setSub = (s) => { setAt((cur) => (cur.sub === s ? cur : { ...cur, sub: s })); toUrl(tab, s, "replace"); };
  // Back / Forward (and a reload): the address says where to be; an old address is rewritten to its new place
  const section = [].concat(router.query.section || []).join("/");
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
    return fetch("/api/songs", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.tracking) setSongInfo(d); else setSongInfoErr(true); }).catch(() => setSongInfoErr(true));
  };
  const can = (k) => canUse(db, k);
  const songInfoOff = !can("publishing");
  useEffect(() => {
    if (songInfoOff) return;
    if (tab === "home" || tab === "todo" || !songInfo) reloadSongInfo();
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
  // one to the other doesn't start a second.
  const syncing = useRef(false);
  useEffect(() => {
    if ((tab !== "home" && tab !== "catalog" && tab !== "todo") || syncing.current || !can("publishing") || !isSheetSyncStale(db)) return;
    syncing.current = true;
    fullSiteSync(db, commit).catch((err) => console.error("Background sync failed:", err)).finally(() => { syncing.current = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  // A&R's counts (follow-ups due), Money's (payments to
  // log, rows to check), ClickUp's open tasks and the sync checks: To do's rows, its one count in the
  // sidebar, Home's biggest tasks and each tab's count chip all come from these
  const arSum = useArSummary(tab === "todo" ? "home" : tab);
  const [acctN, setAcctN] = useState(null);
  const loadAcctN = () => !can("money") ? Promise.resolve() : fetch("/api/accounting?counts=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => d?.counts && setAcctN(d.counts)).catch(() => {});
  useEffect(() => { loadAcctN(); }, []);
  useEffect(() => { if (tab === "todo") loadAcctN(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const ctx = { db, commit, reloadDb, songInfo, songInfoErr, songInfoOff, reloadSongInfo, onGo: go, cu, sync, ar: arSum, acct: acctN, reloadAcct: loadAcctN, setAcct: setAcctN, fixes, doneForYou, can, seeds };
  // r11: Home is "Dashboard" again, in the owner's order (the phone bar has the same order)
  const allTabs = [
    ["home", "Dashboard", LayoutDashboard], ["todo", "To do", ListChecks, todoN],
    ["ar", "A&R", Handshake, 0, "ar"], ["money", "Money", Receipt, 0, "money"],
    ["catalog", "Publishing", ListMusic, 0, "roster"], ["site", "Site", Globe, 0, "site"],
  ];
  // the tabs this account may use: Site holds Users too. Any other address opens the first of them.
  const tabs = allTabs.filter(([id]) => (id === "site" ? can("site") || can("users") : can(TAB_SECTION[id])));
  const at = tabs.some(([id]) => id === tab) ? tab : tabs[0]?.[0];
  const roleWord = db.access ? `${ROLES[db.access.role]?.label || "Staff"}${db.access.ownOnly ? " · own artists" : ""}` : "Staff — full edit access";
  return (
    <div className="dash">
      <aside className="dash-side">
        {/* r10 (H15): the logo stays in the dashboard (the Dashboard page), it doesn't leave for the public site */}
        <div className="dash-brand"><Link href="/dashboard" className="logo-link" aria-label="Dashboard" onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); go("home"); }}><Wordmark height={26} /></Link></div>
        <nav>
          {tabs.map(([id, label, Icon, badge, area]) => (
            <button key={id} className={[at === id && "active", PHONE_MORE.has(id) && "nav-more-item"].filter(Boolean).join(" ")} data-area={area} data-tab={id} aria-current={at === id ? "page" : undefined} onClick={() => setTab(id)} onPointerEnter={() => SECTION_CODE[id]?.()} onFocus={() => SECTION_CODE[id]?.()}>
              <Icon size={17} /> <span className="nav-label">{label}</span>
              {!!badge && <span className="nav-badge">{badge}</span>}
            </button>
          ))}
          <NavMore tabs={tabs.filter(([id]) => PHONE_MORE.has(id))} tab={at} badge={0} setTab={setTab} />
        </nav>
        <div className="dash-side-foot">
          <div className="dash-role" data-role={db.access?.role}>{roleWord}</div>
          <button className="dash-out" onClick={logout} disabled={signingOut}>{signingOut ? <><RefreshCw size={16} className="spin" /> Signing out…</> : <><LogOut size={16} /> Sign out</>}</button>
        </div>
      </aside>
      <main className="dash-main">
        {!at && <div className="admin-empty" data-no-sections>Your account has nothing turned on yet. Ask a Founder to turn on what you need in Site › Users.</div>}
        {at === "home" && <HomeDashboard ctx={ctx} todo={todo} cuTasks={cu.data?.tasks || []} todoN={todoN} onAcct={setAcctN} />}
        {at === "todo" && <TodoPage ctx={ctx} todo={todo} sub={sub} onSub={setSub} areaN={areaN} />}
        {at === "money" && <AccountingAdmin sub={sub} onSub={setSub} onCounts={setAcctN} chip={<TodoChip n={areaN("money")} area="money" onGo={go} />} onGo={go} />}
        {at === "site" && <SiteAdmin ctx={ctx} sub={sub} onSub={setSub} chip={<TodoChip n={areaN("site")} area="site" onGo={go} />} />}
        {at === "catalog" && <CatalogAdmin db={db} commit={commit} songInfo={songInfo} reloadSongInfo={reloadSongInfo} sub={sub} onGo={go} onSub={setSub} chip={<TodoChip n={areaN("roster")} area="roster" onGo={go} />} />}
        {at === "ar" && <ARAdmin onGo={go} sub={sub} onSub={setSub} chip={<TodoChip n={areaN("ar")} area="ar" onGo={go} />} />}
      </main>
    </div>
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
