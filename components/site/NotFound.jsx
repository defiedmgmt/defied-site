import { ROUTE_TO_PATH } from "../shared/routes";
import { TLink } from "../shared/ui";
import { SplitHead } from "./motion";

// a mistyped or old link: say so in the site's own voice, and offer the two ways back in
export function NotFound() {
  return (
    <main className="pg nf">
      <p className="micro-label nf-code">Error 404</p>
      <SplitHead text="PAGE NOT FOUND." chrome className="pg-head" />
      <p className="nf-lead">This page doesn't exist or has moved.</p>
      <div className="nf-cta">
        <TLink href={ROUTE_TO_PATH.home} className="pill pill-solid">Back home</TLink>
        <TLink href={ROUTE_TO_PATH.roster} className="pill pill-ghost">See the roster</TLink>
      </div>
    </main>
  );
}
