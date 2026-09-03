import Head from "next/head";

const SITE_URL = "https://www.defiedmgmt.com";
const DEFAULT_IMAGE = `${SITE_URL}/icon-512.png`;

// Each page file renders this for its <Head> metadata only — App itself is
// mounted once in _app.jsx and persists across navigation; see the note
// there for why it can't be mounted per-page.
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

export default function PageShell({ title, description, path = "/", image = DEFAULT_IMAGE, noindex = false }) {
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
      <link rel="canonical" href={url} />
      {noindex && <meta name="robots" content="noindex, nofollow" />}
      <link rel="icon" href="/favicon.ico" sizes="any" />
      <link rel="icon" type="image/png" href="/icon-512.png" sizes="512x512" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

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
