import { useState, useEffect, useRef } from "react";
import { RefreshCw } from "lucide-react";
import { ROUTE_TO_PATH } from "../shared/routes";
import { TLink } from "../shared/ui";
import { SplitHead } from "./motion";

/* ------------------------------------------------------------------ */
/*  LOGIN                                                               */
/* ------------------------------------------------------------------ */
// The way into the dashboard and the client portal, built from the public pages' own parts: the chrome
// heading and the contact form's fields and pill.
export function Login({ login, notice }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submitRef = useRef(null);
  // r11 launch: the form is in the HTML before the code runs; a disabled submit stops a native GET with the fields
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  // the submit button is disabled while signing in, which drops keyboard focus to <body>: give it back
  useEffect(() => { if (err && document.activeElement === document.body) submitRef.current?.focus(); }, [err]);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    let msg;
    try { msg = await login(email, password); }
    catch { msg = "Couldn't reach the server. Check your connection and try again."; }
    // signed in: it stays on "Signing in…" until the dashboard takes over
    if (msg) { setBusy(false); setErr(msg); }
  };
  return (
    <main className="pg lg">
      <p className="micro-label lg-label">Staff and client portal</p>
      <SplitHead text="SIGN IN." chrome className="pg-head lg-head" />
      <form className="lg-form" onSubmit={submit} aria-busy={busy}>
        <label className="ct-fld">
          <span>Email</span>
          {/* text, not type=email: accounts are made with a plain text field, so a stored login that
              isn't a strict address must still get through (the live form was plain text too) */}
          <input name="email" type="text" inputMode="email" autoComplete="username" autoCapitalize="off" autoCorrect="off" spellCheck={false} required aria-invalid={err ? true : undefined} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {/* a div, not a wrapping label: the label's text would otherwise take in "Show" as part of the field's name */}
        <div className="ct-fld">
          <label htmlFor="lg-password">Password</label>
          <div className="lg-pw">
            <input id="lg-password" name="password" type={showPw ? "text" : "password"} autoComplete="current-password" required aria-invalid={err ? true : undefined} value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="lg-show" onClick={() => setShowPw((v) => !v)} aria-controls="lg-password" aria-label={showPw ? "Hide password" : "Show password"}>{showPw ? "Hide" : "Show"}</button>
          </div>
        </div>
        {(err || notice) && <p className="ct-err" role="alert">{err || notice}</p>}
        <button ref={submitRef} className="pill pill-solid pill-full" type="submit" disabled={busy || !ready}>
          {busy ? <><RefreshCw size={15} className="spin" /> Signing in…</> : "Sign in"}
        </button>
      </form>
      <p className="lg-help">Trouble signing in? <TLink href={ROUTE_TO_PATH.contact} className="inline-link">Contact us</TLink></p>
    </main>
  );
}
