import { useState, useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { X, Plus, LayoutGrid, Folder, RefreshCw } from "lucide-react";
import { splitWords, orderSplits } from "../../lib/splits";
import { typedSplit, pctText } from "../../lib/split-fixes";
import LinkBox from "../LinkBox";
import { SONG_GAPS } from "../../lib/sheet-facts";
import { mergedCard, mergedTitle } from "../../lib/duplicates";
import { PhoneSort } from "../ui/responsive";
import { NAME_TAKEN, clientDeleteAsk, deleteClientCascade, nameTaken } from "./clients";
import { WowPill } from "./chips";
import { GAP_WORDS, WEEK_PCT_MIN, dayRange, dupeName, songsPost, songsToUpdate, useGrowthState } from "./helpers";
import { canUse } from "./access";
import { Avatar, DropNote, Field, PctInput, fmt, landOn, money, revealChip, splitPct, splitTotal, streamsAsOf, uid, useEscape } from "./ui";
import { NotOursAsk, SongManager, noSheetTab, pushShare, releaseDay } from "../portal/ClientPortal";
import { AskCard } from "../portal/ask";
import { ExtLink, Photo } from "../shared/ui";
import { SectionWait } from "./sections";
import { findByName, ownSplit } from "../site/data";
import { normalizeTitle, splitsToConfirm, fullSiteSync } from "./catalog-data";
import { dashCache } from "../shared/dash-caches";
export { normalizeTitle, isSheetSyncStale, fullSiteSync, shareFixesOf, splitsToConfirm } from "./catalog-data";
// the Advance calculator reads A&R's sheet (advance.jsx, with A&R's code): its own chunk, loaded when it opens (list B #11)
const AdvanceTab = dynamic(() => import("./advance").then((m) => m.AdvanceTab), { ssr: false, loading: SectionWait });

// a song's row on its client's tab, in the same order the sheet pull matches them (pullAndMergeSheetData):
// its own Site Sync ID, then its Luminate ID, then a row with its title that no live song has claimed
const sheetRowOf = (p, rows, live) => rows.find((r) => r.syncId && r.syncId.split(":")[0] === p.id)
  || (p.luminateId && rows.find((r) => r.luminateId && r.luminateId === p.luminateId))
  || rows.find((r) => (!r.syncId || !live.has(r.syncId.split(":")[0])) && normalizeTitle(r.song) === normalizeTitle(p.song)) || null;
const pctOf = (v) => `${splitPct([{ percent: v }])}%`;
// To do's own reads around a song row push (/api/split-fixes, read only; r11 todofix: the formula guard itself is
// inside the routes that write): "guard", the cards' pre-check before anything changes, by the push route's own
// rules; "guardAfter", the read-back when a push or a stamp didn't come back. The answer, or { error } when it
// couldn't be asked (a pre-check that couldn't be asked changes nothing)
async function guardPost(body) {
  const r = await fetch("/api/split-fixes", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify(body) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  return r?.ok ? j : { error: j.error || "The pub sheet couldn't be checked just now, so nothing was changed. Try again." };
}
// a push or a stamp that came back with an error but didn't say nothing was written (no answer, a 502 that didn't
// read its own write back): the tab is read again against the pre-check's (g) formulas. null, or the loud line
const readAgain = async (r, placementId, g) => {
  if (!g || r.written === false || r.checked) return null;
  const a = await guardPost({ action: "guardAfter", placementId, row: g.row, sig: g.sig, cells: g.cells });
  return a.ok ? null : a.alarm || `Row ${g.row} of the ${g.tab} tab couldn't be read back after the write. Check it on the sheet.`;
};
// Each person on a split with their % in a box (r11 todoedit, the owner: "autofill numbers and give me the option to
// type them"): the confirm cards and the merge card. splits: what the site worked out; typed: { rowId: text };
// check: typedSplit's answer for them; under: what a total under 100% means here (the merge only)
function SplitBoxes({ splits, typed, onType, check, song, under = null }) {
  const label = (r) => (r.unnamed ? r.label || `${r.role} (unnamed)` : `${r.name || "Unnamed"}${r.role ? ` · ${String(r.role).trim().toLowerCase()}` : ""}`);
  const sides = [["artist", check.sides.Artist], ["producer", check.sides.Producer]].filter(([, v]) => v > 0).map(([k, v]) => `${k} side ${pctText(v)}%`);
  const words = check.reason || `Adds up to ${pctText(check.total)}%${sides.length ? ` (${sides.join(", ")})` : ""}.${under && check.total < 99.95 ? ` ${under}` : ""}`;
  return (
    <div className="todoedit-split" data-split-boxes>
      {orderSplits(splits).map((r) => (
        <label key={r.id} className="fld todoedit-pct" data-split-row={r.id}>
          <span>{label(r)}</span>
          <PctInput data-pct-in={r.id} value={typed?.[r.id] ?? pctText(Number(r.percent) || 0)} invalid={!!check.bad[r.id]} aria-label={`${label(r)}'s share of ${song || "Untitled"}, in percent`}
            onChange={(e) => onType(r.id, e.target.value)} />
        </label>
      ))}
      <p className={check.reason ? "todoedit-total warn-text" : "todoedit-total"} data-split-total role={check.reason ? "alert" : undefined}>{words}</p>
    </div>
  );
}
export function SplitsToFix({ db, commit, reloadDb, songInfo, reloadSongInfo, onFix, focus, onGo, dupes = [], onDupe }) {
  const { assumed, look, all: flat } = useMemo(() => splitsToConfirm(db, songInfo), [db, songInfo]);
  const n = assumed.length + look.length, nDiffer = assumed.filter((x) => x.r.differ).length;
  const [ask, setAsk] = useState(null);
  const [note, setNote] = useState(null);
  const [all, setAll] = useState(false); // the Confirm all card
  const [askOne, setAskOne] = useState(null); // a single Confirm: its card (r11 todoedit: every Confirm, its shares typed)
  // the shares typed in the cards (r11 todoedit): { songId: { rowId: text } }; a song with none keeps the even split
  const [typed, setTyped] = useState({});
  const typeIn = (id) => (rowId, v) => setTyped((t) => ({ ...t, [id]: { ...t[id], [rowId]: v } }));
  const checkOf = (x) => typedSplit(x.r.splits, typed[x.p.id] || {}, { exact: true, own: x.client?.name });
  const [busy, setBusy] = useState(null); // the song being confirmed
  const box = useRef(null);
  // opened from the Dashboard's To do: the list is what to look at
  useEffect(() => { if (focus) landOn(box.current); }, [focus]);
  const tabOf = (c) => c?.sheetTabName?.trim() || c?.name;
  // what Confirm does to the pub sheet, per song. Only the client's own share is ever written, and never to a
  // client whose tab can't be found: the push would claim an empty WRITER tab or copy TEMPLATE under their name
  // and the real tab would stay as it is. A share that changes what the sheet holds now is said before it's written
  const [sheetNow, setSheetNow] = useState({}); // placementId -> { found, share (null = blank) }; absent = not read
  const [reads, setReads] = useState(0);
  const pushes = (x) => !!(x.client && ownSplit({ splits: x.r.splits }, x.client) && !noSheetTab(songInfo, x.client));
  const readKey = [...new Set(assumed.filter(pushes).map((x) => x.client.id))].sort().join(",");
  useEffect(() => {
    if (!readKey) return;
    let off = false;
    const clients = readKey.split(",").map((id) => db.clients.find((c) => c.id === id)).filter(Boolean);
    fetch("/api/sheets-pull", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
      body: JSON.stringify({ clients: clients.map((c) => ({ id: c.id, name: c.name, sheetTabName: c.sheetTabName })) }),
    }).then((r) => (r.ok ? r.json() : null)).then((data) => {
      if (off || !data) return;
      const live = new Set(db.placements.map((p) => p.id));
      const out = {};
      for (const c of data.clients || []) {
        if (!c.tabFound) continue;
        for (const p of db.placements.filter((q) => q.clientId === c.clientId)) {
          const row = sheetRowOf(p, c.rows || [], live);
          out[p.id] = { found: !!row, share: row && Number(row.writerShare) > 0 ? Number(row.writerShare) : null };
        }
      }
      setSheetNow(out);
    }).catch(() => {}); // unread: every Confirm that writes then asks first
    return () => { off = true; };
  }, [readKey, reads]); // eslint-disable-line react-hooks/exhaustive-deps
  // splits: the split being confirmed (the even one, or the one typed in its card)
  const plan = (x, splits = x.r.splits) => {
    const own = x.client && ownSplit({ splits }, x.client);
    if (!own) return { kind: "none" };
    if (noSheetTab(songInfo, x.client)) return { kind: "tabless" };
    const will = Number(own.percent), now = sheetNow[x.p.id];
    if (!now) return { kind: "unread", will };
    if (!now.found) return { kind: "new", will };
    if (now.share == null || Math.abs(now.share - will) > 0.05) return { kind: "change", from: now.share, will };
    return { kind: "same", will };
  };
  // the change in a few words, on the row and in the cards
  const changeWords = (pl) => pl.kind === "change" ? `sheet now ${pl.from == null ? "blank" : pctOf(pl.from)} → ${pctOf(pl.will)}`
    : pl.kind === "new" ? `not on the sheet yet → ${pctOf(pl.will)}`
    : pl.kind === "tabless" ? "set the sheet tab first" : null;
  // edits: { songId: the split typed in its card } (checked by typedSplit); a song not in it keeps its even split
  const confirmSplits = async (items0, edits = {}) => { // (not "confirm": that reads like the browser dialog)
    setNote(null);
    const splitOf = (x) => edits[x.p.id] || x.r.splits;
    const plans = new Map(items0.map((x) => [x.p.id, plan(x, splitOf(x))]));
    // the pre-check (r11 todofix), before anything changes: each song whose share goes to the sheet, checked on the
    // server by the push route's own rules (its row read with FORMULA: no formula in A, B, D or N, not the Total row;
    // the share and the split), all in one call. A song it refuses, or one it couldn't check, isn't confirmed: it
    // stays in the list as it was, and the note says why
    const live0 = db.placements.map((p) => p.id);
    const toSheet = items0.filter((x) => { const k = plans.get(x.p.id).kind; return k !== "none" && k !== "tabless"; });
    const checked = new Map(), held = [];
    if (toSheet.length) {
      const g = await guardPost({ action: "guard", items: toSheet.map((x) => ({ placementId: x.p.id, percent: Number(ownSplit({ splits: splitOf(x) }, x.client).percent), splits: splitOf(x), exact: true, liveIds: live0 })) });
      toSheet.forEach((x, i) => { const r = g.items?.[i]; if (r?.ok) checked.set(x.p.id, r); else held.push(`"${x.p.song || "Untitled"}": ${r?.error || g.error}`); });
    }
    const heldNote = held.length ? `Not confirmed, so nothing changed for ${held.length === 1 ? "it" : "them"}: ${held.join(" ")}` : "";
    const items = items0.filter((x) => !toSheet.includes(x) || checked.has(x.p.id));
    if (!items.length) return setNote({ warn: true, text: heldNote });
    const by = new Map(items.map((x) => [x.p.id, splitOf(x)]));
    const done = await commit({ ...db, placements: db.placements.map((p) => (by.has(p.id) ? { ...p, splits: by.get(p.id) } : p)) });
    if (!done) return; // the save's own error banner says why, and nothing went to the sheet
    const live = done.placements.map((p) => p.id);
    const failed = [], wrote = [], changed = [], tabless = [], refused = [], alarms = [];
    // one at a time: two pushes to the same tab at once could both pick the same empty row
    for (const x of items) {
      const saved = done.placements.find((p) => p.id === x.p.id);
      const client = done.clients?.find((c) => c.id === x.p.clientId) || x.client;
      if (!saved || !client || !ownSplit(saved, client)) continue; // not on their own split: nothing to write
      if (noSheetTab(songInfo, client)) { tabless.push(`${saved.song || "Untitled"} (${client.name})`); continue; }
      // (checked above; a song that wasn't pre-checked, its tab unset then, is never pushed from here)
      const g = checked.get(x.p.id);
      if (!g) continue;
      // the push route guards the write itself and reads it back (alarm: a formula that changed, said loudly)
      const r = await pushShare(saved, client, live, { check: "confirm" });
      if (r.alarm) alarms.push(r.alarm);
      if (r.refused) { refused.push(`"${saved.song || "Untitled"}": ${r.error}`); continue; }
      if (r.error) {
        failed.push(`${saved.song || "Untitled"} (${r.error})`);
        // no answer, or an error that doesn't say nothing was written: the tab is read again all the same
        const again = await readAgain(r, saved.id, g);
        if (again) alarms.push(again);
        continue;
      }
      wrote.push(x);
      const pl = plans.get(x.p.id);
      if (pl.kind === "change") changed.push(`${saved.song || "Untitled"} ${pl.from == null ? "blank" : pctOf(pl.from)} → ${pctOf(pl.will)}`);
      if (pl.kind === "new") changed.push(`${saved.song || "Untitled"} added at ${pctOf(pl.will)}`);
    }
    setReads((k) => k + 1);
    // a share that differed from the sheet is the sheet's now (the push route keeps it): the list follows at once
    if (wrote.some((x) => x.r.differ)) reloadDb?.();
    const tabNote = tabless.length ? ` Not written to the pub sheet, because the client's sheet tab isn't set: ${tabless.join(", ")}. Set the sheet tab first, then open the song and Save.` : "";
    // a refused write and a formula that changed are said first and loudly, whatever else happened
    const guardNote = [heldNote, refused.length && `Confirmed on the site, but not written to the pub sheet: ${refused.join(" ")}`, ...alarms].filter(Boolean).join(" ");
    if (failed.length) return setNote({ warn: true, text: `Confirmed on the site, but the pub sheet wasn't updated for ${failed.join(", ")}. Open the song and Save again.${tabNote}${guardNote ? ` ${guardNote}` : ""}` });
    // (a song left as it was is said after the ones confirmed)
    if (guardNote && !wrote.length && !held.length) return setNote({ warn: true, text: `${guardNote}${tabNote}` });
    if (items.length === 1) {
      const x = items[0], pl = plans.get(x.p.id);
      const sheet = !wrote.length ? "" : pl.kind === "change" ? ` ${x.client.name}'s writer share on the ${tabOf(x.client)} tab went from ${pl.from == null ? "blank" : pctOf(pl.from)} to ${pctOf(pl.will)}.`
        : pl.kind === "new" ? ` It was added to the ${tabOf(x.client)} tab with ${x.client.name}'s writer share at ${pctOf(pl.will)}.`
        : ` ${x.client.name}'s writer share on the ${tabOf(x.client)} tab is ${pctOf(pl.will)}.`;
      return setNote({ warn: !!tabless.length || !!alarms.length || !!held.length, text: `Confirmed "${x.p.song || "Untitled"}": ${splitWords(splitOf(x), null, { confirmed: true })}.${sheet}${tabNote}${guardNote ? ` ${guardNote}` : ""}` });
    }
    const w = wrote.length, typedN = items.filter((x) => edits[x.p.id]).length;
    setNote({ warn: !!tabless.length || !!guardNote, text: `Confirmed ${items.length} ${typedN ? "split" : "even split"}${items.length === 1 ? "" : "s"}${typedN ? ` (${typedN} as typed)` : ""}.${w ? ` ${w} writer share${w === 1 ? " is" : "s are"} on the sheet${changed.length ? `; ${changed.length} changed (${changed.join(", ")})` : ""}.` : ""}${tabNote}${guardNote ? ` ${guardNote}` : ""}` });
  };
  const one = async (x, splits = null) => { setBusy(x.p.id); try { await confirmSplits([x], splits ? { [x.p.id]: splits } : {}); } finally { setBusy(null); } };
  // a card opens with the even split in its boxes, whatever was typed in it last time
  const openOne = (x) => { setTyped((t) => ({ ...t, [x.p.id]: {} })); setAskOne(x); };
  const openAll = () => { setTyped({}); setAll(true); };
  // the Confirm all card, worked out from what's typed in it
  const allChecks = new Map(assumed.map((x) => [x.p.id, checkOf(x)]));
  const allPlan = (x) => plan(x, allChecks.get(x.p.id).splits);
  const allWrites = assumed.filter(pushes);
  const allChanges = assumed.filter((x) => { const k = allPlan(x).kind; return k === "change" || k === "new"; });
  const allTabless = assumed.filter((x) => allPlan(x).kind === "tabless");
  const allBad = assumed.filter((x) => allChecks.get(x.p.id).reason).length;
  // once a box in it was changed, the card stops calling them even splits
  const allTyped = assumed.some((x) => { const ck = allChecks.get(x.p.id); return ck.edited || !!ck.reason; });
  // what Confirm does to the sheet, for the one card (r11 todoedit: a share that already matches is said too, as the
  // card opens for every Confirm now)
  const sheetWords = (x, pl) => pl.kind === "change"
    ? `This changes ${x.client.name}'s writer share on the ${tabOf(x.client)} tab of the pub sheet from ${pl.from == null ? "blank" : pctOf(pl.from)} to ${pctOf(pl.will)}. The song's earnings on the sheet change with it.`
    : pl.kind === "new" ? `The ${tabOf(x.client)} tab of the pub sheet has no row for this song yet. Confirm adds it with ${x.client.name}'s writer share at ${pctOf(pl.will)}.`
    : pl.kind === "unread" ? `This writes ${x.client.name}'s ${pctOf(pl.will)} to the ${tabOf(x.client)} tab of the pub sheet. The share on the sheet now couldn't be read.`
    : pl.kind === "same" ? `${x.client.name}'s writer share on the ${tabOf(x.client)} tab is already ${pctOf(pl.will)}, so the sheet stays as it is.`
    : pl.kind === "tabless" ? `Saved on the site only: set ${x.client.name}'s sheet tab first.`
    : `${x.client?.name || "The client"} isn't on this split, so nothing is written to the pub sheet.`;
  const tabs = new Set(allWrites.map((x) => x.client.id)).size;
  const row = (x, acts, mid) => (
    <div className="fix-row" key={x.p.id} data-song={x.p.id} data-kind={x.r.differ ? "differ" : x.r.status === "assumed" ? "assumed" : "look"}>
      <span className="fix-song"><span className="fix-who">{x.client?.name || "A deleted client"} · </span>{x.p.song || "Untitled"}</span>
      {mid}
      <span className="fix-streams">{fmt(x.p.streams || 0)} streams</span>
      <span className="fix-acts">{acts}</span>
    </div>
  );
  return (
    <div className={`fix-panel${focus ? " flash" : ""}`} ref={box} data-sec="splits">
      <div className="fix-head">
        <h3>{n ? `Splits to confirm (${n})` : "Splits"}</h3>
        <span className="hint">{n ? "Even by default: 50% artist side, 50% producer side. Confirm writes only the client's own share to the sheet." : "All splits add up."}</span>
      </div>
      <DropNote note={note} />
      <HeldDupes dupes={dupes} onDupe={onDupe} />
      {n > 0 && (
        <div className="fix-group" data-group="all">
          {/* one flat list, biggest streams first: an even split has Confirm, one that needs a look has Fix */}
          <div className="fix-sub">
            <span className="fix-client" data-split-counts>{[nDiffer && `${nDiffer} ${nDiffer === 1 ? "share differs" : "shares differ"} from the sheet`, assumed.length - nDiffer && `${assumed.length - nDiffer} assumed as an even split`, look.length && `${look.length} need${look.length === 1 ? "s" : ""} review`].filter(Boolean).join(" · ")}</span>
            {assumed.length > 0 && <button className="btn sm" data-confirm-all disabled={!!busy} onClick={openAll}>Confirm all {assumed.length}</button>}
          </div>
          {flat.map((x) => {
            if (x.r.status !== "assumed") return row(x, <>
              <button className="btn sm" onClick={() => onFix(x.p.id)}>Fix</button>
              {x.client && <button className="quiet-act" data-not-ours onClick={() => { setNote(null); setAsk({ p: x.p, client: x.client }); }}>Remove from catalog</button>}
            </>, <span className="fix-mid"><span className="fix-words fix-why"><span className="split-warn fix-pct">{splitPct(x.p.splits)}%</span> {x.r.reason}</span></span>);
            const pl = plan(x), cw = changeWords(pl);
            return row(x,
              <button className="btn sm" data-confirm disabled={!!busy} onClick={() => openOne(x)}>{busy === x.p.id ? "Confirming…" : "Confirm"}</button>,
              <span className="fix-mid">{x.r.differ && <span className="fix-sheet" data-differ>{x.client?.name}: {pctOf(x.r.differ.site)} here, {pctOf(x.r.differ.sheet)} on the sheet</span>}
                <span className="fix-words">{splitWords(x.r.splits, x.r.differ ? null : x.p.splits)}</span>
                {cw && <span className={`fix-sheet${pl.kind === "tabless" ? " tabless" : ""}`} data-sheet-change={pl.kind}>{cw}</span>}</span>);
          })}
        </div>
      )}
      {all && (
        <AskCard title={`Confirm ${assumed.length} ${allTyped ? "split" : "even split"}${assumed.length === 1 ? "" : "s"}?`} goLabel={`Confirm all ${assumed.length}`} busyLabel="Confirming…" plain goDisabled={allBad > 0}
          go={async () => { await confirmSplits(assumed, Object.fromEntries(assumed.filter((x) => allChecks.get(x.p.id).edited).map((x) => [x.p.id, allChecks.get(x.p.id).splits]))); setAll(false); }} onClose={() => setAll(false)}>
          <p data-ask-writes>{allWrites.length
            ? `Writes the writer share for ${allWrites.length} song${allWrites.length === 1 ? "" : "s"} on ${tabs} client${tabs === 1 ? "'s" : "s'"} sheet tab${tabs === 1 ? "" : "s"}.`
            : "Nothing is written to the pub sheet: none of these clients is on their own split."} Unnamed people are only kept on the site.</p>
          {allChanges.length > 0 && <p data-ask-changes>{allChanges.length === 1 ? "1 of them changes" : `${allChanges.length} of them change`} the share on the sheet now, and that song's earnings change with it.</p>}
          {allTabless.length > 0 && <p data-ask-tabless>{allTabless.length === 1 ? "1 song is" : `${allTabless.length} songs are`} saved on the site only: set the client's sheet tab first.</p>}
          <p className="hint" data-ask-type>Each song starts at the even split. Type a share to change it; each song has to add up to 100%.</p>
          {allBad > 0 && <p className="hint warn-text" data-ask-bad>{allBad === 1 ? "1 song doesn't" : `${allBad} songs don't`} add up yet.</p>}
          {assumed.map((x) => { const ck = allChecks.get(x.p.id), cw = changeWords(allPlan(x)); return (
            <div key={x.p.id} className="todoedit-song" data-confirm-song={x.p.id}>
              <p className="ask-share-song">{x.p.song || "Untitled"} <span>· {x.client?.name || "no client"}</span>{cw && <b className="todoedit-change"> · {cw}</b>}</p>
              <SplitBoxes splits={x.r.splits} typed={typed[x.p.id]} onType={typeIn(x.p.id)} check={ck} song={x.p.song} />
            </div>
          ); })}
        </AskCard>
      )}
      {askOne && (() => { const ck = checkOf(askOne), pl = plan(askOne, ck.splits); return (
        <AskCard title={`Confirm "${askOne.p.song || "Untitled"}"?`} goLabel="Confirm" busyLabel="Confirming…" plain goDisabled={!!ck.reason}
          go={async () => { await one(askOne, ck.edited ? ck.splits : null); setAskOne(null); }} onClose={() => setAskOne(null)}>
          <p className="hint" data-ask-type>{askOne.r.differ ? `${askOne.client?.name} has ${pctOf(askOne.r.differ.site)} here and ${pctOf(askOne.r.differ.sheet)} on the sheet. ${askOne.r.rule ? "The default split to start" : "The site's split to start"}` : "The even split to start"}. Type a share to change it; it has to add up to 100%.</p>
          <SplitBoxes splits={askOne.r.splits} typed={typed[askOne.p.id]} onType={typeIn(askOne.p.id)} check={ck} song={askOne.p.song} />
          <p data-ask-change>{sheetWords(askOne, pl)} Unnamed people stay on the site only.</p>
        </AskCard>
      ); })()}
      {ask && (
        <NotOursAsk db={db} commit={commit} songInfo={songInfo} target={ask.p} client={ask.client} onClose={() => setAsk(null)}
          onDone={(r) => { setAsk(null); setNote(r); reloadSongInfo?.(); }} />
      )}
    </div>
  );
}

// Songs to update and Splits to confirm leave out the cards of a possible duplicate until it's reviewed: one line
// says so and opens the merge card, the single place that pair is handled
function HeldDupes({ dupes, onDupe }) {
  if (!dupes?.length || !onDupe) return null;
  return (
    <p className="hint fix-held" data-held>
      {dupes.length === 1 ? `${dupeName(dupes[0])} is a possible duplicate, so both of its cards are left out of this list until it's reviewed.` : `${dupes.length} possible duplicate songs are left out of this list until they're reviewed.`}
      {" "}<button className="inline-link" data-held-review onClick={onDupe}>Review</button>
    </p>
  );
}
const UPDATE_FIRST = 8;
// a row's chips, the money gaps first (no writer share, not on the sheet), as updateWords names them
const GAP_RANK = ["share", "sheet", "date", "link"];
const gapRank = (k) => (GAP_RANK.includes(k) ? GAP_RANK.indexOf(k) : GAP_RANK.length);
// Publishing › Songs to update: what each song is missing, one button that opens the song at the first gap
export function SongsToUpdate({ db, songInfo, onFix, focus, dupes = [], onDupe }) {
  const list = useMemo(() => songsToUpdate(db, songInfo), [db, songInfo]);
  const box = useRef(null);
  useEffect(() => { if (focus) landOn(box.current); }, [focus]);
  // the biggest 8 first, so Overview's totals stay close; a gap chip narrows the list to that gap
  const [gap, setGap] = useState(null);
  const [more, setMore] = useState(false);
  const [opened, setOpened] = useState(() => new Set()); // phone rows whose "+N" was tapped: every chip shows
  const counts = useMemo(() => { const n = {}; for (const x of list) for (const g of x.gaps) if (GAP_WORDS[g.k]) n[g.k] = (n[g.k] || 0) + 1; return n; }, [list]);
  const shown = gap && counts[gap] ? list.filter((x) => x.gaps.some((g) => g.k === gap)) : list;
  const rows = more ? shown : shown.slice(0, UPDATE_FIRST);
  return (
    <div className={`fix-panel${focus ? " flash" : ""}`} ref={box} data-sec="update">
      <div className="fix-head">
        <h3>{list.length ? `Songs to update (${list.length})` : "Songs to update"}</h3>
        <span className="hint">{list.length ? "What each song is missing, from the last sheet pull. Update opens the song there." : "Every song has its sheet row, writer share, release date and link."}</span>
      </div>
      <HeldDupes dupes={dupes} onDupe={onDupe} />
      {Object.keys(counts).length > 1 && (
        <div className="upd-filters" data-upd-filters>
          <button className={`upd-filter${gap ? "" : " on"}`} aria-pressed={!gap} onClick={() => setGap(null)}>All ({list.length})</button>
          {Object.keys(GAP_WORDS).filter((k) => counts[k]).map((k) => (
            <button key={k} className={`upd-filter${gap === k ? " on" : ""}`} aria-pressed={gap === k} data-filter={k} onClick={() => { setGap(gap === k ? null : k); setMore(false); }}>{SONG_GAPS.find(([g]) => g === k)?.[1]} ({counts[k]})</button>
          ))}
        </div>
      )}
      {list.length > 0 && (
        <div className="fix-group" data-group="update">
          {rows.map((x) => { const gs = [...x.gaps].sort((a, b) => gapRank(a.k) - gapRank(b.k)), extra = gs.length + (x.splitSee ? 1 : 0) - 2, open = opened.has(x.p.id); return (
            <div className={`fix-row${open ? " upd-open" : ""}`} key={x.p.id} data-song={x.p.id}>
              <span className="fix-song"><span className="fix-who">{x.client?.name || "A deleted client"} · </span>{x.p.song || "Untitled"}</span>
              {/* money gaps first (as the To do names them); on phones the first two chips and a "+N" that shows the rest */}
              <span className="fix-mid upd-gaps">
                {gs.map((g, i) => <span key={g.k} className={`upd-gap${i >= 2 ? " upd-gap-x" : ""}`} data-gap={g.k}>{g.label}</span>)}
                {x.splitSee && <span className={`upd-gap upd-split${gs.length >= 2 ? " upd-gap-x" : ""}`} data-gap="split-see">Split: see Splits to confirm</span>}
                {/* m-tap-off: a chip-sized toggle so the row stays short; its ::after is the 44px tap area (mobile.css) */}
                {extra > 0 && <button type="button" className="upd-gap upd-gap-more m-tap-off" data-gap-more aria-expanded={open} aria-label={open ? "Show fewer" : `Show ${extra} more`}
                  onClick={() => setOpened((o) => { const n = new Set(o); if (n.has(x.p.id)) n.delete(x.p.id); else n.add(x.p.id); return n; })}>{open ? "Less" : `+${extra}`}</button>}
              </span>
              <span className="fix-streams">{fmt(x.p.streams || 0)} streams</span>
              <span className="fix-acts"><button className="btn sm" data-update onClick={() => onFix(x.p.id, (x.gaps[0] || {}).field)}>Update</button></span>
            </div>
          ); })}
          {shown.length > UPDATE_FIRST && <button className="inline-link upd-more" data-upd-more onClick={() => setMore(!more)}>{more ? `Show the first ${UPDATE_FIRST}` : `Show all ${shown.length}`}</button>}
        </div>
      )}
    </div>
  );
}

// The merge card (build H1): the two cards side by side and the card the merge leaves. The kept card is the one
// with the pub sheet row and the Luminate id; it keeps its title, streams, row and id, and takes what it lacks
// (release date, link, cover) and the split that adds up to 100% from the other. The other card comes off the
// site. It has no row, so nothing is written to the sheet for it; the kept card's row is written only when the
// client's own share changes (the song editor's Save step, pushShare). (The Luminate id is the sheet row's
// own column M, which the sheet's formulas still read; the site never writes it.) "Not the same song" is kept
// (app_state, /api/songs) so the pair never comes back.
// r11 todoedit: the split after merging is typed in (each person's % in a box, the merge's own split to start); the
// share the sheet gets follows it. The kept row is read with FORMULA before the Site Sync ID stamp and the push (a
// formula in A, B, D or N, and nothing changes), and the tab's formulas are read again after. r11 todofix: that check
// is the card's pre-check; the stamp and the push guard and read back their own writes (their routes), and a split
// the card can't merge says why beside the greyed-out button as well as under the boxes.
const splitLine = (splits) => {
  const list = orderSplits(splits || []);
  if (!list.length) return "No split yet";
  const t = splitTotal(list);
  return `${list.map((x) => `${x.name || x.label || "Unnamed"} ${splitPct([x])}%`).join(" · ")}${t === 100 ? "" : ` (adds up to ${splitPct(list)}%)`}`;
};
export function DupeMerge({ db, commit, songInfo, reloadSongInfo, pair, onClose, onDone }) {
  const { keep, drop, client } = pair;
  const facts = db.sheetFacts?.songs || {};
  // the title it keeps (build I2), which staff can switch
  const pick = mergedTitle(keep, drop);
  const [title, setTitle] = useState(pick.title);
  const base = mergedCard(keep, drop);
  // the split after merging, as typed (r11 todoedit): { rowId: text }; untouched, it's the merge's own split exactly
  const [typed, setTyped] = useState({});
  const check = typedSplit(base.splits, typed, { exact: false, own: client?.name });
  const merged = { ...base, song: title, splits: check.splits };
  const tab = client?.sheetTabName?.trim() || client?.name || "";
  // the client's tab as it is now, read when the card opens and again at Merge (a read only, as Splits to confirm
  // does): the facts are from the last pull, and a row typed in, imported or added by a Save since then would make
  // the card being removed one that has a row. null = reading; { ok, keepRow, dropRow, share }
  const [fresh, setFresh] = useState(null);
  const [blocked, setBlocked] = useState(null);
  const readTab = async () => {
    try {
      const r = await fetch("/api/sheets-pull", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
        body: JSON.stringify({ clients: [{ id: client.id, name: client.name, sheetTabName: client.sheetTabName }] }),
      });
      const c = r.ok ? (await r.json())?.clients?.find((x) => x.clientId === client.id) : null;
      if (!c?.tabFound) return { ok: false };
      const live = new Set(db.placements.map((p) => p.id));
      const k = sheetRowOf(keep, c.rows || [], live), d = sheetRowOf(drop, c.rows || [], live);
      // byId: the push finds this row by itself (its Site Sync ID, or the merged card's Luminate id in M). A row
      // matched by its old title only is stamped first (/api/sheets-claim), or a push under the new title adds a row
      const byId = !!k && ((!!k.syncId && k.syncId.split(":")[0] === keep.id) || (!!merged.luminateId && (k.luminateId || "").trim() === merged.luminateId));
      return { ok: true, keepRow: k?.row ?? null, keepSong: k ? String(k.song ?? "") : null, keepById: byId, dropRow: d?.row ?? null, share: k && Number(k.writerShare) > 0 ? Number(k.writerShare) : null };
    } catch { return { ok: false }; }
  };
  useEffect(() => { let off = false; if (client) readTab().then((f) => { if (!off) setFresh(f); }); return () => { off = true; }; }, [keep.id, drop.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const row = fresh?.ok ? fresh.keepRow : facts[keep.id]?.row ?? null;
  // what the merge does to the client's writer share on their tab: only the kept card's row, and only on a change
  const own = client ? ownSplit(merged, client) : null;
  const will = own ? Number(own.percent) : null;
  const planFor = (f) => {
    const r = f?.ok ? f.keepRow : facts[keep.id]?.row ?? null, now = f?.ok ? f.share : facts[keep.id]?.share ?? null;
    return !own ? { kind: "none" } : r == null ? { kind: "norow" } : noSheetTab(songInfo, client) ? { kind: "tabless" }
      : now != null && Math.abs(now - will) <= 0.05 ? { kind: "same", will } : { kind: "change", from: now, will };
  };
  const share = planFor(fresh), now = share.from ?? null;
  // the split's problem, said beside the greyed-out Merge cards too (the boxes are a screen down on a phone): a typed
  // one (typedSplit), or an untouched split over 100% whose share would go to the sheet (the push route refuses that)
  const splitWhy = check.reason || (share.kind === "change" && check.total > 100.05 ? `It adds up to ${pctText(check.total)}%, more than 100%.` : null);
  // the kept row's song name changes with the title (the column Save writes); never with no own share to write back
  const renames = (f, kind) => (kind === "same" || kind === "change") && f?.ok && f.keepRow != null && f.keepSong != null && f.keepSong.trim() !== title.trim();
  const rename = renames(fresh, share.kind);
  const shareText = {
    none: `${client?.name || "The client"} isn't on the merged split, so nothing is written to the pub sheet.`,
    norow: `Neither card has a row on the ${tab} tab, so nothing is written to the pub sheet.`,
    tabless: `${client?.name}'s sheet tab isn't set, so nothing is written to the pub sheet.`,
    same: `${client?.name}'s writer share on the ${tab} tab stays ${pctOf(will)} (no change).${rename ? "" : " Nothing is written to the pub sheet."}`,
    change: `${client?.name}'s writer share on the ${tab} tab changes from ${now == null ? "blank" : pctOf(now)} to ${pctOf(will)}, and the song's earnings on the sheet change with it.`,
  }[share.kind];
  const fromOther = (k) => !keep[k] && !!drop[k];
  // the merged card takes another title (the other card's, "TRUST WHO #jerseyclub"): the card is told by its outcome, one
  // card with that title, since "X is removed" would read as the real song going (owner, Nov 2)
  const retitled = title.trim() !== (keep.song || "").trim();
  const and = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] || "");
  const keeps = [row != null && `row ${row} on the ${tab} tab`, keep.luminateId && "the Luminate id"].filter(Boolean);
  const splitFromOther = !check.edited && base.splits !== keep.splits;
  const takes = [fromOther("releaseDate") && "release date", fromOther("link") && "link", fromOther("cover") && "cover",
    fromOther("luminateId") && "Luminate id", splitFromOther && "split"].filter(Boolean);
  const outcome = `One card is left, titled "${title || "Untitled"}"${keeps.length ? `: it keeps ${and(keeps)}` : ""}${takes.length ? `${keeps.length ? "," : ""} and takes the ${and(takes)} from the other card` : ""}.${check.edited ? " Its split is the one typed below." : ""} The other card comes off the site.`;
  const keptHead = [row != null && "sheet row", keep.luminateId && "Luminate id"].filter(Boolean);
  // the second card's title is the one kept: not struck through
  const dropTitleKept = !!(drop.song || "").trim() && title.trim() === (drop.song || "").trim();
  // the merged card's title: two choices, the kept card's first
  const titleChoice = pick.other ? (
    <span className="dupe-title-pick" role="radiogroup" aria-label="Title after merging">
      {[[pick.title, "The kept card's title"],
        [pick.other, pick.other === (keep.song || "").trim() ? "The kept card's title" : "The other card's title"]].map(([t, why]) => (
        <label key={t} className={title === t ? "on" : ""}><input type="radio" name="dupe-title" checked={title === t} onChange={() => setTitle(t)} /><span><b>{t}</b><small>{why}</small></span></label>
      ))}
    </span>) : title || "Untitled";
  const splitBoxes = (
    <div className="todoedit-merge-split" data-merge-split>
      <SplitBoxes splits={base.splits} typed={typed} onType={(id, v) => setTyped((t) => ({ ...t, [id]: v }))} check={splitWhy && !check.reason ? { ...check, reason: splitWhy } : check} song={title}
        under="Under 100%, so the song goes to Splits to confirm after the merge." />
    </div>
  );
  const fields = (p, side) => [
    ["Title", side === "merged" ? titleChoice : p.song || "Untitled"],
    ["Streams", fmt(p.streams || 0)],
    ["Pub sheet", side === "drop" ? (!fresh ? "Checking…" : !fresh.ok ? "Couldn't be checked" : fresh.dropRow != null ? `Row ${fresh.dropRow} on the ${tab} tab` : "No row")
      : row != null ? `Row ${row} on the ${tab} tab` : "No row"],
    ["Luminate id", p.luminateId || "None", side === "merged" && fromOther("luminateId")],
    ["Release date", p.releaseDate ? releaseDay(p.releaseDate) : "None", side === "merged" && fromOther("releaseDate")],
    ["Link", p.link ? <ExtLink className="inline-link" href={p.link}>Open track ↗</ExtLink> : "None", side === "merged" && fromOther("link")],
    ["Cover", p.cover ? <span className="dupe-cover"><Photo src={p.cover} alt="" /></span> : "None", side === "merged" && fromOther("cover")],
    // the merged card's split is typed right here (r11 todoedit): its boxes, the merge's own numbers to start
    ["Split", side === "merged" && base.splits.length ? splitBoxes : splitLine(p.splits), side === "merged" && splitFromOther],
  ];
  const col = (p, side, head) => (
    <div className={`dupe-col ${side}${side === "drop" && dropTitleKept ? " title-kept" : ""}`} data-dupe-col={side}>
      <div className="dupe-col-head">{head}</div>
      {/* the cover is an image on its own line: its note goes under it without the leading dot */}
      <dl>{fields(p, side).map(([k, v, filled]) => <div key={k} className="dupe-f" data-f={k}><dt>{k}</dt><dd>{v}{filled && <em className="dupe-from">{k === "Cover" ? "From the other card" : " · from the other card"}</em>}</dd></div>)}</dl>
    </div>
  );
  const merge = async () => {
    // the tab once more, right before anything changes: a card that has a row now is never removed
    setBlocked(null);
    const f = await readTab();
    setFresh(f);
    if (!f.ok) return setBlocked(`The ${tab} tab of the pub sheet couldn't be read just now, so nothing was changed. Try again.`);
    if (f.dropRow != null) return setBlocked(`"${drop.song || "Untitled"}" now has its own row on the ${tab} tab (row ${f.dropRow}). Removing the card would leave that row counting on the sheet, so nothing was changed. Remove the row from the sheet first, or choose Not the same song.`);
    const share = planFor(f);
    const renameNow = renames(f, share.kind);
    // the pre-check (r11 todofix: the push and the stamp guard their writes themselves): before anything changes, the
    // kept row is read with FORMULA (a formula in A, B, D or N, the Total row, and nothing changes), and the share and
    // the typed split are held to the push route's own rules
    let g = null;
    if (share.kind === "change" || renameNow) {
      g = await guardPost({ action: "guard", placementId: keep.id, row: f.keepRow, song: title, percent: share.kind === "change" ? share.will : f.share, splits: merged.splits, exact: false });
      if (!g.ok) return setBlocked(`Nothing was changed: ${g.error}`);
    }
    const alarms = [];
    // the kept row was found by its title only (typed in by hand, no Site Sync ID, no Luminate id in M): stamp its
    // Site Sync ID before anything else, so the push below writes that row, never a second one under the new title.
    // The stamp is read back by its route (alarm); one that didn't come back is read again here
    if ((share.kind === "change" || renameNow) && !f.keepById) {
      const who = (client?.sheetTabName || client?.name || "").trim();
      const r = await fetch("/api/sheets-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
        body: JSON.stringify({ claims: [{ tab: who, row: f.keepRow, syncId: `${keep.id}:${who.toLowerCase()}` }] }),
      }).catch(() => null);
      const j = r ? await r.json().catch(() => ({})) : {};
      if (j.alarm) alarms.push(j.alarm);
      if (!r?.ok) {
        const again = await readAgain({ written: j.written, checked: !!j.checked }, keep.id, g);
        return setBlocked([j.refused ? `Nothing was changed: ${j.error}` : `Row ${f.keepRow} on the ${tab} tab couldn't be marked as this song's row just now, so nothing was changed. Try again.`, ...alarms, again].filter(Boolean).join(" "));
      }
    }
    const done = await commit({ ...db, placements: db.placements.filter((p) => p.id !== drop.id).map((p) => (p.id === keep.id ? merged : p)) });
    // the save's own error banner says why; nothing else went to the sheet (the stamp, if made, was read back)
    if (!done) { if (alarms.length) setBlocked(alarms.join(" ")); return; }
    const saved = done.placements.find((p) => p.id === keep.id);
    const c = done.clients?.find((x) => x.id === keep.clientId) || client;
    let r = null;
    if (share.kind === "change" && saved && ownSplit(saved, c)) r = await pushShare(saved, c, done.placements.map((p) => p.id), { check: "merge" });
    // only the song name changes: the share goes back exactly as the sheet has it
    else if (renameNow && saved && ownSplit(saved, c)) r = await pushShare(saved, c, done.placements.map((p) => p.id), { keep: f.share, check: "merge" });
    const err = r?.error || null;
    // the push reads its own write back (alarm); one that didn't come back is read again here
    if (r?.alarm) alarms.push(r.alarm);
    if (err) { const again = await readAgain(r, keep.id, g); if (again) alarms.push(again); }
    const alarm = alarms.join(" ") || null;
    reloadSongInfo?.();
    const n = done.placements.filter((p) => p.clientId === keep.clientId).length;
    const res = err
      ? { warn: true, text: `Merged into "${title}", but the pub sheet wasn't updated (${err}). Open the song and Save again.` }
      : { text: `${title === keep.song ? `Merged "${drop.song || "Untitled"}" into "${keep.song || "Untitled"}".` : `Merged "${keep.song || "Untitled"}" and "${drop.song || "Untitled"}" into one card, "${title || "Untitled"}".`} ${client?.name || "The client"} has ${n} song${n === 1 ? "" : "s"}.${share.kind === "change" ? ` The writer share on the ${tab} tab is now ${pctOf(share.will)}.` : ""}${renameNow ? ` Row ${f.keepRow} on the ${tab} tab is now "${title}".` : ""}` };
    onDone(alarm ? { warn: true, text: `${res.text} ${alarm}` } : res);
  };
  const notSame = async () => {
    try { await songsPost({ action: "notDuplicate", ids: [keep.id, drop.id] }); } catch (e) { onDone({ warn: true, text: `Couldn't save that: ${e.message}` }); return; }
    reloadSongInfo?.();
    onDone({ text: `Kept both "${keep.song}" and "${drop.song}". They won't be asked about again.` });
  };
  return (
    <AskCard title="Merge these two cards?" goLabel="Merge cards" busyLabel="Working…" plain wide go={merge} onClose={onClose} alt={{ label: "Not the same song", run: notSame }} goDisabled={!!splitWhy}
      goWhy={splitWhy && `Split after merging: ${splitWhy}`}>
      <p data-dupe-why>{client?.name ? `${client.name}'s page has` : "These are"} two cards with {pair.why}.{retitled ? "" : " After merging, one card is left."}</p>
      {/* what happens, above the columns so it's in view at 1280x800 before Merge cards */}
      <p data-merge-drop>{retitled ? outcome : `"${drop.song || "Untitled"}" is removed from the site.`} {!fresh ? `Checking the ${tab} tab for its row…`
        : !fresh.ok ? `The ${tab} tab couldn't be checked just now; Merge checks it again first.`
        : fresh.dropRow != null ? `It has its own row on the ${tab} tab (row ${fresh.dropRow}), so it can't be merged here.`
        : `It has no row on the ${tab} tab (checked just now), so nothing is written there for it.`}</p>
      <p data-merge-share>{shareText}{rename && <> <span data-merge-rename>Row {fresh.keepRow} on the {tab} tab is renamed to "{title}".</span></>}</p>
      {/* the merge is a staff save: the Publishing ClickUp task follows it at once (lib/area-tasks.js afterAction) */}
      <p className="hint" data-merge-clickup>The Publishing task in ClickUp updates itself right after the merge.</p>
      {blocked && <p className="warn-text" role="alert" data-merge-blocked>{blocked}</p>}
      <div className="dupe-cols">
        {col(keep, "keep", retitled && keptHead.length ? `Kept: ${keptHead.join(" and ")}` : "Keeps this card")}
        {col(drop, "drop", retitled ? "Folded in, then removed" : "Removed from the site")}
        {col(merged, "merged", "After merging")}
      </div>
    </AskCard>
  );
}

// (Splits to confirm, Songs to update and the merge card are To do's now, r7: PubFix there shows them)
function CatalogOverview({ db, commit, songInfo, reloadSongInfo, onSelectClient }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [streamSync, setStreamSync] = useState({ syncing: false, error: null }); // "Refresh numbers": the sheet pulled again
  const dbNow = useRef(db); // the sheet pull below starts from the db as it is then, not at the click
  dbNow.current = db;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/sheets-master");
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(data.error || "Failed to load.");
        setState({ loading: false, error: null, data });
      } catch (err) {
        if (!alive) return;
        setState({ loading: false, error: err.message || "Failed to load master sheet data.", data: null });
      }
    })();
    return () => { alive = false; };
  }, []);

  // pulls every client's numbers from the pub sheet again (fullSiteSync) and re-reads MASTER, with the
  // "as of" line below reflecting that moment. Nothing is written to the sheet (list B #3: STREAM DATA
  // isn't rebuilt any more)
  const runStreamSync = async () => {
    setStreamSync({ syncing: true, error: null });
    try {
      const { missing } = await fullSiteSync(dbNow.current, commit);
      reloadSongInfo?.(); // the pull re-checked the sheet tabs: the task counts and badge follow
      const res2 = await fetch("/api/sheets-master");
      const data2 = await res2.json();
      if (res2.ok) setState({ loading: false, error: null, data: data2 });
      setStreamSync({
        syncing: false,
        error: missing.length ? `No sheet tab found for: ${missing.join(", ")}. If they do have a tab under a different name, set "Sheet tab name" on each one in Website › Roster.` : null,
      });
    } catch (err) {
      setStreamSync({ syncing: false, error: err.message || "Stream sync failed." });
    }
  };

  // MASTER's "Writer" column is just hand-typed display text — it can go
  // stale (a client renamed their tab but not this cell) or even be
  // outright wrong (a row labeled "WRITER 13" was found to actually pull
  // from the "prodgavin" tab via its formulas). readMasterRollup already
  // extracts the real tab each row's formulas reference as row.sheetTab —
  // match against THAT, not the label, the way findTab does server-side:
  // exact first, then personKey, a "Sheet tab name" override before a name.
  const findClient = (row) => {
    const byTab = [...db.clients.filter((c) => c.sheetTabName), ...db.clients.filter((c) => !c.sheetTabName)];
    return findByName(byTab, row.sheetTab || row.writer, (c) => c.sheetTabName || c.name);
  };

  const links = state.data?.links || {};
  const rate = state.data?.rate;
  // the writers' table: This week first (each writer's songs that have both weeks, added up, as
  // lib/weekly.js sumWeeks), biggest % first; any column head re-sorts. Writer, Songs, This week, Streams and
  // Our fee show; Net streams, Their earnings and the share of the roster's fee wait behind "More columns"
  // (r7: the 3-year forecast lives on the Advance calculator)
  const { growth } = useGrowthState();
  // r11 fix: until there's a week of daily Spotify numbers, This week is Luminate's newest week, the same one the
  // Dashboard's This week › Artists shows (GET /api/growth?top=1, shared through dashCache), named on the column
  const [lumTop, setLumTop] = useState(() => dashCache.top || null);
  useEffect(() => {
    if (lumTop) return undefined;
    let alive = true;
    fetch("/api/growth?top=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d?.top) { dashCache.top = d.top; setLumTop(d.top); } }).catch(() => {});
    return () => { alive = false; };
  }, [lumTop]);
  // auto: the opening order (This week); with no weekly numbers at all it falls back to Streams (list A 1)
  const [sort, setSort] = useState({ col: "week", dir: -1, auto: true });
  const [more, setMore] = useState(false);
  const weekOf = (client) => {
    let ws = client && growth ? db.placements.filter((p) => p.clientId === client.id).map((p) => growth[p.id]).filter((w) => w && w.thisWeek != null && w.lastWeek != null) : [];
    // one real week, as on the Dashboard (lib/weekly.js sameWeek): the songs whose week ends last
    const end = ws.map((w) => w.weekOf?.to).filter(Boolean).sort().pop();
    if (end) ws = ws.filter((w) => !w.weekOf || w.weekOf.to === end);
    if (!ws.length) return null;
    return sumWeek(ws);
  };
  const sumWeek = (ws) => {
    const t = ws.reduce((a, w) => a + w.thisWeek, 0), l = ws.reduce((a, w) => a + w.lastWeek, 0);
    // under 1,000 streams this week a % says little (1 → 2 is "▲ 100%"): streams only, as on the Dashboard
    return { thisWeek: t, wowPct: l > 0 && t >= WEEK_PCT_MIN ? (t / l - 1) * 100 : null, weekOf: ws.find((w) => w.weekOf)?.weekOf || null };
  };
  const MORE_COLS = ["net", "earn", "share"];
  // (2026-11-10) the money columns are the Founders' (Money access); a Co-manager sees streams only
  const seeMoney = canUse(db, "money");
  const cols = [["writer", "Writer"], ["songs", "Songs"], ["week", "This week"], ["gross", "Streams"], ...(more ? [["net", "Net streams"]] : []),
    ...(seeMoney ? [...(more ? [["earn", "Pub earnings"]] : []), ["fee", "Potential admin fee"], ...(more ? [["share", "% of roster fee"]] : [])] : [])];
  const val = { songs: (x) => x.songs, gross: (x) => x.r.grossStreams, net: (x) => x.r.netStreams, earn: (x) => x.r.grossRevenue, fee: (x) => x.r.adminFee, share: (x) => Number(x.r.pctOfRoster) };
  const cell = { writer: null, songs: (r) => r.songs, gross: (r) => fmt(r.grossStreams), net: (r) => fmt(r.netStreams), earn: (r) => money(r.grossRevenue), fee: (r) => money(r.adminFee), share: (r) => `${r.pctOfRoster}%` };
  // Songs = the songs on the site for that writer (the client list's count beside it); the sheet's own
  // count, when it differs, is said under it (a song the site has that isn't on the writer's tab yet)
  const siteSongs = (client, r) => (client ? db.placements.filter((p) => p.clientId === client.id).length : r.songs);
  const spotRows = (state.data?.rows || []).map((r) => { const client = findClient(r); return { r, client, wk: weekOf(client), songs: siteSongs(client, r) }; });
  const lumWeek = !spotRows.some((x) => x.wk) && lumTop?.source === "luminate" ? lumTop : null;
  // every writer's Luminate week, falls included (allArtists; 2026-11-13: the top 5 risers only, so prodbylandn,
  // Sauceproducedit and 6 more showed "—"); under 1,000 streams, streams alone, as for the Spotify weeks above
  const lumOf = (client) => {
    const a = client && lumWeek?.allArtists?.find((x) => x.clientId === client.id);
    return a ? { thisWeek: a.thisWeek, wowPct: a.wowPct != null && a.thisWeek >= WEEK_PCT_MIN ? a.wowPct : null, weekOf: a.weekOf || null, lum: true } : null;
  };
  const rows = lumWeek ? spotRows.map((x) => ({ ...x, wk: lumOf(x.client) })) : spotRows;
  const lumLabel = lumWeek ? String(lumWeek.allArtistsLabel || "").replace(/^Luminate · /, "") : "";
  const name = (x) => (x.client ? x.client.name : x.r.writer).toLowerCase();
  const noWeeks = !rows.some((x) => x.wk);
  const by = sort.auto && sort.col === "week" && noWeeks ? { col: "gross", dir: -1 } : sort; // the column the rows follow
  // the days This week covers, said once in the source line (the Dashboard says the same)
  const weeks = rows.map((x) => x.wk?.weekOf).filter(Boolean);
  const span = weeks.length ? { from: weeks.map((w) => w.from).sort()[0], to: weeks.map((w) => w.to).sort().pop() } : null;
  rows.sort((a, b) => {
    if (by.col === "writer") return by.dir * name(a).localeCompare(name(b));
    if (by.col === "week") {
      // no % goes last either way, by this week's streams, then (no week at all) by all-time streams
      const pa = a.wk?.wowPct ?? null, pb = b.wk?.wowPct ?? null;
      if (pa == null || pb == null) return pa == null && pb == null ? (b.wk?.thisWeek ?? -1) - (a.wk?.thisWeek ?? -1) || (b.r.grossStreams || 0) - (a.r.grossStreams || 0) : pa == null ? 1 : -1;
      return by.dir * (pa - pb) || name(a).localeCompare(name(b));
    }
    return by.dir * ((Number(val[by.col](a)) || 0) - (Number(val[by.col](b)) || 0)) || name(a).localeCompare(name(b));
  });
  const songsTotal = rows.reduce((a, x) => a + (Number(x.songs) || 0), 0);
  return (
    <div>
      <div className="admin-head">
        <h2>Overview</h2>
        {/* (2026-11-10, the owner) Refresh numbers and the pub sheet's Drive folder are the Founders' */}
        {seeMoney && <div className="overview-links">
          <button className="btn ghost sm" onClick={runStreamSync} disabled={streamSync.syncing} title="Pull every client's numbers from the pub sheet again">
            <RefreshCw size={14} className={streamSync.syncing ? "spin" : ""} /> {streamSync.syncing ? "Refreshing numbers…" : "Refresh numbers"}
          </button>
          {links.folder && <ExtLink href={links.folder} className="btn ghost sm" title="Open the pub sheet's Drive folder"><Folder size={14} /> Folder</ExtLink>}
        </div>}
      </div>
      <p className="hint overview-subhint">{streamsAsOf({ pulledAt: db.sheetSync?.lastSyncedAt })}</p>
      {streamSync.error && <p className="hint err-text overview-subhint">{streamSync.error}</p>}
      {state.loading && <p className="muted">Loading master sheet data…</p>}
      {state.error && <p className="hint err-text">{state.error}</p>}

      {state.data && (
        <>
          <div className="cat-summary">
            {/* three numbers (r7): the roster's streams, what they earned, and our fee so far (MASTER's own totals,
                in the words of each client's page and the Advance calculator); the 3-year forecast is on the calculator */}
            <div className="cat-summary-grid pub-tiles">
              {/* MASTER adds each writer's gross up: a song two roster writers share is in it twice */}
              <div className="cat-stat" data-stat="streams" title="Added up by writer: a song two writers share counts once for each"><span className="cat-stat-label">Gross streams</span><span className="cat-stat-val">{fmt(state.data.totals.rosterGrossStreams)}</span></div>
              {seeMoney && <div className="cat-stat" data-stat="earnings"><span className="cat-stat-label">Pub earnings</span><span className="cat-stat-val">{money(state.data.totals.grossRevenuePool)}</span></div>}
              {seeMoney && <div className="cat-stat" data-stat="fee"><span className="cat-stat-label">Potential admin fee</span><span className="cat-stat-val">{money(state.data.totals.catalogToDate)}</span></div>}
            </div>
            {/* the one place the money's explained: everything below (and each client's page) is the same estimate */}
            {seeMoney && <p className="hint cat-asof money-hint" title="The rate is ASSUMPTIONS!B7 on the pub sheet">
              Estimates: streams × the writer's share × {rate ? `$${+rate.toFixed(6)} a stream` : "the sheet's rate"}.
            </p>}
          </div>

          <div className="master-tools">
            <button className="btn ghost sm" data-more-cols aria-pressed={more} onClick={() => { setMore((f) => !f); if (more && MORE_COLS.includes(sort.col)) setSort({ col: "week", dir: -1, auto: true }); }}>{more ? "Fewer columns" : "More columns"}</button>
          </div>
          {/* phones: the table is a stack of cards (components/ui), so its sort is a picker */}
          <PhoneSort cols={cols.map(([id, label]) => ({ id, label }))} sort={by} onSort={(id) => setSort(() => ({ col: id, dir: by.col === id ? -by.dir : id === "writer" ? 1 : -1 }))} />
          <div className="master-table-wrap m-cards-wrap">
            <table className="master-table m-cards">
              <thead>
                <tr>
                  {cols.map(([id, label]) => (
                    <th key={id} data-col={id} aria-sort={by.col === id ? (by.dir < 0 ? "descending" : "ascending") : undefined}>
                      <button className={by.col === id ? "ar-sort on" : "ar-sort"} onClick={() => setSort(() => ({ col: id, dir: by.col === id ? -by.dir : id === "writer" ? 1 : -1 }))}>{label}{by.col === id ? (by.dir < 0 ? "\u00a0▼" : "\u00a0▲") : ""}</button>
                      {/* which week it is, right on the column */}
                      {id === "week" && (lumWeek ? lumLabel && <span className="master-week-of" data-week-of="luminate">Luminate · {lumLabel}</span> : span && <span className="master-week-of">{dayRange(span.from, span.to)} vs the week before</span>)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ r, client, wk, songs }) => (
                  <tr
                    key={r.writer}
                    className={client ? "master-row-link" : ""}
                    onClick={client ? () => onSelectClient(client.id) : undefined}
                    title={client ? `Open ${client.name}` : "Not linked to a client on the site"}
                  >
                    {cols.map(([id, label]) => (id === "writer" ? <td key={id}>{client ? client.name : r.writer}</td>
                      : id === "songs" ? <td key={id} data-label={label} className="master-songs">{songs}{client && songs !== r.songs && <em data-sheet-songs={r.songs} title={`The pub sheet's ${client.name} tab has ${r.songs} song${r.songs === 1 ? "" : "s"}; the site has ${songs}`}>{songs > r.songs ? `${songs - r.songs} not on the sheet` : `sheet has ${r.songs}`}</em>}</td>
                      : id === "week" ? <td key={id} data-label={label} className="master-week">{wk ? <><WowPill pct={wk.wowPct} /><em>{fmt(wk.thisWeek)}</em></> : <span className="muted-dash" title="No last week to compare">—</span>}</td>
                      : <td key={id} data-label={label}>{cell[id](r)}</td>))}
                  </tr>
                ))}
              </tbody>
              {state.data.rosterTotal && (
                <tfoot>
                  <tr className="master-total-row">
                    {cols.map(([id, label]) => <td key={id} data-label={label}>{id === "writer" ? "Roster total" : id === "week" ? null : id === "songs" ? songsTotal : cell[id](state.data.rosterTotal)}</td>)}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// Publishing: the clients, their songs and splits, the MASTER totals and the Advance calculator.
// A Dashboard task can open it on a client ("client:<id>") or on the calculator ("advance").
// (r11: the ISRCs tab is gone, the owner: "why is there an isrc tab on the pub tab do i need that ?". The finder is
// To do's "N songs have no ISRC" row now, /dashboard/todo/isrc; the old /dashboard/catalog/isrc opens it there.)
export function CatalogAdmin({ db, commit, songInfo, reloadSongInfo, sub, onGo, onSub, chip = null }) {
  const seeMoney = canUse(db, "money"), own = !!db.access?.ownOnly; // the Advance calculator is money: the Founders'
  const [sec, setSec] = useState(seeMoney && (sub === "advance" || sub?.startsWith("advance:")) ? "advance" : "overview");
  const editSong = sub?.startsWith("edit:") ? db.placements.find((p) => p.id === sub.slice(5)) : null;
  // null clientId = the read-only Overview landing page, not "no selection"
  const [clientId, setClientIdOnly] = useState(sub?.startsWith("client:") ? sub.slice(7) : editSong ? editSong.clientId : null);
  // the address bar follows the client picked (in place: Back leaves Publishing, not chip by chip)
  const setClientId = (id) => { setClientIdOnly(id); onSub?.(id ? `client:${id}` : null); setFix(null); };
  // "Fix" (the Splits to fix list, a Next →): that song's client page with its editor open; n re-opens the same song
  // One-shot: a chip, Back to the list or any other pick clears it, so an old Fix never reopens its song.
  // n only counts up (a ref), so the same song asked for again still opens.
  const [fix, setFix] = useState(editSong ? { id: editSong.id, n: 1 } : null);
  const fixN = useRef(fix ? 1 : 0);
  const openFix = (id, field = null) => {
    const p = db.placements.find((x) => x.id === id);
    if (!p) return;
    setSec("overview"); setClientIdOnly(p.clientId); onSub?.(`client:${p.clientId}`); setFix({ id, n: ++fixN.current, field });
  };
  const toFix = useMemo(() => splitsToConfirm(db, songInfo).all.reduce((a, x) => ({ ...a, [x.p.clientId]: (a[x.p.clientId] || 0) + 1 }), {}), [db, songInfo]);
  const client = db.clients.find((c) => c.id === clientId);
  const count = (cid) => db.placements.filter((p) => p.clientId === cid).length;
  const [addingClient, setAddingClient] = useState(false);
  const [newClientForm, setNewClientForm] = useState({ name: "", role: "Producer" });
  const [adding, setAdding] = useState(false);
  const [deleteWarn, setDeleteWarn] = useState(null);
  useEscape(() => setAddingClient(false), addingClient && !adding);
  const newNameTaken = nameTaken(db.clients, null, newClientForm.name);
  // the chip row scrolls sideways under 1200px: whichever way a client gets picked (a chip, a MASTER
  // row, a new client, a Dashboard task) its chip comes into view. Not on arriving at the tab on Overview
  const chips = useRef(null), picked = useRef(clientId !== null);
  useEffect(() => {
    if (picked.current) {
      // picked from deep in the taller Overview: back to the top, so Publishing's title, pills and the
      // client's header are all in view (not the client's page started under a cut-off header)
      const m = document.querySelector(".catalog-main");
      if (m && m.getBoundingClientRect().top < 0) window.scrollTo({ top: 0, behavior: "instant" });
      revealChip(chips.current?.querySelector(".cc.active"));
    }
    picked.current = true;
  }, [clientId]);

  const addClient = async () => {
    const name = newClientForm.name.trim();
    if (!name || adding || newNameTaken) return; // the form says why
    // list B #7: what the pasted link filled in (a lasting photo link only, and every profile confirmed)
    const lk = newClientForm.links || {};
    const client = {
      id: uid(), name, role: newClientForm.role, credit: "", bio: "", photo: newClientForm.photo || "",
      spotify: lk.spotify || "", apple: "", instagram: lk.instagram || "", tiktok: lk.tiktok || "", youtube: lk.youtube || "", soundcloud: "",
      sheetTabName: "", totalStreams: 0, onRoster: false,
    };
    setAdding(true);
    const ok = await commit({ ...db, clients: [...db.clients, client] }).finally(() => setAdding(false));
    if (!ok) return; // the form stays open with the name typed
    setClientId(client.id);
    setAddingClient(false);
    setNewClientForm({ name: "", role: "Producer" });
  };

  const [delAsk, setDelAsk] = useState(null); // the client whose Delete is being asked about
  const removeClient = async (c) => {
    setDelAsk(null);
    setDeleteWarn(null);
    if (clientId === c.id) setClientId(db.clients.find((x) => x.id !== c.id)?.id || null);
    const warn = await deleteClientCascade(db, commit, c.id);
    if (warn) setDeleteWarn(warn);
  };

  // (a stale copy of the numbers catches up in the background: StaffDashboard starts it)
  const pick = (id) => (e) => { setSec(id); revealChip(e.currentTarget); onSub?.(id === "advance" ? id : clientId ? `client:${clientId}` : null); };
  return (
    <div>
      <div className="admin-head">
        <h2>Clients</h2>{chip}
      </div>
      {seeMoney && <div className="subnav">
        <button className={sec === "overview" ? "subpill active" : "subpill"} onClick={pick("overview")}>Overview &amp; clients</button>
        <button className={sec === "advance" ? "subpill active" : "subpill"} onClick={pick("advance")}>Advance<span className="pill-long"> calculator</span></button>
      </div>}
      {sec === "advance" && seeMoney && <AdvanceTab db={db} pick={sub?.startsWith("advance:") ? sub.slice(8) : null} />}
      {sec === "overview" && <div className="catalog-wrap">
        <div className="catalog-clients" ref={chips}>
          <button className={clientId === null ? "cc active" : "cc"} onClick={() => setClientId(null)}>
            <span className="cc-overview-ic"><LayoutGrid size={16} /></span>
            <span className="cc-name">Overview</span>
          </button>
          {!own && <button className="cc cc-add" onClick={() => { setNewClientForm({ name: "", role: "Producer" }); setAddingClient(true); }}><Plus size={14} /> Add client</button>}
          {deleteWarn && <p className="hint err-text">{deleteWarn}</p>}
          {db.clients.map((c) => (
            <div key={c.id} className="cc-row">
              <button className={c.id === clientId ? "cc active" : "cc"} onClick={() => setClientId(c.id)}>
                <Avatar src={c.photo} name={c.name} size={30} />
                {/* under the name, so the name keeps its width at 1280 */}
                <span className="cc-text"><span className="cc-name">{c.name}</span>
                  {toFix[c.id] > 0 && <span className="cc-fix" title="Songs in Splits to confirm: an even split to confirm, or one that needs review">{toFix[c.id]} to confirm</span>}</span>
                <span className="cc-count">{count(c.id)}</span>
              </button>
            </div>
          ))}
        </div>
        <div className="catalog-main">
          {clientId === null
            ? <CatalogOverview db={db} commit={commit} songInfo={songInfo} reloadSongInfo={reloadSongInfo} onSelectClient={setClientId} />
            : (client ? <SongManager db={db} commit={commit} clientId={clientId} isStaff songInfo={songInfo} reloadSongInfo={reloadSongInfo} fix={fix} onFix={openFix} onFixList={(to) => { setFix(null); onGo("todo", to === "update" ? "update" : "splits"); }} onGo={onGo} onDeleteClient={setDelAsk} />
              // deleted in another tab (this one's next save brought the news): their songs went with them
              : <p className="hint err-text">That client was deleted somewhere else.</p>)}
        </div>
      </div>}

      {delAsk && (() => {
        const a = clientDeleteAsk(db, delAsk);
        return <AskCard title={a.title} goLabel={a.goLabel} busyLabel="Deleting…" typeName={a.typeName} go={() => removeClient(delAsk)} onClose={() => setDelAsk(null)}><p>{a.body}</p></AskCard>;
      })()}
      {addingClient && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setAddingClient(false)}>
          <div className="modal-card">
            <div className="modal-head"><h3>New client</h3><button onClick={() => setAddingClient(false)} aria-label="Close"><X size={18} /></button></div>
            <div className="modal-body">
              {/* list B #7: paste their Spotify, Instagram, TikTok or YouTube and the name, photo and links fill in */}
              {newClientForm.found ? (
                <div className="lb-picked" data-new-client-found>
                  <Avatar src={newClientForm.photo} name={newClientForm.name || "?"} size={40} />
                  <span className="lb-picked-t"><b>{newClientForm.found}</b><em>{["spotify", "instagram", "tiktok", "youtube"].filter((k) => newClientForm.links?.[k]).map((k) => ({ spotify: "Spotify", instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" })[k]).join(" · ")}</em></span>
                  <button type="button" className="inline-link" onClick={() => setNewClientForm({ name: newClientForm.name, role: newClientForm.role })}>Change</button>
                </div>
              ) : (
                <div className="fld"><span>Their link (optional)</span>
                  <LinkBox context="roster" addLabel="Use this" onAdd={(r) => setNewClientForm((f) => ({ ...f, name: f.name.trim() ? f.name : (r.card.name || "").replace(/^@/, ""), photo: r.card.photo || "", links: r.links, found: r.card.name || r.link.label }))} />
                </div>
              )}
              <Field label="Name" value={newClientForm.name} onChange={(ev) => setNewClientForm({ ...newClientForm, name: ev.target.value })} onKeyDown={(ev) => ev.key === "Enter" && addClient()} />
              {newNameTaken && <p className="hint err-text">{NAME_TAKEN}</p>}
              <label className="fld"><span>Role</span>
                <select value={newClientForm.role} onChange={(ev) => setNewClientForm({ ...newClientForm, role: ev.target.value })}>
                  <option>Producer</option><option>Artist</option><option>Producer / Artist</option>
                </select>
              </label>
              <p className="hint">Starts hidden from the public roster (Site › Website › Roster). Their sheet tab is made with their first song.</p>
            </div>
            <div className="modal-foot">
              <button className="btn ghost sm" onClick={() => setAddingClient(false)}>Cancel</button>
              <button className="btn sm" onClick={addClient} disabled={!newClientForm.name.trim() || adding || newNameTaken}>{adding ? "Adding…" : "Add client"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
