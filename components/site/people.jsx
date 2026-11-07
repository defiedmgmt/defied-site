import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/router";
import { Instagram, Mail } from "lucide-react";
import { ExtLink, Photo, instagramLink, jumpIntoView, withViewTransition } from "../shared/ui";
import { PageLoading } from "./About";
import { ArtistPanel } from "./ArtistPanel";
import { CARD_SIZES, bySlug, copyText, initialOf, isArtist, isProducer, slugOf, toast } from "./data";
import { FitLine, SplitHead, useLitBand } from "./motion";

/* ------------------------------------------------------------------ */
/*  TEAM + ROSTER cards                                                 */
/* ------------------------------------------------------------------ */
// One card for roster and team alike: a full-colour photo that zooms with a chrome edge + light
// sweep on hover/focus (or as it crosses the middle of a phone screen), with the name + role always
// visible underneath.
function PersonCard({ person, onOpen, sizes = CARD_SIZES, eager = false, children }) {
  const slug = slugOf(person);
  const Tag = onOpen ? "button" : "div";
  return (
    <Tag
      className="pc"
      data-slug={slug}
      data-reveal=""
      {...(onOpen ? { type: "button", onClick: (e) => onOpen(person, e.currentTarget.querySelector(".pc-frame")) } : {})}
    >
      <div className="pc-frame">
        {person.photo
          ? <Photo src={person.photo} alt="" fill sizes={sizes} priority={eager} />
          : <div className="pc-empty">{initialOf(person.name)}</div>}
      </div>
      <div className="pc-cap">
        <FitLine tag="strong" text={person.name} className="pc-name" />
        <span className="pc-role">{person.role}</span>
        {/* the credit is the proof — it wraps rather than ever being cut off */}
      </div>
      {children}
    </Tag>
  );
}

function TeamEmail({ email }) {
  const act = async (e) => {
    e.preventDefault();
    await copyText(email);
    toast(`Copied · ${email}`);
    try {
      const a = document.createElement("a");
      a.href = "mailto:" + email; a.target = "_blank"; a.rel = "noopener noreferrer";
      document.body.appendChild(a); a.click(); a.remove();
    } catch { /* ignore */ }
  };
  return <button className="hit" onClick={act} aria-label={`Email ${email} (copies the address)`} title={email}><Mail size={18} /></button>;
}

export function TeamPage({ publicData }) {
  const gridRef = useRef(null);
  useLitBand(gridRef, [publicData]);
  if (!publicData) return <main className="pg pg-wide"><PageLoading /></main>;
  const staff = publicData.staff || [];
  // "Co-Founder", "CEO & Co-Founder", "Founder/CEO" — not "Assistant to the Co-Founders"
  const isFounder = (s) => /\b(co-?)?founder\b/i.test(s.role || "");
  const founders = staff.filter(isFounder);
  const rest = staff.filter((s) => !isFounder(s));
  // label the second group by its shared role ("Talent Managers") when there is one
  const restRoles = [...new Set(rest.map((s) => (s.role || "").trim()).filter(Boolean))];
  const restLabel = restRoles.length === 1 ? (/s$/i.test(restRoles[0]) ? restRoles[0] : `${restRoles[0]}s`) : "Team";
  const groups = founders.length && rest.length
    ? [["Co-Founders", founders], [restLabel, rest]]
    : [["", staff]];
  const card = (s) => (
    <PersonCard key={s.id} person={s} eager={staff.indexOf(s) < 3} sizes="(max-width: 599px) and (min-resolution: 2.5dppx) 29vw, (max-width: 599px) 46vw, (max-width: 899px) 31vw, 340px">
      {s.bio && <p className="pc-bio">{s.bio}</p>}
      <div className="pc-links">
        {s.email && <TeamEmail email={s.email} />}
        {instagramLink(s.instagram) && (
          <ExtLink className="hit" href={instagramLink(s.instagram)} label={`${s.name} on Instagram`}>
            <Instagram size={18} />
          </ExtLink>
        )}
      </div>
    </PersonCard>
  );
  return (
    <main className="pg pg-wide">
      <SplitHead text="OUR TEAM" chrome className="pg-head" />
      <div ref={gridRef} className="team2-wrap">
        {groups.map(([label, people]) => (
          <section className="team2-group" key={label || "all"}>
            {label && <h2 className="micro-label" data-reveal="">{label}</h2>}
            <div className="pgrid pgrid-team">{people.map(card)}</div>
          </section>
        ))}
      </div>
    </main>
  );
}

// segmented control with a white pill that slides (in 2D, when the chips
// wrap) to whichever option is picked. Native radios underneath, so arrow
// keys, focus and form semantics come for free.
export function ChipGroup({ name, label, options, value, onChange, className = "" }) {
  const wrapRef = useRef(null);
  const [pill, setPill] = useState(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const el = wrap.querySelector(`.chip[data-v="${value}"]`);
      if (el) setPill({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    wrap.querySelectorAll(".chip").forEach((el) => ro.observe(el));
    document.fonts?.ready?.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, [value, options.length]);
  useEffect(() => { if (pill && !ready) requestAnimationFrame(() => setReady(true)); }, [pill, ready]);
  return (
    <div className={`chips${ready ? " ready" : ""} ${className}`} role="radiogroup" aria-label={label} ref={wrapRef}>
      {pill && <span className="chip-pill" aria-hidden="true" style={{ transform: `translate(${pill.x}px, ${pill.y}px)`, width: pill.w, height: pill.h }} />}
      {options.map((o) => (
        <label key={o.value} className={`chip${value === o.value ? " on" : ""}`} data-v={o.value}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span>{o.label}{o.count != null && <em>{o.count}</em>}</span>
        </label>
      ))}
    </div>
  );
}

// history.back() has no promise — resolve once the router has actually
// committed the previous entry, so it can sit inside a View Transition.
function backAndWait(router) {
  return new Promise((resolve) => {
    const done = () => { router.events.off("routeChangeComplete", done); clearTimeout(t); resolve(); };
    const t = setTimeout(done, 900);
    router.events.on("routeChangeComplete", done);
    router.back();
  });
}

// Next's per-entry history key of every ?artist= entry this tab pushed — it survives prev/next
// (router.replace) and Forward, so a panel reopened with Forward still closes by going back.
// (Scroll on Back is Next's experimental.scrollRestoration — the browser never restores it, so
// nothing drags the grid off the card close() parks it on.)
const panelEntries = new Set();

export function Roster({ publicData }) {
  const router = useRouter();
  const gridRef = useRef(null);
  const clients = publicData?.clients || [];
  const [filter, setFilter] = useState("all");
  const pushedRef = useRef(false); // did *we* push the ?artist= history entry (so close = back)?
  const stepFocus = useRef(null); // "next"/"prev" while stepping, so focus stays on that button
  const lastSlug = useRef(null);

  // the URL owns the filter: a nav click to plain /roster or Back/Forward between ?type= entries follows it
  useEffect(() => {
    if (!router.isReady) return;
    const t = router.query.type;
    setFilter(t === "producers" || t === "artists" ? t : "all");
  }, [router.isReady, router.query.type]);

  const visible = clients.filter((c) => filter === "all" || (filter === "producers" ? isProducer(c) : isArtist(c)));
  useLitBand(gridRef, [publicData, filter]);

  // r11 launch: only once mounted, as on live (the panel reads the document; drawn on the server it 500'd)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const urlSlug = mounted && router.isReady ? router.query.artist : undefined;
  const active = bySlug(clients, urlSlug);
  // the open card's own key, even when the link used an older one
  const activeSlug = active ? slugOf(active) : urlSlug;
  useEffect(() => {
    if (activeSlug) { lastSlug.current = activeSlug; return; }
    pushedRef.current = false;
    // however the panel closed (X, Esc, iPhone back-swipe), leave the grid on the card that was open
    if (lastSlug.current) jumpIntoView(document.querySelector(`.pc[data-slug="${lastSlug.current}"] .pc-frame`), { ifNeeded: true });
    lastSlug.current = null;
  }, [activeSlug]);

  const queryWith = (patch) => {
    const q = { ...router.query, ...patch };
    Object.keys(q).forEach((k) => (q[k] == null || q[k] === "") && delete q[k]);
    return q;
  };

  const open = (c, frame) => {
    pushedRef.current = true;
    stepFocus.current = null;
    // Next replays an entry's stored options on Back; a plain entry has no
    // scroll:false, so going back to the grid would scroll it to the top
    if (history.state?.__N) {
      try { history.replaceState({ ...history.state, options: { ...history.state.options, shallow: true, scroll: false } }, "", location.href); } catch { /* ignore */ }
    }
    if (frame) frame.style.viewTransitionName = "artist-photo";
    const t = withViewTransition("artist", async () => {
      if (frame) frame.style.viewTransitionName = "";
      await router.push({ pathname: "/roster", query: queryWith({ artist: slugOf(c) }) }, undefined, { shallow: true, scroll: false });
      if (history.state?.key) panelEntries.add(history.state.key);
    });
    t?.finished.finally(() => { if (frame) frame.style.viewTransitionName = ""; });
  };

  const close = () => {
    // read now: the transition's update callback runs a frame later
    const viaBack = pushedRef.current || (!!history.state?.key && panelEntries.has(history.state.key));
    pushedRef.current = false;
    stepFocus.current = null;
    const park = () => {
      const f = document.querySelector(`.pc[data-slug="${activeSlug}"] .pc-frame`);
      jumpIntoView(f, { ifNeeded: true });
      return f;
    };
    // park the card on screen under the panel so the photo has somewhere visible to fly back into
    const frame = park();
    const navBack = () => viaBack
      ? backAndWait(router)
      : router.replace({ pathname: "/roster", query: queryWith({ artist: null }) }, undefined, { shallow: true, scroll: false });
    const t = withViewTransition("artist-close", async () => {
      if (frame) frame.style.viewTransitionName = "artist-photo";
      await navBack();
      park(); // going back restores the scroll from when the panel opened — after prev/next that's another card's
    });
    if (t) t.finished.finally(() => { if (frame) frame.style.viewTransitionName = ""; });
    else if (frame) frame.style.viewTransitionName = "";
  };

  const step = (dir) => {
    const list = visible.some((c) => slugOf(c) === activeSlug) ? visible : clients;
    const i = list.findIndex((c) => slugOf(c) === activeSlug);
    const next = list[(i + dir + list.length) % list.length];
    if (!next) return;
    stepFocus.current = dir > 0 ? "next" : "prev";
    document.documentElement.dataset.dir = dir > 0 ? "next" : "prev";
    withViewTransition("artist-step", () =>
      router.replace({ pathname: "/roster", query: queryWith({ artist: slugOf(next) }) }, undefined, { shallow: true, scroll: false })
    );
  };

  const changeFilter = (v) => {
    if (v === filter) return;
    const cards = () => [...(gridRef.current?.querySelectorAll(".pc") || [])];
    const name = () => cards().forEach((el) => { el.style.viewTransitionName = `pc-${el.dataset.slug}`; });
    name();
    const t = withViewTransition("filter", () => {
      flushSync(() => setFilter(v));
      // cards that come back are new nodes — reveal the on-screen ones now so they're in the morph, not after it
      cards().forEach((el) => { if (el.getBoundingClientRect().top < window.innerHeight) el.setAttribute("data-in", ""); });
      name();
      // only now, after the old snapshot: the URL → filter effect would otherwise re-render the grid before it's taken
      router.replace({ pathname: "/roster", query: queryWith({ type: v === "all" ? null : v }) }, undefined, { shallow: true, scroll: false });
    });
    const clear = () => cards().forEach((el) => { el.style.viewTransitionName = ""; });
    if (t) t.finished.finally(clear); else clear();
  };

  if (!publicData) return <main className="pg pg-wide"><PageLoading /></main>;
  const nProd = clients.filter(isProducer).length;
  const nArt = clients.filter(isArtist).length;
  const filterOptions = [
    { value: "all", label: "All", count: clients.length },
    ...(nProd ? [{ value: "producers", label: "Producers", count: nProd }] : []),
    ...(nArt ? [{ value: "artists", label: "Artists", count: nArt }] : []),
  ];
  return (
    <main className="pg pg-wide">
      <div className="ros2-head" {...(active ? { inert: "" } : {})}>
        <h1 className="pg-head split split-chrome" aria-label={`The roster, ${clients.length} people`}>
          <span className="w" aria-hidden="true"><span style={{ "--i": 0 }}>THE</span></span>{" "}
          <span className="w" aria-hidden="true"><span style={{ "--i": 1 }}>ROSTER</span></span>
        </h1>
        {filterOptions.length > 2 && (
          <ChipGroup name="roster-type" label="Filter roster" options={filterOptions} value={filter} onChange={changeFilter} className="ros2-filter" />
        )}
      </div>
      <div className="pgrid pgrid-roster" ref={gridRef} {...(active ? { inert: "" } : {})}>
        {/* under a deep-linked panel the grid's photos mustn't compete with the panel's own */}
        {visible.map((c, i) => <PersonCard key={c.id} person={c} onOpen={open} eager={!active && i < 4} />)}
      </div>
      {active && (
        <ArtistPanel
          key={slugOf(active)}
          artist={active}
          publicData={publicData}
          list={visible.some((c) => c.id === active.id) ? visible : clients}
          onClose={close}
          onStep={step}
          focusOn={stepFocus.current}
          onFocused={() => { stepFocus.current = null; }}
          morph={pushedRef.current && !stepFocus.current}
        />
      )}
    </main>
  );
}
