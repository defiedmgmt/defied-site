import PageShell from "../components/PageShell";
import { PublicPage, useApp } from "../components/app/AppRoot";
import { Contact } from "../components/site/Contact";
import { publicPageProps } from "../lib/public-data";

// rendered on the server from the site data (list B #11), so the page's content is in its HTML
export const getServerSideProps = publicPageProps;

export default function ContactPage() {
  const { publicData } = useApp();
  return (
    <>
      <PageShell
        title="Contact — Defied MGMT"
        description="Get in touch with Defied Management."
        path="/contact"
      />
      <PublicPage><Contact publicData={publicData} /></PublicPage>
    </>
  );
}
