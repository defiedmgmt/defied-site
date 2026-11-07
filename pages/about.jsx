import PageShell from "../components/PageShell";
import { PublicPage, useApp } from "../components/app/AppRoot";
import { About } from "../components/site/About";

// r11 launch: a static page served from the CDN, as on live (no database read per visit); the content
// comes from the app shell's publicData (the browser's saved copy, then /api/public-data)

export default function AboutPage() {
  const { publicData } = useApp();
  return (
    <>
      <PageShell
        title="About — Defied MGMT"
        description="Defied Management is an independent music management and publishing administration company."
        path="/about"
      />
      <PublicPage><About publicData={publicData} /></PublicPage>
    </>
  );
}
