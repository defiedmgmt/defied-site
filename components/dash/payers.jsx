// Who's paid (Money › Overview, 2026-11-26: in place of Latest payments, the owner). The numbers are the server's
// (lib/payers-store.js, with GET /api/accounting): commission paid this year and the last day each client paid, by client or by manager.
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useApp } from "../app/AppRoot";
import { nyShortDay } from "../../lib/ny-time";
import { money } from "./ui";
import { RequestPay, usePayKeys, requestOf } from "./request-pay";

const thisYear = () => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).format(new Date());
// (review UX-10) is the book on show the clock's year? In January, until the new year's book is set, Money shows last year's as itself
export const isThisYear = (year) => !year || String(year) === thisYear();
// "Nov 2", or "Dec 19, 2025" for another year; never paid: —
export const lastText = (day) => (!day ? "—" : day.slice(0, 4) === thisYear() ? nyShortDay(day) : `${nyShortDay(day)}, ${day.slice(0, 4)}`);
const paidText = (n) => (n > 0 ? money(n) : "—");

export function WhosPaid({ d }) {
  const [view, setView] = useState("clients");
  const keyOf = usePayKeys();
  const noLink = new Set(useApp()?.db?.noPayLink || []);
  const P = d.payers, reqs = d.counts?.payers?.requests;
  const paidHead = isThisYear(d.year) ? "Paid this year" : `Paid in ${d.year}`;
  const tab = (k, label) => <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? "active" : ""} data-payers-view={k} onClick={() => setView(k)}>{label}</button>;
  return (
    <div className="fix-panel acct-panel acct-latest acct-payers" data-acct="payers">
      <div className="fix-head"><h3>Who's paid</h3>
        {P && <span className="gainer-tabs" role="tablist" aria-label="Who's paid by">{tab("clients", "Clients")}{tab("managers", "Managers")}</span>}</div>
      {!P ? <p className="home-muted"><AlertTriangle size={15} /> Couldn't work out who's paid just now.</p> : (
        <>
          {P.partial && <p className="home-muted payers-partial" data-payers-partial={P.partial}><AlertTriangle size={15} /> {P.partial === "stripe" ? "Stripe couldn't be read just now: the sheet's payments only." : "The sheet couldn't be read just now: Stripe's payments only."}</p>}
          {view === "clients" ? (
            <div className="payers-table" role="table" aria-label="Who's paid, by client">
              <div className="payers-row payers-head" role="row"><span role="columnheader">Client</span><span role="columnheader" className="acct-amt">{paidHead}</span><span role="columnheader">Last paid</span><span role="columnheader" aria-label="Request payment" /></div>
              {P.clients.map((c) => { const r = requestOf(reqs, c.id); return (
                <div key={c.id} className="payers-row" role="row" data-payer={c.id}>
                  <span role="cell" className="payers-name">{c.name}</span>
                  <span role="cell" className="acct-amt payers-paid">{paidText(c.paid)}</span>
                  <span role="cell" className={c.late ? "payers-last late" : "payers-last"} data-late={c.late ? "" : undefined}>{lastText(c.last)}</span>
                  <span role="cell" className="payers-act"><RequestPay clientId={c.id} payKey={keyOf(c.id)} asked={r && !r.paid ? r.at : null} paid={r?.paid || null} label="Request" look="quiet" /></span>
                </div>
              ); })}
            </div>
          ) : (
            <div className="payers-table payers-mgr" role="table" aria-label="Who's paid, by manager">
              <div className="payers-row payers-head" role="row"><span role="columnheader">Manager</span><span role="columnheader" className="acct-amt">Clients</span><span role="columnheader" className="acct-amt">{paidHead}</span><span role="columnheader">Last paid</span></div>
              {P.managers.map((m) => (
                <div key={m.name} className="payers-row" role="row" data-manager={m.name}>
                  <span role="cell" className="payers-name">{m.name}{noLink.has(m.name) && <> <span className="pay-test no-pay-link" data-no-pay-link>No pay link</span></>}</span>
                  <span role="cell" className="acct-amt payers-n">{m.clients}</span>
                  <span role="cell" className="acct-amt payers-paid">{paidText(m.paid)}</span>
                  <span role="cell" className="payers-last">{lastText(m.last)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
