import { useState, useRef } from "react";
import { X } from "lucide-react";
import { useEscape } from "../dash/ui";

// The confirm card and the unsaved-changes guard, shared by the portal and every dashboard section
// (list B #11: their own module, so using them doesn't load the whole client portal).
// An in-app "are you sure?" in place of the browser's own confirm box: a title, what will happen, a
// red button and Cancel. Esc, ×, Cancel or a click outside cancel; the red button waits for go().
// plain: a normal button for a step that loses nothing; typeName: the button stays off until that is typed.
// alt: { label, run } a second answer beside the red one (the merge card's "Not the same song"); wide: room for columns
export function AskCard({ title, children, goLabel, busyLabel = "Working…", go, onClose, plain = false, typeName = null, alt = null, wide = false, goDisabled = false }) {
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const running = useRef(false); // set at once: a double click lands before the busy re-render
  const typedOk = !typeName || typed.trim() === typeName.trim();
  const close = () => { if (!busy) onClose(); };
  useEscape(close, true, true); // ahead of the window it opened over, so Esc closes only this
  const run = async (fn = go) => { if (!typedOk || running.current) return; running.current = true; setBusy(true); try { await fn(); } finally { running.current = false; setBusy(false); } };
  return (
    <div className="modal ask-modal" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className={wide ? "modal-card ask-card ask-wide" : "modal-card ask-card"} role="alertdialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h3>{title}</h3><button onClick={close} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-body ask-body">
          {children}
          {typeName && <input className="ask-type" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} disabled={busy} aria-label={`Type ${typeName} to confirm`} placeholder={typeName} autoComplete="off" spellCheck={false} autoFocus />}
        </div>
        <div className="modal-foot">
          {/* Cancel has the focus: Enter never deletes by accident */}
          <button className="btn ghost sm" onClick={close} disabled={busy} autoFocus={!typeName}>Cancel</button>
          {alt && <button className="btn ghost sm" data-ask-alt onClick={() => run(alt.run)} disabled={busy}>{alt.label}</button>}
          <button className={plain ? "btn sm" : "btn sm ask-go"} data-ask-go onClick={() => run()} disabled={busy || !typedOk || goDisabled}>{busy ? busyLabel : goLabel}</button>
        </div>
      </div>
    </div>
  );
}

// A panel with typing in it never closes on a stray Esc, × or click outside: it asks first, in the
// panel. Cancel still discards at once. A clean panel closes as before.
export function useDirtyGuard(dirty, onClose) {
  const [asking, setAsking] = useState(false);
  const tryClose = () => (dirty ? setAsking(true) : onClose());
  const bar = asking && dirty && (
    <div className="dirty-bar" role="alert">
      <span>You have unsaved changes</span>
      <button className="btn sm" data-keep-editing onClick={() => setAsking(false)} autoFocus>Keep editing</button>
      <button className="btn ghost sm" data-discard onClick={onClose}>Discard</button>
    </div>
  );
  return { tryClose, bar };
}
