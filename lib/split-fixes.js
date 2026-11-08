// The split fixes nobody has to think about (r7 A2), pure, so the browser, the route and the tests share them.
// facts = db.sheetFacts (lib/sheet-facts-store.js: what the last sheet pull read, per song and per client).
//   shareFixes   a song whose own share and the sheet's differ with only one sensible answer (the five real ones in
//                sync-audit/REPORT.md): no split at all here while the sheet has 100% ("site": the site takes the
//                sheet's 100%, nothing is written to the sheet), or 100% here while the sheet's Writer Share is
//                blank ("sheet": the blank cell gets the share typed in the dialog, 100% unless the owner types
//                another, so the row earns again; the only sheet write)
//   typedShare   that typed share checked (the dialog and the route read the same rule)
//   autoConfirms an assumed even split whose client share already is the sheet's: confirmed on the site only (DB),
//                never written to the sheet, said once in To do's "Done for you" line with Undo
// lib/split-fixes-store.js keeps what was confirmed (and what Undo put back, never confirmed again).
import { evenSplit, sideOf } from "./splits";
import { findByName } from "./names";

const total = (rows) => (rows || []).reduce((a, s) => a + (Number(s.percent) || 0), 0);
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.05;
const clientOf = (p) => p.clientId ?? p.client_id;

// { site: [{ p, client, row, splits }], sheet: [{ p, client, row, site }] } (site: the client's own % here, the
// dialog's default); only songs whose client's tab was read
export function shareFixes({ placements = [], clients = [], facts = {}, makeId = () => Math.random().toString(36).slice(2, 10) }) {
  const byId = new Map(clients.map((c) => [c.id, c]));
  const site = [], sheet = [];
  for (const p of placements) {
    const c = byId.get(clientOf(p)), f = facts.songs?.[p.id];
    if (!c || !f || facts.clients?.[c.id] == null) continue;
    const rows = p.splits || [], own = findByName(rows, c.name);
    if (!total(rows) && f.share != null && near(f.share, 100)) {
      // the client at 100% (their own row if it's there at 0, else a new one); anyone else listed stays at 0
      const splits = own ? rows.map((r) => (r === own ? { ...r, percent: 100 } : r))
        : [{ id: makeId(), name: c.name, role: sideOf(c.role) || "Producer", percent: 100 }, ...rows];
      site.push({ p, client: c, row: f.row, splits });
    } else if (own && near(own.percent, 100) && near(total(rows), 100) && f.share == null && f.row) {
      sheet.push({ p, client: c, row: f.row, site: Number(own.percent) });
    }
  }
  return { site, sheet };
}

// a share typed into "Fill in the sheet's blank share" (r11, the owner: "there should be like a way that i can type
// this in"): more than 0, at most 100, one decimal at most (33.3). { share } or { reason }, a few words for the dialog
export function typedShare(v) {
  const t = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim().replace(/\s*%$/, "").replace(",", ".") : "";
  if (!t) return { reason: "Type a share." };
  if (/^-/.test(t)) return { reason: "It has to be more than 0%." };
  if (/^\d*\.\d{2,}$/.test(t)) return { reason: "One decimal at most, like 33.3." };
  if (!/^(\d+(\.\d)?|\.\d)$/.test(t)) return { reason: "Type a number, like 50." };
  const n = Number(t);
  if (!(n > 0)) return { reason: "It has to be more than 0%." };
  if (n > 100) return { reason: "100% at most." };
  return { share: n };
}
// the song's split with the client's own row at share, the rest as it was: a filled-in share other than the site's
// changes the site's split too, so the two match
export function ownAt(splits, name, share) {
  const own = findByName(splits || [], name);
  return (splits || []).map((r) => (r === own ? { ...r, percent: share } : r));
}

// [{ p, client, before, after }]: held = song ids Undo put back (never again); skip = ids to leave alone (a
// possible duplicate waits for its merge card, as in Splits to confirm)
export function autoConfirms({ placements = [], clients = [], facts = {}, held = [], skip = new Set() }) {
  const byId = new Map(clients.map((c) => [c.id, c]));
  const out = [];
  for (const p of placements) {
    const c = byId.get(clientOf(p)), f = facts.songs?.[p.id];
    if (!c || !f || f.share == null || facts.clients?.[c.id] == null || held.includes(p.id) || skip.has(p.id)) continue;
    const r = evenSplit(p.splits);
    if (r.status !== "assumed") continue;
    const own = findByName(r.splits, c.name);
    if (own && near(own.percent, f.share)) out.push({ p, client: c, before: p.splits || [], after: r.splits });
  }
  return out;
}

// the one "Done for you" sentence for what was confirmed by itself: "Confirmed 3 even splits the sheet already had
// (Glass House, South and 1 more)."
export function autoWords(done) {
  const n = done.length, names = done.map((d) => d.song || "Untitled");
  const list = n > 3 ? `${names.slice(0, 2).join(", ")} and ${n - 2} more` : n > 1 ? `${names.slice(0, -1).join(", ")} and ${names[n - 1]}` : names[0];
  return n ? `Confirmed ${n === 1 ? "1 even split" : `${n} even splits`} the sheet already had (${list}).` : "";
}
