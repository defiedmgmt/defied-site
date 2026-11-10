import { useState, useEffect, useMemo, useRef } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { dashCache } from "../shared/dash-caches";

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
    const load = (fresh = false) => { setFailed(false); return fetch(`/api/home${fresh ? "?fresh=1" : ""}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!alive) return; if (d?.money) { dashCache.home = d; setHome(d); } else setFailed(true); }).catch(() => alive && setFailed(true)); };
    loader.current = load;
    load();
    return () => { alive = false; };
  }, []);
  return { home, failed, retry: () => loader.current?.(), refresh: () => loader.current?.(true) };
}
export const monthName = (ym) => (ym ? new Date(`${ym}-15T12:00:00`).toLocaleDateString(undefined, { month: "long" }) : "This month");

// A&R's counts (GET /api/ar?summary=1): follow-ups due, and Summary's top people for Home's This week. Loaded once by StaffDashboard for the A&R badge and the Dashboard's task,
// again when the Dashboard opens. null while loading or when it couldn't load (no badge, no task).
export function useArSummary(tab) {
  const [t, setT] = useState(null);
  const [again, setAgain] = useState(0); // reload(): after a renewal in To do
  useEffect(() => {
    if (tab !== "home" && t && !again) return;
    let alive = true;
    // a failed read keeps the last answer, or marks it answered so the To do count doesn't wait forever
    const miss = () => alive && setT((x) => x || { failed: true });
    fetch("/api/ar?summary=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => (d ? alive && setT(d) : miss())).catch(miss);
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
