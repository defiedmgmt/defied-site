import PageShell from "../components/PageShell";
import { PublicPage, useApp } from "../components/app/AppRoot";
import { Roster } from "../components/site/people";

// r11 launch: a static page served from the CDN, as on live (no database read per visit); the content
// comes from the app shell's publicData (the browser's saved copy, then /api/public-data)

export default function RosterPage() {
  const { publicData } = useApp();
  return (
    <>
      <PageShell
        title="Roster — Defied MGMT"
        description="The Defied Management roster of producers and artists."
        path="/roster"
      />
      <PublicPage><Roster publicData={publicData} /></PublicPage>
    </>
  );
}
