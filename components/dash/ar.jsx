import { useState, useEffect, useMemo, useRef } from "react";
import { X, Plus, RefreshCw, AlertTriangle, CheckCircle2, TrendingUp } from "lucide-react";
import { ArTrackers } from "../ar/ArTrackers";
import { ArRadar } from "../ar/ArRadar";
import { swrJson, peekJson } from "../ui/fetch-cache";
import { ProspectForm } from "./advance";
import { IsrcPicks, dayRange, daysSince, shortDay, useMedia } from "./helpers";
import { Area, Avatar, Field, fmt, money, revealChip, useEscape } from "./ui";
import { AskCard, useDirtyGuard } from "../portal/ask";
import { arPgCache } from "../shared/dash-caches";
import { ExtLink } from "../shared/ui";
// (list B #11) the pills and stages Home and Publishing draw too live in leaf modules; still exported from here
import { WowPill, pctText, clock } from "./chips";
import { AR_STAGES, StagePill, stageLabel } from "./ar-stages";
export { AR_STAGES, StagePill } from "./ar-stages";
export { WowPill, clock } from "./chips";

/* staff: A&R — outreach pipeline + advance calculator, both backed by the
   OUTREACH / ADVANCE CALCULATOR sheet tabs. Deliberately isolated from
   MASTER/roster totals and from db/commit(). Each prospect has a permanent
   id (ar_prospects); /api/ar-write aims every save at that id, sends the
   values this page showed as `expect`, and refuses with a plain reason when
   the sheet changed meanwhile, so a save can never land on the wrong row. */
export async function arWrite(body) {
  const res = await fetch("/api/ar-write", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  // a 409 carries what the panel needs to say it plainly: the clashing fields, or "reload"
  if (!res.ok) throw Object.assign(new Error(data.error || "Save failed."), { status: res.status, conflict: data.conflict, reload: !!data.reload });
  return data;
}

// the OUTREACH / ADVANCE CALCULATOR / ASSUMPTIONS read behind A&R's Outreach and Publishing's
// Advance calculator: loaded when either one opens, reloaded after each of their saves
export function useArData() {
  const [data, setData] = useState(() => peekJson("/api/ar-data") || null);
  const [err, setErr] = useState(null);
  const load = () => swrJson("/api/ar-data", (d) => { setData(d); setErr(null); }, { anyStatus: true })
    .then((d) => { if (d?.error) throw new Error(d.error); })
    .catch((e) => setErr(e.message || "Couldn't load A&R data."));
  const retry = () => { setErr(null); load(); }; // shows "Loading…" again until it answers
  useEffect(() => { load(); }, []);
  return { data, err, load, retry };
}
export const ArDataError = ({ err, retry }) => <p className="hint err-text mb"><span>{err}</span> <button className="btn ghost sm" onClick={retry}>Try again</button></p>;

// A&R: Summary (default) · Watchlist · Board. One read of the pub sheet (useArData) and one of
// Postgres (/api/ar) serve all three; the sub-page last opened is remembered for the session.
const AR_SECS = [["summary", "Summary"], ["watch", "Watchlist"], ["board", "Board"], ["trackers", "Trackers"], ["radar", "Radar"]];
const AR_SEC_KEY = "dm-ar-sec";
export function useArAll() {
  const sheet = useArData(); // the sheet read: money, cells, rows free
  const [pg, setPg] = useState(() => arPgCache.d); // /api/ar: Postgres only, so the pages draw before the sheet answers
  const [pgErr, setPgErr] = useState(null);
  const loadPg = (force = true) => {
    if (force === false && arPgCache.d && Date.now() - arPgCache.at < 30000) return Promise.resolve(setPg(arPgCache.d));
    return fetch("/api/ar").then((r) => r.json())
      .then((d) => { if (d.error) throw new Error(d.error); arPgCache.d = d; arPgCache.at = Date.now(); setPg(d); setPgErr(null); })
      .catch((e) => setPgErr(e.message || "Couldn't load the A&R data."));
  };
  useEffect(() => { loadPg(false); }, []);
  // each sheet read can bring in or settle prospects (the first one imports them all), so the
  // Postgres side is read again once it lands
  useEffect(() => { if (sheet.data) loadPg(); }, [sheet.data]);
  return { ...sheet, pg, pgErr, loadPg };
}
// the Dashboard's This week › A&R rows: "watch:open:<key>" (their panel) / "watch:flash:<key>" (a row only the old Artist Tracker had)
// A&R's own pages have their own addresses (list B #11): /dashboard/ar/summary, /watch, /board, /trackers, /radar
const arSecOf = (sub) => ({ summary: "summary", trackers: "trackers", tracker: "trackers", radar: "radar", watchlist: "watch", watch: "watch", board: "board" })[sub] || null;
const arWatchAt = (sub) => { const m = /^watch:(open|flash):(.+)$/.exec(sub || ""); return m ? { pill: "people", [m[1]]: m[2] } : null; };
export function ARAdmin({ onGo, sub, onSub, chip = null }) {
  const [sec, setSecState] = useState(() => {
    if (arWatchAt(sub)) return "watch";
    if (arSecOf(sub)) return arSecOf(sub);
    try { const s = sessionStorage.getItem(AR_SEC_KEY); return AR_SECS.some(([id]) => id === s) ? s : "summary"; } catch { return "summary"; }
  });
  const [watchAt, setWatchAt] = useState(() => arWatchAt(sub)); // where Summary sends the Watchlist: {pill, open}
  const setSec = (id, at = null) => { setSecState(id); setWatchAt(at); try { sessionStorage.setItem(AR_SEC_KEY, id); } catch { /* private mode */ } };
  // Back / Forward to another Dashboard row while A&R is open
  useEffect(() => { const at = arWatchAt(sub); if (at) setSec("watch", at); else if (arSecOf(sub)) setSec(arSecOf(sub)); }, [sub]); // eslint-disable-line react-hooks/exhaustive-deps
  const ar = useArAll();
  // each page opens on the latest from Postgres (another page may have added someone)
  const opened = useRef(false);
  useEffect(() => { if (opened.current) ar.loadPg(false); opened.current = true; }, [sec]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="ar">
      {/* the page's title first, as on Publishing and Website; each section says only its one line */}
      <div className="admin-head"><h2>A&amp;R</h2>{chip}</div>
      <div className="subnav">
        {AR_SECS.map(([id, label]) => (
          <button key={id} className={sec === id ? "subpill active" : "subpill"} onClick={(e) => { setSec(id); onSub?.(id); revealChip(e.currentTarget); }}>{label}</button>
        ))}
      </div>
      {sec === "summary" && <ArSummary ar={ar} onGo={onGo} goBoard={() => setSec("board")} goWatch={(at) => setSec("watch", at)} />}
      {sec === "board" && <ArBoard ar={ar} onGo={onGo} />}
      {sec === "watch" && <ArWatch key={JSON.stringify(watchAt)} ar={ar} onGo={onGo} at={watchAt} />}
      {sec === "trackers" && <ArTrackers />}
      {sec === "radar" && <ArRadar />}
    </div>
  );
}
const ArHead = ({ sub, children }) => (
  <div className="admin-head ar-head">
    <div className="ar-head-text"><p className="ar-sub">{sub}</p></div>
    {children && <div className="arb-head-actions">{children}</div>}
  </div>
);
const STAGE_OF_STATUS = { "Not Contacted": "reach", Researching: "reach", "": "reach", Contacted: "reached", "In Talks": "talking", "Offer Out": "offer", Signed: "signed", Passed: "passed" };
export const stageOfStatus = (s) => STAGE_OF_STATUS[String(s ?? "").trim()] || "other";
// the status a move saves: "To reach out" keeps Researching when that's what it was
export const statusForStage = (id, current) => (id === "passed" ? "Passed" : id === "reach" && String(current ?? "").trim() === "Researching" ? "Researching" : AR_STAGES.find((s) => s.id === id)?.status);
// a card can only be moved onto a real stage: "Other" is whatever was typed by hand, never a target
const canMoveTo = (id) => id === "passed" || AR_STAGES.some((s) => s.id === id);
// one step forward or back (Other and Passed step back into "To reach out")
const stepFrom = (id, d) => { const i = AR_STAGES.findIndex((s) => s.id === id); return i < 0 ? (d < 0 ? AR_STAGES[0] : null) : AR_STAGES[i + d] || null; };
export const wholeMoney = (n) => `$${fmt(Math.round(Number(n) || 0))}`;
const centsMoney = (n) => (Math.round(n * 100) % 100 ? money(n) : wholeMoney(n));
// stream counts in A&R, one rule everywhere (Board card, Producers tiles, panel, How we estimate): from a
// million, up to two decimals rounded half-up (28.9M · 14.45M · 1.48M), from a thousand whole K (845K)
export const bigNum = (n) => {
  const a = Math.abs(Number(n) || 0), s = n < 0 ? "-" : "";
  return a >= 1e6 ? `${s}${Math.round(a / 1e4) / 100}M` : a >= 1e3 ? `${s}${Math.round(a / 1e3)}K` : `${s}${fmt(Math.round(a))}`;
};
// someone we track by hand with no numbers yet (Passed is done, so it doesn't count): the "no numbers" filter
const noNums = (r) => r.ref?.type === "tracked" && r.current == null && r.stage !== "passed";
// a row's number in words: an artist's Spotify monthly listeners, a song's Spotify streams this week
const unitWords = (r, old = false) => (r.unit === "listeners" ? "monthly listeners" : old ? "streams that week" : "streams this week");
const UpDown = ({ r }) => (r.current == null ? <span className="muted">No numbers yet</span>
  : r.changePct == null ? <span className="muted-dash" title="No last week to compare">—</span>
  : <WowPill pct={r.changePct} />);
// a week's span moved by whole days ("compared with Oct 16 – 22" is the 7 days before)
const shiftDay = (iso, d) => { const t = new Date(`${iso}T12:00:00`); t.setDate(t.getDate() + d); return t.toLocaleDateString("en-CA"); };

// Everyone on the Board: producers (prospects, their stage from the sheet) and the tracked artists
// put on the board (stage not null). Built the same way for Summary, the Board and the Watchlist.
export function arCards(data, pg) {
  const sheetById = Object.fromEntries((data?.prospects || []).map((p) => [p.id, p]));
  const live = (pg?.prospects || []).filter((p) => !p.removedAt);
  const producers = live.map((p) => {
    const s = sheetById[p.id], status = s?.status ?? p.status;
    return { key: `p:${p.id}`, role: "producer", id: p.id, name: p.name, contact: s?.contact || "", status, stage: stageOfStatus(status), followUp: p.followUp,
      clientId: p.clientId, s, lastContact: s?.lastContact?.date || null, lastText: s?.lastContact?.text || "" };
  });
  const artists = (pg?.tracked || []).filter((t) => t.kind === "artist" && t.stage).map((t) => ({
    key: `t:${t.id}`, role: "artist", id: t.id, name: t.name, contact: t.handle, status: "", stage: t.stage, followUp: null, t, lastContact: t.lastContact, lastText: "",
  }));
  return { cards: [...producers, ...artists], sheetById, live };
}

// the panels the Board and the Watchlist open (a producer's, a tracked artist's or song's, the Add
// form); focus goes back to whatever opened it once it closes
function usePanel() {
  const [open, setOpen] = useState(null);
  const back = useRef(null);
  const openPanel = (o, e) => { back.current = e?.currentTarget?.closest?.("[data-focus]")?.dataset.focus || null; setOpen(o); };
  const closePanel = () => {
    setOpen(null);
    const k = back.current;
    if (k) setTimeout(() => document.querySelector(`[data-focus="${CSS.escape(k)}"]`)?.focus(), 0);
  };
  return { open, openPanel, closePanel };
}
export function ArPanels({ ar, open, openPanel, closePanel, onGo }) {
  const { data, pg, load, loadPg } = ar;
  const [kind, setKind] = useState(open?.kind || "producer");
  useEffect(() => { if (open?.type === "add") setKind(open.kind || "producer"); }, [open]);
  if (!open) return null;
  const canSave = !!data && data.sheet?.ok !== false;
  // one tap picks what's being added, and the form's title follows it
  const picker = (
    <span className="gainer-tabs ar-kind" role="tablist" aria-label="What are you adding?">
      {[["artist", "Artist"], ["producer", "Producer"], ["song", "Song"]].map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={kind === id} className={kind === id ? "active" : ""} onClick={() => setKind(id)}>{label}</button>
      ))}
    </span>
  );
  const addTitle = open.prefill?.name ? `Add details for ${open.prefill.name}` : kind === "artist" ? "Add an artist" : kind === "song" ? "Add a song" : "Add a producer";
  if (open.type === "add" && kind === "producer") {
    return (
      <ProspectForm title={addTitle} picker={picker} blendedRate={data?.assumptions?.blendedRate ?? 0} assume={data?.assumptions} canSave={canSave}
        onClose={closePanel} onChanged={async (r) => { await load(); if (r?.prospect?.id) openPanel({ type: "prospect", id: r.prospect.id }); else closePanel(); }} />
    );
  }
  if (open.type === "add" || open.type === "tracked") {
    const t = open.type === "tracked" ? (pg?.tracked || []).find((x) => x.id === open.id) : null;
    if (open.type === "tracked" && !t) return null;
    return <ArTrackedForm key={t?.id || kind} kind={t?.kind || kind} t={t} prefill={open.prefill} picker={t ? null : picker} title={addTitle} pg={pg}
      onClose={closePanel} onSaved={async () => { await loadPg(); closePanel(); }} />;
  }
  const s = (data?.prospects || []).find((p) => p.id === open.id);
  const p = (pg?.prospects || []).find((x) => x.id === open.id);
  if (!s || !data) return null;
  const mine = (pg?.watch?.people || []).find((r) => r.ref?.id === open.id);
  return (
    <ProspectForm key={s.id} prospect={s} pg={p} blendedRate={data.assumptions.blendedRate} assume={data.assumptions} canSave={canSave} reload={load}
      onClose={closePanel} onChanged={async () => { await load(); closePanel(); }}
      extra={(
        <div className="ar-panel-extra">
          <p className="fld-label mb">Their numbers</p>
          {mine?.current != null
            ? <p className="ar-nums">{fmt(mine.current)} {unitWords(mine)} <UpDown r={mine} />{mine.lum?.atd != null && ` · Luminate: ${fmt(mine.lum.atd)} all-time on ${shortDay(mine.lum.on)}`}</p>
            : <p className="muted ar-nums">No numbers yet: they come in once an artist on the Watchlist with their name has a Spotify link.</p>}
          <button className="btn ghost sm" onClick={() => onGo("catalog", `advance:${s.id}`)}>Calculate an advance</button>
        </div>
      )} />
  );
}

// Add or edit a tracked artist or song: saved in the dashboard's database only, never the sheet, and
// no money anywhere (only producers have estimates)
function ArTrackedForm({ kind, t, prefill, picker, title, pg, onClose, onSaved }) {
  const isNew = !t;
  // (luminateId: an Artist / Song Tracker row this one was added from, so its numbers and history stay with it)
  const init = t || { name: prefill?.name || "", artist: prefill?.artist || "", handle: "", spotify: prefill?.spotify || "", isrc: "", genre: "", notes: "", luminateId: prefill?.luminateId || "", personId: null, stage: null, photo: "" };
  const [f, setF] = useState({ ...init, stage: init.stage || "", photo: init.photo || "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const dirty = ["name", "artist", "handle", "spotify", "isrc", "genre", "notes", "luminateId", "personId", "stage"].some((k) => String(f[k] ?? "") !== String((k === "stage" ? init.stage || "" : init[k]) ?? ""));
  const guard = useDirtyGuard(dirty, onClose);
  useEscape(guard.tryClose, !busy);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const type = kind === "song" ? "song" : "artist";
  // Add artist (r7 C2): paste a Spotify or Instagram link and the name, photo and genre fill in (GET
  // /api/ar?lookup=); then Watching or Signed. Their numbers follow their Spotify link.
  const simple = isNew && type === "artist";
  const [link, setLink] = useState("");
  const [look, setLook] = useState(null); // null | { busy: true } | the lookup's answer
  const auto = useRef({}); // what the last lookup filled in: replaced by the next one unless typed over
  useEffect(() => {
    const v = link.trim();
    if (!simple || !v) { setLook(null); return undefined; }
    setLook((l) => (l?.ok ? l : null)); // a filled-in card stays while typing; an old error doesn't
    let gone = false;
    const timer = setTimeout(async () => {
      if (!/(spotify\.com|spotify\.link|instagram\.com|instagr\.am|tiktok\.com)\//i.test(v)) { setLook({ ok: false, error: "Paste a Spotify artist link or an Instagram or TikTok profile." }); return; }
      setLook({ busy: true });
      const r = await fetch(`/api/ar?lookup=${encodeURIComponent(v)}`, { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (gone) return;
      if (!r) { setLook({ ok: false, error: "Couldn't look that up just now. Type their details in." }); return; }
      setLook(r);
      if (!r.ok) return;
      setF((x) => {
        const keep = (k) => x[k].trim() && x[k] !== auto.current[k];
        const next = { ...x, name: keep("name") || !r.name ? x.name : r.name, genre: keep("genre") || !r.genre ? x.genre : r.genre, photo: r.photo || x.photo };
        if (r.spotify) next.spotify = r.spotify;
        if (r.handle) next.handle = r.handle;
        auto.current = { name: next.name, genre: next.genre };
        return next;
      });
    }, 350);
    return () => { gone = true; clearTimeout(timer); };
  }, [link, simple]);
  const people = (pg?.watch?.people || []).filter((r) => r.ref);
  const save = async () => {
    setBusy(true); setErr(null);
    const body = { name: f.name, artist: f.artist, handle: f.handle, spotify: f.spotify, isrc: f.isrc, genre: f.genre, notes: f.notes, luminateId: f.luminateId, personId: f.personId || null, ...(type === "artist" && { photo: f.photo || "" }) };
    try {
      if (isNew) await arPost({ action: "addTracked", kind: type, ...body, stage: type === "artist" ? f.stage || null : null });
      else {
        await arPost({ action: "editTracked", id: t.id, ...body });
        if (type === "artist" && (f.stage || null) !== (t.stage || null)) await arPost({ action: "stageTracked", id: t.id, stage: f.stage || null });
      }
      await onSaved();
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  // an A&R song the ISRC finder wasn't sure about: one tap saves the right one
  const pickIsrc = async (c) => {
    setBusy(true); setErr(null);
    try { await arPost({ action: "editTracked", id: t.id, isrc: c.isrc }); await onSaved(); } catch (e) { setErr(e.message); setBusy(false); }
  };
  const [askStop, setAskStop] = useState(false);
  const remove = async () => {
    setAskStop(false); setBusy(true);
    try { await arPost({ action: "removeTracked", id: t.id }); await onSaved(); } catch (e) { setErr(e.message); setBusy(false); }
  };
  const whereFrom = (r) => (r.kind === "spotify" ? "from Spotify" : `${r.kind === "instagram" ? "Instagram" : "TikTok"} ${r.handle}`);
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && !busy && guard.tryClose()}>
      <div className="modal-card ar-tracked-form" data-kind={type}>
        <div className="modal-head"><h3>{isNew ? title || "Add an artist" : t.name}</h3><button onClick={guard.tryClose} aria-label="Close" disabled={busy}><X size={18} /></button></div>
        <div className="modal-body">
          {picker}
          {/* a row only the old Tracker had: its numbers first, from the row that was clicked */}
          {isNew && prefill?.nums && (
            <p className="ar-nums ar-prefill-nums">{fmt(prefill.nums.thisWeek ?? 0)} {unitWords(prefill.nums)}{prefill.nums.wowPct != null && ` · ${pctText(prefill.nums.wowPct)} vs a week ago`}{prefill.nums.atd != null && ` · ${bigNum(prefill.nums.atd)} all-time`}</p>
          )}
          {isNew && prefill?.name && !simple && <p className="hint mb">Tracked from the old Luminate {type === "song" ? "Song" : "Artist"} Tracker. Add a handle, or put them on the board.</p>}
          {err && <p className="hint err-text" role="alert">{err}</p>}
          {simple && <>
            <label className="fld"><span>Spotify or Instagram link</span>
              <input data-ar-link value={link} onChange={(e) => setLink(e.target.value)} placeholder="open.spotify.com/artist/… or instagram.com/…" aria-label="Spotify or Instagram link" autoFocus inputMode="url" />
            </label>
            {look?.busy && <p className="hint ar-look-wait"><RefreshCw size={12} className="spin" /> Looking them up…</p>}
            {look && !look.busy && !look.ok && <p className="hint err-text" data-ar-look-err>{look.error}</p>}
            {look?.ok && (
              <div className="ar-look" data-ar-look>
                <Avatar src={f.photo} name={f.name || "?"} size={48} />
                <span className="ar-look-main">
                  <strong>{f.name || "We couldn't read their name: type it below"}</strong>
                  <span>{[f.genre, look.fans != null && `${fmt(look.fans)} Deezer fans`, whereFrom(look)].filter(Boolean).join(" · ")}</span>
                </span>
              </div>
            )}
          </>}
          <Field label={type === "song" ? "Song title" : "Name"} value={f.name} onChange={set("name")} />
          {simple && (
            <div className="fld"><span>Watching or signed?</span>
              <span className="gainer-tabs ar-watch-signed" role="tablist" aria-label="Watching or signed">
                {[["", "Watching"], ["signed", "Signed"]].map(([id, label]) => (
                  <button key={label} type="button" role="tab" aria-selected={f.stage === id} className={f.stage === id ? "active" : ""} data-stage-pick={id || "watching"} onClick={() => setF({ ...f, stage: id })}>{label}</button>
                ))}
              </span>
            </div>
          )}
          {type === "artist" && !simple && (
            <label className="fld"><span>Stage</span>
              <select value={f.stage} onChange={set("stage")} aria-label="Stage">
                <option value="">Just watching (not on the Board)</option>
                {AR_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                <option value="passed">Passed</option>
              </select>
            </label>
          )}
          {type === "song" && <Field label="Artist" value={f.artist} onChange={set("artist")} />}
          {type === "artist" && !simple && <Field label="Instagram or TikTok" value={f.handle} onChange={set("handle")} />}
          {!simple && <Field label="Spotify link" value={f.spotify} onChange={set("spotify")} />}
          {type === "song" && <Field label="ISRC (if you have it)" value={f.isrc} onChange={set("isrc")} />}
          {type === "song" && t?.isrcCandidates?.length > 0 && !f.isrc && <IsrcPicks list={t.isrcCandidates} busy={busy} onPick={pickIsrc} />}
          {type === "artist" && <Field label="Genre" value={f.genre} onChange={set("genre")} />}
          {type === "song" && (
            <label className="fld"><span>Tied to (optional)</span>
              <select value={f.personId || ""} onChange={set("personId")} aria-label="Tied to">
                <option value="">Nobody</option>
                {people.map((r) => <option key={r.key} value={r.ref.id}>{r.name}</option>)}
              </select>
            </label>
          )}
          <Area label="Notes" value={f.notes} onChange={set("notes")} />
          <p className="hint" data-ar-form-line>{simple ? "Their Spotify link brings in their numbers. No Spotify artist page yet? Add their songs: we add them up here." : "Saved here in the dashboard only. Nothing goes into the pub sheet."}</p>
        </div>
        {guard.bar}
        <div className="modal-foot">
          {!isNew && <button className="btn ghost sm err-text arb-remove" onClick={() => setAskStop(true)} disabled={busy}>Stop tracking</button>}
          <button className="btn ghost sm" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn sm" onClick={save} disabled={busy || look?.busy || !f.name.trim()}>{busy ? "Saving…" : isNew ? "Save" : "Save changes"}</button>
        </div>
      </div>
      {askStop && (
        <AskCard title={`Stop tracking ${t.name}?`} goLabel="Stop tracking" busyLabel="Stopping…" go={remove} onClose={() => setAskStop(false)}>
          <p>Nothing in the pub sheet changes.</p>
        </AskCard>
      )}
    </div>
  );
}


// Summary: the top gainers in the A&R lists and the pipeline at a glance (its to-dos are To do's, r7)
function ArSummary({ ar, onGo, goBoard, goWatch }) {
  const { data, pg, pgErr, loadPg } = ar;
  const watch = pg?.watch;
  const { cards } = arCards(data, pg);
  const phone = useMedia("(max-width: 699px)");
  const [gtab, setGtab] = useState("people"); // phones show one list at a time
  // ranked on the server by week-on-week % (watch.top: keys, ranked = shown with its %)
  const ranked = (list, keys) => (keys || []).map((k) => { const r = list.find((x) => x.key === k.key); return r && { ...r, ranked: k.ranked }; }).filter(Boolean);
  const people = ranked(watch?.people || [], watch?.top?.people), songs = ranked(watch?.songs || [], watch?.top?.songs);
  const to = watch?.period?.to;
  const old = to && daysSince(to) > 8;
  // its to-dos (follow-ups, ClickUp's A&R Tasks, the old Trackers' rows to find on Spotify) are To do's now (r7): the chip counts them
  const value = data?.totals?.totalValue;
  const stageN = (id) => cards.filter((c) => c.stage === id).length;
  // someone tracked here opens their panel on the Watchlist; a row only the old Artist Tracker had is just shown there
  const openGainer = (r, kind) => goWatch(r.ref ? { pill: kind, open: r.key } : { pill: kind, flash: r.key });
  const Gainers = ({ list, kind }) => (
    <div className="gainers ar-gainers" data-list={kind} data-wait={!pg ? "" : undefined}>
      <div className="attn-head"><TrendingUp size={15} /> {kind === "people" ? "People" : "Songs"}{watch?.periods?.[kind] && <span className="ar-dates"> · {dayRange(watch.periods[kind].from, watch.periods[kind].to)}</span>}</div>
      {!pg ? <p className="gainers-empty">Loading…</p> : !list.length && (watch?.[kind] || []).some((r) => r.wowPct != null) ? (
        <p className="gainers-empty">No rises this week.</p>
      ) : !list.length ? (
        <p className="gainers-empty">{kind === "people" ? "Nobody" : "No songs"} with a week of Spotify numbers yet.</p>
      ) : list.map((r, i) => {
        const pct = r.ranked && r.wowPct != null;
        const rose = pct && r.wowPct > 0;
        return (
          <button key={r.key} className="gainer" data-ranked={rose ? "" : undefined} data-fall={pct && !rose ? "" : undefined} onClick={() => openGainer(r, kind)}>
            <span className="gainer-n">{rose ? i + 1 : "·"}</span>
            <span className="lm-song-main"><strong>{r.name || r.title}</strong>
              {kind === "people"
                ? <span className="ar-g-sub">{r.role === "producer" ? "Producer" : "Artist"}{r.stage && <StagePill id={r.stage} />}</span>
                : r.artist && <span>{r.artist}</span>}
            </span>
            <span className="gainer-num" data-wow={pct ? (r.wowPct >= 0 ? "up" : "down") : "none"}>
              {pct && <WowPill pct={r.wowPct} big />}<em>{fmt(r.thisWeek)} {unitWords(r, old)}</em>
            </span>
          </button>
        );
      })}
    </div>
  );
  const tabs = [["people", "People", (watch?.people || []).length], ["songs", "Songs", (watch?.songs || []).length]];
  return (
    <div className="ar-summary">
      <ArHead sub="Who's up this week." />
      {pgErr && <ArDataError err={pgErr} retry={loadPg} />}
      {/* the pipeline at a glance: one coloured pill per stage, and the sheet's total value; opens the Board */}
      <button className="ar-strip" onClick={goBoard} aria-label="Open the Board">
        {AR_STAGES.map((st) => <StagePill key={st.id} id={st.id} n={pg ? stageN(st.id) : "–"} />)}
        {/* the sheet's total value: mostly the would-be cut of past earnings, so not "in play" money */}
        <span className="ar-strip-val">{value != null ? `≈ ${wholeMoney(value)} est. value` : !data && !ar.err ? "…" : "Open the Board"} →</span>
      </button>
      <div className="ar-sum-head">
        <h3 className="ar-h3">{old ? "Latest week" : "This week"} <span className="ar-h3-sub">· biggest % rise first</span></h3>
        <button className="inline-link" onClick={() => goWatch(null)}>See everyone →</button>
      </div>
      {phone && (
        <span className="gainer-tabs ar-gainer-toggle" role="tablist" aria-label="People or songs">
          {tabs.map(([id, label, n]) => <button key={id} role="tab" aria-selected={gtab === id} className={gtab === id ? "active" : ""} onClick={() => setGtab(id)}>{label} <span className="arb-n">{n}</span></button>)}
        </span>
      )}
      <div className="home-pair ar-gainer-pair">
        {(!phone || gtab === "people") && <Gainers list={people} kind="people" />}
        {(!phone || gtab === "songs") && <Gainers list={songs} kind="songs" />}
      </div>

    </div>
  );
}

// "Follow up Fri" (grey), "Follow up today" (amber), "2 days late" (red)
export function followChip(f) {
  if (!f?.on) return null;
  if (f.state === "overdue") return <span className="arb-chip neg">{f.daysLate === 1 ? "1 day late" : `${f.daysLate} days late`}</span>;
  if (f.state === "due") return <span className="arb-chip warn">Follow up today</span>;
  const days = (Date.parse(`${f.on}T12:00:00`) - Date.now()) / 864e5;
  return <span className="arb-chip">Follow up {days < 6 ? weekday(f.on) : shortDay(f.on)}</span>;
}

// Postgres-only A&R calls (/api/ar): merges, the first-run card, tracked artists and songs. They keep
// working while Sheets is down.
async function arPost(body) {
  const res = await fetch("/api/ar", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Save failed.");
  return data;
}

function ArBoard({ ar, onGo }) {
  const { data, err, load, retry, pg, pgErr, loadPg } = ar;
  const reload = () => load();
  const [view, setView] = useState("board");
  const [passedOnly, setPassedOnly] = useState(false);
  const [find, setFind] = useState("");
  const { open, openPanel, closePanel } = usePanel();
  const [moving, setMoving] = useState({}); // card key → the stage shown while its move saves; snaps back if refused
  const [flash, setFlash] = useState(null);
  const [showOff, setShowOff] = useState(false);
  const [showCheck, setShowCheck] = useState(false);
  const [more, setMore] = useState(false);
  const [quick, setQuick] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(null); // the card being dragged
  const [over, setOver] = useState(null); // the column it's over
  const [folds, setFolds] = useState({}); // phone: column → open (unset: only the first non-empty one is)
  // drag and drop on a desktop pointer only; on a phone the buttons do the work
  const [canDrag, setCanDrag] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 700px) and (pointer: fine)"), f = () => setCanDrag(m.matches);
    f(); m.addEventListener("change", f); return () => m.removeEventListener("change", f);
  }, []);
  useEscape(() => setMore(false), more);

  // sheet state: null = still reading, true = in step, false = showing the last copy (saving paused)
  const sheetOk = data ? data.sheet?.ok !== false : err ? false : null;
  const canSave = sheetOk === true;
  const paused = canSave ? undefined : "Saving is paused until the pub sheet can be read again.";
  const { cards, sheetById, live } = useMemo(() => arCards(data, pg), [data, pg]);
  const offBoard = data?.offBoard || (pg?.prospects || []).filter((p) => p.removedAt).map((p) => ({ id: p.id, name: p.name, removedAt: p.removedAt, why: "removed" }));
  const needle = find.trim().toLowerCase();
  const shown = cards.filter((c) => !needle || c.name.toLowerCase().includes(needle) || (c.contact || "").toLowerCase().includes(needle))
    .map((c) => (moving[c.key] ? { ...c, stage: moving[c.key], moving: true } : c));
  const cols = [...AR_STAGES, { id: "other", label: "Other", hint: "Typed in by hand in the sheet" }]
    .map((st) => ({ ...st, cards: shown.filter((c) => c.stage === st.id) })).filter((c) => c.id !== "other" || c.cards.length);
  const passed = shown.filter((c) => c.stage === "passed");
  const firstOpen = cols.find((c) => c.cards.length)?.id || "reach";
  const isOpen = (id) => folds[id] ?? id === firstOpen;

  // one move, from the button, the ⋯ menu or a drop: a producer's saves its sheet status (and is
  // refused, card back where it was, when the sheet says no); an artist's saves in the database only
  const moveTo = async (c, stageId) => {
    if (!stageId || stageId === c.stage || !canMoveTo(stageId)) return;
    const producer = c.role === "producer", s = producer ? sheetById[c.id] : null;
    const status = producer ? statusForStage(stageId, s?.status) : null;
    if (producer && (!s || !canSave || !status || status === s.status)) return;
    setMoving((m) => ({ ...m, [c.key]: stageId })); setFlash(null);
    try {
      if (producer) {
        const r = await arWrite({ action: "setStatus", prospectId: c.id, status, expect: s.cells.O ?? "" });
        setFlash({ ok: true, text: `${c.name} moved to ${stageLabel(stageId)}.${r.followUpSet ? ` Follow-up set for ${shortDay(r.followUpSet)}.` : ""}` });
        await reload();
      } else {
        await arPost({ action: "stageTracked", id: c.id, stage: stageId });
        setFlash({ ok: true, text: `${c.name} moved to ${stageLabel(stageId)}.` });
        await loadPg();
      }
    } catch (e) { setFlash({ ok: false, text: e.message }); }
    setMoving((m) => { const n = { ...m }; delete n[c.key]; return n; });
  };
  const quickAdd = async (e) => {
    e.preventDefault();
    const name = quick.trim();
    if (!name || !canSave) return;
    setBusy(true); setFlash(null);
    try {
      const r = await arWrite({ action: "createProspect", name });
      setQuick("");
      await reload();
      if (r.prospect?.id) openPanel({ type: "prospect", id: r.prospect.id });
      if (r.note) setFlash({ ok: true, text: r.note });
    } catch (e2) { setFlash({ ok: false, text: e2.message }); }
    setBusy(false);
  };
  const act = async (fn) => {
    setBusy(true); setFlash(null);
    try { await fn(); await reload(); } catch (e) { setFlash({ ok: false, text: e.message }); }
    setBusy(false);
  };
  const openCard = (c, e) => openPanel(c.role === "producer" ? { type: "prospect", id: c.id } : { type: "tracked", id: c.id }, e);
  const menuDo = (fn) => () => { setMore(false); fn(); };
  // the sheet read's problems plus what the last Sheet check found: the link counts what the check lists
  const notes = sheetProblems(data?.sheet?.problems, data?.sheet?.checkProblems);
  // the problems this read couldn't ask again (headers, formulas) say when the Sheet check found them
  const checkedOn = shortDay((data?.sheet?.checkProblems || []).find((c) => c.checkedAt)?.checkedAt);

  return (
    <div className="arb">
      <ArHead sub="Everyone we're talking to. Drag a card when things move.">
        <input className="arb-find" type="search" placeholder="Find someone" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Find someone" />
        <span className="arb-more" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMore(false)}>
          <button className="btn ghost sm" aria-expanded={more} aria-haspopup="menu" onClick={() => setMore(!more)}>More ▾</button>
          {more && (
            <div className="arb-menu right" role="menu">
              <button role="menuitem" onClick={menuDo(() => { setView(view === "board" ? "list" : "board"); setPassedOnly(false); })}>{view === "board" ? "Show as a list" : "Show as a board"}</button>
              {data?.sheet?.links?.outreach && <ExtLink role="menuitem" href={data.sheet.links.outreach}>Open OUTREACH tab</ExtLink>}
              <button role="menuitem" onClick={menuDo(() => setShowOff(true))}>Off the board ({offBoard.length})</button>
              <button role="menuitem" onClick={menuDo(() => setShowCheck(true))}>Sheet check</button>
            </div>
          )}
        </span>
        <button className="btn sm" data-focus="add" onClick={(e) => openPanel({ type: "add", kind: "producer" }, e)}><Plus size={15} /> Add someone</button>
      </ArHead>

      {sheetOk === false ? (
        <div className="arb-banner neg">
          <AlertTriangle size={16} />
          <span>The pub sheet isn't answering, so saving to it is paused. Showing what it said {data?.sheet?.seenAt ? `at ${clock(data.sheet.seenAt)}` : "last time"}.</span>
          <button className="btn ghost sm" onClick={() => { retry(); loadPg(); }}>Try again</button>
        </div>
      ) : (
        <p className="arb-status">
          {sheetOk === null ? <span className="muted">Reading the OUTREACH tab…</span> : `Saved to your OUTREACH sheet · ${clock(data.sheet.readAt)}`}
          {/* what the sheet read flagged (a status dropdown it couldn't read…) is one quiet link; Sheet check has the full sentence */}
          {notes.length > 0 && <> · <button className="inline-link arb-notes" onClick={() => setShowCheck(true)} title={checkedOn ? `Some of these are from the Sheet check on ${checkedOn}. Opening it checks the sheet again.` : undefined}>{notes.length === 1 ? "1 sheet problem" : `${notes.length} sheet problems`}</button></>}
        </p>
      )}
      {pgErr && <ArDataError err={pgErr} retry={loadPg} />}
      {flash && <p className={`hint ${flash.ok ? "ok-text" : "err-text"} arb-flash`} role="status">{flash.text}</p>}

      {data?.firstRun && (
        <div className="arb-card-note">
          <CheckCircle2 size={16} />
          <span>Brought in {data.firstRun.found} {data.firstRun.found === 1 ? "person" : "people"} from your OUTREACH tab. Nothing in the sheet changed.</span>
          <button className="btn ghost sm" onClick={() => act(() => arPost({ action: "dismissFirstRun" }))} disabled={busy}>Dismiss</button>
        </div>
      )}
      {(data?.givenMismatch || []).length > 0 && (
        <div className="attn arb-check">
          <div className="attn-head"><AlertTriangle size={15} /> Changes to check</div>
          {data.givenMismatch.map((g) => (
            <div key={g.prospectId} className="attn-row">
              <span>{g.name}: the sheet says "{g.sheet || "blank"}" for 'Advance given?', the dashboard last saved "{g.remembered || "blank"}".</span>
              <span className="arb-row-actions">
                <button className="btn ghost sm" disabled={busy} onClick={() => act(() => arWrite({ action: "fixGiven", prospectIds: [g.prospectId], use: "sheet" }))}>Keep the sheet version</button>
                <button className="btn ghost sm" disabled={busy || !canSave} title={paused} onClick={() => act(() => arWrite({ action: "fixGiven", prospectIds: [g.prospectId], use: "remembered" }))}>Put back "{g.remembered || "blank"}"</button>
              </span>
            </div>
          ))}
        </div>
      )}
      {(data?.changesToCheck || []).length > 0 && (
        <div className="attn arb-check">
          <div className="attn-head"><AlertTriangle size={15} /> Saves to double-check</div>
          {data.changesToCheck.map((c, i) => <div key={c.id || i} className="attn-row"><span>{c.text || String(c)}</span></div>)}
        </div>
      )}

      {!pg && !pgErr && <p className="muted dash-wait">Loading…</p>}
      {pg && view === "board" && (
        <div className={`arb-board${drag ? " dragging" : ""}`}>
          {cols.map((c) => {
            const opened = isOpen(c.id), drop = drag && canMoveTo(c.id);
            const dropOk = (e) => { e.preventDefault(); if (over !== c.id) setOver(c.id); };
            return (
              <section key={c.id} className={`arb-col${opened ? "" : " folded"}${over === c.id ? " over" : ""}`} data-col={c.id} data-stage={c.id}
                onDragOver={drop ? dropOk : undefined} onDragEnter={drop ? dropOk : undefined}
                onDragLeave={drop ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver((o) => (o === c.id ? null : o)); } : undefined}
                onDrop={drop ? (e) => { e.preventDefault(); const card = shown.find((x) => x.key === drag); setDrag(null); setOver(null); if (card) moveTo(card, c.id); } : undefined}>
                <button className="arb-col-head" onClick={() => setFolds({ ...folds, [c.id]: !opened })} aria-expanded={opened}>
                  <span className="arb-col-title"><i className="arb-dot" aria-hidden="true" /><span className="arb-col-label">{c.label}</span> <span className="arb-n">{c.cards.length}</span></span>
                  <span className="arb-hint">{c.hint}</span>
                </button>
                <div className="arb-cards">
                  {c.id === "reach" && (
                    <form onSubmit={quickAdd} className="arb-quick">
                      <input placeholder="Add a producer…" value={quick} onChange={(e) => setQuick(e.target.value)} disabled={!canSave || busy} title={paused} aria-label="Add a producer" />
                    </form>
                  )}
                  {c.cards.map((card) => (
                    <ArCard key={card.key} c={card} canSave={canSave} paused={paused} busy={!!card.moving} canDrag={canDrag}
                      onOpen={(e) => openCard(card, e)} onMove={(st) => moveTo(card, st)}
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", card.key); } catch { /* old browsers */ } setDrag(card.key); }}
                      onDragEnd={() => { setDrag(null); setOver(null); }} />
                  ))}
                  {!c.cards.length && c.id !== "reach" && <p className="arb-empty">{drop ? "Drop here" : "Nobody here yet"}</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {pg && view === "list" && (
        <>
          {passedOnly && <p className="arb-status">Passed ({passed.length}) · <button className="inline-link" onClick={() => setPassedOnly(false)}>Show everyone</button></p>}
          <ArList rows={passedOnly ? passed : shown} onOpen={openCard} />
        </>
      )}

      <div className="arb-foot">
        {view === "board" && <><button className="inline-link arb-passed" onClick={() => { setView("list"); setPassedOnly(true); }}>Passed ({passed.length})</button><span aria-hidden="true">·</span></>}
        <button className="inline-link" onClick={() => setShowOff(true)}>Off the board ({offBoard.length})</button>
      </div>

      <ArPanels ar={ar} open={open} openPanel={openPanel} closePanel={closePanel} onGo={onGo} />
      {showOff && <OffBoardList items={offBoard} live={live} canSave={canSave} onClose={() => setShowOff(false)} reload={reload} />}
      {showCheck && <SheetCheck readProblems={data?.sheet?.problems} onClose={() => setShowCheck(false)} onRan={load} />}
    </div>
  );
}

// A card: who, how to reach them, a producer's numbers, the follow-up, and ONE next step (the ⋯ menu
// has the rest). A producer's buttons wait for the sheet; an artist's don't need it.
function ArCard({ c, canSave, paused, busy, canDrag, onOpen, onMove, onDragStart, onDragEnd }) {
  // the ⋯ menu is placed on the screen itself, so a column that scrolls can't cut it off. It opens
  // upward when there's no room below, follows its button while the page or column scrolls, and
  // closes once the button is off screen
  const [menu, setMenu] = useState(null);
  const dots = useRef(null);
  useEscape(() => setMenu(null), !!menu);
  const place = () => {
    const r = dots.current?.getBoundingClientRect();
    if (!r || r.bottom < 0 || r.top > window.innerHeight) return null;
    const up = window.innerHeight - r.bottom < 160;
    return { right: Math.max(8, window.innerWidth - r.right), ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) };
  };
  const isOpen = !!menu;
  useEffect(() => {
    if (!isOpen) return undefined;
    const follow = () => setMenu(place());
    window.addEventListener("scroll", follow, true); window.addEventListener("resize", follow);
    return () => { window.removeEventListener("scroll", follow, true); window.removeEventListener("resize", follow); };
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = () => setMenu(menu ? null : place());
  const next = stepFrom(c.stage, 1), back = stepFrom(c.stage, -1);
  const off = (c.role === "producer" && !canSave) || busy;
  const s = c.s;
  return (
    <div className={`arb-card${c.moving ? " moving" : ""}`} data-card={c.key} draggable={canDrag && !off} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <button className="arb-card-open" data-focus={c.key} onClick={onOpen} disabled={c.role === "producer" && !s} title={c.role === "producer" && !s ? "Waiting for the pub sheet" : undefined}>
        <span className="arb-card-top">
          <span className="arb-name" title={c.name}>{c.name}</span>
          {c.role === "producer" && s && <b className="arb-val">≈ {wholeMoney(s.money.totalEstValue)}</b>}
        </span>
        <span className="arb-contact">{c.role === "artist" ? "Artist" : "Producer"}{c.contact ? ` · ${c.contact}` : ""}{c.clientId && <> <span className="tag" data-tone="pos">Client</span></>}</span>
        {c.status === "Researching" && <span className="arb-sub">Researching</span>}
        {c.role === "producer" && s && <span className="arb-money">{bigNum(s.money.netStreams)} streams (their share)</span>}
        {c.followUp?.on && <span className="arb-tags">{followChip(c.followUp)}</span>}
      </button>
      <div className="arb-card-acts">
        {next && <button className="btn ghost sm arb-next" data-stage={next.id} onClick={() => onMove(next.id)} disabled={off} title={c.role === "producer" ? paused : undefined}>{next.verb}</button>}
        <span className="arb-more" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenu(null)}>
          <button ref={dots} className="btn ghost sm arb-dots" aria-label={`More for ${c.name}`} aria-haspopup="menu" aria-expanded={!!menu} onClick={toggle}>⋯</button>
          {menu && (
            <div className="arb-menu arb-menu-fixed" role="menu" style={menu}>
              {back && <button role="menuitem" disabled={off} onClick={() => { setMenu(null); onMove(back.id); }}>Move back to {back.label}</button>}
              {c.stage !== "passed" && <button role="menuitem" disabled={off} onClick={() => { setMenu(null); onMove("passed"); }}>Mark as passed</button>}
              <button role="menuitem" onClick={(e) => { setMenu(null); onOpen(e); }}>Open details</button>
            </div>
          )}
        </span>
      </div>
    </div>
  );
}

// The Board's list view (More ▾ › Show as a list, and Passed)
function ArList({ rows, onOpen }) {
  const cols = "minmax(0,1.6fr) minmax(0,1fr) minmax(0,.8fr) minmax(0,.8fr) minmax(0,.8fr)";
  if (!rows.length) return <div className="admin-empty">Nobody here yet.</div>;
  return (
    <div className="admin-table arb-list ar-table">
      <div className="admin-row admin-hd" style={{ "--cols": cols }}>
        <span data-col="name">Name</span><span data-col="stage">Stage</span><span data-col="contact">Last contact</span><span data-col="follow">Next follow-up</span><span data-col="value">≈ Value</span>
      </div>
      {rows.map((c) => (
        <button key={c.key} className="admin-row ar-link" data-focus={`list:${c.key}`} style={{ "--cols": cols }} onClick={(e) => (c.role !== "producer" || c.s) && onOpen(c, e)}>
          <span className="cell ar-who" data-col="name"><strong>{c.name}</strong><span className="ar-who-sub">{c.role === "artist" ? "Artist" : "Producer"}{c.contact ? ` · ${c.contact}` : ""}</span></span>
          <span className="cell" data-col="stage">{c.stage === "other" ? <StagePill id="other" label={c.status} /> : <StagePill id={c.stage} />}</span>
          <span className="cell" data-col="contact">{c.lastContact ? shortDay(c.lastContact) : c.lastText || <span className="muted-dash">—</span>}</span>
          <span className="cell" data-col="follow">{c.followUp?.on ? shortDay(c.followUp.on) : <span className="muted-dash">—</span>}</span>
          <span className="cell" data-col="value">{c.role === "producer" && c.s ? `≈ ${wholeMoney(c.s.money.totalEstValue)}` : <span className="muted-dash">—</span>}</span>
        </button>
      ))}
    </div>
  );
}

// Watchlist: everyone and every song tracked (and every row the old Artist and Song Trackers had), up or down
const SORTS = { name: (r) => String(r.name ?? r.title ?? "").toLowerCase(), current: (r) => r.current, changePct: (r) => r.changePct, atd: (r) => r.atd ?? r.lum?.atd, value: (r) => r.value };
const SHOW_TABS = [["everyone", "Everyone"], ["artists", "Artists"], ["producers", "Producers"]];
// the Watchlist opens in the server's order: biggest week-on-week % first, no % last (by this week's streams)
function ArWatch({ ar, onGo, at }) {
  const { data, pg, pgErr, loadPg } = ar;
  const [pill, setPill] = useState(at?.pill || "people");
  const [show, setShow] = useState("everyone");
  const [find, setFind] = useState("");
  const [onlyNone, setOnlyNone] = useState(!!at?.noNumbers);
  const [sort, setSort] = useState({ k: "changePct", dir: -1, server: true }); // biggest % first (the server's order) until a column is clicked
  const [lit, setLit] = useState(null); // the row a Summary click points at, lit for about 2 seconds
  const { open, openPanel, closePanel } = usePanel();
  const { cards, sheetById } = arCards(data, pg);
  const stageBy = Object.fromEntries(cards.map((c) => [c.key, c.stage]));
  const tracked = Object.fromEntries((pg?.tracked || []).map((t) => [t.id, t]));
  const nameOfPerson = (id) => (pg?.watch?.people || []).find((r) => r.ref?.id === id)?.name || "";
  const people = (pg?.watch?.people || []).map((r) => {
    const s = r.ref?.type === "prospect" ? sheetById[r.ref.id] : null, t = r.ref?.type === "tracked" ? tracked[r.ref.id] : null;
    const key = r.ref ? `${r.ref.type === "prospect" ? "p" : "t"}:${r.ref.id}` : r.key;
    return { ...r, handle: s?.contact || t?.handle || "", value: s ? s.money.totalEstValue : null, stage: stageBy[key] ?? r.stage,
      lastContact: s?.lastContact?.date || t?.lastContact || null, lastText: s?.lastContact?.text || "", photo: t?.photo || r.deezer?.picture || "" };
  });
  const songs = (pg?.watch?.songs || []).map((r) => ({ ...r, name: r.title, tiedTo: r.personId ? nameOfPerson(r.personId) : "" }));
  const needle = find.trim().toLowerCase();
  const list = (pill === "people" ? people.filter((r) => show === "everyone" || (show === "artists" ? r.role === "artist" : r.role === "producer")) : songs)
    .filter((r) => !needle || `${r.name} ${r.handle || ""} ${r.artist || ""}`.toLowerCase().includes(needle))
    .filter((r) => !onlyNone || noNums(r));
  const by = SORTS[sort.k];
  const rows = sort.server ? list : [...list].sort((a, b) => {
    const x = by(a), y = by(b);
    if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1; // no numbers sink to the bottom
    return (x < y ? -1 : x > y ? 1 : 0) * (sort.k === "name" ? -sort.dir : sort.dir);
  });
  // a signed client's row opens their page on Publishing, not the add form
  const openRow = (r, e) => (r.clientId && !r.ref ? onGo("catalog", `client:${r.clientId}`)
    : openPanel(r.ref ? { type: r.ref.type, id: r.ref.id } : { type: "add", kind: pill === "songs" ? "song" : "artist", prefill: { name: r.name, artist: r.artist || "",
      // a row from the old Artist / Song Tracker: its Luminate id (so the numbers and history stay with it) and its Spotify song
      luminateId: r.entityId?.startsWith("l:") ? r.entityId.slice(2) : "", spotify: r.entityId?.startsWith("t:") ? `https://open.spotify.com/track/${r.entityId.slice(2)}` : "",
      nums: r.current != null ? { thisWeek: r.current, unit: r.unit, wowPct: r.changePct ?? null, atd: r.atd ?? null } : null } }, e));
  // Summary's row click: open that person's panel once it has drawn, or (a row only the old Artist Tracker had) light it up
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || !pg) return;
    if (at?.flash) {
      jumped.current = true; setLit(at.flash);
      document.querySelector(`.ar-watch-list [data-key="${CSS.escape(at.flash)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!at?.open || !data) return;
    jumped.current = true;
    const r = [...people, ...songs].find((x) => x.key === at.open);
    if (r) openRow(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pg, data]);
  useEffect(() => { if (!lit) return undefined; const t = setTimeout(() => setLit(null), 2000); return () => clearTimeout(t); }, [lit]);
  // each list's own dates (Artists and Songs are often exported on different days)
  const period = pg?.watch?.periods?.[pill] || null;
  const to = period?.to, old = to && daysSince(to) > 8;
  const head = (k, label, col) => (
    <span data-col={col}>
      <button className={`ar-sort${sort.k === k && !sort.server ? " on" : ""}`} onClick={() => setSort({ k, dir: sort.k === k && !sort.server ? -sort.dir : -1 })} aria-label={`Sort by ${label}`}>
        {label}{sort.k === k && !sort.server ? (sort.dir < 0 ? " ↓" : " ↑") : ""}
      </button>
    </span>
  );
  const producers = pill === "people" && show === "producers";
  // 700–1199px: People has no room for All-time as well (its heads were cut off at 1024); a row's panel still has it
  const tight = useMedia("(min-width: 700px) and (max-width: 1199px)") && pill === "people";
  const cols = pill === "songs" ? "minmax(0,2.2fr) 118px minmax(0,.9fr) minmax(0,.9fr)"
    : `minmax(0,1.7fr) 112px minmax(84px,.8fr)${tight ? "" : " minmax(84px,.8fr)"} minmax(112px,1fr) minmax(104px,.8fr)${producers ? " minmax(84px,.8fr)" : ""}`;
  const dash = (title) => <span className="muted-dash" title={title}>—</span>;
  // someone only the old Artist Tracker had (not on OUTREACH) is tracked all the same (the owner): said so;
  // an artist with no Spotify artist link: their songs' numbers added up, and their Deezer fans
  const subOf = (r) => (pill === "people" ? [r.role === "producer" ? "Producer" : "Artist", r.fromList ? "From the old Artist Tracker" : r.handle, r.songsOnly && `${r.songCount} ${r.songCount === 1 ? "song" : "songs"}`, r.deezer?.fans != null && `${fmt(r.deezer.fans)} Deezer fans`]
    : [r.artist || (r.release ? "Release" : ""), r.tiedTo && `tied to ${r.tiedTo}`]).filter(Boolean).join(" · ");
  const rowKey = (e, r) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openRow(r, e); } };
  return (
    <div className="ar-watch">
      <ArHead sub="Everyone and every song we're tracking, and whether they're up or down.">
        <button className="btn sm" data-focus="add" onClick={(e) => openPanel({ type: "add", kind: pill === "songs" ? "song" : show === "producers" ? "producer" : "artist" }, e)}><Plus size={15} /> Add</button>
      </ArHead>
      {pgErr && <ArDataError err={pgErr} retry={loadPg} />}
      <p className="arb-status ar-period">
        {to ? <span>{old ? "Latest week" : "This week"}: {dayRange(period.from, to)} · compared with {dayRange(shiftDay(period.from, -7), shiftDay(to, -7))} · {pill === "people" ? "Spotify monthly listeners" : "Spotify streams, global"}</span>
          : "No Spotify numbers here yet: they come in with the daily update once someone has a Spotify link."}
      </p>
      <div className="ar-watch-tools">
        <span className="gainer-tabs" role="tablist" aria-label="People or songs">
          {[["people", "People", people.length], ["songs", "Songs", songs.length]].map(([id, label, n]) => (
            <button key={id} role="tab" aria-selected={pill === id} className={pill === id ? "active" : ""} onClick={() => { setPill(id); setOnlyNone(false); }}>{label} <span className="arb-n">{n}</span></button>
          ))}
        </span>
        {pill === "people" && (
          <span className="gainer-tabs ar-show" role="tablist" aria-label="Show">
            {SHOW_TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={show === id} className={show === id ? "active" : ""} onClick={() => setShow(id)}>{label}</button>)}
          </span>
        )}
        <input className="arb-find" type="search" placeholder={pill === "people" ? "Find someone" : "Find a song"} value={find} onChange={(e) => setFind(e.target.value)} aria-label="Find" />
        {onlyNone && <button className="inline-link" onClick={() => setOnlyNone(false)}>Showing only those with no numbers · show all</button>}
      </div>
      {producers && <ArTotals data={data} />}
      {!pg && !pgErr && <p className="muted dash-wait">Loading…</p>}
      {pg && !rows.length && (
        <div className="admin-empty">{pill === "people" ? "Nobody here yet." : "No songs tracked yet."} <button className="btn sm" onClick={(e) => openPanel({ type: "add", kind: pill === "songs" ? "song" : "artist" }, e)}><Plus size={15} /> Add</button></div>
      )}
      {pg && rows.length > 0 && (
        <div className="admin-table ar-watch-list ar-table" data-pill={pill}>
          <div className="admin-row admin-hd" style={{ "--cols": cols }}>
            {head("name", pill === "people" ? "Name" : "Title", "name")}{head("changePct", pill === "people" ? "vs a week ago" : "vs last week", "pct")}{head("current", pill === "people" ? "Listeners" : "This week", "week")}{!tight && head("atd", pill === "people" ? "Luminate, all-time" : "All-time", "atd")}
            {pill === "people" && <><span data-col="stage">Stage</span><span data-col="contact">Last contact</span></>}
            {producers && head("value", "≈ Value", "value")}
          </div>
          {rows.map((r) => {
            const sub = subOf(r);
            return (
              <div key={r.key} role="button" tabIndex={0} className={`admin-row ar-link ar-row${lit === r.key ? " ar-flash" : ""}`} data-focus={`w:${r.key}`} data-key={r.key} style={{ "--cols": cols }}
                onClick={(e) => openRow(r, e)} onKeyDown={(e) => rowKey(e, r)}>
                <span className="cell ar-who" data-col="name">{r.photo ? <span className="ar-who-top"><Avatar src={r.photo} name={r.name} size={24} /><strong>{r.name}</strong></span> : <strong>{r.name}</strong>}
                  {sub && (
                    <span className="ar-who-sub">
                      <span>{sub}</span>
                    </span>
                  )}
                  {r.clientId ? <span className="tag ar-client-tag" data-tone="pos" title="One of our signed clients">Client</span>
                    : r.songsOnly ? <span className="tag ar-songs-only" data-songs-only title="No Spotify artist link yet: these are their songs added up">Songs only</span>
                    : r.fromList && <span className="ar-add-hint" aria-hidden="true">+ Add details</span>}
                </span>
                <span className="cell" data-col="pct">{r.current == null ? dash("No numbers yet") : r.changePct == null ? dash("No last week to compare") : <WowPill pct={r.changePct} />}</span>
                <span className="cell ar-num" data-col="week">{r.current == null ? <>{dash()}<em>No numbers yet</em></> : <><b>{fmt(r.current)}</b><em> {r.unit === "listeners" ? "listeners" : old ? "that week" : "this week"}</em></>}</span>
                {!tight && <span className="cell ar-num" data-col="atd">{pill === "people" ? (r.lum?.atd == null ? dash() : <span title={`Luminate's last all-time streams, ${shortDay(r.lum.on)}`}>{fmt(r.lum.atd)}</span>) : r.atd == null ? dash() : fmt(r.atd)}</span>}
                {pill === "people" && <>
                  <span className="cell" data-col="stage">{r.stage ? <StagePill id={r.stage} /> : dash()}</span>
                  <span className="cell" data-col="contact">{r.lastContact ? shortDay(r.lastContact) : r.lastText || dash()}</span>
                </>}
                {producers && <span className="cell ar-num" data-col="value">{r.value != null ? `≈ ${wholeMoney(r.value)}` : dash()}</span>}
              </div>
            );
          })}
        </div>
      )}
      <ArPanels ar={ar} open={open} openPanel={openPanel} closePanel={closePanel} onGo={onGo} />
    </div>
  );
}

// The sheet's Year 1 is the run-rate (B9) less one year's decay (B8): H × B9 × (1 − I), so 30% and 25%
// make 22.5%. Say that share, not B9 alone, or a hand check comes out a third too high. One decimal,
// so 22.5% never shows as 23%. null when either lever is missing.
export const pct1 = (x) => `${Math.round(x * 1000) / 10}%`;
// "how" says it in words: "30% of all-time a year, less a quarter of that"
const FRACTION_WORDS = { 0.5: "half", 0.25: "a quarter", 0.2: "a fifth", 0.1: "a tenth", 0.75: "three quarters" };
const partWords = (x) => FRACTION_WORDS[Math.round(x * 1e6) / 1e6] || (Math.abs(x - 1 / 3) < 1e-6 ? "a third" : pct1(x));
export const yearOne = (a) => (a?.runRate != null && a?.decayRate != null
  ? { share: pct1(a.runRate * (1 - a.decayRate)), run: pct1(a.runRate), decay: pct1(a.decayRate), how: `${pct1(a.runRate)} of all-time a year, less ${partWords(a.decayRate)} of that` } : null);

// Show › Producers: three whole-dollar tiles from OUTREACH's row-1 totals exactly as the sheet works
// them out (never summed here); the rest of that row sits under How we estimate
function ArTotals({ data }) {
  if (!data) return <p className="muted">Reading the OUTREACH tab…</p>;
  const t = data.totals, a = data.assumptions, b = data.budget;
  if (!t) return null;
  const cut = a?.adminFeeRate != null ? `${Math.round(a.adminFeeRate * 100)}%` : "cut";
  // the adminFee total is OUTREACH's own cut of their earnings so far, so its % comes from those two numbers;
  // nobody has paid it: it's what we'd have earned had they been signed
  const feeCut = t.grossRevenue > 0 && t.adminFee != null ? `${Math.round((t.adminFee / t.grossRevenue) * 100)}%` : cut;
  const tiles = [["totalValue", "Total est. value", t.totalValue], ["adminFee", `Our ${feeCut} of their earnings to date (if signed)`, t.adminFee], ...(b ? [["budgetLeft", "Advance budget left", b.remaining]] : [])];
  const rest = [["grossStreams", "Their streams", bigNum], ["netStreams", "Their share of streams", bigNum], ["grossRevenue", "Est. earnings pool", wholeMoney], ["threeYear", "Next 3 years (our cut)", wholeMoney]];
  return (
    <div className="ar-totals">
      <div className="cat-summary"><div className="cat-summary-grid ar-totals-grid">
        {tiles.map(([k, label, v]) => (
          <div key={k} className="cat-stat" data-total={k} data-value={v ?? ""}><span className="cat-stat-label">{label}</span><span className="cat-stat-val">{v == null ? "—" : wholeMoney(v)}</span></div>
        ))}
      </div></div>
      <details className="ar-how">
        <summary>How we estimate</summary>
        <p className="ar-how-nums">{rest.map(([k, label, f]) => <span key={k} data-total={k} data-value={t[k] ?? ""}>{label} <b>{t[k] == null ? "—" : f(t[k])}</b></span>)}</p>
        <p>Streams × their share × ${a?.blendedRate ?? "—"} a stream = their earnings so far; we keep {cut}. Year 1 = {yearOne(a) ? `${yearOne(a).share} of those earnings (${yearOne(a).how})` : "a set share of those earnings"}, then {a?.decayRate != null ? pct1(a.decayRate) : "a set amount"} less each year. These come from the ASSUMPTIONS tab.</p>
        {b && <p className="ar-budget">Advance budget {wholeMoney(b.starting)} · given {wholeMoney(b.committed)} · left {wholeMoney(b.remaining)}</p>}
      </details>
    </div>
  );
}

// short numbers and times for the cards and status lines
const statusTone = (s = "") => /signed/i.test(s) ? "pos" : /offer/i.test(s) ? "warn" : /talk|negotiat/i.test(s) ? "info" : /not contacted|pass|declin/i.test(s) ? "muted" : undefined;
// (rounded half up: toFixed alone reads 14,450,000 as "14.4M", binary floats)
const roundMoney = (n) => { const a = Number(n) || 0; return `$${fmt(a >= 1000 ? Math.round(a / 100) * 100 : Math.round(a / 10) * 10)}`; };
const weekday = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" });

// "Off the board": removed by staff, or gone from the sheet. Put back writes them into a free row;
// "Same person as…" folds a record into someone already on the board (Postgres only)
function OffBoardList({ items, live, canSave, onClose, reload }) {
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [into, setInto] = useState({});
  useEscape(onClose, !busy);
  const run = async (id, fn) => {
    setBusy(id); setErr(null);
    try { await fn(); await reload(); } catch (e) { setErr(e.message); }
    setBusy(null);
  };
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal-card arb-off">
        <div className="modal-head"><h3>Off the board ({items.length})</h3><button onClick={onClose} aria-label="Close" disabled={!!busy}><X size={18} /></button></div>
        <div className="modal-body">
          <p className="muted mb">Their songs, notes and history are kept. Put back returns them to a free row in the OUTREACH tab.</p>
          {err && <p className="hint err-text">{err}</p>}
          {!items.length && <p className="arb-empty">Nobody is off the board.</p>}
          {items.map((o) => (
            <div key={o.id} className="arb-off-row">
              <div className="arb-off-who">
                <span className="arb-name">{o.name}</span>
                <span className="arb-contact">{o.why === "gone from the sheet" ? "Gone from the sheet" : "Removed"}{o.removedAt ? ` · ${shortDay(o.removedAt)}` : ""}</span>
              </div>
              <div className="arb-off-actions">
                <button className="btn sm" disabled={!!busy || !canSave} title={canSave ? undefined : "Saving is paused until the pub sheet can be read again."}
                  onClick={() => run(o.id, () => arWrite({ action: "restoreProspect", prospectId: o.id }))}>{busy === o.id ? "Putting back…" : "Put back"}</button>
                {live.length > 0 && (
                  <span className="arb-merge">
                    <select value={into[o.id] || ""} onChange={(e) => setInto({ ...into, [o.id]: e.target.value })} aria-label={`${o.name} is the same person as…`}>
                      <option value="">Same person as…</option>
                      {live.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <button className="btn ghost sm" disabled={!!busy || !into[o.id]} onClick={() => run(o.id, () => arPost({ action: "mergeProspect", fromId: o.id, intoId: into[o.id] }))}>Merge</button>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="modal-foot"><button className="btn ghost sm" onClick={onClose} disabled={!!busy}>Close</button></div>
      </div>
    </div>
  );
}

// A check that failed and a sheet-read problem about the same thing are one problem (the read's words win)
const CHECK_TWIN = { statuses: "statusesBuiltIn", advanceRows: "advanceUnmapped", assumptions: "assumptionsOdd", totalRow: "noTotalRow" };
function sheetProblems(read = [], checks = []) {
  const ids = new Set((read || []).map((p) => p.id));
  return [...(read || []).map((p) => p.text || String(p)), ...(checks || []).filter((c) => !ids.has(CHECK_TWIN[c.id])).map((c) => c.fix || c.text)];
}
// Sheet check (spec 5.7): read-only, so it's safe to run against the real sheet before any save.
// What needs fixing comes first, in plain words; every check it ran sits under Technical details.
function SheetCheck({ readProblems = [], onClose, onRan }) {
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const run = () => {
    setRes(null); setErr(null);
    fetch("/api/ar-data?check=1").then((r) => r.json())
      .then((d) => { if (d.error) throw new Error(d.error); setRes(d); onRan?.(); })
      .catch((e) => setErr(e.message || "Couldn't check the pub sheet just now."));
  };
  useEffect(run, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEscape(onClose);
  const notes = sheetProblems(readProblems, (res?.checks || []).filter((c) => !c.ok));
  const bad = notes.length;
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card arb-sheetcheck">
        <div className="modal-head"><h3>Sheet check</h3><button onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-body">
          <p className="muted mb">Reads the OUTREACH, ADVANCE CALCULATOR and ASSUMPTIONS tabs and checks they're laid out the way the dashboard expects. It doesn't change anything in the sheet.</p>
          {err && <ArDataError err={err} retry={run} />}
          {!res && !err && <p className="muted">Checking the sheet…</p>}
          {res && <p className={`hint ${bad ? "err-text" : "ok-text"} mb`}>{bad ? `${bad === 1 ? "1 thing" : `${bad} things`} to fix in the sheet before saving from here:` : "Everything looks right."}</p>}
          {res && notes.map((t) => <p key={t} className="arb-banner warn arb-note ar-sheet-problem"><AlertTriangle size={16} /><span>{t}</span></p>)}
          {res && (
            <details className="arb-tech">
              <summary>Technical details</summary>
              <ul className="arb-checks">
                {res.checks.map((c) => (
                  <li key={c.id} className={c.ok ? "ok" : "bad"}>{c.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}<span>{c.text}</span></li>
                ))}
              </ul>
            </details>
          )}
        </div>
        <div className="modal-foot"><button className="btn ghost sm" onClick={run} disabled={!res && !err}>Check again</button><button className="btn sm" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
