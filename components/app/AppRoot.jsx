import { createContext, useContext, useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { ACCOUNT_CHANGED, SAVE_OFFLINE, SIGNED_OUT, accountChanged, applyPatch, diffDb, holdUnload, inTabOrder, refusal, saveFailure, saveKeys, withoutPasswords } from "./saves";
import { clearDashCaches } from "../shared/dash-caches";
import { ROUTE_TO_PATH, routeOf } from "../shared/routes";
import { useRevealOnScroll, vtWillRun } from "../shared/ui";
import { DATA_ROUTES, PageGuard } from "../site/About";
import { PUBLIC_CACHE_KEY, PUBLIC_CACHE_MAX_AGE, PUBLIC_REFRESH_MS, Toast, fetchPublicData, publicDataRequest, withSlugs } from "../site/data";
import { Footer, PublicNav } from "../site/nav";

/* ================================================================== */
/*  APP SHELL (was components/App.jsx's App)                           */
/* ================================================================== */
// Mounted once, in pages/_app.jsx, around every page, and kept across client-side route changes: it
// holds the session, the dashboard's data and its save queue, and the public pages' data, and draws
// the site's chrome (nav, footer) around the page. Each page file draws its own content (list B #11):
// the public pages are rendered on the server from the site data their getServerSideProps reads, and
// the dashboard and portal pages read what they need from this shell through useApp().
const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

// a public page's content, with the guard that keeps a copy it can't draw from taking the app down
export function PublicPage({ children }) {
  const { publicData, pubErr, route, onDrop } = useApp();
  return (
    <PageGuard data={publicData} outage={!!pubErr && !publicData && DATA_ROUTES.includes(route)} onDrop={onDrop}>
      {children}
    </PageGuard>
  );
}

export default function AppRoot({ Component, pageProps }) {
  const router = useRouter();
  // pages/404 renders for any unknown URL; everything else unknown still falls back to Home
  const route = routeOf(router.pathname);
  // undefined = /api/auth/me hasn't answered yet, null = signed out,
  // {id, role, name, clientId} = signed in. Every route-protection decision
  // below waits for this to leave "undefined" so a real session's data
  // never flashes as "signed out" for a tick, and a genuinely signed-out
  // visitor never sees a protected page render before the redirect fires.
  const [session, setSession] = useState(undefined);
  // authenticated dashboard/portal data — staff gets the full shape, a
  // client gets only their own client record + own placements (server-side,
  // not just hidden in the UI — see /api/dashboard-data). null until loaded.
  const [db, setDb] = useState(null);
  // public marketing-page data — fetched once, always, regardless of auth
  // state, since the public pages and their data were never sensitive.
  // A public page arrives with the server's copy (its getServerSideProps), so it's drawn in the very
  // first HTML; the server and the first render in the browser use that same copy. A page without one
  // (the dashboard, or a server read that failed) starts from the last good copy saved in this browser
  // (read just after the first render, so it matches the server's) and swaps in the fresh one when
  // it lands.
  const ssrData = pageProps?.publicData || null;
  const [publicData, setPublicData] = useState(() => (ssrData ? withSlugs(ssrData) : null));
  const hadCachedData = useRef(publicData !== null);
  useEffect(() => {
    if (publicData) return;
    try {
      const c = JSON.parse(localStorage.getItem(PUBLIC_CACHE_KEY) || "null");
      if (c && Array.isArray(c.clients) && Date.now() - (c.savedAt || 0) < PUBLIC_CACHE_MAX_AGE) { hadCachedData.current = true; setPublicData(withSlugs(c)); }
    } catch { /* storage blocked */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // a client-side visit to a public page brings the server's fresh copy with it
  const shownSsr = useRef(ssrData);
  useEffect(() => {
    if (!ssrData || ssrData === shownSsr.current) return;
    shownSsr.current = ssrData;
    const next = withSlugs(ssrData);
    setPublicData((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
  }, [ssrData]);
  const pubStale = useRef(false); // set by a dashboard save
  const [menuOpen, setMenuOpen] = useState(false);
  const [loadErr, setLoadErr] = useState(null); // the dashboard's own load / save errors
  const [signIns, setSignIns] = useState(0); // each sign-in reloads its data, even as the same account
  const signedInHere = useRef(false); // login() is already on its way to the dashboard
  const [pubErr, setPubErr] = useState(null); // the public pages' data
  const [authDown, setAuthDown] = useState(false); // /api/auth/me couldn't check the sign-in (not "signed out")
  const [signingOut, setSigningOut] = useState(false); // sign-out is waiting for queued saves to land
  useRevealOnScroll(route !== "staff" && route !== "client");

  // the fresh copy (see publicDataRequest) swaps in when it lands; a failed request only shows
  // the banner when there was nothing cached to show instead
  useEffect(() => {
    let alive = true;
    publicDataRequest.then((d) => {
      if (!alive) return;
      if (d) { const next = withSlugs(d); setPublicData((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next)); }
      else if (!hadCachedData.current) setPubErr("Couldn't load site data — try refreshing.");
    });
    return () => { alive = false; };
  }, []);

  // a tab left open never reloads on its own: coming back to it picks up whatever the dashboard has
  // changed since (public pages only, at most once a minute). An answer with nothing new leaves the
  // page alone, and a failed one keeps what's on screen.
  const pubFetchedAt = useRef(Date.now());
  const onPublicRoute = route !== "staff" && route !== "client";
  useEffect(() => {
    if (!onPublicRoute) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible" || Date.now() - pubFetchedAt.current < PUBLIC_REFRESH_MS) return;
      pubFetchedAt.current = Date.now();
      fetchPublicData().then((d) => {
        if (!d) return;
        const next = withSlugs(d);
        setPublicData((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
        setPubErr(null);
      });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [onPublicRoute]);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; })
      .then((d) => { if (alive) setSession(d.user ?? null); })
      // a 503 (the account couldn't be checked) or no connection: signed out, not "still asking" forever,
      // but the sign-in page says why
      .catch(() => { if (alive) { setSession(null); setAuthDown(true); } });
    return () => { alive = false; };
  }, []);
  // that notice is about one failed check: the sign-in page asks again before repeating it
  useEffect(() => {
    if (route !== "login" || !authDown) return;
    let alive = true;
    fetch("/api/auth/me")
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; })
      .then((d) => { if (!alive) return; setAuthDown(false); if (d.user) setSession(d.user); })
      .catch(() => {}); // still down: the notice stays
    return () => { alive = false; };
  }, [route, authDown]);

  // the db the dashboard last drew — what an edit made in it was derived from
  const shownDb = useRef(null);
  shownDb.current = db;
  // save bookkeeping: chain = the queue saves run through one at a time; pending = saves queued or
  // in flight; calls = saves ever started; failed = one failed since the queue last emptied;
  // server = the latest server copy this tab knows of; gen = bumped per sign-in, so a save still
  // queued from the last one is dropped; freshAt = when server was last fetched
  const saves = useRef({ chain: Promise.resolve(), pending: 0, held: 0, calls: 0, failed: false, server: null, gen: 0, freshAt: 0 });

  // once a session is known, load its scoped dashboard/portal data —
  // re-fires if the signed-in user actually changes (login/logout/switch).
  useEffect(() => {
    const s = saves.current;
    s.gen++; s.server = null;
    setLoadErr(null); // the last account's banner isn't this one's
    setDb(null); // nor its data: "Loading…" until this account's own copy lands
    if (!session) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/dashboard-data");
        if (res.status === 401) { if (alive) setSession(null); return; }
        const data = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok || !data.role) throw new Error(data.error || "Failed to load.");
        if (data.role !== session.role) throw new Error(ACCOUNT_CHANGED);
        s.server = data; s.freshAt = Date.now();
        setDb(data);
      } catch (err) {
        if (alive) setLoadErr(err.message || "Couldn't load your dashboard data.");
      }
    })();
    return () => { alive = false; };
  }, [session?.id, signIns]);

  // Callers keep the old commit({...db, changedKey: newValue}) shape. The UI updates at once; the
  // save itself waits its turn, then rebases: what this edit changed (base -> next, field by field,
  // see diffDb) is applied to the server's latest copy, and only the tables it touched are sent. So
  // a song a client added, a new message or another staff member's edit since this tab loaded is
  // never wiped by sending this tab's old copy back. base = the db next was built from: the one on
  // screen, or for a slow job (the sheet sync) the copy it started from. Resolves with the server's
  // copy as saved (a row deleted elsewhere is missing from it), or false when nothing was saved.
  // quiet: a save the dashboard makes by itself (r7: an even split the sheet already has), which the next load
  // would make again: leaving the page while it's on its way doesn't ask "leave the page?"
  const commit = (next, base = shownDb.current, { quiet = false } = {}) => {
    const patch = diffDb(base, next);
    if (!patch) return Promise.resolve(next);
    const s = saves.current, gen = s.gen;
    setDb((cur) => (cur === base ? next : cur && applyPatch(cur, patch)));
    // leaving now would drop it: the browser asks first while anything is unsaved
    s.pending++;
    if (!quiet && s.held++ === 0) window.addEventListener("beforeunload", holdUnload);
    s.calls++;
    const run = s.chain.then(async () => {
      let saved = false;
      try {
        if (gen !== s.gen) return false; // signed out since
        const got = await fetch("/api/dashboard-data", { cache: "no-store" }).catch(() => null);
        const latest = got && await got.json().catch(() => null);
        // a 404: a client account with no client record (staff demoted with nobody linked)
        if (got?.status === 404) throw new Error(ACCOUNT_CHANGED);
        if (!got?.ok || !latest?.role) throw new Error(saveFailure(got, latest, SAVE_OFFLINE));
        // the account was demoted or re-linked since this tab loaded: keep what's on screen as it is
        if (accountChanged(latest, s.server || base)) throw new Error(ACCOUNT_CHANGED);
        const fresh = inTabOrder(latest, s.server);
        s.server = fresh; s.freshAt = Date.now();
        const merged = applyPatch(fresh, patch);
        const refused = refusal(patch, fresh, merged);
        if (refused) throw new Error(refused);
        const res = await fetch("/api/dashboard-data", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
          body: JSON.stringify(Object.fromEntries(saveKeys(patch, fresh, merged).map((k) => [k, merged[k]]))),
        }).catch(() => null);
        if (!res?.ok) throw new Error(saveFailure(res, res && await res.json().catch(() => null), "Save failed.", fresh.role));
        s.server = saved = withoutPasswords(merged);
        if (!s.failed) setLoadErr(null);
        // the public pages' copy is now out of date: refetch it when staff next open one
        pubStale.current = true;
        try { localStorage.removeItem(PUBLIC_CACHE_KEY); } catch { /* storage blocked */ }
      } catch (err) {
        s.failed = true;
        if (gen === s.gen) setLoadErr(err.message || "Couldn't save that change — try again.");
      } finally {
        // the last save out shows the server's copy: others' changes, minus anything that failed
        if (!quiet && --s.held === 0) window.removeEventListener("beforeunload", holdUnload);
        if (--s.pending === 0) { s.failed = false; if (gen === s.gen) setDb(s.server); }
        else if (saved && patch.users && gen === s.gen) setDb(withoutPasswords);
      }
      return saved;
    });
    s.chain = run;
    return run;
  };

  // after the server changed data itself (a sheet tab fixed, a song removed): swap in its copy once the
  // saves queued in this tab have landed. A save started meanwhile brings its own fresh copy.
  const reloadDb = async () => {
    const s = saves.current, gen = s.gen;
    await s.chain;
    if (gen !== s.gen || s.pending) return;
    const calls = s.calls;
    const res = await fetch("/api/dashboard-data", { cache: "no-store" }).catch(() => null);
    const fresh = res?.ok ? await res.json().catch(() => null) : null;
    if (!fresh?.role || gen !== s.gen || s.pending || calls !== s.calls || accountChanged(fresh, s.server || fresh)) return;
    s.server = inTabOrder(fresh, s.server); s.freshAt = Date.now();
    setDb(s.server);
  };

  // an open dashboard shows new contact messages when staff come back to the tab (at most every
  // 30 s, never mid-save). Only the Messages list is swapped in, so nothing being edited is touched.
  useEffect(() => {
    if (route !== "staff" || session?.role !== "staff") return;
    const s = saves.current;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || s.pending || !s.server || Date.now() - s.freshAt < 30000) return;
      s.freshAt = Date.now();
      const { gen, calls } = s;
      try {
        const res = await fetch("/api/dashboard-data", { cache: "no-store" });
        const fresh = res.ok ? await res.json() : null;
        // a save started meanwhile brings its own fresh copy
        if (!Array.isArray(fresh?.submissions) || gen !== s.gen || calls !== s.calls) return;
        s.server = { ...s.server, submissions: fresh.submissions };
        setDb((cur) => cur && { ...cur, submissions: fresh.submissions });
      } catch { /* offline: the next return to the tab tries again */ }
    };
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    refresh(); // back on the dashboard from the public pages, in the same tab
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", onVisible); };
  }, [route, session?.id, session?.role]);

  const go = (r) => {
    const path = ROUTE_TO_PATH[r] || "/";
    const nav = router.pathname !== path ? router.push(path) : Promise.resolve();
    setMenuOpen(false);
    window.scrollTo(0, 0);
    return nav;
  };

  const login = async (email, password) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) return data?.error || (res.status >= 500 || res.ok ? "Sign-in isn't available right now — try again in a minute." : "Incorrect email or password.");
    // in the same render as the route change: the new dashboard never draws the last account's data
    clearDashCaches();
    setDb(null); setSession(data.user); setAuthDown(false); setLoadErr(null); setSignIns((n) => n + 1);
    signedInHere.current = true; // this push goes on from the sign-in page; the effect below needn't
    go(data.user.role === "staff" ? "staff" : "client");
    return null;
  };
  const logout = async () => {
    if (signingOut) return;
    // a save still queued or running needs the session: let it land first (but never hold sign-out
    // long). The Sign out buttons say so meanwhile.
    setSigningOut(true);
    try {
      const s = saves.current, until = Date.now() + 8000;
      while (s.pending && Date.now() < until) await Promise.race([s.chain, new Promise((r) => setTimeout(r, until - Date.now()))]);
      await fetch("/api/auth/logout", { method: "POST", headers: { "X-Requested-With": "defied-site" } }).catch(() => {});
      // navigate home BEFORE clearing session — otherwise the route-guard
      // effect below sees session go null while route is still "staff"/
      // "client" for one render and races router.replace("/login") against
      // this push, sometimes winning and landing back on the login page.
      await go("home");
      clearDashCaches(); // the next account never sees this one's last answers
      setSession(null);
      setDb(null);
      setLoadErr(null); setAuthDown(false);
    } finally { setSigningOut(false); }
  };

  // a direct visit to /dashboard or /portal — a bookmark, a refresh, a
  // shared link — with no session bounces to sign-in instead of rendering
  // nothing. Gated on session !== undefined so this never fires before
  // /api/auth/me has had its one round trip to answer. This is now purely
  // a UX nicety, not the security boundary — the data itself is unreachable
  // without a valid session regardless of what this effect does.
  useEffect(() => {
    if (session === undefined) return;
    if (route === "staff" && session?.role !== "staff") router.replace("/login");
    if (route === "client" && session?.role !== "client") router.replace("/login");
    // already signed in: the sign-in page (Back from the dashboard, a bookmark) goes on to the
    // dashboard or portal instead of asking again
    if (route !== "login") signedInHere.current = false;
    else if (session?.role && !signedInHere.current) router.replace(session.role === "staff" ? "/dashboard" : "/portal");
  }, [route, session]);

  const inPortal = route === "staff" || route === "client";

  // after a dashboard save, going back to the public site (logo, nav) shows what was just saved
  useEffect(() => {
    if (inPortal || !pubStale.current) return;
    pubStale.current = false;
    fetch("/api/public-data")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!Array.isArray(d?.clients)) return;
        try { localStorage.setItem(PUBLIC_CACHE_KEY, JSON.stringify({ ...d, savedAt: Date.now() })); } catch { /* storage full or blocked */ }
        setPublicData(withSlugs(d));
      })
      .catch(() => {});
  }, [inPortal]);
  // browsers with View Transitions animate route changes there; the rest get a CSS entrance. The page
  // the visit starts on is already drawn by the server, so it doesn't play it (and the server's HTML
  // and the browser's first render agree)
  const [navigated, setNavigated] = useState(false);
  useEffect(() => {
    const on = () => setNavigated(true);
    router.events.on("routeChangeComplete", on);
    return () => router.events.off("routeChangeComplete", on);
  }, [router.events]);
  const canViewTransition = !navigated || (typeof document !== "undefined" && !!document.startViewTransition);
  const onDrop = () => publicDataRequest.then((d) => { if (!d || d === publicData) setPubErr("Couldn't load site data — try refreshing."); });
  const notice = authDown ? "We couldn't check your sign-in just now — try again in a minute." : null;
  const shared = { route, publicData, pubErr, onDrop, session, db, commit, reloadDb, login, logout, signingOut, notice };

  // the App persists across routes, so the mobile menu has to be told to
  // close on any navigation — including back/forward, not just link taps.
  // Without a view transition to capture it, it waits for the new page, so
  // the page being left never shows through the fading menu.
  useEffect(() => {
    const ev = vtWillRun() ? "routeChangeStart" : "routeChangeComplete";
    const close = () => setMenuOpen(false);
    router.events.on(ev, close);
    // /about#x → /about is hash-only: Next fires hashChange*, never routeChange* (and Back between
    // two fragments of the first page fires no router event at all)
    router.events.on("hashChangeComplete", close);
    window.addEventListener("hashchange", close);
    return () => { router.events.off(ev, close); router.events.off("hashChangeComplete", close); window.removeEventListener("hashchange", close); };
  }, [router.events]);

  return (
    <AppCtx.Provider value={shared}>
      <div className={inPortal ? "app" : "app pub"}>
        {!inPortal && <div className="grain" aria-hidden="true" />}
        {/* signed out mid-edit: the page stays put so typed text can be copied; the link (the sentence's last
            words) reloads it fresh. One span, so text and link wrap as one line of text */}
        {inPortal ? loadErr && <div className="storage-warn" role="alert"><span>{loadErr}{loadErr === SIGNED_OUT && <> <a href={ROUTE_TO_PATH.login} className="inline-link">sign in again.</a></>}</span></div>
          : pubErr && DATA_ROUTES.includes(route) && <div className="storage-warn" role="alert">{pubErr}</div>}
        {!inPortal && (
          <PublicNav route={route} menuOpen={menuOpen} setMenuOpen={setMenuOpen} session={session} />
        )}

        {/* the open poster menu is modal: the page under it leaves the tab order. The page itself (pages/*):
            a public one wraps its content in <PublicPage> (the banner when there's nothing better coming:
            the request failed, or the copy that just failed to draw already is the fresh one) */}
        <div className={`${route === "home" || route === "login" || route === "notfound" ? "view view-home" : "view"}${canViewTransition ? "" : " view-anim"}`} key={route} {...(menuOpen ? { inert: "" } : {})}>
          <Component {...pageProps} />
        </div>

        {!inPortal && <Footer route={route} inert={menuOpen} />}
        {!inPortal && <Toast />}
      </div>
    </AppCtx.Provider>
  );
}
