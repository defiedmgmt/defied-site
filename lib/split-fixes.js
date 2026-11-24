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
import { sideOf, songSplit, defaultSplit } from "./splits";
import { findByName, personKey } from "./names";
import { splitPct, roundPct, snapSplits, exactShare, longShare, TWO_DECIMALS, ROUNDING_GAP, TOTAL_OFF } from "./pct";

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

// (2026-11-10, the owner: "it doesnt let me fix") a song whose split adds up here but whose client's share isn't the one
// on their row (compareSplits in lib/sync-checks.js; a blank on the sheet is Songs to update's "no writer share").
// Splits to confirm lists it with a split to Confirm or type over: the default split (lib/splits.js) when the site's
// is the client alone or leaves them out (no real split yet), else the site's own. Confirm saves it and writes the client's share to
// their row, as every Confirm does. [{ p, client, r: { status, splits, added, differ: { site, sheet } } }]
export function shareDiffers({ placements = [], clients = [], facts = {}, makeId }) {
  const byId = new Map(clients.map((c) => [c.id, c]));
  const out = [];
  for (const p of placements) {
    const c = byId.get(clientOf(p)), f = facts.songs?.[p.id];
    if (!c || !f || f.share == null || facts.clients?.[c.id] == null || !near(total(p.splits), 100)) continue;
    const keys = new Set([personKey(c.name), personKey(c.credit)].filter(Boolean));
    const named = (p.splits || []).filter((r) => !r.unnamed), own = named.find((r) => keys.has(personKey(r.name)));
    const site = own ? Number(own.percent) || 0 : 0;
    // (2026-11-23) only a hair is rounding now (0.05 of a point, was 0.5): 33 here against 33.33 on the sheet is a difference, 33.33 against 33.3333 is not
    if (Math.abs(site - Number(f.share)) <= ROUNDING_GAP) continue;
    const alone = !own || named.length === 1; // the client alone, or not on it at all
    const d = alone && defaultSplit({ rows: named.map((r) => ({ ...r, percent: 0 })), client: c, artist: p.artist, makeId });
    out.push({ p, client: c, r: { ...(d || { status: "assumed", splits: p.splits || [], added: [] }), differ: { site, sheet: Number(f.share) } } });
  }
  return out;
}

// one % typed into a box: 100 at most, two decimals at most (33.33, 16.67). A number that is an exact fraction (a third, 33.333333333333336: what a
// saved split holds) passes as it is, and so does one pasted with up to six decimals that is such a fraction (16.666667 is a sixth: the fraction is what is
// kept, lib/pct.js longShare); any other third decimal is refused. { n } or { reason } or { negative }
function parsePct(v) {
  if (typeof v === "number" && exactShare(v)) return { n: v };
  const t = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim().replace(/\s*%$/, "").replace(",", ".") : "";
  if (!t) return { reason: "Type a share." };
  if (/^-/.test(t)) return { negative: true };
  if (/^\d*\.\d{3,}$/.test(t)) { const s = longShare(t); return s == null ? { reason: TWO_DECIMALS } : { n: s }; }
  if (!/^(\d+(\.\d{1,2})?|\.\d{1,2})$/.test(t)) return { reason: "Type a number, like 50." };
  const n = Number(t);
  if (n > 100) return { reason: "100% at most." };
  return { n };
}
// a share typed into "Fill in the sheet's blank share" (r11, the owner: "there should be like a way that i can type
// this in"): more than 0, at most 100, two decimals at most (33.33; 2026-11-23, was one: 33.3 is not a third). { share } or { reason }, a few words for the dialog
export function typedShare(v) {
  const p = parsePct(v);
  if (p.negative || p.n === 0) return { reason: "It has to be more than 0%." };
  if (p.reason) return { reason: p.reason };
  return { share: p.n };
}
// a % typed into one person's box of a split (r11 todoedit): 0 to 100, two decimals at most. { pct } or { reason }
// (0 is allowed here: a person listed with no share; typedShare above is the one cell that has to be more than 0)
export function typedPct(v) {
  const p = parsePct(v);
  if (p.negative) return { reason: "It can't be below 0%." };
  if (p.reason) return { reason: p.reason };
  return { pct: p.n };
}
// a % as a box shows it: two decimals, no trailing zeros (16.666… is "16.67", 50 is "50"; lib/pct.js)
export const pctText = (n) => splitPct(n);
// A split typed in a confirm card. splits: what the site worked out (the even split, the merge's split); typed:
// { rowId: the box's text }. While every box still shows what it was given, the split is the input itself, exact (a
// third stays a third: an untouched card saves exactly what it did before r11). Once one box changes, that box is the
// number typed (two decimals) and the boxes that still show what they were given keep their exact share, then the whole
// split is snapped (lib/pct.js snapSplits: 33.33 + 33.33 + 33.34 is three thirds, 16.67 + 83.33 is a sixth and five
// sixths) and added up (2026-11-23: it has to be 100 within 0.01 of a point, was 0.05). exact: the total must be
// 100 (a Confirm); else at most 100 once a box is changed (the merge, which already keeps a split that doesn't add
// up, and leaves an untouched one as it was). own: the client's
// name: their box can't be typed down to 0 (their share is the one written to the sheet). Returns { splits, total,
// sides: { Artist, Producer }, edited, bad: { rowId: reason }, reason }
export function typedSplit(splits, typed = {}, { exact = true, own = null } = {}) {
  const rows = splits || [], bad = {};
  const text = (r) => (typed[r.id] == null ? pctText(Number(r.percent) || 0) : String(typed[r.id]).trim().replace(/\s*%$/, ""));
  const shows = (r) => text(r) === pctText(Number(r.percent) || 0); // the box still says what it was given
  const touched = rows.some((r) => !shows(r));
  const next = !touched ? rows : rows.map((r) => {
    if (shows(r)) return r;
    const v = typedPct(text(r));
    if (v.reason) { bad[r.id] = v.reason; return r; }
    return Math.abs(v.pct - (Number(r.percent) || 0)) < 1e-9 ? r : { ...r, percent: v.pct };
  });
  const ownRow = own ? findByName(next, own) : null;
  // (only a box typed down to 0: a split that already had the client at 0 is left as the site had it)
  if (ownRow && touched && !bad[ownRow.id] && !(Number(ownRow.percent) > 0) && text(ownRow) !== pctText(Number(findByName(rows, own)?.percent) || 0)) bad[ownRow.id] = `${ownRow.name || "The client"}'s share has to be more than 0%.`;
  // snapped before it is added up: 33.33 three times is a whole song, and so is 16.67 + 83.33
  let out = snapSplits(next);
  const sum = total(out), shownTotal = roundPct(sum), off = Math.abs(sum - 100) > TOTAL_OFF + 1e-9;
  const sidesOf = (xs) => { const o = { Artist: 0, Producer: 0 }; for (const r of xs) { const sd = sideOf(r.role); if (sd) o[sd] += Number(r.percent) || 0; } return o; };
  const reason = Object.values(bad)[0] || (exact && off ? `It adds up to ${splitPct(sum)}%. It has to be 100% to confirm.`
    : !exact && touched && sum > 100 + TOTAL_OFF + 1e-9 ? `It adds up to ${splitPct(sum)}%, more than 100%.` : null);
  if (reason || !touched) return { splits: reason ? rows : out, total: shownTotal, sides: sidesOf(out), edited: false, bad, reason };
  // the floats can miss 100 by a hair (or a shy hundredth is let through): a row that isn't the client's takes it (as evenSplit's
  // last unnamed row does), so the saved split is exactly 100 and never comes back to the list. (2026-11-23) Then snapped again: the hundredth
  // can make the split the thirds it was typed as (33.34 / 33.33 / 33.32 plus the hundredth is 33.34 / 33.33 / 33.33), and every save snaps it, so the browser and the server agree
  if (exact && total(out) !== 100) {
    out = [...out];
    const ownId = ownRow?.id;
    const fix = [...out].reverse().find((r) => r.unnamed && r.id !== ownId) || [...out].reverse().find((r) => r.id !== ownId) || out[out.length - 1];
    const i = out.indexOf(fix);
    for (let k = 0; k < 3 && total(out) !== 100; k++) out[i] = { ...out[i], percent: Number(out[i].percent) + (100 - total(out)) };
    out = snapSplits(out);
  }
  return { splits: out, total: shownTotal, sides: sidesOf(out), edited: true, bad, reason: null };
}
// the route's own check of a split it's about to write the client's share of (the browser checked it with
// typedSplit; this is the same rule, for a request that didn't): null, or a few words
export function splitProblem(splits, { exact = true } = {}) {
  if (!Array.isArray(splits) || !splits.length || splits.length > 40) return "That split doesn't look right.";
  for (const r of splits) {
    const n = Number(r?.percent);
    if (!r || typeof r !== "object" || !Number.isFinite(n) || n < 0 || n > 100) return "Each share has to be between 0% and 100%.";
  }
  const sum = total(snapSplits(splits));
  if (exact && Math.abs(sum - 100) > TOTAL_OFF + 1e-9) return `It adds up to ${splitPct(sum)}%. It has to be 100%.`;
  if (!exact && sum > 100 + TOTAL_OFF + 1e-9) return `It adds up to ${splitPct(sum)}%, more than 100%.`;
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
// share). Else the share is the site's own, two decimals at most (2026-11-23, was one; an exact fraction like a third,
// 50/3, or five sixths, which the site keeps as they are, goes as it is), and the split follows the check. null, or a sentence
const evenShare = (n) => { for (let k = 1; k <= 40; k++) if (Math.abs(n - 100 / k) < 1e-9 || Math.abs(n - 50 / k) < 1e-9) return true; return false; };
export function pushShareProblem({ percent, sheet = null, site = null, splits = null, check = null, who = "The client" }) {
  const n = Number(percent);
  if (!Number.isFinite(n) || n <= 0 || n > 100) return `${who}'s share has to be more than 0% and at most 100%.`;
  if (sheet != null && Math.abs(Number(sheet) - n) < 1e-6) return null;
  if (site == null) return `${who} isn't on that song's split on the site.`;
  if (Math.abs(Number(site) - n) > 1e-9) return `${who}'s share on the site is ${pctText(site)}%, not ${pctText(n)}%. Reload the page and try again.`;
  if (Math.abs(n * 100 - Math.round(n * 100)) >= 1e-6 && !evenShare(n) && !exactShare(n)) return `${who}'s share of ${Math.round(n * 1e6) / 1e6}% has more than two decimals. Type it like 33.33.`;
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
    const r = songSplit(p, c);
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
