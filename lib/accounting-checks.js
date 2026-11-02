// The Accounting section's month-by-month check of Stripe against the accounting sheet. Pure: Stripe's
// list, the Income rows and the match (lib/accounting.js matchPayments + applyLog) come in, nothing is
// fetched or written. No new money maths: Stripe's side is each payment's fee by New York month (the
// money strip's commissionTotals), the sheet's side is the Income tab's DEFIED SHARE by the row's date
// (what Monthly Summary's SUMIF adds up). Only the differences, and what explains them, are new.
// Server-only, staff-only data.
import { cents, sheetDay, isTestPay } from "./accounting";
import { nyDay, nyMonth } from "./stripe";
import { personKey } from "./names";
import { createHash } from "node:crypto";

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const usd = (c) => `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const dayWord = (ymd) => `${SHORT[+ymd.slice(5, 7) - 1]} ${+ymd.slice(8, 10)}`; // "Oct 6"
export const monthWord = (ym) => LONG[+ym.slice(5, 7) - 1] || ym;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);

// "the Oct 6 test" / "the Oct 9 payment from Ella"
const whatPay = (p, nameOf) => `the ${dayWord(nyDay(p.at))} ${isTestPay(p) ? "test" : `payment${nameOf(p) ? ` from ${nameOf(p)}` : ""}`}`;
// A share a cent or less off is rounding (the sheet rounds each share, Stripe each fee): shown, never a check
export const ROUNDING = 1;
// Why a logged payment's DEFIED SHARE isn't Stripe's cut, in the sheet's own numbers
const afterMgr = (r) => {
  const ms = cents(r.managerShare) || 0, mgr = String(r.manager || "").trim();
  return ms && mgr ? ` (after ${usd(ms)} for ${mgr})` : "";
};
const shareWhy = (r, p) => `the sheet gives Defied ${usd(cents(r.defiedShare))}${afterMgr(r)}; Stripe kept ${usd(p.fee)} for Defied`;

// One row per month of the sheet's year so far: Stripe (Defied's share), the sheet (DEFIED SHARE),
// the difference (Stripe minus sheet) and the parts that explain it. `residual` is what nothing
// explains: not zero = "Not explained yet" (and a To check row).
export function reconcile({ list, rows, match, year, now = new Date(), nameOf = () => "" }) {
  const y = String(year);
  const last = nyMonth(now).slice(0, 4) === y ? nyMonth(now) : `${y}-12`;
  const M = new Map();
  const inYear = (ym) => ym.slice(0, 4) === y && ym <= last;
  const at = (ym) => { if (!M.has(ym)) M.set(ym, { stripe: 0, sheet: 0, parts: [] }); return M.get(ym); };
  for (const p of list || []) { const ym = nyMonth(p.at); if (inYear(ym)) at(ym).stripe += p.fee; }
  for (const r of rows || []) { const ym = sheetDay(r.date).slice(0, 7); if (ym && inYear(ym)) at(ym).sheet += cents(r.defiedShare); }
  // every month from the first with money through this one, a quiet month too
  const first = [...M.keys()].sort()[0];
  if (first) for (let k = +first.slice(5, 7); k <= +last.slice(5, 7); k++) at(`${y}-${String(k).padStart(2, "0")}`);
  // a part counts toward a month's difference (Stripe minus sheet): + Stripe has more, - the sheet has more
  // row: the Income row the part is about (the page links it)
  const part = (ym, c, text, kind, row = null) => { if (c && M.has(ym)) M.get(ym).parts.push({ c, text, kind, row }); };
  const rowOf = new Map((rows || []).map((r) => [r.row, r]));

  if (match) {
    // 1. payments the sheet doesn't have yet
    const late = new Map();
    for (const p of match.unlogged) { const ym = nyMonth(p.at); if (!late.has(ym)) late.set(ym, []); late.get(ym).push(p); }
    for (const [ym, ps] of late) part(ym, sum(ps, (p) => p.fee), `${usd(sum(ps, (p) => p.fee))} is ${plural(ps.length, "payment")} not logged yet`, "unlogged");
    // 2. a logged payment whose Stripe cut isn't its row's DEFIED SHARE, or whose row is dated in another month
    for (const p of [...match.matched, ...(match.loggedHere || [])]) {
      const r = rowOf.get(p.row);
      if (!r) continue;
      const pm = nyMonth(p.at), rm = sheetDay(r.date).slice(0, 7), share = cents(r.defiedShare);
      if (pm !== rm) {
        part(pm, p.fee, `${usd(p.fee)} is ${whatPay(p, nameOf)}, logged in ${monthWord(rm)} (row ${r.row})`, "moved", r.row);
        part(rm, -share, `${usd(share)} more in the sheet: row ${r.row} is ${whatPay(p, nameOf)}, paid in ${monthWord(pm)}`, "moved", r.row);
      } else if (p.fee !== share) {
        const gap = p.fee - share;
        // a cent is rounding, nothing to do; more is a To check row ("share") with Open row and Mark as OK
        if (Math.abs(gap) <= ROUNDING) part(pm, gap, `${usd(Math.abs(gap))} rounding on ${whatPay(p, nameOf)} (row ${r.row}), nothing to do`, "rounding", r.row);
        else part(pm, gap, `${usd(Math.abs(gap))} on ${whatPay(p, nameOf)}, row ${r.row}: ${shareWhy(r, p)}`, "share", r.row);
      }
    }
    // 3. several payments typed as one row (the August tests)
    const byId = new Map((list || []).map((p) => [p.id, p]));
    for (const t of match.together || []) {
      const r = rowOf.get(t.row);
      if (!r) continue;
      const ps = t.ids.map((id) => byId.get(id)).filter(Boolean);
      const rm = sheetDay(r.date).slice(0, 7);
      const per = new Map([[rm, -cents(r.defiedShare)]]);
      for (const p of ps) per.set(nyMonth(p.at), (per.get(nyMonth(p.at)) || 0) + p.fee);
      for (const [ym, c] of per) part(ym, c, `${usd(Math.abs(c))} on row ${r.row}, ${plural(ps.length, "payment")} logged as one row (sheet ${usd(cents(r.defiedShare))}, Stripe ${usd(sum(ps, (p) => p.fee))})`, "together", r.row);
    }
    // 4. rows no Stripe payment explains (cash, a bank deposit, a typo): each one is also a To check row
    const extra = new Map();
    for (const n of match.extraRows || []) { const r = rowOf.get(n); const ym = r && sheetDay(r.date).slice(0, 7); if (ym && cents(r.defiedShare)) { if (!extra.has(ym)) extra.set(ym, []); extra.get(ym).push(r); } }
    for (const [ym, rs] of extra) {
      const c = sum(rs, (r) => cents(r.defiedShare));
      part(ym, -c, `${usd(c)} more in the sheet: ${rs.length === 1 ? "row" : "rows"} ${rs.map((r) => r.row).join(", ")} ${rs.length === 1 ? "has" : "have"} no Stripe payment`, "extra", rs[0].row);
    }
  }

  return [...M.keys()].sort().map((ym) => {
    const m = M.get(ym), diff = m.stripe - m.sheet;
    const residual = diff - sum(m.parts, (x) => x.c);
    return { month: ym, label: monthWord(ym), stripe: m.stripe, sheet: m.sheet, diff, parts: m.parts, residual, explained: residual === 0 };
  });
}

// --- To check: read-only checks of the Income tab --------------------------------------------------
// Each finding is about one row (or a month): what's wrong, then what to do in plain words. Nothing is
// fixed from here: the owner opens the row and decides. `key` follows the row's content, so a
// "Mark as OK" holds until the row changes. `open` is the row Open row goes to when `row` is null.

const COMMISSION = "Management Commission";
const days = (a, b) => Math.abs(Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 864e5;
const mdy = (ymd) => `${+ymd.slice(5, 7)}/${+ymd.slice(8, 10)}/${ymd.slice(0, 4)}`;
const content = (r) => [sheetDay(r.date), r.type, r.client, cents(r.gross), r.account, r.notes].map((x) => String(x ?? "").trim()).join("|");
export const checkKey = (rule, ...parts) => createHash("sha1").update([rule, ...parts].join("\u0001")).digest("hex").slice(0, 20);
const sameWho = (r, p, nameOf) => {
  const k = personKey(r.client);
  return !!k && [nameOf(p), p.payerName].some((n) => personKey(n) === k);
};

export function checkRows({ rows, match, list, year, months = [], nameOf = () => "" }) {
  const y = String(year);
  const out = [];
  const add = (rule, r, text, key, open = null) => out.push({ rule, row: r ? r.row : null, text, key, ...(open ? { open } : {}) });
  const flagged = (r) => out.some((x) => x.row === r.row);
  const rowOf = new Map((rows || []).map((r) => [r.row, r]));
  const extra = new Set(match?.extraRows || []);
  const dated = (r) => !!sheetDay(r.date);

  for (const r of rows || []) {
    // a row dated in another year: the book's months and totals leave it out
    if (dated(r) && sheetDay(r.date).slice(0, 4) !== y) add("year", r, `Dated ${mdy(sheetDay(r.date))}, outside the ${y} book. Fix the date, or move the row to the ${sheetDay(r.date).slice(0, 4)} book.`, checkKey("year", content(r)));
    // a gap the sheet's totals or formulas need: Other Income rows leave Artist / Client blank on purpose
    const gaps = [!dated(r) && "Date", !String(r.type || "").trim() && "Revenue Type", !cents(r.gross) && "Gross Commission",
      String(r.type || "").trim() === COMMISSION && !String(r.client || "").trim() && "Artist / Client"].filter(Boolean);
    if (gaps.length) {
      const words = gaps.length === 1 ? gaps[0] : `${gaps.slice(0, -1).join(", ")} and ${gaps[gaps.length - 1]}`;
      const onlyClient = gaps.includes("Artist / Client") && gaps.length === 1;
      add("missing", r, `Missing ${words}${onlyClient ? ": a Management Commission row needs one. Pick the client from the INFO list." : `. Fill ${gaps.length === 1 ? "it" : "them"} in on the row.`}`, checkKey("missing", content(r)));
    }
  }

  // two rows that look like the same payment: same date, client and amount, with fewer Stripe payments
  // than rows behind them (two real payments that happen to match each have their own)
  const groups = new Map();
  for (const r of rows || []) {
    if (!dated(r) || !cents(r.gross)) continue;
    const k = `${sheetDay(r.date)}|${personKey(r.client)}|${cents(r.gross)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const loose = g.filter((r) => extra.has(r.row));
    if (!loose.length) continue;
    const first = g.find((r) => !extra.has(r.row)) || loose[0];
    for (const r of loose) if (r !== first) add("duplicate", r, `Same date, client and amount as row ${first.row}, with only one Stripe payment for them. If it was typed twice, delete one of the two rows.`, checkKey("duplicate", content(r), String(g.length)));
  }

  if (match) {
    // a row near a payment from the same client that the sheet doesn't have, with a different amount
    const used = new Set();
    for (const n of match.extraRows || []) {
      const r = (rows || []).find((x) => x.row === n);
      if (!r || !dated(r) || !cents(r.gross)) continue;
      const p = match.unlogged.find((q) => !used.has(q.id) && days(nyDay(q.at), sheetDay(r.date)) <= 3 && sameWho(r, q, nameOf) && q.amount !== cents(r.gross));
      if (p) { used.add(p.id); add("amount", r, `Gross Commission is ${usd(cents(r.gross))}, but the ${dayWord(nyDay(p.at))} Stripe payment from ${r.client} was ${usd(p.amount)}. Change Gross Commission to ${usd(p.amount)}.`, checkKey("amount", content(r), p.id, String(p.amount))); }
    }
    // the same, once that payment is logged in another row: the payment is now in the sheet twice
    const logged = [...match.matched, ...(match.loggedHere || [])];
    for (const n of match.extraRows || []) {
      const r = rowOf.get(n);
      if (!r || !dated(r) || !cents(r.gross) || flagged(r)) continue;
      const p = logged.find((q) => q.row && q.row !== r.row && days(nyDay(q.at), sheetDay(r.date)) <= 3 && sameWho(r, q, nameOf));
      if (p) add("twice", r, `Gross Commission is ${usd(cents(r.gross))}, near the ${dayWord(nyDay(p.at))} Stripe payment from ${r.client} (${usd(p.amount)}), which row ${p.row} already has. If both rows are for that payment, delete this one; if it's a different payment, mark it as OK.`, checkKey("twice", content(r), p.id, String(p.row)));
    }
    // a row for a payment Stripe refunded in full (it has nothing left to match)
    for (const p of list || []) {
      if (p.amount > 0 || nyDay(p.at).slice(0, 4) !== y) continue;
      const r = (rows || []).find((x) => extra.has(x.row) && dated(x) && days(nyDay(p.at), sheetDay(x.date)) <= 3 && sameWho(x, p, nameOf));
      if (r && !flagged(r)) add("refunded", r, `Logged for the ${dayWord(nyDay(p.at))} payment from ${r.client}, which was refunded in full in Stripe. Delete the row, or add a refund row, whichever you use.`, checkKey("refunded", content(r), p.id));
    }
    // any other row no Stripe payment explains: the month counts it, so the owner confirms it here
    for (const n of match.extraRows || []) {
      const r = rowOf.get(n);
      if (!r || !cents(r.defiedShare) || flagged(r)) continue;
      add("nopay", r, `No Stripe payment matches this row (${dated(r) ? mdy(sheetDay(r.date)) : "no date"}, ${String(r.client || "").trim() || "no client"}, ${usd(cents(r.gross))}). If it was paid another way (cash, a bank deposit), mark it as OK; if it repeats a payment that's already logged, delete it.`, checkKey("nopay", content(r)));
    }
    // a logged payment whose DEFIED SHARE is more than a cent off Stripe's cut (the Overview's "share" part)
    for (const p of logged) {
      const r = rowOf.get(p.row);
      if (!r || !dated(r) || nyMonth(p.at) !== sheetDay(r.date).slice(0, 7)) continue;
      const share = cents(r.defiedShare);
      if (Math.abs(p.fee - share) <= ROUNDING) continue;
      add("share", r, `DEFIED SHARE is ${usd(share)}${afterMgr(r)}, but Stripe kept ${usd(p.fee)} for Defied on ${whatPay(p, nameOf)}. The sheet takes the manager's percentage on INFO, Stripe the split the payment was taken with: if one is out of date, fix it; if the difference is expected, mark it as OK.`, checkKey("share", content(r), p.id, String(p.fee)));
    }
  }
  // a month whose difference nothing above explains: name the month's rows and payments that no
  // match accounts for (a row with no Gross Commission, a payment refunded but still charged a fee)
  const seenRow = new Set(), seenPay = new Set();
  if (match) {
    for (const p of [...match.matched, ...(match.loggedHere || []), ...match.loggedTogether, ...match.unlogged]) { seenPay.add(p.id); if (p.row) seenRow.add(p.row); }
    for (const t of match.together || []) seenRow.add(t.row);
    for (const n of match.extraRows || []) seenRow.add(n);
  }
  for (const m of months) {
    if (m.explained) continue;
    const rs = (rows || []).filter((r) => dated(r) && sheetDay(r.date).slice(0, 7) === m.month && cents(r.defiedShare) && !seenRow.has(r.row));
    const ps = (list || []).filter((p) => nyMonth(p.at) === m.month && p.fee && !seenPay.has(p.id));
    const names = [...rs.map((r) => `row ${r.row}`), ...ps.map((p) => whatPay(p, nameOf))];
    const look = names.length ? `Start with ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`}, which nothing matches.` : "Compare the month's rows on the Income tab with Stripe's payments for the month.";
    add("month", null, `${m.label}: ${usd(Math.abs(m.residual))} of the difference between Stripe and the sheet isn't explained by payments still to log or by the rows it lists. ${look}`, checkKey("month", m.month, String(m.stripe), String(m.sheet)), rs[0]?.row || null);
  }
  return out;
}
