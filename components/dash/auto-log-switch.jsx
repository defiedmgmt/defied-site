import React, { useState, useEffect } from "react";

// (2026-11-26) Auto-log's switch (lib/auto-log.js), Founders only, in To log's head (components/dash/money.jsx AcctToLog). state: GET /api/accounting's
// autoLog { on, offWhy, offAt }, which only a Founder's read has (nothing renders for anyone else). Off until a Founder turns it on. When the daily job
// turned it off, what went wrong shows under it in the error style for WHY_DAYS, or until a Founder turns it on again.
const WHY_DAYS = 14;
const recent = (at) => { const t = Date.parse(at); return Number.isFinite(t) && Date.now() - t < WHY_DAYS * 86400000; };
const whyOf = (state) => (state && !state.on && state.offWhy && recent(state.offAt) ? state.offWhy : "");

export function AutoLogSwitch({ state }) {
  const [on, setOn] = useState(!!state?.on);
  const [why, setWhy] = useState(() => whyOf(state));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!state) return;
    setOn(!!state.on);
    setWhy(whyOf(state));
  }, [state?.on, state?.offWhy, state?.offAt]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!state) return null;
  const flip = async () => {
    setBusy(true); setErr(null);
    const r = await fetch("/api/accounting", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify({ action: "autoLog", on: !on }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (r?.ok && j.autoLog) { setOn(!!j.autoLog.on); setWhy(""); } else setErr(j.error || "Couldn't reach the server. Try again in a minute.");
    setBusy(false);
  };
  const line = err || why;
  return (
    <>
      <button type="button" role="switch" aria-checked={on} className={on ? "btn sm acct-auto" : "btn ghost sm acct-auto"} data-auto-log={on ? "on" : "off"} disabled={busy} onClick={flip}>
        {busy ? "Saving…" : on ? "Auto-log on" : "Auto-log off"}
      </button>
      {line ? <span className="hint err-text acct-auto-why" role="alert" data-auto-log-why>{line}</span> : null}
    </>
  );
}
