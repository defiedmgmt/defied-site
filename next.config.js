/** @type {import('next').NextConfig} */
const securityHeaders = [
  // no third-party sites may embed this site in a frame — blocks clickjacking
  { key: "X-Frame-Options", value: "DENY" },
  // stop the browser guessing content types on responses that didn't declare one
  { key: "X-Content-Type-Options", value: "nosniff" },
  // don't leak the full referring URL (which can carry auth-adjacent context) to other origins
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // disable APIs this site never uses, even if a future dependency tries to reach for them
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js needs inline/eval for its own runtime in dev and hydration in prod.
      // va.vercel-scripts.com is Vercel Web Analytics' script host — it only
      // loads from there in local dev (the debug build); in production the
      // script itself is served same-origin, but the CSP has to allow both.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com",
      "style-src 'self' 'unsafe-inline'",
      // Spotify/Sheets cover art and profile photos are fetched from arbitrary https hosts
      "img-src 'self' data: https:",
      "font-src 'self'",
      // the API layer only ever talks to the browser same-origin; outbound calls to
      // Google/Spotify/Luminate happen server-side in API routes, never from client JS.
      // vitals.vercel-insights.com is where Vercel Web Analytics beacons page views.
      "connect-src 'self' https://vitals.vercel-insights.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

// public/ files aren't content-hashed, so by default every visit re-checks each one before using it
// (a round trip per file, and a flash of the fallback font). The font never changes in place (a new
// version gets a new name). Photos and brand images have been fixed in place before, so they're kept
// a day and then refreshed in the background: a replaced photo shows within a day, a renamed one at once.
const fontCache = [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }];
const assetCache = [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }];

const nextConfig = {
  // Back/Forward land where the visitor left each page (Next keeps the offset per history
  // entry and restores it after rendering) instead of at the top of it
  experimental: { scrollRestoration: true },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/fonts/:path*", headers: fontCache },
      { source: "/brand/:path*", headers: assetCache },
      // roster/team photo originals — also what /_next/image optimizes from
      { source: "/assets/:path*", headers: assetCache },
    ];
  },
  // the public "meet the team" page moved from /staff to /team — keep old
  // bookmarks/search results/backlinks working instead of 404ing.
  //
  // pay.defiedmgmt.com/<name> -> that person's Stripe payment link, so
  // links shared out loud/in a DM stay short and on-brand instead of a raw
  // buy.stripe.com URL. `has: host` scopes each rule to the pay subdomain
  // only — the main domain's own routes are untouched. Not permanent: a
  // Stripe Payment Link can be deactivated and regenerated with a new URL,
  // and a 308 would get cached by browsers/crawlers past that point.
  async redirects() {
    const payLinks = {
      mag: "https://buy.stripe.com/eVq4greNXaRp9NF7QQ9sk00",
      ella: "https://buy.stripe.com/7sYfZ9fSG9Pocol1Kf33W00",
      devin: "https://buy.stripe.com/aFa4gr7eyaLEdrdeJfcV200",
      hank: "https://buy.stripe.com/3cIeV5ct53z2bHb0zXenS00",
      jordan: "https://buy.stripe.com/00w5kv8nS5bg7rO5pNcZa00",
    };
    const payRedirects = Object.entries(payLinks).map(([name, destination]) => ({
      source: `/${name}`,
      has: [{ type: "host", value: "pay.defiedmgmt.com" }],
      destination,
      permanent: false,
    }));
    return [{ source: "/staff", destination: "/team", permanent: true }, ...payRedirects];
  },
  // next/image only allows hosts listed here — otherwise it silently 404s on
  // any remote src instead of falling back to the (more permissive) default
  // it uses when no next.config.js exists at all. Every remote host actually
  // used as an image src across the site: Spotify cover art, and photos
  // hosted on the public marketing site's own asset folder. User-uploaded
  // photos become data: URIs (PhotoUpload -> fileToDataURL), not remote
  // hosts, so they're unaffected by this list.
  images: {
    // optimized photos are kept a day too (same rule as the originals above)
    minimumCacheTTL: 86400,
    remotePatterns: [
      { protocol: "https", hostname: "i.scdn.co" },
      { protocol: "https", hostname: "www.defiedmgmt.com" },
    ],
  },
};

module.exports = nextConfig;
