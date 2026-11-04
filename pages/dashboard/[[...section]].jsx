import PageShell from "../../components/PageShell";
import { useApp } from "../../components/app/AppRoot";
import { StaffDashboard } from "../../components/dash/StaffDashboard";

// Every dashboard section has its own address, /dashboard/<section>[/<part>] (list B #11): Home is plain
// /dashboard, then /dashboard/todo, /dashboard/catalog (Publishing), /dashboard/numbers, /dashboard/money,
// /dashboard/ar (with /dashboard/ar/watch, /board, /trackers, /radar…) and /dashboard/site. One page file
// for all of them, so the sidebar (StaffDashboard) stays mounted between sections. The old addresses
// (/dashboard?tab=money&sub=payments) still open the same place and are rewritten to the new ones.
export default function DashboardPage() {
  const { session, db, commit, reloadDb, logout, signingOut } = useApp();
  return (
    <>
      <PageShell title="Staff Dashboard — Defied MGMT" description="Defied Management staff dashboard." path="/dashboard" noindex />
      {/* session undefined = /api/auth/me hasn't answered: the same "Loading…" as the data load after it */}
      {(session === undefined || session?.role === "staff") && (
        db ? <StaffDashboard db={db} commit={commit} reloadDb={reloadDb} logout={logout} signingOut={signingOut} /> : <p className="muted page">Loading…</p>
      )}
    </>
  );
}
