// A&R Home (r11, /dashboard/ar): ONE screen, like the Dashboard. GET /api/ar-lists?view=home.
//   left   Week on week (its metric switch in the card's head; Up | Down inside), Day over day (Rising | Falling),
//          each row drawn like the Dashboard's "This week" card (components/dash/gainers.jsx markup and classes):
//          rank, photo or cover, name, grey sub-line ("Spotify followers · 5,197 → 5,806"), the % pill and "+609 followers"
//   right  New adds this week (each person, their count and chips of what they added, the adds-per-week bars) and
//          About to expire (one line when nothing does)
//   The freshness ("Updated Nov 5, 7:03 AM ⓘ") and "N to confirm ›" sit in A&R's head (ArFresh, below).
// Until Spotify has readings 7 days apart, Streams' week on week is each row's last real Luminate week, its weeks
// named in the card's grey line (or on each row when rows' weeks differ). Every number is the server's, unchanged.
import React, { useEffect, useRef, useState } from "react";
import { TrendingUp, CalendarRange, UserPlus, Clock, Info, Disc3 } from "lucide-react";
import { WowPill } from "../dash/chips";
import { thumb } from "../shared/ui";
import { n0, signed, dayText, atText, post, spanText, typeOf, TYPE_LABEL, weekLists } from "./fmt";

const SPARK_COLORS = ["var(--d-chart-1, #7aa2f7)", "var(--d-chart-2, #9ece6a)", "var(--d-chart-3, #e0af68)", "var(--d-chart-4, #bb9af7)", "var(--d-chart-5, #7dcfff)", "var(--d-chart-6, #f7768e)"];

function Weights({ w, canEdit, onSaved }) {
  const [v, setV] = useState(w);
  const [msg, setMsg] = useState("");
  useEffect(() => setV(w), [w]);
  if (!v) return null;
  const f = (k, label) => <label className="art-w"><span>{label}</span><input type="number" min="0" max="100" inputMode="numeric" value={v[k]} disabled={!canEdit} onChange={(e) => setV({ ...v, [k]: e.target.value })} data-weight={k} /></label>;
  return (
    <div className="art-weights" data-weights>
      <p className="art-help">Each part is growth for its size, so small artists on the rise score high. 50 = flat. Recent = how much the last 7 days count over the 3 weeks before.</p>
      <div className="art-w-row">{f("streams", "Streams")}{f("followers", "Followers")}{f("tiktok", "TikTok sounds")}{f("recent", "Recent %")}</div>
      {canEdit && <button className="btn sm" onClick={() => post("/api/ar-trackers", { action: "weights", weights: v }).then((j) => { setMsg("Saved."); onSaved?.(j.weights); }).catch((e) => setMsg(e.message))} data-save-weights>Save weights</button>}
      {msg && <span className="art-msg">{msg}</span>}
    </div>
  );
}

// adds per week: stacked bars, one colour per person, inline SVG
function AddsChart({ data }) {
  const { weeks = [], people = [] } = data || {};
  const tot = weeks.map((w) => Object.values(w.by).reduce((a, n) => a + n, 0));
  const max = Math.max(1, ...tot);
  const W = 320, H = 78, bw = (W - 20) / Math.max(1, weeks.length) - 6; // r11: small, under the adds
  return (
    <div className="arh-chart" data-adds-chart>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Adds per week">
        {weeks.map((w, i) => {
          let y = H - 16;
          const x = 10 + i * ((W - 20) / weeks.length);
          return (
            <g key={w.week}>
              {people.map((p, j) => {
                const n = w.by[p.id] || 0; if (!n) return null;
                const h = (n / max) * (H - 28); y -= h;
                return <rect key={p.id} x={x} y={y} width={bw} height={h} fill={SPARK_COLORS[j % SPARK_COLORS.length]}><title>{`${p.name}: ${n} in the week of ${w.label}`}</title></rect>;
              })}
              {tot[i] > 0 && <text x={x + bw / 2} y={y - 3} textAnchor="middle" className="ard-tick" data-bar-n={tot[i]}>{tot[i]}</text>}
              <text x={x + bw / 2} y={H - 3} textAnchor="middle" className="ard-tick">{w.label}</text>
            </g>
          );
        })}
      </svg>
      <p className="arh-legend">{people.map((p, j) => <span key={p.id}><i style={{ background: SPARK_COLORS[j % SPARK_COLORS.length] }} />{p.name}</span>)}{!people.length && "No adds in the last 8 weeks."} <em>The Luminate import isn't counted.</em></p>
    </div>
  );
}

// what the number under a pill counts ("+609 followers")
const UNIT = { listeners: "listeners", streams: "streams", spfollowers: "followers", tiktok: "followers", instagram: "followers", youtube: "subscribers", videos: "videos" };
// a row's grey line names its number short (the unit under the pill says the rest: "+609 followers")
const ROW_LABEL = { listeners: "Listeners", streams: "Streams", spfollowers: "Spotify followers", tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", videos: "Sound videos" };
// the week card's metric switch, short (the server's tabs, in its order)
const SHORT_TAB = { streams: "Streams", listeners: "Listeners", tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", videos: "Sounds" };
const N = 5;

// one row, the "This week" card's look; it opens that row's drawer
function MoverRow({ x, i, sub, onOpen, attr, title = null }) {
  const t = typeOf(x);
  const round = t === "artist" || t === "producer";
  return (
    <button type="button" className="gainer arh-row" data-type={t} {...attr} onClick={() => onOpen(x.key)}
      title={title || `${x.name} · ${TYPE_LABEL[t]} · ${sub}${x.src ? ` · ${x.src}` : ""}`}>
      <span className="gainer-n">{i + 1}</span>
      <span className={`lm-cover${round ? " gainer-av" : ""}`}>
        {x.image ? <img src={thumb(x.image, 96)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : round ? String(x.name || "?").slice(0, 1).toUpperCase() : <Disc3 size={16} />}
      </span>
      <span className="lm-song-main"><strong>{x.name}</strong><span>{sub}</span></span>
      <span className="gainer-num" data-wow={x.pct >= 0 ? "up" : "down"}><WowPill pct={x.pct} /><em>{signed(x.d)} {UNIT[x.metric] || ""}</em></span>
    </button>
  );
}
function Half({ title, list, kind, empty, row }) {
  return (
    <div className="arh-half" data-half={kind}>
      <h4 className="arh-half-h">{title}</h4>
      {list.length ? list.map(row) : <p className="arh-none" data-none={kind}>{empty}</p>}
    </div>
  );
}

// Day over day: two readings on two New York days in a row (or, before a second day, the last two readings)
function DayCard({ day, onOpen }) {
  const reads = day.mode === "readings";
  const span = spanText(day.span?.from, day.span?.to);
  const row = (x, i) => <MoverRow key={`${x.key}|${x.metric}`} x={x} i={i} onOpen={onOpen} attr={{ "data-mover": x.key }} sub={`${ROW_LABEL[x.metric] || x.label} · ${n0(x.from)} → ${n0(x.to)}`} />;
  const none = (dir) => `Nothing ${dir} past the size floors.`;
  return (
    <div className="gainers home-card arh-card" data-day-movers>
      <div className="attn-head"><TrendingUp size={15} /> <span data-day-title>{reads ? "Last two readings" : "Day over day"}</span></div>
      {day.up.length || day.down.length ? (
        <>
          <p className="gainer-sub" data-day-sub>{reads ? `${span} · day over day starts with a second day` : `${span} · New York days`}</p>
          <div className="arh-halves">
            <Half title="Rising" kind="up" list={day.up.slice(0, N)} empty={none("rose")} row={row} />
            <Half title="Falling" kind="down" list={day.down.slice(0, N)} empty={none("fell")} row={row} />
          </div>
        </>
      ) : <p className="gainers-empty" data-day-empty>Needs readings on two days in a row.</p>}
    </div>
  );
}

// Week on week, one metric at a time (weekLists in fmt.js: readings 7 days apart first, then Luminate's weeks)
function WeekCard({ movers, onOpen }) {
  const tabs = movers?.tabs || [];
  const [tab, setTab] = useState("streams");
  const wk = movers?.week?.[tab] || { up: [], down: [] };
  const { up, down, pairs, live } = weekLists(wk);
  // one pair of Luminate weeks: named once, in the grey line; more than one: on each row
  const perRow = pairs.length > 1 || (pairs.length && live);
  const grey = !up.length && !down.length ? ""
    : pairs.length && !live ? `Luminate · ${perRow ? "each row's week vs the week before" : pairs[0]} · all platforms${movers?.weekFrom ? ` · Spotify from ${movers.weekFrom}` : ""}`
    : `${SHORT_TAB[tab]} · readings 7 days apart${pairs.length ? " · Luminate weeks where there's no Spotify yet" : ""}`;
  const row = (x, i) => (
    <MoverRow key={`${x.key}|${x.metric}`} x={x} i={i} onOpen={onOpen} attr={{ "data-week-mover": x.key, ...(x.lum ? { "data-lum": x.weeks } : {}) }}
      sub={x.lum ? `${perRow ? x.weeks.split(" vs ")[0] : "Streams"} · ${n0(x.lastWeek)} → ${n0(x.thisWeek)}` : `${ROW_LABEL[x.metric] || x.label} · ${n0(x.lastWeek)} → ${n0(x.thisWeek)}`}
      title={x.lum ? `${x.name} · Luminate streams, all platforms · ${x.weeks}: ${n0(x.lastWeek)} → ${n0(x.thisWeek)}` : null} />
  );
  return (
    <div className="gainers home-card arh-card" data-week-section>
      <div className="attn-head"><CalendarRange size={15} /> Week on week
        <span className="gainer-tabs arh-wtabs" role="tablist" aria-label="Week on week">
          {tabs.map(([id]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)} data-week-tab={id}>{SHORT_TAB[id] || id}</button>)}
        </span>
      </div>
      {up.length || down.length ? (
        <>
          <p className="gainer-sub" data-week-sub>{grey}</p>
          <div className="arh-halves">
            <Half title="Up" kind="up" list={up} empty="Nothing rose week on week." row={row} />
            <Half title="Down" kind="down" list={down} empty="Nothing fell week on week." row={row} />
          </div>
        </>
      ) : <p className="gainers-empty" data-week-empty>Needs readings 7 days apart{movers?.weekFrom ? ` (from ${movers.weekFrom})` : ""}.</p>}
    </div>
  );
}

function AddsCard({ adds, addsByWeek, onOpen }) {
  const total = adds.reduce((a, p) => a + p.n, 0);
  return (
    <div className="home-card arh-card" data-adds>
      <div className="attn-head"><UserPlus size={15} /> New adds this week {total > 0 && <span className="arh-head-n" data-adds-total={total}>{total} since Monday</span>}</div>
      {adds.length ? (
        <div className="arh-adds">
          {adds.map((p) => (
            <div key={p.id} className="arh-add" data-adds-person={p.name}>
              <span className="arh-add-who"><b>{p.name}</b><span className="arh-add-n">{p.n}</span></span>
              <span className="arh-chips">{p.items.map((i) => <button key={i.key} type="button" className="arh-chip m-tap" data-type={typeOf(i)} onClick={() => onOpen(i.key)} data-add-chip={i.name} title={`${TYPE_LABEL[typeOf(i)]} · added ${atText(i.at)}`}><i />{i.name}</button>)}</span>
            </div>
          ))}
        </div>
      ) : <p className="gainers-empty">Nobody has added anything since Monday.</p>}
      <div className="arh-week" data-adds-week><span className="arh-week-h">Adds per week</span><AddsChart data={addsByWeek} /></div>
    </div>
  );
}
function ExpiringCard({ list, onOpen, reload }) {
  const [busy, setBusy] = useState(false);
  const renew = async (x) => { setBusy(true); try { await post("/api/ar-trackers", { action: "renew", entryId: x.entryId }); await reload(); } catch { /* the row stays */ } setBusy(false); };
  return (
    <div className="home-card arh-card" data-expiring>
      <div className="attn-head"><Clock size={15} /> About to expire</div>
      {list.length ? list.map((x) => (
        <div key={x.entryId} className="arh-exp" data-expiring-row={x.name}>
          <button type="button" className="inline-link arh-exp-name" onClick={() => onOpen(x.key)}>{x.name}</button>
          <span className="arh-exp-when">{x.who} · {x.state === "expired" ? `expired · ${x.graceLeft} days to renew` : `${x.daysLeft} ${x.daysLeft === 1 ? "day" : "days"} left`}</span>
          <button type="button" className="btn sm" disabled={busy} onClick={() => renew(x)} data-renew>Renew</button>
        </div>
      )) : <p className="gainers-empty" data-expiring-empty>Nothing ends in the next 7 days.</p>}
    </div>
  );
}

// A&R's head, on Home: "Updated Nov 5, 7:03 AM ⓘ" (the ⓘ lists each source's time, Luminate's weeks and whether
// automatic updates are on) and, when something waits, "3 to confirm ›" (Watchlist › To confirm)
export function ArFresh({ data, onConfirm }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const out = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", out); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", out); document.removeEventListener("keydown", esc); };
  }, [open]);
  if (!data) return null;
  const f = data.fresh || {};
  const fl = [["Spotify streams", f.streams, true], ["Monthly listeners", f.listeners], ["TikTok", f.tiktok], ["Instagram", f.instagram], ["YouTube", f.youtube]].filter(([, v]) => v);
  const newest = fl.map(([, v]) => v).sort().pop();
  const n = data.tiles?.toConfirm || 0;
  return (
    <span className="ar-fresh" ref={box}>
      <button type="button" className="ar-fresh-btn m-tap" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)} data-fresh>
        {newest ? `Updated ${atText(newest)}` : "No readings yet"} <Info size={13} aria-label="Where the numbers come from" />
      </button>
      {open && (
        <span className="ar-fresh-pop" role="dialog" aria-label="Where the numbers come from" data-fresh-pop>
          {fl.map(([label, v, time]) => <span key={label} className="ar-fresh-li"><span>{label}</span><b>{time ? atText(v) : dayText(v)}</b></span>)}
          {f.luminate && <span className="ar-fresh-li" data-fresh-lum><span>Luminate weeks</span><b>to {dayText(f.luminate)}{f.luminateAtd && f.luminateAtd > f.luminate ? ` · all-time to ${dayText(f.luminateAtd)}` : ""}</b></span>}
          <span className="ar-fresh-li" data-refresh-off={f.refresh ? undefined : ""}><span>Automatic updates</span><b>{f.refresh ? "on" : "off"}</b></span>
        </span>
      )}
      {n > 0 && <button type="button" className="ar-confirm-pill m-tap" onClick={onConfirm} data-tile="confirm">{n} to confirm ›</button>}
    </span>
  );
}

export function ArHome({ data, err, retry, onOpen, founder, reload }) {
  const [how, setHow] = useState(false);
  if (err) return <p className="hint err-text">{err} <button className="btn ghost sm" onClick={retry}>Try again</button></p>;
  if (!data) return <p className="muted">Loading…</p>;
  const day = data.movers?.day || { up: [], down: [] };
  return (
    <div className="arh" data-ar-home>
      <div className="arh-main">
        <WeekCard movers={data.movers} onOpen={onOpen} />
        <DayCard day={day} onOpen={onOpen} />
      </div>
      <div className="arh-side">
        <AddsCard adds={data.adds || []} addsByWeek={data.addsByWeek} onOpen={onOpen} />
        <ExpiringCard list={data.expiring || []} onOpen={onOpen} reload={reload} />
        {/* r10 fix (#8): momentum waits for a week of readings, so its weights wait too */}
        {data.momentumReady && <p className="arh-how"><button type="button" className="inline-link m-tap" onClick={() => setHow(!how)} aria-expanded={how} data-how>How momentum is scored</button></p>}
        {data.momentumReady && how && <div className="arh-pop"><Weights w={data.weights} canEdit={founder} onSaved={reload} /></div>}
      </div>
    </div>
  );
}
