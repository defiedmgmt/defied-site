import React from "react";
import { Disc3 } from "lucide-react";
import { ICONS, Photo } from "../shared/ui";
import { Credit, Glyphs, PUBLIC_CACHE_KEY, creditText, creditsOf, rosterCreditsOn, webLink } from "./data";
import { Marquee, SplitHead } from "./motion";

/* ------------------------------------------------------------------ */
/*  ABOUT + NOTABLE RELEASES                                            */
/* ------------------------------------------------------------------ */
// release covers arrive as 640px Spotify JPEGs — through the optimizer at the size each layout shows
// (3x phones get ~2x, as for the roster cards): About's grid, its featured pair, the artist panel's rail
const COVER_SIZES = "(max-width: 599px) and (min-resolution: 2.5dppx) 29vw, (max-width: 599px) 46vw, (max-width: 1199px) 22vw, 280px";
const FEAT_COVER_SIZES = "(max-width: 599px) and (min-resolution: 2.5dppx) 62vw, (max-width: 599px) 92vw, 560px";
const RAIL_COVER_SIZES = "(max-width: 599px) and (min-resolution: 2.5dppx) 45vw, (max-width: 599px) 68vw, (max-width: 899px) 180px, 150px";
// the dashboard takes any streaming link ("Paste a Spotify link", but Apple/YouTube/SoundCloud work too):
// each card names the service it opens, and an unknown one just says Listen
const SERVICES = [
  [/(^|\.)spotify\.com$/, "spotify", "Play on Spotify"],
  [/(^|\.)(music|itunes)\.apple\.com$/, "apple", "Play on Apple Music"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube", "Watch on YouTube"],
  [/(^|\.)soundcloud\.com$/, "soundcloud", "Play on SoundCloud"],
];
const PLAY_ICON = (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>;
function serviceOf(href) {
  let host = "";
  try { host = new URL(href).hostname.toLowerCase(); } catch { /* not a URL */ }
  const hit = SERVICES.find(([re]) => re.test(host));
  return hit ? { icon: ICONS[hit[1]], cta: hit[2] } : { icon: PLAY_ICON, cta: "Listen" };
}
export function ReleaseCard({ r, clients, compact = false, featured = false }) {
  const href = webLink(r.link);
  const svc = href ? serviceOf(href) : null;
  const Tag = href ? "a" : "div";
  const credits = compact ? [] : rosterCreditsOn(r, clients);
  return (
    <Tag className={`rc${featured ? " rc-feat" : ""}${compact ? " rc-compact" : ""}`} {...(compact ? {} : { "data-reveal": "" })} {...(href ? { href, target: "_blank", rel: "noreferrer" } : {})}>
      <div className="rc-cover">
        {r.cover ? <Photo src={r.cover} alt="" fill sizes={featured ? FEAT_COVER_SIZES : compact ? RAIL_COVER_SIZES : COVER_SIZES} /> : <div className="rc-empty"><Disc3 size={30} /></div>}
        {svc && <span className="rc-play" aria-hidden="true">{svc.icon(18)}</span>}
      </div>
      <div className="rc-meta">
        <strong>{r.song}</strong>
        <span className="rc-artist">{r.artist}</span>
        {credits.length > 0 && (
          <span className="rc-chips">
            {/* "Prod. prodbylandn" says prod twice — a name that already starts with it stands alone */}
            {credits.map((c, i) => <em key={`${c.name}-${i}`} className="chip-tag">{c.prod && !/^prod/i.test(c.name) && "Prod. "}<Glyphs text={c.name} /></em>)}
          </span>
        )}
        {featured && svc && <span className="rc-cta">{svc.cta} <span aria-hidden="true">↗</span></span>}
      </div>
    </Tag>
  );
}

// Four or more releases use the 4-column grid (2 on phones), and the first in
// the dashboard's own order get double-size tiles — as many as keep every row
// full: each big tile fills 4 cells, so 10 → 2 big, 9 → 1, 11 → 3, 8 → none.
const featuredCount = (n) => (n < 5 ? 0 : [2, 1, 3, 0].find((k) => n > k && (n + 3 * k) % 4 === 0) || 0);

// "long-term", "hands-on": a short hyphenated word wraps as one, never "long- / term" (a long one,
// such as a web address typed into the dashboard, can still break, so it never pushes a phone sideways)
const keepHyphens = (text) => String(text).split(/(\s+)/).map((part, i) => (/^[^\s-]+-\S+$/.test(part) && part.length <= 24 ? <span className="nobr" key={i}>{part}</span> : part));

export function About({ publicData }) {
  if (!publicData) return <main className="pg"><PageLoading /></main>;
  const about = publicData.about || "";
  const notable = (publicData.notableReleases || []).filter((r) => r.song);
  const credits = creditsOf(publicData);
  const nFeat = featuredCount(notable.length);
  return (
    <main className="pg about2">
      <SplitHead text="DEFYING THE NORMS OF TALENT MANAGEMENT." chrome strike="NORMS" breakAfter="NORMS" className="about2-head" />
      <div className="about2-body">
        {about.split(/\n{2,}/).map((para, i) => <p key={i}>{keepHyphens(para)}</p>)}
      </div>

      {credits.length > 0 && (
        <Marquee
          className="about2-band"
          label="Notable placements"
          seconds={Math.max(45, credits.length * 7)}
          items={credits.map((c) => ({ ...c, text: creditText(c) }))}
          render={(c) => <Credit c={c} sizes="(max-width: 666px) 21px, (max-width: 1340px) 3.2vw, 42px" lift="105px" />}
        />
      )}


      <section className="rel2">
        <SplitHead text="NOTABLE RELEASES" tag="h2" onView className="sec-head" />
        {notable.length === 0 ? (
          <p className="muted releases-empty-note">Add notable releases in the dashboard to feature them here.</p>
        ) : (
          <div className={`rel2-grid${notable.length >= 4 ? " rel2-feat" : ""}`}>
            {notable.map((r, i) => <ReleaseCard key={r.id} r={r} featured={i < nFeat} clients={publicData.clients || []} />)}
          </div>
        )}
      </section>
    </main>
  );
}

// A public page that throws while drawing the saved copy (e.g. an older payload shape after a deploy
// that didn't bump PUBLIC_CACHE_KEY) must not take the whole app down: drop that copy and show the
// loading state until the fresh one lands, then draw again (or show the banner if it can't load, or
// if the fresh copy is the one that failed).
export class PageGuard extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() {
    try { localStorage.removeItem(PUBLIC_CACHE_KEY); } catch { /* storage blocked */ }
    this.props.onDrop?.();
  }
  componentDidUpdate(prev) { if (this.state.failed && prev.data !== this.props.data) this.setState({ failed: false }); }
  render() {
    if (this.props.outage) return <PageOutage />;
    return this.state.failed ? <main className="pg"><PageLoading /></main> : this.props.children;
  }
}
// the public pages that can't show anything without /api/public-data
export const DATA_ROUTES = ["about", "team", "roster"];
// first visit, and the site data couldn't load: an honest page with a way to try again, not an empty one
function PageOutage() {
  return (
    <main className="pg pg-outage">
      <p className="pg-outage-msg">This page couldn't load right now.</p>
      <button type="button" className="pill pill-ghost" onClick={() => window.location.reload()}>Try again</button>
    </main>
  );
}

export function PageLoading() {
  return <div className="pg-loading" role="status" aria-label="Loading"><span /><span /><span /></div>;
}
