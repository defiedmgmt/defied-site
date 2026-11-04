// Money's month table (r7 A2): only the months where Stripe and the sheet differ get a row; the ones that match
// fold into one line, in runs of months in a row ("March–September match", "January, March–September match").
// months: lib/accounting-checks.js's, oldest first ({ month: "2026-03", label: "March", diff, parts }). Pure.
export const monthMatches = (m) => !m.diff && !(m.parts || []).length;

// current: this month ("2026-11"). With nothing in it yet (Stripe $0, sheet $0) it isn't called a match:
// it's left out of the line and said apart as quiet ("November: nothing yet", list A 8).
export function foldMonths(months = [], { current = null } = {}) {
  const isQuiet = (m) => !!current && m.month === current && monthMatches(m) && m.stripe === 0 && m.sheet === 0;
  const quiet = months.filter(isQuiet);
  months = months.filter((m) => !isQuiet(m));
  const runs = [];
  let run = null;
  for (const m of months) {
    if (!monthMatches(m)) { run = null; continue; }
    if (run) run.push(m); else runs.push((run = [m]));
  }
  const n = runs.reduce((a, r) => a + r.length, 0);
  const words = runs.map((r) => (r.length === 1 ? r[0].label : `${r[0].label}–${r[r.length - 1].label}`)).join(", ");
  return {
    differ: months.filter((m) => !monthMatches(m)).reverse(), // newest first, as the table reads
    matched: n,
    rows: runs.flat().reverse(), // the matching months' own rows, newest first (what the line opens)
    text: n ? `${words} ${n === 1 ? "matches" : "match"}` : "",
    quiet: quiet.map((m) => m.label),
  };
}
