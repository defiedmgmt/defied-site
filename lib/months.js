// Money's month table (r7 A2): only the months where Stripe and the sheet differ get a row; the ones that match
// fold into one line, in runs of months in a row ("March–September match", "January, March–September match").
// months: lib/accounting-checks.js's, oldest first ({ month: "2026-03", label: "March", diff, parts }). Pure.
export const monthMatches = (m) => !m.diff && !(m.parts || []).length;

export function foldMonths(months = []) {
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
    text: n ? `${words} ${n === 1 ? "matches" : "match"}` : "",
  };
}
