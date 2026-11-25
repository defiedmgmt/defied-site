import { Analytics } from "@vercel/analytics/next";
import AppRoot from "../components/app/AppRoot";
import "../components/ui/mobile.css"; // the shared mobile-first helper (list B #10)
import "../components/ar/ar.css"; // A&R › Trackers and Radar (list B #5, #6, #8)
import "../components/ar/ar-grid.css"; // A&R lists (r10): the grid, A&R Home, the drawer
import "../components/trueup.css"; // TRUEUP-HOOK: the monthly Luminate true-up in To do
import "../styles/sections.css"; // list B #11: a dashboard section's placeholder while its code loads
// the site's and the dashboard's stylesheet (list B #11: was App's inline <style>); last, as it was
import "../styles/app.css";
import "../styles/share.css"; // the share card's button and window (2026-11-13): after app.css, whose dialog it builds on
import "../styles/empire.css"; // Money › EMPIRE recoupment and Advance calculator (2026-11-21): after app.css, whose dashboard tokens and Advance calculator classes it builds on
import "../styles/roster.css"; // Roster › Catalog and Releases (2026-11-23): the few rules the two lists need, on top of the dashboard's own table, chip and search styles
// the mobile layer (2026-11-25), after every stylesheet above so its rules win a tie with theirs: the shared phone, touch and installed-app
// rules first, then one sheet per area, which win over the shared one
import "../styles/m-global.css";
import "../styles/m-home.css"; // Home, To do, A&R
import "../styles/m-money.css"; // Money
import "../styles/m-roster.css"; // Roster
import "../styles/m-site.css"; // Site
import "../styles/m-public.css"; // the public site, sign-in and the client portal

// The app shell (components/app/AppRoot.jsx) is mounted once here, not per page: it holds the session,
// the dashboard's data and its save queue in memory, so it must survive client-side route changes
// between pages instead of being unmounted and remounted by each page file. It draws the site's nav and
// footer and puts the page (<Component>) inside them. Each page file draws its own content and <Head>
// (PageShell): the public pages are rendered on the server, and each page's code is its own bundle, so
// the public site no longer downloads the dashboard (list B #11).
export default function MyApp({ Component, pageProps }) {
  return (
    <>
      <AppRoot Component={Component} pageProps={pageProps} />
      <Analytics />
    </>
  );
}
