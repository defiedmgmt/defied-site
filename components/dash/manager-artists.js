// Site › Users' checklist of a manager's artists (components/dash/admin.jsx ManagerArtists), the parts with no screen in
// them, so tests/manager-artists.mjs can run them without a browser. (Plain loops, never an arrow function inside one of these
// that reads its argument: Next's production build inlines these into the component and, on the 14.2.35 minifier, drops the
// argument's name from the inlined copy: "changes is not defined", only in the built page. The browser run caught it.) The owner (2026-11-14): "can we just have like a
// select box for his artists and have that sync to the accounting sheet". roster: GET /api/people-sync's info.roster (each
// INFO client row: row, name, manager, cut as a fraction, raw D/E/F as INFO holds them), manager: exactly a name on INFO's
// manager list. Saved by POST /api/people-sync { action: "manager-artists" } (lib/people-sync.js saveManagerArtists).

// a fraction as the form shows it (0.67 -> "67"), and a typed percent that can be written (0 to 100)
export const pctText = (x) => (x == null ? "" : String(Math.round(Number(x) * 10000) / 100));
export const pctOk = (v) => String(v ?? "").trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100;

// The cut most of this manager's artists have, as text; a tie goes to the artist higher up on INFO; "" when none of them
// has one yet (a cut is never made up: it is typed)
export function commonCut(roster, manager) {
  const n = new Map();
  for (const r of roster) if (r.manager === manager && r.cut != null) { const t = pctText(r.cut); n.set(t, (n.get(t) || 0) + 1); }
  let best = "", most = 0;
  for (const [t, c] of n) if (c > most) { best = t; most = c; }
  return best;
}

// The checklist filled from INFO as read (the company row is no artist). rows: what it shows, in INFO's order; on / cut:
// each row's tick and cut text by INFO row; base: each row as it was read (its tick, cut text and raw cells, which go
// back with a save so a row changed on INFO since is refused, never typed over). Ticked = E is exactly this name ("Cayden"
// is not "Caden", "caden" is not "Caden"). A ticked row starts at its own cut; a row that isn't theirs starts at their
// most common cut, ready for a tick.
export function fillChecklist(roster, manager) {
  const rows = (roster || []).filter((r) => !r.company), common = commonCut(rows, manager);
  const f = { rows, on: {}, cut: {}, base: {} };
  for (const r of rows) {
    const mine = r.manager === manager, own = mine && r.cut != null ? pctText(r.cut) : "";
    f.on[r.row] = mine;
    f.cut[r.row] = mine ? own : common;
    f.base[r.row] = { name: r.name, manager: r.manager, on: mine, cut: own, raw: r.raw || {} };
  }
  return f;
}

// What was changed: [{ row, name, kind, send }]. kind: "tick" (nobody had them), "move" (another manager's), "untick" (no
// manager: Defied gets 100%), "cut" (still theirs, the cut typed over). send: the cut goes with the save (a ticked row's
// cut is sent only when it is new or typed over, so 66.6667% on INFO isn't rewritten as 66.67).
export function checklistChanges(f) {
  const out = [];
  if (!f) return out;
  for (const r of f.rows) {
    const b = f.base[r.row], on = f.on[r.row], text = String(f.cut[r.row] ?? "").trim();
    if (!b) continue;
    if (on && !b.on) out.push({ row: r.row, name: r.name, kind: b.manager ? "move" : "tick", send: true });
    else if (!on && b.on) out.push({ row: r.row, name: r.name, kind: "untick", send: false });
    else if (on && b.on && text !== b.cut) out.push({ row: r.row, name: r.name, kind: "cut", send: true });
  }
  return out;
}

// The request's rows for those changes: the row, what it read when the checklist was filled (C name, D, E, F), ticked or
// not, and the cut as a percent (null: leave F as INFO has it)
export function checklistRows(f, changes) {
  const out = [];
  for (const c of changes) {
    const b = f.base[c.row];
    out.push({ row: c.row, was: { C: b.name, D: b.raw.D ?? "", E: b.raw.E ?? "", F: b.raw.F ?? "" }, on: c.kind !== "untick", cut: c.send ? Number(f.cut[c.row]) : null });
  }
  return out;
}

// The line under an artist: where they stand now, or what saving will do ("moves from Hank" before it is saved)
export function rowNote(f, row) {
  const b = f.base[row], on = f.on[row];
  if (on && !b.on) return b.manager ? `moves from ${b.manager}` : "was no manager";
  if (on && b.on && String(f.cut[row] ?? "").trim() !== b.cut) return b.cut ? `cut was ${b.cut}%` : "cut was blank";
  if (!on && b.on) return "no manager: Defied gets 100%";
  if (!on) return b.manager ? `with ${b.manager}` : "no manager: Defied gets 100%";
  return "";
}

// Why Save is off, or null: a ticked row that is new or typed over needs a cut from 0 to 100
export function checklistWhy(f, changes, manager) {
  if (!f) return "Reading the accounting sheet…";
  for (const c of changes) if (c.send && !pctOk(f.cut[c.row])) return `Type ${manager}'s cut for ${c.name} as a number from 0 to 100.`;
  return changes.length ? null : "Change something first.";
}

// "1 added, 2 moved from another manager, 1 taken off, 1 cut changed" for the changes not saved yet
export function changeWords(changes) {
  const n = { tick: 0, move: 0, untick: 0, cut: 0 };
  for (const c of changes) n[c.kind] += 1;
  return [n.tick && `${n.tick} added`, n.move && `${n.move} moved from another manager`, n.untick && `${n.untick} taken off`, n.cut && `${n.cut} cut changed`].filter(Boolean).join(", ");
}
