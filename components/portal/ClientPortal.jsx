import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { X, LogOut, Plus, Disc3, RefreshCw, AlertTriangle, CheckCircle2, Eye, PauseCircle, PlayCircle, KeyRound } from "lucide-react";
import { PasswordCard } from "../dash/password";
import { evenSplit, splitWords, filledSplits, orderSplits } from "../../lib/splits";
import { netStreamsOf } from "../../lib/sheet-facts";
import { changedFields, goneText } from "../app/saves";
import { ClientMore, SpotifyFill } from "../dash/clients";
import { normalizeTitle, splitsToConfirm } from "../dash/catalog-data";
import { GrowthChip, Sparkline, dayRange, shortDay, signed, songsPost, songsToUpdate, useGrowth } from "../dash/helpers";
import { Avatar, DropNote, Field, PhotoUpload, SplitsEditor, SplitsPie, Wordmark, fmt, money, splitPct, splitTotal, streamsAsOf, uid, useEscape } from "../dash/ui";
import { ROUTE_TO_PATH } from "../shared/routes";
import { ExtLink, Photo } from "../shared/ui";
import { LumHistory } from "../dash/lum-history";
import { ArtistStats, useArtistNumbers, setTracking } from "../dash/artist-stats";
import { ownSplit, personKey } from "../site/data";
import { AskCard } from "./ask";
export { AskCard, useDirtyGuard } from "./ask";

/* ------------------------------------------------------------------ */
/*  CLIENT PORTAL                                                       */
/* ------------------------------------------------------------------ */
/*  shared: song + splits manager (used by client portal and staff)    */
// a release date is a calendar day (YYYY-MM-DD): new Date() reads it as UTC midnight, which is
// still the day before everywhere in the Americas
export const releaseDay = (s) => {
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return (ymd ? new Date(+ymd[1], ymd[2] - 1, +ymd[3]) : new Date(s)).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
};

// Delete and "This isn't ours": the song off the site, then its row off its client's pub sheet tab.
// Resolves what happened on the sheet, once both are done; null when the site save failed. (r11 todofix: the route
// guards the clear: a cell holding a formula is never cleared ("refused", its reason), and a formula that changed
// with the clear comes back as `alarm`, said loudly)
async function dropSong(db, commit, target, client) {
  if (!(await commit({ ...db, placements: db.placements.filter((p) => p.id !== target.id) }))) return null;
  const tab = client?.sheetTabName?.trim() || client?.name || "";
  if (!ownSplit(target, client)) return { sheet: "none", tab }; // nothing was ever pushed under this client for this song
  try {
    const res = await fetch("/api/sheets-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
      body: JSON.stringify({ placementId: target.id, splits: [{ name: client?.sheetTabName || client?.name }] }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data.refused) return { sheet: "refused", tab: (data.results || [])[0]?.tab || tab, error: data.error };
    if (!res.ok) throw Object.assign(new Error(data.error || `Sheet delete failed (${res.status})`), { alarm: data.alarm });
    const r = (data.results || [])[0] || {};
    return { sheet: r.cleared ? "cleared" : r.found === false ? "noTab" : "notFound", tab: r.tab || tab, alarm: data.alarm || r.alarm || null };
  } catch (err) {
    console.error("Sheet delete failed:", err);
    return { sheet: "failed", tab, error: err.message, alarm: err.alarm || null };
  }
}
// the last sheet sync found no tab for this client: a Delete or "This isn't ours" has no row to clear
export const noSheetTab = (songInfo, client) => !!client && (songInfo?.missingTabs || []).includes(client.name);
// the one line a Delete leaves under the client's header: what happened on the pub sheet (a formula that changed
// with the clear, after it, loudly)
const dropNote = (o) => {
  const n = {
    cleared: { text: `Deleted. Its row on the ${o.tab} tab is cleared.` },
    notFound: { warn: true, text: `Deleted here, but its row on the ${o.tab} tab wasn't found. Delete that row in the pub sheet by hand, or the next numbers sync brings the song back.` },
    noTab: { text: `Deleted. The pub sheet has no ${o.tab} tab, so there was no row to clear.` },
    refused: { warn: true, text: `Deleted here, but its row on the ${o.tab} tab was left as it is: ${o.error} Check that row in the pub sheet.` },
    failed: { warn: true, text: `Deleted here, but the pub sheet couldn't be updated (${o.error || "no answer"}). Delete its row on the ${o.tab} tab by hand.` },
  }[o.sheet] || { text: "Deleted. It had no row on the pub sheet." };
  return o.alarm ? { warn: true, text: `${n.text} ${o.alarm}` } : n;
};

// "This isn't ours": every place the app knows the song is, then one step takes it out of all of
// them (site, its sheet row) and notes it, so the sheet never brings it back. onDone gets the result line.
export function NotOursAsk({ db, commit, songInfo, target, client, onDone, onClose }) {
  const tab = client?.sheetTabName?.trim() || client?.name || "";
  const places = [
    target.notable ? `On public page (${client?.name}'s page on the site)` : `On ${client?.name}'s page here (not public)`,
    ownSplit(target, client) && (noSheetTab(songInfo, client) ? `Not on the pub sheet (there's no ${tab} tab)` : `Its row on the ${tab} tab of the pub sheet`),
  ].filter(Boolean);
  const go = async () => {
    const out = await dropSong(db, commit, target, client);
    if (!out) return onClose(); // the save's own error banner says why
    let noted = null;
    try { await songsPost({ action: "notOurs", clientId: target.clientId, song: target.song, artist: target.artist, luminateId: target.luminateId || "", placementId: target.id }); } catch (e) { noted = e.message; }
    const sheetBad = out.sheet === "notFound" || out.sheet === "failed" || out.sheet === "refused";
    const text = [
      out.sheet === "cleared" ? "Removed from the catalog and the pub sheet."
        : out.sheet === "refused" ? `Removed from the catalog, but its row on the ${out.tab} tab was left as it is: ${out.error} Check that row in the pub sheet.`
        : sheetBad ? `Removed from the catalog, but its row on the ${out.tab} tab ${out.sheet === "failed" ? "couldn't be cleared" : "wasn't found"}. Delete that row in the pub sheet by hand.` : "Removed from the catalog.",
      noted && `It couldn't be recorded as removed (${noted}), so a numbers sync may bring it back.`,
      out.alarm,
    ].filter(Boolean).join(" ");
    onDone({ warn: sheetBad || !!noted || !!out.alarm, text });
  };
  return (
    <AskCard title={`Remove "${target.song || "Untitled"}" from the catalog?`} goLabel="Remove from catalog" busyLabel="Removing…" go={go} onClose={onClose}>
      <p>This takes it out of everywhere the app can reach:</p>
      <ul className="ask-places">{places.map((x) => <li key={x}>{x}</li>)}</ul>
    </AskCard>
  );
}

// Save's sheet step (the song editor, and Splits to confirm's Confirm): only the split that belongs to
// whoever's catalog page this is goes to the pub sheet. A co-writer typed into another split, or an
// unnamed person from the even default, is just a name on the site, never someone we provision sheet
// tracking for. A slow or failed push never undoes the site save.
// r11 todofix: the push route guards the write (pages/api/sheets-push.js). Resolves { ok, alarm? } or { error,
// refused (the guard said no: nothing written), written (false: nothing was), checked (the route read its write back
// even so), alarm? }; alarm: a formula that changed with the write, said loudly. keep: the share as the sheet has it,
// for a write that only renames the row (a merge, build I2); check: "confirm" | "merge", the route's total rule
export async function pushShare(saved, client, liveIds, { keep = null, check = null } = {}) {
  const mine = ownSplit(saved, client);
  const splits = mine ? [{ name: client?.sheetTabName || client?.name, percent: keep ?? mine.percent }] : [];
  try {
    const res = await fetch("/api/sheets-push", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
      body: JSON.stringify({
        placementId: saved.id, song: saved.song, artist: saved.artist, luminateId: saved.luminateId, splits,
        // lets the push route tell a genuinely-still-claimed sheet row apart
        // from one whose syncId belongs to a placement that no longer
        // exists on this browser — see findUnclaimedRowByTitle.
        liveIds,
        ...(check ? { check } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data.alarm ? { ok: true, alarm: data.alarm } : { ok: true };
    console.error("Sheet push failed:", data.error || res.status);
    return { error: data.error || `Sheet sync failed (${res.status})`, refused: !!data.refused, written: data.written, checked: !!data.checked, ...(data.alarm ? { alarm: data.alarm } : {}) };
  } catch (err) {
    console.error("Sheet push failed:", err);
    return { error: err.message || "Sheet sync failed — the local save is fine, but the pub sheet wasn't updated." };
  }
}
// the song editor's Save: null, or what to say (what went wrong, or a formula that changed with the write)
export async function pushOwnShare(saved, client, liveIds, keepPercent = null) {
  const r = await pushShare(saved, client, liveIds, { keep: keepPercent });
  return r.error ? [r.error, r.alarm].filter(Boolean).join(" ") : r.alarm || null;
}

// the song editor's Save keeps the sheet's exact share (its sheet facts) when the site's whole percent only rounds it
// (33.33 is 33 on the site, 12.5 is 12): writing 0.33 over 0.3333 moved the row's net streams with nothing changed.
// More than half a point apart is a real change, and the site's percent goes. null: send the site's percent
export const sheetShareToKeep = (fact, mine) =>
  fact?.share != null && mine && Math.abs(Number(fact.share) - Number(mine.percent)) <= 0.5 ? Number(fact.share) : null;

// editorOnly (To do's Fix / Update): only the song's editor and the strip after its Save, none of the client's page
// a placement's Spotify track as the numbers' entity key (t:<id>), or null
const trackKey = (link) => { const m = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]{22})/.exec(String(link || "")); return m ? `t:${m[1]}` : null; };
export function SongManager({ db, commit, clientId, isStaff, songInfo, reloadSongInfo, fix, onFix, onFixList, onGo, onDeleteClient, editorOnly = false }) {
  // staff's db has a `clients` array; a client session's db has just their
  // own `client` record (no `clients` array — that's not sent to them).
  const client = db.clients ? db.clients.find((c) => c.id === clientId) : db.client;
  // (2026-11-10) the money is the Founders' (Money access): a Co-manager sees streams, songs and splits
  const seeMoney = isStaff && (!db.access || db.access.sections.includes("money"));
  const songs = useMemo(() => db.placements.filter((p) => p.clientId === clientId), [db.placements, clientId]);
  // MASTER-tab-style rollup across this client's whole catalog. Gross
  // streams (and $ figures) come straight off each placement — the sheet's
  // own Gross Revenue/Admin Fee columns are already this person's share,
  // not the whole song's, since they cascade from Net Streams (Gross ×
  // their own Writer Share %). Net streams isn't stored anywhere, so it's
  // recomputed here the same way the sheet computes it per row.
  const summary = useMemo(() => {
    let gross = 0, net = 0, revenue = 0, adminFee = 0;
    for (const p of songs) {
      const streams = p.streams || 0;
      gross += streams;
      const mine = ownSplit(p, client);
      net += streams * ((Number(mine?.percent) || 0) / 100);
      revenue += p.revenue || 0;
      adminFee += p.adminFee || 0;
    }
    return { gross, net, revenue, adminFee };
  }, [songs, client?.name]);
  // the net streams shown are the sheet's own (MASTER's writer table, from the last pull); the sum above is
  // only an estimate, used where the sheet has no tab read for this client yet (build G3)
  const netShown = netStreamsOf(db.sheetFacts?.clients?.[clientId], summary.net);
  const growth = useGrowth();
  // this week = Spotify streams this week (the automated numbers, lib/data/growth.js), the songs whose week
  // ends last, as the Publishing table says
  const weekGain = useMemo(() => {
    if (!growth) return null;
    const gs = songs.map((p) => growth[p.id]).filter(Boolean);
    const end = gs.map((g) => g.thisWeek != null && g.weekOf?.to).filter(Boolean).sort().pop();
    const wk = gs.filter((g) => g.thisWeek != null && (!end || !g.weekOf || g.weekOf.to === end));
    return wk.length ? wk.reduce((a, g) => a + g.thisWeek, 0) : null;
  }, [growth, songs]);
  // the sheet's streams are Luminate's last numbers (db.streamsOn), not the day the site last pulled the sheet
  const numbersOn = db.streamsOn || null;
  const [openId, setOpenId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState(null);
  const [splitsFirst, setSplitsFirst] = useState(0); // a Fix's n while its editor is open: it opens on the Splits
  const [fieldFirst, setFieldFirst] = useState(null); // Songs to update's Update: { f: the field to open on, n }
  // a closed form takes its message with it, and a Fix's "open on the Splits" with it
  useEffect(() => { if (!editing) { setFormErr(null); setSplitsFirst(0); setFieldFirst(null); } }, [editing]);
  // an Update from Songs to update opens on its first missing field (the window's own scroll only)
  useEffect(() => {
    const el = fieldFirst && document.querySelector(`.modal-body [data-field="${fieldFirst.f}"]`), body = el?.closest(".modal-body");
    if (!el) return;
    if (body) body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top - 40;
    el.focus({ preventScroll: true });
  }, [fieldFirst?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const editFrom = useRef(null); // the song as it was when Edit was pressed
  const active = songs.find((p) => p.id === openId);
  // the song window shows an even split the rule can fill as it would be confirmed (lib/splits.js); staff only
  const activeEven = active && isStaff && splitTotal(active.splits) !== 100 && evenSplit(active.splits).status === "assumed" ? evenSplit(active.splits) : null;
  const [pushWarn, setPushWarn] = useState(null);
  // a "Fix" from the splits list opens that song's editor at once; after its Save, a strip says how many
  // are left and offers the next one (on any client's page)
  const fixing = useRef(null);
  const [fixNote, setFixNote] = useState(null);
  // an Update from Songs to update: { id, order (the list as it was), saved }. When its editor closes (Save or
  // Cancel) a strip offers the next song in that order and the way back to the list, as the splits Fix does
  const updating = useRef(null);
  useEffect(() => {
    const u = updating.current;
    if (editing || !u) return;
    updating.current = null;
    const now = songsToUpdate(db, songInfo), at = new Map(now.map((x) => [x.p.id, x]));
    const after = u.order.slice(u.order.indexOf(u.id) + 1).find((id) => at.has(id));
    setFixNote({ upd: true, saved: u.saved, next: at.get(after) || now.find((x) => x.p.id !== u.id) || null });
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const p = fix && db.placements.find((x) => x.id === fix.id);
    if (!p || p.clientId !== clientId) return;
    // a split Fix says what's left after Save; an Update from Songs to update says what's next when it closes
    const onSplits = !fix.field || fix.field === "splits";
    setOpenId(null); setFixNote(null); fixing.current = fix.field ? null : p.id;
    updating.current = fix.field ? { id: p.id, order: songsToUpdate(db, songInfo).map((x) => x.p.id), saved: false } : null;
    editFrom.current = p; setEditing({ ...p }); setSplitsFirst(onSplits ? fix.n : 0); setFieldFirst(onSplits ? null : { f: fix.field, n: fix.n });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix?.n, clientId]);
  useEscape(() => (editing ? setEditing(null) : setOpenId(null)), !!(active || editing) && !saving);
  useEffect(() => {
    if (!active && !editing) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [active, editing]);

  const saveSong = async (form0, anyway = false) => {
    // the split as the editor shows it: for staff the even default filled in (lib/splits.js), or exactly what was
    // typed. A client's Save never fills it: the assumed default stays for the owner to confirm in Splits to confirm,
    // so a client fixing a link never writes an assumed share to their own sheet tab
    const form = isStaff ? { ...form0, splits: filledSplits(form0.splits) } : form0;
    // only what was changed in the form goes onto the song as it is now — streams the sync
    // brought in while it was open aren't put back (see Editor)
    const cur = form.id && db.placements.find((p) => p.id === form.id);
    const o = cur && editFrom.current ? { ...cur, ...changedFields(editFrom.current, form) } : form;
    // catch likely duplicates before they happen — same title plus at least
    // one more matching signal (the credited artist, or a shared name in
    // the splits) is "probably a dupe"; same title alone isn't (two real,
    // different songs can share a title with different people on them).
    const normTitle = normalizeTitle(o.song);
    const normArtist = normalizeTitle(o.artist);
    const myName = personKey(client?.name);
    // exclude the client's own name — they're on every song on their own
    // page, so that alone would "match" any two same-titled entries.
    const mySplitNames = new Set((o.splits || []).map((s) => personKey(s.name)).filter((n) => n && n !== myName));
    const possibleDup = songs.find((p) => {
      if (p.id === o.id) return false;
      if (normalizeTitle(p.song) !== normTitle || !normTitle) return false;
      const artistMatch = normArtist && normalizeTitle(p.artist) === normArtist;
      const splitMatch = (p.splits || []).some((s) => mySplitNames.has(personKey(s.name)));
      return artistMatch || splitMatch;
    });
    if (possibleDup && !anyway) return setAsk({ kind: "dup", form, dup: possibleDup });
    const placementId = o.id || uid();
    const row = { ...o, id: placementId, clientId };
    const placements = o.id
      ? db.placements.map((p) => p.id === o.id ? row : p)
      : [...db.placements, row];
    setSaving(true); setFormErr(null);
    const done = await commit({ ...db, placements }).finally(() => setSaving(false));
    // a song that didn't save stays in its form, and never reaches the sheet
    if (!done) return;
    // the sheet gets the song as it was saved, others' changes to it included — and a song deleted
    // elsewhere meanwhile gets nothing (a push would re-create its row for the next sync to bring back)
    const saved = done.placements.find((p) => p.id === placementId);
    if (!saved) return setFormErr(goneText(done.clients && !done.clients.some((c) => c.id === clientId) ? "client" : "song"));
    if (isStaff && fixing.current === placementId) {
      const left = splitsToConfirm(done, songInfo).all; // the list's own order: biggest streams first
      setFixNote({ left: left.length, next: left.find((x) => x.p.id !== placementId) || null });
    }
    fixing.current = null;
    if (updating.current?.id === placementId) updating.current.saved = true;
    setEditing(null);
    // push to the pub sheet in the background — a slow/failed network call
    // should never block or undo the local save that already succeeded —
    // but staff still need to know if the sheet side silently fell out of
    // sync, so surface (not throw) whatever the route reports.
    setPushWarn(null);
    // only ever push the split that belongs to whoever's catalog page this
    // is — a co-writer typed into another split is just a name on the site,
    // not someone we auto-provision sheet tracking for. If that person is
    // also a client, their own row comes from adding this same song under
    // their own page, the same way this one did.
    const keep = sheetShareToKeep(db.sheetFacts?.songs?.[placementId], ownSplit(saved, client));
    pushOwnShare(saved, client, done.placements.map((p) => p.id), keep).then((err) => {
      if (err && isStaff) setPushWarn(err);
    });
  };
  // the one-line outcome of a Delete / This isn't ours, under the header (staff only)
  const [delNote, setDelNote] = useState(null);
  const [ask, setAsk] = useState(null); // "delete" | "notOurs": the confirm card over the song window
  useEffect(() => { setDelNote(null); setAsk(null); setFixNote(null); }, [clientId]);
  const removeSong = async (target) => {
    setDelNote(null);
    // not deleted on the site: its sheet row stays too
    const out = await dropSong(db, commit, target, client);
    setAsk(null);
    if (!out) return;
    setOpenId(null); setEditing(null);
    if (isStaff) setDelNote(dropNote(out));
  };
  // (2026-11-10) the top of a roster artist's page: its campaign numbers, then the streams and money, then the songs
  // staff: every artist's numbers (GET /api/data); a client: their own only (GET /api/my-numbers, 2026-11-10)
  const nums = useArtistNumbers(!editorOnly ? clientId : null, isStaff ? "/api/data" : "/api/my-numbers");
  const [stopAsk, setStopAsk] = useState(false);
  const tracking = nums.artist?.mode !== "off";
  const moreItems = isStaff && nums.artist ? [{ key: "tracking", label: tracking ? "Stop tracking this artist" : "Start tracking again", icon: tracking ? <PauseCircle size={14} /> : <PlayCircle size={14} />, onClick: () => (tracking ? setStopAsk(true) : setTracking(clientId, true).then(nums.reload)) }] : [];
  const startAdd = () => setEditing({ id: null, clientId, song: "", artist: client?.name || "", releaseDate: "", link: "", cover: "", notable: false, luminateId: "", splits: [{ id: uid(), name: client?.name || "", role: client?.role || "", percent: 0 }] });

  const summaryBlock = db.sheetSync?.lastSyncedAt && (
        <div className="cat-summary">
          <div className="cat-summary-grid">

            <div className="cat-stat" data-gross="site"><span className="cat-stat-label">Gross Streams{isStaff && <span className="cat-stat-note"> (songs on the site)</span>}</span><span className="cat-stat-val">{fmt(summary.gross)}</span></div>
            {/* staff see where each comes from, as the two can differ: the net is the pub sheet's own figure once a pull read the tab */}
            <div className="cat-stat" data-net={netShown.fromSheet ? "sheet" : "estimate"}><span className="cat-stat-label">Net Streams{!netShown.fromSheet ? <span className="cat-stat-note"> (estimate)</span> : isStaff && <span className="cat-stat-note"> (from the pub sheet)</span>}</span><span className="cat-stat-val">{fmt(netShown.value)}</span></div>
            {isStaff ? (
              <>
                {/* estimates, not cash we hold: clients are paid their publishing directly, our commission is billed through Stripe */}
                {seeMoney && <div className="cat-stat"><span className="cat-stat-label">Pub earnings <span className="cat-stat-note">(est., paid to them directly)</span></span><span className="cat-stat-val">{money(summary.revenue)}</span></div>}
                {seeMoney && <div className="cat-stat"><span className="cat-stat-label">Potential admin fee <span className="cat-stat-note">(est.)</span></span><span className="cat-stat-val">{money(summary.adminFee)}</span></div>}
              </>
            ) : (
              <>
                <div className="cat-stat"><span className="cat-stat-label">Songs</span><span className="cat-stat-val">{songs.length}</span></div>
                {weekGain != null && <div className="cat-stat"><span className="cat-stat-label">This Week</span><span className="cat-stat-val grow-val">{signed(weekGain)}</span></div>}
              </>
            )}
          </div>
          <p className="hint cat-asof">
            {isStaff ? streamsAsOf({ pulledAt: db.sheetSync.lastSyncedAt })
              : `Streams as of ${new Date(numbersOn ? `${numbersOn}T12:00:00` : db.sheetSync.lastSyncedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`}
          </p>
        </div>
  );
  return (
    <>
      {/* read-only: shows staff which sheet tab this client's numbers come from (Stack!e reads tab Stackie) */}
      {isStaff && client && !editorOnly && (
        <div className="client-head">
          <Avatar src={client.photo} name={client.name} size={40} />
          <div className="client-head-text">
            <div className="client-head-name">{client.name}</div>
            <div className="client-head-meta">{client.role || "Client"} · {!songs.length ? "No songs yet. Their pub sheet tab is made with their first song."
              : noSheetTab(songInfo, client) ? <span className="warn-text" title={`The pub sheet has no tab called ${client.sheetTabName?.trim() || client.name}.`}>Sheet tab: not found</span>
              : `Sheet tab: ${client.sheetTabName?.trim() || client.name}`}</div>
          </div>
          {(onDeleteClient || moreItems.length > 0) && <ClientMore onDelete={onDeleteClient ? () => onDeleteClient(client) : undefined} items={moreItems} />}
        </div>
      )}
      {isStaff && fixNote?.upd && (
        <p className="hint fix-strip" role="status" data-upd-strip>
          {fixNote.saved && <><CheckCircle2 size={14} /> <span>Saved.</span></>}
          {fixNote.next
            ? <button className="inline-link" data-upd-next onClick={() => onFix?.(fixNote.next.p.id, fixNote.next.gaps[0].field)}>Next to update: {fixNote.next.p.song || "Untitled"} ({fixNote.next.client?.name || "a deleted client"}) →</button>
            : <span>No more songs to update.</span>}
          {" · "}<button className="inline-link" data-upd-back onClick={() => onFixList?.("update")}>Back to Songs to update</button>
        </p>
      )}
      {isStaff && fixNote && !fixNote.upd && (
        <p className="hint fix-strip" role="status">
          <CheckCircle2 size={14} /> <span>Saved. {fixNote.left ? `${fixNote.left} left` : "All splits add up now."}</span>
          {fixNote.next && <> · <button className="inline-link" onClick={() => onFix?.(fixNote.next.p.id)}>Next: {fixNote.next.p.song || "Untitled"} ({fixNote.next.client?.name || "a deleted client"}) →</button></>}
          {" · "}<button className="inline-link" onClick={() => onFixList?.()}>Back to the list</button>
        </p>
      )}
      {isStaff && <DropNote note={delNote} />}
      {stopAsk && (
        <AskCard title={`Stop tracking ${client?.name || "this artist"}?`} goLabel="Stop tracking" busyLabel="Stopping…" onClose={() => setStopAsk(false)}
          go={async () => { await setTracking(clientId, false); setStopAsk(false); await nums.reload(); }}>
          <p>Every automatic number for them stops updating (Spotify, TikTok, Instagram, YouTube). What's been read so far is kept, and you can start it again from More ▾.</p>
        </AskCard>
      )}
      {!editorOnly && <>
      <ArtistStats nums={nums} title={isStaff ? "Campaign" : "Your numbers"} staff={isStaff} />
      {isStaff && summaryBlock}
      <div className="portal-block-head">
        <div>
          <h2>Songs &amp; Splits</h2>
          <p className="muted">
            {/* the song count already lives in the summary's Songs stat for
                clients — repeating it here would just be the same number
                twice. Staff never see a Songs stat there, so keep it here. */}
            {(isStaff || !db.sheetSync?.lastSyncedAt) && `${songs.length} Song${songs.length === 1 ? "" : "s"} · `}
            Click any to see the breakdown.
          </p>
          {isStaff && pushWarn && <p className="hint err-text">{pushWarn}</p>}
        </div>
        <button className="btn sm" onClick={startAdd}><Plus size={15} /> Add Song</button>
      </div>

      {!isStaff && summaryBlock}

      {songs.length === 0 ? (
        <p className="muted">No songs yet — add the first one.</p>
      ) : (
        <div className="song-grid">
          {(isStaff ? [...songs].sort((a, b) => (splitTotal(a.splits) === 100) - (splitTotal(b.splits) === 100)) : songs).map((p) => (
            <button key={p.id} className="song-card" onClick={() => setOpenId(p.id)}>
              <div className="song-cover">
                {p.cover ? <Photo src={p.cover} alt={p.song} /> : <div className="song-cover-empty"><Disc3 size={26} /></div>}
              </div>
              <div className="song-info">
                <strong>{p.song || "Untitled"}</strong>
                <span>{p.artist}</span>
                {/* an even split the rule can fill is the owner's to confirm, not a broken one (Splits to confirm says the same) */}
                <em>{isStaff && splitTotal(p.splits) !== 100
                  ? (evenSplit(p.splits).status === "assumed" ? <span className="split-chip split-chip-even">Even split assumed</span> : <span className="split-chip">Splits {splitPct(p.splits)}%</span>)
                  : <>{(p.splits || []).length} {(p.splits || []).length === 1 ? "split" : "splits"} · <span className={splitTotal(p.splits) === 100 ? undefined : "split-warn"}>{splitTotal(p.splits)}%</span></>}</em>
                {/* its own line: on the splits line it was cut off by the card's width */}
                {p.notable && <span className="song-public"><Eye size={12} aria-hidden="true" /> On public page</span>}
                <GrowthChip g={growth?.[p.id]} />
              </div>
            </button>
          ))}
        </div>
      )}

      </>}

      {active && !editing && !editorOnly && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setOpenId(null)}>
          <div className="modal-card song-detail">
            <div className="modal-head"><h3>{active.song || "Untitled"}</h3><button onClick={() => setOpenId(null)} aria-label="Close"><X size={18} /></button></div>
            <div className="modal-body">
              <div className="song-detail-top">
                <div className="song-detail-cover">
                  {active.cover ? <Photo src={active.cover} alt="" /> : <div className="song-cover-empty"><Disc3 size={30} /></div>}
                </div>
                <div>
                  <div className="song-detail-artist">{active.artist}</div>
                  {active.releaseDate && <div className="song-detail-date">{releaseDay(active.releaseDate)}</div>}
                  {active.link && <ExtLink className="inline-link" href={active.link}>Open track ↗</ExtLink>}
                  {active.notable && <div className="song-detail-public"><Eye size={13} aria-hidden="true" /> Shown on {client?.name}'s public page.</div>}
                </div>
              </div>
              {/* streams but $0: the sheet row's Writer Share is blank (Spots. on the Stackie tab), so its earnings formulas
                  give nothing. Up here under the title, so it's read before anything else and never sits behind the buttons */}
              {isStaff && db.sheetSync?.lastSyncedAt && active.streams > 0 && !active.revenue && Number(ownSplit(active, client)?.percent) > 0 && (
                <p className="hint song-sheet-warn"><AlertTriangle size={14} /> <span>The pub sheet has no writer share for this song ({client?.sheetTabName?.trim() || client?.name} tab), so it earns $0 there. Edit and Save to send the split to the sheet, or use Remove from catalog.</span></p>
              )}
              {/* an even split the rule can fill: shown as it would be confirmed, in a neutral note, never as a broken 0% */}
              {isStaff && activeEven && (
                <p className="hint song-even" data-song-even>Even split assumed: {splitWords(activeEven.splits, active.splits)}. Edit and Save confirms it (or Confirm in To do).</p>
              )}
              {/* the numbers before the pie (build I3): at 1440x900 Net streams is in view without scrolling, the warning above it too */}
              {db.sheetSync?.lastSyncedAt && (
                <div className="split-list song-nums">
                  <div className="split-list-row"><span className="split-name">Streams</span><span className="split-pct">{fmt(active.streams)}</span></div>
                  {/* the song's row on the sheet gives its net streams (gross × the sheet's writer share); without a row, the site's split estimates it */}
                  {(() => {
                    const f = db.sheetFacts?.songs?.[active.id];
                    const net = f ? f.net : Math.round((active.streams || 0) * ((Number(ownSplit(active, client)?.percent) || 0) / 100));
                    return <div className="split-list-row" data-song-net={f ? "sheet" : "estimate"}><span className="split-name">Net streams{!f && <em> (estimate)</em>}</span><span className="split-pct">{fmt(net)}</span></div>;
                  })()}
                  {seeMoney && (
                    <>
                      <div className="split-list-row"><span className="split-name">Pub earnings <em>(est., paid to them directly)</em></span><span className="split-pct">{money(active.revenue)}</span></div>
                      <div className="split-list-row"><span className="split-name">Potential admin fee <em>(est.)</em></span><span className="split-pct">{money(active.adminFee)}</span></div>
                    </>
                  )}
                  <p className="hint song-asof">{isStaff ? streamsAsOf({ pulledAt: db.sheetSync.lastSyncedAt })
                    : `as of ${new Date(numbersOn ? `${numbersOn}T12:00:00` : db.sheetSync.lastSyncedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`}</p>
                </div>
              )}
              <SplitsPie splits={activeEven ? activeEven.splits : active.splits} size={230} />
              <div className="split-list">
                {orderSplits(activeEven ? activeEven.splits : active.splits || []).map((s, i) => (
                  <div key={s.unnamed ? `u${i}` : s.id} className="split-list-row">
                    <span className="split-name">{s.name || s.label || "—"}{s.role && !s.unnamed && <em> · {s.role}</em>}{activeEven && (s.unnamed || !(Number((active.splits || []).find((t) => t.id === s.id)?.percent) > 0)) && <em> · assumed</em>}</span>
                    {/* one decimal, as the editor shows it (a third is 16.7%, not 16.666666666666668%); the saved % is unchanged */}
                    <span className="split-pct">{splitPct([s])}%</span>
                  </div>
                ))}
                <div className="split-list-row split-list-total">
                  <span>Total</span><span className={splitTotal(active.splits) === 100 ? "split-ok" : activeEven ? undefined : "split-warn"}>{activeEven ? `${splitPct(activeEven.splits)}% (assumed)` : `${splitPct(active.splits)}%`}</span>
                </div>
              </div>
              {growth?.[active.id]?.series?.length > 1 && (
                <div className="song-growth">
                  <div className="song-growth-nums">
                    {growth[active.id].thisWeek != null ? <span><b className="grow-val">{signed(growth[active.id].thisWeek)}</b> this week{growth[active.id].weekOf ? ` (${dayRange(growth[active.id].weekOf.from, growth[active.id].weekOf.to)})` : ""}</span>
                      : growth[active.id].daily != null && <span><b className="grow-val">{signed(growth[active.id].daily)}</b> yesterday</span>}
                    <span><b>{fmt(growth[active.id].latest)}</b> on Spotify</span>
                  </div>
                  <Sparkline series={growth[active.id].series} />
                  <p className="hint">Spotify streams, global, all-time, from {shortDay(growth[active.id].series[0][0])} to {shortDay(growth[active.id].latestOn)}</p>
                </div>
              )}
              {/* r10: the song's Luminate history (read only), keyed by its Spotify track */}
              {isStaff && trackKey(active.link) && <LumHistory k={trackKey(active.link)} />}
            </div>
            {/* the two ways a song leaves the page read alike, so say which is which */}
            {isStaff && <p className="hint song-foot-help" data-foot-help>Remove from catalog: a song that was never ours (it comes off the site and the pub sheet). Delete: a duplicate or a mistake on the site.</p>}
            <div className="modal-foot">
              {isStaff && <button className="btn ghost sm" data-not-ours onClick={() => setAsk({ kind: "notOurs", p: active })}>Remove from catalog</button>}
              <button className="btn ghost sm" data-del onClick={() => setAsk({ kind: "delete", p: active })}>Delete</button>
              <button className="btn sm" onClick={() => { editFrom.current = active; setEditing({ ...active }); }}>Edit</button>
            </div>
          </div>
        </div>
      )}

      {ask?.kind === "delete" && (
        <AskCard title={`Delete "${ask.p.song || "Untitled"}"?`} goLabel="Delete song" busyLabel="Deleting…" go={() => removeSong(ask.p)} onClose={() => setAsk(null)}>
          <p>It comes off {client?.name}'s page here.{ownSplit(ask.p, client) && !noSheetTab(songInfo, client) ? ` Its row on the ${client?.sheetTabName?.trim() || client?.name} tab of the pub sheet is cleared too.` : ""} This can't be undone.</p>
          {ask.p.notable && <p>It's also shown on {client?.name}'s public page; it goes from there too.</p>}
        </AskCard>
      )}
      {ask?.kind === "notOurs" && (
        <NotOursAsk db={db} commit={commit} songInfo={songInfo} target={ask.p} client={client} onClose={() => setAsk(null)}
          onDone={(n) => { setAsk(null); setOpenId(null); setDelNote(n); reloadSongInfo?.(); }} />
      )}

      {editing && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setEditing(null)}>
          <div className="modal-card">
            <div className="modal-head"><h3>{editing.id ? "Edit song" : "Add song"}</h3><button onClick={() => setEditing(null)} aria-label="Close"><X size={18} /></button></div>
            <div className="modal-body">
              <SpotifyFill e={editing} set={setEditing} />
              <PhotoUpload label="Cover art" value={editing.cover} onChange={(v) => setEditing({ ...editing, cover: v })} />
              <Field label="Song" value={editing.song} onChange={(ev) => setEditing({ ...editing, song: ev.target.value })} />
              <Field label="Artist" value={editing.artist} onChange={(ev) => setEditing({ ...editing, artist: ev.target.value })} />
              <Field label="Release date" type="date" data-field="releaseDate" value={editing.releaseDate} onChange={(ev) => setEditing({ ...editing, releaseDate: ev.target.value })} />
              <Field label="Streaming link" data-field="link" value={editing.link} onChange={(ev) => setEditing({ ...editing, link: ev.target.value })} />
              <SplitsEditor splits={editing.splits} onChange={(v) => setEditing({ ...editing, splits: v })} focusPct={splitsFirst} assume={!!isStaff} owner={client} />
              <label className="check-row">
                <input type="checkbox" checked={!!editing.notable} onChange={(ev) => setEditing({ ...editing, notable: ev.target.checked })} />
                <span>Feature as a Notable Release on your artist profile.</span>
              </label>
            </div>
            {isStaff && splitTotal(editing.splits) <= 0 && (
              <p className="hint err-text modal-save-warn">Nothing has a split percentage set — give at least one person a % above 0, or this song saves here but won't sync to the pub sheet at all.</p>
            )}
            {formErr && <p className="hint err-text modal-save-warn" role="alert">{formErr}</p>}
            <div className="modal-foot">
              <button className="btn ghost sm" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn sm" onClick={() => saveSong(editing)} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
      {ask?.kind === "dup" && (
        <AskCard title="Save as a separate song?" goLabel="Save anyway" busyLabel="Saving…" plain onClose={() => setAsk(null)}
          go={async () => { const f = ask.form; setAsk(null); await saveSong(f, true); }}>
          <p>This looks like it might already exist here: "{ask.dup.song}" by {ask.dup.artist || "—"} ({(ask.dup.splits || []).length} split{(ask.dup.splits || []).length === 1 ? "" : "s"}).</p>
        </AskCard>
      )}
    </>
  );
}

export function ClientPortal({ db, commit, session, logout, signingOut }) {
  // db here is already scoped to just this client by /api/dashboard-data —
  // db.client is their own record, db.placements is only their own songs.
  // The old per-browser "pull streams from the sheet on load" workaround is
  // gone: now that data lives in one shared database, whenever staff run
  // Sync Streams every client's numbers update immediately, with nothing
  // for the client's own browser to do.
  const client = db.client;
  // (2026-11-10, the owner) Password sits in the header beside Sign out, not at the bottom of the page
  const [pwOpen, setPwOpen] = useState(false);

  return (
    <div className="portal">
      <header className="portal-nav">
        <Link href={ROUTE_TO_PATH.home} className="logo-link"><Wordmark height={26} /></Link>
        <div className="portal-who">
          <span>{client?.name || session.name}</span>
          <button onClick={() => setPwOpen(true)} data-change-password><KeyRound size={16} /> <span className="portal-pw-label">Password</span></button>
          <button onClick={logout} disabled={signingOut}>{signingOut ? <><RefreshCw size={16} className="spin" /> Signing out…</> : <><LogOut size={16} /> Sign out</>}</button>
        </div>
      </header>
      <main className="portal-main">
        <h1 className="portal-title">{client?.name || session.name}</h1>
        <div className="portal-block">
          <SongManager db={db} commit={commit} clientId={session.clientId} />
        </div>
      </main>
      {pwOpen && <PasswordCard onClose={() => setPwOpen(false)} />}
    </div>
  );
}
