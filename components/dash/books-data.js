import { useEffect, useSyncExternalStore } from "react";
import { fate, markLoaded, loadedRecently, readFresh, stamp } from "../shared/boot";
import { useOnResume } from "../app/resume";

// (2026-11-26, books-1126) Each year's accounting book, the Founders' setting (GET/POST /api/accounting-books, lib/accounting-books.js): one shared
// copy for To do's "Set the 2027 book" row, Money's Books button and the sheet both open. The screens are books.jsx.

const store = { d: null, subs: new Set(), loading: null };
const emit = () => store.subs.forEach((f) => f());
const sub = (f) => { store.subs.add(f); return () => store.subs.delete(f); };
const snap = () => store.d;
// an answer from before a write or a sign-in never lands (lib boot's fate)
export function reloadBooks() {
  if (store.loading) return store.loading;
  const t0 = stamp();
  const p = readFresh("/api/accounting-books", undefined, () => reloadBooks()).then(({ dropped, ok, j, t }) => {
    if (dropped || !ok || !j?.books) return;
    store.d = j; markLoaded("books", t);
  }).catch(() => {}).finally(() => { if (store.loading === p) store.loading = null; if (fate(t0) !== "drop") emit(); });
  store.loading = p;
  return p;
}
// a save's own answer is the new copy (no second read)
export function setBooks(d) { if (d?.books) { store.d = d; emit(); } }
// on: a Founder with Money (the API refuses everyone else, so nobody else asks)
export function useBooks(on = true) {
  const data = useSyncExternalStore(sub, snap, () => null);
  useEffect(() => { if (on && !loadedRecently("books")) reloadBooks(); }, [on]);
  useOnResume(() => { if (on) reloadBooks(); });
  return on ? data : null;
}

// Log it's "Added to the Income tab: …" (pure): "row 312", "rows 312–314"; rows in two books (January: last year's payments go into last year's
// book) say which: "row 312 of the 2026 book, rows 4–5 of the 2027 book"
const rowSpan = (xs) => (xs.length === 1 ? `row ${xs[0].row}` : `rows ${xs[0].row}–${xs[xs.length - 1].row}`);
export function rowsWord(logged) {
  const years = [...new Set((logged || []).map((x) => x.year).filter(Boolean))].sort();
  if (years.length < 2) return rowSpan(logged);
  return years.map((y) => `${rowSpan(logged.filter((x) => x.year === y))} of the ${y} book`).join(", ");
}

// To do's row (pure): from Dec 1 while next year's book isn't set, and while this year's has none (or can't be read)
export function booksTodoItems(d) {
  if (!d?.need) return [];
  return [{ k: "books", area: "money", t: `Set the ${d.need} book`, cta: "Set", panel: "books", rank: { kind: "fix", value: 0 } }];
}
