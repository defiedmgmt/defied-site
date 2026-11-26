// (2026-11-26, paylinks-1126) The pay links setting (lib/pay-links.js), kept in the one app_state row "payLinks". Server-only.
// The row is one flat object, an entry per link ("link:<key>": { owner, url, previous, by, at }), so two Founders saving at once never
// overwrite each other: a save merges only its own key in one statement (the idiom of lib/auto-add.js remember). Until the first save there
// is no row and the seed (SEED_LINKS, the five links that were in code) is the table; the first save writes the seed with its own entry.
// Reads are kept 60 s in memory (the redirect at pay.defiedmgmt.com/<key> asks on every visit); a database that doesn't answer gives
// the last table read, else the seed, so a link that was working keeps working.
import { sql } from "./db";
import { normalizeLinks, seedEntries, nextEntry } from "./pay-links";

export const KEY = "payLinks";
const TTL_MS = 60 * 1000;
let memo = null; // { at, links }
let lastGood = null;

// strict: a database that doesn't answer is an error (a save checks against the table as it really is)
export async function readPayLinks({ fresh = false, strict = false } = {}) {
  if (!fresh && memo && Date.now() - memo.at < TTL_MS) return memo.links;
  try {
    const [row] = await sql`SELECT value FROM app_state WHERE key = ${KEY}`;
    const links = normalizeLinks(row ? row.value : null);
    memo = { at: Date.now(), links };
    lastGood = links;
    return links;
  } catch (err) {
    if (strict) throw err;
    console.error("pay links: couldn't read the setting:", err?.message || err);
    return lastGood || normalizeLinks(null);
  }
}
// the next read asks the database again (after a save; tests)
export const forgetPayLinks = () => { memo = null; };

// value: lib/pay-links.js checkPayLink's; links: the table it was checked against (its old URL goes to `previous`)
export async function savePayLink(value, links, by) {
  const k = `link:${value.key}`, entry = JSON.stringify(nextEntry(value, links, by, new Date().toISOString()));
  await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${KEY}, ${JSON.stringify(seedEntries())}::jsonb || jsonb_build_object(${k}::text, ${entry}::jsonb), now())
    ON CONFLICT (key) DO UPDATE SET value = app_state.value || jsonb_build_object(${k}::text, ${entry}::jsonb), updated_at = now()`;
  forgetPayLinks();
}
// key: lib/pay-links.js checkRemove's (never the owner's own link)
export async function removePayLink(key) {
  const k = `link:${key}`, seed = seedEntries();
  delete seed[k];
  await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${KEY}, ${JSON.stringify(seed)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = app_state.value - ${k}::text, updated_at = now()`;
  forgetPayLinks();
}
