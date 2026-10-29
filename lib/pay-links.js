// Each manager's pay.defiedmgmt.com link, the same five Stripe payment links next.config.js redirects
// to (keep the two in step: a regenerated link changes both). A payment's link says whose client paid,
// so the Dashboard can say "via Devin's link" and the accounting match knows the manager.
export const PAY_LINKS = {
  devin: { owner: "Devin", url: "https://buy.stripe.com/aFa4gr7eyaLEdrdeJfcV200" },
  mag: { owner: "Magnus", url: "https://buy.stripe.com/eVq4greNXaRp9NF7QQ9sk00" },
  ella: { owner: "Ella", url: "https://buy.stripe.com/7sYfZ9fSG9Pocol1Kf33W00" },
  hank: { owner: "Hank", url: "https://buy.stripe.com/3cIeV5ct53z2bHb0zXenS00" },
  jordan: { owner: "Jordan", url: "https://buy.stripe.com/00w5kv8nS5bg7rO5pNcZa00" },
};
// Devin owns Defied, so his link (and anything paid to the platform itself) is the owner's own
export const OWNER = "Devin";

// the link's last path segment is what stays put (http vs https, a trailing slash or ?query don't matter)
const slug = (url) => String(url || "").split(/[?#]/)[0].replace(/\/+$/, "").split("/").pop();
const BY_SLUG = Object.fromEntries(Object.values(PAY_LINKS).map((l) => [slug(l.url), l.owner]));

export function ownerOfLink(url) {
  return BY_SLUG[slug(url)] || null;
}
