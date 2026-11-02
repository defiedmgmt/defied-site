// The owner's default split (Nov 1): "the default is even". A song is half artist side, half producer
// side. Listed people with no share split their side evenly; a typed share s on a side means the side
// has round(50 / s) people, so the ones not listed are unnamed at s each; no artist (or producer)
// listed means one unnamed one at 50. A split that already adds up to 100% is never touched, and
// anything that can't be completed evenly is "look" (a person has to fix it), never guessed.
// Unnamed people are only for showing and confirming: they have no name, so they never match a client,
// and only the client's own share ever goes to the pub sheet.
// Pure: the song editor, Splits to confirm and the Dashboard's To do all read this one rule.

export const SIDES = ["Artist", "Producer"];
const SIDE = 50;
const MAX_PER_SIDE = 10; // 50/2 = 25 people is a typo on the way to 25, not a split
const EPS = 1e-9;

const total = (rows) => (rows || []).reduce((a, s) => a + Number(s.percent || 0), 0);
// "Co-producer" is the producer side; anything that isn't artist or producer has no side to fill
export const sideOf = (role) => (/prod/i.test(role || "") ? "Producer" : /artist/i.test(role || "") ? "Artist" : null);
const pct = (n) => String(Math.round(n * 10) / 10);
const look = (splits, reason) => ({ status: "look", splits, added: [], reason });

// rows: [{ id, name, role, percent, unnamed? }]. Returns { status: "ok" | "assumed" | "look", splits, added, reason? }:
// splits is the full split to show and save (the input itself for ok and look), added the unnamed rows it made
export function evenSplit(rows, makeId = () => Math.random().toString(36).slice(2, 10)) {
  const list = rows || [];
  if (total(list) === 100) return { status: "ok", splits: list, added: [] };
  // unnamed people are only ever this rule's own output: once the total is off they're made again from the named ones
  const named = list.filter((r) => !r.unnamed);
  if (!named.length) return look(list, "No one is on this song's split yet");
  const by = { Artist: [], Producer: [] };
  for (const r of named) {
    const side = sideOf(r.role);
    if (!side) return look(list, `${r.name || "Someone"} has no Artist or Producer role`);
    by[side].push(r);
  }
  const out = [];
  const added = [];
  for (const side of SIDES) {
    const people = by[side];
    const typed = people.filter((r) => Number(r.percent) > 0);
    const blank = people.filter((r) => !(Number(r.percent) > 0));
    const sum = total(typed);
    const word = side.toLowerCase();
    if (sum > SIDE + EPS) return look(list, `The ${word} side adds up to ${pct(sum)}%, more than 50%`);
    let n, each;
    if (!people.length) { n = 1; each = SIDE; }
    else if (!typed.length) { n = people.length; each = SIDE / n; }
    else if (Math.abs(sum - SIDE) < EPS) {
      if (blank.length) return look(list, `The ${word} side is already 50% without ${blank[0].name || "everyone"}`);
      n = people.length; each = null; // a full side keeps its typed shares (30 + 20 is fine)
    } else {
      const s = Number(typed[0].percent);
      if (typed.some((r) => Math.abs(Number(r.percent) - s) > 0.005)) return look(list, `Different ${word} shares are typed in (${typed.map((r) => pct(Number(r.percent))).join("% and ")}%)`);
      const k = SIDE / s;
      n = Math.round(k);
      if (Math.abs(k - n) > 0.05 || n > MAX_PER_SIDE) return look(list, `${pct(s)}% doesn't split the ${word} side's 50% evenly`);
      if (n < people.length) return look(list, `${people.length} ${word}s at ${pct(s)}% is more than 50%`);
      each = SIDE / n; // 16.67 typed is a third of the side: saved as exactly a third, so the song adds up to 100
    }
    for (const r of people) out.push(each == null ? r : { ...r, percent: each });
    for (let i = people.length; i < n; i++) {
      const row = { id: makeId(), name: "", role: side, percent: each, unnamed: true, label: n === 1 ? `${side} (unnamed)` : `${side} ${i + 1} (unnamed)` };
      out.push(row);
      added.push(row);
    }
  }
  // thirds and sixths don't add up exactly in floating point: the last unnamed row (or the last row) takes
  // the difference, so the saved split is exactly 100 and never comes back to the list
  const last = [...out].reverse().find((r) => r.unnamed) || out[out.length - 1];
  for (let i = 0; i < 3 && total(out) !== 100; i++) last.percent = Number(last.percent) + (100 - total(out));
  if (total(out) !== 100) return look(list, "The shares don't add up to 100%");
  return { status: "assumed", splits: out, added };
}

// the assumed split in words, for the list and the confirm: "Stack!e 25 · 1 unnamed producer 25 · artist 50"
export function splitWords(splits) {
  const named = [], partial = [], whole = [];
  for (const side of SIDES) {
    const rows = (splits || []).filter((r) => sideOf(r.role) === side);
    const unnamed = rows.filter((r) => r.unnamed);
    for (const r of rows) if (!r.unnamed) named.push(`${r.name || "Unnamed"} ${pct(Number(r.percent) || 0)}`);
    if (!unnamed.length) continue;
    const word = side.toLowerCase();
    // the people beside someone named read first, then a side that's one unnamed person ("artist 50")
    if (unnamed.length === rows.length && rows.length === 1) whole.push(`${word} ${pct(Number(unnamed[0].percent))}`);
    else partial.push(`${unnamed.length} unnamed ${word}${unnamed.length === 1 ? "" : "s"} ${pct(Number(unnamed[0].percent))}`);
  }
  return [...named, ...partial, ...whole].join(" · ");
}

// the split to save: the even default when the rule fills it, otherwise exactly what was typed
export const filledSplits = (rows) => {
  const r = evenSplit(rows);
  return r.status === "assumed" ? r.splits : rows || [];
};
