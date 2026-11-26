import { useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Field } from "./ui";
import { useIsPhone } from "../ui/responsive";
import { useAct, useEmpire } from "./empire-api";
import {
  amountOf, barOf, cutFromText, datesLine, dayText, dealForecast, dealLine, dueWords, estimateNote, forecastLines, lateNote, missingNote, netIncomeText, nextLine, pctText, plannedLine,
  quarterWords, scopeText, shareFromText, spentBar, spentRows, usd, usd0,
} from "./empire-data";

// Money › EMPIRE (2026-11-21, then the owner's "clean up the estimated money tab also start us at zero ... this shld be based on real"), for a Founder with Money access (GET
// /api/empire refuses everyone else). The publishing-administration deal with EMPIRE: how much of EMPIRE's advance is paid back (ONLY what EMPIRE's statements credited, so $0 until one is
// typed in; everything worked out from streams is folded under "Forecast"), the advance EMPIRE gave Defied to hand out (only money marked spent), each producer deal with what the
// statements have paid back of it, and the statements EMPIRE sends. The advance calculator is its own Money pill (components/dash/empire-calc.jsx).
// (2026-11-24, the owner: "this is still a bit complicated ... i wanna know like just the key information") It opens on three tiles (paid back, left to give out, next statement) and one line of
// dates; the two forms (Mark money spent, Add EMPIRE statement) are behind their buttons, the advance's received state is a small chip with its button. Only layout and words changed: every
// save below sends what it always sent, and asks what it always asked.
// The numbers and sentences come from lib/empire-deal.js through the API and components/dash/empire-data.js: this file holds none of the contract's terms (the page's code is public; the
// contract is confidential). A save never uses window.confirm (it blocks automation): a delete asks in the page.

// the page: its one read, then every part drawn from it. onPlan: the link in Producer deals to the Advance calculator pill
export function EmpireDeal({ onPlan = null }) {
  const { data, err, load, retry } = useEmpire();
  if (!data) {
    return err
      ? <p className="home-muted" role="alert" data-emp-error><AlertTriangle size={15} /> <span>{err} <button type="button" className="inline-link" onClick={retry}>Try again</button></span></p>
      : <p className="home-muted" data-emp-loading><RefreshCw size={15} className="spin" /> Loading…</p>;
  }
  return (
    <>
      {err && <p className="hint err-text" role="alert" data-emp-error>{err} <button type="button" className="inline-link" onClick={retry}>Try again</button></p>}
      <EmpireView data={data} reload={load} onPlan={onPlan} />
    </>
  );
}

export function EmpireView({ data, reload, init = null, onPlan = null }) {
  return (
    <div className="emp-page" data-empire>
      <RecoupCard data={data} reload={reload} init={init?.recoup} />
      <SpentCard data={data} reload={reload} init={init?.spent} />
      <DealsCard data={data} reload={reload} init={init?.deals} onPlan={onPlan} />
      <StatementsCard data={data} reload={reload} init={init?.statements} />
    </div>
  );
}

const Err = ({ text }) => (text ? <p className="hint err-text" role="alert" data-emp-err>{text}</p> : null);

// ---------------------------------------------------------------- the top: three tiles and one line, real money only
function RecoupCard({ data, reload, init }) {
  const { recoupment: r, pot, terms, nextDue } = data;
  const bar = barOf(r), pct = pctText(r.pct, 1), next = nextLine(nextDue), dates = datesLine({ terms, rec: r });
  return (
    <section className="emp-top" data-emp="recoup" aria-label="EMPIRE: how much is paid back">
      <div className="cat-summary emp-tiles" data-emp-tiles>
        <div className="cat-summary-grid">
          <div className="cat-stat" data-stat="paid">
            <span className="cat-stat-label">Paid back to EMPIRE</span>
            <span className="cat-stat-val" data-emp-credited title={usd(r.credited)}>{usd0(r.credited)}</span>
            <span className="adv-stat-sub" data-emp-of>{`of ${usd0(r.owed)}`}</span>
            <div className="emp-bar emp-bar-sm" role="img" aria-label={`${pct} paid back: ${usd0(r.credited)} of ${usd0(r.owed)}, from EMPIRE's statements`} data-emp-bar>
              <span className="emp-bar-solid" data-emp-solid style={{ width: `${bar.solid}%` }} />
            </div>
          </div>
          <div className="cat-stat" data-stat="left">
            <span className="cat-stat-label">Left to give out</span>
            {pot.over > 0
              ? <span className="cat-stat-val" data-emp-left data-over="" title={usd(pot.left)}>{`Over by ${usd0(pot.over)}`}</span>
              : <span className="cat-stat-val" data-emp-left title={usd(pot.left)}>{usd0(pot.left)}</span>}
            <span className="adv-stat-sub">{`of the ${usd0(pot.total)}`}</span>
          </div>
          <div className="cat-stat" data-stat="next">
            <span className="cat-stat-label">Next EMPIRE statement</span>
            <span className="cat-stat-val" data-emp-next>{next.big}</span>
            <span className="adv-stat-sub">{next.sub}</span>
          </div>
        </div>
      </div>
      {/* where the timeline was: the last day to be paid back and the day Defied can buy out (dates from the terms; nothing projected). (2026-11-25 declutter) "Defied gets paid once
          EMPIRE is paid back" is gone; the line says it only once it's true (a full bar, from statements) */}
      <p className="emp-dates" data-emp-dates>
        <span data-emp-dates-payby title={dates.payBy.title}>Pay back by <b>{dates.payBy.text}</b></span>
        <i className="emp-dates-dot" aria-hidden="true">·</i>
        <span data-emp-dates-buyout title={dates.buyout.title}>Buyout from <b>{dates.buyout.text}</b></span>
        {r.recouped && <><i className="emp-dates-dot" aria-hidden="true">·</i>
          <span data-emp-dates-paid>{dates.paid}</span></>}
      </p>
      <ForecastBox data={data} reload={reload} init={init} />
    </section>
  );
}

// everything made from streams, folded away: what today's pace would add, whether the songs ever reach the total, the extra advance, the buyout, and how the estimate counts Net Income
function ForecastBox({ data, reload, init }) {
  const { recoupment: r, terms } = data;
  const lines = forecastLines(r, terms);
  return (
    <details className="emp-fc" data-emp="fc">
      <summary>Forecast</summary>
      <div className="emp-fc-body">
        {lines.length > 0 && <ul className="emp-fc-list" data-emp-fc-lines>{lines.map(([id, text]) => <li key={id} data-emp-fc={id}>{text}</li>)}</ul>}
        <NetIncomeBox data={data} reload={reload} init={init} />
      </div>
    </details>
  );
}

// the share of whole-song publishing counted as Net Income: the standard, and a Founder's own
function NetIncomeBox({ data, reload, init }) {
  const { levers, terms, recoupment: r, streamsOn } = data;
  const [text, setText] = useState(() => init?.text ?? (levers?.ok ? String(Math.round(levers.niShare * 1000) / 10) : ""));
  const { busy, err, act } = useAct(reload);
  if (!levers?.ok) return null;
  const share = shareFromText(text);
  const save = (reset) => act({ action: "setLevers", niShare: reset ? null : share }, () => reset && setText(String(Math.round(levers.niStandard * 1000) / 10)));
  return (
    <details className="emp-how" data-emp="levers">
      <summary>How the estimate counts Net Income</summary>
      <div className="emp-how-body">
        <p data-emp-estimate>{estimateNote(r, streamsOn)} {missingNote(r)} {lateNote(terms)}</p>
        {/* (2026-11-25) what Net Income counts follows the saved share: mechanicals only at 60% or under (empire-data.js netIncomeText) */}
        <p>{netIncomeText(levers, terms)}</p>
        <div className="emp-inline">
          <label className="fld"><span>Share counted as Net Income (%)</span>
            <input inputMode="decimal" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} aria-invalid={share == null ? "true" : "false"} data-f="niShare" /></label>
          <button type="button" className="btn sm" data-emp-save-levers onClick={() => save(false)} disabled={busy || share == null}>{busy ? "Saving…" : "Save"}</button>
          {levers.niShareSet && <button type="button" className="btn ghost sm" data-emp-reset-levers onClick={() => save(true)} disabled={busy}>Use the standard</button>}
        </div>
        {share == null && <p className="hint err-text">Type a percent, like {Math.round(levers.niStandard * 1000) / 10}.</p>}
        <Err text={err} />
      </div>
    </details>
  );
}

// ---------------------------------------------------------------- the advance EMPIRE gave Defied: what is spent (the second tile says what is left)
function SpentCard({ data, reload, init }) {
  const { pot, terms, today, deals, spends = [], producers } = data;
  const bar = spentBar(pot), rows = spentRows({ deals, spends, producers }), planned = plannedLine(pot);
  const pct = pctText(pot.pct, 1);
  const [open, setOpen] = useState(init?.open ?? false); // the Mark money spent form: there after its button is pressed
  const [f, setF] = useState(() => init?.form ?? { amount: "", what: "", on: today });
  const [ask, setAsk] = useState(init?.ask ?? null); // the entry whose Delete is being asked about
  const { busy, err, act } = useAct(reload);
  const phone = useIsPhone(); // (2026-11-25, mobile) a phone's "What for" box is narrower than the example: a shorter one there, the same on desktop
  const ok = amountOf(f.amount) != null && f.what.trim() !== "" && !!f.on;
  const add = () => act({ action: "addSpend", amount: f.amount, what: f.what, on: f.on }, () => { setF({ amount: "", what: "", on: today }); setOpen(false); });
  return (
    <section className="emp-card" data-emp="spent" aria-label="The advance EMPIRE gave Defied: what is spent">
      <div className="emp-head"><h3 className="emp-h">The {usd0(pot.total)} advance</h3><span className="emp-src" data-emp-spent title={usd(pot.spent)}>{usd0(pot.spent)} spent</span></div>
      <div className="emp-bar emp-bar-sm" role="img" aria-label={`${pct} spent: ${usd0(pot.spent)} of ${usd0(pot.total)}${pot.over > 0 ? `, over by ${usd0(pot.over)}` : ""}`} data-emp-spent-bar>
        <span className="emp-bar-solid" data-emp-spent-solid style={{ width: `${bar.solid}%` }} />
      </div>
      <ReceivedRow pot={pot} today={today} terms={terms} reload={reload} />
      {planned && <p className="emp-planned" data-emp-planned>{planned}</p>}

      <h4 className="emp-list-h">Spent</h4>
      {rows.length === 0 ? <p className="emp-empty" data-emp-no-spent>Nothing spent yet.</p> : (
        <ul className="emp-list emp-spent" data-emp-spent-list>
          {rows.map((x) => (
            <li key={x.key} data-spent={x.key} data-kind={x.kind}>
              <span className="emp-list-main"><em>{x.on ? dayText(x.on) : ""}</em>{x.on ? " · " : ""}{x.what}</span>
              <b className="emp-spent-amt">{usd(x.amount)}</b>
              {x.kind === "advance" ? <span className="emp-list-by">a producer deal</span>
                : ask === x.id
                  ? <span className="emp-confirm emp-confirm-row" role="alertdialog" aria-label={`Delete ${x.what}?`} data-emp-confirm="spend">
                      <span>Delete this entry? It leaves the {usd0(pot.total)} bar.</span>
                      <span className="emp-confirm-acts">
                        <button type="button" className="btn sm emp-danger" data-emp-yes-delete onClick={() => act({ action: "deleteSpend", id: x.id }, () => setAsk(null))} disabled={busy}>Yes, delete it</button>
                        <button type="button" className="btn ghost sm" data-emp-keep onClick={() => setAsk(null)} disabled={busy}>Keep it</button>
                      </span>
                    </span>
                  : <button type="button" className="quiet-act" data-emp-delete-spend={x.id} onClick={() => setAsk(x.id)} disabled={busy}>Delete</button>}
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <>
          <p className="emp-form-title" data-emp-spend-title>Mark money spent</p>
          <div className="emp-spend-form" data-emp-spend-form>
            <Field label="Amount ($)" inputMode="decimal" autoComplete="off" placeholder="2,500" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} data-f="spendAmount" />
            <Field label="What for" maxLength={120} autoComplete="off" placeholder={phone ? "Like: mix for a single" : "Short, like: mix for a producer's single"} value={f.what} onChange={(e) => setF({ ...f, what: e.target.value })} data-f="spendWhat" />
            <label className="fld emp-day"><span>Date</span><input type="date" min={terms.effective} max={today} value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} data-f="spendOn" /></label>
            <span className="emp-form-acts">
              <button type="button" className="btn sm emp-form-go" data-emp-add-spend onClick={add} disabled={busy || !ok}>{busy ? "Adding…" : "Add"}</button>
              <button type="button" className="btn ghost sm" data-emp-cancel-spend onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            </span>
          </div>
        </>
      ) : <button type="button" className="btn ghost sm emp-open" data-emp-open-spend onClick={() => setOpen(true)}>Mark money spent</button>}
      <Err text={err} />
    </section>
  );
}

// one small chip: has the advance reached the bank (and the day), with its one button
function ReceivedRow({ pot, today, terms, reload, init }) {
  const [day, setDay] = useState(init?.day ?? today);
  const { busy, err, act } = useAct(reload);
  return (
    <div className="emp-received" data-emp="received">
      {pot.received.on ? (
        <>
          <span className="emp-chip" data-state="yes" data-emp-received-chip><CheckCircle2 size={14} aria-hidden="true" /> {`Received${pot.received.at ? ` ${dayText(pot.received.at)}` : ""}`}</span>
          <button type="button" className="quiet-act" data-emp-unreceive onClick={() => act({ action: "setReceived", on: false })} disabled={busy}>Not received after all</button>
        </>
      ) : (
        <>
          <span className="emp-chip" data-state="no" data-emp-received-chip>Not received yet</span>
          <label className="fld emp-day"><span>Arrived on</span><input type="date" min={terms.effective} max={today} value={day} onChange={(e) => setDay(e.target.value)} data-f="receivedOn" /></label>
          <button type="button" className="btn ghost sm" data-emp-receive onClick={() => act({ action: "setReceived", on: true, at: day })} disabled={busy || !day}>{busy ? "Saving…" : "Mark as received"}</button>
        </>
      )}
      <Err text={err} />
    </div>
  );
}

// ---------------------------------------------------------------- producer deals
function DealsCard({ data, reload, init, onPlan = null }) {
  const { deals, producers } = data;
  const names = new Map(producers.map((p) => [p.id, p.name]));
  return (
    <section className="emp-card" data-emp="deals" aria-label="Producer deals">
      <div className="emp-head"><h3 className="emp-h">Producer deals</h3>{deals.length > 0 && <span className="emp-src">{`${deals.length} ${deals.length === 1 ? "deal" : "deals"}`}</span>}</div>
      {deals.length === 0
        ? <p className="emp-empty" data-emp-no-deals>No producer deals yet.{onPlan && <> <button type="button" className="inline-link" data-emp-plan onClick={onPlan}>Plan one in Advance calculator →</button></>}</p>
        : (
          <>
            {onPlan && <p className="emp-sub" data-emp-plan-line><button type="button" className="inline-link" data-emp-plan onClick={onPlan}>Plan a new one in Advance calculator →</button></p>}
            <div className="emp-deals">{deals.map((d) => <DealRow key={d.id} deal={d} who={names.get(d.clientId)} data={data} reload={reload} init={init?.[d.id]} />)}</div>
          </>
        )}
    </section>
  );
}

function DealRow({ deal, who, data, reload, init }) {
  const { terms, today } = data;
  const given = deal.status === "given";
  const [mode, setMode] = useState(init?.mode ?? null); // null | "edit" | "given" | "delete"
  const [f, setF] = useState(() => init?.form ?? { advance: String(deal.advance), cut: String(Math.round(deal.cut * 10000) / 100), note: deal.note || "", day: deal.givenOn || today });
  const { busy, err, act, clear } = useAct(reload);
  const r = deal.recoup || {};
  const name = deal.clientId ? who || "A producer (not on Schedule A now)" : deal.prospectName || "A prospect";
  const cut = cutFromText(f.cut), advance = Number(String(f.advance).replace(/[$,\s]/g, ""));
  const okEdit = cut != null && Number.isFinite(advance) && advance > 0 && (!given || !!f.day);
  const close = () => { setMode(null); clear(); };
  const save = () => act({ action: "saveDeal", id: deal.id, advance: f.advance, cut, note: f.note, ...(given ? { givenOn: f.day } : {}) }, close);
  const pct = given && r.pct != null ? Math.round(r.pct * 1000) / 10 : 0;
  const line = dealLine(deal), forecast = dealForecast(deal);
  return (
    <article className="emp-deal" data-deal={deal.id} data-status={deal.status}>
      <header className="emp-deal-head">
        <strong className="emp-deal-name">{name}</strong>
        <span className="emp-pill" data-tone={given ? "pos" : "neutral"} data-emp-status>{given ? `Given ${dayText(deal.givenOn)}` : "Planned"}</span>
      </header>
      <p className="emp-deal-what" data-emp-scope>{scopeText(deal)}</p>
      <p className="emp-deal-nums"><b data-emp-advance>{usd(deal.advance)}</b> advance · Defied's cut <b data-emp-cut>{pctText(deal.cut, 2)}</b></p>
      {given && r.pct != null && (
        <div className="emp-bar emp-bar-sm" role="img" aria-label={`${pctText(r.pct, 0)} of the advance paid back, from EMPIRE's statements`} data-emp-deal-bar>
          <span className="emp-bar-solid" style={{ width: `${pct}%` }} />
        </div>
      )}
      {line && <p className="emp-deal-line" data-emp-deal-line>{line}</p>}
      {forecast && <p className="emp-deal-sub" data-emp-deal-forecast>{forecast}</p>}
      {deal.note && <p className="emp-deal-note" data-emp-note>{deal.note}</p>}
      <Err text={err} />
      {mode === "delete" && (
        <div className="emp-confirm" role="alertdialog" aria-label="Delete this deal?" data-emp-confirm="deal">
          <span>Delete this deal? It goes for everyone and its advance leaves the totals above.</span>
          <span className="emp-confirm-acts">
            <button type="button" className="btn sm emp-danger" data-emp-yes-delete onClick={() => act({ action: "deleteDeal", id: deal.id })} disabled={busy}>{busy ? "Deleting…" : "Yes, delete it"}</button>
            <button type="button" className="btn ghost sm" data-emp-keep onClick={close} disabled={busy}>Keep it</button>
          </span>
        </div>
      )}
      {mode === "given" && (
        <div className="emp-inline" data-emp-given-form>
          <label className="fld emp-day"><span>Given on</span><input type="date" min={terms.effective} max={today} value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} data-f="givenOn" /></label>
          <button type="button" className="btn sm" data-emp-confirm-given onClick={() => act({ action: "setDealStatus", id: deal.id, status: "given", givenOn: f.day }, close)} disabled={busy || !f.day}>{busy ? "Saving…" : "Mark as given"}</button>
          <button type="button" className="btn ghost sm" onClick={close} disabled={busy}>Cancel</button>
        </div>
      )}
      {mode === "edit" && (
        <div className="emp-edit" data-emp-edit>
          <Field label="Advance ($)" inputMode="decimal" autoComplete="off" value={f.advance} onChange={(e) => setF({ ...f, advance: e.target.value })} data-f="advance" />
          <Field label="Defied's cut (%)" inputMode="decimal" autoComplete="off" value={f.cut} onChange={(e) => setF({ ...f, cut: e.target.value })} data-f="cut" hint={cut == null ? "Type a percent from 0 to 99.99." : undefined} />
          {given && <label className="fld emp-day"><span>Given on</span><input type="date" min={terms.effective} max={today} value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} data-f="givenOn" /></label>}
          <Field label="Note" value={f.note} maxLength={500} onChange={(e) => setF({ ...f, note: e.target.value })} data-f="note" />
          <div className="emp-edit-acts">
            <button type="button" className="btn sm" data-emp-save-deal onClick={save} disabled={busy || !okEdit}>{busy ? "Saving…" : "Save changes"}</button>
            <button type="button" className="btn ghost sm" onClick={close} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}
      {mode === null && (
        <div className="emp-deal-acts">
          {given
            ? <button type="button" className="btn ghost sm" data-emp-unmark onClick={() => act({ action: "setDealStatus", id: deal.id, status: "planned" })} disabled={busy}>Back to planned</button>
            : <button type="button" className="btn sm" data-emp-mark onClick={() => { clear(); setMode("given"); }} disabled={busy}>Mark as given</button>}
          <button type="button" className="btn ghost sm" data-emp-edit onClick={() => { clear(); setMode("edit"); }} disabled={busy}>Edit</button>
          <button type="button" className="quiet-act" data-emp-delete onClick={() => { clear(); setMode("delete"); }} disabled={busy}>Delete</button>
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------- statements
function StatementsCard({ data, reload, init }) {
  const { statements, quarters, nextDue, terms, today } = data;
  const open = quarters.filter((q) => q.over && !q.statement);
  const [formOpen, setFormOpen] = useState(init?.open ?? false); // the add form: there after Add EMPIRE statement is pressed
  const [f, setF] = useState(() => init?.form ?? { quarter: "", ni: "", credited: "" });
  const [ask, setAsk] = useState(init?.ask ?? null); // the quarter whose Delete is being asked about
  const { busy, err, act } = useAct(reload);
  const quarter = f.quarter || open[0]?.id || "";
  const chosen = open.find((q) => q.id === quarter);
  const ni = Number(String(f.ni).replace(/[$,\s]/g, "")), credited = Number(String(f.credited).replace(/[$,\s]/g, ""));
  const ok = !!quarter && f.ni !== "" && f.credited !== "" && Number.isFinite(ni) && ni >= 0 && Number.isFinite(credited) && credited >= 0;
  const usual = Math.round(ni * terms.payout * 100) / 100;
  const add = () => act({ action: "addStatement", quarter, netIncome: f.ni, credited: f.credited }, () => { setF({ quarter: "", ni: "", credited: "" }); setFormOpen(false); });
  return (
    <section className="emp-card" data-emp="statements" aria-label="EMPIRE statements">
      <div className="emp-head"><h3 className="emp-h">Statements from EMPIRE</h3>{nextDue && <span className="emp-src" data-emp-next-due>{nextDue.over ? `${nextDue.id} statement ${dueWords(nextDue)}` : `${nextDue.id} ends ${dayText(nextDue.end)}, statement ${dueWords(nextDue)}`}</span>}</div>
      {open.length === 0 ? <p className="emp-empty" data-emp-no-open>No finished quarter is waiting for a statement.</p> : formOpen ? (
        <div className="emp-form" data-emp-statement-form>
          <label className="fld"><span>Quarter</span>
            <select value={quarter} onChange={(e) => setF({ ...f, quarter: e.target.value })} data-f="quarter">
              {open.map((q) => <option key={q.id} value={q.id}>{quarterWords(q)}</option>)}
            </select>
            {chosen && <span className="hint" data-emp-due>Its statement is {dueWords(chosen)}.</span>}</label>
          <Field label="Net Income ($)" inputMode="decimal" autoComplete="off" placeholder="what EMPIRE received" value={f.ni} onChange={(e) => setF({ ...f, ni: e.target.value })} data-f="netIncome" />
          <Field label="Credited to Defied ($)" inputMode="decimal" autoComplete="off" placeholder="what it credited" value={f.credited} onChange={(e) => setF({ ...f, credited: e.target.value })} data-f="credited"
            hint={ni > 0 ? <>Usually {pctText(terms.payout, 0)} of Net Income: {usd(usual)}. <button type="button" className="inline-link" data-emp-fill onClick={() => setF({ ...f, credited: String(usual) })}>Use that</button></> : undefined} />
          <span className="emp-form-acts">
            <button type="button" className="btn sm emp-form-go" data-emp-add-statement onClick={add} disabled={busy || !ok}>{busy ? "Adding…" : "Add statement"}</button>
            <button type="button" className="btn ghost sm" data-emp-cancel-statement onClick={() => setFormOpen(false)} disabled={busy}>Cancel</button>
          </span>
        </div>
      ) : <button type="button" className="btn ghost sm emp-open" data-emp-open-statement onClick={() => setFormOpen(true)}>Add EMPIRE statement</button>}
      <Err text={err} />
      {statements.length > 0 && (
        <ul className="emp-list" data-emp-statements>
          {statements.map((s) => (
            <li key={s.quarter} data-statement={s.quarter}>
              <span className="emp-list-main"><b>{s.quarter}</b> <em>through {dayText(s.end)}</em></span>
              <span className="emp-list-nums">Net Income <b>{usd(s.netIncome)}</b> · credited to Defied <b>{usd(s.credited)}</b></span>
              <span className="emp-list-by">{s.enteredBy ? `typed in by ${s.enteredBy}` : ""}</span>
              {ask === s.quarter
                ? <span className="emp-confirm emp-confirm-row" role="alertdialog" aria-label={`Delete the ${s.quarter} statement?`} data-emp-confirm="statement">
                    <span>Delete the {s.quarter} statement? The bar drops what it credited.</span>
                    <span className="emp-confirm-acts">
                      <button type="button" className="btn sm emp-danger" data-emp-yes-delete onClick={() => act({ action: "deleteStatement", quarter: s.quarter }, () => setAsk(null))} disabled={busy}>Yes, delete it</button>
                      <button type="button" className="btn ghost sm" data-emp-keep onClick={() => setAsk(null)} disabled={busy}>Keep it</button>
                    </span>
                  </span>
                : <button type="button" className="quiet-act" data-emp-delete-statement={s.quarter} onClick={() => setAsk(s.quarter)} disabled={busy}>Delete</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export { RecoupCard, ForecastBox, SpentCard, DealsCard, DealRow, StatementsCard, NetIncomeBox, ReceivedRow };
