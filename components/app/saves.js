import { MAX_DATA_BYTES } from "../../lib/image-links";

/* ------------------------------------------------------------------ */
/*  STAFF DASHBOARD                                                     */
/* ------------------------------------------------------------------ */
/* dashboard saves (see App's commit) ---------------------------------- */
// what each role can write. POST /api/dashboard-data replaces every table it's sent (rows
// reinserted in array order; clients take roster_order from it), so each one goes out whole
const SAVE_TABLES = { staff: ["clients", "placements", "staff", "users", "submissions", "notableReleases"], client: ["placements"] };
const sameValue = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
// b's top-level fields that differ from a's (one b dropped comes back undefined), or null
export function changedFields(a = {}, b = {}) {
  const out = {};
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) if (!sameValue(a?.[k], b?.[k])) out[k] = b?.[k];
  return Object.keys(out).length ? out : null;
}
// one edit to a table: ids deleted, rows added, fields changed per id, the new id order, and
// whether the rows on both sides were reordered
function diffRows(base = [], next = []) {
  if (base === next) return null;
  const was = new Map(base.map((r) => [r.id, r]));
  const ids = next.map((r) => r.id);
  const now = new Set(ids);
  const deleted = base.filter((r) => !now.has(r.id)).map((r) => r.id);
  const added = next.filter((r) => !was.has(r.id));
  const changed = {};
  for (const r of next) {
    const f = was.has(r.id) && was.get(r.id) !== r && changedFields(was.get(r.id), r);
    if (f) changed[r.id] = f;
  }
  const reordered = !sameValue(base.map((r) => r.id).filter((id) => now.has(id)), ids.filter((id) => was.has(id)));
  return deleted.length || added.length || Object.keys(changed).length || reordered ? { deleted, added, changed, ids, reordered } : null;
}
// null when next changes nothing
export function diffDb(base, next) {
  const patch = {};
  for (const k of SAVE_TABLES[next.role] || []) { const d = diffRows(base[k], next[k]); if (d) patch[k] = d; }
  if (next.role === "staff") for (const k of ["site", "sheetSync"]) { const f = changedFields(base[k], next[k]); if (f) patch[k] = f; }
  return Object.keys(patch).length ? patch : null;
}
// puts each id of seq that isNew into order (a list of ids), in before the next id of seq already
// there — so at the end, for the usual append
const placeNew = (order, seq, isNew) => seq.forEach((id, i) => {
  if (!isNew(id)) return;
  const before = seq.slice(i + 1).find((x) => order.includes(x));
  order.splice(before === undefined ? order.length : order.indexOf(before), 0, id);
});
// one edit's table diff onto the server's latest rows: a row deleted elsewhere isn't brought back,
// a row added elsewhere stays (ahead of this edit's own new rows), and the edit's order wins only
// if it reordered
function applyRows(fresh = [], d) {
  const rows = new Map(fresh.map((r) => [r.id, r]));
  for (const id of d.deleted) rows.delete(id);
  for (const [id, f] of Object.entries(d.changed)) if (rows.has(id)) rows.set(id, { ...rows.get(id), ...f });
  const added = new Set();
  for (const r of d.added) { if (!rows.has(r.id)) added.add(r.id); rows.set(r.id, { ...rows.get(r.id), ...r }); }
  const known = new Set(d.ids);
  const order = (d.reordered ? d.ids : fresh.map((r) => r.id)).filter((id) => known.has(id) && rows.has(id) && !added.has(id));
  placeNew(order, fresh.map((r) => r.id), (id) => rows.has(id) && !known.has(id));
  placeNew(order, d.ids, (id) => added.has(id));
  return order.map((id) => rows.get(id));
}
// these GETs have no ORDER BY, so they come back in whatever order Postgres stored the last
// rewrite; a tab keeps the order it loaded them in (what it shows, and writes back), as saves
// always have. Clients come back in roster order and submissions newest first.
const UNORDERED = ["placements", "staff", "users", "notableReleases"];
export function inTabOrder(fresh, tab) {
  const out = { ...fresh };
  for (const k of UNORDERED) {
    if (!Array.isArray(fresh[k]) || !Array.isArray(tab?.[k])) continue;
    const byId = new Map(fresh[k].map((r) => [r.id, r]));
    const order = tab[k].map((r) => r.id).filter((id) => byId.has(id));
    const had = new Set(order);
    placeNew(order, fresh[k].map((r) => r.id), (id) => !had.has(id));
    out[k] = order.map((id) => byId.get(id));
  }
  return out;
}
export function applyPatch(fresh, patch) {
  const out = { ...fresh };
  for (const k of SAVE_TABLES[fresh.role] || []) if (patch[k]) out[k] = applyRows(fresh[k], patch[k]);
  for (const k of ["site", "sheetSync"]) if (patch[k]) out[k] = { ...fresh[k], ...patch[k] };
  // deleting a client takes along a song or login someone added for them since, as the server's
  // own cascade would — sent back, it would fail the whole save on the missing client
  const gone = new Set(patch.clients?.deleted);
  if (gone.size) for (const k of ["placements", "users"]) if (out[k].some((r) => gone.has(r.clientId))) out[k] = out[k].filter((r) => !gone.has(r.clientId));
  return out;
}
// what a save sends: the tables it changed, plus any applyPatch rewrote for it (a login dropped with its client)
export const saveKeys = (patch, fresh, merged) => [...(SAVE_TABLES[fresh.role] || []), "site", "sheetSync"].filter((k) => patch[k] || merged[k] !== fresh[k]);
const TOO_BIG = "That's too much to save — the photos and covers are over the size limit. Remove or shrink some images and try again.";
// a client can't shrink the photos and covers that fill the data, only the Defied team can
const TOO_BIG_CLIENT = "Your change couldn't be saved right now — please let the Defied team know.";
export const SAVE_OFFLINE = "Couldn't reach the server, so that change wasn't saved — check your connection and try again.";
// the banner finishes this sentence with a "sign in again." link
export const SIGNED_OUT = "You've been signed out, so that change wasn't saved. Copy anything you need first, then";
export const ACCOUNT_CHANGED = "Your account was changed — reload the page.";
// what the banner says about a failed request: the server's own reason when it gave one
export const saveFailure = (res, data, fallback, role) => (!res ? SAVE_OFFLINE : res.status === 401 ? SIGNED_OUT
  : data?.error || (res.status === 413 ? (role === "client" ? TOO_BIG_CLIENT : TOO_BIG) : fallback));
export const holdUnload = (e) => { e.preventDefault(); e.returnValue = ""; };
// the dashboard loads everything in one reply, and Vercel won't send one over 4.5 MB (lib/image-links.js: photos
// are links now, so only the ones from before still count much)
const MAX_DATA = MAX_DATA_BYTES;
// weighed the way the server weighs it: UTF-8 bytes, and no typed passwords (those are never stored or sent back)
const dataBytes = (d) => new TextEncoder().encode(JSON.stringify(withoutPasswords(d))).length;
// a save that can't go onto the server's copy as it is now: why, or null. A save that shrinks the data always goes,
// so there's a way back under the limit
export function refusal(patch, fresh, merged) {
  // a song or login this save adds (or moves) for a client deleted elsewhere: the server would refuse the
  // whole save on the missing client (fresh itself can't hold one: its rows went with their client)
  const live = merged.clients && new Set(merged.clients.map((c) => c.id));
  if (live && ["placements", "users"].some((k) => patch[k] && merged[k].some((r) => r.clientId && !live.has(r.clientId)))) return goneText("client");
  if (patch.notableReleases?.added.length && merged.notableReleases.length > 10) return "There are already 10 notable releases (someone else added one) — remove one first.";
  const size = dataBytes(merged);
  return size > MAX_DATA && size > dataBytes(fresh) ? (fresh.role === "client" ? TOO_BIG_CLIENT : TOO_BIG) : null;
}
// a demoted or re-linked account: what this tab edits no longer fits what the server would take
export const accountChanged = (fresh, known) => fresh.role !== known.role || fresh.client?.id !== known.client?.id;
// an edit of a row someone else deleted meanwhile saves nothing: the form says so
export const goneText = (thing) => `That ${thing} was deleted somewhere else, so this change wasn't saved.`;
export async function saveRow(commit, next, key, id, thing) {
  const saved = await commit(next);
  return saved && id && !saved[key].some((r) => r.id === id) ? goneText(thing) : saved;
}
// a typed password goes out only with the save it was typed for: re-sent later, it would undo
// one the user has since chosen themselves
export const withoutPasswords = (d) => (d?.users?.some((u) => "password" in u) ? { ...d, users: d.users.map(({ password, ...u }) => u) } : d);
