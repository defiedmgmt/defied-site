// A&R Home (r10, /dashboard/ar): the trends, flat and spreadsheet-like. GET /api/ar-lists?view=home.
//   a freshness line (each source's newest reading, New York time)
//   4 tiles: on the lists · added this week · expiring in 7 days · Spotify match to confirm (hidden at 0)
//   day-over-day movers (up most / down most, 5 each): two readings on consecutive UTC days, size floors
//   week-on-week movers per metric; Streams falls back to each row's last real Luminate week (labelled, italic)
//   new adds this week by who · about to expire (Renew) · adds per week (stacked bars, inline SVG)
//   "How momentum is scored" (the weights; Founders can edit)
// Every number carries its source and dates in its sub-line or tooltip. Empty states say what's missing.
import React, { useEffect, useState } from "react";
import { n0, signed, pctSigned, dirOf, dayText, atText, KIND_LABEL, post } from "./fmt";

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

// 14 days of the row's main number: a tiny line (or one dot while there's one reading)
function Spark({ points }) {
  if (!points?.length) return null;
  const w = 64, h = 18, vs = points.map((p) => p[1]), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const x = (i) => (points.length === 1 ? w / 2 : (i * (w - 4)) / (points.length - 1) + 2), y = (v) => h - 3 - ((v - lo) / span) * (h - 6);
  return <svg className="arh-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">{points.length > 1 ? <path d={points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ")} /> : <circle cx={x(0)} cy={h / 2} r="2" />}</svg>;
}
function MoversTable({ title, list, onOpen, kind }) {
  if (!list.length) return <div className="arh-mv" data-movers={kind}><h4>{title}</h4><p className="arh-sub" data-movers-none>{kind === "up" ? "Nothing rose" : "Nothing fell"} past the size floors (1,000 streams or listeners, 100 followers, 50 sound videos) between the last two days.</p></div>;
  return (
    <div className="arh-mv" data-movers={kind}>
      <h4>{title}</h4>
      <table className="arh-t">
        <thead><tr><th>Name</th><th>Type</th><th>Number</th><th className="num">Yesterday → Today</th><th className="num">Δ</th><th className="num">%</th><th>14 days</th></tr></thead>
        <tbody>
          {list.map((x) => (
            <tr key={`${x.key}|${x.metric}`} onClick={() => onOpen(x.key)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen(x.key)} data-mover={x.key}>
              <td><b>{x.name}</b></td>
              <td>{KIND_LABEL[x.kind]}</td>
              <td className="wrap"><span className="arh-sub">{x.label}</span></td>
              <td className="num" title={`${x.label} · ${n0(x.from)} on ${atText(x.fromAt)} → ${n0(x.to)} on ${atText(x.toAt)} · ${x.src}`}>{n0(x.from)} → {n0(x.to)}</td>
              <td className="num" data-dir={dirOf(x.d)}>{signed(x.d)}</td>
              <td className="num" data-dir={dirOf(x.pct)}>{pctSigned(x.pct)}</td>
              <td><Spark points={x.spark} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function WeekTable({ title, list, onOpen, kind }) {
  if (!list.length) return <div className="arh-mv" data-week-movers={kind}><h4>{title}</h4><p className="arh-sub">{kind === "up" ? "Nothing rose" : "Nothing fell"} week on week.</p></div>;
  return (
    <div className="arh-mv" data-week-movers={kind}>
      <h4>{title}</h4>
      <table className="arh-t">
        <thead><tr><th>Name</th><th className="num">This week</th><th className="num">Last week</th><th className="num">Δ</th><th className="num">%</th><th>Source · dates</th></tr></thead>
        <tbody>
          {list.map((x) => (
            <tr key={x.key} onClick={() => onOpen(x.key)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen(x.key)} data-week-mover={x.key} className={x.lum ? "lum" : ""}>
              <td><b>{x.name}</b></td>
              <td className="num">{n0(x.thisWeek)}</td>
              <td className="num">{n0(x.lastWeek)}</td>
              <td className="num" data-dir={dirOf(x.d)}>{signed(x.d)}</td>
              <td className="num" data-dir={dirOf(x.pct)}>{pctSigned(x.pct)}</td>
              <td className="arh-sub wrap">{x.lum ? <i data-lum-src>Luminate · {x.weeks}</i> : `${x.src} · ${dayText(x.from)} → ${dayText(x.to)}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// adds per week: stacked bars, one colour per person, inline SVG
function AddsChart({ data }) {
  const { weeks = [], people = [] } = data || {};
  const tot = weeks.map((w) => Object.values(w.by).reduce((a, n) => a + n, 0));
  const max = Math.max(1, ...tot);
  const W = 320, H = 120, bw = (W - 20) / Math.max(1, weeks.length) - 6;
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
                const h = (n / max) * (H - 30); y -= h;
                return <rect key={p.id} x={x} y={y} width={bw} height={h} fill={SPARK_COLORS[j % SPARK_COLORS.length]}><title>{`${p.name}: ${n} in the week of ${w.label}`}</title></rect>;
              })}
              <text x={x + bw / 2} y={H - 3} textAnchor="middle" className="ard-tick">{w.label}</text>
            </g>
          );
        })}
      </svg>
      <p className="arh-legend">{people.map((p, j) => <span key={p.id}><i style={{ background: SPARK_COLORS[j % SPARK_COLORS.length] }} />{p.name}</span>)}{!people.length && "No adds in the last 8 weeks."}</p>
    </div>
  );
}

export function ArHome({ data, err, retry, onOpen, onView, founder, reload }) {
  const [tab, setTab] = useState("streams");
  const [how, setHow] = useState(false);
  const [busy, setBusy] = useState(false);
  if (err) return <p className="hint err-text">{err} <button className="btn ghost sm" onClick={retry}>Try again</button></p>;
  if (!data) return <p className="muted">Loading…</p>;
  const f = data.fresh || {};
  const fl = [["Spotify streams", f.streams, true], ["Monthly listeners", f.listeners], ["TikTok", f.tiktok], ["Instagram", f.instagram], ["YouTube", f.youtube]].filter(([, v]) => v);
  const t = data.tiles || {};
  const day = data.movers?.day || { up: [], down: [] };
  const wk = data.movers?.week?.[tab] || { up: [], down: [] };
  const renew = async (x) => { setBusy(true); try { await post("/api/ar-trackers", { action: "renew", entryId: x.entryId }); await reload(); } catch { /* the row stays */ } setBusy(false); };
  return (
    <div className="arh" data-ar-home>
      <p className="arh-fresh" data-fresh>
        {fl.map(([label, v, time]) => <span key={label}>{label} {time ? atText(v) : dayText(v)}</span>)}
        {f.luminate && <span>Luminate (history) {dayText(f.luminate)}</span>}
        {!fl.length && <span>No readings yet</span>}
        {!f.refresh && <span data-refresh-off>Automatic updates: off</span>}
      </p>
      <div className="arh-tiles">
        <button type="button" className="arh-tile m-tap" onClick={() => onView("team")} data-tile="lists"><small>On the lists</small><b>{t.artists} artists · {t.songs} songs · {t.sounds} sounds</b></button>
        <button type="button" className="arh-tile m-tap" onClick={() => onView("team")} data-tile="week"><small>Added this week</small><b>{t.addedThisWeek}</b><em>since Monday, New York</em></button>
        <div className="arh-tile" data-tile="expiring"><small>Expiring in 7 days</small><b>{t.expiring}</b></div>
        {t.toConfirm > 0 && <button type="button" className="arh-tile m-tap warn" onClick={() => onView("watch/confirm")} data-tile="confirm"><small>Spotify match to confirm</small><b>{t.toConfirm}</b><em>Confirm ▸</em></button>}
      </div>

      <section className="arh-sec" data-day-movers>
        <h3>Day over day</h3>
        {day.up.length || day.down.length ? (
          <div className="arh-two">
            <MoversTable title="Up most" list={day.up} onOpen={onOpen} kind="up" />
            <MoversTable title="Down most" list={day.down} onOpen={onOpen} kind="down" />
          </div>
        ) : <p className="arh-empty" data-day-empty>Needs readings on two days in a row.{data.fresh?.refresh ? " The next real update is tomorrow." : " Automatic updates are off, so the next reading comes when they're turned on or a reading is loaded."}</p>}
      </section>

      <section className="arh-sec" data-week-section>
        <h3>Week on week</h3>
        <div className="subnav arh-tabs" role="tablist" data-m-scroll>
          {(data.movers?.tabs || []).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "subpill active" : "subpill"} onClick={() => setTab(id)} data-week-tab={id}>{label}</button>)}
        </div>
        {wk.up.length || wk.down.length ? (
          <div className="arh-two">
            <WeekTable title="Up most" list={wk.up} onOpen={onOpen} kind="up" />
            <WeekTable title="Down most" list={wk.down} onOpen={onOpen} kind="down" />
          </div>
        ) : <p className="arh-empty" data-week-empty>Needs readings 7 days apart{data.movers?.weekFrom ? ` (from ${data.movers.weekFrom})` : ""}.</p>}
      </section>

      <div className="arh-two">
        <section className="arh-sec" data-adds>
          <h3>New adds this week, by who</h3>
          {data.adds?.length ? (
            <table className="arh-t">
              <thead><tr><th>Person</th><th className="num">Adds</th><th>What they added</th><th>Last add</th></tr></thead>
              <tbody>
                {data.adds.map((p) => (
                  <tr key={p.id} data-adds-person={p.name}>
                    <td><b>{p.name}</b></td><td className="num">{p.n}</td>
                    <td className="arh-chips">{p.items.map((i) => <button key={i.key} type="button" className="arh-chip" onClick={() => onOpen(i.key)} data-add-chip={i.name} title={`${KIND_LABEL[i.kind]} · added ${atText(i.at)}`}>{i.name}</button>)}</td>
                    <td>{dayText(p.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="arh-empty">Nobody has added anything since Monday.</p>}
        </section>
        <section className="arh-sec" data-expiring>
          <h3>About to expire</h3>
          {data.expiring?.length ? (
            <table className="arh-t">
              <thead><tr><th>Name</th><th>Added by</th><th>Ends</th><th>Left</th><th /></tr></thead>
              <tbody>
                {data.expiring.map((x) => (
                  <tr key={x.entryId} data-expiring-row={x.name}>
                    <td><button type="button" className="inline-link" onClick={() => onOpen(x.key)}>{x.name}</button></td><td>{x.who}</td><td>{dayText(x.endsAt)}</td>
                    <td>{x.state === "expired" ? `Expired · ${x.graceLeft} days to renew` : `${x.daysLeft} days`}</td>
                    <td><button type="button" className="btn sm" disabled={busy} onClick={() => renew(x)} data-renew>Renew</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="arh-empty" data-expiring-empty>Nothing ends in the next 7 days.</p>}
        </section>
      </div>

      <section className="arh-sec" data-adds-week>
        <h3>Adds per week</h3>
        <AddsChart data={data.addsByWeek} />
      </section>
      <p className="arh-how">
        <button type="button" className="inline-link" onClick={() => setHow(!how)} aria-expanded={how} data-how>How momentum is scored</button>
      </p>
      {how && <div className="arh-pop"><Weights w={data.weights} canEdit={founder} onSaved={reload} /></div>}
    </div>
  );
}
