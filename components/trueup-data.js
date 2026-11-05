import { useEffect, useSyncExternalStore } from "react";

// The monthly true-up's data side (GET /api/trueup and its To do rows), read by the dashboard's shell on
// every section; the screens are in TrueUp.jsx, loaded with To do (list B #11).

export const fmt = (n) => Number(n || 0).toLocaleString();
export const shortDay = (iso) => (iso ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
export const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;

// ---- one shared copy of GET /api/trueup (the sidebar count, the To do rows and the panel all read it)
// recent: the update applied in this visit, so its row (and its Undo) stays until the page is left
export const store = { d: null, err: null, subs: new Set(), loading: null, recent: null };
export const emit = () => store.subs.forEach((f) => f());
export function reloadTrueUp() {
  if (store.loading) return store.loading;
  store.loading = fetch("/api/trueup", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
    .then((d) => { store.d = { ...d, recent: store.recent }; store.err = null; }).catch(() => { store.err = true; }).finally(() => { store.loading = null; emit(); });
  return store.loading;
}
const sub = (f) => { store.subs.add(f); return () => store.subs.delete(f); };
const snap = () => store.d;
export function useTrueUp(tab, on = true) {
  const data = useSyncExternalStore(sub, snap, () => null);
  useEffect(() => { if (on && (tab === "home" || tab === "todo" || !store.d)) reloadTrueUp(); }, [tab, on]);
  return { data: on ? data : null, reload: reloadTrueUp };
}

// ---- To do's rows (pure, from GET /api/trueup)
export function trueUpTodoItems(d) {
  if (!d) return [];
  const out = [];
  const last = d.runs?.[0];
  const saved = d.recent && last?.id === d.recent.id && !d.due;
  if (d.due || saved) out.push({ k: "trueup", area: "roster", t: saved ? "Monthly Luminate update: saved" : "Monthly Luminate update: drop this month's report",
    d: saved ? `Luminate's ${shortDay(last.export_on)} numbers, ${plural(last.counts?.songs || 0, "song")}` : last ? `Last one: the ${shortDay(last.export_on)} file` : `${fmt(d.total)} roster songs to put in the report first`,
    cta: "Open", panel: "trueup", rank: { kind: "other" } });
  const n = d.notInReport?.length || 0;
  // (round 10) a song can be missing because Luminate leaves out songs with no plays, or because it isn't in the report
  if (n) out.push({ k: "trueup-new", area: "roster", t: `${fmt(n)} roster song${n === 1 ? "" : "s"}: no plays this period, or not in the report yet`,
    d: d.baseline?.kind === "trueup" ? `Compared with the ${shortDay(d.baseline.on)} update` : `Compared with the ${shortDay(d.baseline?.on) || "last"} portfolio exports`, cta: "Copy", panel: "trueup-new", rank: { kind: "other" } });
  if (d.schedule?.remind) out.push({ k: "trueup-schedule", area: "roster", t: `Luminate's schedule ends on ${shortDay(d.schedule.ends)}: copy the report to keep it running`,
    cta: "Open", panel: "trueup-schedule", rank: { kind: "other" } });
  return out;
}
