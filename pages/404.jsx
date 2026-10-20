import PageShell from "../components/PageShell";

// Any unknown URL. App (mounted in _app) sees router.pathname "/404" and shows its own
// "page not found" view inside the site's nav and footer; this file only supplies <Head>.
export default function NotFoundPage() {
  return (
    <PageShell
      title="Page not found — Defied MGMT"
      description="This page doesn't exist or has moved."
      path="/404"
      noindex
    />
  );
}
