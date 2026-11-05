// A&R lists (r10): one row's drawer, /dashboard/ar/item/<key> (from the right, 480px; full screen on a phone). GET
// /api/ar-lists?item=<key>. What it shows, top to bottom: who added it (your own entry: 30/60/90 · Renew · Remove; a
// Founder may take anyone's off), the Spotify match to confirm (seeded rows), the numbers table, the Spotify chart,
// the Luminate history (all platforms, read-only, kept apart), momentum, campaign mode (daily refresh), Add to
// outreach, and notes (saved on blur). Every number says its source and date; nothing is made up.
import React, { useEffect, useRef, useState } from "react";
import { X, ExternalLink, RefreshCw } from "lucide-react";
import { n0, signed, pctText, dirOf, dayText, atText, kindLabel, post } from "./fmt";
import { Photo, Links, DeltaCell, MetricCell } from "./ArGrid";

const METRIC_NAME = { listeners: "Spotify monthly listeners", streams: "Spotify streams", spfollowers: "Spotify followers", tiktok: "TikTok followers", instagram: "Instagram followers", youtube: "YouTube subscribers", videos: "TikTok videos with this sound" };
const STAGE_LABEL = { reach: "To reach out", reached: "Reached out", talking: "Talking", offer: "Offer sent", signed: "Signed", passed: "Passed" };

// one line, daily points, inline SVG (about 300x140)
export function LineChart({ points, w = 300, h = 140, label = "" }) {
  if (!points?.length) return null;
  const vs = points.map((p) => p[1]), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || Math.max(1, hi * 0.02);
  const x = (i) => (points.length === 1 ? w / 2 : 8 + (i * (w - 16)) / (points.length - 1));
  const y = (v) => h - 18 - ((v - lo) / span) * (h - 36);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
  return (
    <svg className="ard-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      <line x1="8" x2={w - 8} y1={h - 18} y2={h - 18} className="ard-axis" />
      {points.length > 1 && <path d={d} className="ard-line" />}
      {points.map((p, i) => <circle key={p[0]} cx={x(i)} cy={y(p[1])} r="3" className="ard-dot"><title>{`${dayText(p[0])}: ${n0(p[1])}`}</title></circle>)}
      <text x="8" y={h - 4} className="ard-tick">{dayText(points[0][0])}</text>
      {points.length > 1 && <text x={w - 8} y={h - 4} className="ard-tick" textAnchor="end">{dayText(points[points.length - 1][0])}</text>}
      <text x="8" y="12" className="ard-tick">{n0(hi)}</text>
    </svg>
  );
}

function LumHistory({ series }) {
  const atd = (series || []).filter((p) => p.kind === "atd" && p.v != null);
  const weeks = (series || []).filter((p) => p.kind === "week");
  const two = weeks.slice(-2);
  if (!atd.length && !two.length) return <p className="hint">Not on Luminate's lists.</p>;
  const max = Math.max(...two.map((p) => p.v || 0), 1);
  return (
    <div className="ard-lum" data-lum-history>
      {atd.length > 0 && (
        <>
          <LineChart points={atd.map((p) => [p.to, p.v])} label="Luminate all-time streams" />
          <p className="hint" data-lum-atd>All-time: {atd.map((p) => `${dayText(p.to)} ${n0(p.v)}`).join(" → ")}</p>
        </>
      )}
      {two.length > 0 && (
        <div className="ard-bars" data-lum-weeks>
          {two.map((p) => (
            <div key={p.from} className="ard-bar-row" title={`${p.src} · ${dayText(p.from)}–${dayText(p.to)} · ${p.v == null ? "no number" : n0(p.v)}`}>
              <span className="ard-bar-l">{dayText(p.from)}–{dayText(p.to)}</span>
              <span className="ard-bar"><i style={{ width: `${p.v == null ? 0 : Math.max(2, (p.v / max) * 100)}%` }} /></span>
              <b>{p.v == null ? "—" : n0(p.v)}</b>
            </div>
          ))}
        </div>
      )}
      <p className="hint">{series[0]?.src || "Luminate, all platforms"} · history, read-only.</p>
    </div>
  );
}

export function ArDrawer({ itemKey, me, founder = false, onClose, onChanged, onGoOutreach }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [metric, setMetric] = useState(null);
  const [notes, setNotes] = useState("");
  const [askOff, setAskOff] = useState(null); // a Founder taking someone else's entry off: the entry, until confirmed
  const card = useRef(null);
  const load = () => fetch(`/api/ar-lists?item=${encodeURIComponent(itemKey)}`, { cache: "no-store" }).then((r) => r.json())
    .then((j) => { if (j.error) throw new Error(j.error); setD(j); setNotes(j.notes || ""); setErr(null); }).catch((e) => setErr(e.message));
  useEffect(() => { setD(null); setMetric(null); setNote(null); load(); }, [itemKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Esc closes it; focus moves in once when it opens (never again while someone types in Notes)
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") closeRef.current(); };
    document.addEventListener("keydown", esc);
    card.current?.focus();
    return () => document.removeEventListener("keydown", esc);
  }, []);
  const act = async (body, ok) => {
    setBusy(true); setNote(null);
    try { const j = await post("/api/ar-trackers", body); setNote({ ok: true, text: typeof ok === "function" ? ok(j) : ok }); await load(); onChanged?.(); }
    catch (e) { setNote({ ok: false, text: e.message }); }
    setBusy(false);
  };
  const r = d?.row;
  const mine = r?.addedBy.find((w) => w.id === me);
  const series = d?.series || {};
  const metrics = Object.keys(series);
  const shown = metric && series[metric] ? metric : metrics[0];
  return (
    <div className="ard-bg" onClick={(e) => e.target === e.currentTarget && onClose()} data-drawer-bg>
      <aside className="ard" role="dialog" aria-label={r ? r.name : "Details"} tabIndex={-1} ref={card} data-drawer={itemKey}>
        <div className="ard-head">
          {r && <Photo r={r} size={44} />}
          <div className="ard-title">
            <h3>{r ? r.name : d?.gone ? "Not on any list" : "Loading…"}</h3>
            {r && <span className="ard-sub">{kindLabel(r)}{r.artist ? ` · ${r.artist}` : ""}</span>}
          </div>
          <button type="button" className="btn ghost sm" onClick={onClose} aria-label="Close" data-drawer-close><X size={18} /></button>
        </div>
        <div className="ard-body">
          {err && <p className="hint err-text">{err} <button className="btn ghost sm" onClick={load}>Try again</button></p>}
          {d?.gone && <p className="hint">Nobody has this on their list any more. Its numbers are kept: paste its link again to bring them back.</p>}
          {note && <p className={`hint ${note.ok ? "ok-text" : "err-text"}`} role="status" data-drawer-note>{note.text}</p>}
          {r && (
            <>
              <section className="ard-sec" data-drawer-who>
                <Links links={r.links} />
                <ul className="ard-who">
                  {r.addedBy.map((w) => (
                    <li key={w.entryId} data-entry={w.entryId}>
                      <span><b>{w.name}</b> · {dayText(w.at)}{r.tracking.roster ? " · Roster, never expires" : w.never ? " · no end date" : w.state === "expired" ? " · expired" : ` · ${w.days || "?"} days · ${w.daysLeft} left`}</span>
                      {(w.id === me || founder) && !r.tracking.roster && (
                        <span className="ard-who-act">
                          {w.id === me && !w.never && (
                            <>
                              {[30, 60, 90].map((n) => <button key={n} type="button" className={`btn ghost sm${w.days === n ? " on" : ""}`} disabled={busy} onClick={() => act({ action: "setDays", entryId: w.entryId, days: n }, `${n} days from today.`)} data-days={n}>{n}d</button>)}
                              <button type="button" className="btn ghost sm" disabled={busy} onClick={() => act({ action: "renew", entryId: w.entryId }, "Renewed.")} data-renew>Renew</button>
                            </>
                          )}
                          {askOff === w.entryId ? (
                            <span className="ard-ask" role="alert" data-ask-remove>Take {r.name} off {w.name}'s list?
                              <button type="button" className="btn sm err-text" disabled={busy} onClick={() => { setAskOff(null); act({ action: "remove", entryId: w.entryId }, `Taken off ${w.name}'s list.`).then(() => { if (r.addedBy.length === 1) onClose(); }); }} data-remove-yes>Take it off</button>
                              <button type="button" className="btn ghost sm" onClick={() => setAskOff(null)}>Keep</button>
                            </span>
                          ) : (
                            <button type="button" className="btn ghost sm err-text" disabled={busy} data-remove-entry
                              onClick={() => { if (w.id !== me) { setAskOff(w.entryId); return; } act({ action: "remove", entryId: w.entryId }, "Taken off your list.").then(() => { if (r.addedBy.length === 1) onClose(); }); }}>
                              {w.id === me ? "Remove from my list" : "Remove"}
                            </button>
                          )}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {!mine && !r.tracking.roster && <p className="hint">Not on your list. Paste its link in the box to add your name too.</p>}
              </section>

              {r.match === "name" && (
                <section className="ard-sec" data-drawer-match>
                  <h4>Spotify match to confirm</h4>
                  <p className="hint">Luminate only gave us their name. Nothing is tracked on Spotify until you tap the right one.</p>
                  {(r.candidates || []).map((c) => (
                    <div key={c.id} className="ard-cand" data-candidate={c.id}>
                      {c.image ? <img src={c.image} alt="" width={36} height={36} referrerPolicy="no-referrer" /> : <span className="arg-ph none">{String(c.name || "?").slice(0, 1)}</span>}
                      <span className="ard-cand-t"><b>{c.name}</b><a href={`https://open.spotify.com/artist/${c.id}`} target="_blank" rel="noopener noreferrer">open.spotify.com/artist/{c.id.slice(0, 5)}… <ExternalLink size={11} /></a>{c.listeners != null && <em>{n0(c.listeners)} monthly listeners</em>}</span>
                      <button type="button" className="btn sm" disabled={busy} onClick={() => act({ action: "confirmMatch", id: r.trackedId, spotifyId: c.id }, `Confirmed: ${c.name}. Its numbers start with the next update.`)} data-confirm={c.id}>That's them</button>
                      <button type="button" className="btn ghost sm" disabled={busy} onClick={() => act({ action: "notThem", id: r.trackedId, spotifyId: c.id }, "Taken off the choices.")} data-not-them={c.id}>Not them</button>
                    </div>
                  ))}
                  <p className="hint">None of these? Paste their Spotify link in the box above: it goes on this row.</p>
                </section>
              )}

              <section className="ard-sec" data-drawer-numbers>
                <h4>Numbers</h4>
                <table className="ard-nums">
                  <thead><tr><th>Metric</th><th className="num">Now</th><th className="num">Δ day</th><th className="num">Δ week</th><th>As of</th><th>Source</th></tr></thead>
                  <tbody>
                    {Object.entries(r.m || {}).map(([k, c]) => (
                      <tr key={k} data-metric={k}>
                        <td>{METRIC_NAME[k]}</td>
                        <td className="num"><MetricCell c={c} label={METRIC_NAME[k]} /></td>
                        <td className="num"><DeltaCell c={c} span="day" label={METRIC_NAME[k]} /></td>
                        <td className="num"><DeltaCell c={c} span="week" label={METRIC_NAME[k]} /></td>
                        <td>{c?.at ? atText(c.at) : ""}</td>
                        <td>{c?.src || ""}</td>
                      </tr>
                    ))}
                    {r.lum?.week && (
                      <tr data-metric="lum"><td><i>Luminate streams, week {r.lum.week.label}</i></td><td className="num">{n0(r.lum.week.v)}</td><td /><td className="num"><span data-dir={dirOf(r.lum.week.pct)}>{pctText(r.lum.week.pct)}</span></td><td>{r.lum.week.label}</td><td>Luminate, all platforms</td></tr>
                    )}
                  </tbody>
                </table>
              </section>

              <section className="ard-sec" data-drawer-chart>
                <h4>Spotify{shown && shown !== "listeners" && shown !== "streams" && shown !== "spfollowers" ? " and socials" : ""}</h4>
                {metrics.length > 1 && (
                  <div className="ard-switch" role="tablist">{metrics.map((k) => <button key={k} type="button" role="tab" aria-selected={k === shown} className={k === shown ? "on" : ""} onClick={() => setMetric(k)}>{series[k].label}</button>)}</div>
                )}
                {!shown && <p className="hint" data-chart-none>{r.match === "name" ? "Confirm the Spotify match first: numbers start after a tap." : "No readings yet. The next real update fills this in."}</p>}
                {shown && (
                  <>
                    <LineChart points={series[shown].points} label={series[shown].label} />
                    <p className="hint" data-chart-n>{series[shown].points.length === 1 ? `1 reading so far (${dayText(series[shown].points[0][0])})` : `${series[shown].points.length} readings, ${dayText(series[shown].points[0][0])} to ${dayText(series[shown].points.at(-1)[0])}`} · {series[shown].label} · {series[shown].src}</p>
                  </>
                )}
              </section>

              <section className="ard-sec" data-drawer-lum>
                <h4>Luminate (all platforms), history, read-only</h4>
                <LumHistory series={d.lumSeries || []} />
              </section>

              {r.kind === "artist" && (
                <section className="ard-sec" data-drawer-momentum>
                  <h4>Momentum</h4>
                  {r.momentum?.score != null ? <p><b>{Math.round(r.momentum.score)}</b> {r.momentum.trend || ""} · {r.momentum.why}</p> : <p className="hint">{r.momentum?.why || "Needs a second day of numbers."}</p>}
                </section>
              )}

              {d.canCampaign && (
                <section className="ard-sec" data-drawer-campaign>
                  <h4>Refresh</h4>
                  <label className="ard-toggle">
                    <input type="checkbox" checked={d.mode?.mode === "campaign"} disabled={busy} onChange={(e) => act({ action: "setMode", entityId: r.entityId, mode: e.target.checked ? "campaign" : "auto" }, e.target.checked ? "Daily updates on: every number refreshes each day." : "Back to the usual schedule.")} data-campaign />
                    <span>Daily updates (campaign mode)</span>
                  </label>
                  <p className="hint">Every number for this {r.kind === "sound" ? "sound" : "artist"} refreshes each day while it's on. It costs a little Apify credit a day.</p>
                </section>
              )}

              {r.kind === "artist" && r.trackedId && (
                <section className="ard-sec" data-drawer-outreach>
                  <h4>Outreach</h4>
                  {r.stage ? <p>On the board: <b>{STAGE_LABEL[r.stage] || r.stage}</b> · <button type="button" className="inline-link" onClick={onGoOutreach}>Open in Outreach</button></p>
                    : <button type="button" className="btn ghost sm" disabled={busy} onClick={() => act({ action: "toOutreach", id: r.trackedId }, "Added to Outreach: To reach out.")} data-to-outreach>Add to outreach</button>}
                </section>
              )}

              {r.trackedId && (
                <section className="ard-sec" data-drawer-notes>
                  <h4>Notes</h4>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Anything the team should know" aria-label="Notes"
                    onBlur={() => notes !== (d.notes || "") && act({ action: "notes", id: r.trackedId, notes }, "Notes saved.")} data-notes />
                </section>
              )}
            </>
          )}
          {!d && !err && <p className="hint"><RefreshCw size={12} className="spin" /> Loading…</p>}
        </div>
      </aside>
    </div>
  );
}
