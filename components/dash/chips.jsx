import { ChevronRight } from "lucide-react";

// Small pieces every dashboard section and the shell use (list B #11: kept out of the sections' own
// modules, so loading one section never pulls in another). dataPost: POST /api/data.

export const dataPost = async (body) => {
  const r = await fetch("/api/data", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "defied-site" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Couldn't save that — try again.");
  return j;
};

// A dashboard tab's one link to its to-dos: "3 to do ›", opening To do on that area (none: nothing shown)
export function TodoChip({ n, area, onGo }) {
  if (!n) return null;
  return <button type="button" className="todo-chip" data-area={area} data-todo-chip={area} onClick={() => onGo("todo", area)}>{n} to do <ChevronRight size={14} aria-hidden="true" /></button>;
}
// a flat week (rounds to 0.0%) has no arrow: it went neither up nor down
const flatPct = (p) => Math.abs(p) < 0.05;
export const pctText = (p) => (flatPct(p) ? "0.0%" : `${p >= 0 ? "▲" : "▼"} ${Math.abs(p).toFixed(1)}%`);
// the week-on-week % as one pill everywhere: ▲ green up, ▼ red down, grey when flat; nothing when there's no last week
export const WowPill = ({ pct, big }) => (pct == null ? null : <span className={big ? "wow-pill big" : "wow-pill"} data-dir={flatPct(pct) ? "flat" : pct >= 0 ? "up" : "down"}>{pctText(pct)}</span>);
export const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "");
