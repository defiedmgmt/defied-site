import Head from "next/head";

const SITE_URL = "https://www.defiedmgmt.com";
const DEFAULT_IMAGE = `${SITE_URL}/icon-512.png`;

// Each page file renders this for its <Head> metadata, beside its own content —
// the app shell (components/app/AppRoot.jsx) is mounted once in _app.jsx and
// persists across navigation; see the note there for why.
//
// `path` (e.g. "/about") drives the canonical + Open Graph/Twitter URLs —
// passed explicitly per page rather than read from the router, so these
// tags are correct in the very first server-rendered response (the router
// isn't guaranteed settled that early) and so link-preview bots that never
// run JS still see the right URL.
const ORG_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Defied Management",
  url: SITE_URL,
  logo: DEFAULT_IMAGE,
  sameAs: ["https://instagram.com/defiedmgmt", "https://x.com/defiedmgmt"],
};

export default function PageShell({ title, description, path = "/", image = DEFAULT_IMAGE, noindex = false, preloadHero = false, preloadFont = true }) {
  const url = `${SITE_URL}${path === "/" ? "" : path}`;
  return (
    <Head>
      {!noindex && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_JSON_LD) }} />
      )}
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="theme-color" content="#000000" />
      <meta name="color-scheme" content="dark" />
      {/* the page is black before its stylesheet has loaded too, instead of flashing white */}
      <style dangerouslySetInnerHTML={{ __html: "html,body{background:#000;margin:0}" }} />
      {/* the home wordmark is the first thing painted: start downloading it with the HTML */}
      {preloadHero && <link rel="preload" as="image" href="/brand/wordmark.webp" fetchpriority="high" />}
      {/* the same goes for the brand font and the site data (the browser's own fresh copy of what
          the server drew): both start with the HTML instead of after the JS */}
      {/* the dashboard and portal set their titles and labels in it too, so they preload it as well */}
      {preloadFont && <link rel="preload" as="font" type="font/otf" href="/fonts/suntage.otf" crossOrigin="anonymous" />}
      <link rel="preload" as="fetch" href="/api/public-data" crossOrigin="anonymous" />
      {!noindex && <link rel="canonical" href={url} />}
      {noindex && <meta name="robots" content="noindex, nofollow" />}
      <link rel="icon" href="/favicon.ico" sizes="any" />
      <link rel="icon" type="image/png" href="/icon-512.png" sizes="512x512" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      {/* (2026-11-11) the site as an app on a phone's home screen: "Defied", full screen, opening on the sign-in page
          (which goes straight on to the portal or dashboard when signed in). public/manifest.webmanifest */}
      <link rel="manifest" href="/manifest.webmanifest" />
      <meta name="apple-mobile-web-app-title" content="Defied" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black" />

      {/* Open Graph — link previews on iMessage, Slack, Discord, Facebook, etc. */}
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="Defied Management" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={image} />

      {/* Twitter/X card */}
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:site" content="@defiedmgmt" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
    </Head>
  );
}
