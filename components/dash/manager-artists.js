// Site › Users' checklist of a manager's artists (components/dash/admin.jsx ManagerArtists), the parts with no screen in
// them, so tests/manager-artists.mjs can run them without a browser. (Plain loops, never an arrow function inside one of these
// that reads its argument: Next's production build inlines these into the component and, on the 14.2.35 minifier, drops the
// argument's name from the inlined copy: "changes is not defined", only in the built page. The browser run caught it.) The owner (2026-11-14): "can we just have like a
// select box for his artists and have that sync to the accounting sheet". roster: GET /api/people-sync's info.roster (each
// INFO client row: row, name, manager, cut as a fraction, raw D/E/F as INFO holds them), manager: exactly a name on INFO's
// manager list. Saved by POST /api/people-sync { action: "manager-artists" } (lib/people-sync.js saveManagerArtists).
// (2026-11-15, one place) the checklist is part of the person's own form and the form's one Save writes it (admin.jsx UsersAdmin):
// artistsPart says what the form shows, sheetSteps what that Save sends to the sheet, refillChecklist keeps the ticks of a refused save,
// and savedLine / notSavedLine are its one line.
import { personKey } from "../../lib/names";
import { sameManager } from "../../lib/roles";

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
  // theirCut: "Their cut", one % for the whole manager (INFO's Manager Gets %, column F), at the cut most of their artists have now; "" for a
  // manager with none (never made up: it is typed). theirCutBase: what it was filled as, to tell whether it was changed
  const f = { rows, on: {}, cut: {}, base: {}, theirCut: common, theirCutBase: common };
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
  for (const c of changes) {
    if (!c.send || pctOk(f.cut[c.row])) continue;
    // an artist with no % of their own follows "Their cut": when that is what can't be written, it is the field to fix
    if (!pctOk(f.theirCut) && String(f.cut[c.row] ?? "").trim() === String(f.theirCut ?? "").trim()) return `Type ${manager}'s cut (Their cut) as a number from 0 to 100.`;
    return `Type ${manager}'s cut for ${c.name} as a number from 0 to 100.`;
  }
  return changes.length ? null : "Change something first.";
}

// ---- "Their cut" (2026-11-15): one % for the manager, applied to each artist they are given. The owner: "maybe we can setup the co manager
// split like when we're adding the manager like we can type it". A chip gets its own % only as an exception ("different %"). Defied's share
// (INFO's G) is the sheet's own formula: it is never written.

// Does this artist have a % of their own (one that is not Their cut)?
export function differs(f, row) {
  return String(f.cut[row] ?? "").trim() !== String(f.theirCut ?? "").trim();
}
// "Their cut" typed: the artists who aren't theirs yet follow it (a ticked one with a % of its own keeps it); the ones that are theirs keep
// what INFO has until the person says to apply it to them too (applyToAll)
export function setTheirCut(f, text) {
  const was = String(f.theirCut ?? "").trim(), cut = { ...f.cut };
  for (const r of f.rows) {
    if (f.base[r.row].on) continue;
    if (!f.on[r.row] || String(cut[r.row] ?? "").trim() === was) cut[r.row] = text;
  }
  return { ...f, theirCut: text, cut };
}
// the artists that are theirs on INFO and still ticked
export function currentArtists(f) {
  const out = [];
  if (!f) return out;
  for (const r of f.rows) if (f.on[r.row] && f.base[r.row].on) out.push(r);
  return out;
}
// "Apply 30% to all 4 artists?" yes: every artist that is theirs on INFO and still ticked takes Their cut
export function applyToAll(f, text) {
  const cut = { ...f.cut };
  for (const r of currentArtists(f)) cut[r.row] = text;
  return { ...f, cut };
}
// an artist picked from the list: a new one starts at Their cut (one that was theirs and taken off in this form comes back at their own)
export function tickRow(f, row) {
  const cut = { ...f.cut };
  if (!f.base[row].on) cut[row] = f.theirCut;
  return { ...f, on: { ...f.on, [row]: true }, cut };
}

// "1 added, 2 moved from another manager, 1 taken off, 1 cut changed" for the changes not saved yet
export function changeWords(changes) {
  const n = { tick: 0, move: 0, untick: 0, cut: 0 };
  for (const c of changes) n[c.kind] += 1;
  return [n.tick && `${n.tick} added`, n.move && `${n.move} moved from another manager`, n.untick && `${n.untick} taken off`, n.cut && `${n.cut} cut changed`].filter(Boolean).join(", ");
}

// Is `name` exactly a name on INFO's manager list (L4:L13)? The list's own spelling and nothing near it: "Hank Rivers" is not
// "Hank", "caden" is not "Caden", "Cayden" is not "Caden". managers: GET /api/people-sync's info.managers, [{ row, name }]
export function onManagerList(managers, name) {
  for (const m of managers || []) if (m.name === name) return true;
  return false;
}

// A name one letter away from another (a letter added, dropped or changed), both at least four letters so "Ed" and "Al" are never near
// each other. x, y: personKeys. "cayden" and "caden" are one apart: that is why "Cayden" can't be added next to "Caden" by a Save.
function oneApart(x, y) {
  if (x === y || x.length < 4 || y.length < 4 || x.length - y.length > 1 || y.length - x.length > 1) return false;
  let i = 0;
  while (i < x.length && i < y.length && x.charAt(i) === y.charAt(i)) i++;
  return x.slice(x.length >= y.length ? i + 1 : i) === y.slice(y.length >= x.length ? i + 1 : i);
}

// The entry on INFO's manager list that `name` is near but not exactly (the list's own spelling is the only one a Save writes with): the
// same person by the site's own-artists rule either way round ("Hank Rivers" and "Hank", "caden" and "Caden"), or one letter apart
// ("Cayden" and "Caden"). null when there is none. managers: GET /api/people-sync's info.managers, [{ row, name }]
export function nearManager(managers, name) {
  const n = String(name ?? "").trim();
  if (!n) return null;
  const k = personKey(n);
  for (const m of managers || []) {
    if (m.name === n) continue;
    if (sameManager(m.name, n) || sameManager(n, m.name) || oneApart(personKey(m.name), k)) return m;
  }
  return null;
}

// What Site › Users' form shows for a person's artists (2026-11-15: a Founder too, and a name that isn't on the list yet). pick: the form's
// role (founder, comanager, intern, client). sheetPicks: the viewer has Money and isn't limited to their own artists (the server refuses anyone
// else). managers: INFO's list, null when it hasn't been read. name: the form's name, trimmed.
//   null      nothing: an Intern, a Client, or a viewer who can't pick from the sheet
//   "name"    no name typed yet
//   "wait"    the list isn't read yet
//   "listed"  the name is exactly on the list: their artists
//   "near"    not on the list, but the list has a near name (nearManager): never added, the form says what the list has
//   "new"     not on the list and nothing near: Save adds them (a Co-manager always, a Founder only to give them artists)
export function artistsPart(pick, sheetPicks, managers, name) {
  if (!sheetPicks || (pick !== "comanager" && pick !== "founder")) return null;
  if (!name) return "name";
  if (!managers) return "wait";
  if (onManagerList(managers, name)) return "listed";
  return nearManager(managers, name) ? "near" : "new";
}

// What the form's one Save writes to the accounting sheet, in order: "manager" (the name goes on INFO's list: a Co-manager always, a
// Founder only when there are artists to save) then "manager-artists" (the changed ticks). [] = the account alone. part: artistsPart's
// answer, pick: the form's role, changes: how many ticks changed
export function sheetSteps(part, pick, changes) {
  const out = [];
  if (part !== "listed" && part !== "new") return out;
  if (part === "new" && (pick === "comanager" || changes > 0)) out.push("manager");
  if (changes > 0) out.push("manager-artists");
  return out;
}

// The checklist filled again from INFO as it reads now, with the ticks and cuts the person had changed carried over: a refused save (INFO
// changed under it) can be tried again without ticking it all over. A row that is another artist now, or gone, isn't carried. old: the
// checklist as it was (fillChecklist's), or null
export function refillChecklist(roster, manager, old) {
  const f = fillChecklist(roster, manager);
  if (!old) return f;
  if (String(old.theirCut ?? "") !== String(old.theirCutBase ?? "")) f.theirCut = old.theirCut; // Their cut as they typed it
  for (const r of f.rows) {
    const b = old.base[r.row];
    if (!b || b.name !== r.name) continue;
    const on = old.on[r.row], cut = old.cut[r.row];
    if (on !== b.on || (on && b.on && String(cut ?? "").trim() !== b.cut)) { f.on[r.row] = on; f.cut[r.row] = cut; }
  }
  return f;
}

// The line under an artist in the list to pick from: who has them now, or that they were just taken off
export function pickNote(f, row) {
  const b = f.base[row];
  if (b.on) return "taken off";
  return b.manager ? `with ${b.manager}` : "no manager";
}

// The rows of the list to pick from: the artists not ticked, in INFO's order, those whose name has what was typed (no case)
export function pickRows(f, typed) {
  const out = [], q = String(typed ?? "").trim().toLowerCase();
  if (!f) return out;
  for (const r of f.rows) {
    if (f.on[r.row]) continue;
    if (q && String(r.name).toLowerCase().indexOf(q) < 0) continue;
    out.push(r);
  }
  return out;
}

// What the form says after its Save, in one line. savedLine: the account is saved and what went to the sheet (texts, the sentences
// the server gave) went through; alarm: something to look at (the line is then red). notSavedLine: the account is saved and the sheet
// part was refused: "Saved. Their artists weren't saved: <reason>. Try again." (done: what did go through before the refusal)
export function savedLine(texts, alarm) {
  const parts = ["Saved."];
  for (const t of texts || []) parts.push(t);
  if (alarm) parts.push(alarm);
  return parts.join(" ");
}
export function notSavedLine(reason, done) {
  const why = String(reason || "That didn't go through.").trim().replace(/[.\s]+$/, "");
  const parts = ["Saved."];
  for (const t of done || []) parts.push(t);
  parts.push(`Their artists weren't saved: ${why}.${/\bagain\b/i.test(why) ? "" : " Try again."}`);
  return parts.join(" ");
}
