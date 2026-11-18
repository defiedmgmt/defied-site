// Which of OUR clients a credited name is, and nothing fuzzier. Pure. (2026-11-18, the owner: "it should only suggest stuff with our clients")
//   1. The alias table is built only from clients on the roster (clients.on_roster): never from split names, A&R names, collaborators or anyone else.
//      A match names the client it matched.
//   2. Any credit role counts (composer, lyricist, songwriter, producer, co-producer, programming, mixing, performer, featured, ...) as long as the credited
//      name is one of those clients. The role is kept with the match and shown beside it.
//   3. No fuzzy matching: two names are the same only when their keys are equal. The key is the app's one rule for "is this the same person" (lib/names.js
//      personKey: lowercase, accents, spaces and punctuation gone, Stack!e = Stackie, "$" is nothing: A$AP is "aap", never "asap").
//   4. A client's name loses a leading "prod" / "prodby" / "prod." / "produced by" (prodchxse -> chxse) only when what is left is 5 letters or more and
//      not a common first name or word (PREFIX_DENY: prodgavin is never "gavin", prodbyVK never "vk"); then only the whole handle matches. A credit loses the
//      same prefix always ("Prod. Chxse" -> chxse), and keeps its whole text as a key too ("Prod. Gavin" is prodgavin).
//   5. Aliases staff add (app_state "producerAliases", { [client id]: [names] }, e.g. a legal name) match exactly, whole, and only for a roster client.
import { personKey } from "../names";
import { songOnSite, titleKey } from "../duplicates";

export const MIN_STRIPPED = 5;
// what "Prod. X" strips down to that is a name or a word of its own: such a client is matched by the whole handle only
export const PREFIX_DENY = new Set([
  "gavin", "chase", "kay", "zo", "vk", "ace", "max", "jay", "sam",
  "jordan", "jaden", "jayden", "kevin", "tyler", "brian", "chris", "david", "james", "jason", "kyle", "marcus", "mason", "miles", "noah", "jacob", "jamal", "justin",
  "logan", "louis", "tommy", "isaiah", "elijah", "xavier", "trevor", "dylan", "devin", "aaron", "adam", "alex", "andre", "bryan", "cameron", "carter", "colin", "dante",
  "darius", "derek", "eric", "ethan", "felix", "isaac", "jamie", "jerry", "joshua", "julian", "malik", "mario", "nathan", "omar", "oscar", "peter", "ricky", "ryan", "scott",
  "shawn", "steve", "terry", "victor", "zack",
  "beats", "beatz", "music", "sound", "sounds", "vibes", "studio", "records", "king", "prince", "young", "money", "smoke", "legend", "genius",
]);

// "Prod. Chxse" -> "Chxse": the text after a leading "prod", "prodby", "prod.", "prod by" or "produced by"; "" when there is no such prefix. The glued form
// (prodchxse) needs 3 letters after it, so "prod" or "prodx" alone is nothing.
const PREFIXES = [
  /^\s*produced\s+by\b[\s:.\-–—]*/i,
  /^\s*prod\.?\s+by\b[\s:.\-–—]*/i,
  /^\s*prod\.by\b[\s:.\-–—]*/i,
  /^\s*prodby[\s:.\-–—]*/i,
  /^\s*prod(?:[.:\-–—]|\s)[\s:.\-–—]*/i,
  /^\s*prod(?=[\p{L}\p{N}]{3})/iu,
];
export function stripProd(text) {
  const s = String(text ?? "");
  for (const re of PREFIXES) { const m = re.exec(s); if (m) return s.slice(m[0].length).trim(); }
  return "";
}

// ---- the table
// -> { byKey: Map(key -> [{ clientId, client, alias, via }]), clients, size }. clients: rows of the clients table ({ id, name, on_roster }); staff: producerAliases
export function buildAliases({ clients = [], staff = {} } = {}) {
  const roster = (clients || []).filter((c) => c && c.on_roster && c.id && String(c.name || "").trim());
  const byKey = new Map();
  const put = (key, entry) => {
    if (key.length < 2) return;
    const list = byKey.get(key) || [];
    if (!list.some((e) => e.clientId === entry.clientId)) list.push(entry);
    byKey.set(key, list);
  };
  for (const c of roster) {
    const name = String(c.name).trim();
    put(personKey(name), { clientId: c.id, client: name, alias: name, via: "name" });
    const rest = stripProd(name), key = rest ? personKey(rest) : "";
    if (key.length >= MIN_STRIPPED && !PREFIX_DENY.has(key)) put(key, { clientId: c.id, client: name, alias: rest, via: "name without Prod" });
  }
  const by = new Map(roster.map((c) => [c.id, c]));
  for (const [id, list] of Object.entries(staff && typeof staff === "object" ? staff : {})) {
    const c = by.get(id);
    if (!c || !Array.isArray(list)) continue;
    for (const a of list.slice(0, 20)) { const t = String(a ?? "").trim().slice(0, 80); if (t) put(personKey(t), { clientId: id, client: String(c.name).trim(), alias: t, via: "staff alias" }); }
  }
  return { byKey, clients: roster.length, size: byKey.size };
}

// the keys a credited name is looked up by: its own text, and the text after a "Prod." prefix
export function creditKeys(text) {
  const keys = new Set();
  const own = personKey(text);
  if (own.length >= 2) keys.add(own);
  const rest = stripProd(text), key = rest ? personKey(rest) : "";
  if (key.length >= 2) keys.add(key);
  return [...keys];
}

// ---- roles
// The order roles are shown in (a producer credit first, a performer last) and what counts as a producer of the song
const RANKS = [[/\bco-?producer\b|^producer$/i, 0], [/producer/i, 1], [/program/i, 2], [/compos|songwrit|lyric|writer|author|arrang/i, 3], [/mix|master|engineer/i, 4], [/perform|artist|vocal|featur/i, 8]];
export const roleRank = (role) => (RANKS.find(([re]) => re.test(String(role || "")))?.[1] ?? 5);
// "Producer" and "Co-Producer" are who made the song's beat (Executive, Vocal or Additional Producer are not): the other producers an assumed split names beside the client
export const isMaker = (role) => /^(co-?\s?)?producer$/i.test(String(role || "").trim());
// the credit as a person would read it: "Producer, Programming"
export const roleLine = (roles) => (roles || []).join(", ");
// a credit that is more than "performer": credits are in when someone besides the performers is listed (lib/credits/scan.js waits for them)
export const isCredit = (roles) => (roles || []).some((r) => roleRank(r) !== 8);

// ---- matching
// credits: [{ name, roles: [text] }] as a source listed them; source: "apple" | "youtube".
// -> [{ clientId, client, alias, via, credit (the name as the source shows it), roles (every role it is listed under, a producer's first), source }], one per client
export function matchCredits(credits, aliases, source) {
  const found = new Map();
  for (const c of credits || []) {
    const name = String(c?.name ?? "").trim();
    if (!name) continue;
    const roles = (c.roles || []).map((r) => String(r ?? "").trim()).filter(Boolean);
    for (const key of creditKeys(name)) {
      for (const a of aliases?.byKey?.get(key) || []) {
        const m = found.get(a.clientId) || { clientId: a.clientId, client: a.client, alias: a.alias, via: a.via, credit: name, roles: [], source, rank: 99 };
        const best = Math.min(...(roles.length ? roles : [""]).map(roleRank));
        if (best < m.rank) { m.rank = best; m.credit = name; m.alias = a.alias; m.via = a.via; }
        for (const r of roles) if (!m.roles.some((x) => x.toLowerCase() === r.toLowerCase())) m.roles.push(r);
        found.set(a.clientId, m);
      }
    }
  }
  return [...found.values()].map(({ rank, roles, ...m }) => ({ ...m, roles: [...roles].sort((x, y) => roleRank(x) - roleRank(y)) })).sort((x, y) => x.client.localeCompare(y.client));
}

// ---- already there
export const suggestionKey = (spotifyId, clientId) => `${spotifyId}|${clientId}`;
export { songOnSite, titleKey };
