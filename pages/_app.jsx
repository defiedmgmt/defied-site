import { useEffect, useState } from "react";
import { Analytics } from "@vercel/analytics/next";
import App from "../components/App";
import "../components/ui/mobile.css"; // the shared mobile-first helper (list B #10)
import "../components/ar/ar.css"; // A&R › Trackers and Radar (list B #5, #6, #8)
// the site's and the dashboard's stylesheet (list B #11: was App's inline <style>); last, as it was
import "../styles/app.css";

// Mounted once here, not per-page — App holds session/db state in memory
// with no persistence of its own, so it must survive client-side route
// changes between pages instead of being unmounted and remounted by each
// page file. It reads the current URL itself (useRouter) to decide what to
// show; each page's own file only supplies <Head> metadata via <Component>.
//
// Imported statically so its code is listed in the HTML and downloads alongside the framework
// (a dynamic import only starts once that has run), but still only mounted on the client, after
// hydration, exactly as dynamic(ssr:false) did.
export default function MyApp({ Component, pageProps }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <>
      <Component {...pageProps} />
      {mounted && <App />}
      <Analytics />
    </>
  );
}
