// Request payment (2026-11-26): the client's own pay link (their manager's pay.defiedmgmt.com/<key>, carrying the client's id so Money
// knows who paid, and an amount when one is typed), the same link their portal's Management Commission card builds (lib/commission.js
// payUrl). On a phone the share sheet opens straight from the tap; on a computer the link is copied. Only once it went out is it
// recorded (POST /api/pay-requests): a cancelled share records nothing. A real payment from the client afterwards settles it by
// itself (lib/pay-requests.js): "Requested Nov 26", then "Paid Dec 2".
// The key comes with the dashboard's clients (client.payKey, for Money accounts): without one there's no button, never a made-up link.
import { useState } from "react";
import { useApp } from "../app/AppRoot";
import { payUrl, dollarsToCents } from "../../lib/commission";
import { nyShortDay } from "../../lib/ny-time";

// clientId -> its pay link key, from the dashboard's clients (or null)
export function usePayKeys() {
  const list = useApp()?.db?.clients || [];
  return (id) => list.find((c) => c.id === id)?.payKey || null;
}
// the request of the last 14 days for a client (Money's counts: payers.requests, newest first)
export const requestOf = (requests, clientId) => (requests || []).find((r) => r.clientId === clientId) || null;

const post = (body) => fetch("/api/pay-requests", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify(body) })
  .then((r) => r.json().catch(() => ({})).then((j) => (r.ok ? j : { error: j.error || "Couldn't save that. Try again in a minute." })))
  .catch(() => ({ error: "Couldn't reach the server. Try again in a minute." }));
const touch = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer:coarse)").matches;

// asked / paid: the latest request's moment and the payment that settled it (ISO), when there is one from the last 14 days
// look: "primary" (a full button), "ghost" (an outlined one) or "quiet" (a text action, for a table of rows)
export function RequestPay({ clientId, payKey, paydayId = "", asked = null, paid = null, withAmount = false, label = "Request payment", look = "primary", onSent }) {
  const [amt, setAmt] = useState("");
  const [sent, setSent] = useState(null); // { at, copied } once recorded
  const [err, setErr] = useState(null); // { text, retry? }
  if (!payKey || !clientId) return null;
  if (paid && !sent) return <span className="req-state paid" data-req-paid={clientId}>Paid {nyShortDay(paid)}</span>;
  if (sent || asked) return <span className="req-state" data-req-asked={clientId}>{sent?.copied ? "Copied" : `Requested ${nyShortDay(sent?.at || asked)}`}</span>;
  const record = (cents, copied) => post({ action: "create", clientId, key: payKey, ...(cents ? { cents } : {}), ...(paydayId ? { paydayId } : {}) }).then((j) => {
    if (j.error) { setErr({ text: j.error, retry: () => { setErr(null); record(cents, copied); } }); return; }
    setSent({ at: j.request?.at || new Date().toISOString(), copied });
    onSent?.(j.request);
  });
  const go = () => {
    setErr(null);
    const typed = withAmount ? amt.trim() : "";
    const cents = typed ? dollarsToCents(typed) : null;
    if (typed && (cents == null || cents > 100000000)) { setErr({ text: "Type an amount, like 250." }); return; }
    const url = payUrl(payKey, cents, clientId);
    // the share sheet is opened right in the tap (iOS Safari refuses it after anything awaited first)
    const share = touch() && typeof navigator !== "undefined" && typeof navigator.share === "function";
    let out;
    try { out = share ? navigator.share({ url }) : navigator.clipboard.writeText(url); } catch (e) { out = Promise.reject(e); }
    Promise.resolve(out).then(() => record(cents, !share), (e) => { if (e?.name !== "AbortError") setErr({ text: share ? "Couldn't open the share sheet." : "Couldn't copy the link." }); });
  };
  return (
    <span className="req-pay" data-req-pay={clientId}>
      {withAmount && <input className="req-amt" inputMode="decimal" placeholder="$ Amount" aria-label="Amount (optional)" value={amt} onChange={(e) => setAmt(e.target.value)} />}
      <button type="button" className={look === "quiet" ? "quiet-act req-quiet" : look === "ghost" ? "btn ghost sm" : "btn sm"} data-request={clientId} onClick={go}>{label}</button>
      {err && <span className="hint err-text req-err" role="alert">{err.text}{err.retry && <> <button type="button" className="inline-link" onClick={err.retry}>Try again</button></>}</span>}
    </span>
  );
}
