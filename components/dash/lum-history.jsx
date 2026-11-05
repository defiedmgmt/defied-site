import { useState, useEffect } from "react";
import { swrJson, peekJson } from "../ui/fetch-cache";
import { fmt } from "./ui";
import { dataPost } from "./chips";

// r10: kept small on purpose, since a roster artist's Publishing page (components/portal/ClientPortal.jsx
// SongManager, staff only) draws LumHistory: the automated numbers' writes (dataPost), campaign mode
// (ModeSwitch) and the read-only Luminate history. Re-exported by ./numbers for the other places.
const pctWord = (p) => (p == null ? null : `${p >= 0 ? "+" : "−"}${Math.abs(Math.round(p * 100))}%`);
export { dataPost };
export function ModeSwitch({ id, mode, onSaved, what = "artist" }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null), [ask, setAsk] = useState(false);
  const set = async (m) => { setBusy(true); setErr(null); try { await dataPost({ action: "mode", entityId: id, mode: m, days: m === "campaign" ? 30 : null }); await onSaved(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <div className="nums-mode" data-nums-mode={mode || "auto"}>
      <label className="nums-switch"><input type="checkbox" checked={mode === "campaign"} disabled={busy || mode === "off"} onChange={(e) => set(e.target.checked ? "campaign" : "auto")} /> Campaign mode: everything about this {what} updates daily for 30 days</label>
      {/* r10 fix: stopping all tracking is its own, clearly named step with a confirm, away from the campaign switch */}
      {mode === "off" ? <button type="button" className="inline-link" disabled={busy} onClick={() => set("auto")}>Start tracking again</button>
        : ask ? <span className="nums-ask" role="alert" data-stop-ask>Stop every automatic number for this {what}? <button type="button" className="btn sm err-text" disabled={busy} onClick={() => { setAsk(false); set("off"); }} data-stop-yes>Stop tracking</button> <button type="button" className="btn ghost sm" onClick={() => setAsk(false)}>Keep tracking</button></span>
        : <button type="button" className="inline-link nums-off" disabled={busy} onClick={() => setAsk(true)} data-stop-tracking>Stop tracking this {what}</button>}
      {err && <span className="hint err-text">{err}</span>}
    </div>
  );
}
// A roster artist's or song's own page (Publishing): what Luminate had for it, read only and labelled
// "Luminate, all platforms" (GET /api/data?lum=<key>, lib/data/lum.js lumSeries): its newest full week
// against the one before, the weeks as a small table (a missing week is a gap, never a zero) and its
// all-time total. A roster artist also gets its campaign mode (daily updates for 30 days while we push them).
const weekText = (from, to) => {
  const a = new Date(`${from}T12:00:00Z`), b = new Date(`${to || from}T12:00:00Z`);
  const m = (d) => d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return from === (to || from) ? `${m(a)} ${a.getUTCDate()}` : m(a) === m(b) ? `${m(a)} ${a.getUTCDate()}–${b.getUTCDate()}` : `${m(a)} ${a.getUTCDate()}–${m(b)} ${b.getUTCDate()}`;
};
export function LumHistory({ k, campaign = false }) {
  const url = `/api/data?lum=${encodeURIComponent(k)}`;
  const [d, setD] = useState(() => peekJson(url) || null), [err, setErr] = useState(false), [all, setAll] = useState(false);
  const load = () => swrJson(url, (j) => { setD(j); setErr(false); }).catch(() => setErr(true));
  useEffect(() => { setD(peekJson(url) || null); load(); }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err && !d) return <p className="hint lum-hist" data-lum-hist="error">Couldn't load Luminate's history. <button className="inline-link" onClick={load}>Try again</button></p>;
  if (!d) return null;
  const weeks = d.series.filter((p) => p.kind === "week").reverse(); // newest first
  const atd = d.series.filter((p) => p.kind === "atd" && p.v != null).pop();
  const w = d.week;
  const shown = all ? weeks : weeks.slice(0, 6);
  return (
    <div className="lum-hist" data-lum-hist={k}>
      <div className="lum-hist-head"><b>Luminate history</b><span className="hint">all platforms, read only{w?.src && /US only/.test(w.src) ? " · US only" : ""}</span></div>
      {!weeks.length && !atd ? <p className="hint" data-lum-none>No Luminate numbers for this one (no plays in the files we have, or not added).</p> : <>
        {w && <p className="lum-hist-week" data-lum-week>{weekText(w.from, w.to)}: <b>{fmt(w.v)}</b> streams{w.pct != null ? <> · <span className={w.pct >= 0 ? "pos" : "neg"}>{pctWord(w.pct / 100)}</span> on the week before</> : " · needs a second week to compare"}</p>}
        {atd && <p className="hint" data-lum-atd>All-time: {fmt(atd.v)} streams on {weekText(atd.from)}</p>}
        {weeks.length > 0 && (
          <div className="lum-hist-table" role="table" aria-label="Luminate weeks">
            <div className="lum-hist-row lum-hist-hd" role="row"><span role="columnheader">Week</span><span role="columnheader">Streams</span><span role="columnheader">vs week before</span></div>
            {shown.map((p, i) => {
              const prev = weeks[i + 1];
              const pct = p.v != null && prev?.v > 0 && prev.from === new Date(Date.parse(`${p.from}T12:00:00Z`) - 7 * 864e5).toISOString().slice(0, 10) ? (p.v - prev.v) / prev.v : null;
              return (
                <div key={p.from} className="lum-hist-row" role="row" data-week={p.from}>
                  <span role="cell">{weekText(p.from, p.to)}</span>
                  <span role="cell">{p.v == null ? <em className="hint">no number</em> : fmt(p.v)}</span>
                  <span role="cell" className={pct == null ? "hint" : pct >= 0 ? "pos" : "neg"}>{pct == null ? "—" : pctWord(pct)}</span>
                </div>
              );
            })}
            {weeks.length > 6 && <button type="button" className="inline-link lum-hist-more" onClick={() => setAll(!all)}>{all ? "Show fewer weeks" : `Show all ${weeks.length} weeks`}</button>}
          </div>
        )}
      </>}
      {campaign && d.mode != null && <ModeSwitch id={k} mode={d.mode === "auto" ? null : d.mode} onSaved={load} />}
    </div>
  );
}

