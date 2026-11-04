// The shared mobile-first helper (list B #10). Its CSS is components/ui/mobile.css (imported in pages/_app.jsx).
//
// THE RULES FOR EVERY SCREEN, OLD OR NEW (a phone = under 640px; the test is harness tests/mobile-ui.cjs):
//   1. Tables become cards on phones: use <CardTable>, or put className="m-cards" on a <table> (and
//      "m-cards-wrap" on its scroll wrapper) with data-label="..." on every <td>. A sortable table adds
//      <PhoneSort> above it (its header row is hidden on phones).
//   2. Nothing scrolls sideways at 390px or 360px. Only a chip row may, and it says so with data-m-scroll.
//   3. Every control is at least 44px tall (and 44px wide) on a phone or touch screen: mobile.css does this for
//      buttons, a.btn, fields, selects and tabs inside .dash-main / .portal-main / .modal. Something custom that
//      is tapped gets className="m-tap".
//   4. The bottom nav: under 900px the dashboard's nav is a bar fixed to the bottom. A new top-level tab is one
//      more row in Dashboard's `tabs` (components/App.jsx); a sub-page is one more pill in its .subnav.
//   5. Cell data: GET reads go through swrJson() (components/ui/fetch-cache.js) so a screen opened again draws
//      its last answer at once; a heavy block below the fold goes in <LazySection>; images get loading="lazy".
//   6. Charts size to their box: an <svg viewBox="..."> with width="100%" (no fixed pixel width), or recharts'
//      <ResponsiveContainer>.
import React, { useEffect, useRef, useState } from "react";

export const PHONE_MAX = 639;
const PHONE_Q = `(max-width:${PHONE_MAX}px)`;

// true on a phone-width screen; follows rotation and window resizes. false on the server and on first paint
// (the CSS does the layout; this is only for what has to render differently, e.g. fewer chart labels).
export function useIsPhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia(PHONE_Q);
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on));
  }, []);
  return phone;
}

// A table on desktop, a stack of cards on a phone.
//   cols    [{ id, label, render?: (row) => node, className?, cardLabel? }]; the first column is the card's title.
//           cardLabel: the words on the card when they differ from the header ("" for none).
//   rows    the rows; rowKey(row) gives each its key (default row.id)
//   onRow   (row) => void: the row (the card on a phone) opens something
//   sort    { col, dir } and onSort(colId): sortable headers on desktop, a "Sort by" picker on a phone
//   foot    an optional totals row: { [colId]: node }
//   empty   what to say with no rows (a plain sentence; never example rows)
export function CardTable({ cols, rows, rowKey = (r) => r.id, onRow, sort, onSort, foot, empty = null, className = "", wrapClassName = "", ...rest }) {
  if (!rows?.length && empty) return <p className="hint">{empty}</p>;
  const cell = (c, r) => (c.render ? c.render(r) : r[c.id]);
  const label = (c) => (c.cardLabel != null ? c.cardLabel : typeof c.label === "string" ? c.label : "");
  return (
    <>
      {onSort && <PhoneSort cols={cols} sort={sort} onSort={onSort} />}
      <div className={`master-table-wrap m-cards-wrap ${wrapClassName}`.trim()}>
        <table className={`master-table m-cards ${className}`.trim()} {...rest}>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.id} data-col={c.id} className={c.className} aria-sort={sort?.col === c.id ? (sort.dir < 0 ? "descending" : "ascending") : undefined}>
                  {onSort ? <button className={sort?.col === c.id ? "ar-sort on" : "ar-sort"} onClick={() => onSort(c.id)}>{c.label}{sort?.col === c.id ? (sort.dir < 0 ? " ▼" : " ▲") : ""}</button> : c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)} data-m-open={onRow ? "" : undefined} className={onRow ? "master-row-link" : undefined} onClick={onRow ? () => onRow(r) : undefined}>
                {cols.map((c, i) => <td key={c.id} data-label={i ? label(c) : undefined} className={c.className}>{cell(c, r)}</td>)}
              </tr>
            ))}
          </tbody>
          {foot && <tfoot><tr className="master-total-row">{cols.map((c, i) => <td key={c.id} data-label={i ? label(c) : undefined}>{foot[c.id] ?? null}</td>)}</tr></tfoot>}
        </table>
      </div>
    </>
  );
}

// On a phone, a table's header row is hidden, so its sort becomes this: a "Sort by" picker and an up/down button.
// cols: [{ id, label }] (label may be a string or have a cardLabel); sort: { col, dir }; onSort(colId) flips
// the direction when it's the column already sorted by, as a header click does.
export function PhoneSort({ cols, sort, onSort }) {
  const words = (c) => (typeof c.label === "string" ? c.label : c.cardLabel || c.id);
  return (
    <div className="m-sort" data-m-sort>
      <label htmlFor="m-sort-pick">Sort by</label>
      <select id="m-sort-pick" value={sort?.col || ""} onChange={(e) => onSort(e.target.value)}>
        {cols.map((c) => <option key={c.id} value={c.id}>{words(c)}</option>)}
      </select>
      <button type="button" aria-label={sort?.dir < 0 ? "Highest first (tap for lowest first)" : "Lowest first (tap for highest first)"} onClick={() => sort?.col && onSort(sort.col)}>{sort?.dir < 0 ? "▼" : "▲"}</button>
    </div>
  );
}

// A heavy block below the fold: drawn once it comes within `margin` of the screen, or once the page has
// settled (idle), whichever is first, so a phone on cell data draws what's on screen first. Desktop (640px and
// up) draws it at once. minHeight keeps the page from jumping while it waits.
export function LazySection({ children, minHeight = 160, margin = "600px", className = "", ...rest }) {
  const ref = useRef(null);
  const [on, setOn] = useState(() => typeof window === "undefined" || !window.matchMedia || !window.matchMedia(PHONE_Q).matches || !("IntersectionObserver" in window));
  useEffect(() => {
    if (on || !ref.current) return undefined;
    let done = false;
    const go = () => { if (!done) { done = true; setOn(true); } };
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && go(), { rootMargin: margin });
    io.observe(ref.current);
    const idle = window.requestIdleCallback ? window.requestIdleCallback(go, { timeout: 1500 }) : window.setTimeout(go, 800);
    return () => { io.disconnect(); window.cancelIdleCallback ? window.cancelIdleCallback(idle) : window.clearTimeout(idle); };
  }, [on, margin]);
  if (on) return <>{children}</>;
  return <div ref={ref} className={className} style={{ minHeight }} aria-busy="true" data-lazy-wait {...rest} />;
}
