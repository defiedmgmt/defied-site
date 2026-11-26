// Each manager's pay.defiedmgmt.com link: pay.defiedmgmt.com/<key> sends a client to that manager's Stripe payment link, and a payment's
// link says whose client paid, so the Dashboard can say "via Magnus" and the accounting match knows the manager.
// (2026-11-26, paylinks-1126) The links are a Founders' setting in Site › Users (app_state "payLinks", lib/pay-links-store.js), no longer
// code: SEED_LINKS (the five links next.config.js redirected to until then) stand in until the first save, which writes them with it.
// Pure (no imports but roles.js and names.js, nothing from the environment): the server (pages/api/pay/[key].js, lib/stripe.js, the
// commission card) and the browser (Site › Users, through lib/commission.js too) ask the same table the same questions.
//   links: { <key>: { owner, url, previous?: [{ url, until }], by?, at? } }   owner: the name exactly as INFO's manager list spells it
import { personKey } from "./names";
import { sameManager, nearManagerEntry } from "./roles";

export const SEED_LINKS = {
  devin: { owner: "Devin", url: "https://buy.stripe.com/aFa4gr7eyaLEdrdeJfcV200" },
  mag: { owner: "Magnus", url: "https://buy.stripe.com/eVq4greNXaRp9NF7QQ9sk00" },
  ella: { owner: "Ella", url: "https://buy.stripe.com/7sYfZ9fSG9Pocol1Kf33W00" },
  hank: { owner: "Hank", url: "https://buy.stripe.com/3cIeV5ct53z2bHb0zXenS00" },
  jordan: { owner: "Jordan", url: "https://buy.stripe.com/00w5kv8nS5bg7rO5pNcZa00" },
};
// Devin owns Defied, so his link (and anything paid to the platform itself) is the owner's own; a client whose manager has no link pays
// through it, so it can't be removed
export const OWNER = "Devin";
export const PAY_HOST = "pay.defiedmgmt.com";
export const KEY_RE = /^[a-z][a-z0-9]{1,15}$/;
const SLUG_RE = /^(test_)?[A-Za-z0-9]{12,64}$/;
const HOSTS = ["buy.stripe.com", "donate.stripe.com"];
const PREVIOUS_MAX = 10;

// the link's last path segment is what stays put (http vs https, a trailing slash or ?query don't matter)
export const slugOf = (url) => String(url || "").split(/[?#]/)[0].replace(/\/+$/, "").split("/").pop();

// A pasted Stripe link as it is stored: https://<buy|donate>.stripe.com/<slug>, no query, hash or trailing slash. null when it isn't one.
// A link pasted without "https://" is read as https; one that says http:// is refused.
export function canonUrl(text) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (!HOSTS.includes(host)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length !== 1 || !SLUG_RE.test(parts[0])) return null;
  return { url: `https://${host}/${parts[0]}`, slug: parts[0], test: parts[0].startsWith("test_") };
}

// The stored row as a links table. Nothing stored yet (or not an object): the seed. An entry that doesn't read right is left out, and the
// owner's own link is always there (the seed's, if the row somehow lost it).
export function normalizeLinks(value) {
  let v = value;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = null; } }
  if (!v || typeof v !== "object" || Array.isArray(v)) return copyOf(SEED_LINKS);
  const out = {};
  for (const [k, e] of Object.entries(v)) {
    if (!k.startsWith("link:") || !e || typeof e !== "object") continue;
    const key = k.slice(5), owner = String(e.owner ?? "").trim(), c = canonUrl(e.url);
    if (!KEY_RE.test(key) || !owner || !c) continue;
    const previous = (Array.isArray(e.previous) ? e.previous : [])
      .map((p) => ({ url: canonUrl(p?.url)?.url, until: String(p?.until ?? "").slice(0, 40) }))
      .filter((p) => p.url).slice(0, PREVIOUS_MAX);
    out[key] = { owner, url: c.url, previous, by: String(e.by ?? "").slice(0, 80), at: String(e.at ?? "").slice(0, 40) };
  }
  if (!Object.values(out).some((l) => l.owner === OWNER)) out.devin = { ...SEED_LINKS.devin, previous: [], by: "", at: "" };
  return out;
}
const copyOf = (links) => Object.fromEntries(Object.entries(links).map(([k, l]) => [k, { owner: l.owner, url: l.url, previous: [], by: "", at: "" }]));

// The manager whose link this was: its current link, else one it had before (a payment made before a link was changed); null when none
export function ownerOfLink(url, links = SEED_LINKS) {
  const s = slugOf(url);
  if (!s) return null;
  const all = Object.values(links || {});
  for (const l of all) if (slugOf(l.url) === s) return l.owner;
  for (const l of all) for (const p of l.previous || []) if (slugOf(p.url) === s) return l.owner;
  return null;
}
// Payments (lib/stripe.js joinFee's shape) with each one's manager worked out again from the links as they are now: a link added after a
// payment was first read, or changed since, still names its manager. One straight to Defied's own account stays the owner's; a link no
// longer in the table keeps the manager it was read with.
export function withLinkOwners(list, links) {
  return (list || []).map((p) => {
    if (!p || p.direct || !p.link?.url) return p;
    const owner = ownerOfLink(p.link.url, links) || p.link.owner || null;
    return owner === p.link.owner ? p : { ...p, link: { ...p.link, owner } };
  });
}

export const linkOfKey = (key, links = SEED_LINKS) => (links && Object.prototype.hasOwnProperty.call(links, key) ? links[key] : null);

// The key of a manager's (or a staff login's) link: the link whose owner is this name, or its first word ("Magnus Hale" is Magnus, by
// lib/roles.js sameManager: "Cayden" is not "Caden"), else a key that is the first word itself (a login named "Mag") of a link whose owner's name
// starts with it ("mag" is Magnus's). (review ACC-1) Founders type the keys, so a key alone never decides: Caden's link saved as "cayden" isn't the
// intern Cayden's. null when none.
const firstKey = (name) => personKey(String(name ?? "").trim().split(/\s+/)[0]);
export function keyOfManager(name, links = SEED_LINKS) {
  if (!personKey(name)) return null;
  const entries = Object.entries(links || {});
  for (const [k, l] of entries) if (sameManager(l.owner, name)) return k;
  const f = firstKey(name);
  for (const [k, l] of entries) if (k === f && personKey(l?.owner).startsWith(f)) return k;
  return null;
}
// does a staff login with this name get My payments (a link of their own)?
export const hasMyPay = (name, links = SEED_LINKS) => !!keyOfManager(name, links);
// the key of the owner's own link (every manager-less client's)
export const ownerKey = (links = SEED_LINKS) => Object.keys(links || {}).find((k) => links[k].owner === OWNER) || null;

// INFO's managers (each client's Assigned Manager, as the clients table copies it) with no link of their own, A to Z
export function noPayLinkOf(managers, links = SEED_LINKS) {
  const owners = Object.values(links || {}).map((l) => l.owner);
  const seen = new Set(), out = [];
  for (const m of managers || []) {
    const name = String(m ?? "").trim();
    if (!name || seen.has(personKey(name))) continue;
    seen.add(personKey(name));
    if (!owners.some((o) => personKey(o) === personKey(name))) out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

// ---- checks (the form and the server ask the same ones): { value } or { error }, an error being the sentence to show
const NOT_A_LINK = "That isn't a Stripe payment link. Paste the whole buy.stripe.com link.";
// entry: { key, owner, url }. links: the table as it is now. managers: INFO's manager list (the owner is always on it). production: the
// live site, where a Stripe test link is refused (a client would land on a test page)
export function checkPayLink(entry, links, { production = false, managers = [] } = {}) {
  const key = String(entry?.key ?? "").trim().toLowerCase();
  const owner = String(entry?.owner ?? "").trim();
  if (!KEY_RE.test(key)) return { error: `${PAY_HOST}/ needs a short name: 2 to 16 letters or numbers, starting with a letter.` };
  const list = [...new Set([OWNER, ...(managers || []).map((m) => String(m ?? "").trim()).filter(Boolean)])];
  if (!list.includes(owner)) {
    const near = nearManagerEntry(list.map((name) => ({ name })), owner);
    return { error: near ? `"${owner}" isn't on INFO's manager list. It has ${near.name}.` : `"${owner || "No name"}" isn't on INFO's manager list.` };
  }
  const c = canonUrl(entry?.url);
  if (!c) return { error: NOT_A_LINK };
  if (c.test && production) return { error: "That's a Stripe test link. Paste the live one." };
  const all = Object.entries(links || {});
  const taken = linkOfKey(key, links);
  if (taken && taken.owner !== owner) return { error: `${PAY_HOST}/${key} is ${taken.owner}'s.` };
  const other = all.find(([k, l]) => l.owner === owner && k !== key);
  if (other) return { error: `${owner} already has ${PAY_HOST}/${other[0]}.` };
  for (const [, l] of all) {
    if (l.owner === owner) continue;
    if (slugOf(l.url) === c.slug || (l.previous || []).some((p) => slugOf(p.url) === c.slug)) return { error: `That link is ${l.owner}'s.` };
  }
  return { value: { key, owner, url: c.url } };
}
export function checkRemove(key, links) {
  const k = String(key ?? "").trim().toLowerCase();
  const l = KEY_RE.test(k) ? linkOfKey(k, links) : null;
  if (!l) return { error: `There's no ${PAY_HOST}/${k || "…"}.` };
  if (l.owner === OWNER) return { error: `${OWNER}'s link stays: clients with no manager link pay through it.` };
  return { value: { key: k, owner: l.owner } };
}
// What Site › Users' Pay link part would send for a manager (components/dash/admin.jsx PayLinkPart): nothing when the link is as stored, a
// save (key: the stored one, else the one typed), or a remove when the link was emptied; block: the sentence that holds the form's Save
//   { owner, links, managers, key, url } -> { changed, block, body }
export function payLinkEdit({ owner, links, managers, key, url }) {
  const curKey = keyOfManager(owner, links), cur = curKey ? links[curKey] : null;
  const typed = String(url ?? "").trim(), k = curKey || String(key ?? "").trim().toLowerCase();
  const changed = cur ? typed !== cur.url : !!typed;
  if (!changed) return { changed: false, block: null, body: null };
  if (cur && !typed) {
    const c = checkRemove(curKey, links);
    return { changed: true, block: c.error || null, body: c.error ? null : { action: "remove", key: curKey } };
  }
  const c = checkPayLink({ key: k, owner, url: typed }, links, { managers });
  return { changed: true, block: c.error || null, body: c.error ? null : { action: "save", key: k, owner, url: typed } };
}
// The entry a save stores: an old URL moves to `previous` (so the payments made through it keep their manager)
export function nextEntry(value, links, by, at) {
  const prev = linkOfKey(value.key, links);
  const old = prev?.previous || [];
  const previous = prev && prev.url !== value.url ? [{ url: prev.url, until: at }, ...old.filter((p) => p.url !== value.url)] : old.filter((p) => p.url !== value.url);
  return { owner: value.owner, url: value.url, previous: previous.slice(0, PREVIOUS_MAX), by: String(by ?? "").slice(0, 80), at };
}
// The seed as the stored row's entries (the first save writes them with its own)
export const seedEntries = () => Object.fromEntries(Object.entries(SEED_LINKS).map(([k, l]) => [`link:${k}`, { owner: l.owner, url: l.url, previous: [], by: "", at: "" }]));
// What the browser gets (Site › Users): each link's owner and URL only
export const publicLinks = (links) => Object.fromEntries(Object.entries(links || {}).map(([k, l]) => [k, { owner: l.owner, url: l.url }]));
