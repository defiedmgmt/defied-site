import PageShell from "../components/PageShell";
import { PublicPage, useApp } from "../components/app/AppRoot";
import { TeamPage } from "../components/site/people";

// r11 launch: a static page served from the CDN, as on live (no database read per visit); the content
// comes from the app shell's publicData (the browser's saved copy, then /api/public-data)

export default function TeamRoute() {
  const { publicData } = useApp();
  return (
    <>
      <PageShell
        title="Team — Defied MGMT"
        description="Meet the Defied Management team."
        path="/team"
      />
      <PublicPage><TeamPage publicData={publicData} /></PublicPage>
    </>
  );
}
