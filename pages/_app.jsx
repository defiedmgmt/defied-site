import { Analytics } from "@vercel/analytics/next";
import AppRoot from "../components/app/AppRoot";
import "../components/ui/mobile.css"; // the shared mobile-first helper (list B #10)
import "../components/ar/ar.css"; // A&R › Trackers and Radar (list B #5, #6, #8)
import "../components/trueup.css"; // TRUEUP-HOOK: the monthly Luminate true-up in To do
import "../styles/sections.css"; // list B #11: a dashboard section's placeholder while its code loads
// the site's and the dashboard's stylesheet (list B #11: was App's inline <style>); last, as it was
import "../styles/app.css";

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
