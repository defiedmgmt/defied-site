import PageShell from "../components/PageShell";
import { useApp } from "../components/app/AppRoot";
import { ClientPortal } from "../components/portal/ClientPortal";

export default function PortalPage() {
  const { session, db, commit, logout, signingOut } = useApp();
  return (
    <>
      <PageShell title="Client Portal — Defied MGMT" description="Defied Management client portal." path="/portal" noindex />
      {/* session undefined = /api/auth/me hasn't answered: the same "Loading…" as the data load after it */}
      {(session === undefined || session?.role === "client") && (
        db ? <ClientPortal db={db} commit={commit} session={session} logout={logout} signingOut={signingOut} /> : <p className="muted page">Loading…</p>
      )}
    </>
  );
}
