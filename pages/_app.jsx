import dynamic from "next/dynamic";
import { Analytics } from "@vercel/analytics/next";

// Mounted once here, not per-page — App holds session/db state in memory
// with no persistence of its own, so it must survive client-side route
// changes between pages instead of being unmounted and remounted by each
// page file. It reads the current URL itself (useRouter) to decide what to
// show; each page's own file only supplies <Head> metadata via <Component>.
const App = dynamic(() => import("../components/App"), { ssr: false });

export default function MyApp({ Component, pageProps }) {
  return (
    <>
      <Component {...pageProps} />
      <App />
      <Analytics />
    </>
  );
}
