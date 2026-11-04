import { useState, useEffect, useRef } from "react";
import NextImage from "next/image";
import { X } from "lucide-react";
import { OPTIMIZABLE, Photo, Socials, TLink, instagramLink, prefersReducedMotion, tiktokLink } from "../shared/ui";
import { ReleaseCard } from "./About";
import { CARD_SIZES, Glyphs, cleanTitle, glyphNodes, initialOf, slugOf, webLink } from "./data";
import { useFitLine } from "./motion";

/* ------------------------------------------------------------------ */
/*  ARTIST PANEL                                                        */
/* ------------------------------------------------------------------ */
// The name lands as flickering letters that settle left→right into the real
// name. A hidden copy of the real name holds the width so nothing reflows.
function DecodeName({ name: rawName, id }) {
  const name = String(rawName ?? "");
  const boxRef = useRef(null);
  const liveRef = useRef(null);
  useFitLine(boxRef, name, { min: 20, max: 120 });
  useEffect(() => {
    const el = liveRef.current;
    if (!el) return;
    if (prefersReducedMotion()) { el.replaceChildren(...glyphNodes(name)); return; }
    const A = "ABCDEFGHJKMNPRSTUVWXYZ0123456789";
    const chars = [...name];
    const start = performance.now() + 260, dur = 620;
    let raf = 0;
    const tick = (now) => {
      const p = Math.min(1, Math.max(0, (now - start) / dur));
      const settled = Math.floor(p * chars.length);
      el.textContent = chars.map((c, i) => (i < settled || !/[a-z0-9]/i.test(c) ? c : A[(Math.random() * A.length) | 0])).join("");
      if (p < 1) raf = requestAnimationFrame(tick);
      else el.replaceChildren(...glyphNodes(name));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [name]);
  return (
    <h2 className="ap-name" id={id} ref={boxRef} aria-label={name}>
      <span className="ap-name-lock" aria-hidden="true">
        <span className="ap-name-ghost">{name}</span>
        <span className="ap-name-live" ref={liveRef}>{name}</span>
      </span>
    </h2>
  );
}

export function ArtistPanel({ artist, publicData, list, onClose, onStep, focusOn, onFocused, morph }) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const prevRef = useRef(null);
  const nextRef = useRef(null);
  // curated notable releases first, in the dashboard's order (so Stack!e leads with Drake's Q&A)
  const rank = new Map((publicData.notableReleases || []).map((r, n) => [cleanTitle(r.song).toLowerCase(), n]));
  const rk = (p) => rank.get(cleanTitle(p.song).toLowerCase()) ?? Infinity;
  const releases = (publicData.notablePlacements || []).filter((p) => p.clientId === artist.id).sort((a, b) => rk(a) - rk(b));
  const i = list.findIndex((c) => c.id === artist.id);
  const prev = list.length > 1 ? list[(i - 1 + list.length) % list.length] : null;
  const next = list.length > 1 ? list[(i + 1) % list.length] : null;
  // a neighbour saved without a name still gets a label, not a bare "Next: "
  const prevName = String(prev?.name ?? "").trim(), nextName = String(next?.name ?? "").trim();
  const slug = slugOf(artist);
  const hasLinks = [artist.spotify, artist.apple, artist.youtube, artist.soundcloud].some(webLink) || instagramLink(artist.instagram) || tiktokLink(artist.tiktok);
  const [railAt, setRailAt] = useState(1);
  const railRef = useRef(null);
  // the grid-sized copy is free once the card has loaded it: it fills the frame for the card→panel
  // morph and for prev/next slides. A deep link skips it rather than download the photo twice.
  const [lo] = useState(() => {
    if (morph) return true;
    const im = document.querySelector(`.pc[data-slug="${slug}"] .pc-frame img`);
    return !!(im && im.complete && im.naturalWidth > 0);
  });

  useEffect(() => {
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    html.style.overflow = "hidden";
    // a real modal: the nav and footer (hidden under the panel) leave the tab order too
    const outside = [...document.querySelectorAll(".nav2, .foot2")].filter((el) => !el.hasAttribute("inert"));
    outside.forEach((el) => el.setAttribute("inert", ""));
    // stepping keeps focus on the button that was pressed, so Enter-Enter steps twice instead of closing
    (focusOn === "next" ? nextRef : focusOn === "prev" ? prevRef : closeRef).current?.focus({ preventScroll: true });
    onFocused?.();
    return () => {
      outside.forEach((el) => el.removeAttribute("inert"));
      html.style.overflow = prevOverflow;
      // back on the grid, focus the card of the artist that was on screen (while stepping the grid is still inert, so this no-ops)
      requestAnimationFrame(() => document.querySelector(`.pc[data-slug="${slug}"]`)?.focus({ preventScroll: true }));
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => {
      // Cmd/Alt+← is the browser's Back — leave modified keys alone
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && next) onStep(1);
      else if (e.key === "ArrowLeft" && prev) onStep(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onStep, next, prev]);

  // horizontal swipe = prev/next, but only a clearly sideways one — vertical
  // scrolling inside the panel is never hijacked
  const touch = useRef(null);
  const onTouchStart = (e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY, inRail: !!e.target.closest(".ap-rail") }; };
  const onTouchEnd = (e) => {
    const s = touch.current; touch.current = null;
    if (!s || s.inRail) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) onStep(dx < 0 ? 1 : -1);
  };

  // "2 / 3" counter for the phone credits rail: the card nearest the rail's centre (snap points
  // aren't evenly spaced when two cards fit), the first/last at the ends, and no counter at all
  // when every card is already in view (0 = hidden)
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const n = releases.length;
    const on = () => {
      const max = rail.scrollWidth - rail.clientWidth;
      if (max <= 1) return setRailAt(0);
      if (rail.scrollLeft <= 1) return setRailAt(1);
      if (rail.scrollLeft >= max - 1) return setRailAt(n);
      const rr = rail.getBoundingClientRect(), cx = rr.left + rr.width / 2;
      let best = 0, bd = Infinity;
      [...rail.children].forEach((it, k) => { const b = it.getBoundingClientRect(); const d = Math.abs(b.left + b.width / 2 - cx); if (d < bd) { bd = d; best = k; } });
      setRailAt(best + 1);
    };
    on();
    rail.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => { rail.removeEventListener("scroll", on); window.removeEventListener("resize", on); };
  }, [releases.length]);

  return (
    <div className="ap" role="dialog" aria-modal="true" aria-labelledby={`ap-name-${slug}`} ref={panelRef}
      onClick={(e) => e.target === e.currentTarget && onClose()} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <button className="ap-close" onClick={onClose} aria-label="Close" ref={closeRef}><X size={20} /></button>

      <div className="ap-inner">
        <div className="ap-photo" style={{ viewTransitionName: "artist-photo" }}>
          {artist.photo ? (
            <>
              {/* same sizes as the grid card = instant cache hit for the morph */}
              {lo && OPTIMIZABLE.test(artist.photo) && <NextImage src={artist.photo} alt="" fill sizes={CARD_SIZES} style={{ objectFit: "cover" }} className="ap-photo-lo" />}
              <Photo src={artist.photo} alt={artist.name} fill sizes="(max-width: 899px) 92vw, 620px" priority />
            </>
          ) : <div className="ap-photo-empty">{initialOf(artist.name)}</div>}
        </div>

        <div className="ap-info">
          <DecodeName name={artist.name} id={`ap-name-${slug}`} />
          {artist.role && <div className="ap-stag" style={{ "--i": 0 }}><span className="chip-tag chip-tag-lg">{artist.role}</span></div>}

          {releases.length > 0 && (
            <section className="ap-stag ap-rel" style={{ "--i": 1 }}>
              <div className="ap-rel-head">
                <h3 className="micro-label">Notable releases</h3>
                {releases.length > 1 && railAt > 0 && <span className="ap-count" aria-hidden="true">{railAt} / {releases.length}</span>}
              </div>
              <div className="ap-rail" ref={railRef}>
                {releases.map((r) => (
                  <div className="ap-rail-item" key={r.id}>
                    <ReleaseCard r={r} clients={[]} compact />
                  </div>
                ))}
              </div>
            </section>
          )}

          {hasLinks && <div className="ap-stag" style={{ "--i": 2 }}><Socials c={artist} size={24} /></div>}
          {artist.bio && <p className="ap-stag ap-bio" style={{ "--i": 3 }}>{artist.bio}</p>}

          <div className="ap-stag" style={{ "--i": 4 }}>
            <TLink href={`/contact?artist=${slug}`} className="pill pill-solid" aria-label={`Work with ${artist.name}`}><span>Work with <Glyphs text={artist.name} /></span></TLink>
          </div>
        </div>
      </div>

      {(prev || next) && (
        <div className="ap-bar">
          <button ref={prevRef} onClick={() => onStep(-1)} aria-label={prevName ? `Previous: ${prevName}` : "Previous artist"}><span aria-hidden="true">←</span> <span className="ap-bar-name"><Glyphs text={prevName || "Previous"} /></span></button>
          <span className="ap-bar-pos" aria-hidden="true">{i + 1} / {list.length}</span>
          <button ref={nextRef} onClick={() => onStep(1)} aria-label={nextName ? `Next: ${nextName}` : "Next artist"}><span className="ap-bar-name"><Glyphs text={nextName || "Next"} /></span> <span aria-hidden="true">→</span></button>
        </div>
      )}
    </div>
  );
}
