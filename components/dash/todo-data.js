import { useState, useEffect, useRef } from "react";
import { autoConfirms, autoWords } from "../../lib/split-fixes";
import { fullSiteSync, shareFixesOf, splitsToConfirm } from "./catalog-data";
import { dashTasks, dupeIds, songsToUpdate } from "./helpers";
import { money } from "./ui";
import { songsWithoutIsrc } from "./isrc-data";
import { cuCache, syncCache } from "../shared/dash-caches";

// To do's data: the hooks and the row list the shell reads on every section (the sidebar's one count,
// each tab's chip, Home's biggest tasks). Kept apart from To do's screens (todo.jsx) by list B #11, so
// a section loads only its own code.

/* staff: To do (r7) — every to-do from every area, finished where it's listed ------------------ */
export function useCuTasks(tab) {
  const [data, setData] = useState(() => cuCache.d);
  const [failed, setFailed] = useState(false);
  const load = (fresh = false) => {
    setFailed(false);
    return fetch(`/api/tasks${fresh ? "?fresh=1" : ""}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.lists) { cuCache.d = d; setData(d); } else setFailed(true); }).catch(() => setFailed(true));
  };
  useEffect(() => { if (tab === "home" || tab === "todo" || !cuCache.d) load(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const drop = (id) => setData((d) => (d ? { ...d, tasks: d.tasks.filter((t) => t.id !== id) } : d));
  const add = (t) => setData((d) => (d ? { ...d, tasks: [...d.tasks, t] } : d));
  return { data, failed, load, drop, add };
}
export function useSyncChecks(tab) {
  const [data, setData] = useState(() => syncCache.d);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = (force = false) => {
    if (!force && syncCache.d && Date.now() - syncCache.at < 120000) { setData(syncCache.d); return Promise.resolve(); }
    setFailed(false); setBusy(true);
    return fetch("/api/sync", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.checks) { syncCache.d = d; syncCache.at = Date.now(); setData(d); } else setFailed(true); }).catch(() => setFailed(true)).finally(() => setBusy(false));
  };
  // (any tab's first load reads them too: the sidebar's count and each tab's chip include the amber ones)
  useEffect(() => { if (tab === "home" || tab === "todo" || tab === "site" || !syncCache.d) load(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, failed, busy, load };
}

// Every to-do the dashboard knows about, from every area, as To do's rows: one sentence (t), at most
// one short detail (d), one button (cta), the panel it opens in place (panel), and its weight for
// Home's biggest tasks (rank, lib/todo-rank.js). tap = the button finishes it (after the preview the
// panel shows); the rest need a person. The Publishing rows are dashTasks' (the same words);
// lib/area-tasks.js keeps ClickUp's area tasks to the same list. seeds: what the old Luminate
// portfolios' starting list still needs (list B #3), one row per area.
const SYNC_ROWS = { pubSheet: ["roster", "Pull from the sheet"], info: ["money", "Review"] };
export function todoItems({ db, songInfo, acct, ar, sync, seeds }) {
  const out = [];
  const nLog = acct?.toLog || 0, nCheck = acct?.toCheck || 0;
  // the test payments among them said once (they still count): "1 of them is a $2.00 test payment."
  const tN = acct?.toLogTests?.n || 0, tSum = acct?.toLogTests?.total || 0;
  const testD = !tN ? null : nLog === 1 ? `It's a ${money(tSum)} test payment.` : tN === 1 ? `1 of them is a ${money(tSum)} test payment.` : `${tN} of them are test payments (${money(tSum)}).`;
  if (nLog) out.push({ k: "log", area: "money", tap: true, t: `${nLog} payment${nLog === 1 ? "" : "s"} to log`, d: testD || (acct.toLogTotal ? `${money(acct.toLogTotal)} paid, not in the Income tab yet` : undefined),
    cta: nLog === 1 ? "Log it" : `Log all ${nLog}`, panel: "log", rank: { kind: "money", value: acct.toLogTotal || nLog } });
  if (nCheck) out.push({ k: "check", area: "money", t: `${nCheck} row${nCheck === 1 ? "" : "s"} in the Income tab to check`, cta: "Review", panel: "check", rank: { kind: "money", value: 0 } });
  const streams = (ps) => ps.reduce((a, p) => a + (p.streams || 0), 0);
  for (const it of dashTasks(db, songInfo)) {
    const base = { k: it.k, area: it.area, t: it.t, d: it.d, cta: it.cta };
    if (it.k === "dupes") out.push({ ...base, tap: true, cta: "Merge", panel: "dupes", rank: { kind: "fix", value: 0 } });
    else if (it.k === "splits") out.push({ ...base, panel: "splits", rank: { kind: "fix", value: streams(splitsToConfirm(db, songInfo).all.map((x) => x.p)) } });
    else if (it.k === "update") out.push({ ...base, panel: "update", rank: { kind: "fix", value: streams(songsToUpdate(db, songInfo).map((x) => x.p)) } });
    else if (it.k === "tabs") out.push({ ...base, d: "The pub sheet has no tab by that name. Type the right one here.", cta: it.sub === "roster" ? "Set the sheet tabs" : it.cta, panel: "tabs", rank: { kind: "other" } });
  }
  // r11: the songs with no ISRC, one row whose panel is the ISRC finder (it was Publishing's ISRCs tab).
  // Only once the song facts are in (an ISRC lives there), so the count never flashes the whole catalog.
  const noIsrc = songInfo?.tracking ? songsWithoutIsrc(db, songInfo).length : 0;
  if (noIsrc) out.push({ k: "isrc", area: "roster", t: `${noIsrc} song${noIsrc === 1 ? " has" : "s have"} no ISRC`, cta: "Find them", panel: "isrc", rank: { kind: "other" } });
  // (r7) the shares with one clear answer: One tap, each with its preview first (ShareFix)
  const fx = shareFixesOf(db);
  const few = (xs) => (xs.length > 3 ? `${xs.slice(0, 2).map((x) => x.p.song || "Untitled").join(", ")} and ${xs.length - 2} more` : xs.map((x) => `${x.p.song || "Untitled"} (${x.client.name})`).join(", "));
  if (fx.site.length) out.push({ k: "shareSite", area: "roster", tap: true, t: fx.site.length === 1 ? `"${fx.site[0].p.song || "Untitled"}" has no split here; the sheet has 100%` : `${fx.site.length} songs have no split here; the sheet has 100%`,
    d: fx.site.length > 1 ? few(fx.site) : `${fx.site[0].client.name}'s tab`, cta: "Use the sheet's split", panel: "shareSite", rank: { kind: "fix", value: streams(fx.site.map((x) => x.p)) } });
  if (fx.sheet.length) out.push({ k: "shareSheet", area: "roster", tap: true, t: fx.sheet.length === 1 ? `"${fx.sheet[0].p.song || "Untitled"}" has a blank share on the sheet` : `${fx.sheet.length} songs have a blank share on the sheet`,
    d: "100% here. A blank share earns nothing on the sheet.", cta: fx.sheet.length === 1 ? "Fill in 100%" : `Fill in ${fx.sheet.length}`, panel: "shareSheet", rank: { kind: "fix", value: streams(fx.sheet.map((x) => x.p)) } });
  // (r11: Outreach is gone, and with it the "N A&R follow-ups due" row)
  // the old Luminate portfolios' songs and artists not tracked yet (list B #3): one row per area, each
  // one finished in the list it opens (Yes to a match, a pasted Spotify link, Not on Spotify)
  // (r10: the A&R rows are on the Watchlist now; what's left is their artists' Spotify match, the row below)
  for (const [area, one, many] of [["roster", "Admin Catalog song", "Admin Catalog songs"]]) {
    const list = (seeds?.todo || []).filter((r) => r.area === area);
    if (!list.length) continue;
    const check = list.filter((r) => r.status === "check").length, find = list.length - check;
    out.push({ k: `seeds:${area}`, area, t: `${list.length} old Luminate ${list.length === 1 ? one : many} to find on Spotify`,
      d: [check && `${check} ${check === 1 ? "match" : "matches"} to check`, find && `${find} to find`].filter(Boolean).join(" · "), cta: check ? "Check" : "Find", panel: "seeds", seedArea: area, rank: { kind: "fix", value: 0 } });
  }
  // A&R (r10): the previous watchlist's artists whose same-name Spotify match a person still has to confirm
  const confirm = ar?.toConfirm || 0;
  if (confirm) out.push({ k: "arConfirm", area: "ar", t: `${confirm} Watchlist artist${confirm === 1 ? " needs its" : "s need their"} Spotify confirmed`, d: "Pick the right Spotify profile: nothing is tracked until a person taps.", cta: "Confirm", panel: "arConfirm", rank: { kind: "fix", value: 0 } });
  const unread = (db.submissions || []).filter((x) => !x.read).length;
  if (unread) out.push({ k: "messages", area: "site", t: `${unread} new website message${unread === 1 ? "" : "s"}`, cta: "Read", panel: "messages", rank: { kind: "other" } });
  // the sync checks that aren't a row already (Stripe = payments to log, ClickUp = its tasks)
  for (const c of sync?.checks || []) {
    if (c.ok !== false || !SYNC_ROWS[c.id]) continue;
    const [area, cta] = SYNC_ROWS[c.id];
    out.push({ k: `sync:${c.id}`, area, tap: c.fix?.kind === "pull", t: c.text.replace(/\.$/, ""), cta, panel: "syncfix", check: c, rank: { kind: "sync" } });
  }
  return out;
}

// rule 5: an assumed even split whose client share already is the sheet's is confirmed by itself (DB only, no
// sheet write) and said once in "Done for you" with Undo. Undo puts the old split back and it's never confirmed by
// itself again (it's back in Splits to confirm). fixes = useSplitFixes()
async function splitFixPost(body) {
  const r = await fetch("/api/split-fixes", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify(body) }).catch(() => null);
  return r?.ok ? r.json().catch(() => ({})) : null;
}
export function useSplitFixes() {
  const [data, setData] = useState(null);
  const load = () => fetch("/api/split-fixes", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => d?.auto && setData(d)).catch(() => {});
  useEffect(() => { load(); }, []);
  return { data, setData, load };
}
const AUTO_DAYS = 7;
const sameSplits = (a, b) => JSON.stringify((a || []).map((s) => [s.name || "", Number(s.percent) || 0])) === JSON.stringify((b || []).map((s) => [s.name || "", Number(s.percent) || 0]));
export function useAutoConfirm({ db, commit, songInfo, fixes }) {
  const tried = useRef("");
  useEffect(() => {
    if (!fixes.data || !songInfo || !db?.sheetFacts) return;
    const items = autoConfirms({ placements: db.placements, clients: db.clients, facts: db.sheetFacts, held: fixes.data.auto.held, skip: dupeIds(db, songInfo) });
    const key = items.map((x) => x.p.id).sort().join(",");
    if (!items.length || tried.current === key) return;
    tried.current = key;
    const by = new Map(items.map((x) => [x.p.id, x.after]));
    commit({ ...db, placements: db.placements.map((p) => (by.has(p.id) ? { ...p, splits: by.get(p.id) } : p)) }, undefined, { quiet: true })
      .then((saved) => saved && splitFixPost({ action: "auto", items: items.map((x) => ({ id: x.p.id, song: x.p.song, client: x.client.name, before: x.before, after: x.after })) }))
      .then(() => fixes.load()).catch(() => {});
  }, [db, songInfo, fixes.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const since = Date.now() - AUTO_DAYS * 864e5;
  const recent = (fixes.data?.auto?.done || []).filter((d) => Date.parse(d.at) > since);
  const undo = async () => {
    const ids = recent.map((d) => d.id);
    // held first, so the split put back isn't confirmed again on the next render
    fixes.setData((x) => x && { ...x, auto: { done: x.auto.done.filter((d) => !ids.includes(d.id)), held: [...new Set([...x.auto.held, ...ids])] } });
    await splitFixPost({ action: "undo", ids });
    const cur = new Map(db.placements.map((p) => [p.id, p]));
    const back = new Map(recent.filter((d) => cur.has(d.id) && sameSplits(cur.get(d.id).splits, d.after)).map((d) => [d.id, d.before]));
    if (back.size) await commit({ ...db, placements: db.placements.map((p) => (back.has(p.id) ? { ...p, splits: back.get(p.id) } : p)) });
    fixes.load();
  };
  return recent.length ? [{ k: "splitsAuto", text: autoWords(recent), undo }] : [];
}
export async function syncFix(check, ctx, setBusy, setNote) {
  const { db, commit, reloadSongInfo, sync, onGo } = ctx;
  if (check.fix?.kind === "todo") return onGo("todo", check.fix.area);
  setBusy(true); setNote(null);
  try {
    const { missing } = await fullSiteSync(db, commit);
    await reloadSongInfo?.();
    await sync.load(true);
    setNote({ warn: !!missing.length, text: missing.length ? `Done. No sheet tab found for ${missing.join(", ")}.` : "Done. The numbers are pulled from the sheet again." });
  } catch (err) { setNote({ warn: true, text: err.message || "That didn't go through. Try again in a minute." }); } finally { setBusy(false); }
}

// The old Luminate portfolios as the numbers' starting list (list B #3, GET /api/data?seeds=1): the songs and
// artists not tracked yet. Read whenever Home or To do opens; an answer takes its line off at once.
const seedCache = { d: null };
export function useSeeds(tab, on) {
  const [data, setData] = useState(() => seedCache.d);
  const load = () => (!on ? Promise.resolve() : fetch("/api/data?seeds=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (d?.todo) { seedCache.d = d; setData(d); } }).catch(() => {}));
  useEffect(() => { if (tab === "home" || tab === "todo" || !seedCache.d) load(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const drop = (lumId) => setData((d) => { const n = d ? { ...d, todo: d.todo.filter((r) => r.lumId !== lumId) } : d; seedCache.d = n; return n; });
  return { data, load, drop };
}
