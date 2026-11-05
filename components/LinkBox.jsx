// List B #7: one "paste a link" box for every add-artist, add-song and add-sound spot. Paste (or tap
// "Paste") a Spotify, TikTok, Instagram or YouTube link: it looks the link up (POST /api/resolve-link),
// shows what it found, the artist's other profiles to confirm with one tap, and "Already on Hank's
// tracker" instead of a duplicate. Add hands the screen one result:
//   onAdd({ link: { platform, kind, url, key, id }, card: { name, artist, image, photo, releaseDate, isrc,
//           numbers: [{ label, value, approx }], catalog, preview }, links: { spotify, instagram, tiktok,
//           youtube } (the pasted one plus every profile confirmed), already })
// card.photo / card.image are lasting links only (Spotify, YouTube); TikTok and Instagram photos expire,
// so they're card.preview, shown here and never saved.
// Props: context  tracker | watchlist | radar | roster (the shared contract)
//        onAdd    as above
//        kinds    the link kinds this spot takes: ["song"], ["sound"], default people (artist/profile/channel)
//        addLabel the button ("Add", "Fill in"); allowDuplicate: a song already on someone's page can still
//        be filled in (co-writers share songs); compact: no "Paste" word on the button (narrow forms)
// The other-profiles suggestions show only in a box that takes people (a song form has nowhere to keep them).
// r10 (A&R lists, home-audit A5-A10): listMode = the A&R lists' box: a 30 / 60 / 90 chooser (a roster artist never
// expires), "Add to my list", and the already lines decide the button: on your list -> Open it (onOpen, nothing is
// added); on someone else's -> Add my name too (the same row). Everywhere: a card with no name shows a name field
// (Add waits for it, nothing is saved as "Spotify artist"), and a lookup that failed says so. onAdd also gets days.
// Mobile first: one column, 44px taps, nothing wider than the screen at 390px.
import React, { useEffect, useRef, useState } from "react";
import { ClipboardPaste, Check, X, RefreshCw, AlertTriangle } from "lucide-react";
import { parseLink, kindLabel, wrongKind, PERSON_KINDS, PLATFORM_LABEL } from "../lib/links/parse";

const fmtN = (n) => (n == null ? "—" : Number(n).toLocaleString("en-US"));
const short = (n) => (n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : fmtN(n));
const PH = {
  song: "Paste a Spotify song link",
  sound: "Paste a TikTok sound link",
  people: "Paste a Spotify, Instagram, TikTok or YouTube link",
};

// r10 fix: a lookup that can't reach the server (weak signal, a timeout, offline) says so in plain words, with Try
// again and "type the name instead", never the browser's "Failed to fetch"
export const NET_ERROR = "Couldn't reach the lookup. Check your connection.";
async function ask(body) {
  let r;
  try {
    r = await fetch("/api/resolve-link", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "defied-site" }, body: JSON.stringify(body), signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(25000) : undefined });
  } catch { throw Object.assign(new Error(NET_ERROR), { net: true }); }
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new Error(j?.error || "Couldn't look that link up just now.");
  return j;
}

export default function LinkBox({ context = "roster", onAdd, kinds, addLabel = "Add", allowDuplicate = false, placeholder, autoFocus = false, compact = false, busy: outerBusy = false, listMode = false, onOpen }) {
  const take = kinds?.length ? kinds : PERSON_KINDS;
  const [text, setText] = useState("");
  const [st, setSt] = useState({ state: "idle" }); // idle | looking | card | error
  const [more, setMore] = useState(null); // the paid step: null | "looking" | "done" | { error }
  const [yes, setYes] = useState({}); // confirmed suggestions, by url
  const [clipErr, setClipErr] = useState("");
  const [typed, setTyped] = useState(""); // the name, when the link didn't give one
  const [days, setDays] = useState(30);
  const [retry, setRetry] = useState(0); // "Try again" after a lookup couldn't reach the server
  const seq = useRef(0);
  const input = useRef(null);
  const ph = placeholder || (take.includes("song") && take.length === 1 ? PH.song : take.includes("sound") && take.length === 1 ? PH.sound : PH.people);

  // look it up as soon as it reads as a link (typing, pasting, the Paste button)
  useEffect(() => {
    const v = text.trim();
    setYes({}); setMore(null); setTyped("");
    if (!v) { setSt({ state: "idle" }); return undefined; }
    const l = parseLink(v);
    if (!l) { setSt(/^(https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,}\/)/i.test(v) ? { state: "error", error: "Paste a Spotify, TikTok, Instagram or YouTube link." } : { state: "idle" }); return undefined; }
    const wrong = !l.short && wrongKind(l, take);
    if (wrong) { setSt({ state: "error", error: wrong }); return undefined; }
    const my = ++seq.current;
    setSt({ state: "looking", label: l.short ? "Link" : kindLabel(l) });
    const t = setTimeout(async () => {
      let r;
      try { r = await ask({ url: v, context, kinds: take }); } catch (e) { if (my === seq.current) setSt({ state: "error", error: e.message, net: !!e.net, link: l }); return; }
      if (my !== seq.current) return;
      if (!r.ok) { setSt({ state: "error", error: r.error }); return; }
      setSt({ state: "card", r });
      if (r.paid?.needed) paidStep(v, my, 0);
    }, 300);
    return () => clearTimeout(t);
  }, [text, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  // TikTok / Instagram (and a Spotify artist's followers): Apify, a few seconds; the card is usable meanwhile
  const paidStep = async (v, my, tries) => {
    setMore("looking");
    let r;
    try { r = await ask({ url: v, context, kinds: take, paid: true }); } catch (e) { if (my === seq.current) setMore({ error: e.message }); return; }
    if (my !== seq.current) return;
    if (r.ok && r.paid?.pending && tries < 4) { setTimeout(() => paidStep(v, my, tries + 1), 4000); return; }
    if (!r.ok) { setMore({ error: r.error }); return; }
    setSt({ state: "card", r });
    setMore(r.paid?.error || r.paid?.off ? { error: r.paid.error || r.paid.off } : r.paid?.pending ? { error: `${PLATFORM_LABEL[r.link.platform]} is slow right now. Add them now; the numbers follow on the next update.` } : "done");
  };

  const paste = async () => {
    setClipErr("");
    try {
      const v = await navigator.clipboard.readText();
      if (!String(v || "").trim()) { setClipErr("The clipboard is empty. Copy the link first."); return; }
      setText(String(v).trim());
    } catch {
      setClipErr("Your browser didn't let us read the clipboard. Long-press the box and choose Paste.");
      input.current?.focus();
    }
  };
  const clear = () => { seq.current++; setText(""); setSt({ state: "idle" }); setMore(null); setYes({}); setTyped(""); input.current?.focus(); };

  const r = st.state === "card" ? st.r : null;
  const c = r?.card || {};
  const al = r?.already || [];
  const mineHit = al.find((a) => a.state === "mine"), otherHit = al.find((a) => a.state === "other"), rosterHit = al.find((a) => a.state === "roster");
  // the lists: never a second row (yours: Open it; someone else's: Add my name too). Elsewhere: any place that keeps it stops a duplicate.
  const blocked = listMode ? !!mineHit : al.some((a) => a.state !== "removed" && a.state !== "info") && !allowDuplicate;
  const links = r ? { ...r.links, ...Object.fromEntries(Object.entries(yes).filter(([, s]) => s).map(([, s]) => [s.platform, s.url])) } : {};
  const isSound = r?.link?.kind === "sound";
  const needName = !!r && !c.name && !isSound && more !== "looking";
  const canAdd = !!r && !blocked && (!needName || !!typed.trim());
  const add = () => { if (canAdd) { onAdd?.({ link: r.link, card: { ...c, name: c.name || typed.trim() }, links, already: al, days: rosterHit ? null : days }); clear(); } };
  const addWord = listMode ? (otherHit ? "Add my name too" : "Add to my list") : addLabel;
  const nums = (c.numbers || []).slice(0, 4);

  return (
    <div className="lb" data-linkbox={context} data-lb-state={st.state}>
      <style>{CSS}</style>
      <div className="sp-row lb-row">
        <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder={ph} aria-label={ph} inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} autoFocus={autoFocus} data-lb-input
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (canAdd) add(); else if (mineHit && onOpen) { onOpen(mineHit); clear(); } } }} />
        {text ? <button type="button" className="btn ghost sm lb-tap" onClick={clear} aria-label="Clear the link" data-lb-clear><X size={15} /></button>
          : <button type="button" className="btn ghost sm lb-tap" onClick={paste} data-lb-paste aria-label="Paste from clipboard"><ClipboardPaste size={15} />{!compact && <span>Paste</span>}</button>}
      </div>
      {clipErr && <p className="hint" data-lb-clip-err>{clipErr}</p>}
      {st.state === "looking" && <p className="hint lb-wait" data-lb-looking><RefreshCw size={12} className="spin" /> Looking up the {st.label}…</p>}
      {st.state === "error" && <p className="hint err-text" role="alert" data-lb-error={st.net ? "net" : ""}>{st.error}</p>}
      {st.state === "error" && st.net && (
        <p className="lb-net" data-lb-net>
          <button type="button" className="btn sm lb-tap" onClick={() => setRetry((n) => n + 1)} data-lb-retry><RefreshCw size={13} /> Try again</button>
          {!st.link?.short && <button type="button" className="btn ghost sm lb-tap" onClick={() => setSt({ state: "card", r: { ok: true, offline: true, link: st.link, card: {}, links: { [st.link.platform]: st.link.url }, already: [] } })} data-lb-type-name>Type the name instead</button>}
        </p>
      )}
      {r && (
        <div className="lb-card" data-lb-card data-lb-kind={`${r.link.platform}:${r.link.kind}`}>
          <div className="lb-main">
            {c.image || c.preview ? <img className={`lb-img${r.link.kind === "song" || r.link.kind === "sound" || r.link.kind === "video" ? " sq" : ""}`} src={c.image || c.preview} alt="" referrerPolicy="no-referrer" />
              : <span className="lb-img lb-img-none" aria-hidden="true">{(c.name || "?").replace(/^@/, "").slice(0, 1).toUpperCase()}</span>}
            <span className="lb-text">
              <strong data-lb-name>{c.name || (more === "looking" ? "Reading their profile…" : "No name found: type it below")}</strong>
              <span className="lb-sub">{[r.link.label, c.artist, c.releaseDate && `released ${c.releaseDate}`].filter(Boolean).join(" · ")}</span>
            </span>
          </div>
          {(nums.length > 0 || c.catalog || c.isrc) && (
            <div className="lb-nums" data-lb-nums>
              {nums.map((n) => <span key={n.label} className="lb-num" title={`${fmtN(n.value)}${n.on ? ` on ${n.on}` : ""}`}><b>{n.approx ? "about " : ""}{short(n.value)}</b> {n.label}</span>)}
              {c.catalog && <span className="lb-num" data-lb-catalog><b>{c.catalog.releases}{c.catalog.more ? "+" : ""}</b> release{c.catalog.releases === 1 ? "" : "s"} on Spotify{c.catalog.latest?.name ? `, latest ${c.catalog.latest.name}${c.catalog.latest.releaseDate ? ` (${c.catalog.latest.releaseDate})` : ""}` : ""}</span>}
              {c.isrc && <span className="lb-num">ISRC <b>{c.isrc}</b></span>}
            </div>
          )}
          {needName && (
            <label className="lb-namefld"><span>{r.link.kind === "song" ? "Song title" : "Their name"}</span>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={r.link.kind === "song" ? "Type the song's title" : "Type their name"} data-lb-typed-name
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (canAdd) add(); } }} />
            </label>
          )}
          {/* a miss with no name: type it in. A miss after the name was read (only the paid numbers failed): say which
              numbers, once (not "type the name", and not Apify's own error line too) */}
          {r.missed?.length > 0 && (c.name
            ? <p className="hint" data-lb-missed>Couldn't read {r.paid?.what || "their numbers"} on {r.missed.join(" and ")} just now. You can still add them; try again in a minute for the numbers.</p>
            : <p className="hint err-text" data-lb-missed>Couldn't read {r.missed.join(" and ")} just now{r.error ? ` (${r.error.replace(/\.$/, "")})` : ""}. Type the name or try again.</p>)}
          {more === "looking" && <p className="hint lb-wait" data-lb-more><RefreshCw size={12} className="spin" /> Reading {r.paid?.what || "their numbers"} on {PLATFORM_LABEL[r.link.platform]}…</p>}
          {more?.error && !(r.missed?.length > 0 && c.name) && <p className="hint" data-lb-more-err>{more.error}</p>}
          {!more && r.paid?.off && <p className="hint" data-lb-off>{r.paid.off}</p>}
          {r.paid?.cost?.line && <p className="hint" data-lb-cost>{r.paid.cost.line}</p>}
          {al.length > 0 && (
            <p className={`lb-already${blocked || otherHit ? "" : " soft"}`} data-lb-already={al.map((a) => a.state).join(" ")} role="status"><AlertTriangle size={14} /> {al.map((a) => a.text).join(" · ")}</p>
          )}
          {r.suggestions?.length > 0 && !blocked && take.some((k) => PERSON_KINDS.includes(k)) && (
            <div className="lb-sugg" data-lb-suggestions>
              <span className="lb-sugg-h">Their other profiles? Tap the ones that are them.</span>
              {r.suggestions.map((s) => {
                const on = !!yes[s.url];
                return (
                  <button type="button" key={s.url} className={`lb-s${on ? " on" : ""}`} aria-pressed={on} data-lb-suggestion={s.platform} onClick={() => setYes((y) => ({ ...y, [s.url]: on ? null : s }))}>
                    <span className="lb-s-plat">{PLATFORM_LABEL[s.platform]}</span>
                    <span className="lb-s-t"><b>{s.name || s.url.replace(/^https:\/\/(www\.|open\.)?/, "")}</b><em>{s.why}</em></span>
                    <span className="lb-s-yes">{on ? <><Check size={14} /> Yes</> : "That's them"}</span>
                  </button>
                );
              })}
            </div>
          )}
          {listMode && !blocked && (rosterHit
            ? <p className="hint lb-days" data-lb-days="roster">Roster · never expires</p>
            : (
              <div className="lb-days" role="radiogroup" aria-label="How long to track it" data-lb-days={days}>
                <span>Track for</span>
                {[30, 60, 90].map((d) => <button type="button" key={d} role="radio" aria-checked={days === d} className={days === d ? "on" : ""} onClick={() => setDays(d)} data-lb-day={d}>{d} days</button>)}
              </div>
            ))}
          {!blocked && (
            <div className="lb-foot">
              <button type="button" className="btn sm lb-add" onClick={add} disabled={outerBusy || !canAdd} data-lb-add>{addWord}</button>
              <button type="button" className="btn ghost sm lb-tap" onClick={clear}>Cancel</button>
            </div>
          )}
          {blocked && listMode && mineHit && (
            <div className="lb-foot">
              <button type="button" className="btn sm lb-add" onClick={() => { onOpen?.(mineHit); clear(); }} data-lb-open>Open it</button>
              <button type="button" className="btn ghost sm lb-tap" onClick={clear}>Cancel</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const CSS = `
.lb-net{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 0}
.lb{display:flex;flex-direction:column;gap:8px;min-width:0;max-width:100%}
.lb-row{display:flex;gap:8px;min-width:0}
.lb-row input{flex:1;min-width:0}
.lb .lb-tap{min-height:44px;min-width:44px;justify-content:center;flex-shrink:0}
.lb-wait{display:inline-flex;align-items:center;gap:6px}
.lb-card{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--d-line-2,#2a2a2c);border-radius:12px;background:var(--d-s1,#0b0b0c);min-width:0}
.lb-main{display:flex;align-items:center;gap:12px;min-width:0}
.lb-img{width:52px;height:52px;border-radius:50%;object-fit:cover;flex-shrink:0;background:var(--d-s3,#161618)}
.lb-img.sq{border-radius:8px}
.lb-img-none{display:inline-flex;align-items:center;justify-content:center;font-weight:600;color:var(--d-ink-3,#a3a3a3)}
.lb-text{display:flex;flex-direction:column;min-width:0;gap:2px}
.lb-text strong{font-size:15px;color:var(--d-ink,#f5f5f5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lb-sub{font-size:12.5px;color:var(--d-ink-4,#8a8a8a);overflow-wrap:anywhere}
.lb-nums{display:flex;flex-wrap:wrap;gap:6px 14px}
.lb-num{font-size:12.5px;color:var(--d-ink-3,#a3a3a3)}
.lb-num b{color:var(--d-ink,#f5f5f5);font-weight:600}
.lb-already{display:flex;gap:8px;align-items:flex-start;margin:0;padding:10px 12px;border-radius:10px;font-size:13px;line-height:1.4;color:var(--d-warn,#e0b48f);background:var(--d-warn-bg,rgba(224,180,143,.08));border:1px solid var(--d-warn-line,rgba(224,180,143,.24))}
.lb-already svg{flex-shrink:0;margin-top:2px}
.lb-already.soft{color:var(--d-ink-3,#a3a3a3);background:transparent;border-color:var(--d-line-2,#2a2a2c)}
.lb-sugg{display:flex;flex-direction:column;gap:6px}
.lb-sugg-h{font-size:12.5px;color:var(--d-ink-4,#8a8a8a)}
.lb-s{display:flex;align-items:center;gap:10px;min-height:44px;padding:8px 10px;border:1px solid var(--d-line-2,#2a2a2c);border-radius:10px;background:transparent;color:var(--d-ink,#f5f5f5);text-align:left;font:inherit;cursor:pointer;min-width:0}
.lb-s.on{border-color:var(--d-pos-line,rgba(143,206,143,.24));background:var(--d-pos-bg,rgba(143,206,143,.08))}
.lb-s-plat{font-size:11.5px;color:var(--d-ink-4,#8a8a8a);width:64px;flex-shrink:0}
.lb-s-t{display:flex;flex-direction:column;min-width:0;flex:1}
.lb-s-t b{font-weight:500;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lb-s-t em{font-style:normal;font-size:12px;color:var(--d-ink-4,#8a8a8a)}
.lb-s-yes{font-size:12.5px;flex-shrink:0;display:inline-flex;align-items:center;gap:4px;color:var(--d-ink-3,#a3a3a3)}
.lb-s.on .lb-s-yes{color:var(--d-pos,#8fce8f)}
.lb-foot{display:flex;gap:8px;flex-wrap:wrap}
.lb-namefld{display:flex;flex-direction:column;gap:4px;font-size:12.5px;color:var(--d-ink-4,#8a8a8a)}
.lb-namefld input{min-height:44px}
.lb-days{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:0;font-size:12.5px;color:var(--d-ink-4,#8a8a8a)}
.lb-days button{min-height:44px;min-width:44px;padding:0 12px;border-radius:10px;border:1px solid var(--d-line-2,#2a2a2c);background:transparent;color:var(--d-ink-3,#a3a3a3);font:inherit;cursor:pointer}
.lb-days button.on{border-color:var(--d-ink,#f5f5f5);color:var(--d-ink,#f5f5f5)}
.lb-foot .btn{min-height:44px}
.lb-add{flex:1;justify-content:center}
.lb .btn.lb-add{background:var(--d-ink,#f5f5f5);color:#000;border-color:transparent}
@media (min-width:640px){.lb-add{flex:0 0 auto}}
`;
