import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { X, LogOut, Plus, Disc3, RefreshCw, AlertTriangle, CheckCircle2, Eye, PauseCircle, PlayCircle, KeyRound, SquarePen } from "lucide-react";
import { PasswordCard } from "../dash/password";
import { songSplit, splitWords, filledSplits, orderSplits } from "../../lib/splits";
import { snapSplits, ROUNDING_GAP } from "../../lib/pct";
import { portalStreams, spotSongsOf, spotifyStandIn, streamsDay, trackKey } from "../../lib/portal-streams";
import { ShareStats } from "./share";
import { changedFields, goneText } from "../app/saves";
import { ClientMore, SpotifyFill } from "../dash/clients";
import { normalizeTitle, splitsToConfirm } from "../dash/catalog-data";
import { GrowthChip, Sparkline, dayRange, shortDay, signed, songsPost, songsToUpdate, useGrowthState } from "../dash/helpers";
import { Avatar, DropNote, Field, PhotoUpload, SplitsEditor, SplitsPie, Wordmark, fmt, splitColors, splitPct, splitTotal, uid, useEscape } from "../dash/ui";
import { streamsLine } from "../dash/streams-line";
import { canUse } from "../dash/access";
import { ROUTE_TO_PATH } from "../shared/routes";
import { ExtLink, Photo } from "../shared/ui";
import { LumHistory } from "../dash/lum-history";
import { ArtistStats, useArtistNumbers, setTracking } from "../dash/artist-stats";
import { MyLinks } from "../dash/my-links";
import { MyCommission } from "../dash/my-commission";
import { ownSplit, personKey } from "../site/data";
import { AskCard } from "./ask";
import { InstallApp } from "../shared/install-app";
import { AppErrorBoundary } from "../app/ErrorScreen";
import { useOnResume } from "../app/resume";
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
// with the clear comes back as `alarm`, said loudly). (2026-11-13) It also sends the song's Luminate ID, title and the
// row the sheet sync last read it from (its sheet fact): 119 rows didn't carry their song's Site Sync ID, so the route
// found nothing to clear and the next sync brought the song back. The route finds the row by those instead. A row
// another song on the page still uses (the same title or Luminate ID: a duplicate card) is left: "shared", its title
async function dropSong(db, commit, target, client) {
  if (!(await commit({ ...db, placements: db.placements.filter((p) => p.id !== target.id) }))) return null;
  const tab = client?.sheetTabName?.trim() || client?.name || "";
  if (!ownSplit(target, client)) return { sheet: "none", tab }; // nothing was ever pushed under this client for this song
  try {
    const res = await fetch("/api/sheets-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
      body: JSON.stringify({
        placementId: target.id, splits: [{ name: client?.sheetTabName || client?.name }],
        luminateId: target.luminateId || "", song: target.song || "", row: db.sheetFacts?.songs?.[target.id]?.row ?? null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data.refused) return { sheet: "refused", tab: (data.results || [])[0]?.tab || tab, error: data.error };
    if (!res.ok) throw Object.assign(new Error(data.error || `Sheet delete failed (${res.status})`), { alarm: data.alarm });
    const r = (data.results || [])[0] || {};
    return { sheet: r.cleared ? "cleared" : r.shared ? "shared" : r.found === false ? "noTab" : "notFound", tab: r.tab || tab, twin: r.shared || null, alarm: data.alarm || r.alarm || null };
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
    shared: { warn: true, text: `Deleted here. Its row on the ${o.tab} tab was left as it is: "${o.twin}" on this page has the same title or Luminate id and may use that row. Check it in the pub sheet.` },
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
    const sheetBad = out.sheet === "notFound" || out.sheet === "failed" || out.sheet === "refused" || out.sheet === "shared";
    const text = [
      out.sheet === "cleared" ? "Removed from the catalog and the pub sheet."
        : out.sheet === "refused" ? `Removed from the catalog, but its row on the ${out.tab} tab was left as it is: ${out.error} Check that row in the pub sheet.`
        : out.sheet === "shared" ? `Removed from the catalog. Its row on the ${out.tab} tab was left as it is: "${out.twin}" on this page has the same title or Luminate id and may use that row. Check it in the pub sheet.`
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

// the song editor's Save keeps the sheet's exact share (its sheet facts) when the site's percent only rounds it
// (the sheet holds 33.3333 and the site the third): writing 0.33 over 0.3333 moved the row's net streams with nothing changed.
// (2026-11-23) "Only rounds it" is lib/pct.js ROUNDING_GAP, 0.05 of a point (it was half a point, which kept the sheet's 17 over a saved 16.67): a share more than
// that apart is a real change, and the site's exact share goes. null: send the site's percent
export const sheetShareToKeep = (fact, mine) =>
  fact?.share != null && mine && Math.abs(Number(fact.share) - Number(mine.percent)) <= ROUNDING_GAP ? Number(fact.share) : null;

// (a placement's Spotify track as the numbers' entity key, trackKey, is lib/portal-streams.js's: the share card's too)

// editorOnly (To do's Fix / Update): only the song's editor and the strip after its Save, none of the client's page
export function SongManager({ db, commit, clientId, isStaff, songInfo, reloadSongInfo, fix, onFix, onFixList, onGo, onDeleteClient, editorOnly = false }) {
  // staff's db has a `clients` array; a client session's db has just their
  // own `client` record (no `clients` array — that's not sent to them).
  const client = db.clients ? db.clients.find((c) => c.id === clientId) : db.client;
  // (2026-11-10) the money is the Founders' (Money access): a Co-manager sees streams, songs and splits
  const seeMoney = isStaff && (!db.access || db.access.sections.includes("money"));
  // the stat row's Songs tile: a client's, and staff's when there's no money to show, so Gross Streams never stands alone
  // stretched across the row (2026-11-13); where it shows, the song list's heading leaves its own count out. (2026-11-24) A Founder's
  // row is the Gross Streams tile alone now (the pub earnings and potential admin fee tiles are gone), kept to one tile's width by styles/app.css, and the count stays in the heading
  const songsTile = !isStaff || !seeMoney;
  const songs = useMemo(() => db.placements.filter((p) => p.clientId === clientId), [db.placements, clientId]);
  // (Gross streams are lib/portal-streams.js's, below.)
  const { growth, retry: reloadGrowth } = useGrowthState();
  // (2026-11-26 review) the installed app opened again after 5+ minutes away (components/app/resume.js, a client's own page only): the Spotify numbers
  // are read again with the songs, so This Week, the +N chips and Gross Streams' Spotify plays aren't the last launch's. The ones on screen stay until
  // the new answer lands. (retry reads the hook's own ref, so the first one is every one.)
  useOnResume(() => { if (!isStaff && !editorOnly) reloadGrowth(); });
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
  // "Not on streaming" (song_tracking.skip): a song that's unreleased, taken down or only on SoundCloud/TikTok has no date or link to
  // find. Staff read a song's flag from the songs' facts (songInfo), a client from the list their page came with (db.notOnStreaming);
  // what this page has just saved comes first, until staff's facts are read again. noStream: the editor's box, null until it's touched
  const [skipSaved, setSkipSaved] = useState({});
  useEffect(() => { setSkipSaved((s) => (Object.keys(s).length ? {} : s)); }, [songInfo]);
  const skipOf = (id) => (!id ? false : id in skipSaved ? skipSaved[id] : isStaff ? !!songInfo?.tracking?.[id]?.skip : (db.notOnStreaming || []).includes(id));
  const [noStream, setNoStream] = useState(null);
  const [flagWarn, setFlagWarn] = useState(null);
  // a closed form takes its message with it, and a Fix's "open on the Splits" with it. (2026-11-26 review) And the Fix itself: a Fix closed with Cancel is over, so a later Edit and Save
  // of the same song shows no "Saved. N left" strip (Save reads fixing before it closes the form)
  useEffect(() => { if (!editing) { setFormErr(null); setSplitsFirst(0); setFieldFirst(null); setNoStream(null); fixing.current = null; } }, [editing]);
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
  const activeFill = active && isStaff && splitTotal(active.splits) !== 100 ? songSplit(active, client) : null;
  const activeEven = activeFill?.status === "assumed" ? activeFill : null;
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
    // (2026-11-26 review) a song picked in Catalog (field "window"): its window, as a tap on its card here opens it; not the editor a splits Fix opens, and no strip after
    if (fix.field === "window") { setEditing(null); setFixNote(null); fixing.current = null; updating.current = null; setOpenId(p.id); return; }
    // a split Fix says what's left after Save; an Update from Songs to update says what's next when it closes
    const onSplits = !fix.field || fix.field === "splits";
    setOpenId(null); setFixNote(null); fixing.current = fix.field ? null : p.id;
    updating.current = fix.field ? { id: p.id, order: songsToUpdate(db, songInfo).map((x) => x.p.id), saved: false } : null;
    editFrom.current = p; setEditing({ ...p }); setSplitsFirst(onSplits ? fix.n : 0); setFieldFirst(onSplits ? null : { f: fix.field, n: fix.n });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix?.n, clientId]);
  // Esc closes the song's window (read only). (2026-11-26 review) Not the Add / Edit song editor: like the site's other forms (components/dash/admin.jsx
  // Editor), it closes only with its X or Cancel, so a stray Esc, or a tap on the dimmed strip above a phone's sheet, never throws away what was typed
  useEscape(() => setOpenId(null), !!active && !editing && !saving);
  useEffect(() => {
    if (!active && !editing) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [active, editing]);

  const saveSong = async (form0, anyway = false) => {
    // the split as the editor shows it: for staff the even default filled in (lib/splits.js), or exactly what was
    // typed. A client's Save fills it only on a song they're adding (2026-11-11, the owner: "when a client adds a song
    // on their page the splits rule should be there"); on a song already there it stays as typed, for the owner to
    // confirm in Splits to confirm, so a client fixing a link never writes an assumed share to their own sheet tab
    // (2026-11-23) either way the shares go in snapped (lib/pct.js): 16.67 + 83.33 is a sixth and five sixths, 33.33 x 3 is three thirds; the server does the same on every save
    const form = isStaff || !form0.id ? { ...form0, splits: filledSplits(form0.splits, { client, artist: form0.artist }) } : { ...form0, splits: snapSplits(form0.splits) };
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
    const wantFlag = noStream; // "Not on streaming" as the form has it (null: not touched)
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
    // "Not on streaming" goes with the song, now that it exists (a new song's id is made above): its own write, in the background like
    // the pub sheet's, so a slow or failed one never undoes the save. A line under the header says when it didn't go through
    setFlagWarn(null);
    if (wantFlag !== null && wantFlag !== skipOf(placementId)) {
      songsPost({ action: "notOnStreaming", placementIds: [placementId], notOnStreaming: wantFlag })
        .then(() => { setSkipSaved((m) => ({ ...m, [placementId]: wantFlag })); reloadSongInfo?.(); })
        .catch((e) => setFlagWarn(`"${saved.song || "Untitled"}" is saved, but "Not on streaming" didn't save (${e.message}). Open the song and try again.`));
    }
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
  // (2026-11-26 review) a client's numbers read again when the installed app is opened after a while away (components/app/resume.js; AppRoot reads their songs again)
  useOnResume(() => { if (!isStaff && !editorOnly && clientId) nums.reload(); });
  // (2026-11-11, the owner: "can we use the spotify numbers for now until theyre on luminate") a song with no
  // streams from the sheet yet shows Spotify's: its plays (the daily numbers, all-time), or "under 1,000" when
  // Spotify was asked and shows no count (it doesn't below 1,000), said so wherever it's shown. null: nothing to add
  // (2026-11-13) a song is listed once, under one Spotify id: a copy here that links another id of the same song is
  // found by that one too (ids, lib/data/engine.js sameSongIds); a song's own id comes first
  // (2026-11-13) the reckoning is lib/portal-streams.js's, shared with the share card (lib/share-card.js), so the two
  // can't disagree: Gross Streams = the sheet's streams + Spotify's for the songs it stands in for
  const spotSongs = useMemo(() => spotSongsOf(nums.artist?.songs), [nums.artist]);
  const spotifyOnly = (p) => spotifyStandIn(p, growth, spotSongs);
  const streamsNow = useMemo(() => portalStreams(songs, { growth, spotSongs }), [songs, growth, spotSongs]);
  const spotifyFill = streamsNow.spotifyFill;
  // (2026-11-25, the owner: "for each client can we sort the songs from highest streams to lowest streams in the roster section") staff see a client's songs biggest first:
  // the number each song's window shows (streamsNow: the sheet's streams, or Spotify's plays standing in; "Under 1,000" counts as none), a tie the newest release first, then by title
  const byStreams = useMemo(() => {
    const n = new Map(streamsNow.songs.map((r) => [r.p.id, r.under1k ? 0 : Number(r.streams) || 0]));
    return [...songs].sort((a, b) => (n.get(b.id) || 0) - (n.get(a.id) || 0) || String(b.releaseDate || "").localeCompare(String(a.releaseDate || "")) || String(a.song || "").localeCompare(String(b.song || "")));
  }, [songs, streamsNow]);
  // (2026-11-15) a client's "as of" lines say the day their streams are from, as the share card does (lib/portal-streams.js
  // streamsDay): the sheet's (Luminate's, numbersOn) unless Spotify's plays are all there is, then theirs. No day: the last pull's
  const asOfWords = (day) => new Date(day ? `${day}T12:00:00` : db.sheetSync.lastSyncedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const [stopAsk, setStopAsk] = useState(false);
  // a client's own links (2026-11-11): what's on their profile, and the one being added or changed
  const [myLinks, setMyLinks] = useState(() => ({ spotify: client?.spotify || "", instagram: client?.instagram || "", tiktok: client?.tiktok || "", youtube: client?.youtube || "" }));
  const [linkEdit, setLinkEdit] = useState(null);
  const tracking = nums.artist?.mode !== "off";
  // (2026-11-26 review) staff who can use Site get their profile from here too (photo, bio, links, sheet tab, on the public roster): Site › Website › Roster with this client's form open
  const toProfile = isStaff && onGo && canUse(db, "site") ? (sub) => onGo("site", sub) : null;
  const moreItems = [
    toProfile && { key: "profile", label: "Edit profile", icon: <SquarePen size={14} />, onClick: () => toProfile(`roster:${clientId}/profile`) },
    isStaff && nums.artist && { key: "tracking", label: tracking ? "Stop tracking this artist" : "Start tracking again", icon: tracking ? <PauseCircle size={14} /> : <PlayCircle size={14} />, onClick: () => (tracking ? setStopAsk(true) : setTracking(clientId, true).then(nums.reload)) },
  ].filter(Boolean);
  // (2026-11-11) the artist line starts with the client's name only when they're an artist: a producer types the
  // song's artist, whose share the default split names
  const startAdd = () => setEditing({ id: null, clientId, song: "", artist: /artist/i.test(client?.role || "") ? client?.name || "" : "", releaseDate: "", link: "", cover: "", notable: false, luminateId: "", splits: [{ id: uid(), name: client?.name || "", role: client?.role || "", percent: 0 }] });

  const summaryBlock = db.sheetSync?.lastSyncedAt && (
        <div className="cat-summary">
          <div className="cat-summary-grid portal-tiles">

            <div className="cat-stat" data-gross="site"><span className="cat-stat-label">Gross Streams</span><span className="cat-stat-val">{fmt(streamsNow.gross)}</span>
              {spotifyFill.n > 0 && <span className="cat-stat-note" data-gross-spotify={spotifyFill.n}>incl. Spotify plays for {spotifyFill.n} {spotifyFill.n === 1 ? "song" : "songs"} not on Luminate yet</span>}</div>
            {/* (2026-11-13, the owner: "u can hide net streams for founders too lets keep it simple thats just for spreadsheet
                calculation") no Net Streams card for anyone, and no Net streams row in a song's window: the net is the sheet's
                working number and the Advance calculator's input, not one a page shows. (2026-11-24, the owner: "the old pub sheet
                stuff can go... just the key information") And no Pub earnings or Potential admin fee card on a staff page: those were
                the sheet's estimates. What's left: Gross alone (a Founder), Gross + Songs (staff without Money), Gross + Songs + This Week
                (a client; Gross + Songs until there's a week), laid out by styles/app.css */}
            {isStaff ? (!seeMoney && (
              <div className="cat-stat" data-songs-tile><span className="cat-stat-label">Songs</span><span className="cat-stat-val">{songs.length}</span></div>
            )) : (
              <>
                <div className="cat-stat" data-songs-tile><span className="cat-stat-label">Songs</span><span className="cat-stat-val">{songs.length}</span></div>
                {weekGain != null && <div className="cat-stat"><span className="cat-stat-label">This Week</span><span className="cat-stat-val grow-val">{signed(weekGain)}</span></div>}
              </>
            )}
          </div>
          {/* (2026-11-13) the share card sits on the streams' own line: their total and top songs as an image
              (components/portal/share.jsx); nothing to share before there are streams */}
          <div className="cat-asof-row">
            <p className="hint cat-asof">
              {/* (2026-11-26 review) staff: the day the streams are from, as the client's own page says it (streamsLine), not the day the site last read the sheet */}
              {isStaff ? streamsLine(db, streamsDay(streamsNow.sheetGross, spotifyFill.on, numbersOn))
                : `Streams as of ${asOfWords(streamsDay(streamsNow.sheetGross, spotifyFill.on, numbersOn))}`}
            </p>
            {streamsNow.gross > 0 && <ShareStats clientId={clientId} name={client?.name} isStaff={!!isStaff} />}
          </div>
        </div>
  );
  return (
    <>
      {/* read-only: the client's name and role (2026-11-24: not the sheet tab their numbers come from any more) */}
      {isStaff && client && !editorOnly && (
        <div className="client-head">
          <Avatar src={client.photo} name={client.name} size={40} />
          <div className="client-head-text">
            <div className="client-head-name">{client.name}</div>
            {/* (2026-11-24) no "Sheet tab: <name>" line: the role alone, and only when there's something to say after it: a tab the sheet doesn't have (a warning).
                (2026-11-25 declutter) a client with no songs: the role alone (the song list's own empty line says there are none; no line on when their sheet tab is made) */}
            <div className="client-head-meta">{client.role || "Client"}{!songs.length ? null
              : noSheetTab(songInfo, client) ? <> · {toProfile
                ? <button type="button" className="inline-link warn-text" data-sheet-tab-go onClick={() => toProfile(`roster:${clientId}`)} title={`The pub sheet has no tab called ${client.sheetTabName?.trim() || client.name}.`}>Sheet tab: not found</button>
                : <span className="warn-text" title={`The pub sheet has no tab called ${client.sheetTabName?.trim() || client.name}.`}>Sheet tab: not found</span>}<span className="m-why">{`The pub sheet has no tab called ${client.sheetTabName?.trim() || client.name}.`}</span></>
              : null}</div>
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
      {flagWarn && <p className="hint err-text" role="alert" data-flag-warn>{flagWarn}</p>}
      {stopAsk && (
        <AskCard title={`Stop tracking ${client?.name || "this artist"}?`} goLabel="Stop tracking" busyLabel="Stopping…" onClose={() => setStopAsk(false)}
          go={async () => { await setTracking(clientId, false); setStopAsk(false); await nums.reload(); }}>
          <p>Every automatic number for them stops updating (Spotify, TikTok, Instagram, YouTube). What's been read so far is kept, and you can start it again from More ▾.</p>
        </AskCard>
      )}
      {!editorOnly && <>
      <ArtistStats nums={nums} title={isStaff ? "Campaign" : "Your numbers"} staff={isStaff} onAddLink={isStaff ? undefined : setLinkEdit} profile={isStaff ? client : myLinks} />
      {!isStaff && <MyLinks client={client} links={myLinks} edit={linkEdit} setEdit={setLinkEdit} onSaved={(out) => { if (!out.same) setMyLinks((l) => ({ ...l, [out.platform]: out.value })); nums.reload(); }} />}
      {!isStaff && <MyCommission clientId={clientId} />}
      {isStaff && summaryBlock}
      <div className="portal-block-head">
        <div>
          <h2>Songs &amp; Publishing Splits</h2>
          {/* the song count already lives in the summary's Songs stat for
              clients, and for staff who see no money (songsTile) — repeating
              it here would just be the same number twice. Staff with the
              money columns see no Songs stat there, so keep it here.
              (2026-11-25 declutter) the count alone: no sentence after it telling you to click (or tap) a card, which is plainly a button */}
          {(!songsTile || !db.sheetSync?.lastSyncedAt) && <p className="muted">{`${songs.length} Song${songs.length === 1 ? "" : "s"}`}</p>}
          {isStaff && pushWarn && <p className="hint err-text">{pushWarn}</p>}
        </div>
        <button className="btn sm" onClick={startAdd}><Plus size={15} /> Add Song</button>
      </div>

      {!isStaff && summaryBlock}

      {songs.length === 0 ? (
        <p className="muted">No songs yet — add the first one.</p>
      ) : (
        <div className="song-grid">
          {/* (2026-11-25, the owner: "... and in their client portals") a client's own page too: biggest streams first (byStreams, above) */}
          {byStreams.map((p) => (
            <button key={p.id} className="song-card" onClick={() => setOpenId(p.id)}>
              <div className="song-cover">
                {p.cover ? <Photo src={p.cover} alt={p.song} /> : <div className="song-cover-empty"><Disc3 size={26} /></div>}
              </div>
              <div className="song-info">
                <strong>{p.song || "Untitled"}</strong>
                <span>{p.artist}</span>
                {/* (2026-11-24, the owner: "just the key information") staff see a split line only when the split is missing or doesn't add up to 100%: a short chip (an even split the
                    rule can fill is the owner's to confirm, not a broken one: Splits to confirm says the same). A complete split says nothing; a client's own page still says "Pub split · N people · 100%" */}
                {isStaff
                  ? splitTotal(p.splits) !== 100 && <em>{songSplit(p, client).status === "assumed" ? <span className="split-chip split-chip-even">{songSplit(p, client).rule ? "Default split assumed" : "Even split assumed"}</span> : <span className="split-chip">Splits {splitPct(p.splits)}%</span>}</em>
                  : <em>Pub split · {(p.splits || []).length} {(p.splits || []).length === 1 ? "person" : "people"} · <span className={splitTotal(p.splits) === 100 ? undefined : "split-warn"}>{splitPct(p.splits)}%</span></em>}
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
              {/* (2026-11-26 review) read off the sheet's own Writer Share (the song's sheet fact, as To do's "No writer share in the sheet"), not off $0 earnings: a song with a few streams
                  rounds to $0.00 with its share set */}
              {isStaff && db.sheetSync?.lastSyncedAt && active.streams > 0 && db.sheetFacts?.songs?.[active.id] && !(Number(db.sheetFacts.songs[active.id].share) > 0) && Number(ownSplit(active, client)?.percent) > 0 && (
                <p className="hint song-sheet-warn"><AlertTriangle size={14} /> <span>The pub sheet has no writer share for this song ({client?.sheetTabName?.trim() || client?.name} tab), so it earns $0 there. Edit and Save to send the split to the sheet, or use Remove from catalog.</span></p>
              )}
              {/* an even split the rule can fill: shown as it would be confirmed, in a neutral note, never as a broken 0% */}
              {isStaff && activeEven && (
                <p className="hint song-even" data-song-even>Even split assumed: {splitWords(activeEven.splits, active.splits)}.</p>
              )}
              {/* the numbers before the pie (build I3): at 1440x900 the streams are in view without scrolling, the warning above them too.
                  (2026-11-13) No Net streams row: the net isn't shown on the site. (2026-11-24, the owner: "just the key information") No Pub earnings or
                  Potential admin fee row either, for anyone: those were the old pub sheet's estimates */}
              {db.sheetSync?.lastSyncedAt && (
                <div className="split-list song-nums">
                  {/* no streams from the sheet yet: Spotify's plays stand in */}
                  {(() => {
                    const sp = spotifyOnly(active);
                    return <div className="split-list-row" data-song-streams={sp ? (sp.under1k ? "spotify-under-1k" : "spotify") : "sheet"}><span className="split-name">Streams{sp && <em> (Spotify)</em>}</span><span className="split-pct">{sp?.under1k ? "Under 1,000" : fmt(sp?.n ?? active.streams)}</span></div>;
                  })()}
                  <p className="hint song-asof">{isStaff ? streamsLine(db, streamsDay(active.streams, spotifyOnly(active)?.on, numbersOn))
                    : `as of ${asOfWords(streamsDay(active.streams, spotifyOnly(active)?.on, numbersOn))}`}</p>
                </div>
              )}
              {/* (2026-11-11, the owner: "make it clear that the splits are pub splits for each song") (2026-11-25 declutter) the heading says it: no hint line beside it */}
              <div className="song-splits-head" data-splits-head><h4>Publishing splits</h4></div>
              {/* (2026-11-26 review) no legend under the donut (components/SplitsPieChart.jsx): the list below names each colour with its %. 200 tall: the same donut, without the legend's 30px */}
              <SplitsPie splits={activeEven ? activeEven.splits : active.splits} size={200} />
              <div className="split-list">
                {(() => { const hue = splitColors(activeEven ? activeEven.splits : active.splits); return orderSplits(activeEven ? activeEven.splits : active.splits || []).map((s, i) => (
                  <div key={s.unnamed ? `u${i}` : s.id} className="split-list-row">
                    <span className="split-name">{hue.get(s) && <i className="split-dot" style={{ background: hue.get(s) }} aria-hidden="true" />}{s.name || s.label || "—"}{s.role && !s.unnamed && <em> · {s.role}</em>}{activeEven && (s.unnamed || !(Number((active.splits || []).find((t) => t.id === s.id)?.percent) > 0)) && <em> · assumed</em>}</span>
                    {/* two decimals, as the editor shows it (a sixth is 16.67%, not 16.666666666666668%); the saved % is unchanged */}
                    <span className="split-pct">{splitPct([s])}%</span>
                  </div>
                )); })()}
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
            {/* (2026-11-25 declutter) no help line above the buttons saying which is which: each one's confirm card says what it takes away */}
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

      {/* (2026-11-26 review) no click outside: the editor closes with its X or Cancel only (Esc neither, above) */}
      {editing && (
        <div className="modal">
          <div className="modal-card">
            <div className="modal-head"><h3>{editing.id ? "Edit song" : "Add song"}</h3><button onClick={() => setEditing(null)} aria-label="Close"><X size={18} /></button></div>
            <div className="modal-body">
              <SpotifyFill e={editing} set={setEditing} />
              <PhotoUpload label="Cover art" value={editing.cover} onChange={(v) => setEditing({ ...editing, cover: v })} />
              <Field label="Song" value={editing.song} onChange={(ev) => setEditing({ ...editing, song: ev.target.value })} />
              <Field label="Artist" value={editing.artist} onChange={(ev) => setEditing({ ...editing, artist: ev.target.value })} />
              <Field label="Release date" type="date" data-field="releaseDate" value={editing.releaseDate} onChange={(ev) => setEditing({ ...editing, releaseDate: ev.target.value })} />
              <Field label="Streaming link" data-field="link" value={editing.link} onChange={(ev) => setEditing({ ...editing, link: ev.target.value })} />
              <label className="check-row" data-not-on-streaming>
                <input type="checkbox" checked={noStream ?? skipOf(editing.id)} onChange={(ev) => setNoStream(ev.target.checked)} />
                <span>Not on streaming</span>
              </label>
              <SplitsEditor splits={editing.splits} onChange={(v) => setEditing({ ...editing, splits: v })} focusPct={splitsFirst} assume={!!isStaff || !editing.id} forClient={!isStaff} owner={client} artist={editing.artist} />
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
        {/* (2026-11-25, mobile) the logo stays in the portal (the top of it), as the dashboard's does: an installed app has no Back to come home with */}
        <Link href={ROUTE_TO_PATH.client} className="logo-link" aria-label="Your portal"><Wordmark height={26} /></Link>
        <div className="portal-who">
          <span>{client?.name || session.name}</span>
          <button onClick={() => setPwOpen(true)} data-change-password><KeyRound size={16} /> <span className="portal-pw-label">Password</span></button>
          <button onClick={logout} disabled={signingOut}>{signingOut ? <><RefreshCw size={16} className="spin" /> Signing out…</> : <><LogOut size={16} /> Sign out</>}</button>
        </div>
      </header>
      <main className="portal-main">
        <InstallApp />
        <h1 className="portal-title">{client?.name || session.name}</h1>
        {/* (2026-11-26 review) a part that breaks shows the error screen in place of the songs only: the header's Password and Sign out stay usable,
            and Try again draws it again without a reload */}
        <AppErrorBoundary inline resetKey={session.id}>
        <div className="portal-block">
          <SongManager db={db} commit={commit} clientId={session.clientId} />
        </div>
        </AppErrorBoundary>
      </main>
      {pwOpen && <PasswordCard onClose={() => setPwOpen(false)} />}
    </div>
  );
}
