import PageShell from "../components/PageShell";
import { PublicPage } from "../components/app/AppRoot";
import { Home } from "../components/site/Home";

// Home needs none of the site data, so it's a static page (rendered once, at build time)
export default function HomePage() {
  return (
    <>
      <PageShell
        title="Defied MGMT"
        description="Defied Management — independent music management and publishing administration."
        path="/"
        preloadHero
      />
      <PublicPage><Home /></PublicPage>
    </>
  );
}
