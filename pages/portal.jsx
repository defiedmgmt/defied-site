import PageShell from "../components/PageShell";
import { useApp } from "../components/app/AppRoot";
import { ClientPortal } from "../components/portal/ClientPortal";
import { AppErrorBoundary, ErrorScreen } from "../components/app/ErrorScreen";

export default function PortalPage() {
  const { session, db, commit, logout, signingOut, loadFailed, loadErr, retryLoad } = useApp();
  return (
    <>
      <PageShell title="Client Portal — Defied MGMT" description="Defied Management client portal." path="/portal" noindex />
      {/* session undefined = /api/auth/me hasn't answered: the same "Loading…" as the data load after it */}
      {(session === undefined || session?.role === "client") && (
        // (2026-11-25, mobile) a part that breaks shows the site's own error screen with Try again (components/app/ErrorScreen.jsx), never a white page
        // (2026-11-26 review) ClientPortal has its own boundary under its header, so this one is the last resort; a dataset that didn't load gets the
        // same screen with Try again and Sign out
        loadFailed ? <ErrorScreen text={loadErr} onRetry={retryLoad} onSignOut={logout} signingOut={signingOut} /> : db ? <AppErrorBoundary resetKey={session?.id}><ClientPortal db={db} commit={commit} session={session} logout={logout} signingOut={signingOut} /></AppErrorBoundary> : <p className="muted page">Loading…</p>
      )}
    </>
  );
}
