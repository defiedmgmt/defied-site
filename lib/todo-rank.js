// Home's "Biggest tasks" (r7): which of To do's rows matter most, across ClickUp and the site. Pure,
// so the page and tests/todo-rank-unit.mjs use the same rule. Highest first:
//   1. overdue ClickUp tasks (urgent, then high, then the rest; the longest overdue first)
//   2. ClickUp tasks due today (by priority)
//   3. the site's own to-dos, by kind and then by weight: unlogged money by its dollars, an
//      opportunity closing within 48 hours, splits and song fixes
//      by their streams, contacts due by how many, amber sync checks, then everything else
//   4. ClickUp tasks due later (this week first), then ones with no date
// A ClickUp row is { kind: "clickup", due (ISO | null), priority }; a site row carries
// { rank: { kind, value } } (value: dollars, streams, a count, hours left…). Anything else ranks last.
const NY = "America/New_York";
export const SITE_KINDS = ["money", "opportunity", "fix", "contacts", "sync", "other"];
const PRIORITY = { urgent: 0, high: 1, normal: 2, low: 3 };
const pri = (p) => PRIORITY[p] ?? 4;
const DAY = 864e5;

export const nyDay = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: NY, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
const dayNum = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY;

// "overdue" | "today" | "week" (the next 7 days) | "later" | "none", in New York days
export function dueBucket(due, now = Date.now()) {
  if (!due) return "none";
  const d = dayNum(nyDay(due)), t = dayNum(nyDay(now));
  return d < t ? "overdue" : d === t ? "today" : d - t <= 7 ? "week" : "later";
}

// one sortable key per row: [tier, sub-order, -weight or due…]; lower sorts first
export function rankKey(x, now = Date.now()) {
  if (x.kind === "clickup") {
    const b = dueBucket(x.due, now), due = x.due ? Date.parse(x.due) : Infinity;
    if (b === "overdue") return [0, pri(x.priority) <= 1 ? pri(x.priority) : 2, due];
    if (b === "today") return [1, pri(x.priority), 0];
    return [3, b === "week" ? 0 : b === "later" ? 1 : 2, due === Infinity ? pri(x.priority) : due];
  }
  const k = SITE_KINDS.indexOf(x.rank?.kind);
  const kind = k === -1 ? SITE_KINDS.indexOf("other") : k;
  return [2, kind, -(Number(x.rank?.value) || 0)];
}
const cmp = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); if (d) return d; } return 0; };

// rows: To do's rows (site and ClickUp). Returns the top `limit` in order, and how many there are in all.
export function biggestTasks(rows, { now = Date.now(), limit = 5 } = {}) {
  const ranked = rows.map((x, i) => ({ x, key: [...rankKey(x, now), i] })).sort((a, b) => cmp(a.key, b.key)).map((r) => r.x);
  return { top: ranked.slice(0, limit), total: rows.length };
}
