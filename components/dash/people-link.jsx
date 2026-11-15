// (2026-11-14) One person, same info everywhere (lib/people-link.js): Site › Sync's "People" line. Each thing to look at
// in plain English with its fix (open the person's login, client or team entry, or the sheet), and the answers the
// people link asks for: a near miss is "Two different people" or "Same person", a removal can be left as it is. A
// Founder (Money and Users) can also run it now. The server checks every answer again.
import { useState } from "react";
import { ExtLink } from "../shared/ui";
import { canUse } from "./access";

async function post(body) {
  const r = await fetch("/api/people-sync", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify(body) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  if (!r?.ok) throw new Error(j.error || "That didn't go through. Try again in a minute.");
  return j;
}

// check: the Sync check's { id: "people", items }; ctx: the dashboard's (sync, onGo, db)
export function PeopleBlock({ check, ctx }) {
  const [busy, setBusy] = useState(null), [note, setNote] = useState(null);
  const items = check.items || [];
  const can = canUse(ctx.db, "money") && canUse(ctx.db, "users");
  const run = async (key, steps, done) => {
    setBusy(key); setNote(null);
    try {
      for (const s of steps) await post(s);
      setNote({ ok: true, text: done });
      await ctx.sync?.load?.(true);
    } catch (e) { setNote({ ok: false, text: e.message }); } finally { setBusy(null); }
  };
  const fixOf = (f) => {
    if (!f?.fix) return null;
    if (f.fix.kind === "url") return <ExtLink className="btn ghost sm" href={f.fix.url}>{f.fix.label}</ExtLink>;
    if (f.fix.kind === "go") return <button type="button" className="btn ghost sm" onClick={() => ctx.onGo(f.fix.tab, f.fix.sub || null)} data-people-fix={f.key}>{f.fix.label}</button>;
    return null;
  };
  return (
    <span className="people-flags" data-people-flags>
      {items.map((f) => (
        <span key={f.key} className="people-flag" data-people-flag={f.kind}>
          <span className="people-flag-text">{f.text}</span>
          <span className="people-flag-acts">
            {fixOf(f)}
            {can && f.kind === "near" && f.pair && (
              <button type="button" className="btn ghost sm" disabled={!!busy} data-people-two={f.key}
                onClick={() => run(f.key, [{ action: "distinct", a: f.pair[0], b: f.pair[1] }, { action: "link" }], `${f.pair[0]} and ${f.pair[1]} are kept as two people.`)}>
                {busy === f.key ? "Working…" : "Two different people"}</button>
            )}
            {can && f.kind === "near" && f.link && (
              <button type="button" className="btn ghost sm" disabled={!!busy} data-people-same={f.key}
                onClick={() => run(`${f.key}:same`, [{ action: "pair", link: f.link }, { action: "link" }], `${f.pair?.[0]} and ${f.pair?.[1]} are linked as one person. Their names stay as they are.`)}>
                {busy === `${f.key}:same` ? "Working…" : "Same person"}</button>
            )}
            {can && ["removed", "info", "duplicate"].includes(f.kind) && (
              <button type="button" className="btn ghost sm" disabled={!!busy} data-people-leave={f.key}
                onClick={() => run(f.key, [{ action: "dismiss", key: f.key }], "Left as it is.")}>
                {busy === f.key ? "Working…" : "Leave it"}</button>
            )}
          </span>
        </span>
      ))}
      {can && (
        <span className="people-flag-acts">
          <button type="button" className="btn ghost sm" disabled={!!busy} data-people-sync onClick={() => run("sync", [{ action: "link" }], "Done: everyone new is on the other places, hidden.")}>
            {busy === "sync" ? "Syncing people…" : "Sync people now"}</button>
        </span>
      )}
      {note && <span className={`hint ${note.ok ? "ok-text" : "err-text"}`} role="status">{note.text}</span>}
    </span>
  );
}
