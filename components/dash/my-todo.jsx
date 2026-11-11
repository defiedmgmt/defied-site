import React, { useState, useEffect, useRef } from "react";
import { Plus, RefreshCw, AlertTriangle } from "lucide-react";
import { dueBucket, nyShort } from "../../lib/todo-rank";
import { ExtLink } from "../shared/ui";
import { PREVIEW, PREVIEW_OFF } from "../../lib/preview";

// My to-do (2026-11-11, the owner): a staff login's own ClickUp list and nothing else (GET/POST /api/my-tasks):
// add a task, Done ✓ takes it off (done in ClickUp), and what's changed in ClickUp shows when the page is opened
// again, on Refresh, or when the window comes back into view.
const BUCKETS = [["overdue", "Overdue"], ["today", "Today"], ["week", "This week"], ["later", "Later"], ["none", "No date"]];
const PRIORITY = { urgent: "Urgent", high: "High", low: "Low" };
const post = (body) => fetch("/api/my-tasks", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify(body) })
  .then(async (r) => ({ ok: r.ok, ...(await r.json().catch(() => ({}))) })).catch(() => ({ ok: false, error: "Couldn't reach ClickUp. Try again in a minute." }));

export function useMyTasks() {
  const [d, setD] = useState(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = (fresh = false) => {
    setBusy(true);
    return fetch(`/api/my-tasks${fresh ? "?fresh=1" : ""}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject())).then((j) => { setD(j); setFailed(false); })
      .catch(() => setFailed(true)).finally(() => setBusy(false));
  };
  useEffect(() => {
    load();
    const back = () => { if (document.visibilityState === "visible") load(true); };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { d, failed, busy, load, setD };
}

function Row({ t, writes, onDone }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const b = dueBucket(t.due);
  const done = async () => {
    setBusy(true); setErr(null);
    const r = await post({ action: "done", id: t.id });
    setBusy(false);
    if (!r.ok) return setErr(r.error || "Couldn't reach ClickUp. Try again in a minute.");
    onDone(t.id);
  };
  return (
    <div className="attn-row cu-todo" data-my-task={t.id} data-bucket={b}>
      <span className="attn-main">
        <b><ExtLink href={t.url} className="cu-name" title="Open in ClickUp">{t.name}{" "}<span className="cu-ext" aria-hidden="true">↗</span></ExtLink></b>
        <em>{[t.due && `${b === "overdue" ? "Late · was due" : "Due"} ${nyShort(t.due)}`, PRIORITY[t.priority] && `${PRIORITY[t.priority]} priority`, t.people?.length ? t.people.map((p) => p.name).join(", ") : null].filter(Boolean).join(" · ") || t.status}</em>
        {err && <em className="err-text" role="alert">{err}</em>}
      </span>
      <button type="button" className="btn ghost sm" data-my-done={t.id} disabled={busy || !writes} title={writes ? "Set it to done in ClickUp" : PREVIEW ? PREVIEW_OFF : "Writing to ClickUp isn't switched on yet"} onClick={done}>{busy ? "Saving…" : "Done ✓"}</button>
    </div>
  );
}

function AddTask({ writes, onAdded }) {
  const [name, setName] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const input = useRef(null);
  const go = async (e) => {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    if (!name.trim()) return setErr("Give the task a name.");
    setBusy(true);
    const r = await post({ action: "create", name, due: due || null });
    setBusy(false);
    if (!r.ok) return setErr(r.error || "Couldn't reach ClickUp. Try again in a minute.");
    setName(""); setDue(""); onAdded(r.created); input.current?.focus();
  };
  return (
    <form className="mt-add" onSubmit={go} data-my-add>
      <input ref={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a task" aria-label="New task" disabled={busy || !writes} maxLength={200} data-my-add-name />
      <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due (optional)" disabled={busy || !writes} data-my-add-due />
      <button type="submit" className="btn sm" disabled={busy || !writes}><Plus size={15} /> {busy ? "Adding…" : "Add"}</button>
      {err && <p className="hint err-text mt-add-err" role="alert">{err}</p>}
    </form>
  );
}

export function MyTodoPage() {
  const { d, failed, busy, load, setD } = useMyTasks();
  const tasks = d?.tasks || [];
  const writes = !!d?.writes;
  const drop = (id) => setD((x) => ({ ...x, tasks: (x.tasks || []).filter((t) => t.id !== id) }));
  const add = (t) => t && setD((x) => ({ ...x, tasks: [...(x.tasks || []), t] }));
  return (
    <div className="todo-page my-todo" data-my-todo>
      <div className="admin-head"><h2>My to-do</h2>
        <button type="button" className="btn ghost sm" onClick={() => load(true)} disabled={busy} data-my-refresh><RefreshCw size={14} className={busy ? "spin" : undefined} /> Refresh</button>
      </div>
      {d?.list && <p className="muted mt-from">Your ClickUp list, <ExtLink href={d.list.url} className="inline-link" title="Open in ClickUp">{d.list.name}{" "}↗</ExtLink>. Add or tick things off here or in ClickUp; both stay the same.</p>}
      <div className="attn home-card todo" data-area="clickup">
        {d && !d.none && !d.error && <AddTask writes={writes} onAdded={add} />}
        {d && !d.none && !writes && <p className="todo-line">{PREVIEW ? PREVIEW_OFF : "Writing to ClickUp isn't switched on yet, so this list is read-only for now."}</p>}
        {!d && !failed && <p className="todo-line"><RefreshCw size={14} className="spin" /> Loading your ClickUp list…</p>}
        {failed && !d && <p className="todo-line"><AlertTriangle size={14} /> Couldn't reach ClickUp. <button className="inline-link" onClick={() => load(true)}>Try again</button></p>}
        {d?.none && <p className="todo-line" data-my-none>Your login isn't matched to a ClickUp list yet.</p>}
        {d?.error && <p className="todo-line" data-my-error><AlertTriangle size={14} /> {d.error} <button className="inline-link" onClick={() => load(true)}>Try again</button></p>}
        {d && !d.none && !d.error && BUCKETS.map(([b, label]) => {
          const xs = tasks.filter((t) => dueBucket(t.due) === b).sort((x, y) => (x.due ? Date.parse(x.due) : Infinity) - (y.due ? Date.parse(y.due) : Infinity));
          if (!xs.length) return null;
          return (
            <React.Fragment key={b}>
              <div className="todo-sub" data-bucket-head={b}>{label} · {xs.length}</div>
              {xs.map((t) => <Row key={t.id} t={t} writes={writes} onDone={drop} />)}
            </React.Fragment>
          );
        })}
        {d && !d.none && !d.error && !tasks.length && <p className="todo-line" data-my-empty>Nothing open on your list.</p>}
      </div>
    </div>
  );
}
