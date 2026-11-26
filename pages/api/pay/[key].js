// pay.defiedmgmt.com/<key> (next.config.js rewrites it here, 2026-11-26): a 302 to that manager's Stripe payment link, from the pay links
// setting (lib/pay-links-store.js; the seed until the first save). Public, as the redirects in next.config.js were. Only two things are
// passed on: prefilled_amount (the portal card's amount, in cents) and client_reference_id (who is paying), each only when Stripe would
// take it. Where it goes is never taken from the request: an unknown key is a 404, so this can't send anyone anywhere else.
// Not permanent and never cached: a link can be changed in Site › Users, and a 308 (or a cached 302) would outlive that.
import { readPayLinks } from "../../../lib/pay-links-store";
import { KEY_RE, linkOfKey } from "../../../lib/pay-links";

const one = (v) => (Array.isArray(v) ? "" : String(v ?? ""));

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "GET only" });
  }
  const key = one(req.query.key).toLowerCase();
  const link = KEY_RE.test(key) ? linkOfKey(key, await readPayLinks()) : null;
  if (!link) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(404).send("There's no pay link here.");
  }
  const q = new URLSearchParams();
  const amount = one(req.query.prefilled_amount), ref = one(req.query.client_reference_id);
  if (/^\d{1,9}$/.test(amount)) q.set("prefilled_amount", amount);
  if (/^[A-Za-z0-9_-]{1,200}$/.test(ref)) q.set("client_reference_id", ref);
  const s = String(q);
  res.setHeader("Location", s ? `${link.url}?${s}` : link.url);
  return res.status(302).end();
}
