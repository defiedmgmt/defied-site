import { useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Field } from "./ui";
import { useAct, useEmpire } from "./empire-api";
import { EmpireCalc, SheetForecast } from "./empire-calc";
import {
  barOf, buyoutText, cutFromText, dayText, dealLine, dueWords, estimateNote, lateNote, meaningText, pctText, potBar,
  projectionText, quarterWords, scopeText, shareFromText, timelineOf, usd, usd0,
} from "./empire-data";

// Money › EMPIRE deal (2026-11-21), for an account with Money access (GET /api/empire refuses everyone else). The publishing-administration deal with EMPIRE: how much of
// EMPIRE's advance is paid back and when (the bar), the pot Defied gives its own producers advances out of, each producer deal with its own payback, the statements
// EMPIRE sends, and the advance calculator (moved here from Clients; components/dash/empire-calc.jsx). The numbers and sentences come from lib/empire-deal.js through the
// API and components/dash/empire-data.js: this file holds none of the contract's terms (the page's code is public; the contract is confidential).
// A save never uses window.confirm (it blocks automation): a delete asks in the page.

// the page: its one read, then every part drawn from it
export function EmpireDeal({ db = null }) {
  const { data, err, load, retry } = useEmpire();
  if (!data) {
    return err
      ? <p className="home-muted" role="alert" data-emp-error><AlertTriangle size={15} /> <span>{err} <button type="button" className="inline-link" onClick={retry}>Try again</button></span></p>
      : <p className="home-muted" data-emp-loading><RefreshCw size={15} className="spin" /> Loading…</p>;
  }
  return (
    <>
      {err && <p className="hint err-text" role="alert" data-emp-error>{err} <button type="button" className="inline-link" onClick={retry}>Try again</button></p>}
      <EmpireView data={data} reload={load} db={db} />
    </>
  );
}

export function EmpireView({ data, reload, db = null, init = null }) {
  return (
    <div className="emp-page" data-empire>
      <RecoupCard data={data} reload={reload} />
      <PotCard data={data} reload={reload} />
      <DealsCard data={data} reload={reload} init={init?.deals} />
      <StatementsCard data={data} reload={reload} init={init?.statements} />
      <EmpireCalc data={data} reload={reload} init={init?.calc} />
      <SheetForecast db={db} />
    </div>
  );
}

const Err = ({ text }) => (text ? <p className="hint err-text" role="alert" data-emp-err>{text}</p> : null);

// ---------------------------------------------------------------- the bar
function RecoupCard({ data, reload }) {
  const { recoupment: r, terms, levers, today } = data;
  const bar = barOf(r), line = timelineOf({ terms, rec: r, today });
  const asOf = data.streamsOn ? `Streams as of ${dayText(data.streamsOn)}` : "";
  return (
    <section className="emp-card emp-hero" data-emp="recoup" aria-label="EMPIRE: how much is paid back">
      <div className="emp-head"><h3 className="emp-h">EMPIRE deal</h3>{asOf && <span className="emp-src">{asOf}</span>}</div>
      <div className="emp-big">
        <span className="emp-big-n" data-emp-credited title={usd(r.credited)}>{usd0(r.credited)}</span>
        <span className="emp-big-of">of {usd0(r.owed)} paid back</span>
        <span className="emp-chip" data-emp-pct>{pctText(r.pct, 1)}</span>
        <span className="emp-left" data-emp-left>{usd0(r.remaining)} to go</span>
      </div>
      <div className="emp-bar" role="img" aria-label={`${pctText(r.pct, 1)} paid back: ${usd0(r.fromStatements)} from statements, ${usd0(r.estimated)} estimated`} data-emp-bar>
        <span className="emp-bar-solid" data-emp-solid style={{ width: `${bar.solid}%` }} />
        <span className="emp-bar-est" data-emp-striped style={{ width: `${bar.striped}%` }} />
      </div>
      <ul className="emp-legend" data-emp-legend>
        <li><i className="emp-sw emp-sw-solid" aria-hidden="true" /> From statements <b>{usd0(r.fromStatements)}</b></li>
        <li><i className="emp-sw emp-sw-est" aria-hidden="true" /> Estimated <b>{usd0(r.estimated)}</b></li>
      </ul>
      {/* the timeline: today, the day it's paid back at today's pace, the last day for EMPIRE's extra advance and the day Defied can buy out */}
      <div className="emp-line" data-emp-timeline aria-hidden="true">
        <span className="emp-line-done" style={{ width: `${line.todayAt}%` }} />
        {line.marks.map((m) => <i key={m.id} className="emp-tick" data-mark={m.id} data-tone={m.tone} style={{ left: `${m.at}%` }} />)}
      </div>
      <ul className="emp-marks" data-emp-marks>
        {line.marks.map((m) => <li key={m.id} data-mark={m.id} data-tone={m.tone}><i className="emp-dot" aria-hidden="true" /><span><b>{m.text}</b> {m.label}</span></li>)}
      </ul>
      <p className="emp-proj" data-emp-projection role="status">{projectionText(r)}</p>
      <p className="emp-mean" data-emp-meaning>{meaningText(r, terms)}</p>
      <p className="hint" data-emp-estimate>{estimateNote(r)}{r.missing?.length > 0 && <> No statement is typed in for {r.missing.join(", ")}, so {r.missing.length === 1 ? "it is" : "they are"} estimated too.</>} {lateNote(terms)}</p>
      <p className="hint" data-emp-buyout>{buyoutText(r, terms)}</p>
      {!levers?.ok && <p className="hint err-text" role="note" data-emp-levers-off>Couldn't read the pub sheet's rates just now, so the estimate and the projection are paused. Statements still count.</p>}
      <NetIncomeBox data={data} reload={reload} />
    </section>
  );
}

// the share of whole-song publishing counted as Net Income: the standard, and a Founder's own
function NetIncomeBox({ data, reload, init }) {
  const { levers } = data;
  const [text, setText] = useState(() => init?.text ?? (levers?.ok ? String(Math.round(levers.niShare * 1000) / 10) : ""));
  const { busy, err, act } = useAct(reload);
  if (!levers?.ok) return null;
  const share = shareFromText(text);
  const save = (reset) => act({ action: "setLevers", niShare: reset ? null : share }, () => reset && setText(String(Math.round(levers.niStandard * 1000) / 10)));
  return (
    <details className="emp-how" data-emp="levers">
      <summary>How the estimate counts Net Income</summary>
      <div className="emp-how-body">
        <p>Net Income is what EMPIRE actually receives: the mechanicals and the publisher's half of performance. The pub sheet's rate a stream (${+levers.blendedRate.toFixed(6)}) is for the whole song, writer and publisher, so the estimate counts {pctText(levers.niShare, 1)} of it{levers.niShareSet ? <>, a share a Founder set (the standard guess is {pctText(levers.niStandard, 1)})</> : <>, the standard guess</>}. The writer's own performance share isn't Net Income: it goes straight to Defied.</p>
        <div className="emp-inline">
          <label className="fld"><span>Share counted as Net Income (%)</span>
            <input inputMode="decimal" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} aria-invalid={share == null ? "true" : "false"} data-f="niShare" /></label>
          <button type="button" className="btn sm" data-emp-save-levers onClick={() => save(false)} disabled={busy || share == null}>{busy ? "Saving…" : "Save"}</button>
          {levers.niShareSet && <button type="button" className="btn ghost sm" data-emp-reset-levers onClick={() => save(true)} disabled={busy}>Use the standard</button>}
        </div>
        {share == null && <p className="hint err-text">Type a percent, like 75.</p>}
        <Err text={err} />
      </div>
    </details>
  );
}

// ---------------------------------------------------------------- the $75,000
function PotCard({ data, reload }) {
  const { pot, terms, today } = data;
  const bar = potBar(pot);
  return (
    <section className="emp-card" data-emp="pot" aria-label="The advance Defied gives producers from">
      <div className="emp-head"><h3 className="emp-h">The {usd0(pot.total)} for producers</h3></div>
      <p className="emp-sub">What EMPIRE advanced Defied, which Defied hands out to its own producers as advances (not the {usd0(terms.legal)} that went to the lawyer).</p>
      <div className="emp-bar emp-pot" role="img" aria-label={`${usd0(pot.given)} given, ${usd0(pot.planned)} planned, ${usd0(pot.left)} left`} data-emp-pot-bar>
        <span className="emp-seg emp-seg-given" data-seg="given" style={{ width: `${bar.given}%` }} />
        <span className="emp-seg emp-seg-planned" data-seg="planned" style={{ width: `${bar.planned}%` }} />
      </div>
      <ul className="emp-legend" data-emp-pot-legend>
        <li><i className="emp-sw emp-sw-given" aria-hidden="true" /> Given to producers <b data-pot="given">{usd0(pot.given)}</b> <em>({pot.givenCount})</em></li>
        <li><i className="emp-sw emp-sw-planned" aria-hidden="true" /> Planned <b data-pot="planned">{usd0(pot.planned)}</b> <em>({pot.plannedCount})</em></li>
        <li><i className="emp-sw emp-sw-left" aria-hidden="true" /> Left <b data-pot="left" data-over={pot.over > 0 ? "" : undefined}>{usd0(pot.left)}</b></li>
      </ul>
      {pot.over > 0 && <p className="hint err-text" role="note" data-emp-pot-over>More is promised than the {usd0(pot.total)}: {usd0(pot.over)} over.</p>}
      <ReceivedRow pot={pot} today={today} terms={terms} reload={reload} />
    </section>
  );
}

function ReceivedRow({ pot, today, terms, reload, init }) {
  const [day, setDay] = useState(init?.day ?? today);
  const { busy, err, act } = useAct(reload);
  return (
    <div className="emp-received" data-emp="received">
      {pot.received.on ? (
        <>
          <span className="emp-yes"><CheckCircle2 size={15} aria-hidden="true" /> Received from EMPIRE{pot.received.at ? ` on ${dayText(pot.received.at)}` : ""}</span>
          <button type="button" className="quiet-act" data-emp-unreceive onClick={() => act({ action: "setReceived", on: false })} disabled={busy}>Not received after all</button>
        </>
      ) : (
        <>
          <span className="emp-no">Not received yet: it has to be paid after the deal is signed and the songs are delivered.</span>
          <label className="fld emp-day"><span>Arrived on</span><input type="date" min={terms.effective} max={today} value={day} onChange={(e) => setDay(e.target.value)} data-f="receivedOn" /></label>
          <button type="button" className="btn ghost sm" data-emp-receive onClick={() => act({ action: "setReceived", on: true, at: day })} disabled={busy || !day}>{busy ? "Saving…" : "Mark as received"}</button>
        </>
      )}
      <Err text={err} />
    </div>
  );
}

// ---------------------------------------------------------------- producer deals
function DealsCard({ data, reload, init }) {
  const { deals, producers } = data;
  const names = new Map(producers.map((p) => [p.id, p.name]));
  return (
    <section className="emp-card" data-emp="deals" aria-label="Producer deals">
      <div className="emp-head"><h3 className="emp-h">Producer deals</h3><span className="emp-src">{deals.length === 0 ? "none yet" : `${deals.length} ${deals.length === 1 ? "deal" : "deals"}`}</span></div>
      <p className="emp-sub">An advance to one of our producers, for a single song or a whole catalog, paid back from that producer's royalties. Plan one below with the calculator, then mark it given when the money goes out.</p>
      {deals.length === 0
        ? <p className="emp-empty" data-emp-no-deals>No producer deals yet. Work one out in the calculator below and save it as a planned deal.</p>
        : <div className="emp-deals">{deals.map((d) => <DealRow key={d.id} deal={d} who={names.get(d.clientId)} data={data} reload={reload} init={init?.[d.id]} />)}</div>}
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
  return (
    <article className="emp-deal" data-deal={deal.id} data-status={deal.status}>
      <header className="emp-deal-head">
        <strong className="emp-deal-name">{name}</strong>
        <span className="emp-pill" data-tone={given ? "pos" : "neutral"} data-emp-status>{given ? `Given ${dayText(deal.givenOn)}` : "Planned"}</span>
      </header>
      <p className="emp-deal-what" data-emp-scope>{scopeText(deal)}</p>
      <p className="emp-deal-nums"><b data-emp-advance>{usd(deal.advance)}</b> advance · Defied's cut <b data-emp-cut>{pctText(deal.cut, 2)}</b></p>
      {given && r.pct != null && (
        <div className="emp-bar emp-bar-sm" role="img" aria-label={`${pctText(r.pct, 0)} of the advance paid back`} data-emp-deal-bar>
          <span className="emp-bar-solid" style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="emp-deal-line" data-emp-deal-line>{dealLine(deal)}</p>
      {deal.note && <p className="emp-deal-note" data-emp-note>{deal.note}</p>}
      <Err text={err} />
      {mode === "delete" && (
        <div className="emp-confirm" role="alertdialog" aria-label="Delete this deal?" data-emp-confirm="deal">
          <span>Delete this deal? It goes for everyone and its advance leaves the pot's totals.</span>
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
  const [f, setF] = useState(() => init?.form ?? { quarter: "", ni: "", credited: "" });
  const [ask, setAsk] = useState(init?.ask ?? null); // the quarter whose Delete is being asked about
  const { busy, err, act } = useAct(reload);
  const quarter = f.quarter || open[0]?.id || "";
  const chosen = open.find((q) => q.id === quarter);
  const ni = Number(String(f.ni).replace(/[$,\s]/g, "")), credited = Number(String(f.credited).replace(/[$,\s]/g, ""));
  const ok = !!quarter && f.ni !== "" && f.credited !== "" && Number.isFinite(ni) && ni >= 0 && Number.isFinite(credited) && credited >= 0;
  const usual = Math.round(ni * terms.payout * 100) / 100;
  const add = () => act({ action: "addStatement", quarter, netIncome: f.ni, credited: f.credited }, () => setF({ quarter: "", ni: "", credited: "" }));
  return (
    <section className="emp-card" data-emp="statements" aria-label="EMPIRE statements">
      <div className="emp-head"><h3 className="emp-h">Statements from EMPIRE</h3>{nextDue && <span className="emp-src" data-emp-next-due>{nextDue.over ? `${nextDue.id} statement ${dueWords(nextDue)}` : `${nextDue.id} ends ${dayText(nextDue.end)}, statement ${dueWords(nextDue)}`}</span>}</div>
      <p className="emp-sub">Every quarter EMPIRE sends a statement: what it received (Net Income) and what it credited to Defied. Type each one in and the bar uses it for that quarter instead of the estimate.</p>
      {open.length === 0 ? <p className="emp-empty" data-emp-no-open>No finished quarter is waiting for a statement.</p> : (
        <div className="emp-form" data-emp-statement-form>
          <label className="fld"><span>Quarter</span>
            <select value={quarter} onChange={(e) => setF({ ...f, quarter: e.target.value })} data-f="quarter">
              {open.map((q) => <option key={q.id} value={q.id}>{quarterWords(q)}</option>)}
            </select>
            {chosen && <span className="hint" data-emp-due>Its statement is {dueWords(chosen)}.</span>}</label>
          <Field label="Net Income ($)" inputMode="decimal" autoComplete="off" placeholder="what EMPIRE received" value={f.ni} onChange={(e) => setF({ ...f, ni: e.target.value })} data-f="netIncome" />
          <Field label="Credited to Defied ($)" inputMode="decimal" autoComplete="off" placeholder="what it credited" value={f.credited} onChange={(e) => setF({ ...f, credited: e.target.value })} data-f="credited"
            hint={ni > 0 ? <>Usually {pctText(terms.payout, 0)} of Net Income: {usd(usual)}. <button type="button" className="inline-link" data-emp-fill onClick={() => setF({ ...f, credited: String(usual) })}>Use that</button></> : `Usually ${pctText(terms.payout, 0)} of Net Income.`} />
          <button type="button" className="btn sm emp-form-go" data-emp-add-statement onClick={add} disabled={busy || !ok}>{busy ? "Adding…" : "Add statement"}</button>
        </div>
      )}
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
                    <span>Delete the {s.quarter} statement? The bar goes back to the estimate for it.</span>
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

export { RecoupCard, PotCard, DealsCard, DealRow, StatementsCard, NetIncomeBox, ReceivedRow };
