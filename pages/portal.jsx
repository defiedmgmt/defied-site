import PageShell from "../components/PageShell";
import { useApp } from "../components/app/AppRoot";
import { ClientPortal } from "../components/portal/ClientPortal";
import { AppErrorBoundary } from "../components/app/ErrorScreen";

export default function PortalPage() {
  const { session, db, commit, logout, signingOut } = useApp();
  return (
    <>
      <PageShell title="Client Portal — Defied MGMT" description="Defied Management client portal." path="/portal" noindex />
      {/* session undefined = /api/auth/me hasn't answered: the same "Loading…" as the data load after it */}
      {(session === undefined || session?.role === "client") && (
        // (2026-11-25, mobile) a part that breaks shows the site's own error screen with Try again (components/app/ErrorScreen.jsx), never a white page
        db ? <AppErrorBoundary resetKey={session?.id}><ClientPortal db={db} commit={commit} session={session} logout={logout} signingOut={signingOut} /></AppErrorBoundary> : <p className="muted page">Loading…</p>
      )}
    </>
  );
}
