import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { COMMISSION_RATE, commissionOf, dollarsToCents, payUrl, usd } from "../../lib/commission";

// Management Commission (2026-11-11, the owner): a client types what they made, sees the 20%, and pays it to their
// manager on Stripe with the amount already filled in (GET /api/my-commission; lib/commission.js). Their last
// payment underneath.
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function MyCommission({ clientId }) {
  const [d, setD] = useState(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState("");
  useEffect(() => {
    fetch("/api/my-commission", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject())).then(setD).catch(() => setFailed(true));
  }, []);
  const made = dollarsToCents(text);
  const owed = made ? commissionOf(made) : null;
  const pct = Math.round((d?.rate ?? COMMISSION_RATE) * 100);
  const who = d?.manager?.name || "your manager";
  const bad = text.trim() && !made;
  return (
    <div className="cat-summary as-card mc-card" data-commission>
      <div className="as-head">
        <h3>Management Commission</h3>
        <span className="hint">{pct}% of what you made</span>
      </div>
      {failed && <p className="hint">Couldn't load this right now. Reload the page to try again.</p>}
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
      {d && <p className="hint mc-note">Opens {who}'s Stripe page (pay.defiedmgmt.com/{d.manager.key}) with the amount filled in.{" "}
        <span data-commission-last>{d.last ? `Last paid: ${usd(d.last.amount)} on ${day(d.last.at)}.` : d.count === 0 ? "No payments from you yet." : ""}</span></p>}
    </div>
  );
}
