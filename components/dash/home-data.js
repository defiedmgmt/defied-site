import { useState, useEffect, useMemo, useRef } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { dashCache, settleRestored } from "../shared/dash-caches";
import { loadedOnce, loadedRecently, markLoaded, readFresh } from "../shared/boot";
import { useOnResume } from "../app/resume";

// Home's data hooks, read by the shell too (list B #11: here, not in home.jsx, so every section can use
// them without loading Home). useHome: GET /api/home.
// (home.jsx) The landing tab: the company at a glance, in four blocks. Money first (Defied's commission, from
// Stripe), then To do (the Dashboard's own tasks and ClickUp's) beside This week (what's growing),
// then one Money card (payments, the accounting sheet, what the sheet doesn't have yet). Publishing's own detail (MASTER, the clients, their splits) stays on
// Publishing. The money, accounting and ClickUp parts come from /api/home; each says on its own
// when it can't load, so the rest of the page never waits on it.
export function useHome() {
  const [home, setHome] = useState(() => dashCache.home || null);
  const [failed, setFailed] = useState(false);
  const loader = useRef(null);
  useEffect(() => {
    let alive = true;
    // (2026-11-25) never an answer from before a write or a sign-in; a copy put back after a reload whose first read fails comes off the screen
    const miss = () => { if (!alive) return; setFailed(true); settleRestored("home", false, () => { dashCache.home = null; setHome(null); }); };
    const load = (fresh = false) => { setFailed(false); return readFresh(`/api/home${fresh ? "?fresh=1" : ""}`, undefined, () => load(fresh)).then(({ dropped, ok, j, t }) => {
      if (dropped || !alive) return;
      if (ok && j?.money) { dashCache.home = j; markLoaded("home", t); settleRestored("home", true); setHome(j); } else miss();
    }).catch(miss); };
    loader.current = load;
    // (2026-11-24, speed) back on the Dashboard within 30 s of the last read (and no save since): what it has
    if (!(dashCache.home && loadedRecently("home"))) load();
    return () => { alive = false; };
  }, []);
  // (2026-11-26 review) the installed app opened again after a while away (components/app/resume.js): read again, as Try again does
  useOnResume(() => loader.current?.());
  return { home, failed, retry: () => loader.current?.(), refresh: () => loader.current?.(true) };
}
export const monthName = (ym) => (ym ? new Date(`${ym}-15T12:00:00`).toLocaleDateString(undefined, { month: "long" }) : "This month");

// A&R's counts (GET /api/ar?summary=1): follow-ups due, and Summary's top people for Home's This week. Loaded once by StaffDashboard for the A&R badge and the Dashboard's task,
// again when the Dashboard opens. null while loading or when it couldn't load (no badge, no task).
export function useArSummary(tab) {
  const [t, setT] = useState(() => dashCache.ar || null);
  const [again, setAgain] = useState(0); // reload(): after a renewal in To do
  const seen = useRef(0);
  useEffect(() => {
    // (2026-11-24, speed) reload() always reads; otherwise not within 30 s of the last read, and off the Dashboard only once per visit
    // (a copy put back after a reload is read again)
    const forced = again !== seen.current;
    seen.current = again;
    if (!forced && (loadedRecently("ar") || (tab !== "home" && loadedOnce("ar")))) return undefined;
    let alive = true;
    // a failed read keeps the last answer, or marks it answered so the To do count doesn't wait forever (a copy put back after a reload
    // comes off: its first read failed)
    const miss = () => { if (!alive) return; if (settleRestored("ar", false, () => { dashCache.ar = null; })) setT({ failed: true }); else setT((x) => x || { failed: true }); };
    // (2026-11-25) never an answer from before a write or a sign-in, and the shared copy is written only while this screen is up
    readFresh("/api/ar?summary=1", undefined, () => alive && setAgain((n) => n + 1)).then(({ dropped, ok, j, t }) => {
      if (dropped || !alive) return;
      if (!ok || !j) return miss();
      dashCache.ar = j; markLoaded("ar", t); settleRestored("ar", true); setT(j);
    }).catch(miss);
    return () => { alive = false; };
  }, [tab, again]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => t && { ...t, reload: () => setAgain((n) => n + 1) }, [t]);
}

// A card's calm line while /api/home is on its way, or when it couldn't load at all
export function HomeWait({ failed, retry, what }) {
  return failed
    ? <p className="home-muted"><AlertTriangle size={15} /> <span>Couldn't load {what}. <button className="inline-link" onClick={retry}>Try again</button></span></p>
    : <p className="home-muted"><RefreshCw size={15} className="spin" /> Loading…</p>;
}
