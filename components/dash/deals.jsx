import dynamic from "next/dynamic";
import { PanelWait } from "./sections";

// Deals (2026-11-23, the owner: "Deals, Catalog, Release desk, Clients → Roster": a section of its own after Money, for Founders): the publishing-administration deal with EMPIRE and the
// advance calculator, which were Money's last two pills. The two pages are the ones that were in Money, unchanged (components/dash/empire.jsx and empire-calc.jsx; each has its own read and its
// own chunk, loaded the first time it opens). StaffDashboard gives this section to the one account that has them: a Founder with Money access and every artist (the API refuses everyone else).
// EMPIRE recoupment is where Deals opens (/dashboard/deals, also /dashboard/deals/empire); the calculator is /dashboard/deals/advance. Money's and Clients' old addresses for them open here (StaffDashboard placeOf).
const EmpireDeal = dynamic(() => import("./empire").then((m) => m.EmpireDeal), { ssr: false, loading: PanelWait });
const AdvanceDeal = dynamic(() => import("./empire-calc").then((m) => m.AdvanceDeal), { ssr: false, loading: PanelWait });

export const DEAL_PILLS = [["empire", "EMPIRE recoupment"], ["advance", "Advance calculator"]];
export function DealsAdmin({ sub, onSub, db = null }) {
  const home = "empire"; // where Deals opens: its address has no part
  const sec = DEAL_PILLS.some(([k]) => k === sub) ? sub : home;
  return (
    <div className="deals-page" data-deals-page={sec}>
      <div className="admin-head"><h2>Deals</h2></div>
      <div className="subnav" role="tablist" aria-label="Deals">
        {DEAL_PILLS.map(([k, l]) => <button key={k} role="tab" aria-selected={sec === k} data-deals-tab={k} className={sec === k ? "subpill active" : "subpill"} onClick={() => onSub(k === home ? null : k)}>{l}</button>)}
      </div>
      {sec === "advance" ? <AdvanceDeal db={db} /> : <EmpireDeal onPlan={() => onSub("advance")} />}
    </div>
  );
}
