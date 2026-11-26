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
      // cdnjs: the dashboard's photo upload loads heic2any from there to convert iPhone HEIC photos
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com https://cdnjs.cloudflare.com",
      // heic2any does its decoding in a worker it starts from a blob: URL
      "worker-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      // Spotify/Sheets cover art and profile photos are fetched from arbitrary https hosts
      "img-src 'self' data: https:",
      "font-src 'self'",
      // the API layer only ever talks to the browser same-origin; outbound calls to
      // Google/Spotify/Luminate happen server-side in API routes, never from client JS.
      // vitals.vercel-insights.com is where Vercel Web Analytics beacons page views.
      // content.dropboxapi.com: the contact form sends a music file straight to its one-time Dropbox upload link
      // (2026-11-10, lib/dropbox.js); CSP_EXTRA_CONNECT is only for the local test copy's stand-in Dropbox
      // vercel.com/api/blob: Site › Instagram's video upload goes from the browser straight to Vercel Blob (2026-11-16, @vercel/blob/client)
      `connect-src 'self' https://vitals.vercel-insights.com https://content.dropboxapi.com https://vercel.com${process.env.CSP_EXTRA_CONNECT ? ` ${process.env.CSP_EXTRA_CONNECT}` : ""}`,
      // a message's music files play in Site › Messages straight from Dropbox (2026-11-10): a shared link with raw=1
      // redirects to <id>.dl.dropboxusercontent.com
      // blob: and the Blob store: Site › Instagram previews the video it's about to post (2026-11-16)
      `media-src 'self' blob: https://*.public.blob.vercel-storage.com https://www.dropbox.com https://*.dl.dropboxusercontent.com${process.env.CSP_EXTRA_CONNECT ? ` ${process.env.CSP_EXTRA_CONNECT}` : ""}`,
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
  // r11 fix: "1" on every build but the live site's production one (lib/preview.js: a preview says its saves are off)
  env: { DEFIED_PREVIEW: process.env.VERCEL_ENV === "production" ? "" : "1" },
  // no "X-Powered-By: Next.js" header on every response
  poweredByHeader: false,
  // Back/Forward land where the visitor left each page (Next keeps the offset per history
  // entry and restores it after rendering) instead of at the top of it
  experimental: {
    scrollRestoration: true,
    // the share card (pages/api/share-card.js, lib/share-card-render.js) reads its fonts and logo from disk at
    // process.cwd(): public/ isn't part of a function on Vercel, so these files are traced into that one function,
    // with next/og's own engine and font (it loads them with a dynamic import, which the tracer may not follow)
    outputFileTracingIncludes: {
      "/api/share-card": [
        "./public/fonts/suntage.otf",
        "./public/brand/wordmark.png",
        "./public/brand/d.png",
        "./node_modules/next/dist/compiled/@vercel/og/**/*",
      ],
    },
  },
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
  // pay.defiedmgmt.com/<key> -> that manager's Stripe payment link, so links
  // shared out loud/in a DM stay short and on-brand instead of a raw
  // buy.stripe.com URL. (2026-11-26) The links are a Founders' setting in
  // Site › Users now, not a list here: this sends the key (and its query:
  // the amount and who's paying) to /api/pay/[key], which reads the setting
  // and answers with a 302 to Stripe (never permanent, never cached: a link
  // can be changed). `has: host` scopes it to the pay subdomain only — the
  // main domain's own routes are untouched. A redirect, not a rewrite: any
  // rewrite puts Next's rewrite matcher into every page's shared JS (+4.6 kB
  // gzipped on the public site too), for a link only payers open.
  async redirects() {
    return [
      { source: "/staff", destination: "/team", permanent: true },
      { source: "/:key([a-z][a-z0-9]{1,15})", has: [{ type: "host", value: "pay.defiedmgmt.com" }], destination: "/api/pay/:key", permanent: false },
    ];
  },
  // next/image only allows hosts listed here — otherwise it silently 404s on
  // any remote src instead of falling back to the (more permissive) default
  // it uses when no next.config.js exists at all. Every remote host actually
  // used as an image src across the site: Spotify cover art, and photos
  // hosted on the public marketing site's own asset folder, and the photos
  // and covers uploaded in the dashboard (Vercel Blob's public store,
  // /api/upload-image). Ones uploaded before that are data: URIs, which don't
  // go through the optimizer at all.
  images: {
    // optimized photos are kept a day too (same rule as the originals above)
    minimumCacheTTL: 86400,
    remotePatterns: [
      { protocol: "https", hostname: "i.scdn.co" },
      { protocol: "https", hostname: "www.defiedmgmt.com" },
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
    ],
  },
};

module.exports = nextConfig;
