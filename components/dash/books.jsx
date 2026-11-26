import React, { useState } from "react";
import { X, RefreshCw, CheckCircle2 } from "lucide-react";
import { ExtLink } from "../shared/ui";
import { useEscape } from "./ui";
import { useBooks, setBooks } from "./books-data";
export { rowsWord } from "./books-data";

// (2026-11-26, books-1126) Each year's accounting book (lib/accounting-books.js): Money's Books button and its sheet, and To do's
// "Set the 2027 book" panel. A Founder pastes the book's link; the server checks it has this year's tabs and headers (and that the site's
// Google account can edit it) before it's saved, and says what's wrong otherwise.
// (2026-11-26 owner: automatic) The sheet is Money's Settings: the books, and Auto-log's one switch under them (lib/auto-log.js; on unless a Founder
// turns it off). The button is always on a Founder's source row ("Settings", or "Set the 2027 book" while a year needs one), so the switch is always there.

const post = (year, link) => fetch("/api/accounting-books", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify({ year, link }) })
  .then((r) => r.json().catch(() => ({})).then((j) => (r.ok && j?.books ? j : { error: j.error || "Couldn't reach the server. Try again in a minute." })))
  .catch(() => ({ error: "Couldn't reach the server. Try again in a minute." }));

// one year: its book's link (and Change), or the box its link is pasted into
function BookLine({ b }) {
  const [edit, setEdit] = useState(!b.url);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    if (!link.trim() || busy) return;
    setBusy(true); setErr(null);
    const j = await post(b.year, link.trim());
    setBusy(false);
    if (j.error) { setErr(j.error); return; }
    setLink(""); setEdit(false); setBooks(j);
  };
  return (
    <div className="book-line" data-book={b.year}>
      <span className="book-year">{b.year}</span>
      {edit ? (
        <form className="book-form" onSubmit={save}>
          <input type="text" inputMode="url" autoComplete="off" spellCheck={false} placeholder={`The ${b.year} book's link`} aria-label={`The ${b.year} book's link`} aria-invalid={!!err}
            value={link} disabled={busy} onChange={(e) => { setLink(e.target.value); setErr(null); }} />
          <button type="submit" className="btn sm" disabled={busy || !link.trim()} data-book-save>{busy ? "Checking…" : "Save"}</button>
          {b.url && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => { setEdit(false); setErr(null); setLink(""); }}>Cancel</button>}
        </form>
      ) : (
        <span className="book-acts">
          <ExtLink className="btn ghost sm" href={b.url}>Open ↗</ExtLink>
          {b.change && <button type="button" className="btn ghost sm" onClick={() => setEdit(true)} data-book-change>Change</button>}
        </span>
      )}
      {err && <p className="hint err-text book-err" role="alert">{err}</p>}
    </div>
  );
}
function BooksList({ d, only = null }) {
  const list = (d?.books || []).filter((b) => only == null || b.year === only);
  return <div className="books" data-books>{list.map((b) => <BookLine key={`${b.year} ${b.url || ""}`} b={b} />)}</div>;
}
const wait = <p className="home-muted"><RefreshCw size={15} className="spin" /> Loading…</p>;

// Auto-log's switch: "Auto-log", then On / Off (the server's answer is what shows; a refused save says why under it)
export function AutoLogLine({ d }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const on = d?.autoLog?.on !== false;
  if (!d?.autoLog) return null;
  const flip = async () => {
    setBusy(true); setErr(null);
    const r = await fetch("/api/accounting-books", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify({ action: "autoLog", on: !on }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (r?.ok && j.autoLog) setBooks({ ...d, autoLog: j.autoLog }); else setErr(j.error || "Couldn't reach the server. Try again in a minute.");
  };
  return (
    <div className="set-line" data-auto-log-line>
      <span className="set-name" id="auto-log-name">Auto-log</span>
      <button type="button" role="switch" aria-checked={on} aria-labelledby="auto-log-name" className={on ? "btn sm set-switch" : "btn ghost sm set-switch"} data-auto-log={on ? "on" : "off"} disabled={busy} onClick={flip}>{busy ? "Saving…" : on ? "On" : "Off"}</button>
      {err && <p className="hint err-text set-err" role="alert">{err}</p>}
    </div>
  );
}

export function BooksSheet({ onClose }) {
  const d = useBooks(true);
  useEscape(onClose);
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card books-modal" role="dialog" aria-label="Settings">
        <div className="modal-head"><h3>Settings</h3><button onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-body">{d ? <><BooksList d={d} /><AutoLogLine d={d} /></> : wait}</div>
      </div>
    </div>
  );
}

// Money's source row (a Founder's: AccountingAdmin decides): always, "Set the 2027 book" in amber while a year needs its book, else "Settings"
export function BooksButton() {
  const d = useBooks(true);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={d?.need ? "btn ghost sm acct-books need" : "btn ghost sm acct-books"} data-acct-books onClick={() => setOpen(true)}>{d?.need ? `Set the ${d.need} book` : "Settings"}</button>
      {open && <BooksSheet onClose={() => setOpen(false)} />}
    </>
  );
}

// To do's "Set the 2027 book": the year it needs, pasted right here (the row goes once it's saved)
export function BooksPanel() {
  const d = useBooks(true);
  if (!d) return wait;
  if (!d.need) return <p className="home-muted acct-clear"><CheckCircle2 size={15} /> Every year has its book.</p>;
  return <div className="todo-sublist" data-books-panel><BooksList d={d} only={d.need} /></div>;
}
