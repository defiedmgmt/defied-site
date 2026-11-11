import React, { useState, useEffect, useRef } from "react";
import { X, RefreshCw, AlertTriangle, CheckCircle2, CircleDollarSign, Info } from "lucide-react";
import { foldMonths } from "../../lib/months";
import { swrJson } from "../ui/fetch-cache";
import { clock } from "./chips";
import { payDay, shortDay } from "./helpers";
import { HomeWait, monthName } from "./home-data";
import { fmt, money, useEscape } from "./ui";
import { ExtLink } from "../shared/ui";
import { PREVIEW, PREVIEW_OFF } from "../../lib/preview";
import { typedMoney, checkEdit, sheetSplit, coShare, COMMISSION, GENERAL } from "../../lib/log-fields";
import { MyPaymentsPage } from "./my-payments";

// "Nov", "Oct": this month and the one before, from the day the page is viewed
const monthShort = (offset) => { const d = new Date(); d.setDate(15); d.setMonth(d.getMonth() + offset); return d.toLocaleDateString("en-US", { month: "short" }); };
export function MoneyRow({ money: m, failed, retry }) {
  if (!m || !m.connected || m.error) {
    return (
      <div className="home-money home-money-line" data-money-line="wait">
        {!m ? <HomeWait failed={failed} retry={retry} what="the commission" />
          : !m.connected ? <p className="home-muted"><CircleDollarSign size={15} /> Connect Stripe to see your commission here.</p>
          : <p className="home-muted"><AlertTriangle size={15} /> {m.error}</p>}
      </div>
    );
  }
  // r10 fix (N4): one compact line, "Nov $0.00 · Oct $404.76 · 2026 $4,427.07 (i)": the months named from the day
  // the page is viewed; what it counts sits behind the (i) only (hover, focus or tap), on every screen size
  const year = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", year: "numeric" });
  // (the full label, "This month (Nov)", is what's read out; the screen shows the short one, "Nov")
  const stats = [["thisMonth", monthShort(0), `This month (${monthShort(0)})`], ["lastMonth", monthShort(-1), `Last month (${monthShort(-1)})`], ["thisYear", year, "This year"]];
  return (
    <div className="cat-summary home-money-row home-money-line" data-money-line>
      <div className="cat-summary-grid hml-grid">
        {stats.map(([k, short, long], i) => (
          <div key={k} className="cat-stat hml-stat" data-stat={k} title={long}>{i > 0 && <i className="hml-dot" aria-hidden="true">·</i>}<span className="cat-stat-label hml-l" data-short={short}><span className="sr-only">{long}</span></span> <span className="cat-stat-val">{money(m[k])}</span></div>
        ))}
      </div>
      <span className="home-money-info" tabIndex={0} role="button" aria-describedby="home-money-note"><Info size={14} aria-hidden="true" /><span className="sr-only">What these count</span></span>
      <p className="hint home-money-note" id="home-money-note" role="note">Everything Defied's cut took in through Stripe, before Stripe's card fees. It also counts test payments and other income paid through Stripe, like studio work.</p>
    </div>
  );
}

// a $2-or-less or "test" payment (the server's isTestPay): still counted and listed, only marked
export const TestChip = () => <span className="pay-test" title="A test payment: $2 or less, or &quot;test&quot; in its description">Test</span>;
// "via Devin's link", or straight to Defied's own account (tests and deposits so far)
const viaText = (p) => (p.direct ? "paid to Defied directly" : p.via ? `via ${p.via}'s link` : "via a payment link");
// green = Defied's share; what they paid in all sits under it only when it's different
function PayRow({ p, over, onLog }) {
  return (
    <div className={over ? "pay-row over" : "pay-row"} data-pay={p.id}>
      <span className="pay-main"><strong>{p.client || p.payer || "Unknown payer"}</strong>
        <span>{payDay(p.at)} · {viaText(p)}{p.test && <> <TestChip /></>}{p.logged === false && <> · <span className="pay-flag">Not in the sheet yet</span></>}</span></span>
      {onLog && p.logged === false && <button className="btn ghost sm pay-log" data-log={p.id} onClick={() => onLog([p.id])}>Log it</button>}
      <span className="pay-amt"><b>{money(p.fee)}</b>{p.fee !== p.amount && <em>{money(p.amount)} paid</em>}</span>
    </div>
  );
}

// "Log it" / "Log all": the exact rows first (a dry run on the server, fresh from Stripe and the
// sheet), then one click adds them to the accounting sheet's Income tab. Off until the server's
// ACCOUNTING_SHEET_WRITES is on, and then it only says so.
// r11 (the owner: "autofill but gimme the option to change"): every row's fields show filled in the way the site
// worked them out, each one open to change, checked as it's typed (lib/log-fields.js, the server's rule too). A row
// nobody touched is sent as before (only its id) and goes in exactly as it always did.
// the confirm's title follows the ticked rows (every row starts ticked, test payments too)
const logTitle = (n) => (n === 1 ? "Log this payment" : n === 0 ? "Log payments" : `Log ${n} payments`);
const centsOf = (n) => Math.round(Number(n) * 100);
const centsText = (n) => (centsOf(n) / 100).toFixed(2);
// a row's fields as the inputs hold them (text), from what the dry run worked out
const fieldsOf = (r) => ({ day: r.day, type: r.type, client: r.client, amount: centsText(r.amount), account: r.account, notes: r.notes || "",
  manager: r.manager || r.co?.via || "", managerShare: centsText(r.manager ? r.managerShare : coShare(centsOf(r.amount), r.co?.keep || 0) / 100), shareTyped: false });
// a co-manager's General / Company row: its Manager and Manager Share are typed (fields); anywhere else the sheet
// works them out (shown, not editable)
const coRow = (r, v) => !!r.co && v.client === GENERAL;
// what's sent for a row: every field it shows, or null while each one is still the site's own
function editOf(r, v) {
  const co = coRow(r, v);
  const same = v.day === r.day && v.type === r.type && v.client === r.client && typedMoney(v.amount).cents === centsOf(r.amount) && v.account === r.account
    && v.notes.trim() === String(r.notes || "").trim() && (co ? !!r.manager && v.manager === r.manager && typedMoney(v.managerShare, { zero: true }).cents === centsOf(r.managerShare) : !r.manager);
  return same ? null : { day: v.day, type: v.type, client: v.client, amount: v.amount, account: v.account, notes: v.notes, ...(co ? { manager: v.manager, managerShare: v.managerShare } : {}) };
}
// a select's choices: the sheet's list, plus the row's own value when the list doesn't have it (it still goes in as is)
const choices = (list, own) => (own && !(list || []).includes(own) ? [own, ...(list || [])] : list || []);
// details: {[id]: {type, client}}, the owner's own picks (Accounting › To log's Log with details);
// pay: the payment they're for, named above the row. onDetails(id): a skipped payment's Log with details.
export function LogConfirm({ ids, canLog, onClose, onDone, details = null, pay = null, onDetails = null }) {
  const [plan, setPlan] = useState(null); // {rows, skipped, year, options} | {error}
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // the write's answer
  const [off, setOff] = useState(() => new Set()); // rows unticked: left out of this write, still to log
  const [vals, setVals] = useState({}); // {[id]: the row's fields as typed}
  const close = () => { if (busy) return; if (done) onDone(); onClose(); };
  useEscape(close);
  const post = (body) => fetch("/api/accounting-log", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify(body) })
    .then((r) => r.json().catch(() => ({})).then((d) => (r.ok ? d : { error: d.error || "Couldn't reach the server. Try again in a minute." })))
    .catch(() => ({ error: "Couldn't reach the server. Try again in a minute." }));
  useEffect(() => {
    if (!canLog) return;
    let alive = true;
    post({ ids, dryRun: true, ...(details ? { details } : {}) }).then((d) => { if (!alive) return; setPlan(d); setVals(Object.fromEntries((d.rows || []).map((r) => [r.id, fieldsOf(r)]))); });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const opts = plan?.options || null; // null: the sheet's lists didn't read, so the rows show as they'll go in
  const rows = (plan?.rows || []).map((r) => {
    const v = vals[r.id] || fieldsOf(r);
    const edit = opts ? editOf(r, v) : null;
    const chk = edit ? checkEdit(edit, r, opts, { year: plan.year, co: r.co }) : null;
    return { r, v, edit, why: chk?.problems || {} };
  });
  const ticked = rows.filter((x) => !off.has(x.r.id));
  const bad = ticked.filter((x) => Object.keys(x.why).length).length;
  const go = async () => {
    const edits = Object.fromEntries(ticked.filter((x) => x.edit).map((x) => [x.r.id, x.edit]));
    setBusy(true);
    const d = await post({ ids: ids.filter((id) => !off.has(id)), ...(details ? { details } : {}), ...(Object.keys(edits).length ? { edits } : {}) });
    setBusy(false); setDone(d);
  };
  const rowsN = rows.length;
  const n = ticked.length;
  const tick = (id) => setOff((s) => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x; });
  // a field typed: a co-manager's Manager Share follows the amount (and comes back with General / Company) until
  // the owner types their own
  const setField = (r, k, value) => setVals((all) => {
    const v = { ...(all[r.id] || fieldsOf(r)), [k]: value };
    if (k === "managerShare") v.shareTyped = true;
    if (r.co && (k === "amount" || k === "client") && !v.shareTyped) { const c = typedMoney(v.amount).cents; if (c != null) v.managerShare = centsText(coShare(c, r.co.keep) / 100); }
    if (r.co && k === "client" && value === GENERAL && !v.manager) v.manager = r.manager || r.co.via;
    return { ...all, [r.id]: v };
  });
  // each skipped line names its payment ("Oct 6 · Payer · $X:"), and offers Log with details where that's the way
  const reasons = (list) => list?.length > 0 && <ul className="log-skipped">{list.map((x) => (
    <li key={x.id} data-skip={x.id}>{x.what && <strong>{x.what}: </strong>}{x.reason}
      {x.details && onDetails && !done && <> <button className="inline-link" data-skip-details={x.id} onClick={() => { onClose(); onDetails(x.id); }}>Log with details</button></>}</li>
  ))}</ul>;
  let body;
  if (!canLog) body = <p className="home-muted" data-log-off><AlertTriangle size={15} /> {PREVIEW ? PREVIEW_OFF : <>Logging from the dashboard isn't switched on yet. For now, add {ids.length === 1 ? "it" : "them"} in the sheet as a new row with the full amount paid.</>}</p>;
  else if (done) {
    body = done.error && !done.logged?.length ? <p className="home-muted"><AlertTriangle size={15} /> {done.error}</p> : (
      <>
        {done.logged?.length > 0 && <p className="log-done" data-log-done><CheckCircle2 size={15} /> Added to the Income tab: {done.logged.length === 1 ? `row ${done.logged[0].row}` : `rows ${done.logged[0].row}–${done.logged[done.logged.length - 1].row}`}.{done.left > 0 ? ` ${done.left} still to log.` : " Every Stripe payment is in the sheet now."}</p>}
        {done.alarm && <p className="logedit-alarm" role="alert" data-log-alarm><AlertTriangle size={15} /> <span>{done.alarm}</span></p>}
        {done.error && <p className="home-muted"><AlertTriangle size={15} /> {done.error}</p>}
        {reasons(done.skipped)}
      </>
    );
  } else if (!plan) body = <p className="home-muted"><RefreshCw size={15} className="spin" /> Checking Stripe and the sheet…</p>;
  else if (plan.error) body = <p className="home-muted"><AlertTriangle size={15} /> {plan.error}</p>;
  else {
    body = (
      <>
        {pay && <p className="log-for" data-log-for>For the {shortDay(pay.at)} payment from {pay.client || pay.payer || "an unknown payer"}, {money(pay.amount)} paid.</p>}
        {rowsN > 0 && <p className="log-lead">{n === 0 ? "No rows are ticked, so nothing goes" : n === 1 ? "This row goes" : `These ${n} rows go`} on the Income tab, under its last row.{opts ? " Each field is filled in already. Change any of them first if you need to." : ""} The sheet works out the month, manager and shares, the same as a row typed by hand{plan.rows.some((r) => r.manager) ? " (a test paid through a co-manager's link gets its manager and share typed in, like your own test rows)" : ""}.{rowsN > 1 ? " Untick one to leave it out for now." : ""}</p>}
        {rowsN > 0 && opts && (
          <div className="logedit-rows" data-log-edit>
            {rows.map((x) => <LogEditRow key={x.r.id} {...x} opts={opts} year={plan.year} off={off.has(x.r.id)} busy={busy} onTick={() => tick(x.r.id)} onField={(k, value) => setField(x.r, k, value)} />)}
          </div>
        )}
        {rowsN > 0 && !opts && (
          <div className="log-table" role="table" aria-label="Rows to add">
            <div className="log-tr log-th" role="row"><span role="columnheader">Date</span><span role="columnheader">Artist / Client</span><span role="columnheader">Revenue type</span><span role="columnheader" className="acct-amt">Gross commission</span></div>
            {plan.rows.map((r) => (
              <label key={r.id} className={off.has(r.id) ? "log-tr off" : "log-tr"} role="row" data-row={r.id}>
                <span role="cell" className="log-date"><input type="checkbox" checked={!off.has(r.id)} disabled={busy} onChange={() => tick(r.id)} aria-label={`Add ${r.client}, ${money(r.amount)}`} />{r.date}</span>
                <span role="cell" className="acct-who">{r.client || <span className="acct-blank">(blank)</span>}{r.test && <> <TestChip /></>}{r.notes ? <em> · {r.notes}</em> : null}{r.manager ? <em> · {r.manager} gets {money(r.managerShare)}</em> : null}</span><span role="cell">{r.type}</span><span role="cell" className="acct-amt">{money(r.amount)}</span>
              </label>
            ))}
          </div>
        )}
        {rowsN > 0 && <p className="hint log-acct">{opts ? "" : `Account: ${plan.rows[0].account}. The sheet's lists couldn't be read just now, so these rows can't be changed here. `}The full amount paid goes in Gross Commission, like the rows already there. Names are written the way the sheet already spells them.</p>}
        {reasons(plan.skipped)}
        {rowsN === 0 && !plan.skipped?.length && <p className="home-muted">Nothing to add.</p>}
      </>
    );
  }
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="modal-card log-modal" role="dialog" aria-label="Log to the accounting sheet">
        <div className="modal-head"><h3>{done ? "Logged" : logTitle(plan?.rows ? n : ids.length)}</h3><button onClick={close} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-body">{body}</div>
        <div className="modal-foot">
          {done || !canLog || !rowsN ? <button className="btn sm" onClick={close}>{done ? "Done" : "Close"}</button> : (
            <>
              <button className="btn ghost sm" onClick={close} disabled={busy}>Cancel</button>
              <button className="btn sm" data-log-go onClick={go} disabled={busy || !n || bad > 0}>{busy ? "Adding…" : !n ? "Nothing ticked" : bad ? `Check the marked ${bad === 1 ? "row" : "rows"}` : n === 1 ? "Add 1 row to the sheet" : `Add ${n} rows to the sheet`}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// One row of the Log confirm as fields (r11): Date, Gross Commission, Revenue Type, Artist / Client, Account and
// Source / Notes, each filled in already; on a co-manager's row Manager and Manager Share too, else what the
// sheet will work out for them (INFO's manager and percentage), as text. why: {field: reason} for a change that
// doesn't fit the sheet's lists, said under that field.
function LogEditRow({ r, v, why, opts, year, off, busy, onTick, onField }) {
  const id = r.id;
  const amt = typedMoney(v.amount).cents;
  const co = coRow(r, v);
  const share = co ? typedMoney(v.managerShare, { zero: true }).cents : null;
  const split = !co && amt != null ? sheetSplit(v.client, amt, opts.roster) : null;
  const bad = (k) => (why[k] ? "true" : "false");
  const say = (k) => why[k] && <span className="hint warn-text" data-why={k}>{why[k]}</span>;
  const field = (k) => ({ "data-f": k, value: v[k] ?? "", "aria-invalid": bad(k), onChange: (e) => onField(k, e.target.value) });
  return (
    <div className={off ? "logedit-row off" : "logedit-row"} data-row={id}>
      <label className="logedit-tick">
        <input type="checkbox" checked={!off} disabled={busy} onChange={onTick} aria-label={`Add ${v.client || "this row"}, ${money(amt != null ? amt / 100 : r.amount)}`} />
        <span className="logedit-sum">{v.client || <span className="acct-blank">(no client)</span>} · {money(amt != null ? amt / 100 : r.amount)}{r.test && <> <TestChip /></>}<em> · paid {shortDay(r.stripe?.day || r.day)}</em></span>
      </label>
      <fieldset className="logedit-grid" disabled={busy || off}>
        <label className="fld"><span>Date</span>
          <input type="date" min={`${year}-01-01`} max={`${year}-12-31`} {...field("day")} />{say("day")}</label>
        <label className="fld"><span>Gross Commission</span>
          <span className="logedit-money">$<input inputMode="decimal" autoComplete="off" {...field("amount")} onFocus={(e) => e.target.select()} /></span>{say("amount")}</label>
        <label className="fld logedit-wide"><span>Revenue Type</span>
          <select {...field("type")}>{choices(opts.types, r.type).map((t) => <option key={t} value={t}>{t}</option>)}</select>{say("type")}</label>
        <label className="fld logedit-wide"><span>Artist / Client</span>
          <select {...field("client")}><option value="">(blank, as on Other Income rows)</option>{choices(opts.clients, r.client).map((c) => <option key={c} value={c}>{c}</option>)}</select>{say("client")}</label>
        <label className="fld logedit-wide"><span>Account</span>
          <select {...field("account")}>{choices(opts.accounts, r.account).map((a) => <option key={a} value={a}>{a}</option>)}</select>{say("account")}</label>
        <label className="fld logedit-wide"><span>Source / Notes</span>
          <input type="text" maxLength={200} autoComplete="off" placeholder="Optional" {...field("notes")} />{say("notes")}</label>
        {co && <>
          <label className="fld"><span>Manager</span>
            <select {...field("manager")}>{choices(opts.managers, r.manager || r.co.via).map((m) => <option key={m} value={m}>{m}</option>)}</select>{say("manager")}</label>
          <label className="fld"><span>Manager Share</span>
            <span className="logedit-money">$<input inputMode="decimal" autoComplete="off" {...field("managerShare")} onFocus={(e) => e.target.select()} /></span>{say("managerShare")}</label>
        </>}
      </fieldset>
      {co ? amt != null && share != null && share <= amt && <p className="logedit-split" data-split>DEFIED SHARE: {money((amt - share) / 100)}. The sheet works it out (Gross Commission less Manager Share).</p>
        : split && <p className="logedit-split" data-split>{split.manager ? <>The sheet works out the rest: Manager {split.manager}, Manager Share {money(split.share / 100)}, DEFIED SHARE {money(split.defied / 100)}.</>
          : <>The sheet works out the rest: no manager, so DEFIED SHARE is the full {money(amt / 100)}.</>}</p>}
      {amt != null && r.stripe && amt !== centsOf(r.stripe.amount) && <p className="logedit-diff" data-diff>Stripe says {money(r.stripe.amount)}; the sheet will say {money(amt / 100)}. It still counts as logged. To check may list the difference: Mark as OK there if it's right.</p>}
    </div>
  );
}

// Log with details opens the same confirm (r11), its Revenue Type and Artist / Client to start the way the old
// picker did: a payer who is a client on INFO (Stripe's "Reallyindig0" is INFO's "reallyindig0") as their
// Management Commission with INFO's spelling, anyone else as Other Income with no client (studio work, a payer
// not on INFO). Every field can still be changed there.
export function detailsDefaults(p, options) {
  const types = options?.types || [], clients = options?.clients || [];
  const onInfo = clients.find((c) => c.toLowerCase() === String(p.client || p.payer || "").trim().toLowerCase());
  if (onInfo && types.includes(COMMISSION)) return { type: COMMISSION, client: onInfo };
  return { type: types.includes("Other Income") ? "Other Income" : types.find((t) => t !== COMMISSION) || types[0] || "", client: "" };
}

// Money (staff only, GET /api/accounting): Overview (the sheet's tiles and Stripe against the sheet
// month by month) and All payments. Its to-dos live in To do (r7), which shows this same component's
// part="log" (every payment the sheet doesn't have: Log all, Log it or Log with details; startLogAll
// opens the Log all preview at once) or part="check" (rows worth a look: Open row ↗ and Mark as OK).
// Nothing in the sheet is ever edited from here: problems are shown with a link to the row.
const ACCT_SECS = [["overview", "Overview"], ["payments", "All payments"]];
// myMoney: the login's own pay link's payments as a third tab, My money (2026-11-11, components/dash/my-payments.jsx)
export function AccountingAdmin({ sub, onSub, onCounts, part = null, startLogAll = false, chip = null, myMoney = false, onGo }) {
  const secs = myMoney ? [...ACCT_SECS, ["mine", "My money"]] : ACCT_SECS;
  const sec = part || (secs.some(([k]) => k === sub) ? sub : "overview");
  const [d, setD] = useState(null);
  const [failed, setFailed] = useState(false);
  const [logIds, setLogIds] = useState(null); // Log it / Log all
  const [detail, setDetail] = useState(null); // {ids, details, p}: Log with details' confirm, its picks filled in
  const [okBusy, setOkBusy] = useState(null);
  const [okErr, setOkErr] = useState(null);
  const load = (fresh = false) => {
    setFailed(false);
    const got = (x) => { if (x?.connected !== undefined) { setD(x); if (x.counts) onCounts?.(x.counts); } else setFailed(true); };
    // the plain read is cached for the tab (drawn at once when Money opens again); a "fresh" read never is
    return (fresh ? fetch("/api/accounting?fresh=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(got)
      : swrJson("/api/accounting", got, { keep: (x) => x?.connected !== undefined }).then((x) => { if (x?.connected === undefined) setFailed(true); })).catch(() => setFailed(true));
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // To do's Log all: the preview of every payment Log it can place, as soon as they're read
  const started = useRef(false);
  useEffect(() => {
    if (!startLogAll || started.current || !d?.toLog?.items) return;
    started.current = true;
    const easy = d.toLog.items.filter((p) => !p.needsDetails);
    if (easy.length) setLogIds(easy.map((p) => p.id));
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  // the overview's "log them" / "see why" open those to-dos in To do
  const toSec = (k) => (k === "log" || k === "check" ? onGo?.("todo", k) : onSub?.(k === "overview" ? null : k));
  // Log with details (r11): straight to the same editable confirm, Revenue Type and Artist / Client filled in
  const setPick = (p) => setDetail({ ids: [p.id], details: { [p.id]: detailsDefaults(p, d?.options) }, p });
  // a payment Log it skipped: straight to Log with details for it
  const pickById = (id) => { const p = d?.toLog?.items?.find((x) => x.id === id); if (p) setPick(p); };
  const markOk = async (key) => {
    setOkBusy(key); setOkErr(null);
    const r = await fetch("/api/accounting", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify({ ok: key }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) setOkErr(j.error || "Couldn't reach the server. Try again in a minute.");
    await load(true); setOkBusy(null);
  };
  let body;
  if (sec === "mine") body = <MyPaymentsPage inMoney />;
  else if (!d) body = failed ? <p className="home-muted"><AlertTriangle size={15} /> <span>Couldn't load the accounting numbers. <button className="inline-link" onClick={() => load()}>Try again</button></span></p>
    : <p className="home-muted"><RefreshCw size={15} className="spin" /> Loading…</p>;
  else if (!d.connected) body = <p className="home-muted">Accounting sheet: not connected yet. Once it's shared with the dashboard, this section fills in.</p>;
  else if (d.error) body = <p className="home-muted"><AlertTriangle size={15} /> {d.error}</p>;
  else if (sec === "overview") body = <AcctOverview d={d} onSec={toSec} />;
  else if (sec === "log") body = <AcctToLog d={d} onLog={setLogIds} onPick={setPick} />;
  else if (sec === "check") body = <AcctToCheck d={d} busy={okBusy} err={okErr} onOk={markOk} />;
  else body = !d.payments ? <p className="home-muted"><AlertTriangle size={15} /> {d.stripe?.error || "Stripe couldn't be read just now."}</p>
    : <div className="acct-panel" data-acct="payments"><p className="pay-legend">Green = Defied's share of each payment · {fmt(d.payments.total)} payments</p>{d.payments.items.map((p) => <PayRow key={p.id} p={p} onLog={(ids) => setLogIds(ids)} />)}</div>;
  const modals = (
    <>
      {logIds && <LogConfirm ids={logIds} canLog={!!d?.toLog?.canLog} onClose={() => setLogIds(null)} onDone={() => load(true)} onDetails={pickById} />}
      {detail && <LogConfirm key={detail.ids[0]} ids={detail.ids} details={detail.details} pay={detail.p} canLog={!!d?.toLog?.canLog} onClose={() => setDetail(null)} onDone={() => load(true)} />}
    </>
  );
  if (part) return <div className="acct-part" data-acct-part={part}>{body}{modals}</div>;
  return (
    <div className="acct-page">
      <div className="admin-head"><h2>Money</h2>{chip}{d?.readAt && <span className="home-src">Stripe and the {d.year} accounting sheet · read {clock(d.readAt)}</span>}
        {d?.sheetUrl && <ExtLink className="btn ghost sm acct-sheet-link" href={d.sheetUrl}>Open the sheet ↗</ExtLink>}</div>
      <div className="subnav" role="tablist" aria-label="Money">
        {secs.map(([k, l]) => <button key={k} role="tab" aria-selected={sec === k} data-acct-tab={k} className={sec === k ? "subpill active" : "subpill"} onClick={() => onSub(k === "overview" ? null : k)}>{l}</button>)}
      </div>
      {body}
      {modals}
    </div>
  );
}

// What's wrong first (one line: the year's gap, payments to log, rows to check), then the four balance
// tiles (the Money card's Accounting tab), then Stripe against the sheet by month with a This year row
const cents2 = (x) => Math.round(x * 100) / 100;
function AcctOverview({ d, onSec }) {
  const t = d.tiles, month = monthName(d.month), M = d.months;
  // a month with no rows yet says so, instead of "$0.00 in · $0.00 out" (list A 8)
  const monthEmpty = !t.monthRevenue && !t.monthExpenses;
  const stats = [["monthNet", `Net · ${month}`, monthEmpty ? "Nothing logged yet this month" : `${money(t.monthRevenue)} in · ${money(t.monthExpenses)} out`], ["yearNet", "Net this year"], ["checkingBalance", "Business Checking"], ["taxSetAside", "Tax set-aside (this quarter)"]];
  const latest = (d.payments?.items || []).slice(0, 5); // the newest payments, as records (Log it lives in To do and All payments)
  const yr = M && { stripe: cents2(M.reduce((a, m) => a + m.stripe, 0)), sheet: cents2(M.reduce((a, m) => a + m.sheet, 0)) };
  if (yr) yr.diff = cents2(yr.stripe - yr.sheet);
  const nLog = d.counts?.toLog || 0, nCheck = d.counts?.toCheck || 0;
  const partSum = (kind) => (M ? cents2(M.flatMap((m) => m.parts).filter((x) => x.kind === kind).reduce((a, x) => a + x.amount, 0)) : 0);
  const rounding = partSum("rounding");
  // co-managers' share of Stripe's fees (the Co-Management Cut): Stripe has it, the sheet books it on its Stripe
  // Fees tab, so "In the sheet" counts it (2026-11-11) and the months come out exact
  const covered = M ? cents2(M.reduce((a, m) => a + (m.covered || 0), 0)) : 0;
  const coveredText = covered ? `the sheet counts ${money(covered)} of co-managers' share of Stripe's fees (Stripe Fees tab)` : "";
  const checkRow = new Set((d.toCheck?.items || []).map((x) => x.row).filter(Boolean)); // rows with an open To check line
  const diffText = (v) => (v ? money(v).replace("$-", "-$") : "—");
  const clean = yr && !yr.diff && !nLog && !nCheck;
  const fold = foldMonths(M || [], { current: d.month });
  const [unfold, setUnfold] = useState(false); // the matching months' own rows, opened from the fold line
  const monthRow = (m) => (
    <div key={m.month} className="acct-mrow" role="row" data-month={m.month} data-explained={m.explained ? "1" : "0"}>
      <span role="cell" className="acct-mname">{m.label}</span>
      <span role="cell" className="acct-amt" data-col="stripe">{money(m.stripe)}</span>
      <span role="cell" className="acct-amt" data-col="sheet" title={m.covered ? `${money(cents2(m.sheet - m.covered))} on Income + ${money(m.covered)} co-managers' share of Stripe's fees (Stripe Fees tab)` : undefined}>{money(m.sheet)}</span>
      <span role="cell" className={m.diff ? "acct-amt acct-diff" : "acct-amt"} data-col="diff">{diffText(m.diff)}</span>
      <span role="cell" className="acct-why" data-col="why">
        {!m.diff && !m.parts.length ? <span className="acct-match"><CheckCircle2 size={14} /> Matches</span> : (
          <>{m.parts.map((x, i) => (
            <React.Fragment key={i}>{i ? " · " : ""}<span className={x.kind === "rounding" ? "acct-round" : undefined} data-part={x.kind}>{x.text}</span>
              {x.kind === "unlogged" && <> (<button className="inline-link" data-part-log onClick={() => onSec("log")}>log them</button>)</>}
              {(x.kind === "share" || x.kind === "extra") && x.url && <> (<ExtLink className="inline-link" href={x.url}>open row ↗</ExtLink>{checkRow.has(x.row) && <>, <button className="inline-link" onClick={() => onSec("check")}>see To check</button></>})</>}
            </React.Fragment>
          ))}
            {!m.explained && <>{m.parts.length ? " · " : ""}<span className="acct-unexplained">Not explained yet: {money(Math.abs(m.residual))} · <button className="inline-link" onClick={() => onSec("check")}>see To check</button></span></>}</>
        )}
      </span>
    </div>
  );
  return (
    <>
      {yr && (
        <p className={clean ? "acct-status ok" : "acct-status"} data-acct-status>
          {clean ? <><CheckCircle2 size={15} /> <span>Stripe and the sheet match for {d.year}{covered ? <span className="acct-round" data-status-covered> · {coveredText}</span> : null}.</span></> : (
            <><AlertTriangle size={15} /> <span>{yr.diff ? `${money(Math.abs(yr.diff))} apart for ${d.year}` : `Stripe and the sheet add up the same for ${d.year}`}
              {nLog > 0 && <>: {nLog === 1 ? "1 payment" : `${nLog} payments`} to log <span className="nobr">(<button className="inline-link" data-status-log onClick={() => onSec("log")}>log {nLog === 1 ? "it" : "them"}</button>)</span></>}
              {nCheck > 0 && <>{nLog ? " · " : ": "}{nCheck === 1 ? "1 row" : `${nCheck} rows`} to check <span className="nobr">(<button className="inline-link" data-status-check onClick={() => onSec("check")}>see why</button>)</span></>}
              {rounding ? <span className="acct-round">{nLog || nCheck ? " · " : ": "}{money(Math.abs(rounding))} is rounding</span> : null}
              {covered ? <span className="acct-round" data-status-covered>{nLog || nCheck || rounding ? " · " : ": "}{coveredText}</span> : null}.</span></>
          )}
        </p>
      )}
      <div className="cat-summary-grid acct-grid acct-tiles">
        {stats.map(([k, label, note]) => <div key={k} className="cat-stat" data-stat={k} data-empty={k === "monthNet" && monthEmpty ? "" : undefined}><span className="cat-stat-label">{label}</span><span className="cat-stat-val">{money(t[k])}</span>{note && <span className="acct-note">{note}</span>}</div>)}
      </div>
      <div className="fix-panel acct-panel" data-acct="months">
        <div className="fix-head"><h3>Stripe and the sheet, month by month</h3>
          <span className="hint">Defied's share: through Stripe, and in the sheet (the Income tab by each row's date, plus co-managers' share of Stripe's fees from the Stripe Fees tab).</span></div>
        {!M ? <p className="home-muted"><AlertTriangle size={15} /> Stripe couldn't be read just now, so the months can't be compared.</p> : (
          <div className="acct-mtable" role="table" aria-label="Stripe and the sheet by month">
            <div className="acct-mrow acct-mhead" role="row"><span role="columnheader">Month</span><span role="columnheader" className="acct-amt">Through Stripe</span><span role="columnheader" className="acct-amt">In the sheet</span><span role="columnheader" className="acct-amt">Difference</span><span role="columnheader">Why</span></div>
            {/* only the months that differ get a row; the ones that match fold into one line (r7), which opens
                their own rows in place (r8: rarely needed, so behind the line) */}
            {fold.differ.map(monthRow)}
            {fold.matched > 0 && (
              <div className="acct-mrow acct-mfold" role="row">
                <span role="cell" className="acct-match" data-folded={fold.matched}><CheckCircle2 size={14} /> {fold.text}</span>
                <button type="button" className="inline-link acct-unfold" data-unfold aria-expanded={unfold} onClick={() => setUnfold((x) => !x)}>{unfold ? "Hide them" : `Show ${fold.matched === 1 ? "it" : `the ${fold.matched}`}`}</button>
              </div>
            )}
            {fold.quiet.length > 0 && <div className="acct-mrow acct-mfold acct-mquiet" role="row" data-quiet={fold.quiet.join(",")}><span role="cell" className="acct-round">{fold.quiet.join(", ")}: nothing yet</span></div>}
            {unfold && fold.rows.map(monthRow)}
            <div className="acct-mrow acct-mtotal" role="row" data-total="year">
              <span role="cell" className="acct-mname">This year</span>
              <span role="cell" className="acct-amt" data-col="stripe">{money(yr.stripe)}</span>
              <span role="cell" className="acct-amt" data-col="sheet">{money(yr.sheet)}</span>
              <span role="cell" className={yr.diff ? "acct-amt acct-diff" : "acct-amt"} data-col="diff">{diffText(yr.diff)}</span>
              <span role="cell" className="acct-why" data-col="why">{!yr.diff ? <span className="acct-match"><CheckCircle2 size={14} /> Matches</span> : "The months above explain it."}</span>
            </div>
          </div>
        )}
      </div>
      {latest.length > 0 && (
        <div className="fix-panel acct-panel acct-latest" data-acct="latest">
          <div className="fix-head"><h3>Latest payments</h3>
            <button className="inline-link acct-all" data-acct-all onClick={() => onSec("payments")}>All payments ({fmt(d.payments.total)}) ›</button></div>
          {latest.map((p) => <PayRow key={p.id} p={p} />)}
        </div>
      )}
    </>
  );
}

// Every payment the sheet doesn't have: Log it (the dashboard places it) or Log with details (the
// owner picks the Revenue Type and Artist / Client: studio work, a payer not on INFO, a first payment;
// r11: in the same confirm as Log it, every field open to change)
function AcctToLog({ d, onLog, onPick }) {
  const U = d.toLog?.items;
  if (!U) return <p className="home-muted"><AlertTriangle size={15} /> Stripe couldn't be read just now, so the payments missing from the sheet can't be checked.</p>;
  if (!U.length) return <p className="home-muted acct-clear"><CheckCircle2 size={15} /> Every Stripe payment is in the accounting sheet.</p>;
  // Log all takes only the ones Log it can place; the rest wait for Log with details
  const easy = U.filter((p) => !p.needsDetails), need = U.length - easy.length;
  return (
    <div className="fix-panel acct-panel" data-acct="log">
      <div className="fix-head"><h3>To log ({U.length})</h3>
        <span className="hint">{d.toLog.canLog ? "Log it shows the row, then adds it to the Income tab. Log with details is for studio work or a payer not on INFO." : PREVIEW ? PREVIEW_OFF : "Logging from here isn't switched on yet. Add each one to the sheet as a new row with the full amount paid."}</span></div>
      <div className="fix-sub"><span className="fix-client">{money(d.toLog.total)} paid in total{need ? <span className="acct-via"> · {need} {need === 1 ? "needs" : "need"} details</span> : null}</span>
        {easy.length > 1 && <button className="btn sm" data-log-all onClick={() => onLog(easy.map((p) => p.id))}>Log all {easy.length}</button>}</div>
      {U.map((p) => (
        <div key={p.id} className="fix-row acct-lrow" data-pay={p.id}>
          <span className="fix-song"><span className="fix-who">{shortDay(p.at)} · </span>{p.client || p.payer || "Unknown payer"}{p.test && <> <TestChip /></>}<span className="acct-via"> · {viaText(p)}</span></span>
          <span className="fix-streams acct-paid">{money(p.amount)}</span>
          <span className="fix-acts">
            {/* Log it can't place this one (the server's own check): only Log with details, and why */}
            {p.needsDetails ? <span className="acct-need" data-needs-details={p.id} title={p.needsDetails}>Needs details</span>
              : <button className="btn sm" data-log={p.id} onClick={() => onLog([p.id])}>Log it</button>}
            <button className={p.needsDetails ? "btn sm" : "btn ghost sm"} data-log-details={p.id} onClick={() => onPick(p)}>Log with details</button>
          </span>
        </div>
      ))}
    </div>
  );
}

// To check: rows worth a look, each one sentence, Open row ↗ and Mark as OK (it comes back only if the row changes)
function AcctToCheck({ d, busy, err, onOk }) {
  const X = d.toCheck?.items || [];
  return (
    <div className="fix-panel acct-panel" data-acct="check">
      <div className="fix-head"><h3>{X.length ? `To check (${X.length})` : "To check"}</h3>
        <span className="hint">Read only. Fix it in the sheet, or mark it as OK.{d.toCheck?.okCount ? ` ${d.toCheck.okCount} marked as OK.` : ""}</span></div>
      {err && <p className="hint err-text">{err}</p>}
      {!X.length ? <p className="home-muted acct-clear"><CheckCircle2 size={15} /> Nothing to check in the Income tab.</p> : X.map((x) => (
        <div key={x.key} className="fix-row acct-crow" data-check={x.rule} data-row={x.row ?? ""}>
          <span className="fix-song acct-ctext"><span className="fix-who">{x.row ? `Row ${x.row} · ` : ""}</span>{x.text}</span>
          <span className="fix-acts">
            <ExtLink className="btn ghost sm" href={x.url}>{x.row ? "Open row ↗" : "Open the sheet ↗"}</ExtLink>
            <button className="quiet-act" data-ok={x.key} disabled={busy === x.key} onClick={() => onOk(x.key)}>{busy === x.key ? "Saving…" : "Mark as OK"}</button>
          </span>
        </div>
      ))}
    </div>
  );
}
