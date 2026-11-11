import { useEffect, useState } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { usd } from "../../lib/commission";
import { ExtLink } from "../shared/ui";

// My payments (2026-11-11, the owner): a co-manager's payments through their own pay link, each split into Defied's
// cut and what they keep (in green), with this month and this year added up (GET /api/my-payments).
const day = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
const monthName = () => new Date().toLocaleDateString("en-US", { month: "long", timeZone: "America/New_York" });

function Totals({ label, t }) {
  return (
    <div className="cat-stat mp-total">
      <span className="cat-stat-label">{label}</span>
      <span className="cat-stat-val mp-keep">{usd(t.keep)}</span>
      <span className="mp-sub">you keep · {usd(t.paid)} paid in · {usd(t.fee)} to Defied · {t.n} payment{t.n === 1 ? "" : "s"}</span>
    </div>
  );
}

// (inside Money, title "Money" and the All / Mine switch, for a login that has Money too: StaffDashboard.jsx)
export function MyPaymentsPage({ title = "My payments", mine = null }) {
  const [d, setD] = useState(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => {
    setBusy(true);
    fetch("/api/my-payments", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject())).then((j) => { setD(j); setFailed(false); }).catch(() => setFailed(true)).finally(() => setBusy(false));
  };
  useEffect(load, []);
  return (
    <div className="my-pay" data-my-payments>
      <div className="admin-head"><h2>{title}</h2>{mine}
        <button type="button" className="btn ghost sm" onClick={load} disabled={busy} data-my-pay-refresh><RefreshCw size={14} className={busy ? "spin" : undefined} /> Refresh</button>
      </div>
      {d?.link && <p className="muted mp-from">Payments through <ExtLink href={d.link.page} className="inline-link">pay.defiedmgmt.com/{d.link.key}</ExtLink>. What you keep is the payment less Defied's cut; Stripe's own fee is paid by Defied.</p>}
      {!d && !failed && <p className="todo-line"><RefreshCw size={14} className="spin" /> Loading your payments…</p>}
      {failed && !d && <p className="todo-line"><AlertTriangle size={14} /> Couldn't load your payments. <button className="inline-link" onClick={load}>Try again</button></p>}
      {d?.none && <p className="todo-line" data-my-pay-none>Your login isn't matched to a pay link.</p>}
      {d?.error && <p className="todo-line"><AlertTriangle size={14} /> {d.error} <button className="inline-link" onClick={load}>Try again</button></p>}
      {d?.payments && (
        <>
          {d.stale && <p className="hint">Stripe didn't answer just now: these are the payments as last read.</p>}
          <div className="cat-summary-grid mp-totals">
            <Totals label={monthName()} t={d.month} />
            <Totals label={`This year`} t={d.year} />
          </div>
          <div className="attn home-card mp-list" data-area="money">
            <div className="todo-group">Recent payments · {d.payments.length}{d.more ? ` of ${d.payments.length + d.more}` : ""}</div>
            {!d.payments.length && <p className="todo-line" data-my-pay-empty>No payments through your link yet.</p>}
            {d.payments.map((p) => (
              <div key={p.id} className="attn-row mp-row" data-my-pay={p.id}>
                <span className="attn-main">
                  <b>{p.client}{p.test && <span className="mp-test"> · test</span>}</b>
                  <em>{day(p.at)} · paid {usd(p.amount)} · Defied {usd(p.fee)}{p.stripeShare ? ` (${usd(p.share)} share + ${usd(p.stripeShare)} toward Stripe's fees)` : ""}</em>
                </span>
                <span className="mp-keep-col"><span className="mp-keep" data-keep={p.keep}>{usd(p.keep)}</span><span className="mp-keep-label">you keep</span></span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
