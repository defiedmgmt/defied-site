"use client";
// The monthly Luminate true-up in To do (lib/trueup.js, /api/trueup). Three rows, each finished in place:
//   trueup           "Monthly Luminate update: drop this month's report": the drop box (dry run, Apply, one Undo),
//                    the songs to put in the Luminate report (Copy all, N of 500, Report 1/2 past 500, the songs with
//                    no ISRC and the ISRC finder) and the schedule's end day
//   trueup-new       "N new roster songs aren't in the Luminate report yet": the list and Copy
//   trueup-schedule  "Luminate's schedule ends on <day>": I copied it / another day (a Founder)
// The dashboard imports these (TRUEUP-HOOK lines): useTrueUp and trueUpTodoItems in StaffDashboard (from
// trueup-data.js, the shell's small part, so the shell never loads this file), TrueUpPanel in To do's TodoPanel.
import React, { useEffect, useState } from "react";
import { UploadCloud, RefreshCw, CheckCircle2, AlertTriangle, Copy, Disc3 } from "lucide-react";
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
  const last = d.runs?.[0];
  const take = async (list) => {
    const read = await Promise.all([...list].filter((f) => /\.csv$/i.test(f.name) || f.type === "text/csv").slice(0, 12).map(async (f) => ({ name: f.name, text: await f.text() })));
    setDone(null); setAll(false);
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
      setDone({ run: r.run, on: out.plan.exportOn }); setOut(null); setFiles(null);
      setRecent({ id: r.run.id });
      await reloadTrueUp();
    } catch (e) { setOut({ ...out, fatal: e.message }); }
    finally { setBusy(null); }
  };
  const undo = async (runId) => {
    setBusy("undoing");
    // reloaded before "recent" is cleared, so the row (and this message) never drops out in between
    try { await post("/api/trueup", { action: "undo", runId }); setDone({ undone: true }); await reloadTrueUp(); setRecent(null); }
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
            <p className="tu-files">{(out.files || []).map((f) => (f.kind === "trend" ? `${f.list}, ${f.location} (${shortDay(f.from)} – ${shortDay(f.through)})` : `${f.list} (${shortDay(f.exportedAt)})`)).join(" · ")}</p>
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
            {p.notIn?.n > 0 && <p className="tu-line hint" data-not-in-file={p.notIn.n}>{plural(p.notIn.n, "roster song")} {p.notIn.n === 1 ? "isn't" : "aren't"} in the files ({d.notInWords || "no plays this period, or not in the report yet"}): {p.notIn.n === 1 ? "it keeps its" : "they keep their"} last number.</p>}
            {p.older.length > 0 && <p className="tu-line hint">{plural(p.older.length, "song")} left out: this file is older than the update they already have.</p>}
            <div className="lm-result-acts">
              {p.songs > 0 && !out.blocked && <button className="btn sm" data-trueup-apply disabled={!!busy} onClick={apply}>{busy === "applying" ? "Applying…" : `Apply ${plural(p.songs, "song")}`}</button>}
              <button className="btn ghost sm" disabled={!!busy} onClick={() => { setOut(null); setFiles(null); }}>Cancel</button>
            </div>
          </>}
        </div>
      )}
      {done?.run && <p className="hint del-note" role="status" data-trueup-done><CheckCircle2 size={14} /> <span>Saved Luminate's {shortDay(done.on)} numbers for {plural(done.run.counts.songs, "song")}. The sheet's streams take them on their next update, while Sheet streams are on. <button className="inline-link" data-trueup-undo disabled={!!busy} onClick={() => undo(done.run.id)}>Undo</button></span></p>}
      {done?.undone && <p className="hint del-note" role="status" data-trueup-undone><CheckCircle2 size={14} /> <span>Undone: nothing from that update is left.</span></p>}
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

// ---- the roster songs that aren't in the newest file(s)
function NotInReport({ d }) {
  const list = d.notInReport || [];
  if (!list.length) return <p className="home-muted acct-clear"><CheckCircle2 size={15} /> Every roster song is in the report.</p>;
  return (
    <div className="todo-sublist tu" data-not-in-report={list.length}>
      <div className="tu-head"><b>{plural(list.length, "song")} to add</b><CopyButton songs={list} label="Copy" attr={{ "data-copy-new": "" }} /></div>
      <p className="hint" data-not-in-words>{d.notInWords || "No plays this period, or not in the report yet"}: {d.baseline?.kind === "trueup" ? `they weren't in the ${shortDay(d.baseline.on)} update's files` : `they weren't in the ${shortDay(d.baseline?.on)} portfolio exports`}, so they keep their last number. If one is missing from the Luminate report, add it (Copy pastes title, artist, ISRC and Spotify link as columns). This clears once a file with them is dropped in.</p>
      <SongList songs={list} max={12} attr={{ "data-new-list": "" }} />
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
