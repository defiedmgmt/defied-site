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
// (2026-11-16, the owner: "their cut is confusing") one cut for all of a manager's artists, and only two to choose from: 66.7 / 33.3 or 50 / 50
// (Manager / Defied: SPLITS). No typed %, no "different %" per artist, no "apply to all?". A Founder's artists are Defied's whole commission: cut 0, no picker.
import { nearManagerEntry } from "../../lib/roles";

// a fraction as the form shows it (0.67 -> "67"), and a typed percent that can be written (0 to 100)
export const pctText = (x) => (x == null ? "" : String(Math.round(Number(x) * 10000) / 100));
export const pctOk = (v) => String(v ?? "").trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100;

// ---- "Their cut" (2026-11-16): the two splits on offer. pct: the percent the form sends (the server turns "66.7" into exactly 0.667: pages/api/people-sync.js
// pctIn), frac: what INFO's F holds, label: Manager / Defied.
export const SPLITS = [{ pct: "66.7", frac: 0.667, label: "66.7 / 33.3" }, { pct: "50", frac: 0.5, label: "50 / 50" }];
// the split INFO's F reads as, by its pct ("" when it is neither: 0.67 is 67%, not a split on offer; 2/3 and 0.6667 are 66.7); blank, text and 0 are none
export function splitOf(fraction) {
  if (fraction == null || fraction === "") return "";
  const x = Number(fraction);
  for (const s of SPLITS) if (Math.abs(x - s.frac) < 0.0005) return s.pct;
  return "";
}
// the split with this pct ("66.7" or "50"), or null
export function splitByPct(pct) {
  for (const s of SPLITS) if (s.pct === pct) return s;
  return null;
}
// a Founder's artists: Defied keeps the whole commission. There is no picker for a Founder; a new artist is sent with this cut (percent)
export const FOUNDER_CUT = 0;
export const FOUNDER_LINE = "Founders' artists: Defied keeps the whole commission (Manager Gets 0% on the sheet).";
// why Save is held when artists are being added and no split is picked (the form says "Their artists: " first)
export const PICK_CUT = "pick their cut (66.7 / 33.3 or 50 / 50).";

// The checklist filled from INFO as read (the company row is no artist). rows: what it shows, in INFO's order; on: each row's tick by INFO
// row; base: each row as it was read (its tick, its cut as a fraction, and its raw cells, which go back with a save so a row changed on INFO since is
// refused, never typed over). Ticked = E is exactly this name ("Cayden" is not "Caden", "caden" is not "Caden").
// theirCut: "Their cut", one split for the whole manager: the split ALL their artists have on INFO now; "" when they have artists and not all of them are on
// one split (nothing is picked for them: the form lists what the sheet has, and a pick rewrites every artist that isn't on it); "66.7" for a manager with no
// artists yet. theirCutBase: what it was filled as, to tell whether it was moved
export function fillChecklist(roster, manager) {
  const rows = (roster || []).filter((r) => !r.company);
  const f = { rows, on: {}, base: {}, theirCut: "", theirCutBase: "" };
  let n = 0, split = "", agree = true;
  for (const r of rows) {
    const mine = r.manager === manager;
    f.on[r.row] = mine;
    f.base[r.row] = { name: r.name, manager: r.manager, on: mine, cut: mine && r.cut != null ? r.cut : null, raw: r.raw || {} };
    if (!mine) continue;
    const s = splitOf(r.cut);
    if (n === 0) split = s; else if (s !== split) agree = false;
    n += 1;
  }
  const start = n === 0 ? SPLITS[0].pct : agree ? split : "";
  f.theirCut = start; f.theirCutBase = start;
  return f;
}

// "On the sheet now: Liyakk! 50%, bucketboy1021 67%. Pick a split to set all of them." for a manager whose artists aren't all on one split, until one is picked; "" otherwise
export function nowLine(f) {
  if (!f || f.theirCut !== "") return "";
  const parts = [];
  for (const r of f.rows) {
    const b = f.base[r.row];
    if (b.on) parts.push(`${b.name} ${b.cut == null ? "blank" : `${pctText(b.cut)}%`}`);
  }
  return parts.length ? `On the sheet now: ${parts.join(", ")}. Pick a split to set all of them.` : "";
}

// What was changed: [{ row, name, kind, send }]. kind: "tick" (nobody had them), "move" (another manager's), "untick" (no manager: Defied gets 100%), "cut"
// (still theirs and still ticked, and a split was picked that INFO's F isn't exactly: the pick rewrites it). send: the cut goes with the save. The artists that
// are theirs already are looked at only once the split was MOVED from how the form filled it (opening the form and saving rewrites no row, even one at 66.6667%
// that the form calls 66.7), and never for a Founder (their artists are left as they are; a new one goes in at 0).
export function checklistChanges(f, founder) {
  const out = [];
  if (!f) return out;
  const pick = founder || f.theirCut === f.theirCutBase ? null : splitByPct(f.theirCut);
  for (const r of f.rows) {
    const b = f.base[r.row], on = f.on[r.row];
    if (!b) continue;
    if (on && !b.on) out.push({ row: r.row, name: r.name, kind: b.manager ? "move" : "tick", send: true });
    else if (!on && b.on) out.push({ row: r.row, name: r.name, kind: "untick", send: false });
    else if (on && b.on && pick && !(typeof b.cut === "number" && Math.abs(b.cut - pick.frac) <= 1e-9)) out.push({ row: r.row, name: r.name, kind: "cut", send: true });
  }
  return out;
}

// the % a save sends with each ticked artist: a Founder's 0, else the split picked as a number (66.7 or 50); null when none is picked (the server refuses a tick with no cut)
export function cutSent(f, founder) {
  if (founder) return FOUNDER_CUT;
  const s = splitByPct(f ? f.theirCut : "");
  return s ? Number(s.pct) : null;
}

// The request's rows for those changes: the row, what it read when the checklist was filled (C name, D, E, F), ticked or
// not, and the cut as a percent (null: leave F as INFO has it)
export function checklistRows(f, changes, founder) {
  const out = [], cut = cutSent(f, founder);
  for (const c of changes) {
    const b = f.base[c.row];
    out.push({ row: c.row, was: { C: b.name, D: b.raw.D ?? "", E: b.raw.E ?? "", F: b.raw.F ?? "" }, on: c.kind !== "untick", cut: c.send ? cut : null });
  }
  return out;
}

// The line under an artist: where they stand now, or what saving will do ("moves from Hank" before it is saved). kind: the artist's change, if any
export function rowNote(f, row, kind) {
  const b = f.base[row], on = f.on[row];
  if (on && !b.on) return b.manager ? `moves from ${b.manager}` : "was no manager";
  if (on && b.on && kind === "cut") return b.cut == null ? "cut was blank" : `cut was ${pctText(b.cut)}%`;
  if (!on && b.on) return "no manager: Defied gets 100%";
  if (!on) return b.manager ? `with ${b.manager}` : "no manager: Defied gets 100%";
  return "";
}

// Why Save is off, or null: artists are being added (or moved) and no split is picked (never for a Founder: their artists go in at 0)
export function checklistWhy(f, changes, founder) {
  if (!f) return "Reading the accounting sheet…";
  if (!founder && f.theirCut === "") for (const c of changes) if (c.send) return PICK_CUT;
  return changes.length ? null : "Change something first.";
}

// an artist picked from the list is ticked, at the manager's one cut
export function tickRow(f, row) {
  return { ...f, on: { ...f.on, [row]: true } };
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

// The entry on INFO's manager list that `name` is near but not exactly (the list's own spelling is the only one a Save writes with): the same person by the
// site's own-artists rule either way round ("Hank Rivers" and "Hank", "caden" and "Caden"), or a near miss by the rule the people link uses (lib/names.js
// nearMiss, swaps included: "Jaime" next to "Jamie"), except a pair the owner has said are two people (Caden and Cayden). null when there is none. The server's
// "manager" action refuses it the same way (lib/people-sync.js planManager). managers: GET /api/people-sync's info.managers, [{ row, name }]
export function nearManager(managers, name) {
  return nearManagerEntry(managers, name);
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

// The checklist filled again from INFO as it reads now, with the ticks and the split the person had changed carried over: a refused save (INFO
// changed under it) can be tried again without ticking it all over. A row that is another artist now, or gone, isn't carried. old: the
// checklist as it was (fillChecklist's), or null
export function refillChecklist(roster, manager, old) {
  const f = fillChecklist(roster, manager);
  if (!old) return f;
  if (old.theirCut !== old.theirCutBase) f.theirCut = old.theirCut; // the split as they picked it
  for (const r of f.rows) {
    const b = old.base[r.row];
    if (!b || b.name !== r.name) continue;
    if (old.on[r.row] !== b.on) f.on[r.row] = old.on[r.row];
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
