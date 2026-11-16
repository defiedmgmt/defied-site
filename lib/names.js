// One rule for "is this the same person" wherever a client, writer or split
// name is compared (never song titles). Pure — no imports — and kept identical
// to personKey in components/App.jsx, so the dashboard and the sheet routes
// always agree on who a name belongs to.

// Accents and punctuation drop out, and a "!" standing in for an i counts as
// one: Stack!e, STACK!E and Stackie are one person ("stackie"), Stacke is
// someone else ("stacke"), Liyakk! is "liyakk", Beyoncé is "beyonce".
export const personKey = (s) => String(s ?? "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase()
  .replace(/(\p{L})!(?=\p{L})/gu, "$1i").replace(/[^\p{L}\p{N}]+/gu, "");

const lc = (s) => String(s ?? "").trim().toLowerCase();

// The entry of `list` that `name` refers to: an exact (case-insensitive) match
// always wins over a personKey one.
export function findByName(list, name, nameOf = (x) => x.name) {
  const n = lc(name), k = personKey(name);
  return (n && list.find((x) => lc(nameOf(x)) === n)) || (k && list.find((x) => personKey(nameOf(x)) === k)) || null;
}

// The client (a clients row: name, sheet_tab_name) a sheet tab or typed name
// belongs to. Exact beats personKey, and at each level a "Sheet tab name"
// override beats a name: the "Indigo" tab stays Reallyindig0's (their override)
// even once a client called Indigo exists. `prefer` (a client id: the song's
// own client, the signed-in client) wins a tie with any of its own two names.
export function ownerOf(clients, name, prefer) {
  const n = lc(name), k = personKey(name);
  for (const same of [(s) => !!n && lc(s) === n, (s) => !!k && personKey(s) === k]) {
    const hit = (prefer && clients.find((c) => c.id === prefer && (same(c.sheet_tab_name) || same(c.name))))
      || clients.find((c) => same(c.sheet_tab_name)) || clients.find((c) => same(c.name));
    if (hit) return hit;
  }
  return null;
}

// ---- near names (2026-11-15): one rule for "these two names look like one person" on the server (lib/people-link.js, lib/people-sync.js) and in Site > Users'
// form (components/dash/manager-artists.js), moved here from lib/people-link.js so they can't disagree. Pure.

// (the owner, 2026-11-13) prodzo's manager Caden and the intern Cayden are two people: never merged, never asked about
export const TWO_PEOPLE = [["Caden", "Cayden"]];
export const pairKey = (a, b) => [personKey(a), personKey(b)].sort().join("|");
export const twoPeople = (a, b) => TWO_PEOPLE.some(([x, y]) => pairKey(x, y) === pairKey(a, b));

// the optimal string alignment distance (Damerau-Levenshtein): an adjacent swap is ONE edit ("Jamie" / "Jaime", "Brian" / "Brain")
export function edits(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = [];
  for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
// a near miss: not the same personKey, but one edit away (a letter added, dropped or changed, or two neighbours swapped: "Jamie" / "Jaime", "Brian" /
// "Brain", "Caden" / "Cayden", "Kai" / "Kay"); or two edits away when the shorter name is 6+ letters ("Jordan" / "Jordyn", "Magnus" / "Marcus"), or 4-5
// letters and the two begin with the same letter ("Dani" / "Danny", "Sean" / "Shawn": but not "Hank" / "Dani", two letters changed from the first);
// or one inside the other when the shorter is 4+ letters; or one beginning the other from 3 letters ("Mag" / "Magnus": a short name for a long one).
// A 3-letter name is never two edits from a near miss: "Dani" and "Kai", "Ella" and "Ena" are not.
export function nearMiss(a, b) {
  const x = personKey(a), y = personKey(b);
  const short = Math.min(x.length, y.length);
  if (!x || !y || x === y || short < 3) return false;
  const s = x.length <= y.length ? x : y, l = x.length <= y.length ? y : x;
  if (l.startsWith(s) || (short >= 4 && l.includes(s))) return true;
  const d = edits(x, y);
  return d <= 1 || (d === 2 && (short >= 6 || (short >= 4 && x[0] === y[0])));
}
