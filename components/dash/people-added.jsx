import { useState, useEffect } from "react";
import { ExtLink } from "../shared/ui";
import { addedLine, LATER } from "./added-line";

/* (2026-11-13) people sync: the sheets from the site (lib/people-sync.js, /api/people-sync). The owner: "i just want an
   easier way to add the managers and clients and stuff on the site and have it all sync to the sheets". Every write is the
   server's, checked against the sheet first and read back after. This file is what Site › Users, Roster, Team and the Clients
   tab's Add client share: the one read of INFO (kept a minute), the posts, and (2026-11-15) "Added everywhere". */

// GET /api/people-sync, kept a minute for every form that opens (it costs three Google reads)
export const peopleCache = { at: 0, d: null, p: null };
export function usePeopleSync(on) {
  const fresh = () => (peopleCache.d && Date.now() - peopleCache.at < 60000 ? peopleCache.d : null);
  const [data, setData] = useState(fresh);
  const [failed, setFailed] = useState(false);
  const load = (force = false) => {
    if (!on) return Promise.resolve(null);
    if (!force && fresh()) { setData(fresh()); return Promise.resolve(fresh()); }
    if (!force && peopleCache.p) return peopleCache.p.then((d) => { if (d) setData(d); else setFailed(true); return d; });
    setFailed(false);
    const p = fetch("/api/people-sync", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((d) => { if (peopleCache.p === p) peopleCache.p = null; if (d) { peopleCache.d = d; peopleCache.at = Date.now(); setData(d); } else setFailed(true); return d; });
    peopleCache.p = p;
    return p;
  };
  useEffect(() => { load(); }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, failed, load };
}
export async function peoplePost(body) {
  const r = await fetch("/api/people-sync", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify(body) }).catch(() => null);
  if (!r) return { error: "Couldn't reach the site. Try again." };
  const j = await r.json().catch(() => ({}));
  // a refusal keeps what the form needs: stale (INFO changed since it was filled), addedManager (a new manager went on
  // INFO's list before the client's row was refused)
  return r.ok ? j : { error: j.error || "That didn't go through. Try again in a minute.", ...(j.stale ? { stale: true } : {}), ...(j.addedManager ? { addedManager: j.addedManager } : {}), ...(j.busy ? { busy: true } : {}) };
}

// The people link, now (`after: true`): the run right after an add, without the preview. It is an automatic run, so it stops at the first-run gate: until a
// person has pressed Site › Sync's "Sync people now" once (which sends no `after`), the server answers { waiting: true } and does nothing. Once that has
// been done it makes the accounting sheet's part (INFO's manager list, or the client's row at 20%) at once, where the run that follows every save leaves
// it for later. -> { created, sheet, flags, ... } | { waiting } | { busy } | { error }
export async function linkNow(extra = {}) {
  const r = await peoplePost({ action: "link", after: true, ...extra });
  if (r.error) return { error: r.error, ...(r.busy ? { busy: true } : {}) };
  if (r.waiting) return { waiting: true };
  if (r.busy || r.off) return { busy: true };
  return r;
}
// After a save that ADDED someone: link now, read the site and INFO again, and say in one line what exists (added-line.js).
// who: addedLine's; reloadDb: the dashboard's (it gives the site's copy as the server has it). Never throws. -> { text, flags, later }
export async function syncEverywhere(who, reloadDb) {
  try {
    const link = await linkNow(who.kind === "client" ? { addedClients: [who.id] } : {}); // a client just added starts hidden, with no songs and no login: the run is told it's real
    const [db, d] = await Promise.all([reloadDb ? reloadDb() : null, fetch("/api/people-sync", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)]);
    if (d) { peopleCache.d = d; peopleCache.at = Date.now(); }
    return addedLine({ who, link, db: db || null, info: d && d.info && !d.info.problem ? d.info : null });
  } catch (err) {
    console.error("added everywhere:", err);
    return { text: LATER, flags: [], later: true };
  }
}

// a save's answer as one line: what was done, or the alarm (red), or why not
export const Said = ({ res }) => (!res ? null : <p className={`hint ${res.ok && !res.alarm ? "ok-text" : "err-text"}`} role="status" data-sheet-said>{[res.text, res.alarm, res.error].filter(Boolean).join(" ")}</p>);

// The line after an add (and the flags the run raised about them, each with its fix when there is one: the sheet, or the page it names).
// said: { text, flags, alarm }; onGo(tab, sub): the dashboard's (a flag's "go" fix opens that page), none: those fixes aren't shown
export function AddedSaid({ said, onGo = null }) {
  if (!said) return null;
  return (
    <div className="added-said" data-added-said>
      <p className={`hint ${said.alarm ? "err-text" : "ok-text"}`} role="status">{said.text}</p>
      {said.flags?.length > 0 && (
        <ul className="added-flags" data-added-flags>
          {said.flags.map((f) => (
            <li key={f.key}>
              <span className="hint">{f.text}</span>
              {f.fix?.kind === "url" && <ExtLink className="btn ghost sm" href={f.fix.url}>{f.fix.label}</ExtLink>}
              {f.fix?.kind === "go" && onGo && <button type="button" className="btn ghost sm" onClick={() => onGo(f.fix.tab, f.fix.sub || null)} data-added-fix={f.key}>{f.fix.label}</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
