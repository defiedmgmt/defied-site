import PageShell from "../components/PageShell";
import { PublicPage, useApp } from "../components/app/AppRoot";
import { TeamPage } from "../components/site/people";
import { publicPageProps } from "../lib/public-data";

// rendered on the server from the site data (list B #11), so the page's content is in its HTML
export const getServerSideProps = publicPageProps;

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
