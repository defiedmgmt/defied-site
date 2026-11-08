// The split fixes nobody has to think about (r7 A2), pure, so the browser, the route and the tests share them.
// facts = db.sheetFacts (lib/sheet-facts-store.js: what the last sheet pull read, per song and per client).
//   shareFixes   a song whose own share and the sheet's differ with only one sensible answer (the five real ones in
//                sync-audit/REPORT.md): no split at all here while the sheet has 100% ("site": the site takes the
//                sheet's 100%, nothing is written to the sheet), or 100% here while the sheet's Writer Share is
//                blank ("sheet": the blank cell gets the share typed in the dialog, 100% unless the owner types
//                another, so the row earns again; the only sheet write)
//   typedShare   that typed share checked (the dialog and the route read the same rule)
//   typedSplit   a whole split typed in a confirm card (r11 todoedit: Splits to confirm, Confirm all, the merge card):
//                each person's % in a box, the site's numbers to start; splitProblem is the route's check of it
//   pushShareProblem  the rule for any share written into a song's row (r11 todofix: the push route's, every caller)
//   autoConfirms an assumed even split whose client share already is the sheet's: confirmed on the site only (DB),
//                never written to the sheet, said once in To do's "Done for you" line with Undo
// lib/split-fixes-store.js keeps what was confirmed (and what Undo put back, never confirmed again).
import { evenSplit, sideOf } from "./splits";
import { findByName } from "./names";

const total = (rows) => (rows || []).reduce((a, s) => a + (Number(s.percent) || 0), 0);
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.05;
const clientOf = (p) => p.clientId ?? p.client_id;

// { site: [{ p, client, row, splits, sheet }], sheet: [{ p, client, row, site }] } (site: the client's own % here, the
// fill dialog's default; sheet: the sheet's share, "Use the sheet's split"'s default); only songs whose client's tab was read
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
      site.push({ p, client: c, row: f.row, splits, sheet: Number(f.share) });
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
// a % typed into one person's box of a split (r11 todoedit): 0 to 100, one decimal at most. { pct } or { reason }
// (0 is allowed here: a person listed with no share; typedShare above is the one cell that has to be more than 0)
export function typedPct(v) {
  const t = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim().replace(/\s*%$/, "").replace(",", ".") : "";
  if (!t) return { reason: "Type a share." };
  if (/^-/.test(t)) return { reason: "It can't be below 0%." };
  if (/^\d*\.\d{2,}$/.test(t)) return { reason: "One decimal at most, like 33.3." };
  if (!/^(\d+(\.\d)?|\.\d)$/.test(t)) return { reason: "Type a number, like 50." };
  const n = Number(t);
  if (n > 100) return { reason: "100% at most." };
  return { pct: n };
}
// a % as a box shows it: one decimal, no trailing .0 (16.666… is "16.7", 50 is "50")
export const pctText = (n) => String(Math.round(Number(n) * 10) / 10);
// A split typed in a confirm card. splits: what the site worked out (the even split, the merge's split); typed:
// { rowId: the box's text }. While every box still shows what it was given, the split is the input itself, exact (a
// third stays a third: an untouched card saves exactly what it did before r11). Once one box changes, every share is
// the number its box shows (16.666… is 16.7), so the total is the one the owner can add up. exact: the total must be
// 100 (a Confirm); else at most 100 once a box is changed (the merge, which already keeps a split that doesn't add
// up, and leaves an untouched one as it was). own: the client's
// name: their box can't be typed down to 0 (their share is the one written to the sheet). Returns { splits, total,
// sides: { Artist, Producer }, edited, bad: { rowId: reason }, reason }
export function typedSplit(splits, typed = {}, { exact = true, own = null } = {}) {
  const rows = splits || [], bad = {};
  const text = (r) => (typed[r.id] == null ? pctText(Number(r.percent) || 0) : String(typed[r.id]).trim().replace(/\s*%$/, ""));
  const touched = rows.some((r) => text(r) !== pctText(Number(r.percent) || 0));
  const next = !touched ? rows : rows.map((r) => {
    const v = typedPct(text(r));
    if (v.reason) { bad[r.id] = v.reason; return r; }
    return Math.abs(v.pct - (Number(r.percent) || 0)) < 1e-9 ? r : { ...r, percent: v.pct };
  });
  const ownRow = own ? findByName(next, own) : null;
  // (only a box typed down to 0: a split that already had the client at 0 is left as the site had it)
  if (ownRow && touched && !bad[ownRow.id] && !(Number(ownRow.percent) > 0) && text(ownRow) !== pctText(Number(findByName(rows, own)?.percent) || 0)) bad[ownRow.id] = `${ownRow.name || "The client"}'s share has to be more than 0%.`;
  // within half a tenth, as everywhere else here: 33.3 + 33.3 + 33.4 is 100 however the floats land, and so are
  // three untouched thirds beside a 50
  const sum = total(next), shownTotal = Math.round(sum * 10) / 10;
  const sidesOf = (xs) => { const o = { Artist: 0, Producer: 0 }; for (const r of xs) { const sd = sideOf(r.role); if (sd) o[sd] += Number(r.percent) || 0; } return o; };
  const reason = Object.values(bad)[0] || (exact && Math.abs(sum - 100) >= 0.05 ? `It adds up to ${shownTotal}%. It has to be 100% to confirm.`
    : !exact && touched && sum > 100.05 ? `It adds up to ${shownTotal}%, more than 100%.` : null);
  if (reason || !touched) return { splits: rows, total: shownTotal, sides: sidesOf(next), edited: false, bad, reason };
  // the floats of one-decimal shares can miss 100 by a hair: a row that isn't the client's takes it (as evenSplit's
  // last unnamed row does), so the saved split is exactly 100 and never comes back to the list
  if (exact && total(next) !== 100) {
    const fix = [...next].reverse().find((r) => r.unnamed && r !== ownRow) || [...next].reverse().find((r) => r !== ownRow) || next[next.length - 1];
    const i = next.indexOf(fix);
    for (let k = 0; k < 3 && total(next) !== 100; k++) next[i] = { ...next[i], percent: Number(next[i].percent) + (100 - total(next)) };
  }
  return { splits: next, total: shownTotal, sides: sidesOf(next), edited: true, bad, reason: null };
}
// the route's own check of a split it's about to write the client's share of (the browser checked it with
// typedSplit; this is the same rule, for a request that didn't): null, or a few words
export function splitProblem(splits, { exact = true } = {}) {
  if (!Array.isArray(splits) || !splits.length || splits.length > 40) return "That split doesn't look right.";
  for (const r of splits) {
    const n = Number(r?.percent);
    if (!r || typeof r !== "object" || !Number.isFinite(n) || n < 0 || n > 100) return "Each share has to be between 0% and 100%.";
  }
  const sum = total(splits);
  if (exact && Math.abs(sum - 100) >= 0.05) return `It adds up to ${Math.round(sum * 10) / 10}%. It has to be 100%.`;
  if (!exact && sum > 100.05) return `It adds up to ${Math.round(sum * 10) / 10}%, more than 100%.`;
  return null;
}
// The rule for a share about to go into a song's row on the pub sheet (r11 todofix): the push route holds every
// caller to it (lib/sheet-writes.js), and To do's pre-check reads the same rule before anything changes.
//   percent  the % being written            sheet  the cell's % now (null: blank, or not a number)
//   site     the client's own % in the split it comes from (null: they aren't on it)
//   splits   that split                     check  "confirm": it adds up to exactly 100%; "merge": at most 100%;
//                                                  none: no total rule (the song editor saves a split that doesn't
//                                                  add up yet, as it always has)
// A cell that keeps its own share is always fine (a Save that only renames the row, a merge keeping the sheet's
// share). Else the share is the site's own, one decimal at most (an even share like a third, 50/3, is the site's
// own number and goes as it is), and the split follows the check. null, or a sentence
const evenShare = (n) => { for (let k = 1; k <= 40; k++) if (Math.abs(n - 100 / k) < 1e-9 || Math.abs(n - 50 / k) < 1e-9) return true; return false; };
export function pushShareProblem({ percent, sheet = null, site = null, splits = null, check = null, who = "The client" }) {
  const n = Number(percent);
  if (!Number.isFinite(n) || n <= 0 || n > 100) return `${who}'s share has to be more than 0% and at most 100%.`;
  if (sheet != null && Math.abs(Number(sheet) - n) < 1e-6) return null;
  if (site == null) return `${who} isn't on that song's split on the site.`;
  if (Math.abs(Number(site) - n) > 1e-9) return `${who}'s share on the site is ${pctText(site)}%, not ${pctText(n)}%. Reload the page and try again.`;
  if (Math.abs(n * 10 - Math.round(n * 10)) >= 1e-6 && !evenShare(n)) return `${who}'s share of ${n}% has more than one decimal. Type it like 33.3.`;
  return check === "confirm" || check === "merge" ? splitProblem(splits, { exact: check === "confirm" }) : null;
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
