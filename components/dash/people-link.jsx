// (2026-11-14) One person, same info everywhere (lib/people-link.js): Site › Sync's "People" line. Each thing to look at
// in plain English with its fix (open the person's login, client or team entry, or the sheet), and the answers the
// people link asks for: a near miss is "Two different people" or "Same person", a removal can be left as it is, a team
// entry's name or email can be used for its login. "Sync people now" shows who would be added first ("This will add:
// …"), then "Add them" (the first run ever is only this). The server checks every answer again.
import { useState } from "react";
import { ExtLink } from "../shared/ui";
import { canUse } from "./access";

async function post(body) {
  const r = await fetch("/api/people-sync", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify(body) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  if (!r?.ok) throw new Error(j.error || "That didn't go through. Try again in a minute.");
  return j;
}
const listOf = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] || "");
const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
// the preview in sentences: what would be added, linked and asked
function previewLines(p) {
  const lines = [];
  if (p.clients.length) lines.push(`${n(p.clients.length, "client", "clients")}, hidden: ${listOf(p.clients)}`);
  const logins = p.users.filter((u) => u.kind === "client login"), staff = p.users.filter((u) => u.kind !== "client login");
  if (logins.length) lines.push(`${n(logins.length, "client login", "client logins")} with no password: ${listOf(logins.map((u) => u.name))}`);
  if (staff.length) lines.push(`${n(staff.length, "staff account", "staff accounts")} with no password: ${listOf(staff.map((u) => `${u.name} (${u.kind})`))}`);
  if (p.team.length) lines.push(`${n(p.team.length, "team page entry", "team page entries")}, hidden: ${listOf(p.team)}`);
  if (p.infoClients.length) lines.push(`on INFO: ${listOf(p.infoClients)} (commission left blank)`);
  if (p.infoManagers.length) lines.push(`on INFO's manager list: ${listOf(p.infoManagers)}`);
  return lines;
}

// check: the Sync check's { id: "people", items }; ctx: the dashboard's (sync, onGo, db)
export function PeopleBlock({ check, ctx }) {
  const [busy, setBusy] = useState(null), [note, setNote] = useState(null), [preview, setPreview] = useState(null);
  const items = check.items || [];
  const can = canUse(ctx.db, "money") && canUse(ctx.db, "users");
  const founder = ctx.db?.access?.role === "founder";
  const mayApply = (f) => canUse(ctx.db, "users") && (!f.founderLogin || founder);
  const run = async (key, steps, done) => {
    setBusy(key); setNote(null);
    try {
      for (const s of steps) await post(s);
      setNote({ ok: true, text: done }); setPreview(null);
      await ctx.sync?.load?.(true);
    } catch (e) { setNote({ ok: false, text: e.message }); } finally { setBusy(null); }
  };
  const look = async () => {
    setBusy("look"); setNote(null);
    try { setPreview(await post({ action: "link", dryRun: true })); } catch (e) { setNote({ ok: false, text: e.message }); } finally { setBusy(null); }
  };
  const fixOf = (f) => {
    if (!f?.fix) return null;
    if (f.fix.kind === "url") return <ExtLink className="btn ghost sm" href={f.fix.url}>{f.fix.label}</ExtLink>;
    if (f.fix.kind === "go") return <button type="button" className="btn ghost sm" onClick={() => ctx.onGo(f.fix.tab, f.fix.sub || null)} data-people-fix={f.key}>{f.fix.label}</button>;
    return null;
  };
  const p = preview?.preview, lines = p ? previewLines(p) : [];
  return (
    <span className="people-flags" data-people-flags>
      {items.map((f) => (
        <span key={f.key} className="people-flag" data-people-flag={f.kind}>
          <span className="people-flag-text">{f.text}</span>
          <span className="people-flag-acts">
            {fixOf(f)}
            {f.apply && mayApply(f) && (
              <button type="button" className="btn ghost sm" disabled={!!busy} data-people-apply={f.key}
                onClick={() => run(f.key, [{ action: "apply", staffId: f.apply.staffId, field: f.apply.field }], "The login has the team page's " + f.apply.field + " now.")}>
                {busy === f.key ? "Working…" : "Use it for the login"}</button>
            )}
            {can && f.kind === "near" && f.pair && !String(f.key).startsWith("same:") && (
              <button type="button" className="btn ghost sm" disabled={!!busy} data-people-two={f.key}
                onClick={() => run(f.key, [{ action: "distinct", a: f.pair[0], b: f.pair[1] }], `${f.pair[0]} and ${f.pair[1]} are kept as two people.`)}>
                {busy === f.key ? "Working…" : "Two different people"}</button>
            )}
            {can && f.kind === "near" && f.link && (
              <button type="button" className="btn ghost sm" disabled={!!busy} data-people-same={f.key}
                onClick={() => run(`${f.key}:same`, [{ action: "pair", link: f.link }], `${f.pair?.[0]} and ${f.pair?.[1]} are linked as one person.`)}>
                {busy === `${f.key}:same` ? "Working…" : "Same person"}</button>
            )}
            {can && ["removed", "info", "duplicate", "differ"].includes(f.kind) && (
              <button type="button" className="btn ghost sm" disabled={!!busy} data-people-leave={f.key}
                onClick={() => run(`${f.key}:leave`, [{ action: "dismiss", key: f.key }], "Left as it is.")}>
                {busy === `${f.key}:leave` ? "Working…" : "Leave it"}</button>
            )}
          </span>
        </span>
      ))}
      {can && p && (
        <span className="people-preview" data-people-preview>
          <span className="people-flag-text">
            {lines.length ? <>This will add: {lines.join("; ")}.</> : "Nothing new to add."}
            {p.links ? ` It links ${n(p.links, "record", "records")} that already match (nothing renamed).` : ""}
            {p.updates.length ? ` It copies ${listOf(p.updates.map((x) => `${x.name}'s ${x.what}`))}.` : ""}
            {p.flags.length ? ` ${n(p.flags.length, "thing", "things")} will be asked here instead of added.` : ""}
            {" "}Nothing is deleted.
          </span>
          <span className="people-flag-acts">
            <button type="button" className="btn sm" disabled={!!busy} data-people-go onClick={() => run("go", [{ action: "link" }], p.count ? "Done: they're added, hidden and with no login." : "Done: everyone is linked.")}>
              {busy === "go" ? "Adding…" : p.count ? "Add them" : "Sync now"}</button>
            <button type="button" className="btn ghost sm" disabled={!!busy} onClick={() => setPreview(null)}>Cancel</button>
          </span>
        </span>
      )}
      {can && !p && (
        <span className="people-flag-acts">
          <button type="button" className="btn ghost sm" disabled={!!busy} data-people-sync onClick={look}>
            {busy === "look" ? "Checking who's new…" : "Sync people now"}</button>
        </span>
      )}
      {note && <span className={`hint ${note.ok ? "ok-text" : "err-text"}`} role="status">{note.text}</span>}
    </span>
  );
}
