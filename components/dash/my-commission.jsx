import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { COMMISSION_RATE, commissionOf, dollarsToCents, payUrl, usd } from "../../lib/commission";
import { useOnResume } from "../app/resume";

// Management Commission (2026-11-11, the owner): a client types what they made, sees the 20%, and pays it to their
// manager on Stripe with the amount already filled in (GET /api/my-commission; lib/commission.js). Their last
// payment underneath.
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function MyCommission({ clientId }) {
  const [d, setD] = useState(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState("");
  // (2026-11-26 review) read again when the installed app is opened after a while away (components/app/resume.js): a payment made since shows as the
  // last one. A failed read again keeps what's on show: "Couldn't load" is only for a card with nothing to show
  const load = (again = false) => fetch("/api/my-commission", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((x) => { setD(x); setFailed(false); }).catch(() => { if (!again) setFailed(true); });
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useOnResume(() => load(true));
  const made = dollarsToCents(text);
  const owed = made ? commissionOf(made) : null;
  const pct = Math.round((d?.rate ?? COMMISSION_RATE) * 100);
  const who = d?.manager?.name || "your manager";
  const bad = text.trim() && !made;
  return (
    <div className="cat-summary as-card mc-card" data-commission>
      <div className="as-head">
        <h3>Management Commission</h3>
      </div>
      {failed && !d && <p className="hint">Couldn't load this right now. Reload the page to try again.</p>}
      <form className="mc-form" onSubmit={(e) => e.preventDefault()}>
        <label className="fld mc-made"><span>What you made</span>
          <span className="mc-money"><span aria-hidden="true">$</span><input inputMode="decimal" autoComplete="off" placeholder="0.00" value={text} onChange={(e) => setText(e.target.value)} aria-invalid={!!bad} data-commission-made /></span>
        </label>
        <div className="mc-owed" data-commission-owed={owed ?? ""}>
          <span className="cat-stat-label">Your {pct}%</span>
          <span className="cat-stat-val">{owed ? usd(owed) : "—"}</span>
        </div>
        {bad && <p className="hint err-text mc-err" role="alert">Type the amount in dollars, like 5000 or 5,000.00.</p>}
        {/* a real link (new tab): Stripe's page, the amount filled in, this client's id on it */}
        {owed && d
          ? <a className="btn mc-pay" href={payUrl(d.manager.key, owed, clientId)} target="_blank" rel="noopener noreferrer" data-commission-pay>Pay {who} {usd(owed)} <ArrowUpRight size={16} /></a>
          : <button type="button" className="btn mc-pay" disabled data-commission-pay>Pay {who}</button>}
      </form>
      {/* (2026-11-25 declutter) the last payment only: no "Opens <manager>'s Stripe page … with the amount filled in." (the Pay button says who, and opens it) */}
      {d && (d.last || d.count === 0) && <p className="hint mc-note">
        <span data-commission-last>{d.last ? `Last paid: ${usd(d.last.amount)} on ${day(d.last.at)}.` : "No payments from you yet."}</span></p>}
    </div>
  );
}
