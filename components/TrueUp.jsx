"use client";
// The monthly Luminate true-up in To do (lib/trueup.js, /api/trueup). Three rows, each finished in place:
//   trueup           "Monthly Luminate update: drop this month's report": the drop box (dry run, Apply, one Undo),
//                    the songs to put in the Luminate report (Copy all, N of 500, Report 1/2 past 500, the songs with
//                    no ISRC and the ISRC finder) and the schedule's end day
//   trueup-new       "N songs to add to the Luminate report": the ones no Luminate file has had yet (every update
//                    counted), Copy all (title, artist, ISRC, Spotify) and Copy ISRCs, the ISRC finder for the rest,
//                    and the drop box: the next export ticks them off (the drop's checklist), any day of the month
//   trueup-setup     "N songs to set up on the pub sheet": Luminate has their numbers, the sheet can't show them yet
//                    (lib/lum-setup.js); Apply does this itself, this carries on when it was cut short
//   trueup-schedule  "Luminate's schedule ends on <day>": I copied it / another day (a Founder)
// The dashboard imports these (TRUEUP-HOOK lines): useTrueUp and trueUpTodoItems in StaffDashboard (from
// trueup-data.js, the shell's small part, so the shell never loads this file), TrueUpPanel in To do's TodoPanel.
import React, { useEffect, useRef, useState } from "react";
import { UploadCloud, RefreshCw, CheckCircle2, AlertTriangle, Copy, Disc3, Check, X } from "lucide-react";
import { store, emit, useTrueUp, reloadTrueUp, shortDay, plural, fmt } from "./trueup-data";
export { reloadTrueUp, useTrueUp, trueUpTodoItems } from "./trueup-data";

const longDay = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "");
const ISRC_SOURCES = { "spotify-link": "the song's Spotify link", deezer: "Deezer", "deezer-artist": "the artist's Deezer page", musicbrainz: "MusicBrainz", manual: "typed in" };
const setRecent = (x) => { store.recent = x; if (store.d) store.d = { ...store.d, recent: x }; emit(); };
async function post(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify(body) }).catch(() => null);
  const data = res && await res.json().catch(() => null);
  if (!res?.ok) throw Object.assign(new Error(data?.error || "That didn't go through — check your connection and try again."), { data });
  return data;
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand("copy"); } catch { /* ignore */ }
    ta.remove();
    return true;
  }
}
// tab-separated, a header row first: pastes as columns into a sheet (and is easy to read song by song)
export const songsText = (songs) => ["Title\tArtist\tISRC\tSpotify", ...songs.map((s) => [s.title, s.artist, s.isrc, s.spotify].map((v) => String(v || "").replace(/[\t\n\r]+/g, " ")).join("\t"))].join("\n");

export function TrueUpPanel({ kind, ctx }) {
  const { data: d } = useTrueUp("todo");
  if (!d) return <p className="todo-line"><RefreshCw size={14} className="spin" /> Loading…</p>;
  const founder = !!d.canSchedule;
  if (kind === "trueup-new") return <NotInReport d={d} flash={ctx?.flash} />;
  if (kind === "trueup-setup") return <SetupNow d={d} />;
  if (kind === "trueup-schedule") return <Schedule d={d} founder={founder} full />;
  return (
    <div className="todo-sublist tu" data-trueup>
      <TrueUpDrop d={d} flash={ctx?.flash} />
      <ReportSongs d={d} />
      <Schedule d={d} founder={founder} />
    </div>
  );
}

// ---- the drop box: the files, a dry run, then Apply; one Undo
function TrueUpDrop({ d }) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(null);
  const [files, setFiles] = useState(null);
  const [out, setOut] = useState(null);
  const [all, setAll] = useState(false);
  const [done, setDone] = useState(null);
  const [setup, runSetup, stopSetup] = useSetup();
  const last = d.runs?.[0];
  const take = async (list) => {
    const read = await Promise.all([...list].filter((f) => /\.csv$/i.test(f.name) || f.type === "text/csv").slice(0, 12).map(async (f) => ({ name: f.name, text: await f.text() })));
    setDone(null); setAll(false); stopSetup();
    if (!read.length) { setOut({ fatal: `Those weren't CSV files. ${d.note}` }); return; }
    setFiles(read); setBusy("checking");
    try { setOut(await post("/api/trueup", { action: "preview", files: read })); }
    catch (e) { setOut({ fatal: e.message }); }
    finally { setBusy(null); }
  };
  const apply = async () => {
    setBusy("applying");
    try {
      const r = await post("/api/trueup", { action: "apply", files });
      setDone({ run: r.run, on: out.plan.exportOn, sheet: r.sheet || null }); setOut(null); setFiles(null);
      setRecent({ id: r.run.id });
      await reloadTrueUp();
      if (r.setup) runSetup(r.setup, r.run.id);
    } catch (e) { setOut({ ...out, fatal: e.message }); }
    finally { setBusy(null); }
  };
  const undo = async (runId) => {
    setBusy("undoing");
    // reloaded before "recent" is cleared, so the row (and this message) never drops out in between
    stopSetup();
    try { const r = await post("/api/trueup", { action: "undo", runId }); setDone({ undone: true, sheet: r.sheet || null }); await reloadTrueUp(); setRecent(null); }
    catch (e) { setDone({ error: e.message }); }
    finally { setBusy(null); }
  };
  const p = out?.plan;
  const changed = (p?.rows || []).filter((r) => !r.same && r.before !== r.total);
  const kept = (p?.rows || []).filter((r) => !r.same && r.ratioKept);
  const shown = all ? changed : changed.slice(0, 6);
  return (
    <div className="lm-drop-wrap tu-drop" data-trueup-drop>
      <label className={`lm-drop${over ? " over" : ""}${busy ? " busy" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) take(e.dataTransfer.files); }}>
        <input type="file" accept=".csv,text/csv" multiple disabled={!!busy} aria-label="Choose this month's Luminate files" onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
        {busy ? <RefreshCw size={22} className="spin" /> : <UploadCloud size={22} />}
        <strong>{busy === "checking" ? "Checking the files…" : busy === "applying" ? "Saving Luminate's numbers…" : "Drop this month's Trend Report here"}</strong>
        <span>{busy ? "This takes a few seconds." : "or tap to choose it. Two reports at once work too, and so do the 4 portfolio exports. Nothing changes until you press Apply."}</span>
      </label>
      <p className="hint tu-note" data-trend-note>{d.note}</p>
      {out && (
        <div className="lm-result lm-preview" role="status" data-trueup-preview>
          {out.fatal && <p className="hint err-text">{out.fatal}</p>}
          {(out.errors || []).map((e) => <p key={e.fileName} className="hint err-text"><AlertTriangle size={13} /> {e.error}</p>)}
          {p && <>
            <p className="lm-result-title">{p.songs ? "Here's what this update would do. Nothing has changed yet." : "Nothing in these files changes a roster song."}</p>
            <p className="tu-files">{(out.files || []).map((f) => (f.kind === "trend" ? `${f.list}, ${f.location} (${f.from === f.through ? shortDay(f.through) : `${shortDay(f.from)} – ${shortDay(f.through)}`})` : `${f.list} (${shortDay(f.exportedAt)})`)).join(" · ")}</p>
            {out.blocked && <p className="hint err-text" data-trueup-blocked><AlertTriangle size={13} /> {out.blocked}</p>}
            {p.jumpPrev?.songs > 0 && <p className="tu-line" data-jump={p.jumpPrev.pct ?? ""}>Against Luminate's last numbers ({p.jumpPrev.from === "portfolio" ? `the ${shortDay(p.jumpPrev.on)} portfolio files` : `the ${shortDay(p.jumpPrev.on)} update`}): <b>{fmt(p.jumpPrev.before)} → {fmt(p.jumpPrev.after)}</b>{p.jumpPrev.pct != null && <> ({p.jumpPrev.pct >= 0 ? "+" : ""}{p.jumpPrev.pct}%)</>} over {plural(p.jumpPrev.songs, "song")}.{p.jump?.noBefore > 0 && <> {plural(p.jump.noBefore, "song")} had no Luminate number here before.</>}</p>}
            {p.byTitle > 0 && <p className="tu-line hint" data-by-title={p.byTitle}>{plural(p.byTitle, "song")} found by title and artist (no Luminate ID here yet){p.versions > 0 ? `, covering ${plural(p.versions, "more version")} (Luminate counts a song's versions as one)` : ""}.</p>}
            {p.songs > 0 && <p className="tu-line" data-changes={p.changed}><b>{changed.length ? `${plural(changed.length, "song")} change to Luminate's ${shortDay(p.exportOn)} number` : `${plural(p.songs, "song")} already match Luminate's ${shortDay(p.exportOn)} number`}</b>{p.songs - changed.length > 0 && changed.length > 0 && <> · {fmt(p.songs - changed.length)} already match</>}</p>}
            {shown.length > 0 && <ul className="tu-rows" data-change-rows>{shown.map((r) => (
              <li key={r.lumId} data-lum={r.lumId}><span className="tu-name">{r.name}</span><span className="tu-num">{r.before == null ? "new" : fmt(r.before)} → <b>{fmt(r.total)}</b>{r.pct != null && <em className="tu-pct">{r.pct >= 0 ? "+" : ""}{r.pct}%</em>}</span></li>
            ))}</ul>}
            {changed.length > shown.length && <button type="button" className="inline-link" onClick={() => setAll(true)}>Show all {fmt(changed.length)}</button>}
            {kept.length > 0 && <p className="tu-line" data-kept={kept.length}>{plural(kept.length, "song")} keep{kept.length === 1 ? "s" : ""} the ratio {kept.length === 1 ? "it has" : "they have"}: {kept.every((r) => r.why === kept[0].why) ? kept[0].why : "no Spotify count close enough to the file's day"}. The new total is still saved.</p>}
            {p.same > 0 && <p className="tu-line">{plural(p.same, "song")} were already updated from this file.</p>}
            {p.ar.length > 0 && <p className="tu-line hint">{plural(p.ar.length, "A&R row")} left as {p.ar.length === 1 ? "it is" : "they are"}: A&R uses the automated numbers.</p>}
            {p.artists > 0 && <p className="tu-line hint">{plural(p.artists, "artist row")} skipped: only songs are updated.</p>}
            {p.unknown.length > 0 && <p className="tu-line hint" data-unknown={p.unknown.length}>{plural(p.unknown.length, p.unknown.every((u) => u.kind === "release") ? "release" : "song")} in the files {p.unknown.length === 1 ? "isn't" : "aren't"} linked to a roster song here, so {p.unknown.length === 1 ? "it's" : "they're"} left out: {p.unknown.slice(0, 5).map((u) => u.name).join(", ")}{p.unknown.length > 5 ? ` and ${fmt(p.unknown.length - 5)} more` : ""}.</p>}
            {p.notIn?.n > 0 && <p className="tu-line hint" data-not-in-file={p.notIn.n}>{plural(p.notIn.n, "roster song")} {p.notIn.n === 1 ? "isn't" : "aren't"} in the files (no plays in these days, or not on the report): {p.notIn.n === 1 ? "it keeps its" : "they keep their"} last number.</p>}
            {p.older.length > 0 && <p className="tu-line hint">{plural(p.older.length, "song")} left out: this file is older than the update they already have.</p>}
            {p.checklist?.n > 0 && <Checklist c={p.checklist} />}
            {out.sheetMonthly && p.songs > 0 && !out.blocked && <p className="tu-line" data-trueup-sheet>Apply also puts these Luminate totals into the pub sheet's STREAM DATA (column D), so the sheet's earnings follow them.<span data-trueup-setup> It also sets up the songs it found that the pub sheet can't show yet: each one's Luminate ID goes into column M of its rows and it gets a STREAM DATA row, so its streams show there. You'll see which songs once it's done.</span></p>}
            <div className="lm-result-acts">
              {p.songs > 0 && !out.blocked && <button className="btn sm" data-trueup-apply disabled={!!busy} onClick={apply}>{busy === "applying" ? "Applying…" : `Apply ${plural(p.songs, "song")}`}</button>}
              <button className="btn ghost sm" disabled={!!busy} onClick={() => { setOut(null); setFiles(null); }}>Cancel</button>
            </div>
          </>}
        </div>
      )}
      {done?.run && <p className="hint del-note" role="status" data-trueup-done><CheckCircle2 size={14} /> <span>Saved Luminate's {shortDay(done.on)} numbers for {plural(done.run.counts.songs, "song")}. {done.sheet?.error ? <span className="err-text" data-trueup-sheet-err>The pub sheet didn't update ({done.sheet.error}). </span> : done.sheet?.written != null ? `The pub sheet's STREAM DATA has them now (${plural(done.sheet.written, "row")} changed). ` : "The sheet's streams take them on their next update, while Sheet streams are on. "}<button className="inline-link" data-trueup-undo disabled={!!busy} onClick={() => undo(done.run.id)}>Undo</button></span></p>}
      {done?.run && setup && <SetupResult s={setup} />}
      {done?.undone && <p className="hint del-note" role="status" data-trueup-undone><CheckCircle2 size={14} /> <span>Undone on the site.{done.sheet?.cleared || done.sheet?.rows ? ` On the pub sheet, what it set up is cleared: ${plural(done.sheet.cleared || 0, "Luminate ID")} in column M, ${plural(done.sheet.rows || 0, "STREAM DATA row")}.` : ""}{done.sheet?.kept ? ` ${plural(done.sheet.kept, "row")} changed since ${done.sheet.kept === 1 ? "was" : "were"} left as ${done.sheet.kept === 1 ? "it is" : "they are"}.` : ""}{d.sheetMonthly ? " The STREAM DATA numbers it wrote for songs already there stay until the next update." : ""}</span></p>}
      {done?.error && <p className="hint err-text">{done.error}</p>}
      {!done && !out && last && <p className="hint tu-last" data-trueup-last>Last update: the {shortDay(last.export_on)} file, {plural(last.counts?.songs || 0, "song")}, saved {shortDay(last.applied_at)}{last.applied_by ? ` by ${last.applied_by}` : ""}. <button className="inline-link" data-trueup-undo disabled={!!busy} onClick={() => undo(last.id)}>Undo</button></p>}
    </div>
  );
}

// ---- the songs to put in the Luminate report
function SongList({ songs, max = 8, attr }) {
  const [all, setAll] = useState(false);
  const shown = all ? songs : songs.slice(0, max);
  return (
    <>
      <ul className="tu-songs" {...attr}>{shown.map((s) => (
        <li key={s.key} data-song={s.key}>
          <span className="tu-name"><b>{s.title || "Untitled"}</b><em>{s.artist}</em></span>
          <span className="tu-meta"><code>{s.isrc || "no ISRC"}</code>{s.spotify && <a className="inline-link" href={s.spotify} target="_blank" rel="noopener noreferrer">Spotify ↗</a>}</span>
        </li>
      ))}</ul>
      {songs.length > shown.length && <button type="button" className="inline-link tu-more" onClick={() => setAll(true)}>Show all {fmt(songs.length)}</button>}
    </>
  );
}
function CopyButton({ songs, label = "Copy all", attr }) {
  const [ok, setOk] = useState(false);
  return <button type="button" className="btn sm" {...attr} onClick={async () => { await copy(songsText(songs)); setOk(true); setTimeout(() => setOk(false), 2500); }}><Copy size={14} /> {ok ? `Copied ${fmt(songs.length)}` : label}</button>;
}
function ReportSongs({ d }) {
  const [open, setOpen] = useState(false);
  const many = d.reports.length > 1;
  const all = d.reports.flatMap((r) => r.songs);
  return (
    <div className="tu-report" data-report-songs data-total={d.total}>
      <div className="tu-head">
        <button type="button" className="tu-toggle" aria-expanded={open} onClick={() => setOpen(!open)}><b>Songs for the Luminate report</b>
          <span className={`tu-count${d.total > d.cap ? " over" : d.total > d.warn ? " warn" : ""}`} data-count>{fmt(d.total)} of {fmt(d.cap)}</span></button>
        <CopyButton songs={all} attr={{ "data-copy-all": "" }} />
      </div>
      {d.total > d.cap ? <p className="hint warn-text" data-split>More than Luminate's {fmt(d.cap)}: make {d.reports.length} reports, split by artist below, and drop all {d.reports.length} files together.</p>
        : d.total > d.warn ? <p className="hint warn-text" data-warn>Close to Luminate's {fmt(d.cap)} limit. Past {fmt(d.cap)} this splits into two reports.</p>
          : <p className="hint">Put these in one Luminate Trend Report and schedule it with the Report Scheduler. Each month, download it and drop it above.</p>}
      {open && (many ? d.reports.map((r) => (
        <div key={r.name} className="tu-part" data-report={r.name}>
          <div className="tu-head"><b>{r.name}: {r.from === r.to ? r.from : `${r.from} – ${r.to}`}, {plural(r.songs.length, "song")}</b><CopyButton songs={r.songs} label={`Copy ${r.name}`} /></div>
          <SongList songs={r.songs} />
        </div>
      )) : <SongList songs={all} attr={{ "data-song-list": "" }} />)}
      {open && d.noIsrc.length > 0 && <NoIsrc songs={d.noIsrc} />}
      {!open && d.noIsrc.length > 0 && <p className="hint" data-no-isrc-n>{plural(d.noIsrc.length, "song")} {d.noIsrc.length === 1 ? "has" : "have"} no ISRC yet: open the list to find {d.noIsrc.length === 1 ? "it" : "them"}.</p>}
    </div>
  );
}
// the songs with no ISRC, and the ISRC finder that already exists (/api/songs findIsrcs, then one tap on a guess)
function NoIsrc({ songs }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState({});
  const [note, setNote] = useState(null);
  const find = async () => {
    setBusy(true); setNote(null);
    let left = songs.filter((s) => s.placementIds.length && !res[s.key]?.isrc);
    try {
      for (let pass = 0; left.length && pass < 6; pass++) {
        const groups = left.slice(0, 8).map((s) => s.placementIds);
        const { results } = await post("/api/songs", { action: "findIsrcs", groups });
        const next = { ...res };
        for (const s of left.slice(0, 8)) if (results[s.placementIds[0]]) next[s.key] = results[s.placementIds[0]];
        setRes((r) => ({ ...r, ...next }));
        left = left.filter((s, i) => i >= 8 || results[s.placementIds[0]]?.later);
      }
      await reloadTrueUp();
    } catch (e) { setNote(e.message); }
    finally { setBusy(false); }
  };
  const pick = async (s, c) => {
    setBusy(true);
    try { await post("/api/songs", { action: "pickIsrc", placementIds: s.placementIds, isrc: c.isrc, source: c.source }); setRes((r) => ({ ...r, [s.key]: { isrc: c.isrc } })); await reloadTrueUp(); }
    catch (e) { setNote(e.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="tu-part" data-no-isrc>
      <div className="tu-head"><b>{plural(songs.length, "song")} with no ISRC</b>
        <button type="button" className="btn ghost sm" data-find-isrcs disabled={busy || !songs.some((s) => s.placementIds.length)} onClick={find}>{busy ? "Looking…" : "Find ISRCs"}</button></div>
      <p className="hint">Luminate finds a song fastest by its ISRC. The finder checks the song's Spotify link, Deezer and MusicBrainz.</p>
      <ul className="tu-songs">{songs.map((s) => { const r = res[s.key]; return (
        <li key={s.key} data-song={s.key}>
          <span className="tu-name"><b>{s.title || "Untitled"}</b><em>{s.artist}</em></span>
          <span className="tu-meta">{r?.isrc ? <code data-found>{r.isrc}</code> : r?.notFound ? <em>Not found</em> : r?.error ? <em>{r.error}</em> : null}</span>
          {r?.candidates?.length > 0 && !r.isrc && <span className="isrc-picks" data-isrc-picks><span className="hint">Is it one of these?</span>
            {r.candidates.map((c) => <button key={`${c.isrc}:${c.source}`} type="button" className="isrc-pick" disabled={busy} data-isrc-pick={c.isrc} onClick={() => pick(s, c)} title={`${c.isrc} · from ${ISRC_SOURCES[c.source] || c.source}`}>
              <span className="isrc-pick-cover">{c.cover ? <img src={c.cover} alt="" loading="lazy" /> : <Disc3 size={14} />}</span>
              <span className="isrc-pick-main"><b>{c.title}</b><em>{c.artist}{c.artist ? " · " : ""}{ISRC_SOURCES[c.source] || c.source}</em></span></button>)}</span>}
        </li>); })}</ul>
      {note && <p className="hint err-text">{note}</p>}
    </div>
  );
}

// ---- the songs to add to the Luminate report: the ones no Luminate file has had yet, every update counted
function CopyIsrcs({ songs }) {
  const [ok, setOk] = useState(false);
  const isrcs = songs.map((s) => s.isrc).filter(Boolean);
  if (!isrcs.length) return null;
  return <button type="button" className="btn ghost sm" data-copy-isrcs onClick={async () => { await copy(isrcs.join("\n")); setOk(true); setTimeout(() => setOk(false), 2500); }}><Copy size={14} /> {ok ? `Copied ${fmt(isrcs.length)}` : `Copy ${plural(isrcs.length, "ISRC")}`}</button>;
}
function NotInReport({ d }) {
  const list = d.notInReport || [];
  if (!list.length) return <p className="home-muted acct-clear"><CheckCircle2 size={15} /> Every roster song is in the report.</p>;
  const noIsrc = list.filter((s) => !s.isrc);
  return (
    <div className="todo-sublist tu" data-not-in-report={list.length}>
      <div className="tu-head"><b>{plural(list.length, "song")} to add</b><span className="tu-acts"><CopyButton songs={list} label="Copy all" attr={{ "data-copy-new": "" }} /><CopyIsrcs songs={list} /></span></div>
      <p className="hint" data-not-in-words>{d.notInWords || "Not in any Luminate file yet"}{d.baseline?.kind === "trueup" ? ` (${plural(d.baseline.runs || 1, "update")} so far)` : `: they weren't in the ${shortDay(d.baseline?.on)} portfolio exports`}. Add each one to your Luminate Trend Report (search it by its ISRC), then export the report and drop it in the monthly update: every song the file has gets checked off. Copy all pastes title, artist, ISRC and Spotify link as columns.</p>
      <p className="hint" data-no-plays-note>Luminate leaves a song with no plays in the report's days out of the file, so a song like that can stay here until it has some.</p>
      <SongList songs={list} max={12} attr={{ "data-new-list": "" }} />
      {noIsrc.length > 0 && <NoIsrc songs={noIsrc} />}
      <div className="tu-part" data-recheck>
        <b className="tu-sub">Added them? Drop the new export here to check them off</b>
        <TrueUpDrop d={d} />
      </div>
    </div>
  );
}

// ---- the drop's checklist: To do's songs to add, each ticked off when the dropped files have it
function TickList({ songs, ok, attr }) {
  const [all, setAll] = useState(false);
  const shown = all ? songs : songs.slice(0, 12);
  return (
    <>
      <ul className={`tu-songs tu-ticks ${ok ? "ok" : "miss"}`} {...attr}>{shown.map((s) => (
        <li key={s.key} data-song={s.key}>
          <span className="tu-tick" aria-label={ok ? "In this report" : "Not in this report"}>{ok ? <Check size={14} /> : <X size={14} />}</span>
          <span className="tu-name"><b>{s.title || "Untitled"}</b><em>{s.artist}</em></span>
          <span className="tu-meta"><code>{s.isrc || "no ISRC"}</code></span>
        </li>
      ))}</ul>
      {songs.length > shown.length && <button type="button" className="inline-link tu-more" onClick={() => setAll(true)}>Show all {fmt(songs.length)}</button>}
    </>
  );
}
function Checklist({ c }) {
  const [open, setOpen] = useState(false);
  const miss = c.missing.length;
  return (
    <div className="tu-check" data-checklist={c.n} data-found={c.found.length} data-missing={miss}>
      <p className="tu-line"><b>{miss ? `${fmt(c.found.length)} of the ${plural(c.n, "song")} to add ${c.found.length === 1 ? "is" : "are"} in this report` : <><CheckCircle2 size={14} /> All {plural(c.n, "song")} to add {c.n === 1 ? "is" : "are"} in this report</>}</b></p>
      {miss > 0 && <>
        <p className="hint">Still not in it: add {miss === 1 ? "it" : "them"} in Luminate and export again. (A song with no plays in these days isn't in the file either.)</p>
        <TickList songs={c.missing} attr={{ "data-check-missing": "" }} />
        <div className="tu-acts"><CopyButton songs={c.missing} label={`Copy the ${fmt(miss)} missing`} attr={{ "data-copy-missing": "" }} /><CopyIsrcs songs={c.missing} /></div>
      </>}
      {c.found.length > 0 && <button type="button" className="inline-link" data-show-found onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"} the {fmt(c.found.length)} checked off</button>}
      {open && <TickList songs={c.found} ok attr={{ "data-check-found": "" }} />}
    </div>
  );
}

// ---- setting the found songs up on the pub sheet (lib/lum-setup.js): Apply starts it; cut short by Google's
// per-minute read limit (a minute's wait) or by its time, it carries on here, for that update only. It stops when the
// panel closes, on Undo and on a new drop.
const sumSetup = (a, b) => ({ ...b, stamped: (a?.stamped || 0) + (b?.stamped || 0), added: (a?.added || 0) + (b?.added || 0), saved: (a?.saved || 0) + (b?.saved || 0),
  names: [...new Set([...(a?.names || []), ...(b?.names || [])])], songs: Math.max(a?.songs || 0, b?.songs || 0),
  // each run works the whole plan out again: its own lists are the whole story
  others: b?.others || [], refused: b?.refused || [], alarms: [...(a?.alarms || []), ...(b?.alarms || [])] });
const goOn = (r) => !r || (!r.error && !r.alarms?.length && (r.quota || r.more));
function useSetup() {
  const [s, setS] = useState(null);
  const gen = useRef(0);
  useEffect(() => () => { gen.current++; }, []);
  const stop = () => { gen.current++; setS(null); };
  const run = async (first = null, runId = null) => {
    const me = ++gen.current, live = () => gen.current === me;
    let acc = first;
    setS({ res: acc, busy: goOn(acc) });
    for (let i = 0; i < 8 && goOn(acc) && live(); i++) {
      if (acc?.quota) { setS({ res: acc, busy: true, waiting: true }); await new Promise((r) => setTimeout(r, 65000)); if (!live()) return; }
      setS({ res: acc, busy: true });
      try { acc = sumSetup(acc, await post("/api/trueup", { action: "setup", runId })); }
      catch (e) { acc = { ...(acc || {}), error: e.message }; }
    }
    if (!live()) return;
    setS({ res: acc, busy: false });
    await reloadTrueUp();
  };
  return [s, run, stop];
}
const WHY = { another: "already has another Luminate ID", twice: "is on its tab twice (its streams would count twice)" };
function SetupResult({ s }) {
  const r = s.res || {};
  if (r.skipped) return null;
  const others = r.others || [];
  return (
    <div className="tu-setup" role="status" data-setup-result={s.busy ? "busy" : r.error || r.alarms?.length ? "problem" : "done"}>
      {s.busy ? <p className="hint"><RefreshCw size={13} className="spin" /> {s.waiting ? "Google limits how often the sheet can be read: waiting a minute, then setting up the rest." : "Setting the new songs up on the pub sheet…"}</p>
        : (r.stamped || r.added) ? <p className="hint del-note" data-setup-done><CheckCircle2 size={14} /> <span>Set up on the pub sheet: {r.names?.length ? `${r.names.join(", ")}${r.songs > r.names.length ? ` and ${fmt(r.songs - r.names.length)} more` : ""}. ` : ""}{plural(r.stamped || 0, "row")} got {r.stamped === 1 ? "its" : "their"} Luminate ID in column M, {plural(r.added || 0, "song")} got a STREAM DATA row.</span></p>
          : !r.error && !r.alarms?.length && !r.left ? <p className="hint" data-setup-none>Nothing new to set up on the pub sheet.</p> : null}
      {others.length > 0 && <p className="hint" data-setup-others>Left as {others.length === 1 ? "it is" : "they are"}, to check by hand: {others.slice(0, 4).map((o) => `${o.song}${o.tab ? ` (${o.tab})` : ""} ${WHY[o.why] || WHY.another}`).join("; ")}{others.length > 4 ? `; ${fmt(others.length - 4)} more` : ""}.</p>}
      {(r.refused || []).map((x) => <p key={`${x.tab}:${x.row}`} className="hint warn-text"><AlertTriangle size={13} /> {x.reason}</p>)}
      {(r.alarms || []).map((a) => <p key={a} className="hint err-text" data-setup-alarm><AlertTriangle size={13} /> {a}</p>)}
      {r.error && <p className="hint err-text"><AlertTriangle size={13} /> The pub sheet setup stopped: {r.error}</p>}
      {!s.busy && r.left > 0 && <p className="hint" data-setup-left>{plural(r.left, "song")} still to set up: "songs to set up on the pub sheet" in To do carries on.</p>}
    </div>
  );
}
function SetupNow({ d }) {
  const [setup, runSetup] = useSetup();
  const left = d.setupLeft || { n: 0, names: [] };
  return (
    <div className="todo-sublist tu" data-setup-now={left.n}>
      <p className="tu-line">{left.n ? <>The last update's setup on the pub sheet stopped partway: {plural(left.n, "song")} still to set up{left.names?.length ? ` (${left.names.join(", ")}${left.n > left.names.length ? "…" : ""})` : ""}. Setting {left.n === 1 ? "it" : "them"} up puts each one's Luminate ID into column M of its rows and gives it a STREAM DATA row.</> : "Every song the last update found is set up on the pub sheet."}</p>
      {left.n > 0 && <div className="tu-acts"><button type="button" className="btn sm" data-setup-go disabled={!!setup?.busy} onClick={() => runSetup(null, d.newestRun)}>{setup?.busy ? "Setting up…" : "Carry on"}</button></div>}
      {setup && <SetupResult s={setup} />}
    </div>
  );
}

// ---- Luminate's schedule: 12 weeks from the first update; a Founder moves the day
function Schedule({ d, founder, full = false }) {
  const s = d.schedule || {};
  const [day, setDay] = useState(s.ends || "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  useEffect(() => { setDay(s.ends || ""); }, [s.ends]);
  const save = async (body) => {
    setBusy(true); setNote(null);
    try { const r = await post("/api/trueup", { action: "schedule", ...body }); setNote({ text: `Saved: the schedule ends ${longDay(r.ends)}.` }); await reloadTrueUp(); }
    catch (e) { setNote({ text: e.message, warn: true }); }
    finally { setBusy(false); }
  };
  if (!s.ends && !full) return <p className="hint tu-sched" data-schedule="none">Luminate's schedule runs 12 weeks. The reminder to copy the report starts with the first update.</p>;
  return (
    <div className={full ? "todo-sublist tu" : "tu-sched"} data-schedule={s.ends || "none"}>
      <p className={full ? "tu-line" : "hint"}>Luminate's schedule ends {longDay(s.ends)}{s.set ? "" : " (12 weeks from the first update)"}.{full && " In Luminate, copy the report and schedule the copy, so next month's file still comes."}</p>
      {founder ? (
        <div className="tu-acts">
          {full && <button type="button" className="btn sm" data-schedule-copied disabled={busy} onClick={() => save({ copied: true })}>I copied it</button>}
          <label className="tu-date"><span>Ends on</span><input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="The day Luminate's schedule ends" /></label>
          <button type="button" className="btn ghost sm" data-schedule-save disabled={busy || !day || day === s.ends} onClick={() => save({ ends: day })}>Save</button>
        </div>
      ) : full && <p className="hint">A Founder can change the date.</p>}
      {note && <p className={note.warn ? "hint err-text" : "hint del-note"} role="status">{note.text}</p>}
    </div>
  );
}
