import dynamic from "next/dynamic";
import { RefreshCw, AlertTriangle } from "lucide-react";

// The dashboard's sections, each its own chunk of code (list B #11). Opening /dashboard/money downloads
// the shell (StaffDashboard: the sidebar, the address, the counts) and Money's code, nothing of A&R or
// Publishing; a section's code comes the first time it opens (or as the pointer reaches its sidebar
// button: SECTION_CODE[id]() starts the download), and stays for the rest of the visit. While it's on
// its way the section's place shows SectionWait, so the old section is never left showing.
// The shell must not import a section module directly: that would put it back in every section's code.
// Its small shared parts live in leaf modules (chips, access, todo-data, home-data, catalog-data,
// ../portal/ask, ../trueup-data), which import no section.
export const SECTION_CODE = {
  home: () => import("./home"),
  todo: () => import("./todo"),
  catalog: () => import("./catalog"),
  money: () => import("./money"),
  ar: () => import("./ar"),
  site: () => import("./site"),
};

// a calm placeholder the size of a section's head and first rows, while its code loads. Its code couldn't
// load (offline, or the site was updated since this page opened): say so, with a way out
const LoadFailed = ({ retry }) => (
  <p className="home-muted" role="alert" data-load-failed>
    <AlertTriangle size={15} /> <span>This part of the dashboard didn't load. <button type="button" className="inline-link" onClick={() => window.location.reload()}>Reload the page</button></span>
  </p>
);
export function SectionWait({ error, retry }) {
  if (error) return <LoadFailed retry={retry} />;
  return (
    <div className="section-wait" aria-busy="true" aria-live="polite" data-section-wait>
      <span className="sw-bar sw-head" />
      <span className="sw-bar" />
      <span className="sw-bar" />
      <span className="sw-bar sw-short" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

// the same, for a panel opened inside a section (To do's rows): the one calm line those panels show while loading
export function PanelWait({ error, retry }) {
  if (error) return <LoadFailed retry={retry} />;
  return <p className="home-muted" aria-busy="true" data-panel-wait><RefreshCw size={15} className="spin" /> Loading…</p>;
}

const section = (load, name) => dynamic(() => load().then((m) => m[name]), { ssr: false, loading: SectionWait });
export const HomeDashboard = section(SECTION_CODE.home, "HomeDashboard");
export const TodoPage = section(SECTION_CODE.todo, "TodoPage");
export const CatalogAdmin = section(SECTION_CODE.catalog, "CatalogAdmin");
export const AccountingAdmin = section(SECTION_CODE.money, "AccountingAdmin");
export const ARAdmin = section(SECTION_CODE.ar, "ARAdmin");
export const SiteAdmin = section(SECTION_CODE.site, "SiteAdmin");
