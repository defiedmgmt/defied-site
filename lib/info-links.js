// A site client's stored link to its row on the accounting sheet's INFO tab (clients.info_name, migration 022; written
// by lib/people-link.js once the two are paired). INFO's names are matched by the sheet's own formulas, so the sheet is
// never renamed: when a client is renamed on the site, the link keeps them on their INFO row. Everything that pairs an
// INFO name with a client (people-sync's rosterWithClients / infoRowOf, info-managers' managersByClient, the Sync
// check) follows the link first, then the name (lib/names.js ownerOf, the rule they used before). Server-only.
import { sql } from "./db";
import { ownerOf, findByName, personKey } from "./names";

// The clients rows with their info_name, read on their own so each caller's query stays as it is. Before migration
// 022, or when that read fails, the rows come back as they were (names only: the old rule).
export async function withInfoNames(clients) {
  const list = Array.isArray(clients) ? clients : [];
  if (!list.length) return list;
  let rows;
  try {
    rows = await sql`SELECT id, info_name FROM clients WHERE info_name <> ''`;
  } catch (err) {
    if (err?.code !== "42703") console.error("info links: read failed, matching INFO by name only:", err?.message || err);
    return list;
  }
  if (!Array.isArray(rows) || !rows.length) return list;
  const by = new Map(rows.map((r) => [r.id, r.info_name]));
  return list.map((c) => (by.has(c.id) ? { ...c, info_name: by.get(c.id) } : c));
}

// The client an INFO name belongs to: the one linked to that name (info_name, exact then personKey), else ownerOf
// among the clients that aren't linked to another name INFO still has. live: the names on INFO now (a link to a name
// INFO no longer has counts as no link), or null (every link counts). Pure.
export function infoOwnerOf(clients, name, live = null) {
  const list = clients || [];
  const liveKeys = live ? new Set([...live].map(personKey).filter(Boolean)) : null;
  const linked = list.filter((c) => String(c.info_name || "").trim() && (!liveKeys || liveKeys.has(personKey(c.info_name))));
  if (!linked.length) return ownerOf(list, name);
  const hit = findByName(linked, name, (c) => c.info_name);
  if (hit) return hit;
  const taken = new Set(linked.map((c) => c.id));
  return ownerOf(list.filter((c) => !taken.has(c.id)), name);
}
