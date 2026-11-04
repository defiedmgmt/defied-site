import PageShell from "../components/PageShell";
import { NotFound } from "../components/site/NotFound";

// Any unknown URL: the site's own "page not found" view, inside the site's nav and footer (the app shell's)
export default function NotFoundPage() {
  return (
    <>
      <PageShell
        title="Page not found — Defied MGMT"
        description="This page doesn't exist or has moved."
        path="/404"
        noindex
      />
      <NotFound />
    </>
  );
}
