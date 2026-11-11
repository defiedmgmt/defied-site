import { useState, useEffect } from "react";
import { Clock } from "lucide-react";
import { ArHome, ArFresh } from "../ar/ArHome";
import { ArGrid } from "../ar/ArGrid";
import { ArDrawer } from "../ar/ArDrawer";
import { ArPasteBar } from "../ar/ArPasteBar";
import { swrJson, peekJson } from "../ui/fetch-cache";
import { ProspectForm } from "./advance";
import { shortDay } from "./helpers";
import { fmt, revealChip } from "./ui";
import { arPgCache } from "../shared/dash-caches";
import { arSecOf } from "../shared/ar-routes";
import { typeOf, endingWords } from "../ar/fmt";
// (list B #11) the pills and stages Home and Publishing draw too live in leaf modules; still exported from here
import { AR_STAGES } from "./ar-stages";
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

// r11: A&R is three tabs, each with its own address (/dashboard/ar/...), each loading only its own data (one GET
// /api/ar-lists?view=…):
//   Home (/ar) · My A&R (/ar/mine, /mine/<type>) · Watchlist (/ar/watch: everyone's artists, producers, songs and
//   TikTok sounds in one colour-coded list; /watch/artists|producers|songs|sounds|confirm = one type, /…/by/<userId> =
//   one person's); a row's drawer: /ar/item/<key>
// Outreach and Sounds are gone (r11, the owner): their old addresses open the Watchlist (sounds: its TikTok sounds).
// (2026-11-11, the owner: "maybe we can swap these too") your own before everyone's, as Money's My money before All payments
const AR_PILLS = [["", "Home"], ["mine", "My A&R"], ["watch", "Watchlist"]];
// the old addresses (Summary, Team, Trackers, Radar, Board, Outreach, Sounds, To do's "watch:open:<key>") open their
// new place: the shell rewrites them (components/shared/ar-routes.js); read here too, for a sub handed in directly
export { arSecOf };
// the type filter: its address word and the row type it keeps ("confirm" = the matches still to confirm)
const TYPE_SEG = { artists: "artist", producers: "producer", songs: "song", sounds: "sound", confirm: "confirm" };
const SEG_OF = Object.fromEntries(Object.entries(TYPE_SEG).map(([k, v]) => [v, k]));
// where an address points inside A&R: { view, type, person, item, pill }
export function arPlace(sub) {
  const parts = arSecOf(sub).split("/").filter(Boolean);
  const [a, b] = parts;
  if (!a) return { view: "home", pill: "" };
  // a row's drawer opens over the Watchlist
  if (a === "item" && b) return { view: "watch", type: "", person: "", item: parts.slice(1).join("/"), pill: "watch" };
  if (a === "mine") return { view: "mine", type: TYPE_SEG[b] || "", person: "", pill: "mine" };
  if (a === "watch") {
    const by = parts.indexOf("by");
    return { view: "watch", type: TYPE_SEG[b] || "", person: by >= 0 ? parts.slice(by + 1).join("/") : "", pill: "watch" };
  }
  // an address A&R doesn't have: say so (never a silent Home)
  return { view: "home", pill: "", unknown: parts.join("/") };
}
// a Watchlist (or My A&R) address: its type, and the person it's filtered to
const listPath = (view, type, person) => [view, SEG_OF[type], person && view === "watch" ? `by/${person}` : ""].filter(Boolean).join("/");
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
const HOME_URL = "/api/ar-lists?view=home";
export function ARAdmin({ onGo, sub, onSub, chip = null }) {
  const at = arPlace(sub);
  const go = (path) => onGo("ar", path || null);
  // Home's numbers, read here so its freshness and "N to confirm" sit in the head (like the Dashboard's)
  const home = useArView(at.view === "home" ? HOME_URL : null);
  return (
    <div className="ar">
      <div className="admin-head ar-top">
        <h2>A&amp;R</h2>
        <div className="subnav ar-pills" data-m-scroll>
          {AR_PILLS.map(([id, label]) => (
            <button key={id || "home"} className={at.pill === id ? "subpill active" : "subpill"} aria-current={at.pill === id ? "page" : undefined} data-ar-pill={id || "home"}
              onClick={(e) => { go(id); revealChip(e.currentTarget); }}>{label}</button>
          ))}
        </div>
        <span className="ar-top-r">{at.view === "home" && <ArFresh data={home.data} onConfirm={() => go("watch/confirm")} />}{chip}</span>
      </div>
      {at.unknown && <p className="hint ar-unknown" role="status" data-ar-unknown>There's no A&amp;R page at “{at.unknown}”. Here's A&amp;R Home.</p>}
      {at.view === "home" && <ArHome data={home.data} err={home.err} retry={home.retry} reload={home.load} founder={!!home.data?.founder} onOpen={(key) => go(`item/${key}`)} />}
      {at.view !== "home" && <ArListView key={at.view} at={at} go={go} />}
    </div>
  );
}
const EMPTY = {
  mine: "Your list is empty. Paste a Spotify, TikTok, Instagram or YouTube link above: it goes on your list.",
  watch: "Nothing on the Watchlist yet. Paste a Spotify, TikTok, Instagram or YouTube link above.",
  artist: "No artists on the Watchlist yet.", producer: "No producers yet. Open an artist and switch them to Producer, or pick Producer when you add one.",
  song: "No songs on the Watchlist yet.", sound: "No TikTok sounds yet. Paste a sound's link (tiktok.com/music/…) to track it.", confirm: "Every match is confirmed.",
};
// the matches still to confirm: artists Luminate only named, songs matched by their ISRC
const toConfirm = (r) => (r.kind === "artist" && r.match === "name") || (r.kind === "song" && r.match === "isrc");
const hasType = (r, t) => (!t ? true : t === "confirm" ? toConfirm(r) : typeOf(r) === t);
// which grid's columns a type gets
const GRID_OF = { "": "all", artist: "watch", producer: "watch", song: "songs", sound: "sounds", confirm: "confirm" };
// the person chips for the rows shown: Everyone, the Luminate import, then each person by how many (the server's names)
function peopleFor(rows, known = []) {
  const n = new Map(), names = new Map(known.map((p) => [p.id, p]));
  for (const r of rows) for (const w of r.addedBy) { if (!names.has(w.id)) names.set(w.id, { id: w.id, name: w.name }); }
  for (const r of rows) for (const id of new Set(r.addedBy.map((w) => w.id))) n.set(id, (n.get(id) || 0) + 1);
  const people = [...n].map(([id, c]) => ({ ...names.get(id), id, n: c }));
  return [{ id: "", name: "Everyone", n: rows.length, all: true }, ...people.sort((a, b) => (b.team ? 1 : 0) - (a.team ? 1 : 0) || b.n - a.n || String(a.name).localeCompare(String(b.name)))];
}
function ArListView({ at, go }) {
  // the Watchlist reads every row once (view=team: all of everyone's) and filters here, so a type or person tap is instant
  const url = `/api/ar-lists?view=${at.view === "mine" ? "mine" : "team"}`;
  const v = useArView(url);
  const [open, setOpen] = useState(at.item || null);
  const [flash, setFlash] = useState(null);
  const [note, setNote] = useState(null);
  useEffect(() => { setOpen(at.item || null); }, [at.item]);
  const d = v.data;
  const all = d?.rows || [];
  const me = d?.me || null;
  const type = at.type || "";
  const person = at.view === "watch" ? at.person || "" : "";
  const byPerson = person ? all.filter((r) => r.addedBy.some((w) => w.id === person)) : all;
  const rows = byPerson.filter((r) => hasType(r, type));
  const people = peopleFor(all.filter((r) => hasType(r, type)), d?.people || []);
  const counts = Object.fromEntries(["", "artist", "producer", "song", "sound", "confirm"].map((t) => [t, byPerson.filter((r) => hasType(r, t)).length]));
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
  // what of yours ends within 7 days (or has ended), with one Renew for all of it: red, on My A&R and the Watchlist (2026-11-10)
  const ending = me ? all.map((r) => r.addedBy.find((w) => w.id === me)).filter((w) => w && !w.never && (w.state === "soon" || w.state === "expired")) : [];
  const endingText = endingWords(ending);
  const added = (res) => {
    v.load().then(() => {
      const key = res?.subject;
      if (!key) return;
      setFlash(key);
      setTimeout(() => setFlash(null), 1600);
      setTimeout(() => document.querySelector(`[data-row="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 60);
    });
  };
  const flashKey = flash ? all.find((r) => r.subjects.includes(flash))?.key : null;
  const typeTabs = [["", "All"], ["artist", "Artists"], ["producer", "Producers"], ["song", "Songs"], ["sound", "TikTok sounds"]];
  return (
    <div className="ar-list" data-ar-view={at.view} data-ar-type={type || "all"}>
      <ArPasteBar view={at.view} onAdded={added} onOpen={(key) => key && setOpen(key)} />
      {/* r11 (A2): the type filter, colour-coded like each row's chip; To confirm (amber) only while something waits */}
      <div className="ar-types" role="tablist" aria-label="Type" data-m-scroll data-type-tabs>
        {typeTabs.map(([t, label]) => (
          <button key={t || "all"} type="button" role="tab" aria-selected={type === t} className={type === t ? "on" : ""} data-type={t || undefined} data-type-tab={t || "all"}
            onClick={() => go(listPath(at.view, t, person))}>{t && <i aria-hidden="true" />}{label} <b>{counts[t]}</b></button>
        ))}
        {(counts.confirm > 0 || type === "confirm") && (
          <button type="button" role="tab" aria-selected={type === "confirm"} className={type === "confirm" ? "on warn" : "warn"} data-type-tab="confirm"
            onClick={() => go(listPath(at.view, "confirm", person))}>To confirm <b>{counts.confirm}</b></button>
        )}
      </div>
      {/* who added what: Everyone, then each person with something of this type (r10 fix, N7) */}
      {at.view === "watch" && people.length > 2 && (
        <div className="ar-people" role="tablist" aria-label="Added by" data-m-scroll data-person-tabs>
          {people.map((p) => (
            <button key={p.id || "all"} type="button" role="tab" aria-selected={person === p.id} className={person === p.id ? "on" : ""}
              onClick={() => go(listPath("watch", type, p.id))} data-person-tab={p.id || "all"}>{p.name} <b>{p.n}</b></button>
          ))}
        </div>
      )}
      {ending.length > 0 && (
        <p className="ar-banner ending" role="status" data-mine-ending>
          <Clock size={14} aria-hidden="true" /> {endingText} ·{" "}
          <button type="button" className="inline-link" onClick={async () => { let bad = 0; for (const w of ending) await arTrackerPost({ action: "renew", entryId: w.entryId }).catch(() => { bad++; }); setNote(bad ? { ok: false, text: `${bad} didn't renew. Try again.` } : { ok: true, text: "Renewed." }); v.load(); }} data-renew-all>{ending.length === 1 ? "Renew it" : ending.length === 2 ? "Renew both" : `Renew all ${ending.length}`}</button>
        </p>
      )}
      {note && <p className={`hint ${note.ok ? "ok-text" : "err-text"}`} role="status" data-list-note>{note.text}</p>}
      {v.err && <ArDataError err={v.err} retry={v.retry} />}
      {!d && !v.err && <p className="muted dash-wait">Loading…</p>}
      {d && (
        <ArGrid id={`${at.view}-${GRID_OF[type]}`} view={at.view === "mine" && !type ? "mine" : GRID_OF[type]} rows={rows} asOf={d.asOf || {}} people={people} openKey={open} flashKey={flashKey} momentumReady={!!d.momentumReady}
          onOpen={(r) => setOpen(r.key)} ctx={ctx} empty={person ? "Nothing from this person here." : at.view === "mine" && !type ? EMPTY.mine : EMPTY[type || "watch"]} />
      )}
      {open && <ArDrawer itemKey={open} me={me} founder={!!d?.founder} onClose={close} onChanged={() => v.load()} />}
    </div>
  );
}
const arTrackerPost = (body) => fetch("/api/ar-trackers", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "defied-site" }, body: JSON.stringify(body) })
  .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok || j.error) throw new Error(j.error || "That didn't save — try again."); return j; });
const STAGE_OF_STATUS = { "Not Contacted": "reach", Researching: "reach", "": "reach", Contacted: "reached", "In Talks": "talking", "Offer Out": "offer", Signed: "signed", Passed: "passed" };
export const stageOfStatus = (s) => STAGE_OF_STATUS[String(s ?? "").trim()] || "other";
// the status a move saves: "To reach out" keeps Researching when that's what it was
export const statusForStage = (id, current) => (id === "passed" ? "Passed" : id === "reach" && String(current ?? "").trim() === "Researching" ? "Researching" : AR_STAGES.find((s) => s.id === id)?.status);
export const wholeMoney = (n) => `$${fmt(Math.round(Number(n) || 0))}`;
// stream counts in A&R, one rule everywhere (Board card, Producers tiles, panel, How we estimate): from a
// million, up to two decimals rounded half-up (28.9M · 14.45M · 1.48M), from a thousand whole K (845K)
export const bigNum = (n) => {
  const a = Math.abs(Number(n) || 0), s = n < 0 ? "-" : "";
  return a >= 1e6 ? `${s}${Math.round(a / 1e4) / 100}M` : a >= 1e3 ? `${s}${Math.round(a / 1e3)}K` : `${s}${fmt(Math.round(a))}`;
};
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

// The sheet's Year 1 is the run-rate (B9) less one year's decay (B8): H × B9 × (1 − I), so 30% and 25%
// make 22.5%. Say that share, not B9 alone, or a hand check comes out a third too high. One decimal,
// so 22.5% never shows as 23%. null when either lever is missing.
export const pct1 = (x) => `${Math.round(x * 1000) / 10}%`;
// "how" says it in words: "30% of all-time a year, less a quarter of that"
const FRACTION_WORDS = { 0.5: "half", 0.25: "a quarter", 0.2: "a fifth", 0.1: "a tenth", 0.75: "three quarters" };
const partWords = (x) => FRACTION_WORDS[Math.round(x * 1e6) / 1e6] || (Math.abs(x - 1 / 3) < 1e-6 ? "a third" : pct1(x));
export const yearOne = (a) => (a?.runRate != null && a?.decayRate != null
  ? { share: pct1(a.runRate * (1 - a.decayRate)), run: pct1(a.runRate), decay: pct1(a.decayRate), how: `${pct1(a.runRate)} of all-time a year, less ${partWords(a.decayRate)} of that` } : null);

const weekday = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" });
