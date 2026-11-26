import { useRouter } from "next/router";
import PageShell from "../../components/PageShell";
import { useApp } from "../../components/app/AppRoot";
import { StaffDashboard } from "../../components/dash/StaffDashboard";
import { AppErrorBoundary, ErrorScreen } from "../../components/app/ErrorScreen";

// Every dashboard section has its own address, /dashboard/<section>[/<part>] (list B #11): Home is plain
// /dashboard, then /dashboard/todo, /dashboard/catalog (Roster), /dashboard/numbers, /dashboard/money (and its deal pills),
// /dashboard/ar (with /dashboard/ar/watch, /board, /trackers, /radar…) and /dashboard/site. One page file
// for all of them, so the sidebar (StaffDashboard) stays mounted between sections. The old addresses
// (/dashboard?tab=money&sub=payments) still open the same place and are rewritten to the new ones.
// r11 fix: each section its own tab title ("To do · Defied"), so several open tabs can be told apart
// (2026-11-23) Roster is what Clients (and Publishing before it) was called, at the same address (/dashboard/catalog). (2026-11-24) Deals is part of Money now: its old address opens Money's first deal pill
const TITLES = { "": "Dashboard", home: "Dashboard", todo: "To do", mytodo: "My to-do", mypay: "My payments", ar: "A&R", money: "Money", deals: "Money", catalog: "Roster", publishing: "Roster", site: "Site", numbers: "Site" };
const dashTitle = (section) => `${TITLES[String(section || "")] || "Dashboard"} · Defied`;
export default function DashboardPage() {
  const { session, db, commit, reloadDb, logout, signingOut, loadFailed, loadErr, retryLoad } = useApp();
  const { query, asPath } = useRouter();
  const section = Array.isArray(query.section) ? query.section[0] : query.section;
  return (
    <>
      <PageShell title={dashTitle(section)} description="Defied Management staff dashboard." path="/dashboard" noindex />
      {/* session undefined = /api/auth/me hasn't answered: the same "Loading…" as the data load after it */}
      {/* (2026-11-25, mobile) a section that breaks shows the site's own error screen with Try again (components/app/ErrorScreen.jsx), never a white page;
          another address draws the dashboard again. (2026-11-26 review) StaffDashboard has its own boundary around the section, so a section that breaks
          keeps the sidebar, the phone tab bar and Sign out; this one is the last resort. The dataset itself didn't load (loadFailed): the same screen, with
          Try again (reads it again) and Sign out, never a lone banner on a black page */}
      {(session === undefined || session?.role === "staff") && (
        loadFailed ? <ErrorScreen text={loadErr} onRetry={retryLoad} onSignOut={logout} signingOut={signingOut} /> : db ? <AppErrorBoundary resetKey={asPath}><StaffDashboard db={db} commit={commit} reloadDb={reloadDb} logout={logout} signingOut={signingOut} name={session?.name} /></AppErrorBoundary> : <p className="muted page">Loading…</p>
      )}
    </>
  );
}
