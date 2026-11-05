import { useState, useEffect, useMemo, useRef } from "react";
import { X, RefreshCw, AlertTriangle, CheckCircle2, ListChecks, CircleDollarSign, CalendarDays, TrendingUp } from "lucide-react";
import { HomeMomentum } from "../ar/ArTrackers";
import { biggestTasks, nyDay } from "../../lib/todo-rank";
import { LazySection } from "../ui/responsive";
import { clock } from "./ar";
import { ScrollFoot, TopGainers, payDay, shortDay, useScrollMore } from "./helpers";
import { LogConfirm, MoneyRow, TestChip } from "./money";
import { SyncSources, usd } from "./numbers";
import { swrJson, peekJson } from "../ui/fetch-cache";
import { CAL_SOURCES, CuTodoRow, TodoRow, WEEKDAY_SHORT, addDays, syncFix } from "./todo";
import { DropNote, fmt, money, useEscape } from "./ui";
import { dashCache } from "../shared/dash-caches";
import { ExtLink } from "../shared/ui";
// The landing tab: the company at a glance, in four blocks. Money first (Defied's commission, from
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
  useEffect(() => {
    if (tab !== "home" && t) return;
    let alive = true;
    // a failed read keeps the last answer, or marks it answered so the To do count doesn't wait forever
    const miss = () => alive && setT((x) => x || { failed: true });
    fetch("/api/ar?summary=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => (d ? alive && setT(d) : miss())).catch(miss);
    return () => { alive = false; };
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  return t;
}

// A card's calm line while /api/home is on its way, or when it couldn't load at all
export function HomeWait({ failed, retry, what }) {
  return failed
    ? <p className="home-muted"><AlertTriangle size={15} /> <span>Couldn't load {what}. <button className="inline-link" onClick={retry}>Try again</button></span></p>
    : <p className="home-muted"><RefreshCw size={15} className="spin" /> Loading…</p>;
}

// Home: the numbers, the sync pill, then the biggest tasks (at most five, ranked across ClickUp and the
// site by lib/todo-rank.js, each opening and finished right here, inside the card; "See all N" opens To do)
// beside This week (the roster's biggest gainers) with Spikes under it, then this week's calendar and the
// newest payments (r8). r10: every card has its own place in the one-screen grid (styles/app.css "One
// screen"), so nothing spills over another, and a ClickUp list the Defied Bot can't read is one line here.
export function HomeDashboard({ ctx, todo, cuTasks, todoN, onAcct }) {
  const { home, failed, retry, refresh } = useHome();
  const unlogged = home?.accounting?.unlogged, toCheck = home?.accounting?.toCheck || 0;
  useEffect(() => {
    if (!unlogged) return;
    const tests = unlogged.filter((p) => p.test);
    onAcct?.((x) => ({ ...x, toLog: unlogged.length, toCheck, toLogTotal: home.accounting.unloggedTotal, toLogTests: { n: tests.length, total: Math.round(tests.reduce((a, p) => a + p.amount, 0) * 100) / 100 } }));
  }, [unlogged, toCheck]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = home?.money;
  const { top } = useMemo(() => biggestTasks([...todo, ...cuTasks.map((t) => ({ ...t, kind: "clickup" }))]), [todo, cuTasks]);
  const [open, setOpen] = useState(() => new Set());
  const box = useRef(null);
  const hidden = useScrollMore(box);
  // an opened row grows inside the card's scroll box (H5): bring its panel into view there
  const toggle = (k) => setOpen((o) => {
    const n = new Set(o);
    if (n.has(k)) n.delete(k); else { n.add(k); requestAnimationFrame(() => box.current?.querySelector(`[data-item="${CSS.escape(k)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" })); }
    return n;
  });
  const settled = (ctx.songInfo || ctx.songInfoErr || ctx.songInfoOff) && ctx.ar && ctx.cu.data;
  const money = ctx.can("money"), syncOn = ctx.can("site") && !ctx.db.access?.ownOnly;
  // r10 (C2): the lists ClickUp won't show the Defied Bot (not shared with it): one line, opening To do › ClickUp
  const unread = (ctx.cu.data?.lists || []).filter((l) => l.error);
  return (
    <div className="home">
      <div className="admin-head"><h2>Home</h2>{syncOn && <SyncPill sync={ctx.sync} onGo={ctx.onGo} />}{money && m?.connected && !m.error && <span className="home-src">From Stripe · updated {clock(m.updatedAt)}</span>}</div>
      {money && <MoneyRow money={m} failed={failed} retry={retry} />}
      <div className="home-row">
        <div className="attn home-card todo home-top" data-home-top>
          <div className="attn-head"><ListChecks size={15} /> Biggest tasks
            {settled && <button type="button" className="inline-link home-all" data-see-all onClick={() => ctx.onGo("todo")}>{todoN ? `See all ${todoN}` : "Open To do"} ›</button>}</div>
          {unread.length > 0 && (
            <button type="button" className="todo-line home-cu-unread" data-cu-unread={unread.length} onClick={() => ctx.onGo("todo", "clickup")}>
              <AlertTriangle size={14} /> <span>{unread.length === 1 ? `ClickUp's ${unread[0].name} can't be read` : `${unread.length} ClickUp lists can't be read`}</span> <span className="home-cu-go" aria-hidden="true">›</span>
            </button>
          )}
          <div className="home-scroll home-top-list" ref={box}>
            {!top.length ? (settled ? <p className="todo-line todo-clear"><CheckCircle2 size={14} /> All caught up.</p> : <p className="todo-line"><RefreshCw size={14} className="spin" /> Checking what needs doing…</p>)
              : top.map((it) => (it.kind === "clickup" ? <CuTodoRow key={`cu:${it.id}`} t={it} cu={ctx.cu} /> : <TodoRow key={it.k} it={it} open={open.has(it.k)} onToggle={() => toggle(it.k)} ctx={ctx} />))}
          </div>
          <ScrollFoot n={hidden} box={box} />
        </div>
        <TopGainers db={ctx.db} onGo={ctx.onGo} arTop={ctx.ar?.top} arLoaded={!!ctx.ar} />
      </div>
      {/* Spikes (and A&R's momentum jumps) in their own place: under This week on a wide screen */}
      <div className="home-side" data-home-side>
        {ctx.can("publishing") && <HomeSpikes onGo={ctx.onGo} founder={!ctx.db.access || ctx.db.access.role === "founder"} siteOn={ctx.can("site")} />}
        {ctx.can("ar") && <HomeMomentum onGo={ctx.onGo} />}
      </div>
      <HomeWeek ctx={ctx} home={home} todo={todo} />
      {/* the last card: on a phone it's drawn once it nears the screen (or the page is idle), after what's on screen */}
      {money && <LazySection minHeight={240}><HomePayments home={home} failed={failed} retry={retry} refresh={refresh} onGo={ctx.onGo} /></LazySection>}
    </div>
  );
}

// Home's week: Monday to Sunday with To do Calendar's own sources (ClickUp's due tasks, payments to log), today marked, at most two a day plus "+N". A day's items open right here, in a
// small panel under it: a ClickUp task with Done ✓, a site item as its To do row (opening in place). An
// empty day stays empty.
const HOME_WEEK_CHIPS = 2;
const SITE_ITEM_OF = { money: (it) => it.k === "log" };
function HomeWeek({ ctx, home, todo }) {
  const today = nyDay(Date.now());
  const dow = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
  const start = addDays(today, -((dow(today) + 6) % 7)); // Monday
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(start, i));
  const events = CAL_SOURCES.flatMap((f) => f({ ...ctx, home }, days[0], days[6]));
  const on = (d) => events.filter((e) => e.day === d);
  const [pick, setPick] = useState(null); // { day, at: the day's box } | null
  const [openK, setOpenK] = useState(null); // the site item open in the panel
  const close = () => { setPick(null); setOpenK(null); };
  useEscape(close, !!pick);
  const show = (day, el) => { const b = el.closest(".hw-day").getBoundingClientRect(); setOpenK(null); setPick(pick?.day === day ? null : { day, b }); };
  const loading = !ctx.cu.data && !ctx.cu.failed;
  const label = (e) => <><span className="hw-chip-t">{e.label}</span></>;
  return (
    <div className="home-card home-week" data-home-week>
      <div className="attn-head hw-head"><CalendarDays size={15} /> This week's calendar <span className="hw-range">{shortDay(days[0])} – {shortDay(days[6])}</span>
        <button type="button" className="inline-link home-all" data-open-cal onClick={() => ctx.onGo("todo", "calendar")}>Open calendar ›</button></div>
      <div className="hw-grid" role="list">
        {days.map((d) => {
          const evs = on(d), more = evs.length - HOME_WEEK_CHIPS;
          return (
            <div key={d} role="listitem" className={["hw-day", d === today && "today", d < today && "past", pick?.day === d && "picked"].filter(Boolean).join(" ")} data-day={d}>
              <span className="hw-name">{WEEKDAY_SHORT[dow(d)]} <b>{Number(d.slice(8))}</b>{d === today && <em className="hw-today">Today</em>}</span>
              {evs.slice(0, more > 0 ? HOME_WEEK_CHIPS - 1 : HOME_WEEK_CHIPS).map((e, i) => (
                <button key={i} type="button" className={`hw-chip${e.late ? " late" : ""}`} data-kind={e.kind} data-area={e.kind} title={e.label} onClick={(ev) => show(d, ev.currentTarget)}>{label(e)}</button>
              ))}
              {more > 0 && <button type="button" className="hw-more" data-more={d} onClick={(ev) => show(d, ev.currentTarget)}>+{more + 1} more</button>}
              {!evs.length && loading && d === today && <span className="hw-wait"><RefreshCw size={12} className="spin" /></span>}
            </div>
          );
        })}
      </div>
      {pick && (
        <HomeWeekPanel at={pick.b} onClose={close}>
          <div className="hw-panel-head"><strong>{new Date(`${pick.day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}</strong>
            <button type="button" className="hw-x" aria-label="Close" onClick={close}><X size={16} /></button></div>
          {on(pick.day).map((e, i) => {
            if (e.task) return <CuTodoRow key={e.task.id} t={e.task} cu={ctx.cu} />;
            const it = SITE_ITEM_OF[e.kind] && todo.find(SITE_ITEM_OF[e.kind]);
            return it ? <TodoRow key={it.k} it={it} open={openK === it.k} onToggle={() => setOpenK((k) => (k === it.k ? null : it.k))} ctx={ctx} />
              : <div key={i} className="attn-row" data-area={e.kind}><span className="attn-main"><b>{e.label}</b></span></div>;
          })}
          {!on(pick.day).length && <p className="todo-line">Nothing on this day.</p>}
        </HomeWeekPanel>
      )}
    </div>
  );
}
// the day's panel: placed under the day (or over it when there's no room below), inside the window;
// a click outside closes it
function HomeWeekPanel({ at, onClose, children }) {
  const box = useRef(null);
  useEffect(() => {
    const out = (e) => { if (box.current && !box.current.contains(e.target) && !e.target.closest?.(".hw-day, .modal")) onClose(); };
    document.addEventListener("mousedown", out);
    return () => document.removeEventListener("mousedown", out);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const vw = typeof window === "undefined" ? 1440 : window.innerWidth, vh = typeof window === "undefined" ? 900 : window.innerHeight;
  const w = Math.min(460, vw - 32), left = Math.max(16, Math.min(at.left, vw - w - 16));
  const below = vh - at.bottom - 16, above = at.top - 16;
  // r10 (H12): under the day (over Recent payments) whenever three rows fit there, so it never covers the
  // calendar's own head or the cards above it
  const pos = below >= 200 || below >= above ? { top: at.bottom + 6, maxHeight: below - 6 } : { bottom: vh - at.top + 6, maxHeight: above - 6 };
  return <div ref={box} className="hw-panel attn todo" role="dialog" aria-label="This day" style={{ left, width: w, ...pos }}>{children}</div>;
}

// Home's newest payments: the last five from Stripe (the same rows and Log it as Money › All payments),
// and the accounting sheet's four numbers as the card's second tab; "All payments ›" opens Money
const HOME_PAY_N = 5;
function HomePayments({ home, failed, retry, refresh, onGo }) {
  const [sec, setSec] = useState("payments");
  const [logIds, setLogIds] = useState(null);
  const P = home?.payments, A = home?.accounting;
  const rows = P?.items?.slice(0, HOME_PAY_N) || [];
  let body;
  if (!home) body = <HomeWait failed={failed} retry={retry} what="the payments" />;
  else if (sec === "accounting") {
    body = !A?.connected ? <p className="home-muted">Accounting sheet: not connected yet.</p>
      : A.error ? <p className="home-muted"><AlertTriangle size={15} /> {A.error}</p>
      : (
        <div className="cat-summary-grid acct-grid home-acct">
          {[["monthNet", `Net · ${monthName(A.month)}`, `${money(A.monthRevenue)} in · ${money(A.monthExpenses)} out`], ["yearNet", "Net this year"], ["checkingBalance", "Business Checking"], ["taxSetAside", "Tax set-aside (this quarter)"]].map(([k, l, note]) => (
            <div key={k} className="cat-stat" data-stat={k}><span className="cat-stat-label">{l}</span><span className="cat-stat-val">{money(A[k])}</span><span className="acct-note" aria-hidden={note ? undefined : "true"}>{note || "\u00a0"}</span></div>
          ))}
        </div>
      );
  } else {
    body = !P?.connected ? <p className="home-muted"><CircleDollarSign size={15} /> Connect Stripe to see payments here.</p>
      : P.error ? <p className="home-muted"><AlertTriangle size={15} /> {P.error}</p>
      : !rows.length ? <p className="home-muted">No payments yet.</p>
      : (
        <div className="hp-list">
          {rows.map((p) => (
            <div key={p.id} className="hp-row" data-pay={p.id}>
              <span className="hp-day">{payDay(p.at)}</span>
              <span className="hp-who"><strong>{p.client || p.payer || "Unknown payer"}</strong>{p.test && <> <TestChip /></>}</span>
              <span className="hp-amt"><b>{money(p.fee)}</b>{p.fee !== p.amount && <em>of {money(p.amount)}</em>}</span>
              <span className="hp-act">{p.logged === false ? <button type="button" className="btn ghost sm pay-log" data-log={p.id} onClick={() => setLogIds([p.id])}>Log it</button>
                : p.logged ? <span className="hp-in" title="In the accounting sheet"><CheckCircle2 size={14} /> In the sheet</span> : null}</span>
            </div>
          ))}
        </div>
      );
  }
  return (
    <div className="home-card home-pay" data-home-pay>
      <div className="attn-head"><CircleDollarSign size={15} /> Recent payments
        <span className="gainer-tabs" role="tablist" aria-label="Money">
          {[["payments", "Payments"], ["accounting", "Accounting"]].map(([k, l]) => <button key={k} role="tab" aria-selected={sec === k} data-pay-tab={k} className={sec === k ? "active" : ""} onClick={() => setSec(k)}>{l}</button>)}
        </span>
        <button type="button" className="inline-link home-all" data-all-payments onClick={() => onGo("money", sec === "accounting" ? null : "payments")}>{sec === "accounting" ? "Open Money" : P?.total ? `All payments (${fmt(P.total)})` : "All payments"} ›</button></div>
      {body}
      {logIds && <LogConfirm ids={logIds} canLog={!!A?.canLog} onClose={() => setLogIds(null)} onDone={refresh} onDetails={() => onGo("todo", "log")} />}
    </div>
  );
}

// Home's sync pill: all good, or how many checks are amber; opens Site › Sync
function SyncPill({ sync, onGo }) {
  const d = sync.data, n = d?.outOfSync || 0;
  return (
    <button type="button" className={`sync-pill${!d ? "" : n ? " warn" : " ok"}`} data-sync-pill={!d ? "wait" : n ? "warn" : "ok"} onClick={() => onGo("site", "sync")}>
      <i className="sync-dot" aria-hidden="true" />{!d ? (sync.failed ? "Sync: couldn't check" : "Checking sync…") : n ? `${n} thing${n === 1 ? "" : "s"} out of sync` : "Synced · all good"}
    </button>
  );
}

// Site › Sync: every check, one line each, green or amber, with its fix
export function SyncView({ ctx }) {
  const { sync } = ctx;
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const d = sync.data;
  return (
    <div className="sync-view">
      <p className="hint overview-subhint">{d ? <>Checked {clock(d.at)} · <button className="inline-link" disabled={sync.busy} onClick={() => sync.load(true)}>{sync.busy ? "Checking…" : "Check again"}</button></> : sync.failed ? <>Couldn't run the checks. <button className="inline-link" onClick={() => sync.load(true)}>Try again</button></> : "Checking…"}</p>
      <DropNote note={note} />
      {d && (
        <div className="attn home-card sync-list">
          {d.checks.map((c) => (
            <div key={c.id} className="attn-row sync-row" data-check={c.id} data-ok={c.ok === true ? "ok" : c.ok === false ? "warn" : "unknown"}>
              <i className="sync-dot" aria-hidden="true" />
              <span className="attn-main"><b>{c.text}</b>{c.detail && <em>{c.detail}</em>}</span>
              {c.ok === false && c.fix && (c.fix.kind === "url"
                ? <ExtLink className="btn ghost sm" href={c.fix.url}>{c.fix.label}</ExtLink>
                : <button type="button" className="btn ghost sm" data-sync-fix={c.id} disabled={!!busy} onClick={() => syncFix(c, ctx, (b) => setBusy(b ? c.id : null), setNote)}>{busy === c.id ? "Working…" : c.fix.label}</button>)}
            </div>
          ))}
        </div>
      )}
      <SyncSources ctx={ctx} />
    </div>
  );
}

// Home's spikes and new releases (from the automated numbers; list B #4), in their own card under This
// week. Nothing to say: nothing shown. The link opens Site › Sync, where the sources are (r10: the Numbers
// tab is gone); only a Founder sees what they cost.
function HomeSpikes({ onGo, founder, siteOn }) {
  const [d, setD] = useState(() => peekJson("/api/data?home=1") || null);
  const box = useRef(null);
  const hidden = useScrollMore(box);
  useEffect(() => { swrJson("/api/data?home=1", setD).catch(() => {}); }, []);
  if (!d || (!d.spikes.length && !d.newReleases.length)) return null;
  const cost = founder && d.cost?.estMonthlyUsd != null ? ` · about ${usd(d.cost.estMonthlyUsd)}/month` : "";
  return (
    <div className="home-card nums-home home-spikes" data-home-numbers>
      <div className="attn-head"><TrendingUp size={15} /> Spikes and new releases
        {siteOn && <button type="button" className="inline-link home-all" data-spikes-sources onClick={() => onGo("site", "sync")}>Sources{cost} ›</button>}</div>
      <div className="home-scroll" ref={box}>
        {d.spikes.map((x, i) => <p key={`s${i}`} className="todo-line spike-line" data-spike><b>{x.name}</b> <span>{x.text}</span></p>)}
        {d.newReleases.map((r, i) => <p key={`r${i}`} className="todo-line spike-line" data-new-release><b>{r.artist}</b> <span>released “{r.name}” ({shortDay(r.releaseDate)}), picked up for tracking</span></p>)}
      </div>
      <ScrollFoot n={hidden} box={box} />
    </div>
  );
}
