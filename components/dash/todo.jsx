import React, { useState, useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { Plus, Disc3, RefreshCw, AlertTriangle, CheckCircle2, ChevronRight, CalendarDays, ChevronLeft, List as ListIcon } from "lucide-react";
import { dueBucket, nyDay, nyShort } from "../../lib/todo-rank";
import { AREA_SECTION } from "../../lib/roles";
import { TODO_AREAS } from "./access";
import { fullSiteSync, shareFixesOf } from "./catalog-data";
import { IsrcPicks, RowMenu, dupeWords, findTabClient, isrcPicksOf, likelyDupes, noTabNames, shortDay, useMedia } from "./helpers";
import { useHome } from "./home-data";
import { dataPost } from "./chips";
import { DropNote, Field, fmt, money } from "./ui";
import { AskCard } from "../portal/ask";
import { ExtLink } from "../shared/ui";
import { syncFix } from "./todo-data";
import { PanelWait } from "./sections";
export { useCuTasks, useSyncChecks, todoItems, useSplitFixes, useAutoConfirm, syncFix, useSeeds } from "./todo-data";

// The panels a row opens in place come from other areas (Money's log preview, Publishing's split and merge
// cards, the true-up, Site's messages): each one's code loads the first time it opens,
// so To do and Home don't download every area's code up front (list B #11).
const panel = (load, name) => dynamic(() => load().then((m) => m[name]), { ssr: false, loading: PanelWait });
const AccountingAdmin = panel(() => import("./money"), "AccountingAdmin");
const SubsAdmin = panel(() => import("./admin"), "SubsAdmin");
const DupeMerge = panel(() => import("./catalog"), "DupeMerge");
const SongsToUpdate = panel(() => import("./catalog"), "SongsToUpdate");
const SplitsToFix = panel(() => import("./catalog"), "SplitsToFix");
const SongManager = panel(() => import("../portal/ClientPortal"), "SongManager");
const TrueUpPanel = panel(() => import("../TrueUp"), "TrueUpPanel"); // TRUEUP-HOOK: the monthly Luminate true-up
const IsrcFinder = panel(() => import("./isrc-finder"), "IsrcFinder"); // r11: the ISRC finder, out of Publishing

// One To do row: the sentence opens it, the button does its one thing; open, the panel below holds
// exactly the controls it needs (the same ones the tabs used to hold). Home's biggest tasks use it too.
// (a One tap row's button goes straight to its preview, "Log all 4" to the log preview; the sentence, or a
// link to the item, opens the list behind it)
export function TodoRow({ it, open, onToggle, ctx }) {
  const [viaCta, setViaCta] = useState(false);
  return (
    <div className={open ? "todo-item open" : "todo-item"} data-item={it.k} data-area={it.area}>
      <div className="attn-row" data-task={it.k} data-area={it.area}>
        <button type="button" className="attn-main todo-open" aria-expanded={open} onClick={() => { setViaCta(false); onToggle(); }}>
          <b>{it.t}</b>{it.d && <em>{it.d}</em>}
        </button>
        <button type="button" className={it.tap && !open ? "btn sm" : "btn ghost sm"} data-cta={it.k} onClick={() => { setViaCta(!open && !!it.tap); onToggle(); }}>{open ? "Close" : it.cta}</button>
      </div>
      {open && <div className="todo-panel" data-panel={it.k}><TodoPanel it={it} ctx={ctx} onClose={onToggle} viaCta={viaCta} /></div>}
    </div>
  );
}
function TodoPanel({ it, ctx, onClose, viaCta = false }) {
  const { db, commit, onGo } = ctx;
  switch (it.panel) {
    case "splits": case "update": case "dupes": return <PubFix kind={it.panel} ctx={ctx} viaCta={viaCta} />;
    case "shareSite": case "shareSheet": return <ShareFix kind={it.panel} ctx={ctx} viaCta={viaCta} />;
    case "tabs": return <SheetTabFix ctx={ctx} />;
    case "log": case "check": return <AccountingAdmin part={it.panel} startLogAll={it.panel === "log" && viaCta} onCounts={(c) => ctx.setAcct((x) => ({ ...x, ...c }))} onGo={onGo} />;
    case "seeds": return <SeedList area={it.seedArea} ctx={ctx} />;
    case "arConfirm": return <div className="todo-sublist"><p className="hint">Their Luminate numbers stay as history. Once you tap the right Spotify profile, its numbers start with the next update.</p><button type="button" className="btn sm" onClick={() => ctx.onGo("ar", "watch/confirm")} data-go-confirm>Open the Watchlist's confirm list</button></div>;
    case "trueup": case "trueup-new": case "trueup-schedule": return <TrueUpPanel kind={it.panel} ctx={ctx} />; // TRUEUP-HOOK
    case "isrc": return <IsrcFinder db={db} songInfo={ctx.songInfo} reloadSongInfo={ctx.reloadSongInfo} />;
    case "messages": return <SubsAdmin db={db} commit={commit} />;
    case "syncfix": return <SyncFix check={it.check} ctx={ctx} />;
    default: return null;
  }
}

// Publishing's lists in place: Splits to confirm, Songs to update and the merge card. Fix / Update open
// the song's editor right here (SongManager's own editor, nothing else of the client's page)
// (Merge, the row's button, opens the merge card at once; the sentence or a link shows the line with Review)
function PubFix({ kind, ctx, viaCta = false }) {
  const { db, commit, songInfo, reloadSongInfo, onGo } = ctx;
  const dupes = useMemo(() => likelyDupes(db, songInfo), [db, songInfo]);
  const [edit, setEdit] = useState(null);
  const n = useRef(0);
  const openFix = (id, field = null) => { const p = db.placements.find((x) => x.id === id); if (p) setEdit({ id, field, n: ++n.current, clientId: p.clientId }); };
  const [dupeKey, setDupeKey] = useState(() => (kind === "dupes" && viaCta ? dupes[0]?.key || null : null));
  const [note, setNote] = useState(null);
  const dupeOpen = dupeKey && dupes.find((x) => x.key === dupeKey);
  const openDupe = () => { setNote(null); setDupeKey(dupes[0]?.key || null); };
  return (
    <>
      {kind === "splits" && <SplitsToFix db={db} commit={commit} songInfo={songInfo} reloadSongInfo={reloadSongInfo} onFix={openFix} onGo={onGo} dupes={dupes} onDupe={openDupe} />}
      {kind === "update" && <SongsToUpdate db={db} songInfo={songInfo} onFix={openFix} dupes={dupes} onDupe={openDupe} />}
      {kind === "dupes" && (dupes.length
        ? <p className="pub-tasks dupe-line" data-dupe-line>{dupeWords(dupes)} · <button className="inline-link" data-dupe-review onClick={openDupe}>Review</button></p>
        : <p className="home-muted acct-clear"><CheckCircle2 size={15} /> No possible duplicates left.</p>)}
      <DropNote note={note} />
      {/* a merge can clear the row this sits in: its result goes on To do's own line (ctx.flash) when there is one */}
      {dupeOpen && <DupeMerge db={db} commit={commit} songInfo={songInfo} reloadSongInfo={reloadSongInfo} pair={dupeOpen} onClose={() => setDupeKey(null)} onDone={(r) => { setDupeKey(null); if (ctx.flash) ctx.flash(r); else setNote(r); }} />}
      {edit && <SongManager editorOnly db={db} commit={commit} clientId={edit.clientId} isStaff songInfo={songInfo} reloadSongInfo={reloadSongInfo} fix={{ id: edit.id, n: edit.n, field: edit.field }} onFix={openFix} onFixList={() => setEdit(null)} onGo={onGo} />}
    </>
  );
}

// The two shares with one clear answer (lib/split-fixes.js), each One tap with its preview first:
//   shareSite  no split here while the sheet has 100%: the client at 100% on the site (DB only; the sheet has it)
//   shareSheet 100% here while the sheet's Writer Share is blank (it earns nothing there): 100% goes into that one
//              cell (PUB_SHARE_WRITES; off, the card says which cells to type it in)
function ShareFix({ kind, ctx, viaCta = false }) {
  const { db, commit, fixes } = ctx;
  const fx = useMemo(() => shareFixesOf(db), [db]);
  const items = kind === "shareSite" ? fx.site : fx.sheet;
  const [ask, setAsk] = useState(viaCta && items.length > 0);
  const tabOf = (c) => c.sheetTabName?.trim() || c.name;
  const writes = !!fixes?.data?.writes;
  const flash = (n) => (ctx.flash ? ctx.flash(n) : null);
  const useSheet = async () => {
    const by = new Map(items.map((x) => [x.p.id, x.splits]));
    const done = await commit({ ...db, placements: db.placements.map((p) => (by.has(p.id) ? { ...p, splits: by.get(p.id) } : p)) });
    setAsk(false);
    if (done) flash({ text: `Done. ${items.length === 1 ? `"${items[0].p.song || "Untitled"}" has` : `${items.length} songs have`} the sheet's split now (100%). Nothing was written to the sheet.` });
  };
  const fill = async () => {
    const ok = [], bad = [];
    for (const x of items) { // one at a time, each re-checked on the server just before its cell is written
      const r = await fetch("/api/split-fixes", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify({ action: "fill", placementId: x.p.id }) }).catch(() => null);
      const j = r ? await r.json().catch(() => ({})) : {};
      if (r?.ok) ok.push(`${j.tab} ${j.cell}`); else bad.push(`"${x.p.song || "Untitled"}": ${j.error || "no answer"}`);
    }
    setAsk(false);
    // the sheet's new earnings come back with a pull (it reads every tab again, as Pull from the sheet does)
    if (ok.length) await fullSiteSync(db, commit).catch(() => {});
    flash({ warn: !!bad.length, text: [ok.length && `Filled in 100% on the sheet (${ok.join(", ")}).`, bad.length && `Not written: ${bad.join("; ")}.`].filter(Boolean).join(" ") });
  };
  const cells = items.map((x) => `${tabOf(x.client)} tab, D${x.row}`);
  return (
    <div className="todo-sublist" data-share-fix={kind}>
      {items.map((x) => (
        <div key={x.p.id} className="fix-row" data-song={x.p.id}>
          <span className="fix-song"><span className="fix-who">{x.client.name} · </span>{x.p.song || "Untitled"}</span>
          <span className="fix-mid"><span className="fix-sheet" data-sheet-change={kind}>{kind === "shareSite" ? `no split here → ${x.client.name} 100%, as on the sheet` : `sheet blank (D${x.row}) → 100%, as here`}</span></span>
        </div>
      ))}
      {!items.length ? <p className="home-muted acct-clear"><CheckCircle2 size={15} /> Every share matches the sheet.</p>
        : <button className="btn sm" data-share-go={kind} onClick={() => setAsk(true)}>{kind === "shareSite" ? "Use the sheet's split" : items.length === 1 ? "Fill in 100%" : `Fill in ${items.length}`}</button>}
      {ask && kind === "shareSite" && (
        <AskCard title={items.length === 1 ? "Use the sheet's split?" : `Use the sheet's split for ${items.length} songs?`} goLabel="Use the sheet's split" busyLabel="Saving…" plain go={useSheet} onClose={() => setAsk(false)}>
          <p data-ask-writes>Saved on the site only. The sheet already says 100%, so nothing is written to it.</p>
          <ul className="ask-places">{items.map((x) => <li key={x.p.id}>{x.p.song || "Untitled"}: no split → {x.client.name} 100%</li>)}</ul>
        </AskCard>
      )}
      {ask && kind === "shareSheet" && (
        <AskCard title={items.length === 1 ? "Fill in the sheet's blank share?" : `Fill in ${items.length} blank shares?`} goLabel={items.length === 1 ? "Fill in 100%" : `Fill in ${items.length}`} busyLabel="Writing…" plain goDisabled={!writes} go={fill} onClose={() => setAsk(false)}>
          <p data-ask-writes>Writes 100% into the Writer Share cell only ({cells.join("; ")}). Nothing else on the sheet changes. The song's earnings on the sheet go up with it.</p>
          <ul className="ask-places">{items.map((x) => <li key={x.p.id}>{x.p.song || "Untitled"} ({x.client.name}): blank → 100%</li>)}</ul>
          {!writes && <p className="hint" data-ask-off>Writing to the pub sheet from here isn't switched on yet. Type 100% into {cells.length === 1 ? "that cell" : "those cells"} instead.{fixes?.data?.sheetUrl && <> <ExtLink className="inline-link" href={fixes.data.sheetUrl}>Open the sheet ↗</ExtLink></>}</p>}
        </AskCard>
      )}
    </div>
  );
}

// "X's numbers can't sync": each client's Sheet tab name, typed right here, then the sheet pull checks it
function SheetTabFix({ ctx }) {
  const { db, commit, songInfo, reloadSongInfo } = ctx;
  const names = noTabNames(db, songInfo);
  const [typed, setTyped] = useState({});
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const save = async (c) => {
    setBusy(c.id); setNote(null);
    try {
      const next = await commit({ ...db, clients: db.clients.map((x) => (x.id === c.id ? { ...x, sheetTabName: (typed[c.id] ?? "").trim() } : x)) });
      if (!next) return;
      const { missing } = await fullSiteSync(next, commit);
      await reloadSongInfo();
      setNote(missing.includes(c.name) ? { warn: true, text: `Saved, but the pub sheet still has no tab called ${(typed[c.id] ?? "").trim() || c.name}.` } : { text: `Saved. ${c.name}'s numbers sync from the ${(typed[c.id] ?? "").trim() || c.name} tab now.` });
    } finally { setBusy(null); }
  };
  return (
    <div className="todo-sublist">
      {names.map((n) => findTabClient(db, n)).filter(Boolean).map((c, i) => (
        <div key={c.id} className="fix-row" data-tab-client={c.id}>
          <span className="fix-song">{c.name}</span>
          <label className="fix-mid fld todo-tab-fld"><input className="todo-input" data-sheet-tab value={typed[c.id] ?? c.sheetTabName ?? ""} placeholder="Sheet tab name" aria-label={`${c.name}'s sheet tab name`} autoFocus={i === 0} onChange={(e) => setTyped((t) => ({ ...t, [c.id]: e.target.value }))} />
            <span className="hint">The pub sheet has no tab called {c.sheetTabName?.trim() || c.name}.</span></label>
          <span className="fix-acts"><button className="btn sm" disabled={busy === c.id || !(typed[c.id] ?? "").trim()} onClick={() => save(c)}>{busy === c.id ? "Saving…" : "Save"}</button></span>
        </div>
      ))}
      <DropNote note={note} />
    </div>
  );
}

// a sync check's fix, in place: pull the sheet, rebuild STREAM DATA, or what to do about INFO
function SyncFix({ check, ctx }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const run = () => syncFix(check, ctx, setBusy, setNote);
  return (
    <div className="todo-sublist">
      <p className="hint">{check.text}{check.detail ? ` ${check.detail}` : ""}</p>
      {check.fix?.kind === "url" ? <p className="hint">Add the missing names on INFO (or fix their spelling) so payments find their client. <ExtLink className="inline-link" href={check.fix.url}>Open the sheet ↗</ExtLink></p>
        : check.fix && <button className="btn sm" data-sync-fix={check.id} disabled={busy} onClick={run}>{busy ? "Working…" : check.fix.label}</button>}
      <DropNote note={note} />
    </div>
  );
}
// To do's list for one area: each line finished right here (Yes to the match Spotify found, a pasted link,
// or Not on Spotify in its ⋯ menu); an artist can get their Instagram / TikTok / YouTube at the same time
function SeedList({ area, ctx }) {
  const rows = (ctx.seeds?.data?.todo || []).filter((r) => r.area === area);
  const [note, setNote] = useState(null);
  return (
    <div className="todo-sublist seed-list" data-seed-list={area}>
      <p className="hint">From the old Luminate {area === "ar" ? "Artist and Song Trackers" : "Admin Catalogs"}. Once one is on Spotify here, its numbers come in with the next daily update; its Luminate numbers stay as history.</p>
      {rows.map((r) => <SeedRow key={r.lumId} r={r} picks={r.kind !== "artist" && !r.isrc ? isrcPicksOf(ctx.songInfo, r.placementIds || []) : []}
        onDone={(text) => { const last = rows.length === 1; ctx.seeds.drop(r.lumId); if (last && ctx.flash) ctx.flash({ text }); else setNote({ text }); }} />)}
      {!rows.length && <p className="home-muted acct-clear"><CheckCircle2 size={15} /> All found.</p>}
      <DropNote note={note} />
    </div>
  );
}
const SOCIALS = [["instagram", "Instagram"], ["tiktok", "TikTok"], ["youtube", "YouTube"]];
// picks: the ISRC finder's guesses for a song with no ISRC (one tap: kept on the song, then looked up on Spotify)
function SeedRow({ r, picks = [], onDone }) {
  const artist = r.kind === "artist";
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [url, setUrl] = useState("");
  const [other, setOther] = useState(!r.spotify);
  const [so, setSo] = useState({ instagram: r.socials?.instagram || "", tiktok: r.socials?.tiktok || "", youtube: r.socials?.youtube || "" });
  const [isrc, setIsrc] = useState(r.isrc || "");
  const send = async (body, done) => {
    setBusy(true); setErr(null);
    try {
      // the socials first (they're kept whatever happens next), then the answer that takes the line off
      if (artist && body.op !== "skip" && SOCIALS.some(([k]) => so[k].trim() !== (r.socials?.[k] || ""))) await dataPost({ action: "seed", lumId: r.lumId, op: "socials", socials: so });
      const out = await dataPost({ action: "seed", lumId: r.lumId, ...body });
      // an ISRC Spotify has no song for: kept, and the line stays for a link
      if (body.op === "isrc" && out.match !== "matched") { setIsrc(out.isrc || body.isrc); setErr("Spotify has no song with that ISRC. Paste its Spotify link instead."); setBusy(false); return; }
      onDone(done);
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  const what = artist ? r.name : `"${r.name}"`;
  return (
    <div className="seed-row" data-seed={r.lumId} data-status={r.status}>
      <div className="seed-head">
        <span className="lm-cover">{r.spotify?.image && !other ? <img src={r.spotify.image} alt="" loading="lazy" decoding="async" /> : <Disc3 size={16} />}</span>
        <span className="lm-song-main"><strong>{r.name}</strong>
          <span>{[r.list, r.artist, r.atd != null && `Luminate: ${fmt(r.atd)} all-time on ${shortDay(r.atdOn)}`].filter(Boolean).join(" · ")}</span></span>
      </div>
      {!other ? (
        <div className="seed-acts">
          <span className="seed-match">Spotify has <ExtLink className="inline-link" href={r.spotify.url}>{r.spotify.name} ↗</ExtLink>. Is that {artist ? "them" : "it"}?</span>
          <span className="seed-btns">
            <button className="btn sm" data-seed-yes disabled={busy} onClick={() => send({ op: "confirm" }, `Tracking ${what} from the next update.`)}>{busy ? "Saving…" : "Yes"}</button>
            <button className="btn ghost sm" disabled={busy} onClick={() => setOther(true)}>No</button>
          </span>
        </div>
      ) : (
        <div className="seed-acts">
          <input className="seed-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={artist ? "Their Spotify artist link" : "The song's Spotify link"} aria-label={`Spotify link for ${r.name}`} />
          <span className="seed-btns">
            <button className="btn sm" data-seed-save disabled={busy || !url.trim()} onClick={() => send({ op: "link", url }, `Tracking ${what} from the next update.`)}>{busy ? "Saving…" : "Save"}</button>
            <RowMenu label={`More for ${r.name}`} items={[{ label: "Not on Spotify: don't track", onClick: () => send({ op: "skip" }, `${r.name} won't be tracked. Its Luminate numbers stay as history.`) }]} />
          </span>
        </div>
      )}
      {!artist && other && (isrc
        ? <p className="hint seed-isrc">ISRC <code>{isrc}</code> (Spotify has nothing under it yet)</p>
        : picks.length > 0 && <IsrcPicks list={picks} busy={busy} onPick={(c) => send({ op: "isrc", isrc: c.isrc, source: c.source }, `Found "${r.name}" on Spotify by its ISRC.`)} />)}
      {artist && (
        <div className="seed-socials">
          {SOCIALS.map(([k, label]) => <input key={k} value={so[k]} onChange={(e) => setSo((x) => ({ ...x, [k]: e.target.value }))} placeholder={`${label} (optional)`} aria-label={`${label} link for ${r.name}`} />)}
        </div>
      )}
      {err && <p className="hint err-text">{err}</p>}
    </div>
  );
}

// ClickUp: one open task. The name opens it in ClickUp; Done ✓ sets it to its list's done status.
const PRIORITY = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };
const CU_BUCKETS = [["overdue", "Overdue"], ["today", "Today"], ["week", "This week"], ["later", "Later"], ["none", "No date"]];
// the name with its ↗ kept on the last word's line (r10, H14: on a phone a wrapped name left it far right)
function CuName({ name }) {
  const i = String(name).lastIndexOf(" ");
  return <>{i > 0 ? `${name.slice(0, i)} ` : ""}<span className="cu-last">{i > 0 ? name.slice(i + 1) : name}{"\u00a0"}<span className="cu-ext" aria-hidden="true">↗</span></span></>;
}
export function CuTodoRow({ t, cu }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const writes = !!cu.data?.writes;
  const b = dueBucket(t.due);
  const list = (cu.data?.lists || []).find((l) => l.key === t.list);
  const done = async () => {
    setBusy(true); setErr(null);
    const r = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify({ action: "done", id: t.id }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r?.ok) return setErr(j.error || "Couldn't reach ClickUp. Try again in a minute.");
    cu.drop(t.id);
  };
  return (
    <div className="attn-row cu-todo" data-cu={t.id} data-area="clickup" data-bucket={b}>
      <span className="attn-main">
        <b><ExtLink href={t.url} className="cu-name" title="Open in ClickUp"><CuName name={t.name} /></ExtLink></b>
        <em>{[list?.name, t.people?.length ? t.people.map((p) => p.name).join(", ") : null, t.due && `${b === "overdue" ? "Late · was due" : "Due"} ${nyShort(t.due)}`, t.priority && t.priority !== "normal" && `${PRIORITY[t.priority] || t.priority} priority`].filter(Boolean).join(" · ")}</em>
        {err && <em className="err-text" role="alert">{err}</em>}
      </span>
      <button type="button" className="btn ghost sm" data-done={t.id} disabled={busy || !writes} title={writes ? "Set it to done in ClickUp" : "Writing to ClickUp isn't switched on yet"} onClick={done}>{busy ? "Saving…" : "Done ✓"}</button>
    </div>
  );
}

// New task: name, list, due day and who, straight into ClickUp
function NewTaskCard({ cu, onClose }) {
  const lists = cu.data?.lists || [], people = cu.data?.people || [];
  const [f, setF] = useState({ name: "", list: "internal", due: "", assignee: "" });
  const [err, setErr] = useState(null);
  const go = async () => {
    setErr(null);
    const r = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify({ action: "create", ...f, assignee: f.assignee || null }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) return setErr(j.error || "Couldn't reach ClickUp. Try again in a minute.");
    cu.add(j.created);
    onClose();
  };
  return (
    <AskCard title="New ClickUp task" goLabel="Add task" busyLabel="Adding…" plain goDisabled={!f.name.trim() || !cu.data?.writes} go={go} onClose={onClose}>
      {!cu.data?.writes && <p className="hint">Writing to ClickUp isn't switched on yet.</p>}
      <Field label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-new-name autoFocus />
      <label className="fld"><span>List</span>
        <select data-new-list value={f.list} onChange={(e) => setF({ ...f, list: e.target.value })}>{lists.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}</select></label>
      <label className="fld"><span>Due</span><input type="date" data-new-due value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></label>
      <label className="fld"><span>Who</span>
        <select data-new-who value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })}><option value="">Nobody yet</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      {err && <p className="hint err-text" role="alert">{err}</p>}
    </AskCard>
  );
}

// ClickUp's part of To do: due groups, filtered by list and person
function CuSection({ cu, list, person, setList, setPerson, onNew }) {
  const d = cu.data;
  const tasks = (d?.tasks || []).filter((t) => (list === "all" || t.list === list) && (person === "all" || (t.people || []).some((p) => String(p.id) === person)));
  const people = d?.people || [];
  const down = (d?.lists || []).filter((l) => l.error);
  // r10 (C2): lists ClickUp hides from the Defied Bot (not shared with it) are named, never shown as empty
  const hiddenL = down.filter((l) => l.noAccess), otherDown = down.filter((l) => !l.noAccess);
  const names = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).map((l) => l.name).join(", ")} and ${xs.at(-1).name}` : xs[0]?.name || "");
  return (
    <div className="todo-cu" data-area="clickup">
      <div className="todo-group todo-cu-head" data-group="clickup">
        <span>ClickUp{d ? ` · ${tasks.length}` : ""}</span>
        <span className="todo-cu-tools">
          <select aria-label="List" data-cu-list value={list} onChange={(e) => setList(e.target.value)}>
            <option value="all">All lists</option>{(d?.lists || []).map((l) => <option key={l.key} value={l.key}>{l.name}{l.noAccess ? " (not shared)" : l.count ? ` (${l.count})` : ""}</option>)}
          </select>
          <select aria-label="Person" data-cu-person value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="all">Everyone</option>{people.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
          </select>
          <button type="button" className="btn ghost sm" data-new-task onClick={onNew}><Plus size={14} /> New task</button>
        </span>
      </div>
      {!d && !cu.failed && <p className="todo-line"><RefreshCw size={14} className="spin" /> Loading ClickUp…</p>}
      {cu.failed && !d && <p className="todo-line"><AlertTriangle size={14} /> Couldn't reach ClickUp. <button className="inline-link" onClick={() => cu.load(true)}>Try again</button></p>}
      {d && CU_BUCKETS.map(([b, label]) => {
        const xs = tasks.filter((t) => dueBucket(t.due) === b).sort((x, y) => (x.due ? Date.parse(x.due) : Infinity) - (y.due ? Date.parse(y.due) : Infinity));
        if (!xs.length) return null;
        return (
          <React.Fragment key={b}>
            <div className="todo-sub" data-bucket-head={b}>{label} · {xs.length}</div>
            {xs.map((t) => <CuTodoRow key={t.id} t={t} cu={cu} />)}
          </React.Fragment>
        );
      })}
      {d && !tasks.length && down.length < d.lists.length && <p className="todo-line">Nothing open{list !== "all" || person !== "all" ? " for this filter" : ""}{down.length ? " on the lists that could be read" : ""}.</p>}
      {hiddenL.length > 0 && <p className="todo-line cu-noaccess" data-cu-noaccess={hiddenL.length}><AlertTriangle size={14} /> <span>{hiddenL.length === 1 ? hiddenL[0].error : `Defied Bot can't see ${names(hiddenL)}. Share them with Defied Bot in ClickUp.`} <button className="inline-link" onClick={() => cu.load(true)}>Check again</button></span></p>}
      {otherDown.length > 0 && <p className="todo-line"><AlertTriangle size={14} /> {down.length === d.lists.length && !hiddenL.length ? "Couldn't reach ClickUp." : `Couldn't read ${otherDown.map((l) => l.name).join(", ")}.`} <button className="inline-link" onClick={() => cu.load(true)}>Try again</button></p>}
    </div>
  );
}

const AREA_CHIPS = [["all", "All"], ["money", "Money"], ["roster", "Publishing"], ["ar", "A&R"], ["clickup", "ClickUp"], ["site", "Site"]];
export function TodoPage({ ctx, todo, sub, onSub, areaN }) {
  const isArea = TODO_AREAS.includes(sub);
  const [area, setArea] = useState(isArea ? sub : "all");
  const [view, setView] = useState(sub === "calendar" ? "calendar" : "list");
  const [open, setOpen] = useState(() => new Set(sub && !isArea && sub !== "calendar" ? [sub] : []));
  const [list, setList] = useState("all"), [person, setPerson] = useState("all");
  const [newTask, setNewTask] = useState(false);
  // what an action just did, said once above the list (its own row may be gone with it)
  const [flash, setFlash] = useState(null);
  ctx = { ...ctx, flash: setFlash };
  // a link or Back / Forward to an area, an item or the calendar
  useEffect(() => {
    if (TODO_AREAS.includes(sub)) setArea(sub);
    else if (sub === "calendar") setView("calendar");
    else if (sub) { setArea("all"); setView("list"); setOpen((o) => (o.has(sub) ? o : new Set([...o, sub]))); }
  }, [sub]);
  // an opened item asked for by a link: brought into view once it's drawn
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || !sub || isArea || sub === "calendar") return;
    const el = document.querySelector(`.todo-page [data-item="${CSS.escape(sub)}"]`);
    if (el) { landed.current = true; el.scrollIntoView({ block: "start" }); }
  });
  const toggle = (k) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const pick = (a) => { setArea(a); onSub(a === "all" ? null : a); };
  const shown = todo.filter((it) => area === "all" || it.area === area);
  const tap = shown.filter((it) => it.tap), need = shown.filter((it) => !it.tap);
  const cuOn = area === "all" || area === "clickup";
  const { songInfo, songInfoErr, reloadSongInfo } = ctx;
  const allN = todo.length + areaN("clickup");
  return (
    <div className="todo-page">
      <div className="admin-head"><h2>To do</h2>
        <span className="gainer-tabs todo-view" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === "list"} className={view === "list" ? "active" : ""} data-view="list" onClick={() => { setView("list"); if (sub === "calendar") onSub(null); }}><ListIcon size={14} /> List</button>
          <button role="tab" aria-selected={view === "calendar"} className={view === "calendar" ? "active" : ""} data-view="calendar" onClick={() => { setView("calendar"); onSub("calendar"); }}><CalendarDays size={14} /> Calendar</button>
        </span>
      </div>
      {view === "calendar" ? <TodoCalendar ctx={ctx} /> : (
        <>
          <div className="todo-chips" role="tablist" aria-label="Area">
            {AREA_CHIPS.filter(([a]) => a === "all" || ctx.can(AREA_SECTION[a])).map(([a, label]) => { const n = a === "all" ? allN : areaN(a); return (n || a === "all" || a === area) && (
              <button key={a} role="tab" aria-selected={area === a} className={area === a ? "upd-filter on" : "upd-filter"} data-area-chip={a} data-area={a === "all" ? undefined : a} onClick={() => pick(a)}>{label} <span className="todo-chip-n">{n}</span></button>
            ); })}
          </div>
          <DropNote note={flash} />
          <div className="attn home-card todo">
            {tap.length > 0 && <div className="todo-group" data-group="tap">One tap</div>}
            {tap.map((it) => <TodoRow key={it.k} it={it} open={open.has(it.k)} onToggle={() => toggle(it.k)} ctx={ctx} />)}
            {need.length > 0 && <div className="todo-group" data-group="need">Needs you</div>}
            {need.map((it) => <TodoRow key={it.k} it={it} open={open.has(it.k)} onToggle={() => toggle(it.k)} ctx={ctx} />)}
            {!songInfo && !songInfoErr && !ctx.songInfoOff && area !== "clickup" && <p className="todo-line"><RefreshCw size={14} className="spin" /> Checking the songs…</p>}
            {songInfoErr && !songInfo && <p className="todo-line"><AlertTriangle size={14} /> Couldn't load the songs' to-dos. <button className="inline-link" onClick={reloadSongInfo}>Try again</button></p>}
            {!shown.length && (songInfo || ctx.songInfoOff || area === "clickup") && area !== "clickup" && <p className="todo-line todo-clear"><CheckCircle2 size={14} /> Nothing to do here.</p>}
            {cuOn && <CuSection cu={ctx.cu} list={list} person={person} setList={setList} setPerson={setPerson} onNew={() => setNewTask(true)} />}
          </div>
          <DoneForYou ctx={ctx} />
          {newTask && <NewTaskCard cu={ctx.cu} onClose={() => setNewTask(false)} />}
        </>
      )}
    </div>
  );
}

// "Done for you": what the dashboard did by itself, said once. Today that's the ClickUp tasks it keeps
// current (each area's checklist ticks itself); A2 adds what it confirms on its own (an even split the sheet
// already holds), each with Undo (ctx.doneForYou: [{ k, text, undo }]).
const OWN_NAMES = { payments: "Log new payments", "area:publishing": "Publishing", "area:ar": "A&R" };
function DoneForYou({ ctx }) {
  const own = (ctx.cu.data?.own || []).filter((t) => OWN_NAMES[t.kind]);
  const extra = ctx.doneForYou || [];
  if (!own.length && !extra.length) return null;
  return (
    <p className="todo-line todo-done-for-you" data-done-for-you>
      <CheckCircle2 size={14} /> <span>Done for you:{" "}
        {own.length > 0 && <>ClickUp's {own.map((t, i) => <React.Fragment key={t.taskId}>{i ? (i === own.length - 1 ? " and " : ", ") : ""}<ExtLink className="inline-link" href={t.url}>{OWN_NAMES[t.kind]}</ExtLink></React.Fragment>)} {own.length === 1 ? "task keeps itself" : "tasks keep themselves"} up to date.</>}
        {extra.map((x) => <React.Fragment key={x.k}> {x.text}{x.undo && <> <button className="inline-link" data-undo={x.k} onClick={x.undo}>Undo</button></>}</React.Fragment>)}
      </span>
    </p>
  );
}

// To do's Calendar: a month (a week on phones) with ClickUp's due dates and the dashboard's own days.
// Each source gives [{ day: "YYYY-MM-DD" (New York), label, kind, late?, task? }]; Opportunities (B)
// adds its deadlines by adding a source here.
export const CAL_SOURCES = [
  // ClickUp: each open task on its due day
  ({ cu }) => (cu.data?.tasks || []).filter((t) => t.due).map((t) => ({ day: nyDay(t.due), label: t.name, kind: "clickup", late: dueBucket(t.due) === "overdue", task: t })),
  // Money: the days payments came in that the Income tab doesn't have yet
  ({ home }) => {
    const by = new Map();
    for (const p of home?.accounting?.unlogged || []) { const d = nyDay(p.at); by.set(d, [...(by.get(d) || []), p]); }
    return [...by].map(([day, ps]) => ({ day, label: `Log ${ps.length === 1 ? `${ps[0].client || ps[0].payer || "a payment"} ${money(ps[0].amount)}` : `${ps.length} payments`}`, kind: "money", late: true }));
  },
];
export const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function TodoCalendar({ ctx }) {
  const phone = useMedia("(max-width: 599px)");
  const { home } = useHome();
  const today = nyDay(Date.now());
  const [anchor, setAnchor] = useState(today);
  const [picked, setPicked] = useState(today);
  const dow = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
  const first = `${anchor.slice(0, 7)}-01`;
  const start = phone ? addDays(anchor, -dow(anchor)) : addDays(first, -dow(first));
  const days = [];
  if (phone) for (let i = 0; i < 7; i++) days.push(addDays(start, i));
  else for (let d = start; days.length < 42 && (days.length % 7 || d.slice(0, 7) <= anchor.slice(0, 7)); d = addDays(d, 1)) days.push(d);
  const from = days[0], to = days[days.length - 1];
  const events = CAL_SOURCES.flatMap((f) => f({ ...ctx, home }, from, to));
  const on = (d) => events.filter((e) => e.day === d);
  const step = (n) => setAnchor((a) => (phone ? addDays(a, 7 * n) : (() => { const [y, m] = a.split("-").map(Number); const x = new Date(Date.UTC(y, m - 1 + n, 1)); return x.toISOString().slice(0, 10); })()));
  const title = phone ? `${shortDay(from)} – ${shortDay(to)}` : new Date(`${first}T12:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  const chip = (e, i) => <span key={i} className={`cal-ev${e.late ? " late" : ""}`} data-kind={e.kind} data-area={e.kind}>{e.label}</span>;
  return (
    <div className="cal" data-cal={phone ? "week" : "month"}>
      <div className="cal-head">
        <button type="button" className="btn ghost sm" aria-label={phone ? "Last week" : "Last month"} onClick={() => step(-1)}><ChevronLeft size={16} /></button>
        <strong className="cal-title">{title}</strong>
        <button type="button" className="btn ghost sm" aria-label={phone ? "Next week" : "Next month"} onClick={() => step(1)}><ChevronRight size={16} /></button>
        <button type="button" className="inline-link cal-today" onClick={() => { setAnchor(today); setPicked(today); }}>Today</button>
      </div>
      {phone ? (
        <div className="cal-week">
          {days.map((d) => (
            <div key={d} className={`cal-wday${d === today ? " today" : ""}`} data-day={d}>
              <span className="cal-wname">{WEEKDAY_SHORT[dow(d)]} {Number(d.slice(8))}</span>
              <span className="cal-wevs">{on(d).length ? on(d).map(chip) : <span className="muted">—</span>}</span>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="cal-grid" role="grid">
            {WEEKDAY_SHORT.map((w) => <span key={w} className="cal-dow" role="columnheader">{w}</span>)}
            {days.map((d) => {
              const evs = on(d);
              return (
                <button type="button" key={d} role="gridcell" className={["cal-day", d.slice(0, 7) !== anchor.slice(0, 7) && "other", d === today && "today", d === picked && "picked"].filter(Boolean).join(" ")} data-day={d} onClick={() => setPicked(d)}>
                  <span className="cal-n">{Number(d.slice(8))}</span>
                  {evs.slice(0, 3).map(chip)}
                  {evs.length > 3 && <span className="cal-more">+{evs.length - 3} more</span>}
                </button>
              );
            })}
          </div>
          <div className="cal-list" data-picked={picked}>
            <h3 className="lm-h3">{new Date(`${picked}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}</h3>
            {!on(picked).length ? <p className="todo-line">Nothing on this day.</p> : on(picked).map((e, i) => (e.task ? <CuTodoRow key={e.task.id} t={e.task} cu={ctx.cu} />
              : <div key={i} className="attn-row" data-area={e.kind}><span className="attn-main"><b>{e.label}</b></span></div>))}
          </div>
        </>
      )}
    </div>
  );
}
