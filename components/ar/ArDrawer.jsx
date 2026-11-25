// A&R lists (r10): one row's view, /dashboard/ar/item/<key>. GET /api/ar-lists?item=<key>. (2026-11-20) It opens FULL SCREEN, over the dashboard, with the
// chart first (components/ar/BigChart.jsx) and the rest beside it (below it on a narrower screen); "Smaller" in its head brings back the 480px drawer from the
// right (and "Full screen" the big view); the choice is kept in this browser (fmt.js drawerSize). A phone is full screen either way, with no button. What it shows: who added it (your own entry: 30/60/90 ·
// Renew · Remove; a Founder may take anyone's off), the Spotify match to confirm (seeded rows), the numbers table, the Spotify chart (a roster artist's
// songs' daily streams too), the Luminate history (all platforms, read-only, kept apart), momentum with how the score is made, campaign mode (daily
// refresh) and notes (saved on blur). r11: its type chip in the head and, on a Watchlist artist, the one-tap Artist / Producer switch (Outreach is gone).
// Every number says its source and date; nothing is made up.
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X, ExternalLink, RefreshCw, Maximize2, Minimize2 } from "lucide-react";
import { n0, signed, pctText, dirOf, dayText, atText, post, spanText, typeOf, TYPE_LABEL, UNIT, drawerSize } from "./fmt";
import { Photo, Links, DeltaCell, MetricCell, TypeChip } from "./ArGrid";
import { BigChart, usePhone } from "./BigChart";
import { CAPTION, countWords, momentumWords, momentumHead } from "../../lib/ar/chart";
import { LUM_BASIS_NOTE } from "../../lib/lum-basis";

const METRIC_NAME = { listeners: "Spotify monthly listeners", streams: "Spotify streams", spfollowers: "Spotify followers", tiktok: "TikTok followers", instagram: "Instagram followers", youtube: "YouTube subscribers", videos: "TikTok videos with this sound" };
const useIso = typeof window !== "undefined" ? useLayoutEffect : useEffect;
const NONE = []; // (a stable empty list: BigChart redraws when its releases change)
// a series' points are [day, v] from the server, except a roster artist's songs' daily streams ({ d, v, n })
const dayOfPoint = (p) => (Array.isArray(p) ? p[0] : p.d);
const valueOfPoint = (p) => (Array.isArray(p) ? p[1] : p.v);
const kindOf = (key, s) => s.kind || (key === "streams" || key === "videos" ? "total" : "level");

// the Luminate history (all platforms, read-only): the weekly streams (and the all-time total, one tap away) on the big chart, the all-time line, the last two weeks.
// (2026-11-25, polish) Luminate changed how it counts on Sep 8, 2026 (lib/lum-basis.js; the server marks every point before it `older`). The chart, its numbers, the
// all-time line and the two weeks' bars are the new count only, so the change of count (a ~16M "step" on a big song) is never drawn or taken as growth. The older readings
// and weeks are not dropped: one muted line under them says what they were, with the note.
const OLD_WEEKS_SHOWN = 4;
function LumHistory({ series, releases, variant }) {
  const [view, setView] = useState(null);
  const atdAll = (series || []).filter((p) => p.kind === "atd" && p.v != null), weeksAll = (series || []).filter((p) => p.kind === "week");
  // the new count's weeks from its first one with a number (the empty weeks the server fills in between the older weeks and the new ones are not the new count's own gaps)
  const weeksNew = weeksAll.filter((p) => !p.older), firstNum = weeksNew.findIndex((p) => p.v != null);
  const atd = atdAll.filter((p) => !p.older), weeks = firstNum < 0 ? [] : weeksNew.slice(firstNum);
  const atdOld = atdAll.filter((p) => p.older), weeksOld = weeksAll.filter((p) => p.older && p.v != null);
  const two = weeks.slice(-2);
  if (!atd.length && !two.length && !atdOld.length && !weeksOld.length) return <p className="hint">Not on Luminate's lists.</p>;
  // a week sits on its last day; a week with no number is a gap, so it isn't a point (r11 fix: a chart only from two points; one is a line of text)
  const weekPts = weeks.filter((p) => p.v != null).map((p) => ({ d: p.to, v: p.v, from: p.from }));
  const atdPts = atd.map((p) => ({ d: p.to, v: p.v }));
  const views = [weekPts.length > 1 && "week", atdPts.length > 1 && "atd"].filter(Boolean);
  const on = views.includes(view) ? view : views[0];
  const max = Math.max(...two.map((p) => p.v || 0), 1);
  return (
    <div className="ard-lum" data-lum-history>
      {views.length > 1 && (
        <div className="ard-switch" role="tablist" data-lum-switch>
          {views.map((k) => <button key={k} type="button" role="tab" aria-selected={k === on} className={k === on ? "on" : ""} data-lum-view={k} onClick={() => setView(k)}>{k === "week" ? "Streams per week" : "All-time streams"}</button>)}
        </div>
      )}
      {on && (
        <>
          <BigChart key={on} points={on === "week" ? weekPts : atdPts} step={on === "week" ? 7 : "auto"} kind={on === "week" ? "level" : "total"} unit="streams" label={on === "week" ? "Luminate streams per week" : "Luminate all-time streams"} releases={releases} variant={variant} />
          <p className="hint" data-lum-what>{CAPTION[on === "week" ? "lumWeek" : "lumAtd"]}</p>
          <p className="hint" data-lum-n>{on === "week"
            ? `${weekPts.length} weeks with a number, ${dayText(weekPts[0].d)} to ${dayText(weekPts[weekPts.length - 1].d)}${weeks.length > weekPts.length ? ` · ${weeks.length - weekPts.length} with none` : ""}`
            : `${atdPts.length} readings, ${dayText(atdPts[0].d)} to ${dayText(atdPts[atdPts.length - 1].d)}`} · {on === "week" ? "Luminate streams per week" : "Luminate all-time streams"} · {series[0]?.src || "Luminate, all platforms"}</p>
        </>
      )}
      {atd.length > 0 && <p className="hint" data-lum-atd>All-time streams: {atd.map((p) => `${dayText(p.to)} ${n0(p.v)}`).join(" → ")}</p>}
      {(atdOld.length > 0 || weeksOld.length > 0) && (
        <p className="hint ard-lum-older" data-lum-older>{`${LUM_BASIS_NOTE}. Before it, on its older, narrower count (kept apart, never compared with the numbers above): ${[
          atdOld.length && `all-time ${atdOld.map((p) => `${dayText(p.to)} ${n0(p.v)}`).join(" → ")}`,
          weeksOld.length && `${weeksOld.length === 1 ? "the week" : "weeks"} ${weeksOld.slice(-OLD_WEEKS_SHOWN).map((p) => `${dayText(p.from)}–${dayText(p.to)} ${n0(p.v)}`).join(" · ")}${weeksOld.length > OLD_WEEKS_SHOWN ? ` and ${weeksOld.length - OLD_WEEKS_SHOWN} earlier` : ""}`,
        ].filter(Boolean).join("; ")}.`}</p>
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

// how much there is, and over which days: "12 days with a reading (13 readings), Nov 4 to Nov 20" (the chart's head says "12 days with a reading" in the same
// words: it counts days, one point each), "1 reading so far (Nov 4)", "2 readings, Nov 4, 7 AM → 7 PM (one day, so one point)".
// r10 fix: New York days; two readings on one day say so. The songs' daily streams are days with a gain, not readings (a day of 0 isn't one: the chart leaves it out).
function readingsText(s) {
  const pts = s.kind === "daily" ? s.points.filter((p) => valueOfPoint(p) !== 0) : s.points;
  if (!pts.length) return "No day with a gain yet";
  const days = pts.length, raw = s.reads || days, first = dayText(dayOfPoint(pts[0])), last = dayText(dayOfPoint(pts[days - 1]));
  if (s.kind === "daily") return `${countWords(days, { kind: "daily" })}, ${first}${days > 1 ? ` to ${last}` : ""}, from ${s.songs} of their ${s.linked} ${s.linked === 1 ? "song" : "songs"}`;
  if (days === 1) return raw === 1 ? `1 reading so far (${first})` : `${raw} readings, ${spanText(s.firstAt, s.lastAt)} (one day, so one point)`;
  return `${countWords(days)}${raw > days ? ` (${raw} readings)` : ""}, ${first} to ${last}`;
}

export function ArDrawer({ itemKey, me, founder = false, onClose, onChanged }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [metric, setMetric] = useState(null);
  const [notes, setNotes] = useState("");
  const [askOff, setAskOff] = useState(null); // a Founder taking someone else's entry off: the entry, until confirmed
  const [paste, setPaste] = useState(""); // "None of these?": their Spotify link, pasted right here
  const [full, setFull] = useState(true); // full screen (the default) or the 480px drawer; this browser's choice is read before the first paint
  const phone = usePhone();
  const card = useRef(null);
  const load = () => fetch(`/api/ar-lists?item=${encodeURIComponent(itemKey)}`, { cache: "no-store" }).then((r) => r.json())
    .then((j) => { if (j.error) throw new Error(j.error); setD(j); setNotes(j.notes || ""); setErr(null); }).catch((e) => setErr(e.message));
  useEffect(() => { setD(null); setMetric(null); setNote(null); load(); }, [itemKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useIso(() => { setFull(drawerSize.get() === "full"); }, []);
  const toggleSize = () => { const next = !full; setFull(next); drawerSize.set(next ? "full" : "side"); };
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
  const cur = shown ? series[shown] : null;
  const cells = Object.values(r?.m || {}).filter((c) => c && !c.none);
  const reads = !cells.some((c) => c.d1 != null) && cells.some((c) => c.rd != null);
  const big = full || phone; // the big view (a phone is always it)
  const variant = big ? "full" : "drawer";
  const mw = r && d?.momentum ? momentumWords(d.momentum) : null;
  const mh = r && r.kind === "artist" ? momentumHead(r.momentum, d?.momentum?.day) : null; // "Score 71, down 3.3 since yesterday"

  const secRole = r && r.kind === "artist" && r.trackedId && !r.roster ? (
    <section className="ard-sec ard-role" data-drawer-type>
      <span className="ard-role-l">Type</span>
      <span className="ard-role-pick" role="radiogroup" aria-label="Artist or producer">
        {["artist", "producer"].map((k) => {
          const on = typeOf(r) === k;
          return <button key={k} type="button" role="radio" aria-checked={on} className={`btn ghost sm${on ? " on" : ""}`} data-type={k} data-role-pick={k} disabled={busy}
            onClick={() => (!on || r.typeKnown === false) && act({ action: "setRole", id: r.trackedId, role: k }, k === "producer" ? `${r.name} is a Producer.` : `${r.name} is an Artist.`)}><i aria-hidden="true" />{TYPE_LABEL[k]}</button>;
        })}
      </span>
      {r.typeKnown === false && <span className="hint ard-role-h" data-role-default>Nobody has picked yet.</span>}
    </section>
  ) : null;

  const secWho = r ? (
    <section className="ard-sec" data-drawer-who>
      <Links links={r.links} />
      {/* r11 fix: two lists, named: the team's Watchlist (who added it) and your own My A&R */}
      <h4 className="ard-who-h">Team watchlist</h4>
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
                    {w.id === me ? "Remove from my list" : w.id === "team:luminate" ? "Take off" : `Take off ${w.name}'s list`}
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      {!mine && !r.tracking.roster && (
        <p className="hint ard-mine"><b>My A&amp;R:</b> not on it yet.{" "}
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => act({ action: "addMine", subject: r.key }, "On your list too, for 30 days.")} data-add-mine>Add to My A&amp;R</button></p>
      )}
    </section>
  ) : null;

  const secMatch = r && r.match === "name" ? (
    <section className="ard-sec" data-drawer-match>
      <h4>Spotify match to confirm</h4>
      <p className="hint">Luminate only gave us their name. Nothing is tracked on Spotify until you tap the right one.</p>
      {(r.candidates || []).map((c) => (
        <div key={c.id} className="ard-cand" data-candidate={c.id}>
          {c.image ? <img src={c.image} alt="" width={36} height={36} referrerPolicy="no-referrer" /> : <span className="arg-ph none">{String(c.name || "?").slice(0, 1)}</span>}
          <span className="ard-cand-t"><b>{c.name}</b>
            {/* r10 fix: what tells same-name profiles apart */}
            {c.info && <span className="ard-cand-info" data-cand-info>{[c.info.listeners ? `${c.info.listeners} monthly listeners` : "", c.info.latest ? `newest: “${c.info.latest.name}” (${dayText(c.info.latest.releaseDate)})` : c.info.releases === 0 ? "no releases of their own" : ""].filter(Boolean).join(" · ") || "No numbers on their Spotify page"}</span>}
            <a href={`https://open.spotify.com/artist/${c.id}`} target="_blank" rel="noopener noreferrer">Open on Spotify <ExternalLink size={11} /></a></span>
          <span className="ard-cand-act">
            <button type="button" className="btn sm" disabled={busy} onClick={() => act({ action: "confirmMatch", id: r.trackedId, spotifyId: c.id }, `Confirmed: ${c.name}. Its numbers start with the next update.`)} data-confirm={c.id}>That's them</button>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => act({ action: "notThem", id: r.trackedId, spotifyId: c.id }, "Taken off the choices.")} data-not-them={c.id}>Not them</button>
          </span>
        </div>
      ))}
      {r.candidates?.some((c) => c.info?.listeners) && <p className="hint">Monthly listeners as Spotify's own page rounds them.</p>}
      <form className="ard-paste" onSubmit={(e) => { e.preventDefault(); const sp = /spotify\.com\/(?:intl-[a-z-]+\/)?artist\/([A-Za-z0-9]{22})/.exec(paste)?.[1]; if (!sp) { setNote({ ok: false, text: "That isn't a Spotify artist link (open.spotify.com/artist/…)." }); return; } act({ action: "confirmMatch", id: r.trackedId, spotifyId: sp }, "Confirmed from your link. Its numbers start with the next update.").then(() => setPaste("")); }} data-drawer-paste>
        <input type="url" inputMode="url" placeholder="None of these? Paste their Spotify link" value={paste} onChange={(e) => setPaste(e.target.value)} aria-label="Their Spotify artist link" />
        <button type="submit" className="btn sm" disabled={busy || !paste.trim()}>Use this one</button>
      </form>
    </section>
  ) : null;

  const secIsrc = r && r.match === "isrc" && r.kind === "song" ? (
    <section className="ard-sec" data-drawer-match="isrc">
      <h4>Is this the right song?</h4>
      <p className="hint">Matched to Spotify by its ISRC{r.isrc ? ` (${r.isrc})` : ""}. Its number is one reading and isn't tracked until you say yes.</p>
      <div className="ard-confirm-isrc">
        {r.links?.spotify && <a className="btn ghost sm" href={r.links.spotify} target="_blank" rel="noopener noreferrer">Check it on Spotify <ExternalLink size={11} /></a>}
        <button type="button" className="btn sm" disabled={busy} onClick={() => act({ action: "confirmMatch", id: r.trackedId }, "Confirmed. It's tracked from the next update.")} data-confirm-isrc>Yes, that's it</button>
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => act({ action: "notThem", id: r.trackedId }, "Unlinked. Paste the right Spotify link in the box to track it.")} data-not-isrc>No, wrong song</button>
      </div>
    </section>
  ) : null;

  const secNums = r ? (
    <section className="ard-sec" data-drawer-numbers>
      <h4>Numbers</h4>
      {/* a phone shows each metric as a card (m-cards): its name, then Now / Δ day / Δ week / As of lines */}
      <div className="ard-nums-wrap m-cards-wrap">
      <table className="ard-nums m-cards">
        <thead><tr><th>Metric</th><th className="num">Now</th><th className="num">{reads ? "Δ last read" : "Δ day"}</th><th className="num">Δ week</th><th>As of · source</th></tr></thead>
        <tbody>
          {Object.entries(r.m || {}).map(([k, c]) => (
            <tr key={k} data-metric={k}>
              <td>{METRIC_NAME[k]}</td>
              <td className="num" data-label="Now"><MetricCell c={c} label={METRIC_NAME[k]} /></td>
              <td className="num" data-label={reads ? "Δ last read" : "Δ day"}><DeltaCell c={c} span={reads ? "reads" : "day"} label={METRIC_NAME[k]} /></td>
              <td className="num" data-label="Δ week"><DeltaCell c={c} span="week" label={METRIC_NAME[k]} /></td>
              <td className="ard-asof" data-label="As of">{c?.at ? <span>{atText(c.at)}{c.src ? <small>{c.src}</small> : null}</span> : ""}</td>
            </tr>
          ))}
          {r.lum?.week && (
            <tr data-metric="lum"><td><i>Luminate streams, week {r.lum.week.label}</i></td><td className="num" data-label="Now">{n0(r.lum.week.v)}</td><td /><td className="num" data-label="vs week before"><span data-dir={dirOf(r.lum.week.pct)}>{pctText(r.lum.week.pct)}</span></td><td className="ard-asof" data-label="Week"><span>{r.lum.week.label}<small>Luminate, all platforms</small></span></td></tr>
          )}
        </tbody>
      </table>
      </div>
    </section>
  ) : null;

  const secChart = r ? (
    <section className="ard-sec" data-drawer-chart>
      <h4>Spotify{shown && !["listeners", "streams", "spfollowers", "songStreams"].includes(shown) ? " and socials" : ""}</h4>
      {metrics.length > 1 && (
        <div className="ard-switch" role="tablist">{metrics.map((k) => <button key={k} type="button" role="tab" aria-selected={k === shown} className={k === shown ? "on" : ""} onClick={() => setMetric(k)}>{series[k].label}</button>)}</div>
      )}
      {/* (2026-11-25 declutter) the person chart: "No readings yet." alone, and no caption under the chart on how the number is read (lib/ar/chart.js CAPTION): the line under it names the series and its source */}
      {!shown && <p className="hint" data-chart-none>{r.match === "name" ? "Confirm the Spotify match first: numbers start after a tap." : "No readings yet."}</p>}
      {shown && (
        <>
          <BigChart key={shown} points={cur.points} label={cur.label} kind={kindOf(shown, cur)} unit={shown === "songStreams" ? "streams" : UNIT[shown]} songs={shown === "songStreams" ? cur.linked : null} releases={d.releases || NONE} variant={variant} />
          <p className="hint" data-chart-n>{readingsText(cur)} · {cur.label} · {cur.src}</p>
        </>
      )}
    </section>
  ) : null;

  const secLum = r ? (
    <section className="ard-sec" data-drawer-lum>
      <h4>Luminate (all platforms), history, read-only</h4>
      <LumHistory series={d.lumSeries || []} releases={d.releases || NONE} variant={variant} />
    </section>
  ) : null;

  const secMomentum = r && r.kind === "artist" && r.momentum?.score != null ? (
    <section className="ard-sec" data-drawer-momentum>
      <h4>Momentum</h4>
      {mh ? (
        <>
          <p data-momentum-head><b>Score {mh.score}</b> · <span data-dir={mh.dir}>{mh.move}</span></p>
          {r.momentum.why ? <p className="hint" data-momentum-why>What moved: {r.momentum.why}</p> : null}
        </>
      ) : <p className="hint">{r.momentum?.why || "Needs a second day of numbers."}</p>}
      {mw && (
        <div className="ard-mo" data-momentum-parts>
          {mw.items.map((x) => (
            <div key={x.key} className="ard-mo-row" data-part={x.key} data-counted={x.counted ? "" : undefined}>
              <span className="ard-mo-l">{x.label}<small>{x.counted ? `weight ${x.pct}%` : "not counted"}</small></span>
              <span className="ard-mo-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, Math.min(100, x.points))}%` }} /></span>
              <b>{x.points}</b>
              {x.text ? <span className="ard-mo-t">{x.text}</span> : null}
            </div>
          ))}
          <p className="hint" data-momentum-line>{mw.line}.{mw.day ? ` Worked out ${dayText(mw.day)}.` : ""}</p>
          {mw.left.length > 0 && <p className="hint">{mw.left.join(" and ")} left out of the score: nothing tracked for {mw.left.length === 1 ? "it" : "them"} yet.</p>}
        </div>
      )}
    </section>
  ) : null;

  const secCampaign = r && d.canCampaign ? (
    <section className="ard-sec" data-drawer-campaign>
      <h4>Refresh</h4>
      <label className="ard-toggle">
        <input type="checkbox" checked={d.mode?.mode === "campaign"} disabled={busy} onChange={(e) => act({ action: "setMode", entityId: r.entityId, mode: e.target.checked ? "campaign" : "auto" }, e.target.checked ? "Daily updates on: every number refreshes each day." : "Back to the usual schedule.")} data-campaign />
        <span>Daily updates (campaign mode)</span>
      </label>
      <p className="hint">Every number for this {r.kind === "sound" ? "sound" : "artist"} refreshes each day while it's on. It costs a little Apify credit a day.</p>
    </section>
  ) : null;

  const secNotes = r && r.trackedId ? (
    <section className="ard-sec" data-drawer-notes>
      <h4>Notes</h4>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Anything the team should know" aria-label="Notes"
        onBlur={() => notes !== (d.notes || "") && act({ action: "notes", id: r.trackedId, notes }, "Notes saved.")} data-notes />
    </section>
  ) : null;

  return (
    <div className={`ard-bg${big ? " ard-bg-full" : ""}`} onClick={(e) => e.target === e.currentTarget && onClose()} data-drawer-bg data-drawer-mode={big ? "full" : "side"}>
      <aside className={`ard${big ? " ard-full" : ""}`} role="dialog" aria-label={r ? r.name : "Details"} tabIndex={-1} ref={card} data-drawer={itemKey}>
        <div className="ard-head">
          {r && <Photo r={r} size={44} />}
          <div className="ard-title">
            <h3>{r ? r.name : d?.gone ? "Not on any list" : "Loading…"}</h3>
            {r && <span className="ard-sub"><TypeChip r={r} />{r.artist ? <span>{r.artist}</span> : null}</span>}
          </div>
          {/* the big view <-> the 480px drawer; a phone has only the big one, so no button there */}
          {!phone && (
            <button type="button" className="btn ghost sm ard-size" onClick={toggleSize} data-drawer-size={full ? "full" : "side"} aria-label={full ? "Smaller: show as a side drawer" : "Full screen"}>
              {full ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}<span>{full ? "Smaller" : "Full screen"}</span>
            </button>
          )}
          <button type="button" className="btn ghost sm" onClick={onClose} aria-label="Close" data-drawer-close><X size={18} /></button>
        </div>
        <div className="ard-body">
          {err && <p className="hint err-text">{err} <button className="btn ghost sm" onClick={load}>Try again</button></p>}
          {d?.gone && <p className="hint">Nobody has this on their list any more. Its numbers are kept: paste its link again to bring them back.</p>}
          {note && <p className={`hint ${note.ok ? "ok-text" : "err-text"}`} role="status" data-drawer-note>{note.text}</p>}
          {r && (big ? (
            // the big view: what needs a tap first (a Spotify match to confirm: until then there is no chart), then the chart and what goes with it; who added it,
            // refresh and notes beside (from 1000px) or below
            <div className="ard-grid" data-ard-grid>
              <div className="ard-main">{secMatch}{secIsrc}{secChart}{secNums}{secLum}{secMomentum}</div>
              <div className="ard-side">{secRole}{secWho}{secCampaign}{secNotes}</div>
            </div>
          ) : (
            <>{secRole}{secWho}{secMatch}{secIsrc}{secNums}{secChart}{secLum}{secMomentum}{secCampaign}{secNotes}</>
          ))}
          {!d && !err && <p className="hint"><RefreshCw size={12} className="spin" /> Loading…</p>}
        </div>
      </aside>
    </div>
  );
}
