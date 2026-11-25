// A&R's big chart (2026-11-20): one series over time, drawn for the person view (full screen, or the 480px drawer, or a phone).
// What it shows, top to bottom: the dates and number of readings in view with the range pills (7D / 30D / All, only the ranges the data more than
// fills), a row of four numbers for that range (now, the change, the average per day, the biggest day), the chart, and its notes (dashed = no reading;
// where the scale starts; which releases the dotted lines are). The chart: x placed by CALENDAR DAY (a missing day is a visible gap, never squeezed
// out), y on 4 to 5 round numbers with the lowest one always labelled and the scale never starting at 0 when that would flatten the line, a faint dashed
// connector wherever days have no reading, a strip of bars (the change since the day before, the week before or the previous reading; green up, red down) on
// the same x scale, dotted lines on release days, and a crosshair that snaps to the nearest reading under a finger, a mouse or ← / → (Home / End too).
// Everything it works out is in lib/ar/chart.js (pure, tested); this file only turns that into shapes. Styles: components/ar/ar-grid.css (.bc-*).
//   points   [[day, v]] or [{ d, v }] (see lib/ar/chart.js)          kind      "level" | "total" | "daily" (bars: a day's gain)
//   step     1 daily, 7 weekly, "auto" none (Luminate's weeks / its      unit      "listeners", "streams": said after a number in the hover
//            all-time totals: readings whenever an export was made)
//   releases [{ d, name }]                                             variant   "full" (340px tall; 240 on a phone) or "drawer" (200px)
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { phoneQuery } from "../../lib/phone";
import { buildChart, hitAt, moveIndex, normPoints, spacingOf, countWords, rangesFor, inRange, rangeLabel, summarize, tipOf, ariaSummary, compact, exact, signedText, pctText, shortDay } from "../../lib/ar/chart";

const useIso = typeof window !== "undefined" ? useLayoutEffect : useEffect; // layout effects only where there is a page (the server prints without one)

// phones (the drawer's own breakpoint, ar-grid.css): the chart is a little taller than the drawer's and the person view is always full screen
export function usePhone() {
  const [phone, setPhone] = useState(false);
  useIso(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia(phoneQuery(699)), on = () => setPhone(mq.matches);
    on();
    if (mq.addEventListener) { mq.addEventListener("change", on); return () => mq.removeEventListener("change", on); }
    mq.addListener(on);
    return () => mq.removeListener(on);
  }, []);
  return phone;
}
// the width the chart is drawn at: its box's, read before the first paint and on every resize, so the text is never scaled
function useBoxWidth(ref, fallback) {
  const [w, setW] = useState(fallback);
  useIso(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => { const x = Math.round(el.getBoundingClientRect().width); if (x > 0) setW((o) => (o === x ? o : x)); };
    read();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

const NONE = []; // (a stable empty list: the chart is rebuilt when its releases change)
const dirOf = (n) => (n > 0 ? "up" : n < 0 ? "down" : "flat");
const rangeText = (sel) => (sel === "all" ? "all readings" : `${sel} days`);
// the row above the chart: [{ k, label, value, sub, dir }]
function statsOf(sum, { kind, sp, sel, unit }) {
  if (!sum) return [];
  if (kind === "daily") {
    return [
      { k: "latest", label: "Latest day", value: exact(sum.latest.v), sub: [unit, shortDay(sum.latest.d)].filter(Boolean).join(" · ") },
      { k: "total", label: `Total · ${rangeText(sel)}`, value: exact(sum.total), sub: `${sum.n} ${sum.n === 1 ? "day" : "days"} with a gain` },
      { k: "avg", label: "Average per day", value: exact(sum.avg), sub: "on days with a gain" },
      { k: "best", label: "Best day", value: sum.best ? exact(sum.best.v) : "—", sub: sum.best ? shortDay(sum.best.d) : "no gain yet" },
    ];
  }
  const word = sp.auto ? "" : sp.step === 7 ? "week" : "day", one = sum.n < 2;
  return [
    { k: "now", label: "Now", value: exact(sum.current.v), sub: [unit, shortDay(sum.current.d)].filter(Boolean).join(" · ") },
    { k: "change", label: `Change · ${rangeText(sel)}`, value: one ? "—" : signedText(sum.change), sub: one ? "needs a second reading" : `${sum.pct == null ? "" : `${pctText(sum.pct)} `}since ${shortDay(sum.since)}`, dir: one ? undefined : dirOf(sum.change) },
    { k: "perday", label: "Average per day", value: one || sum.perDay == null ? "—" : signedText(sum.perDay), sub: one ? "" : `over ${sum.days} ${sum.days === 1 ? "day" : "days"}`, dir: one || sum.perDay == null ? undefined : dirOf(sum.perDay) },
    { k: "best", label: sp.auto ? "Biggest single gain" : `Biggest ${word} gain`, value: sum.best ? signedText(sum.best.change) : "—",
      sub: sum.best ? (sp.auto ? `${shortDay(sum.best.from)} → ${shortDay(sum.best.d)}` : shortDay(sum.best.d)) : one ? "" : sp.auto ? "no rise between readings yet" : `no rise ${word} over ${word} yet`, dir: sum.best ? "up" : undefined },
  ];
}

export function BigChart({ points, label = "", kind = "level", step = 1, unit = "", releases = NONE, variant = "full", songs = null, defaultRange = "all", defaultActive = null }) {
  const phone = usePhone();
  const wrap = useRef(null), svg = useRef(null);
  const w = useBoxWidth(wrap, variant === "drawer" ? 440 : 960);
  const h = phone ? 240 : variant === "drawer" ? 200 : 340;
  // a day with nothing gained (0) is no reading: bars, numbers and hover all leave it out (the server leaves out a day on which every song read the same, too)
  const all = useMemo(() => normPoints(points).filter((p) => kind !== "daily" || p.v !== 0), [points, kind]);
  const sp = useMemo(() => spacingOf(all, step), [all, step]); // from the whole series, so a range pill never changes what a gap is
  const ranges = rangesFor(all, sp.auto ? 7 : step);
  const [range, setRange] = useState(defaultRange);
  const [act, setAct] = useState(defaultActive == null ? null : typeof defaultActive === "object" ? defaultActive : { type: "point", i: defaultActive }); // (a reading's index, or a hit)
  const [say, setSay] = useState(""); // what a screen reader is told when ← / → move (a mouse hover is only for eyes)
  const sel = ranges.includes(range) ? range : "all";
  const vis = useMemo(() => inRange(all, sel), [all, sel]);
  const m = useMemo(() => buildChart({ points: vis, step: sp.step, spacing: sp, kind, releases, w, h }), [vis, sp, kind, releases, w, h]);
  const sum = useMemo(() => summarize(vis, { step: sp.step, gapOver: sp.gapOver, kind }), [vis, sp, kind]);
  const aria = useMemo(() => ariaSummary({ label, points: vis, step: sp.step, gapOver: sp.gapOver, auto: sp.auto, kind, unit, releases }), [label, vis, sp, kind, unit, releases]);
  const a = act && (act.type === "gap" ? act.b < vis.length : act.i < vis.length) ? act : null;
  const tip = a ? tipOf({ points: vis, hit: a, step: sp.step, kind, unit, releases, songs }) : null;
  const bottom = m.strip ? m.strip.y1 : m.plot.y1;

  const pick = (r) => { setRange(r); setAct(null); setSay(""); };
  const xOf = (e) => { const r = svg.current?.getBoundingClientRect(); return r && r.width ? ((e.clientX - r.left) / r.width) * m.w : 0; };
  const onPoint = (e) => {
    if (!vis.length) return;
    const hit = hitAt(m, xOf(e));
    setAct((o) => (o && hit && o.type === hit.type && (hit.type === "point" ? o.i === hit.i : o.a === hit.a && o.x === hit.x) ? o : hit));
  };
  const onKey = (e) => {
    const key = { ArrowLeft: "left", ArrowRight: "right", Home: "home", End: "end" }[e.key];
    if (!key || !vis.length) return;
    e.preventDefault();
    const i = a && a.type === "gap" && (key === "left" || key === "right") ? (key === "left" ? a.a : a.b) : moveIndex(a && a.type === "point" ? a.i : null, key, vis.length);
    setAct({ type: "point", i });
    setSay(tipOf({ points: vis, hit: { type: "point", i }, step: sp.step, kind, unit, releases, songs }).text);
  };

  const tipW = Math.min(232, m.w - 16), ax = a ? (a.type === "gap" ? a.x : m.pts[a.i].x) : 0;
  const tipLeft = Math.max(8, Math.min(m.w - tipW - 8, ax < m.w / 2 ? ax + 14 : ax - 14 - tipW));
  const stats = statsOf(sum, { kind, sp, sel, unit });
  const relInView = m.releases.slice().reverse();
  // the note under the chart names five releases at most (a day or a long gap can hold dozens), each cut at 40 characters, then "and N more"
  const relLines = relInView.flatMap((r) => r.names.map((nm) => `${shortDay(r.d)} ${nm.length > 40 ? `${nm.slice(0, 39)}…` : nm}`));
  const gapText = m.gaps.slice(0, 2).map((g) => (g.from === g.to ? shortDay(g.from) : `${shortDay(g.from)} – ${shortDay(g.to)}`)).join("; ") + (m.gaps.length > 2 ? ` and ${m.gaps.length - 2} more` : "");

  if (!all.length) return null;
  return (
    <div className="bc" ref={wrap} data-bigchart data-kind={kind} data-variant={variant} data-step={step}>
      <div className="bc-top">
        <span className="bc-span" data-bc-span>
          {shortDay(vis[0].d)}{vis.length > 1 ? ` – ${shortDay(vis[vis.length - 1].d)}` : ""} · {countWords(vis.length, { kind, step: sp.step, auto: sp.auto })}
        </span>
        {ranges.length > 0 && (
          <div className="bc-range" role="group" aria-label="Range" data-bc-range>
            {[...ranges, "all"].map((r) => (
              <button key={r} type="button" className={sel === r ? "on" : ""} aria-pressed={sel === r} data-range={r} onClick={() => pick(r)}>{rangeLabel(r)}</button>
            ))}
          </div>
        )}
      </div>

      <dl className="bc-stats" data-bc-stats>
        {stats.map((s) => (
          <div key={s.k} className="bc-stat" data-stat={s.k}>
            <dt>{s.label}</dt>
            <dd data-dir={s.dir}>{s.value}</dd>
            {s.sub ? <small>{s.sub}</small> : null}
          </div>
        ))}
      </dl>

      <div className="bc-plot">
        <svg ref={svg} className="bc-svg" viewBox={`0 0 ${m.w} ${m.h}`} width="100%" height={h} role="img" aria-label={aria} tabIndex={0} data-bc-svg
          onPointerMove={onPoint} onPointerDown={onPoint} onPointerLeave={(e) => e.pointerType === "mouse" && setAct(null)} onKeyDown={onKey} onBlur={() => setAct(null)}>
          {/* the gridlines and the y labels (the lowest one is always there: the scale may not start at 0) */}
          <g aria-hidden="true" data-bc-y>
            {m.yTicks.map((t) => (
              <g key={t.v}>
                <line x1={m.plot.x0} x2={m.plot.x1} y1={t.y} y2={t.y} className="bc-grid" />
                <text x={m.plot.x0 - 8} y={t.y + 4} textAnchor="end" className="bc-tick" data-y-tick>{t.label}</text>
              </g>
            ))}
          </g>
          {/* the dates */}
          <g aria-hidden="true" data-bc-x>
            <line x1={m.plot.x0} x2={m.plot.x1} y1={kind === "daily" ? m.zeroY : m.plot.y1} y2={kind === "daily" ? m.zeroY : m.plot.y1} className="bc-axis" />
            {m.xTicks.map((t) => (
              <g key={t.d}>
                <line x1={t.x} x2={t.x} y1={m.plot.y0} y2={bottom} className="bc-vgrid" />
                <text x={t.x} y={m.h - 6} textAnchor="middle" className="bc-tick" data-x-tick>{t.label}</text>
              </g>
            ))}
          </g>
          {/* day-over-day change: up above the line, down below it, only between readings that follow each other */}
          {m.strip && (
            <g aria-hidden="true" data-bc-strip>
              <line x1={m.strip.x0} x2={m.strip.x1} y1={m.strip.zeroY} y2={m.strip.zeroY} className="bc-axis" />
              {m.stripBars.map((b) => <rect key={b.i} x={b.x} y={b.y} width={b.w} height={b.h} rx="1" className={b.up ? "bc-up" : "bc-down"} data-day-change={b.change} />)}
              <text x={m.strip.x0 + 8} y={m.strip.y0 - 5} className="bc-tick bc-tick-s" data-strip-label>{m.strip.label}</text>
            </g>
          )}
          {/* releases: a dotted line on the day, the name in its tooltip and in the note under the chart */}
          <g data-bc-releases>
            {m.releases.map((r) => (
              <g key={r.d} className="bc-rel" data-release={r.d}>
                <title>{`${r.names.join(", ")} (${shortDay(r.d)})`}</title>
                <line x1={r.x} x2={r.x} y1={m.plot.y0} y2={bottom} className="bc-rel-line" />
                <path d={`M${r.x},${m.plot.y0 - 9} l4,5 l-4,5 l-4,-5 z`} className="bc-rel-mark" />
              </g>
            ))}
          </g>
          {/* the readings: solid between days that follow each other, a dashed connector across a gap */}
          {kind === "daily" ? (
            <g data-bc-bars>{m.bars.map((b) => <rect key={b.i} x={b.x} y={b.y} width={b.w} height={b.h} rx="1.5" className={b.up ? "bc-bar" : "bc-bar neg"} />)}</g>
          ) : (
            <g data-bc-line>
              {m.gaps.map((g) => <line key={g.a} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} className="bc-gap" data-gap={`${g.from}..${g.to}`} />)}
              {m.runs.map((r, k) => (r.path ? <path key={k} d={r.path} className="bc-line" /> : null))}
              {m.pts.map((p) => (m.pts.length <= 60 || p.i === m.pts.length - 1 ? <circle key={p.i} cx={p.x} cy={p.y} r={p.i === m.pts.length - 1 ? 3.6 : 2.4} className={p.i === m.pts.length - 1 ? "bc-dot bc-now" : "bc-dot"} /> : null))}
            </g>
          )}
          {/* the crosshair */}
          {a && (
            <g aria-hidden="true" pointerEvents="none" data-bc-cross>
              {a.type === "gap" && <rect x={m.pts[a.a].x} y={m.plot.y0} width={m.pts[a.b].x - m.pts[a.a].x} height={bottom - m.plot.y0} className="bc-gap-fill" />}
              <line x1={ax} x2={ax} y1={m.plot.y0} y2={bottom} className="bc-cross" />
              {a.type === "point" && kind !== "daily" && <circle cx={m.pts[a.i].x} cy={m.pts[a.i].y} r="5" className="bc-dot-on" />}
            </g>
          )}
        </svg>
        {tip && (
          <div className="bc-tip" style={{ left: tipLeft, width: tipW }} aria-hidden="true" data-bc-tip data-gap={tip.gap ? "" : undefined}>
            <b>{tip.title}</b>
            {tip.value ? <span className="bc-tip-v">{tip.value}</span> : null}
            {tip.lines.map((l) => <span key={l} className="bc-tip-l">{l}</span>)}
            {tip.releases.length > 0 && <span className="bc-tip-r">Released: {tip.releases.join(", ")}{tip.more ? ` and ${tip.more} more` : ""}</span>}
          </div>
        )}
      </div>
      <div className="bc-sr" role="status" aria-live="polite">{say}</div>

      {(m.gaps.length > 0 || !m.zero || relInView.length > 0) && (
        <div className="bc-notes" data-bc-notes>
          {m.gaps.length > 0 && (kind === "daily"
            ? <p data-bc-gaps>No daily gain {gapText}: a day's gain needs a reading on both days.</p>
            : <p data-bc-gaps><i className="bc-key bc-key-gap" aria-hidden="true" />No reading {gapText}: the dashed line only joins the days either side, it is not a measurement.</p>)}
          {relInView.length > 0 && <p data-bc-releases-note><i className="bc-key bc-key-rel" aria-hidden="true" />Releases: {relLines.slice(0, 5).join(" · ")}{relLines.length > 5 ? ` · and ${relLines.length - 5} more` : ""}</p>}
          {!m.zero && <p data-bc-scale>The vertical scale starts near {compact(m.dom.min)}, not 0, so small moves show.</p>}
        </div>
      )}
    </div>
  );
}
