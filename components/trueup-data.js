import { useEffect, useSyncExternalStore } from "react";
import { fate, loadedRecently, markLoaded, readFresh, stamp } from "./shared/boot";

// The monthly true-up's data side (GET /api/trueup and its To do rows), read by the dashboard's shell on
// every section; the screens are in TrueUp.jsx, loaded with To do (list B #11).

export const fmt = (n) => Number(n || 0).toLocaleString();
export const shortDay = (iso) => (iso ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
export const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;

// ---- one shared copy of GET /api/trueup (the sidebar count, the To do rows and the panel all read it)
// recent: the update applied in this visit, so its row (and its Undo) stays until the page is left
export const store = { d: null, err: null, subs: new Set(), loading: null, recent: null };
export const emit = () => store.subs.forEach((f) => f());
// (2026-11-25) a read already on its way is shared only if nothing happened since it started: after an Apply or Undo (a write) a new read
// starts, and an answer from before a write or a sign-in never lands in the store
export function reloadTrueUp() {
  if (store.loading && fate(store.loadingStamp) === "apply") return store.loading;
  const t0 = stamp();
  const p = readFresh("/api/trueup", undefined, () => reloadTrueUp()).then(({ dropped, ok, j, t }) => {
    if (dropped) return;
    if (!ok || !j) throw new Error("load");
    if (fate(t) !== "apply" && store.loading !== p) return; // a newer read is on its way: it answers
    store.d = { ...j, recent: store.recent }; store.err = null; markLoaded("trueup", t);
  }).catch(() => { if (fate(t0) !== "drop") store.err = true; }).finally(() => { if (store.loading === p) store.loading = null; emit(); });
  store.loading = p; store.loadingStamp = t0;
  return p;
}
const sub = (f) => { store.subs.add(f); return () => store.subs.delete(f); };
const snap = () => store.d;
export function useTrueUp(tab, on = true) {
  const data = useSyncExternalStore(sub, snap, () => null);
  // (2026-11-24, speed) not again within 30 s of the last read (a save in between reads again)
  useEffect(() => { if (on && !loadedRecently("trueup") && (tab === "home" || tab === "todo" || !store.d)) reloadTrueUp(); }, [tab, on]);
  return { data: on ? data : null, reload: reloadTrueUp };
}

// ---- To do's rows (pure, from GET /api/trueup)
export function trueUpTodoItems(d) {
  if (!d) return [];
  const out = [];
  const last = d.runs?.[0];
  const saved = d.recent && last?.id === d.recent.id && !d.due;
  if (d.due || saved) out.push({ k: "trueup", area: "roster", t: saved ? "Monthly Luminate update: saved" : "Monthly Luminate update: drop this month's report",
    d: saved ? `Luminate's ${shortDay(last.export_on)} numbers, ${plural(last.counts?.songs || 0, "song")}` : last ? `Last one: the ${shortDay(last.export_on)} file` : `All ${fmt(d.total)} roster songs go in the report first`,
    cta: "Open", panel: "trueup", rank: { kind: "other" } });
  const n = d.notInReport?.length || 0;
  // (2026-11-12, the owner: "a list of the songs that arent on the report so i can add them before i export") every
  // update counted, so what's left is what the report doesn't have yet; the next export ticks them off
  if (n) out.push({ k: "trueup-new", area: "roster", t: `${fmt(n)} song${n === 1 ? "" : "s"} to add to the Luminate report`,
    d: `${d.total ? `${fmt(n)} of the ${fmt(d.total)} roster songs · ` : ""}not in ${d.baseline?.kind === "trueup" ? `any Luminate file yet (${plural(d.baseline.runs || 1, "update")} so far)` : `the ${shortDay(d.baseline?.on) || "last"} portfolio exports`} · add them before you export`, cta: "Open", panel: "trueup-new", rank: { kind: "other" } });
  // what the last update's setup on the pub sheet left (Google's read limit, its time): this carries on
  const su = d.setupLeft?.n || 0;
  if (su) out.push({ k: "trueup-setup", area: "roster", t: `${fmt(su)} song${su === 1 ? "" : "s"} to set up on the pub sheet`,
    d: `The last update's setup stopped partway: ${su === 1 ? "its" : "their"} Luminate ID and STREAM DATA row aren't on the sheet yet`, cta: "Open", panel: "trueup-setup", rank: { kind: "other" } });
  if (d.schedule?.remind) out.push({ k: "trueup-schedule", area: "roster", t: `Luminate's schedule ends on ${shortDay(d.schedule.ends)}: copy the report to keep it running`,
    cta: "Open", panel: "trueup-schedule", rank: { kind: "other" } });
  return out;
}
