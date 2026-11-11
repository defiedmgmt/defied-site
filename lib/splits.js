// The owner's default split (Nov 1): "the default is even". A song is half artist side, half producer
// side. Listed people with no share split their side evenly; a typed share s on a side means the side
// has round(50 / s) people, so the ones not listed are unnamed at s each; no artist (or producer)
// listed means one unnamed one at 50. A split that already adds up to 100% is never touched, and
// anything that can't be completed evenly is "look" (a person has to fix it), never guessed.
// Unnamed people are only for showing and confirming: they have no name, so they never match a client,
// and only the client's own share ever goes to the pub sheet.
// Pure: the song editor, Splits to confirm and the Dashboard's To do all read this one rule.
import { personKey } from "./names";

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
      n = Math.round(SIDE / s);
      // the typed share must be the even share as it's written (16.67, 16.7 and 16.66 are a third), never just
      // near it: 48 is not 50, and 24.5 is not a quarter, so those go to a person instead of being rounded away
      if (!(n >= 1) || n > MAX_PER_SIDE || Math.abs(s - SIDE / n) > 0.05 + EPS) return look(list, `${pct(s)}% doesn't split the ${word} side's 50% evenly`);
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

// (2026-11-10, the owner) "for anything w no splits can we just assume the default rule: artist gets 50 if its solo,
// if theres other feats its split evenly. same with producer. if theres no producer you can assume its 50 as well. if
// its stackie thats the only exception since hes artist/prod so you can split evenly from 100 based on features."
// A song with no share typed in: its artists are the song's artist line (the sheet's Recording Artist, "GloryTonio,
// larcenyx") and anyone listed as an artist, splitting the artist side's 50 evenly; the producers listed (the client,
// when they're one) split the other 50, and no producer is one unnamed producer at 50. A client who is both
// ("Producer / Artist", Stack!e) and on the artist line splits the whole 100 evenly with everyone on it.
// null when it doesn't apply (a share is typed, someone listed has no artist or producer role, no client): evenSplit then.
export const artistsOf = (line) => {
  const seen = new Set();
  return String(line || "").replace(/[()[\]]/g, " ").split(/\s*(?:,|&|\+|\b(?:feat|ft|featuring)\b\.?|\swith\s|\sx\s)\s*/i)
    .map((n) => n.trim()).filter((n) => { const k = personKey(n); if (!k || seen.has(k)) return false; seen.add(k); return true; });
};
export const bothSides = (role) => /prod/i.test(role || "") && /artist/i.test(role || "");
export function defaultSplit({ rows = [], client = null, artist = "", makeId = () => Math.random().toString(36).slice(2, 10) } = {}) {
  if (!client?.name) return null;
  const named = (rows || []).filter((r) => !r.unnamed);
  if (named.some((r) => Number(r.percent) > 0 || !sideOf(r.role))) return null;
  const mine = (n) => [client.name, client.credit].some((c) => c && personKey(c) === personKey(n));
  const line = artistsOf(artist);
  const whole = bothSides(client.role) && (!line.length || line.some(mine));
  const clientSide = whole ? "Artist" : sideOf(client.role) || "Producer";
  const people = { Artist: [], Producer: [] }, taken = new Set();
  const add = (side, name, row) => { const k = personKey(name); if (k && !taken.has(k)) { taken.add(k); people[side].push({ name, row }); } };
  const rowOf = (n) => named.find((r) => personKey(r.name) === personKey(n));
  const own = named.find((r) => mine(r.name));
  add(clientSide, own?.name || client.name, own);
  for (const n of line) if (!mine(n)) add("Artist", n, rowOf(n));
  for (const r of named) add(sideOf(r.role), r.name, r);
  if (people.Artist.length > MAX_PER_SIDE || people.Producer.length > MAX_PER_SIDE) return null;
  if (whole && people.Producer.length) return null; // someone else listed as a producer: not the even-from-100 case
  const out = [], added = [];
  const put = ({ name, row }, side, percent) => {
    if (row) return out.push({ ...row, percent });
    const r = { id: makeId(), name, role: mine(name) ? client.role || side : side, percent };
    out.push(r); added.push(r);
  };
  if (whole) for (const x of people.Artist) put(x, "Artist", 100 / people.Artist.length);
  else for (const side of SIDES) {
    const list = people[side];
    if (!list.length) {
      const r = { id: makeId(), name: "", role: side, percent: SIDE, unnamed: true, label: `${side} (unnamed)` };
      out.push(r); added.push(r);
    } else for (const x of list) put(x, side, SIDE / list.length);
  }
  const last = out[out.length - 1];
  for (let i = 0; i < 3 && total(out) !== 100; i++) last.percent = Number(last.percent) + (100 - total(out));
  return total(out) === 100 ? { status: "assumed", splits: out, added, rule: true } : null;
}
// a song's split as the site works it out: as it is when it adds up, else the default above when no share is typed
// in, else the even fill. p: { splits, artist }; client: its client (name, credit, role)
export function songSplit(p, client, makeId) {
  const rows = p?.splits || [];
  if (total(rows) === 100) return { status: "ok", splits: rows, added: [] };
  const d = defaultSplit({ rows, client, artist: p?.artist, makeId });
  if (d) return d;
  // only the client's own share typed (a song read in from the sheet): the default still names the others on the
  // artist line when it gives the client that same share
  const named = rows.filter((r) => !r.unnamed), mine = (r) => client && [client.name, client.credit].some((c) => c && personKey(c) === personKey(r.name));
  if (named.length === 1 && mine(named[0])) {
    const again = defaultSplit({ rows: [{ ...named[0], percent: 0 }], client, artist: p?.artist, makeId });
    const own = again?.splits.find((r) => r.id === named[0].id);
    if (own && Math.abs(Number(own.percent) - Number(named[0].percent)) < 0.05) return { ...again, splits: again.splits.map((r) => (r === own ? { ...r, percent: Number(named[0].percent) } : r)) };
  }
  return evenSplit(rows, makeId);
}

// the assumed split in words, for the list and the confirm, with each person's role and every number the rule
// filled in marked "assumed": "Stack!e (producer) 25 · 1 unnamed producer 25 assumed · unnamed artist 50 assumed".
// typed = the rows as they were typed (before the fill): a named person whose typed share was blank is assumed too;
// without it only the unnamed people are marked
// confirmed: the split was just confirmed, so nothing in it is "assumed" any more (the note after a Confirm)
export function splitWords(splits, typed, { confirmed = false } = {}) {
  const named = [], partial = [], whole = [];
  const mark = confirmed ? "" : " assumed";
  // (a named person the default added from the artist line wasn't typed at all: assumed too)
  const blank = (r) => { if (confirmed || !typed) return false; const t = typed.find((x) => x.id === r.id); return !t || !(Number(t.percent) > 0); };
  for (const side of SIDES) {
    const rows = (splits || []).filter((r) => sideOf(r.role) === side);
    const unnamed = rows.filter((r) => r.unnamed);
    for (const r of rows) if (!r.unnamed) named.push(`${r.name || "Unnamed"} (${String(r.role || side).trim().toLowerCase()}) ${pct(Number(r.percent) || 0)}${blank(r) ? " assumed" : ""}`);
    if (!unnamed.length) continue;
    const word = side.toLowerCase();
    // the people beside someone named read first, then a side that's one unnamed person ("unnamed artist 50 assumed")
    if (unnamed.length === rows.length && rows.length === 1) whole.push(`unnamed ${word} ${pct(Number(unnamed[0].percent))}${mark}`);
    else partial.push(`${unnamed.length} unnamed ${word}${unnamed.length === 1 ? "" : "s"} ${pct(Number(unnamed[0].percent))}${mark}`);
  }
  return [...named, ...partial, ...whole].join(" · ");
}

// the order people are listed in, the same in the song editor and the song window: named people first, then the
// unnamed ones; artists before producers within each, then anyone else; otherwise as typed (a stable sort)
const rank = (r) => (r.unnamed ? 10 : 0) + ({ Artist: 0, Producer: 1 }[sideOf(r.role)] ?? 2);
export const orderSplits = (rows) => (rows || []).map((r, i) => [r, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([r]) => r);

// the split to save: the even default when the rule fills it, otherwise exactly what was typed. song: { client,
// artist } when the editor knows them, so a split left empty takes the default from the artist line
export const filledSplits = (rows, song = null) => {
  const r = song ? songSplit({ splits: rows, artist: song.artist }, song.client) : evenSplit(rows);
  return r.status === "assumed" ? r.splits : rows || [];
};
