// A&R lists (r10): ONE spreadsheet-like grid for the Watchlist (all, or one type) and My A&R. r11: every row says its
// type with a colour chip (Artist blue, Producer violet, Song green, TikTok sound cyan: ar-grid.css --type-*) and a
// 3px bar of that colour on its left edge, on a phone card too. The server
// (GET /api/ar-lists, lib/ar/lists.js) works out every number; this only draws, sorts, filters and exports them.
//   desktop  a sticky header (with each column's "as of"), a sticky Name column, click a header to sort (empty
//            cells always last), Columns ▾ (saved per grid), Export CSV (the visible columns as raw numbers, plus
//            <column>_as_of and source), ↑/↓ between rows, Enter opens the drawer
//   phone    (<700px) compact cards: photo, name, type; the 3 key numbers; "Added by … · N days left". "Sort &
//            filter" is a bottom sheet with the same choices. 44px taps, no sideways page scroll.
// Styles: components/ar/ar-grid.css (imported once in pages/_app.jsx).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Clock, ExternalLink, SlidersHorizontal, Download, Columns3, X } from "lucide-react";
import { thumb } from "../shared/ui";
import { n0, signed, pctText, dirOf, short, dayText, atText, nyDayOf, kindLabel, trackingText, store, spanText, typeOf, TYPE_LABEL } from "./fmt";

// ---------------------------------------------------------------- cells
const COLS_LABEL = { listeners: "Spotify monthly listeners", streams: "Spotify streams (all-time)", spfollowers: "Spotify followers", tiktok: "TikTok followers", instagram: "Instagram followers", youtube: "YouTube subscribers", videos: "TikTok videos with this sound" };
const Dash = ({ why }) => <span className="arg-dash" title={why || ""} data-why={why || ""}>—</span>;
export function MetricCell({ c, label, colAsOf }) {
  if (!c || c.none) return <Dash why={c?.none || "Needs a first reading"} />;
  const old = colAsOf && nyDayOf(c.at) < nyDayOf(colAsOf);
  // r11 fix: in the table a song still to confirm is just its one reading and its day ("61,508 · Nov 4"); why it isn't
  // tracked is in the tooltip and on its Confirm chip (the drawer keeps the words)
  if (colAsOf && c.untracked) return <span className="arg-num" title={`${label} · ${n0(c.v)} · ${atText(c.at)} · ${c.src} · Confirm the match to track it daily`} data-v={c.v} data-untracked-cell>{n0(c.v)} <span className="arg-oldday">· {dayText(c.at)}</span></span>;
  return (
    <span className="arg-num" title={`${label} · ${n0(c.v)}${c.approx ? " (rounded)" : ""} · ${atText(c.at)} · ${c.src}`} data-v={c.v}>
      {old && <Clock size={11} className="arg-old" aria-label={`From ${dayText(c.at)}`} />}
      {c.approx ? "about " : ""}{n0(c.v)}
      {old && <span className="arg-oldday">{dayText(c.at)}</span>}
      {c.untracked && <span className="arg-untracked" data-untracked>{c.untracked}</span>}
    </span>
  );
}
// span "day" (New York days), "week", or "reads" (r10 fix: the last two readings, whatever day they fell on, for
// a column headed with their times while there's no second day yet)
export function DeltaCell({ c, span, label }) {
  if (!c || c.none) return <Dash why={c?.none || "Needs a first reading"} />;
  if (span === "reads") {
    if (c.rd == null) return <Dash why={c.untracked ? c.why1 : "Needs a second reading"} />;
    return (
      <span className="arg-delta" data-dir={dirOf(c.rd)} title={`${label} · ${signed(c.rd)}${c.rg != null ? ` (${pctText(c.rg)})` : ""} · ${n0(c.rPrevV)} at ${atText(c.rPrevAt)} → ${n0(c.v)} at ${atText(c.at)} · ${c.src}`} data-d={c.rd}>
        <b>{signed(c.rd)}</b>{c.rg != null && <small data-dir={dirOf(c.rg)}>{pctText(c.rg)}</small>}
      </span>
    );
  }
  const d = span === "day" ? c.d1 : c.d7, p = span === "day" ? c.p1 : c.p7;
  if (d == null) return <Dash why={span === "day" ? c.why1 : c.why7} />;
  const from = span === "day" ? `${n0(c.prevV)} on ${atText(c.prevAt)}` : `${n0(c.w7v)} on ${atText(c.w7At)}`;
  return (
    <span className="arg-delta" data-dir={dirOf(d)} title={`${label} · ${span === "day" ? "Δ day" : "Δ week"} ${signed(d)}${p != null ? ` (${pctText(p)})` : ""} · ${from} → ${n0(c.v)} on ${atText(c.at)} · ${c.src}`} data-d={d}>
      <b>{signed(d)}</b>{p != null && <small data-dir={dirOf(p)}>{pctText(p)}</small>}
    </span>
  );
}
export function LumCell({ lum }) {
  const w = lum?.week;
  if (!w) return <Dash why="Not on Luminate's lists" />;
  return (
    <span className="arg-delta arg-lum" data-dir={dirOf(w.pct)} title={`Luminate streams, week ${w.label} · ${n0(w.v)}${w.last != null ? ` · ${w.lastLabel}: ${n0(w.last)}` : ""} · ${w.src} · history`} data-lum-week={w.label}>
      <b><i className="arg-l">L</i>{n0(w.v)}</b>{w.pct != null && <small data-dir={dirOf(w.pct)}>{pctText(w.pct)}</small>}
    </span>
  );
}
const LINK_LABEL = { spotify: "Spotify", tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" };
export function Links({ links }) {
  const ks = ["spotify", "tiktok", "instagram", "youtube"].filter((k) => links?.[k]);
  if (!ks.length) return <span className="arg-dash" title="No links yet">—</span>;
  return <span className="arg-links">{ks.map((k) => <a key={k} href={links[k]} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title={LINK_LABEL[k]} aria-label={LINK_LABEL[k]} data-link={k}>{LINK_LABEL[k].slice(0, 2)}</a>)}</span>;
}
// r11 (A2): the type chip, a dot and the label in the type's colour
export const TypeChip = ({ r, roster = true }) => {
  const t = typeOf(r);
  return <span className="ar-type" data-type={t} data-type-chip={t} title={r.typeKnown === false ? "Artist until someone says Producer (open it to switch)" : undefined}><i aria-hidden="true" />{TYPE_LABEL[t]}{roster && r.roster ? " · Roster" : ""}</span>;
};
export const Photo = ({ r, size = 24 }) => (r.image
  ? <img className={`arg-ph${r.kind !== "artist" ? " sq" : ""}`} src={thumb(r.image, 96)} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
  : <span className={`arg-ph none${r.kind !== "artist" ? " sq" : ""}`} aria-hidden="true">{String(r.name || "?").slice(0, 1).toUpperCase()}</span>);
const addedByTitle = (r) => r.addedBy.map((w) => `${w.name} · ${dayText(w.at)}${w.never ? "" : w.state === "expired" ? " · expired" : w.daysLeft != null ? ` · ${w.days || ""}${w.days ? " days · " : ""}${w.daysLeft} left` : ""}`).join("\n");
export function Momentum({ m }) {
  if (!m) return null;
  if (m.score == null) return <Dash why={m.why || "Needs a second day of numbers"} />;
  return <span className="arg-mo" title={m.why || ""} data-score={Math.round(m.score)}><b>{Math.round(m.score)}</b> <span data-trend={m.trend || "new"}>{m.trend === "rising" ? "▲" : m.trend === "falling" ? "▼" : m.trend === "steady" ? "–" : ""}</span></span>;
}

// ---------------------------------------------------------------- the columns, per view
const mcol = (id, k, label, def = true) => ({ id, label, sub: "as of", num: true, def, metric: k, get: (r) => r.m?.[k]?.v ?? null, at: (r) => r.m?.[k]?.at, src: (r) => r.m?.[k]?.src, render: (r, a) => <MetricCell c={r.m?.[k]} label={COLS_LABEL[k]} colAsOf={a[k]} /> });
const dcol = (id, k, span, label, def = true) => ({ id, label, num: true, def, delta: true, span, get: (r, o) => (span === "day" ? (o?.reads ? r.m?.[k]?.rd : r.m?.[k]?.d1) : r.m?.[k]?.d7) ?? null, at: (r) => r.m?.[k]?.at, src: (r) => r.m?.[k]?.src,
  render: (r, a, ctx, o) => <DeltaCell c={r.m?.[k]} span={span === "day" && o?.reads ? "reads" : span} label={COLS_LABEL[k]} /> });
const nameCol = (label) => ({ id: "name", label, sticky: true, def: true, get: (r) => String(r.name || "").toLowerCase(), csv: (r) => r.name,
  render: (r) => (
    <span className="arg-name">
      <Photo r={r} />
      <span className="arg-name-t"><b>{r.name}</b>{(r.kind !== "artist" && r.artist) && <em>{r.artist}</em>}
        {(r.roster || r.match === "name" || r.match === "isrc") && <span className="arg-tags">{r.roster && <span className="arg-tag" data-tag="roster">Roster</span>}{r.match === "name" && <span className="arg-tag" data-tag="confirm">Confirm Spotify ▸</span>}{r.match === "isrc" && <span className="arg-tag" data-tag="confirm">Confirm match ▸</span>}</span>}
      </span>
    </span>
  ) });
// r11 fix: a roster row says "Roster" (the old list's import isn't a person); someone who added it too comes after
const IMPORT_NAME = "Old list (imported)";
export const whoText = (r) => { const p = r.roster ? r.names.filter((n) => n !== IMPORT_NAME) : r.names; return r.roster ? ["Roster", ...p].join(" · ") : p.join(", "); };
const addedByCol = { id: "addedBy", label: "Added by", def: true, get: (r) => whoText(r).toLowerCase(), csv: (r) => whoText(r), render: (r) => <span className="arg-who" title={addedByTitle(r)} data-added-by={whoText(r)}>{whoText(r)}</span> };
const addedCol = { id: "added", label: "Added", def: true, get: (r) => r.addedAt, csv: (r) => String(r.addedAt).slice(0, 10), render: (r) => <span title={atText(r.addedAt)}>{dayText(r.addedAt)}</span> };
const lumWkCol = (label) => ({ id: "lumwk", label: "Lum wk", sub: "lum", num: true, def: true, title: label, get: (r) => r.lum?.week?.v ?? null, csv: (r) => r.lum?.week?.v ?? "", at: (r) => r.lum?.week?.to, src: (r) => (r.lum?.week ? "Luminate, all platforms" : ""), render: (r) => <LumCell lum={r.lum} /> });
const lumAtdCol = { id: "lumatd", label: "Luminate all-time", sub: "lumAtd", num: true, def: false, get: (r) => r.lum?.atd ?? null, at: (r) => r.lum?.on, src: (r) => (r.lum?.atd != null ? "Luminate, all platforms" : ""),
  render: (r) => (r.lum?.atd != null ? <span className="arg-num arg-lumatd" title={`Luminate all-time streams · ${n0(r.lum.atd)} · ${dayText(r.lum.on)} · Luminate, all platforms, history`}><i className="arg-l">L</i>{n0(r.lum.atd)}</span> : <Dash why="Not on Luminate's lists" />) };
const trackingCol = { id: "tracking", label: "Tracking", def: true, get: (r) => (r.tracking.roster ? 1e9 : r.tracking.never ? 1e8 : r.tracking.state === "expired" ? -1 : r.tracking.daysLeft ?? 0), csv: (r) => trackingText(r.tracking),
  render: (r, a, ctx) => <TrackingCell r={r} ctx={ctx} /> };
const linksCol = { id: "links", label: "Links", def: true, nosort: true, get: () => null, csv: (r) => Object.values(r.links || {}).join(" "), render: (r) => <Links links={r.links} /> };
const typeCol = { id: "type", label: "Type", def: true, get: (r) => `${TYPE_ORDER[typeOf(r)]}${r.roster ? "r" : ""}`, csv: (r) => kindLabel(r), render: (r) => <TypeChip r={r} roster={false} /> };
// To confirm: what each row needs (r10 fix: songs matched by their ISRC are confirmed here too)
const confirmCol = { id: "confirm", label: "To confirm", def: true, get: (r) => r.match, csv: (r) => (r.match === "isrc" ? "matched by ISRC" : "Spotify profile"),
  render: (r) => <span className="arg-confirm" data-confirm-what={r.match}>{r.match === "isrc" ? "Matched by ISRC: right song?" : `Pick their Spotify${r.candidates?.length ? ` (${r.candidates.length} to choose from)` : ""}`}</span> };
const momentumCol = { id: "momentum", label: "Momentum", num: true, def: true, get: (r) => r.momentum?.score ?? null, render: (r) => <Momentum m={r.momentum} /> };
const genreCol = { id: "genre", label: "Genre", def: false, get: (r) => r.genre || null, render: (r) => r.genre || "" };
const KIND_ORDER = { artist: 0, song: 1, sound: 2 };
const TYPE_ORDER = { artist: 0, producer: 1, song: 2, sound: 3 };
const UNIT = { artist: "monthly listeners", song: "Spotify streams", sound: "TikTok videos" };
const MAIN = { artist: "listeners", song: "streams", sound: "videos" };

export function columnsFor(view, { momentumReady = false } = {}) {
  const mo = momentumReady ? [momentumCol] : []; // r10 fix: no Momentum column until a week of readings exists
  if (view === "confirm") return [
    nameCol("Name"), typeCol, confirmCol, addedByCol, addedCol,
    { id: "main", label: "Number now", sub: "main", num: true, def: true, get: (r) => (r.main == null ? null : [KIND_ORDER[r.kind], r.main]), csv: (r) => r.main ?? "", at: (r) => r.m?.[MAIN[r.kind]]?.at, src: (r) => r.m?.[MAIN[r.kind]]?.src,
      render: (r, a) => <span className="arg-main"><MetricCell c={r.m?.[MAIN[r.kind]]} label={COLS_LABEL[MAIN[r.kind]]} colAsOf={a[MAIN[r.kind]]} /><small>{UNIT[r.kind]}</small></span> },
    lumWkCol("Luminate streams, week"), linksCol,
  ];
  if (view === "watch") return [
    nameCol("Artist"), typeCol, addedByCol, addedCol,
    mcol("listeners", "listeners", "Listeners"), dcol("d1", "listeners", "day", "Δ day"), dcol("d7", "listeners", "week", "Δ week"),
    lumWkCol("Luminate streams, week"),
    mcol("tiktok", "tiktok", "TikTok"), dcol("tiktok7", "tiktok", "week", "TikTok Δ week", false),
    mcol("ig", "instagram", "IG"), dcol("ig7", "instagram", "week", "IG Δ week", false),
    mcol("youtube", "youtube", "YouTube"), mcol("spfollowers", "spfollowers", "Spotify followers", false),
    lumAtdCol, genreCol, ...mo, trackingCol, linksCol,
  ];
  if (view === "songs") return [
    nameCol("Song"), typeCol, addedByCol, addedCol,
    mcol("streams", "streams", "Streams"), dcol("d1", "streams", "day", "Δ day"), dcol("d7", "streams", "week", "Δ week"),
    lumWkCol("Luminate streams, week"), lumAtdCol,
    { id: "isrc", label: "ISRC", def: false, get: (r) => r.isrc || null, render: (r) => r.isrc || "" },
    trackingCol, linksCol,
  ];
  if (view === "sounds") return [
    nameCol("Sound"), typeCol, addedByCol, addedCol,
    mcol("videos", "videos", "Videos"), dcol("d1", "videos", "day", "Δ day"), dcol("d7", "videos", "week", "Δ week"),
    trackingCol, linksCol,
  ];
  // the Watchlist's All and My A&R: compact, every type in one grid (each row's main number: an artist's monthly
  // listeners, a song's Spotify streams, a sound's videos)
  return [
    nameCol("Name"), typeCol,
    addedByCol, addedCol,
    { id: "main", label: "Main number", sub: "main", num: true, def: true, get: (r) => (r.main == null ? null : [KIND_ORDER[r.kind], r.main]), csv: (r) => r.main ?? "", at: (r) => r.m?.[MAIN[r.kind]]?.at, src: (r) => r.m?.[MAIN[r.kind]]?.src,
      render: (r, a) => <span className="arg-main"><MetricCell c={r.m?.[MAIN[r.kind]]} label={COLS_LABEL[MAIN[r.kind]]} colAsOf={a[MAIN[r.kind]]} /><small>{UNIT[r.kind]}</small></span> },
    { id: "d1", label: "Δ day", num: true, def: true, delta: true, span: "day", get: (r, o) => (o?.reads ? r.m?.[MAIN[r.kind]]?.rd : r.m?.[MAIN[r.kind]]?.d1) ?? null, at: (r) => r.m?.[MAIN[r.kind]]?.at, render: (r, a, ctx, o) => <DeltaCell c={r.m?.[MAIN[r.kind]]} span={o?.reads ? "reads" : "day"} label={COLS_LABEL[MAIN[r.kind]]} /> },
    { id: "d7", label: "Δ week", num: true, def: true, get: (r) => r.m?.[MAIN[r.kind]]?.d7 ?? null, at: (r) => r.m?.[MAIN[r.kind]]?.at, render: (r) => <DeltaCell c={r.m?.[MAIN[r.kind]]} span="week" label={COLS_LABEL[MAIN[r.kind]]} /> },
    ...(view === "all" ? [lumWkCol("Luminate streams, week")] : []),
    ...(momentumReady ? [{ ...momentumCol, render: (r) => (r.kind === "artist" ? <Momentum m={r.momentum} /> : "") }] : []),
    trackingCol, linksCol,
  ];
}

// how long it's tracked; on Mine (and in the drawer) your own entry's 30/60/90, Renew and Remove
function TrackingCell({ r, ctx }) {
  const mine = ctx?.me ? r.addedBy.find((w) => w.id === ctx.me) : null;
  const t = r.tracking;
  const text = t.roster ? "Roster" : t.never ? "No end date" : t.state === "expired" ? "Expired" : `${t.daysLeft} left`;
  if (!ctx?.manage || !mine || t.roster || mine.never) return <span className="arg-track" data-state={t.state} data-tracking={text}>{t.state === "expired" ? <><Clock size={12} /> Expired</> : text}</span>;
  return (
    <span className="arg-track mine" data-state={mine.state} onClick={(e) => e.stopPropagation()}>
      {mine.state === "expired"
        ? <button className="btn sm arg-renew" onClick={() => ctx.renew(mine)} data-renew>Renew</button>
        : <span data-tracking={`${mine.days || ""}d · ${mine.daysLeft} left`}>{mine.days ? `${mine.days}d · ` : ""}{mine.daysLeft} left</span>}
      <select aria-label="How long" value={String(mine.days || "")} onChange={(e) => ctx.setDays(mine, Number(e.target.value))} data-set-days>
        {!mine.days && <option value="">Length</option>}
        {[30, 60, 90].map((d) => <option key={d} value={d}>{d}d</option>)}
      </select>
      <button className="btn ghost sm arg-x" onClick={() => ctx.remove(mine, r)} aria-label="Remove from my list" title="Remove from my list" data-remove><X size={13} /></button>
    </span>
  );
}

// ---------------------------------------------------------------- sorting and CSV
const cmp = (a, b) => (Array.isArray(a) ? (a[0] - b[0] || cmp(a[1], b[1])) : typeof a === "number" ? a - b : String(a).localeCompare(String(b)));
export function sortRows(rows, col, dir, o = {}) {
  const out = [...rows];
  if (!col) return out.sort((a, b) => (b.momentum?.score ?? -1) - (a.momentum?.score ?? -1) || String(b.addedAt).localeCompare(String(a.addedAt)));
  return out.sort((a, b) => {
    const x = col.get(a, o), y = col.get(b, o);
    if (x == null && y == null) return 0;
    if (x == null) return 1; // empty cells always last
    if (y == null) return -1;
    return dir === "asc" ? cmp(x, y) : cmp(y, x);
  });
}
const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function toCsv(rows, cols, o = {}) {
  const head = [], fns = [];
  for (const c of cols) {
    head.push(c.id); fns.push((r) => (c.csv ? c.csv(r) : c.get(r, o)));
    if (c.num && c.at) { head.push(`${c.id}_as_of`); fns.push((r) => c.at(r) || ""); }
  }
  head.push("source");
  fns.push((r) => [...new Set(cols.map((c) => c.src?.(r)).filter(Boolean))].join("; "));
  return [head.join(","), ...rows.map((r) => fns.map((f) => csvCell(Array.isArray(f(r)) ? f(r)[1] : f(r))).join(","))].join("\n");
}

// ---------------------------------------------------------------- the grid
function useNarrow() {
  const [n, setN] = useState(false);
  useEffect(() => { const m = window.matchMedia("(max-width: 699px)"), f = () => setN(m.matches); f(); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return n;
}
// a phone card's 3 numbers. r10 fix: an artist with no Spotify number yet shows its Luminate week in its place,
// and every card has its Δ (the day's, or the last two readings' while there's no second day: "Δ last")
const lumKn = (r) => (r.lum?.week ? { v: r.lum.week.v, lumPct: r.lum.week.pct, lum: true, at: r.lum.week.to, src: `Luminate, week ${r.lum.week.label}` } : null);
const KEY_NUMS = {
  artist: (r, o) => [r.m?.listeners && !r.m.listeners.none ? ["Listeners", r.m.listeners] : lumKn(r) ? ["Lum wk", lumKn(r)] : ["Listeners", r.m?.listeners], [o.reads ? "Δ last" : "Δ day", r.m?.listeners, null, o.reads ? "rd" : "d1"], ["TikTok", r.m?.tiktok]],
  song: (r, o) => [["Streams", r.m?.streams], [o.reads ? "Δ last" : "Δ day", r.m?.streams, null, o.reads ? "rd" : "d1"], ["Δ week", r.m?.streams, null, "d7"]],
  sound: (r, o) => [["Videos", r.m?.videos], [o.reads ? "Δ last" : "Δ day", r.m?.videos, null, o.reads ? "rd" : "d1"], ["Δ week", r.m?.videos, null, "d7"]],
};
function PhoneCard({ r, onOpen, open, flash, o = {} }) {
  const left = r.tracking.roster ? "Roster" : r.tracking.never ? "No end date" : r.tracking.state === "expired" ? "Expired · Renew" : `${r.tracking.daysLeft} days left`;
  return (
    <button type="button" className={`arg-card m-tap${open ? " open" : ""}${flash ? " flash" : ""}`} onClick={() => onOpen(r)} data-row={r.key} data-card={r.key} data-type={typeOf(r)}>
      <span className="arg-card-1"><Photo r={r} size={36} /><span className="arg-name-t"><b>{r.name}</b>{r.kind !== "artist" && r.artist && <em>{r.artist}</em>}</span><TypeChip r={r} roster={false} />{r.match === "name" && <span className="arg-tag" data-tag="confirm">Confirm ▸</span>}</span>
      <span className="arg-card-2">
        {KEY_NUMS[r.kind](r, o).map(([label, c, extra, d]) => (
          <span key={label} className="arg-kn" data-kn={label}>
            <small>{label}</small>
            {!c || c.none ? <Dash why={c?.none} /> : d ? (c[d] == null ? <Dash why={d === "d7" ? c.why7 : c.why1 || "Needs a second reading"} /> : <b data-dir={dirOf(c[d])}>{signed(c[d])}</b>)
              : <b title={c.at ? `${c.lum ? dayText(c.at) : atText(c.at)} · ${c.src}` : ""}>{c.approx ? "about " : ""}{c.lum ? n0(c.v) : short(c.v)}{c.lumPct != null ? <i data-dir={dirOf(c.lumPct)}> {pctText(c.lumPct)}</i> : extra ? <i> {extra}</i> : null}</b>}
          </span>
        ))}
      </span>
      <span className="arg-card-3">{r.roster ? whoText(r) : `Added by ${whoText(r)} · ${left}`}</span>
    </button>
  );
}

export function ArGrid({ id, view, rows, asOf = {}, people = [], openKey = null, flashKey = null, onOpen, ctx = {}, empty = "Nothing here yet.", filters = {}, momentumReady = false }) {
  // r10 fix: "Δ day" only when some row has readings on two New York days; until then the column is the last two
  // readings' change, headed with their times (e.g. "Nov 4, 7 AM → 7 PM")
  const cells = rows.flatMap((r) => Object.values(r.m || {})).filter((c) => c && !c.none);
  const reads = !cells.some((c) => c.d1 != null) && cells.some((c) => c.rd != null);
  const readSpan = reads ? spanText(cells.filter((c) => c.rd != null).map((c) => c.rPrevAt).sort()[0], cells.filter((c) => c.rd != null).map((c) => c.at).sort().pop()) : "";
  const o = { reads };
  const cols = useMemo(() => columnsFor(view, { momentumReady }).map((c) => (reads && c.span === "day" ? { ...c, label: c.label.replace("Δ day", "Δ last read"), readSub: readSpan } : c)), [view, momentumReady, reads, readSpan]);
  const narrow = useNarrow();
  const [q, setQ] = useState("");
  const [person, setPerson] = useState("");
  const [genre, setGenre] = useState("");
  const [sort, setSortS] = useState({ col: null, dir: "desc" });
  const [vis, setVisS] = useState(null);
  const [sheet, setSheet] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  const body = useRef(null);
  // r11 fix: one scroll. The table's box ends at the window's bottom (the page's own bottom padding kept), so the page
  // itself doesn't scroll as well; only a list longer than that scrolls, inside the box, its header staying put.
  const box = useRef(null);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof window === "undefined") return undefined;
    const fit = () => {
      const main = el.closest(".dash-main");
      const pb = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.maxHeight = `${Math.max(320, Math.floor(window.innerHeight - top - pb))}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(document.body);
    return () => { window.removeEventListener("resize", fit); ro?.disconnect(); };
  });
  useEffect(() => { setSortS(store.get(`ar-grid:${id}:sort`, { col: null, dir: "desc" })); setVisS(store.get(`ar-grid:${id}:cols`, null)); }, [id]);
  const visible = cols.filter((c) => c.sticky || (vis ? vis.includes(c.id) : c.def));
  const setSort = (col) => { const next = sort.col === col ? { col, dir: sort.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" }; setSortS(next); store.set(`ar-grid:${id}:sort`, next); };
  const toggleCol = (cid) => { const base = vis || cols.filter((c) => c.def).map((c) => c.id); const next = base.includes(cid) ? base.filter((x) => x !== cid) : [...base, cid]; setVisS(next); store.set(`ar-grid:${id}:cols`, next); };
  const genres = [...new Set(rows.map((r) => r.genre).filter(Boolean))].sort();
  const needle = q.trim().toLowerCase();
  const shown = sortRows(rows.filter((r) => (!needle || [r.name, r.artist, ...Object.values(r.links || {})].some((x) => String(x || "").toLowerCase().includes(needle)))
    && (!person || r.addedBy.some((w) => w.id === person)) && (!genre || r.genre === genre)), cols.find((c) => c.id === sort.col) || null, sort.dir, o);
  const newest = Object.values(asOf).filter((v) => /T/.test(String(v))).sort().pop();
  const exportCsv = () => {
    const blob = new Blob([toCsv(shown, visible.filter((c) => c.id !== "links"), o)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `ar-${view}-${nyDayOf(Date.now())}.csv`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const keyNav = (e, i) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); body.current?.querySelectorAll("tr[data-row]")[i + (e.key === "ArrowDown" ? 1 : -1)]?.focus(); }
    else if (e.key === "Enter") { e.preventDefault(); onOpen(shown[i]); }
  };
  const subOf = (c) => {
    if (c.readSub) return c.readSub;
    if (c.sub === "as of") { const v = asOf[c.metric]; return v ? `as of ${dayText(v)}` : ""; }
    if (c.sub === "main") { const v = [asOf.listeners, asOf.streams, asOf.videos].filter(Boolean).sort().pop(); return v ? `as of ${dayText(v)}` : ""; }
    // rows' last Luminate weeks can end on different days (an old export's Oct 16–22, a Trend Report's
    // Oct 23–29): one end day is named, several say so (each cell's tooltip has its own week)
    if (c.sub === "lum") {
      const ends = new Set(rows.map((r) => r.lum?.week?.to).filter(Boolean));
      return ends.size > 1 ? "each row's last week" : asOf.lum ? `week to ${dayText(asOf.lum)}` : "Luminate";
    }
    if (c.sub === "lumAtd") return asOf.lumAtd ? `to ${dayText(asOf.lumAtd)}` : "";
    return "";
  };
  const tools = (
    <>
      <input className="arg-search" type="search" placeholder="Search name, artist or handle" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" data-grid-search />
      {filters.person && <select value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Person" data-filter="person"><option value="">Everyone</option>{people.filter((p) => !p.all).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
      {genres.length > 0 && <select value={genre} onChange={(e) => setGenre(e.target.value)} aria-label="Genre" data-filter="genre"><option value="">All genres</option>{genres.map((g) => <option key={g}>{g}</option>)}</select>}
    </>
  );
  return (
    <div className="arg" data-ar-grid={id}>
      <div className="arg-tools">
        {!narrow && <div className="arg-tools-l">{tools}</div>}
        {narrow && <button type="button" className="btn ghost sm m-tap" onClick={() => setSheet(true)} data-sort-filter><SlidersHorizontal size={15} /> Sort &amp; filter</button>}
        <div className="arg-tools-r">
          {!narrow && (
            <span className="arg-colpick">
              <button type="button" className="btn ghost sm" aria-expanded={colsOpen} onClick={() => setColsOpen(!colsOpen)} data-columns><Columns3 size={14} /> Columns ▾</button>
              {colsOpen && (
                <span className="arg-colmenu" role="menu" onMouseLeave={() => setColsOpen(false)}>
                  {cols.filter((c) => !c.sticky).map((c) => <label key={c.id}><input type="checkbox" checked={visible.some((v) => v.id === c.id)} onChange={() => toggleCol(c.id)} data-col-toggle={c.id} /> {c.title || c.label}</label>)}
                </span>
              )}
            </span>
          )}
          <button type="button" className="btn ghost sm" onClick={exportCsv} data-export><Download size={14} /> Export CSV</button>
        </div>
      </div>
      <p className="arg-count" data-grid-count={shown.length}>{shown.length} {shown.length === 1 ? "row" : "rows"}{newest ? ` · as of ${dayText(newest)}` : ""}</p>
      {!shown.length && <p className="arg-empty">{rows.length ? "Nothing matches that search." : empty}</p>}
      {shown.length > 0 && !narrow && (
        <div className="arg-scroll" ref={box} data-one-scroll>
          <table className="arg-table">
            <thead>
              <tr>
                {visible.map((c) => (
                  <th key={c.id} className={[c.num && "num", c.sticky && "stick"].filter(Boolean).join(" ")} data-col={c.id} aria-sort={sort.col === c.id ? (sort.dir === "asc" ? "ascending" : "descending") : undefined} title={c.title || undefined}>
                    {c.nosort ? <span>{c.label}</span> : <button type="button" onClick={() => setSort(c.id)} data-sort={c.id}>{c.label}{sort.col === c.id ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}</button>}
                    {subOf(c) && <small className="arg-asof">{subOf(c)}</small>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody ref={body}>
              {shown.map((r, i) => (
                <tr key={r.key} data-row={r.key} data-type={typeOf(r)} tabIndex={0} className={[openKey === r.key && "open", flashKey === r.key && "flash"].filter(Boolean).join(" ")} onClick={() => onOpen(r)} onKeyDown={(e) => keyNav(e, i)}>
                  {visible.map((c) => <td key={c.id} className={[c.num && "num", c.sticky && "stick"].filter(Boolean).join(" ")} data-col={c.id}>{c.render(r, asOf, ctx, o)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {shown.length > 0 && narrow && <div className="arg-cards">{shown.map((r) => <PhoneCard key={r.key} r={r} onOpen={onOpen} open={openKey === r.key} flash={flashKey === r.key} o={o} />)}</div>}
      {sheet && (
        <div className="arg-sheet-bg" onClick={(e) => e.target === e.currentTarget && setSheet(false)}>
          <div className="arg-sheet" role="dialog" aria-label="Sort and filter" data-sheet>
            <div className="arg-sheet-h"><b>Sort &amp; filter</b><button type="button" className="btn ghost sm" onClick={() => setSheet(false)} aria-label="Close"><X size={16} /></button></div>
            <label className="fld"><span>Sort by</span>
              <select value={sort.col || ""} onChange={(e) => { const next = { col: e.target.value || null, dir: sort.dir }; setSortS(next); store.set(`ar-grid:${id}:sort`, next); }} data-sheet-sort>
                <option value="">{momentumReady ? "Momentum, then newest" : "Newest first"}</option>
                {cols.filter((c) => !c.nosort).map((c) => <option key={c.id} value={c.id}>{c.title || c.label}</option>)}
              </select>
            </label>
            <label className="fld"><span>Order</span>
              <select value={sort.dir} onChange={(e) => { const next = { ...sort, dir: e.target.value }; setSortS(next); store.set(`ar-grid:${id}:sort`, next); }}><option value="desc">Biggest first</option><option value="asc">Smallest first</option></select>
            </label>
            <div className="arg-sheet-f">{tools}</div>
            <button type="button" className="btn sm" onClick={() => setSheet(false)}>Show {shown.length} {shown.length === 1 ? "row" : "rows"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
