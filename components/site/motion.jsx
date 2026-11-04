import React, { useEffect, useLayoutEffect, useRef } from "react";
import { Glyphs } from "./data";

/* ------------------------------------------------------------------ */
/*  PUBLIC — motion atoms                                               */
/* ------------------------------------------------------------------ */
// Headline whose words rise out of clipped slots. Plays on mount by default;
// `onView` waits for the shared reveal observer instead (below-the-fold heads).
// Screen readers get the whole sentence from aria-label, not word fragments.
// `breakAfter`: the word that ends the first line on tablets and up, so the line falls on a phrase, not
// wherever the width runs out (phones wrap on their own)
export function SplitHead({ text, tag: Tag = "h1", className = "", chrome = false, onView = false, strike, breakAfter, delay = 80 }) {
  const words = String(text).split(/\s+/).filter(Boolean);
  return (
    <Tag
      className={`split${chrome ? " split-chrome" : ""}${className ? " " + className : ""}`}
      aria-label={text}
      style={{ "--d": `${delay}ms` }}
      {...(onView ? { "data-reveal": "split" } : {})}
    >
      {words.map((w, i) => (
        <React.Fragment key={i}>
          <span className={`w${strike && w.replace(/[^\w]/g, "") === strike ? " w-strike" : ""}`} aria-hidden="true">
            <span style={{ "--i": i }}>{w}</span>
            {strike && w.replace(/[^\w]/g, "") === strike && (
              <svg className="strike" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
                <path d="M2 12 C20 8,40 14,60 10 S90 9,98 11" />
              </svg>
            )}
          </span>
          {i < words.length - 1 && (breakAfter && w === breakAfter ? <br className="split-br" /> : " ")}
        </React.Fragment>
      ))}
    </Tag>
  );
}

// Seamless horizontal loop: the visible rail is aria-hidden — its linked credits are mouse/touch
// only (tabIndex -1) — and a visually-hidden list carries the same items for screen readers.
// Glides to a stop under a mouse, pauses on press; static wrapped block on reduced motion.
// Credits are spaced by the D. `seconds` is the time one pass of `items` takes, however many repeats get added.
export function Marquee({ items, label, className = "", seconds = 48, render }) {
  const railRef = useRef(null);
  const glideRaf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(glideRaf.current), []);
  if (!items.length) return null;
  // short lists get repeated so one copy is always wider than the screen
  const reps = Math.max(1, Math.ceil(12 / items.length));
  const row = Array.from({ length: reps }, () => items).flat();
  const track = (copy) => (
    <div className="mq-track" key={copy}>
      {row.map((it, i) => (
        <span className={`mq-item${i >= items.length ? " mq-rep" : ""}`} key={`${copy}-${i}`}>
          {/* the moving copies are mouse/touch only (the rail is aria-hidden): never in the tab order.
              The link is the credit alone, so the gap before the next cover never opens this song */}
          {it.href
            ? <a className="mq-link" href={it.href} target="_blank" rel="noreferrer" tabIndex={-1} draggable={false}>{render(it)}</a>
            : render(it)}
          <span className="mq-sep"><img src="/brand/d.png" alt="" width="45" height="36" decoding="async" draggable={false} /></span>
        </span>
      ))}
    </div>
  );
  // a cover rests small and lifts on hover. The first hover asks for its lifted size (data-lift), so the
  // browser fetches the bigger file and swaps it in once it has loaded, keeping the small one up until then
  const liftCover = (e) => {
    const img = e.target.closest?.(".mq-link")?.querySelector("img[data-lift]");
    if (img && img.sizes !== img.dataset.lift) img.sizes = img.dataset.lift;
  };
  // under a mouse the rail eases down to a stop, and back up to speed when the mouse leaves, instead of
  // freezing mid-move (a press still stops it at once, in CSS, for touch screens)
  const glide = (e, to) => {
    if (e.pointerType === "touch") return;
    const anim = railRef.current?.getAnimations?.()[0];
    if (!anim) return;
    cancelAnimationFrame(glideRaf.current);
    const from = anim.playbackRate, t0 = performance.now(), ms = to ? 650 : 420;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      anim.playbackRate = from + (to - from) * (1 - (1 - k) ** 3);
      if (k < 1) glideRaf.current = requestAnimationFrame(step);
    };
    glideRaf.current = requestAnimationFrame(step);
  };
  return (
    <div className={`mq ${className}`} style={{ "--mq-dur": `${seconds * reps}s` }} onPointerOver={liftCover} onPointerEnter={(e) => glide(e, 0)} onPointerLeave={(e) => glide(e, 1)}>
      <ul className="sr-only" aria-label={label}>{items.map((it, i) => <li key={i}>{it.text}</li>)}</ul>
      {/* three copies: the home ribbon starts a third of the way in, so a copy is always behind the parked lead credit */}
      <div className="mq-rail" ref={railRef} aria-hidden="true">{track("a")}{track("b")}{track("c")}</div>
    </div>
  );
}

// Touch screens have no hover, so whichever card is crossing the middle band
// of the screen "lights up" instead — colour travels down the grid under the
// thumb as you scroll. Desktop never runs this (hover does the job there).
export function useLitBand(ref, deps) {
  useEffect(() => {
    const root = ref.current;
    if (!root || !window.matchMedia("(hover: none)").matches) return;
    // a thin band (8% of the screen): wider than the gap between rows, so one
    // row is always lit, but narrow enough that two rarely are
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) e.target.classList.toggle("is-lit", e.isIntersecting);
    }, { rootMargin: "-46% 0px -46% 0px", threshold: 0 });
    root.querySelectorAll(".pc").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

// Shrinks one line of display type to fit its box (names). Re-fits when the box resizes.
export function useFitLine(ref, text, { min = 10, max = 400 } = {}) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = "";
      delete el.dataset.wrap;
      const base = parseFloat(getComputedStyle(el).fontSize);
      const avail = el.clientWidth;
      const natural = el.scrollWidth;
      if (!avail || !natural || !base) return;
      if (natural > avail) {
        const one = base * (avail / natural) * 0.985;
        if (one >= min) {
          el.style.fontSize = `${Math.min(max, one).toFixed(1)}px`;
        } else {
          // too long for one line even at the smallest size: wrap (about two lines) rather than cut it off
          el.dataset.wrap = "";
          el.style.fontSize = `${Math.max(min, Math.min(max, base, base * (2 * avail / natural) * 0.9)).toFixed(1)}px`;
        }
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el.parentElement || el);
    document.fonts?.ready?.then(fit).catch(() => {});
    return () => ro.disconnect();
  }, [text, min, max]); // eslint-disable-line react-hooks/exhaustive-deps
}
export function FitLine({ text, tag: Tag = "span", className, ...opts }) {
  const ref = useRef(null);
  useFitLine(ref, text, opts);
  return <Tag ref={ref} className={className}><Glyphs text={text} /></Tag>;
}
