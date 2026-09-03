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
      "font-src 'self' data:",
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

const nextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // the public "meet the team" page moved from /staff to /team — keep old
  // bookmarks/search results/backlinks working instead of 404ing.
  async redirects() {
    return [{ source: "/staff", destination: "/team", permanent: true }];
  },
  // next/image only allows hosts listed here — otherwise it silently 404s on
  // any remote src instead of falling back to the (more permissive) default
  // it uses when no next.config.js exists at all. Every remote host actually
  // used as an image src across the site: Spotify cover art, and photos
  // hosted on the public marketing site's own asset folder. User-uploaded
  // photos become data: URIs (PhotoUpload -> fileToDataURL), not remote
  // hosts, so they're unaffected by this list.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.scdn.co" },
      { protocol: "https", hostname: "www.defiedmgmt.com" },
    ],
  },
};

module.exports = nextConfig;
