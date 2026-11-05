import { useState, useEffect, useMemo, useRef } from "react";
import { X, Plus, RefreshCw, AlertTriangle, CheckCircle2, TrendingUp } from "lucide-react";
import { ArHome } from "../ar/ArHome";
import { ArGrid } from "../ar/ArGrid";
import { ArDrawer } from "../ar/ArDrawer";
import { ArPasteBar } from "../ar/ArPasteBar";
import { swrJson, peekJson } from "../ui/fetch-cache";
import { ProspectForm } from "./advance";
import { IsrcPicks, dayRange, daysSince, shortDay, useMedia } from "./helpers";
import { Area, Avatar, Field, fmt, money, revealChip, useEscape } from "./ui";
import { AskCard, useDirtyGuard } from "../portal/ask";
import { arPgCache } from "../shared/dash-caches";
import { ExtLink } from "../shared/ui";
import { arSecOf } from "../shared/ar-routes";
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
// maxAge (A&R › Outreach, r10): a read under that many ms old is reused as it is, so going back to Outreach within
// 30s reads nothing again (each section mounts on its own now). Publishing reads it fresh each time, as before.
const arDataRead = { at: 0 };
export function useArData({ maxAge = 0 } = {}) {
  const [data, setData] = useState(() => peekJson("/api/ar-data") || null);
  const [err, setErr] = useState(null);
  const load = () => swrJson("/api/ar-data", (d, how) => { setData(d); setErr(null); if (!how?.cached) arDataRead.at = Date.now(); }, { anyStatus: true })
    .then((d) => { if (d?.error) throw new Error(d.error); })
    .catch((e) => setErr(e.message || "Couldn't load A&R data."));
  const retry = () => { setErr(null); load(); }; // shows "Loading…" again until it answers
  useEffect(() => { if (!(maxAge && peekJson("/api/ar-data") && Date.now() - arDataRead.at < maxAge)) load(); }, []);
  return { data, err, load, retry };
}
export const ArDataError = ({ err, retry }) => <p className="hint err-text mb"><span>{err}</span> <button className="btn ghost sm" onClick={retry}>Try again</button></p>;

// The pub-sheet read (OUTREACH) and Postgres' prospects behind A&R › Outreach and To do's follow-ups. Only
// Outreach and To do mount it: the lists never read the pub sheet.
export function useArAll() {
  const sheet = useArData({ maxAge: 30000 }); // the sheet read: cells, rows, statuses
  const [pg, setPg] = useState(() => arPgCache.d); // /api/ar: Postgres only, so the board draws before the sheet answers
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
  // (only when that read is newer than the Postgres one: reopening Outreach within 30s reads neither again)
  useEffect(() => { if (sheet.data && arPgCache.at < arDataRead.at) loadPg(); }, [sheet.data]);
  return { ...sheet, pg, pgErr, loadPg };
}

// r10: A&R is a list, a tracker and a watcher, laid out like a spreadsheet. Five views, each with its own address
// (/dashboard/ar/...), each loading only its own data (one GET /api/ar-lists?view=…; Outreach alone reads the sheet):
//   Home (/ar) · Watchlist (/ar/watch, /watch/songs, /watch/confirm; everyone's, /…/by/<userId> = one person's)
//   · My A&R (/ar/mine) · Sounds (/ar/sounds) · Outreach (/ar/outreach); a row's drawer: /ar/item/<key>
// (r10 fix, N7: Team was the Watchlist again with other columns, so it's folded in; old Team links redirect)
const AR_PILLS = [["", "Home"], ["watch", "Watchlist"], ["mine", "My A&R"], ["sounds", "Sounds"], ["outreach", "Outreach"]];
// the old addresses (Summary, Trackers, Radar, Board, To do's "watch:open:<key>") open their new place: the
// shell rewrites them (components/shared/ar-routes.js); read here too, for a sub handed in directly
export { arSecOf };
// where an address points inside A&R: { view, person, item, pill }
export function arPlace(sub) {
  const parts = arSecOf(sub).split("/").filter(Boolean);
  const [a, b] = parts;
  if (!a) return { view: "home", pill: "" };
  // a row's drawer opens over the Watchlist tab its row is on (artists until the row says otherwise)
  if (a === "item" && b) return { view: "watch", item: parts.slice(1).join("/"), pill: "watch" };
  if (a === "mine") return { view: "mine", pill: "mine" };
  if (a === "watch") {
    const tab = b === "songs" || b === "confirm" ? b : "";
    const by = parts.indexOf("by");
    return { view: tab === "songs" ? "songs" : tab === "confirm" ? "confirm" : "watch", person: by >= 0 ? parts.slice(by + 1).join("/") : "", pill: "watch" };
  }
  if (a === "sounds") return { view: "sounds", pill: "sounds" };
  if (a === "outreach") return { view: "outreach", pill: "outreach" };
  // an address A&R doesn't have: say so (never a silent Home)
  return { view: "home", pill: "", unknown: parts.join("/") };
}
// a Watchlist address: its tab, and the person it's filtered to
const watchPath = (view, person) => `${view === "songs" ? "watch/songs" : view === "confirm" ? "watch/confirm" : "watch"}${person ? `/by/${person}` : ""}`;
// one view's data: GET /api/ar-lists (shown from the last answer at once, then refreshed)
function useArView(url) {
  const [data, setData] = useState(() => (url ? peekJson(url) || null : null));
  const [err, setErr] = useState(null);
  const load = () => (!url ? Promise.resolve() : swrJson(url, (d) => { setData(d); setErr(null); }, { anyStatus: true })
    .then((d) => { if (d?.error) throw new Error(d.error); })
    .catch((e) => setErr(e.message || "Couldn't load the A&R lists.")));
  useEffect(() => { setData(url ? peekJson(url) || null : null); setErr(null); load(); }, [url]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, err, load, retry: () => { setErr(null); load(); } };
}
export function ARAdmin({ onGo, sub, onSub, chip = null }) {
  const at = arPlace(sub);
  const go = (path) => onGo("ar", path || null);
  return (
    <div className="ar">
      <div className="admin-head"><h2>A&amp;R</h2>{chip}</div>
      <div className="subnav" data-m-scroll>
        {AR_PILLS.map(([id, label]) => (
          <button key={id || "home"} className={at.pill === id ? "subpill active" : "subpill"} aria-current={at.pill === id ? "page" : undefined} data-ar-pill={id || "home"}
            onClick={(e) => { go(id); revealChip(e.currentTarget); }}>{label}</button>
        ))}
      </div>
      {at.unknown && <p className="hint ar-unknown" role="status" data-ar-unknown>There's no A&amp;R page at “{at.unknown}”. Here's A&amp;R Home.</p>}
      {at.view === "home" && <ArHomeView go={go} />}
      {at.view === "outreach" && <ArOutreach onGo={onGo} go={go} />}
      {!["home", "outreach"].includes(at.view) && <ArListView key={at.view} at={at} go={go} />}
    </div>
  );
}
function ArHomeView({ go }) {
  const v = useArView("/api/ar-lists?view=home");
  return <ArHome data={v.data} err={v.err} retry={v.retry} reload={v.load} founder={!!v.data?.founder} onOpen={(key) => go(`item/${key}`)} onView={(p) => go(p)} />;
}
const WATCH_TABS = [["watch", "Artists"], ["songs", "Songs"], ["confirm", "To confirm"]];
const EMPTY = {
  mine: "Your list is empty. Paste a Spotify, TikTok, Instagram or YouTube link above: it goes on your list.",
  watch: "No artists on the Watchlist yet.", songs: "No songs on the Watchlist yet.", confirm: "Every Spotify match is confirmed.",
  sounds: "No TikTok sounds yet. Paste a sound's link (tiktok.com/music/…) to track it.",
};
function ArListView({ at, go }) {
  const url = `/api/ar-lists?view=${at.view}${at.person ? `&person=${encodeURIComponent(at.person)}` : ""}`;
  const v = useArView(url);
  const [open, setOpen] = useState(at.item || null);
  const [flash, setFlash] = useState(null);
  const [note, setNote] = useState(null);
  useEffect(() => { setOpen(at.item || null); }, [at.item]);
  const d = v.data;
  const rows = d?.rows || [];
  const me = d?.me || null;
  const close = () => { setOpen(null); if (at.item) go("watch"); };
  const act = async (body, ok) => {
    setNote(null);
    try { await arTrackerPost(body); setNote({ ok: true, text: ok }); await v.load(); } catch (e) { setNote({ ok: false, text: e.message }); }
  };
  const ctx = {
    me, manage: at.view === "mine",
    setDays: (w, days) => act({ action: "setDays", entryId: w.entryId, days }, `${days} days from today.`),
    renew: (w) => act({ action: "renew", entryId: w.entryId }, "Renewed."),
    remove: (w, r) => act({ action: "remove", entryId: w.entryId }, r.addedBy.length > 1 ? `Your name is off ${r.name}. It stays on the list for ${r.names.filter((n) => n !== w.name).join(", ")}.` : `${r.name} is off your list.`),
  };
  // Mine: what of yours ends this week, with one Renew for all of it
  const ending = at.view === "mine" ? rows.map((r) => r.addedBy.find((w) => w.id === me)).filter((w) => w && !w.never && (w.state === "soon" || w.state === "expired")) : [];
  const added = (res) => {
    v.load().then(() => {
      const key = res?.subject;
      if (!key) return;
      setFlash(key);
      setTimeout(() => setFlash(null), 1600);
      setTimeout(() => document.querySelector(`[data-row="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 60);
    });
  };
  const flashKey = flash ? rows.find((r) => r.subjects.includes(flash))?.key : null;
  return (
    <div className="ar-list" data-ar-view={at.view}>
      <ArPasteBar view={at.view === "sounds" ? "sounds" : at.view} onAdded={added} onOpen={(key) => key && setOpen(key)} />
      {["watch", "songs", "confirm"].includes(at.view) && (
        <div className="ar-tabs" role="tablist" data-watch-tabs>
          {WATCH_TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={at.view === id} className={at.view === id ? "on" : ""} onClick={() => go(watchPath(id, at.person))} data-watch-tab={id}>{label}</button>)}
        </div>
      )}
      {/* who added what: Everyone, then each person with something on this tab (r10 fix, N7) */}
      {["watch", "songs", "confirm"].includes(at.view) && d?.people && d.people.length > 1 && (
        <div className="ar-people" role="tablist" aria-label="Added by" data-m-scroll data-person-tabs>
          {d.people.map((p) => (
            <button key={p.id || "all"} type="button" role="tab" aria-selected={(at.person || "") === p.id} className={(at.person || "") === p.id ? "on" : ""}
              onClick={() => go(watchPath(at.view, p.id))} data-person-tab={p.id || "all"}>{p.name} <b>{p.n}</b></button>
          ))}
        </div>
      )}
      {ending.length > 0 && (
        <p className="ar-banner" data-mine-ending>
          {ending.length} of yours {ending.length === 1 ? "ends" : "end"} this week ·{" "}
          <button type="button" className="inline-link" onClick={async () => { for (const w of ending) await arTrackerPost({ action: "renew", entryId: w.entryId }).catch(() => null); setNote({ ok: true, text: "Renewed." }); v.load(); }} data-renew-all>{ending.length === 1 ? "Renew it" : ending.length === 2 ? "Renew both" : `Renew all ${ending.length}`}</button>
        </p>
      )}
      {note && <p className={`hint ${note.ok ? "ok-text" : "err-text"}`} role="status" data-list-note>{note.text}</p>}
      {v.err && <ArDataError err={v.err} retry={v.retry} />}
      {!d && !v.err && <p className="muted dash-wait">Loading…</p>}
      {d && (
        <ArGrid id={at.view === "confirm" ? "confirm" : at.view} view={at.view} rows={rows} asOf={d.asOf || {}} people={d.people || []} openKey={open} flashKey={flashKey} momentumReady={!!d.momentumReady}
          onOpen={(r) => setOpen(r.key)} ctx={ctx} empty={at.person ? "Nothing from this person on this tab." : EMPTY[at.view]} filters={{ type: at.view === "mine" }} />
      )}
      {open && <ArDrawer itemKey={open} me={me} founder={!!d?.founder} onClose={close} onChanged={() => v.load()} onGoOutreach={() => go("outreach")} />}
    </div>
  );
}
const arTrackerPost = (body) => fetch("/api/ar-trackers", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "defied-site" }, body: JSON.stringify(body) })
  .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok || j.error) throw new Error(j.error || "That didn't save — try again."); return j; });
// Outreach: the pipeline board (the OUTREACH sheet), with no money
function ArOutreach({ onGo, go }) {
  const ar = useArAll();
  return <ArBoard ar={ar} onGo={onGo} openTracked={(id) => go(`item/w:${id}`)} />;
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
// the panel Outreach and To do's follow-ups open: one person on the OUTREACH sheet, as a pipeline only (name,
// contact, stage, notes, last contact, follow-up: no song slots, no estimates). r10: adding a Watchlist artist or
// song is the paste box; editing one is its drawer (/dashboard/ar/item/<key>).
export function ArPanels({ ar, open, openPanel, closePanel }) {
  const { data, pg, load } = ar;
  if (!open) return null;
  const canSave = !!data && data.sheet?.ok !== false;
  if (open.type === "add") {
    return (
      <ProspectForm pipeline title="Add someone to reach out to" blendedRate={data?.assumptions?.blendedRate ?? 0} assume={data?.assumptions} canSave={canSave}
        onClose={closePanel} onChanged={async (r) => { await load(); if (r?.prospect?.id) openPanel({ type: "prospect", id: r.prospect.id }); else closePanel(); }} />
    );
  }
  const s = (data?.prospects || []).find((p) => p.id === open.id);
  const p = (pg?.prospects || []).find((x) => x.id === open.id);
  if (!s || !data) return null;
  return (
    <ProspectForm pipeline key={s.id} prospect={s} pg={p} blendedRate={data.assumptions.blendedRate} assume={data.assumptions} canSave={canSave} reload={load}
      onClose={closePanel} onChanged={async () => { await load(); closePanel(); }} />
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

function ArBoard({ ar, onGo, openTracked }) {
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
  const openCard = (c, e) => (c.role === "producer" ? openPanel({ type: "prospect", id: c.id }, e) : openTracked?.(c.id));
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
                      <input placeholder="Add someone…" value={quick} onChange={(e) => setQuick(e.target.value)} disabled={!canSave || busy} title={paused} aria-label="Add someone to reach out to" />
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
        </span>
        <span className="arb-contact">{c.role === "artist" ? `Artist${c.contact ? ` · ${c.contact}` : ""}` : c.contact || ""}{c.clientId && <> <span className="tag" data-tone="pos">Client</span></>}</span>
        {c.status === "Researching" && <span className="arb-sub">Researching</span>}
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
  const cols = "minmax(0,1.6fr) minmax(0,1fr) minmax(0,.8fr) minmax(0,.8fr)";
  if (!rows.length) return <div className="admin-empty">Nobody here yet.</div>;
  return (
    <div className="admin-table arb-list ar-table">
      <div className="admin-row admin-hd" style={{ "--cols": cols }}>
        <span data-col="name">Name</span><span data-col="stage">Stage</span><span data-col="contact">Last contact</span><span data-col="follow">Next follow-up</span>
      </div>
      {rows.map((c) => (
        <button key={c.key} className="admin-row ar-link" data-focus={`list:${c.key}`} style={{ "--cols": cols }} onClick={(e) => (c.role !== "producer" || c.s) && onOpen(c, e)}>
          <span className="cell ar-who" data-col="name"><strong>{c.name}</strong><span className="ar-who-sub">{c.role === "artist" ? `Artist${c.contact ? ` · ${c.contact}` : ""}` : c.contact || ""}</span></span>
          <span className="cell" data-col="stage">{c.stage === "other" ? <StagePill id="other" label={c.status} /> : <StagePill id={c.stage} />}</span>
          <span className="cell" data-col="contact">{c.lastContact ? shortDay(c.lastContact) : c.lastText || <span className="muted-dash">—</span>}</span>
          <span className="cell" data-col="follow">{c.followUp?.on ? shortDay(c.followUp.on) : <span className="muted-dash">—</span>}</span>
        </button>
      ))}
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
