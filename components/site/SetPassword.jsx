import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { RefreshCw } from "lucide-react";
import { ROUTE_TO_PATH } from "../shared/routes";
import { TLink } from "../shared/ui";
import { SplitHead } from "./motion";

// A one-time set-password link (2026-11-10, lib/password-links.js): the person chooses their own password, twice, with
// Show to check it, and is signed in. Built from the sign-in page's own parts.
function PwBox({ id, label, value, onChange, show, onShow, autoFocus = false }) {
  return (
    <div className="ct-fld">
      <label htmlFor={id}>{label}</label>
      <div className="lg-pw">
        <input id={id} type={show ? "text" : "password"} autoComplete="new-password" required minLength={8} value={value} onChange={onChange} autoFocus={autoFocus} />
        <button type="button" className="lg-show" onClick={onShow} aria-controls={id} aria-label={show ? "Hide password" : "Show password"}>{show ? "Hide" : "Show"}</button>
      </div>
    </div>
  );
}
export function SetPassword() {
  const router = useRouter();
  const token = typeof router.query.t === "string" ? router.query.t : "";
  const [who, setWho] = useState(null); // { name, email } | { gone: message }
  const [pw, setPw] = useState(""), [again, setAgain] = useState(""), [show, setShow] = useState(false);
  const [err, setErr] = useState(null), [busy, setBusy] = useState(false);
  const submitRef = useRef(null);
  useEffect(() => {
    if (!router.isReady) return;
    if (!token) { setWho({ gone: "This page needs the link a Founder sent you." }); return; }
    fetch(`/api/auth/set-password?t=${encodeURIComponent(token)}`, { cache: "no-store" }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      setWho(r.ok ? j : { gone: j.error || "This link doesn't work any more. Ask a Founder for a new one." });
    }).catch(() => setWho({ gone: "Couldn't reach the server. Check your connection and reload." }));
  }, [router.isReady, token]);
  useEffect(() => { if (err && document.activeElement === document.body) submitRef.current?.focus(); }, [err]);
  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    if (pw !== pw.trim()) return setErr("Take out the space at the start or end.");
    if (pw.length < 8) return setErr("Use at least 8 characters.");
    if (pw !== again) return setErr("The two passwords don't match.");
    setBusy(true);
    try {
      const r = await fetch("/api/auth/set-password", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify({ token, password: pw }) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Couldn't save that. Try again.");
      window.location.assign(j.role === "client" ? ROUTE_TO_PATH.client : ROUTE_TO_PATH.staff); // signed in: their portal or the dashboard
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  return (
    <main className="pg lg">
      <p className="micro-label lg-label">Staff and client portal</p>
      <SplitHead text="SET PASSWORD." chrome className="pg-head lg-head" />
      {!who ? <p className="lg-help"><RefreshCw size={15} className="spin" /> Checking your link…</p>
        : who.gone ? (
          <div className="lg-form" data-link-gone>
            <p className="ct-err" role="alert">{who.gone}</p>
            <TLink href={ROUTE_TO_PATH.login} className="pill pill-ghost pill-full">Go to sign in</TLink>
          </div>
        ) : (
          <form className="lg-form" onSubmit={submit} aria-busy={busy} data-set-password>
            <p className="lg-help lg-who">For <b>{who.name || who.email}</b> ({who.email}). Choose a password you'll remember: at least 8 characters.</p>
            {/* the email, hidden, so a password manager saves the new password to the right login */}
            <input type="email" name="username" autoComplete="username" value={who.email} readOnly hidden />
            <PwBox id="sp-new" label="New password" value={pw} onChange={(e) => setPw(e.target.value)} show={show} onShow={() => setShow((v) => !v)} autoFocus />
            <PwBox id="sp-again" label="New password again" value={again} onChange={(e) => setAgain(e.target.value)} show={show} onShow={() => setShow((v) => !v)} />
            {err && <p className="ct-err" role="alert">{err}</p>}
            <button ref={submitRef} className="pill pill-solid pill-full" type="submit" disabled={busy}>
              {busy ? <><RefreshCw size={15} className="spin" /> Saving…</> : "Save and sign in"}
            </button>
          </form>
        )}
    </main>
  );
}
