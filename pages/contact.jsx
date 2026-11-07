import PageShell from "../components/PageShell";
import { PublicPage, useApp } from "../components/app/AppRoot";
import { Contact } from "../components/site/Contact";

// r11 launch: a static page served from the CDN, as on live (no database read per visit); the content
// comes from the app shell's publicData (the browser's saved copy, then /api/public-data)

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
