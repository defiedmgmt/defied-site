import PageShell from "../components/PageShell";
import { PublicPage, useApp } from "../components/app/AppRoot";
import { Roster } from "../components/site/people";
import { publicPageProps } from "../lib/public-data";

// rendered on the server from the site data (list B #11), so the page's content is in its HTML
export const getServerSideProps = publicPageProps;

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
