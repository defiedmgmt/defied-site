import PageShell from "../components/PageShell";
import { ErrorScreen } from "../components/app/ErrorScreen";

// (2026-11-25, mobile) A server error (Next also builds the static 500 page from this one), or a crash the dashboard's and portal's own
// boundary didn't catch: the site's own screen with "Try again", instead of Next's white page (an installed iPhone app has no reload
// button). Unknown addresses use pages/404.jsx. No getInitialProps: the same words fit every case, and the 500 page stays static.
export default function ErrorPage() {
  return (
    <>
      <PageShell title="Something went wrong — Defied MGMT" description="This page hit a problem." path="/" noindex />
      <ErrorScreen />
    </>
  );
}
