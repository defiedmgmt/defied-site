// A&R › Trackers (list B #5) and the momentum score (#8), plus Home's momentum card and the Watchlist's
// scores. Built mobile-first: cards everywhere (one column on a phone, two from 900px), 44px taps, no
// sideways scroll at 390px. Styles: components/ar/ar.css (imported in pages/_app.jsx). Adding is the shared
// paste box (components/LinkBox.jsx, context "tracker").
import React, { useEffect, useState } from "react";
import { Clock, TrendingUp, MoreHorizontal, Info, ExternalLink } from "lucide-react";
import LinkBox from "../LinkBox";

export const post = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "defied-site" }, body: JSON.stringify(body) })
  .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok || j.error) throw new Error(j.error || "That didn't save — try again."); return j; });
const fmt = (n) => Number(n || 0).toLocaleString("en-US");
export const day = (iso) => (iso ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const KIND = { artist: "Artist", song: "Song", sound: "Sound" };
// what a pasted link adds (the paste box's result: { link, card, links, already })
export function trackBody(r) {
  const l = r?.link || {}, c = r?.card || {};
  if (l.platform === "tiktok" && l.kind === "sound") return { kind: "sound", url: l.url, clip: l.id, name: c.name || "", artist: c.artist || "" };
  if (l.platform === "spotify" && l.kind === "song") return { kind: "song", spotify: l.url, name: c.name || "", artist: c.artist || "", image: c.image || c.photo || "" };
  if (l.platform === "spotify" && l.kind === "artist") return { kind: "artist", spotify: l.url, name: c.name || "", image: c.photo || c.image || "" };
  // an Instagram / TikTok / YouTube profile: the artist by name (and their Spotify, when one was confirmed)
  return { kind: "artist", name: String(c.name || "").replace(/^@/, ""), spotify: r?.links?.spotify || "", image: c.photo || "" };
}
export const TRACK_KINDS = ["artist", "song", "sound", "profile", "channel"];

export function Trend({ m }) {
  if (!m || m.score == null) return null;
  const t = m.trend;
  return <span className="art-trend" data-trend={t || "new"} title={m.delta != null ? `${m.delta >= 0 ? "+" : ""}${m.delta} since ${day(m.vs) || "last week"}` : "First score"}>{t === "rising" ? "▲" : t === "falling" ? "▼" : t === "steady" ? "–" : "new"}</span>;
}
export function Score({ m, big = false }) {
  if (!m || m.score == null) return <span className={`art-score none${big ? " big" : ""}`} title={m?.why || "Needs a second day of numbers"}>—</span>;
  return <span className={`art-score${big ? " big" : ""}`} data-score={Math.round(m.score)}>{Math.round(m.score)}</span>;
}

// how long it's tracked: Never / No end date / N days left / Expired + Renew
function Expiry({ i, onRenew, busy }) {
  if (i.roster) return <span className="art-exp" data-exp="never">Roster · never expires</span>;
  if (i.never) return <span className="art-exp" data-exp="none">No end date</span>;
  if (i.state === "expired") return (
    <span className="art-exp expired" data-exp="expired">
      <Clock size={14} aria-hidden="true" /> Expired · not refreshing{i.graceLeft != null ? ` · goes in ${i.graceLeft} ${i.graceLeft === 1 ? "day" : "days"}` : ""}
      <button className="btn sm art-renew" disabled={busy} onClick={(e) => { e.stopPropagation(); onRenew(); }} data-renew>Renew</button>
    </span>
  );
  return <span className={`art-exp${i.state === "soon" ? " soon" : ""}`} data-exp={i.state}>{i.daysLeft} {i.daysLeft === 1 ? "day" : "days"} left</span>;
}

function TrackerCard({ i, me, durations, busy, act }) {
  const [menu, setMenu] = useState(false);
  const mine = i.who.find((w) => w.ownerId === me);
  return (
    <div className={`nums-card art-card${i.state === "expired" ? " is-expired" : ""}`} data-tracker-item={i.key} data-state={i.state}>
      <div className="art-top">
        {i.image ? <img className="nums-av" src={i.image} alt="" loading="lazy" /> : <span className="nums-av" aria-hidden="true">{(i.name || "?").slice(0, 1)}</span>}
        <div className="art-name">
          <b>{i.name}</b>
          <span className="art-sub">{[KIND[i.kind], i.artist].filter(Boolean).join(" · ")}</span>
        </div>
        <div className="art-mo" data-momentum={i.score == null ? "none" : Math.round(i.score)}><Score m={i} big /><Trend m={i} /></div>
        <button className="art-more" aria-label="More" aria-expanded={menu} onClick={() => setMenu(!menu)}><MoreHorizontal size={18} /></button>
      </div>
      {i.why ? <p className="art-why" data-why>{i.why}</p> : null}
      <p className="art-who" data-who>{i.who.map((w) => `${w.name} · ${day(w.addedAt)}`).join(", ")}</p>
      <div className="art-foot"><Expiry i={i} busy={busy} onRenew={() => act({ action: "renew", subjects: i.subjects }, `${i.name} renewed.`)} />
        {i.link && /^https:\/\//.test(i.link) && <a className="art-open" href={i.link} target="_blank" rel="noreferrer" aria-label="Open">Open <ExternalLink size={12} /></a>}</div>
      {menu && (
        <div className="art-menu" role="menu">
          {mine && !i.roster && <span className="art-menu-row">Track for {durations.map((d) => <button key={d} className={`art-seg${mine.days === d ? " on" : ""}`} disabled={busy} onClick={() => { setMenu(false); act({ action: "setDays", entryId: mine.entryId, days: d }, `Tracked for ${d} days from today.`); }}>{d}d</button>)}</span>}
          {mine && <button className="art-menu-btn" disabled={busy} onClick={() => { setMenu(false); act({ action: "remove", entryId: mine.entryId }, `${i.name} is off your tracker. Its numbers are kept.`); }} data-remove>Remove from my tracker</button>}
          {!mine && <span className="art-menu-row muted">On {i.names.join(" and ")}'s {i.names.length > 1 ? "trackers" : "tracker"}</span>}
        </div>
      )}
    </div>
  );
}

function Weights({ w, onSaved }) {
  const [v, setV] = useState(w);
  const [msg, setMsg] = useState("");
  useEffect(() => setV(w), [w]);
  const f = (k, label) => <label className="art-w"><span>{label}</span><input type="number" min="0" max="100" inputMode="numeric" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} data-weight={k} /></label>;
  return (
    <div className="art-weights" data-weights>
      <p className="art-help">Each part is growth for its size, so small artists on the rise score high. 50 = flat. Recent = how much the last 7 days count over the 3 weeks before.</p>
      <div className="art-w-row">{f("streams", "Streams")}{f("followers", "Followers")}{f("tiktok", "TikTok sounds")}{f("recent", "Recent %")}</div>
      <button className="btn sm" onClick={() => post("/api/ar-trackers", { action: "weights", weights: v }).then((j) => { setMsg("Saved."); onSaved(j.weights); }).catch((e) => setMsg(e.message))} data-save-weights>Save weights</button>
      {msg && <span className="art-msg">{msg}</span>}
    </div>
  );
}

export function ArTrackers() {
  const [who, setWho] = useState("team");
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [days, setDays] = useState(30);
  const [showW, setShowW] = useState(false);
  const load = (w = who) => fetch(`/api/ar-trackers?who=${encodeURIComponent(w)}`, { cache: "no-store" }).then((r) => r.json())
    .then((j) => { if (j.error) throw new Error(j.error); setD(j); setErr(""); }).catch((e) => setErr(e.message || "Couldn't load the trackers."));
  useEffect(() => { load(who); }, [who]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = (body, done) => { setBusy(true); setMsg(""); return post("/api/ar-trackers", body).then((j) => { setMsg(done(j) || ""); return load(); }).catch((e) => setMsg(e.message)).finally(() => setBusy(false)); };
  const add = async (r) => {
    setBusy(true); setMsg("");
    try {
      const j = await post("/api/ar-trackers", { action: "add", days, ...trackBody(r) });
      const on = [...new Set((r.already || []).filter((o) => o.where === "tracker" && o.ownerId !== d?.me).map((o) => (o.text || "").replace(/^Already on /, "")))].filter(Boolean);
      const roster = String(j.subject || "").startsWith("a:");
      setMsg(j.already ? "Already on your tracker." : `${roster ? "Added (roster artists never expire)" : `Added for ${days} days`}.${on.length ? ` Also on ${on.join(" and ")}.` : ""}${j.restored ? " Its old numbers are back." : ""}`);
      await load();
    } catch (e2) { setMsg(e2.message); } finally { setBusy(false); }
  };
  const items = d?.items || [];
  const people = (d?.people || []).filter((p) => p.id !== d?.me);
  return (
    <div className="art" data-trackers>
      <div className="admin-head ar-head"><div className="ar-head-text"><p className="ar-sub">Everyone's trackers in one list, best momentum first.</p></div>
        <button className="btn ghost sm art-icon" aria-label="Score weights" aria-expanded={showW} onClick={() => setShowW(!showW)}><Info size={15} /> Score</button></div>
      {showW && d && <Weights w={d.weights} onSaved={(w) => { setD({ ...d, weights: w }); load(); }} />}
      <div className="art-add" data-tracker-add>
        <LinkBox context="tracker" kinds={TRACK_KINDS} allowDuplicate busy={busy} placeholder="Paste a Spotify, TikTok sound, Instagram or YouTube link" onAdd={add} />
        <span className="art-days" role="group" aria-label="Track for"><span className="art-days-label">Track for</span>{(d?.durations || [30, 60, 90]).map((n) => <button type="button" key={n} className={`art-seg m-tap${days === n ? " on" : ""}`} aria-pressed={days === n} onClick={() => setDays(n)}>{n}d</button>)}</span>
      </div>
      {msg && <p className="art-msg" data-msg>{msg}</p>}
      <div className="art-people" role="tablist" aria-label="Whose tracker">
        {[["team", "Team"], ["me", "Mine"], ...people.map((p) => [p.id, p.name])].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={who === id} className={`art-pill${who === id ? " on" : ""}`} onClick={() => setWho(id)} data-who-filter={id}>{label}</button>
        ))}
      </div>
      {err && <p className="hint err-text">{err} <button className="btn ghost sm" onClick={() => load()}>Try again</button></p>}
      {!d && !err && <p className="muted dash-wait">Loading…</p>}
      {d && !items.length && <div className="admin-empty" data-empty>{who === "team" ? "Nobody is tracking anything yet. Paste a link above to start." : "Nothing on this tracker yet."}</div>}
      <div className="art-list">
        {items.map((i) => <TrackerCard key={i.key} i={i} me={d.me} durations={d.durations} busy={busy} act={(body, text) => act(body, () => text)} />)}
      </div>
      {d && items.some((i) => i.state === "expired") && <p className="art-help">Expired ones stop refreshing (no cost) and come off {d.graceDays} days later. Their numbers are kept: adding one again brings them back.</p>}
    </div>
  );
}

// Home: only when someone's momentum jumped (15+ points against about a week ago)
export function HomeMomentum({ onGo }) {
  const [d, setD] = useState(null);
  useEffect(() => { fetch("/api/ar-trackers?home=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => {}); }, []);
  if (!d?.jumps?.length) return null;
  return (
    <div className="home-card art-home" data-home-momentum>
      <div className="attn-head"><TrendingUp size={15} /> Momentum jumps
        <button type="button" className="inline-link home-all" onClick={() => onGo("ar", "trackers")}>Trackers ›</button></div>
      {d.jumps.map((j) => <p key={j.id} className="todo-line" data-jump={j.id}><b>{j.name}</b>&nbsp;+{Math.round(j.delta)} to {Math.round(j.score)}{j.why ? ` · ${j.why}` : ""}</p>)}
    </div>
  );
}

// the Watchlist's scores: { entityId: { score, trend, why } }
export function useMomentumScores() {
  const [m, setM] = useState(null);
  useEffect(() => { fetch("/api/ar-trackers?scores=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setM(j?.scores || {})).catch(() => setM({})); }, []);
  return m;
}
export const watchEntityOf = (r) => (r?.clientId ? `a:${r.clientId}` : r?.ref?.type === "tracked" ? `w:${r.ref.id}` : r?.entityId || null);
export function MomentumChip({ m }) {
  if (!m || m.score == null) return null;
  return <span className="art-chip" data-watch-momentum={Math.round(m.score)} title={m.why}>Momentum <Score m={m} /> <Trend m={m} /></span>;
}
