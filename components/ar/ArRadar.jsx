// A&R › Radar (list B #6): the TikTok sounds that are growing, from the radar's keywords and the sounds on
// our tracked artists' latest videos (GET/POST /api/radar, lib/ar/radar.js: real scans only, nothing made up).
// Adding a sound is the shared paste box (components/LinkBox.jsx, context "radar"). Mobile first: cards,
// 44px taps, no sideways scroll at 390px. Styles: components/ar/ar.css.
import React, { useEffect, useState } from "react";
import { ExternalLink, RefreshCw, X } from "lucide-react";
import LinkBox from "../LinkBox";
import { post, day } from "./ArTrackers";

const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString("en-US"));
const pctText = (p) => (p == null ? "" : `${p >= 0 ? "+" : "−"}${Math.abs(Math.round(p * 1000) / 10)}%`);
const usd = (n) => `$${Number(n || 0).toFixed(2)}`;

function SoundCard({ s, busy, act }) {
  return (
    <div className="nums-card art-card rad-card" data-radar-sound={s.id}>
      <div className="art-top">
        {s.cover ? <img className="nums-av" src={s.cover} alt="" loading="lazy" /> : <span className="nums-av" aria-hidden="true">♪</span>}
        <div className="art-name"><b>{s.title || "TikTok sound"}</b><span className="art-sub">{[s.artist, ...(s.genres || [])].filter(Boolean).join(" · ")}</span></div>
        {s.own && <span className="art-chip" data-own>Ours</span>}
      </div>
      <p className="art-why" data-growth>
        {s.newVideos != null ? <><b>+{fmt(s.newVideos)}</b> new videos{s.pct != null ? ` (${pctText(s.pct)})` : ""} since {day(s.since)}</> : s.videos != null ? `${fmt(s.videos)} videos so far · growth shows after the next scan` : "Not counted yet · counted on the next scan"}
        {s.videos != null && s.newVideos != null ? ` · ${s.approx ? "about " : ""}${fmt(s.videos)} in all` : ""}
      </p>
      {s.trackedBy?.length > 0 && <p className="art-who">On {s.trackedBy.join(" and ")}'s tracker</p>}
      <div className="art-foot rad-foot">
        <button className="btn sm m-tap" disabled={busy} onClick={() => act({ action: "track", id: s.id, what: "sound" }, "Sound added to your tracker.")} data-track-sound>Track sound</button>
        {s.artist && <button className="btn ghost sm m-tap" disabled={busy} onClick={() => act({ action: "track", id: s.id, what: "artist" }, `${s.artist} added to your tracker.`)} data-track-artist>Track artist</button>}
        {s.url && /^https:\/\//.test(s.url) && <a className="art-open m-tap" href={s.url} target="_blank" rel="noreferrer">Open <ExternalLink size={12} /></a>}
        <button className="art-more m-tap" aria-label="Hide this sound" disabled={busy} onClick={() => act({ action: "hide", id: s.id }, "Hidden from the radar.")} data-hide><X size={16} /></button>
      </div>
    </div>
  );
}

export function ArRadar() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [genre, setGenre] = useState("");
  const [kw, setKw] = useState({ keyword: "", genre: "" });
  const load = (g = genre) => fetch(`/api/radar?genre=${encodeURIComponent(g)}`, { cache: "no-store" }).then((r) => r.json())
    .then((j) => { if (j.error) throw new Error(j.error); setD(j); setErr(""); }).catch((e) => setErr(e.message || "Couldn't load the radar."));
  useEffect(() => { load(genre); }, [genre]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = (body, text) => { setBusy(true); setMsg(""); return post("/api/radar", body).then(() => { setMsg(text || ""); return load(); }).catch((e) => setMsg(e.message)).finally(() => setBusy(false)); };
  const addKw = (e) => { e.preventDefault(); if (!kw.keyword.trim()) return; act({ action: "addKeyword", keyword: kw.keyword.trim(), genre: kw.genre.trim() }, `“${kw.keyword.trim()}” is on the radar.`).then(() => setKw({ keyword: "", genre: "" })); };
  const c = d?.cost;
  return (
    <div className="art rad" data-radar>
      <div className="admin-head ar-head"><div className="ar-head-text"><p className="ar-sub">TikTok sounds that are growing, from your keywords and our artists' videos.</p></div></div>
      <div className="art-add" data-radar-add>
        <LinkBox context="radar" kinds={["sound"]} addLabel="Add to radar" busy={busy} onAdd={(r) => act({ action: "addSound", url: r.link.url }, "Added. It's counted on the next scan.")} />
      </div>
      {msg && <p className="art-msg" data-msg>{msg}</p>}
      {err && <p className="hint err-text">{err} <button className="btn ghost sm" onClick={() => load()}>Try again</button></p>}
      {!d && !err && <p className="muted dash-wait">Loading…</p>}
      {d && <>
        {d.genres?.length > 0 && (
          <div className="art-people" role="tablist" aria-label="Genre">
            {[["", "All"], ...d.genres.map((g) => [g, g])].map(([id, label]) => <button key={id || "all"} role="tab" aria-selected={genre === id} className={`art-pill${genre === id ? " on" : ""}`} onClick={() => setGenre(id)} data-genre={id || "all"}>{label}</button>)}
          </div>
        )}
        <h3 className="rad-h">Growing now</h3>
        {!d.rising.length && <div className="admin-empty" data-empty>{d.keywords.length ? "Nothing has grown since the last scan yet." : "Add a keyword below (or paste a sound) to start."}</div>}
        <div className="art-list">{d.rising.map((s) => <SoundCard key={s.id} s={s} busy={busy} act={act} />)}</div>
        {d.firstSeen.length > 0 && <><h3 className="rad-h">Seen once so far</h3><div className="art-list">{d.firstSeen.slice(0, 12).map((s) => <SoundCard key={s.id} s={s} busy={busy} act={act} />)}</div></>}
        {d.waiting.length > 0 && <p className="art-help" data-waiting>{d.waiting.length} {d.waiting.length === 1 ? "sound waits" : "sounds wait"} for the next scan.</p>}
        <h3 className="rad-h">Keywords</h3>
        <div className="rad-kws" data-keywords>
          {d.keywords.map((k) => (
            <span key={k.id} className={`art-chip rad-kw${k.active ? "" : " off"}`} data-keyword={k.keyword}>{k.keyword}{k.genre && k.genre !== k.keyword ? ` · ${k.genre}` : ""}
              <button className="m-tap rad-kw-x" aria-label={`Remove ${k.keyword}`} disabled={busy} onClick={() => act({ action: "removeKeyword", id: k.id }, `“${k.keyword}” is off the radar.`)}><X size={13} /></button></span>
          ))}
          {!d.keywords.length && <span className="muted">No keywords yet.</span>}
        </div>
        <form className="rad-kw-add" onSubmit={addKw}>
          <input value={kw.keyword} onChange={(e) => setKw({ ...kw, keyword: e.target.value })} placeholder="Keyword, e.g. drill" aria-label="Keyword" />
          <input value={kw.genre} onChange={(e) => setKw({ ...kw, genre: e.target.value })} placeholder="Genre (optional)" aria-label="Genre" />
          <button className="btn sm" disabled={busy || !kw.keyword.trim()} data-add-keyword>Add</button>
        </form>
        {c && (
          <p className="art-help rad-cost" data-radar-cost>
            This month {usd(c.spentUsd)} of the radar's {usd(c.capUsd)} · a scan is about {usd(c.scanUsd)}{d.lastScanAt ? ` · last scan ${day(d.lastScanAt)}` : ""}
            {d.refresh === "on"
              ? <button className="btn ghost sm m-tap" disabled={busy || !d.keywords.length} onClick={() => act({ action: "scan" }, "Scan started. New numbers come in a few minutes.")} data-scan><RefreshCw size={13} /> Scan now</button>
              : <span> · scans are off (DATA_REFRESH)</span>}
          </p>
        )}
        <p className="art-help"><a href={d.tokchart} target="_blank" rel="noreferrer">TokChart</a> shows the top sounds across TikTok.</p>
      </>}
    </div>
  );
}
