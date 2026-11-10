import { useState, useRef } from "react";
import { X } from "lucide-react";
import { Field, useEscape } from "./ui";

// Every staff login changes its own password here (the sidebar's "Password", beside Sign out). Same
// route as the client portal's (/api/auth/change-password): the current password first, then the new one
// twice. Other browsers signed in to this account are signed out; this one stays in.
export function PasswordCard({ onClose }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(false);
  const running = useRef(false); // a double click lands before the busy re-render
  const close = () => { if (!busy) onClose(); };
  useEscape(close, true, true);

  const save = async () => {
    if (running.current) return;
    setErr(null);
    if (!current) return setErr("Type your current password.");
    // the server trims the new one: a space at either end would make the saved password differ from the typed one
    if (next !== next.trim()) return setErr("Take out the space at the start or end of the new password.");
    if (next.length < 8) return setErr("The new password needs at least 8 characters.");
    if (next !== again) return setErr("The two new passwords don't match.");
    if (next === current) return setErr("The new password is the same as the current one.");
    running.current = true; setBusy(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't change your password. Try again.");
      setCurrent(""); setNext(""); setAgain(""); setDone(true);
    } catch (e) {
      setErr(e.message || "Couldn't change your password. Try again.");
    } finally {
      running.current = false; setBusy(false);
    }
  };

  return (
    <div className="modal ask-modal" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="modal-card ask-card" role="dialog" aria-modal="true" aria-label="Change your password" data-password-card>
        <div className="modal-head"><h3>Change your password</h3><button onClick={close} aria-label="Close"><X size={18} /></button></div>
        {done ? (
          <>
            <div className="modal-body ask-body">
              <p className="ok-text" role="status" data-password-done>Password changed. Use the new one next time you sign in.</p>
              <p className="hint">Any other browser or phone signed in to this account has been signed out.</p>
            </div>
            <div className="modal-foot"><button className="btn sm" onClick={onClose} autoFocus>Done</button></div>
          </>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); save(); }}>
            <div className="modal-body ask-body">
              <Field label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} disabled={busy} autoFocus />
              <Field label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} disabled={busy} hint="At least 8 characters." />
              <Field label="New password again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} disabled={busy} />
              {err && <p className="hint err-text" role="alert">{err}</p>}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn ghost sm" onClick={close} disabled={busy}>Cancel</button>
              <button type="submit" className="btn sm" disabled={busy} data-password-save>{busy ? "Saving…" : "Save password"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
