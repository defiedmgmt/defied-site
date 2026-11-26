// Money › Paydays (2026-11-26, the owner: "the whole royalty payout tracker" in Money as its own pill): Next (the paydays whose commission
// is still to come in, then each source's next one), Dates (each source's days; a Founder edits them) and Clients (which sources pay whom;
// a Founder ticks them). PaydayCard is also To do's and Home's payday row, opened. Everything comes from GET /api/paydays.
import { useState, useEffect } from "react";
import { RefreshCw, AlertTriangle, X } from "lucide-react";
import { swrJson } from "../ui/fetch-cache";
import { ExtLink } from "../shared/ui";
import { nyShortDay } from "../../lib/ny-time";
import { dayText } from "../../lib/paydays";
import { RequestPay, usePayKeys } from "./request-pay";

const SHORT = { bmi: "BMI", "ascap-w": "ASCAP writer", "ascap-intl": "ASCAP intl", "ascap-pub": "ASCAP pub", mlc: "The MLC" };
const post = (body) => fetch("/api/paydays", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify(body) })
  .then((r) => r.json().catch(() => ({})).then((j) => (r.ok ? j : { error: j.error || "Couldn't save that. Try again in a minute." })))
  .catch(() => ({ error: "Couldn't reach the server. Try again in a minute." }));

// One payday: its day and source, each client it pays (Paid, Requested, or Request payment), Got it. compact: To do's / Home's, with Paydays ›
// onChange(action): after Got it ("done"), its Undo ("undo") or a request sent ("request"), so the page or To do's counts read again (review UX-4, UX-7)
export function PaydayCard({ p, compact = false, onGo, onChange }) {
  const keyOf = usePayKeys();
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState(false);
  const [err, setErr] = useState(null);
  const act = async (action) => {
    setBusy(true); setErr(null);
    const j = await post({ action, id: p.id });
    setBusy(false);
    if (j.error) { setErr(j.error); return; }
    setClosed(action === "done");
    onChange?.(action);
  };
  const head = `${dayText(p.day, p.approx)} · ${p.name}`;
  if (closed) return <p className="pd-card pd-closed" data-payday={p.id} data-closed><span>{head}: got it.</span> <button type="button" className="inline-link" disabled={busy} onClick={() => act("undo")}>Undo</button></p>;
  return (
    <div className={compact ? "pd-card compact" : "pd-card"} data-payday={p.id}>
      <div className="pd-card-head">
        {!compact && <b>{head}</b>}
        <span className="pd-card-acts">
          {compact && onGo && <button type="button" className="inline-link" data-go-paydays onClick={() => onGo("money", "paydays")}>Paydays ›</button>}
          <button type="button" className="btn ghost sm" data-got-it={p.id} disabled={busy} onClick={() => act("done")}>Got it</button>
        </span>
      </div>
      <ul className="pd-people">
        {p.people.map((x) => (
          <li key={x.id} data-person={x.id}>
            <span className="pd-name">{x.name}</span>
            {x.paid ? <span className="req-state paid" data-req-paid={x.id}>Paid {nyShortDay(x.paid)}</span>
              : x.unknown ? null
              : <RequestPay clientId={x.id} payKey={keyOf(x.id)} paydayId={p.id} asked={x.asked} look="ghost" onSent={() => onChange?.("request")} />}
          </li>
        ))}
      </ul>
      {err && <p className="hint err-text" role="alert">{err}</p>}
    </div>
  );
}

// a date chip: grey once it's gone by, ≈ for an estimate; editing, an × takes it off
function DateChip({ s, d, year, edit, onRemove, busy }) {
  return (
    <span className={d.past ? "pd-chip past" : "pd-chip"} data-day={d.day}>
      {dayText(d.day, d.approx)}{d.day.slice(0, 4) !== year ? ` ${d.day.slice(0, 4)}` : ""}
      {edit && <button type="button" className="pd-chip-x" aria-label={`Remove ${s.name} ${d.day}`} disabled={busy} onClick={() => onRemove(d.day)}><X size={12} /></button>}
    </span>
  );
}
function AddDates({ s, onSaved }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const add = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setErr(null);
    const j = await post({ action: "dates", source: s.id, text });
    setBusy(false);
    if (j.error) { setErr(j.error); return; }
    setText(""); setErr(j.bad?.length ? `Couldn't read ${j.bad.map((b) => `"${b}"`).join(", ")}.` : null);
    onSaved();
  };
  return (
    <form className="pd-add" onSubmit={add} data-add-dates={s.id}>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Jan 14, Feb 12, ≈Apr 13" aria-label={`Add ${s.name} dates`} disabled={busy} />
      <button type="submit" className="btn sm" disabled={busy || !text.trim()}>{busy ? "Adding…" : "Add"}</button>
      {err && <span className="hint err-text" role="alert">{err}</span>}
    </form>
  );
}

// Clients × sources, ✓ where that source pays them (the owner's tracker); a Founder's Edit makes each cell a toggle
function WhoGrid({ clients, sources, canEdit, onSaved }) {
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const toggle = async (c, src) => {
    const next = c.who.includes(src) ? c.who.filter((x) => x !== src) : [...c.who, src];
    setBusy(`${c.id}:${src}`); setErr(null);
    const j = await post({ action: "who", clientId: c.id, sources: next });
    setBusy(null);
    if (j.error) { setErr(j.error); return; }
    onSaved();
  };
  return (
    <>
      {err && <p className="hint err-text" role="alert">{err}</p>}
      <div className={canEdit ? "pd-grid edit" : "pd-grid"} role="table" aria-label="Which sources pay each client">
        <div className="pd-grow pd-ghead" role="row"><span role="columnheader">Client</span>{sources.map((s) => <span key={s.id} role="columnheader">{SHORT[s.id] || s.name}</span>)}</div>
        {clients.map((c) => (
          <div key={c.id} className="pd-grow" role="row" data-who={c.id}>
            <span role="rowheader" className="pd-gname">{c.name}</span>
            {sources.map((s) => {
              const on = c.who.includes(s.id);
              return (
                <span key={s.id} role="cell" className={on ? "pd-gcell on" : "pd-gcell"}>
                  {canEdit ? <button type="button" className={on ? "pd-tick on" : "pd-tick"} aria-pressed={on} aria-label={`${c.name}: ${s.name}`} data-tick={`${c.id}:${s.id}`} disabled={busy === `${c.id}:${s.id}`} onClick={() => toggle(c, s.id)}><span className="pd-tick-l">{SHORT[s.id] || s.name}</span><span className="pd-tick-m" aria-hidden="true">{on ? "✓" : ""}</span></button>
                    : on ? <span className="pd-tick on"><span className="pd-tick-l">{SHORT[s.id] || s.name}</span><span className="pd-tick-m" aria-hidden="true">✓</span></span> : null}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

export function Paydays() {
  const [d, setD] = useState(null);
  const [failed, setFailed] = useState(false);
  const [edit, setEdit] = useState(false);
  const [editWho, setEditWho] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // (review UX-4) the paydays Got it on this visit: each card stays, closed with its Undo, after the read that drops it from Next
  const [kept, setKept] = useState([]);
  const load = () => {
    setFailed(false);
    return swrJson("/api/paydays", (x) => { if (x?.sources) setD(x); }, { keep: (x) => !!x?.sources }).then((x) => { if (!x?.sources) setFailed(true); }).catch(() => setFailed(true));
  };
  useEffect(() => { load(); }, []);
  if (!d) return failed ? <p className="home-muted"><AlertTriangle size={15} /> <span>Couldn't load the paydays. <button className="inline-link" onClick={() => load()}>Try again</button></span></p>
    : <p className="home-muted"><RefreshCw size={15} className="spin" /> Loading…</p>;
  const changed = (p, action) => {
    if (action === "done") setKept((xs) => [...xs.filter((x) => x.id !== p.id), p]);
    const read = load();
    if (action === "undo") read.then(() => setKept((xs) => xs.filter((x) => x.id !== p.id)));
  };
  const cards = [...d.open, ...kept.filter((k) => !d.open.some((p) => p.id === k.id))];
  const partial = { both: "Stripe and the sheet couldn't be read just now, so who's paid isn't shown.", stripe: "Stripe couldn't be read just now: the sheet's payments only.", sheet: "The sheet couldn't be read just now: Stripe's payments only." }[d.partial];
  const remove = async (src, day) => {
    setBusy(true); setErr(null);
    const j = await post({ action: "removeDate", source: src, day });
    setBusy(false);
    if (j.error) setErr(j.error); else load();
  };
  return (
    <div className="paydays" data-paydays>
      <div className="fix-panel acct-panel pd-next" data-paydays-part="next">
        <div className="fix-head"><h3>Next</h3></div>
        {partial && <p className="home-muted" data-paydays-partial={d.partial}><AlertTriangle size={15} /> {partial}</p>}
        {cards.map((p) => <PaydayCard key={p.id} p={p} onChange={(action) => changed(p, action)} />)}
        {d.upcoming.map((u) => (
          <div key={u.id} className="pd-line" data-upcoming={u.id}>
            <b className="pd-when">{dayText(u.day, u.approx)} · {u.name}</b>
            <span className="pd-who">{u.people.map((x) => x.name).join(" · ")}</span>
          </div>
        ))}
        {!cards.length && !d.upcoming.length && <p className="home-muted">No paydays set.</p>}
      </div>
      <div className="fix-panel acct-panel pd-dates" data-paydays-part="dates">
        <div className="fix-head"><h3>Dates</h3>{d.canEdit && <button type="button" className="btn ghost sm pd-edit" data-edit-dates aria-pressed={edit} onClick={() => setEdit((x) => !x)}>{edit ? "Done" : "Edit"}</button>}</div>
        {err && <p className="hint err-text" role="alert">{err}</p>}
        {d.sources.map((s) => (
          <div key={s.id} className="pd-src" data-source={s.id}>
            <span className="pd-src-name">{s.name}</span>
            <span className="pd-chips">
              {s.dates.map((x) => <DateChip key={x.day} s={s} d={x} year={d.today.slice(0, 4)} edit={edit} busy={busy} onRemove={(day) => remove(s.id, day)} />)}
              {s.notSet && <span className="pd-chip notset" data-not-set>{s.notSet}</span>}
              {(s.notSet || edit) && <ExtLink className="inline-link pd-src-link" href={s.url} label={`${s.name}'s published schedule`} title={`${s.name}'s published schedule`}>↗</ExtLink>}
            </span>
            {edit && <AddDates s={s} onSaved={load} />}
          </div>
        ))}
      </div>
      <div className="fix-panel acct-panel pd-clients" data-paydays-part="clients">
        <div className="fix-head"><h3>Clients</h3>{d.canEdit && <button type="button" className="btn ghost sm pd-edit" data-edit-who aria-pressed={editWho} onClick={() => setEditWho((x) => !x)}>{editWho ? "Done" : "Edit"}</button>}</div>
        <WhoGrid clients={d.clients} sources={d.sources} canEdit={!!d.canEdit && editWho} onSaved={load} />
      </div>
    </div>
  );
}
