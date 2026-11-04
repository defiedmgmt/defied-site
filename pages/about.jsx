import PageShell from "../components/PageShell";
import { PublicPage, useApp } from "../components/app/AppRoot";
import { About } from "../components/site/About";
import { publicPageProps } from "../lib/public-data";

// rendered on the server from the site data (list B #11), so the page's content is in its HTML
export const getServerSideProps = publicPageProps;

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
