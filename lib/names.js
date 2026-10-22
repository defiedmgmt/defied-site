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
