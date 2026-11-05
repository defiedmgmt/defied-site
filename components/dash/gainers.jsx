import { useState, useEffect, useRef } from "react";
import { Disc3, ChevronDown, TrendingUp } from "lucide-react";
import { StagePill } from "./ar-stages";
import { WowPill } from "./chips";
import { fmt } from "./ui";
import { dashCache } from "../shared/dash-caches";
import { Photo } from "../shared/ui";
import { dayRange } from "./helpers";

// Home's "This week" card (the roster's biggest gainers, the A&R top people) and the scroll helpers its
// lists use. Its own module (list B #11), so the helpers every section shares don't load A&R code.
const SCROLL_ROWS = ".attn-row,.cu-row,.gainer,.pay-row,.acct-row:not(.acct-row-hd)";
// section labels: one that reaches into the fade at the foot is hidden until it's scrolled fully into view,
// so a half-cut "CLICKUP" never peeks above "1 more"
// (Money's "Not in the sheet" head is above its scroll box, never one of these)
const SCROLL_LABELS = ".todo-group,.todo-sub,.gainer-split,.acct-row-hd";
const LABEL_FADE = 24;
export function useScrollMore(ref) {
  const [hidden, setHidden] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      const more = el.scrollTop + el.clientHeight < el.scrollHeight - 4;
      if (more) el.setAttribute("data-more", ""); else el.removeAttribute("data-more");
      const bottom = el.getBoundingClientRect().bottom;
      // a label also waits while what it heads starts in the fade or below (the next label counts as
      // that too), bottom-up so "ClickUp" follows its sub line, which follows its first row: a heading
      // never shows over an empty band
      const labels = [...el.querySelectorAll(SCROLL_LABELS)];
      for (let i = labels.length - 1; i >= 0; i--) {
        const g = labels[i], b = g.getBoundingClientRect(), next = g.nextElementSibling;
        const orphan = !!next && (next.hasAttribute("data-cut") || next.getBoundingClientRect().top >= bottom - LABEL_FADE);
        g.toggleAttribute("data-cut", more && b.top < bottom && (b.bottom > bottom - LABEL_FADE || orphan));
      }
      setHidden(more ? [...el.querySelectorAll(SCROLL_ROWS)].filter((r) => r.offsetParent && r.getBoundingClientRect().bottom > bottom + 2).length || -1 : 0);
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    ro?.observe(el);
    return () => { el.removeEventListener("scroll", check); ro?.disconnect(); };
  });
  return hidden;
}
// the foot of a scrolling card while there's more below: "↓ 7 more", and a click scrolls to them
export const ScrollFoot = ({ n, box }) => (n ? (
  <button type="button" className="home-scroll-foot" onClick={() => box.current?.scrollBy({ top: box.current.clientHeight - 48, behavior: "smooth" })}>
    <ChevronDown size={14} /> {n > 0 ? `${n} more` : "More below"}
  </button>
) : null);

// This week's biggest movers on the roster: its songs (one line per title and artist) and its artists
// (each client's songs that have both weeks, added up), ranked on the server by week-on-week %
// (GET /api/growth?top=1, Spotify streams, global: lib/data/growth.js): from 1,000 streams this week, the
// rest filling in by streams without a %. Each list says the days it covers ("This week" on the Dashboard).
// A&R: the same top people as A&R › Summary (Spotify monthly listeners against a week ago).
const GAINER_TABS = [["songs", "Songs"], ["artists", "Artists"], ["ar", "A&R"]];
function useRosterTop() {
  const [top, setTop] = useState(() => dashCache.top || null);
  const [failed, setFailed] = useState(false);
  const loader = useRef(null);
  useEffect(() => {
    let alive = true;
    const load = () => { setFailed(false); return fetch("/api/growth?top=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!alive) return; if (d?.top) { dashCache.top = d.top; setTop(d.top); } else setFailed(true); }).catch(() => alive && setFailed(true)); };
    loader.current = load;
    load();
    return () => { alive = false; };
  }, []);
  return { top, failed, retry: () => loader.current?.() };
}
// the pill over this week's streams; a row with no % (too few streams) shows its streams alone, in grey
// (an artist's monthly listeners: "71,342 listeners", the % against a week ago)
// (a Luminate week isn't this week: "43,701 streams", its dates in the card's subtitle or the row's own line)
const weekWords = (r) => (r.unit === "listeners" ? `${fmt(r.thisWeek)} listeners` : r.src ? `${fmt(r.thisWeek)} streams` : `${fmt(r.thisWeek)} this week`);
function GainNum({ r }) {
  return r.ranked && r.wowPct != null
    ? <span className="gainer-num" data-wow={r.wowPct >= 0 ? "up" : "down"}><WowPill pct={r.wowPct} /><em>{weekWords(r)}</em></span>
    : <span className="gainer-num" data-wow="none"><em>{weekWords(r)}</em></span>;
}
export function TopGainers({ db, onGo, arTop, arLoaded }) {
  const [kind, setKind] = useState("songs");
  const { top, failed, retry } = useRosterTop();
  const body = useRef(null);
  const hidden = useScrollMore(body);
  const placement = (id) => db.placements.find((p) => p.id === id);
  const client = (id) => db.clients.find((c) => c.id === id);
  // A&R: A&R › Summary's top people (from the summary StaffDashboard already fetches)
  const isAR = kind === "ar";
  const rows = isAR ? arTop?.people || null : !top ? null : kind === "artists" ? top.artists.filter((a) => client(a.clientId)) : top.songs.filter((s) => placement(s.placementId));
  // each tab says its own days (a portfolio exported later can move the songs' week)
  const span = isAR ? arTop?.period : top && (kind === "artists" ? top.artistsWeekOf : top.songsWeekOf);
  // r10 (H9): fewer than 8 days of Spotify numbers, so the songs and artists are Luminate's newest real week
  const lum = !isAR && top?.source === "luminate" ? (kind === "artists" ? top.artistsLabel : top.songsLabel) : null;
  const empty = isAR ? (!arTop ? (arLoaded ? "Couldn't load the A&R numbers." : "Loading…") : !rows.length && "No A&R numbers this week yet.")
    : !top ? (failed ? "Couldn't load this week's numbers." : "Loading…")
    : !rows.length && "Shows up once there's a week of daily Spotify numbers.";
  const firstOff = rows ? rows.findIndex((r) => !(r.ranked && r.wowPct != null)) : -1;
  // the rows without a % sit under one caption, after the ranked ones
  const split = (i) => i === firstOff && <div key="split" className="gainer-split">{isAR ? "Not enough history for a % yet" : "Not enough streams for a % yet"}</div>;
  // only a rise gets a rank number; a fall (ranked after every rise) shows its pill, unnumbered and muted
  const rose = (r) => r.ranked && r.wowPct != null && r.wowPct > 0;
  const rank = (r, i) => <span className="gainer-n">{rose(r) ? i + 1 : "·"}</span>;
  const fall = (r) => (r.ranked && r.wowPct != null && !rose(r) ? "" : undefined);
  return (
    <div className="gainers home-card">
      <div className="attn-head">
        <TrendingUp size={15} /> This week
        <span className="gainer-tabs" role="tablist" aria-label="This week">
          {GAINER_TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={kind === id} className={kind === id ? "active" : ""} onClick={() => setKind(id)}>{label}</button>
          ))}
        </span>
      </div>
      <div className="home-scroll" ref={body}>
        {lum ? <p className="gainer-sub" data-lum-week>{lum} · all platforms</p>
          : span && <p className="gainer-sub">{dayRange(span.from, span.to)} · vs the week before · {isAR ? "Spotify monthly listeners" : "Spotify streams, global"}</p>}
        {empty ? (
          <p className="gainers-empty">{empty}{!isAR && !top && failed && <> <button className="btn ghost sm" onClick={retry}>Try again</button></>}</p>
        ) : isAR ? rows.map((r, i) => [split(i), (
          // opens that person on A&R's Watchlist, as Summary's rows do
          <button key={r.key} className="gainer" data-ranked={r.ranked && r.wowPct != null ? "" : undefined} data-fall={fall(r)} onClick={() => onGo("ar", `watch:${r.open ? "open" : "flash"}:${r.key}`)}>
            {rank(r, i)}
            <span className="lm-cover gainer-av">{(r.name || "?")[0].toUpperCase()}</span>
            <span className="lm-song-main"><strong>{r.name}</strong><span className="ar-g-sub">{r.role === "producer" ? "Producer" : "Artist"}{r.stage && <StagePill id={r.stage} />}</span></span>
            <GainNum r={r} />
          </button>
        )]) : kind === "artists" ? rows.map((a, i) => {
          const c = client(a.clientId);
          return [split(i), (
            <button key={c.id} className="gainer" data-ranked={a.ranked && a.wowPct != null ? "" : undefined} data-fall={fall(a)} onClick={() => onGo("catalog", `client:${c.id}`)}>
              {rank(a, i)}
              <span className="lm-cover gainer-av">{c.photo ? <Photo src={c.photo} alt="" fill sizes="40px" /> : (c.name || "?")[0].toUpperCase()}</span>
              <span className="lm-song-main"><strong>{c.name}</strong><span>{[a.topSong && `${a.topSong}${a.songCount > 1 ? ` + ${a.songCount - 1} more` : ""}`, a.weekText].filter(Boolean).join(" · ")}</span></span>
              <GainNum r={a} />
            </button>
          )];
        }) : rows.map((s, i) => {
          const p = placement(s.placementId);
          return [split(i), (
            <button key={s.key} className="gainer" data-ranked={s.ranked && s.wowPct != null ? "" : undefined} data-fall={fall(s)} onClick={() => onGo("catalog", `client:${s.clientIds[0]}`)}>
              {rank(s, i)}
              <span className="lm-cover">{p.cover ? <Photo src={p.cover} alt="" fill sizes="40px" /> : <Disc3 size={16} />}</span>
              <span className="lm-song-main"><strong>{p.song}</strong><span>{[p.artist, s.clientIds.map((id) => client(id)?.name || "").filter(Boolean).join(", "), s.weekText].filter(Boolean).join(" · ")}</span></span>
              <GainNum r={s} />
            </button>
          )];
        })}
      </div>
      <ScrollFoot n={hidden} box={body} />
    </div>
  );
}
