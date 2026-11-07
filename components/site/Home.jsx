import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { ROUTE_TO_PATH } from "../shared/routes";
import { TLink, prefersReducedMotion } from "../shared/ui";
import { STATS, Stat } from "./data";
import { Marquee } from "./motion";

/* ------------------------------------------------------------------ */
/*  HOME — chrome ignition                                              */
/* ------------------------------------------------------------------ */
export function Home() {
  const heroRef = useRef(null);
  const wmRef = useRef(null);
  // the full light-scan intro plays once per visit; coming back to Home in
  // the same session shows the wordmark straight away (just the shine)
  // (read before the first paint, but after the first render: the server's HTML, which can't know, and
  // the browser's first render agree)
  const [seen, setSeen] = useState(false);
  useLayoutEffect(() => { try { if (sessionStorage.getItem("dm-ignited") === "1") setSeen(true); } catch { /* private mode */ } }, []);
  // mounted inside a view transition's update (data-vt is set for its whole lifetime; never while the
  // server's HTML is first drawn)
  const [viaVT] = useState(() => typeof document !== "undefined" && !!document.documentElement.dataset.vt);
  useEffect(() => { try { sessionStorage.setItem("dm-ignited", "1"); } catch { /* private mode */ } }, []);

  // desktop only: a soft spotlight follows the cursor inside the letterforms and the mark leans toward
  // it, just barely: at most 1.5° across and 1° up and down, reached only at the edges of the hero, so
  // it reads as the light catching it rather than the logo moving. Lerped in rAF, sleeps when settled.
  useEffect(() => {
    const hero = heroRef.current, wm = wmRef.current;
    if (!hero || !wm || prefersReducedMotion() || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const cur = { x: 0.5, y: 0.5, lx: 0, ly: 0, on: 0 }, tgt = { x: 0.5, y: 0.5, lx: 0, ly: 0, on: 0 };
    let raf = 0;
    const tick = () => {
      for (const k of ["x", "y", "on"]) cur[k] += (tgt[k] - cur[k]) * 0.12;
      for (const k of ["lx", "ly"]) cur[k] += (tgt[k] - cur[k]) * 0.06;
      const r = wm.getBoundingClientRect();
      wm.style.setProperty("--mx", `${(cur.x * r.width).toFixed(1)}px`);
      wm.style.setProperty("--my", `${(cur.y * r.height).toFixed(1)}px`);
      wm.style.setProperty("--spot", cur.on.toFixed(3));
      wm.style.setProperty("--ry", `${(cur.lx * 1.5).toFixed(3)}deg`);
      wm.style.setProperty("--rx", `${(-cur.ly * 1).toFixed(3)}deg`);
      const settled = ["x", "y", "lx", "ly", "on"].every((k) => Math.abs(tgt[k] - cur[k]) < 0.001);
      raf = settled ? 0 : requestAnimationFrame(tick);
    };
    const wake = () => { if (!raf) raf = requestAnimationFrame(tick); };
    const move = (e) => {
      const r = wm.getBoundingClientRect(), h = hero.getBoundingClientRect();
      tgt.x = Math.min(1.15, Math.max(-0.15, (e.clientX - r.left) / r.width));
      tgt.y = Math.min(1.4, Math.max(-0.4, (e.clientY - r.top) / r.height));
      // the lean: where the cursor is in the whole hero, -1 to 1 from its centre
      tgt.lx = Math.min(1, Math.max(-1, (e.clientX - (r.left + r.width / 2)) / (h.width / 2)));
      tgt.ly = Math.min(1, Math.max(-1, (e.clientY - (r.top + r.height / 2)) / (h.height / 2)));
      tgt.on = 1;
      wake();
    };
    const leave = () => { Object.assign(tgt, { x: 0.5, y: 0.5, lx: 0, ly: 0, on: 0 }); wake(); };
    hero.addEventListener("pointermove", move);
    hero.addEventListener("pointerleave", leave);
    return () => { hero.removeEventListener("pointermove", move); hero.removeEventListener("pointerleave", leave); cancelAnimationFrame(raf); };
  }, []);

  // hovering the mark sends one light sweep across it, and only one: the idle cycle (the sweep and the
  // spark's twinkle, in step on the same 8s loop) jumps to a fresh pass — unless a pass hasn't reached
  // the middle yet, which then is the one — and holds once that pass is over while the pointer stays.
  // Leaving picks the cycle back up from there, so the next idle pass is a full cycle away.
  const holdT = useRef(0);
  useEffect(() => () => clearTimeout(holdT.current), []);
  const cycle = (el) => el.getAnimations?.({ subtree: true }).filter((a) => a.animationName === "wm-sweep" || a.animationName === "spark-tw") || [];
  const resweep = (e) => {
    const anims = cycle(e.currentTarget);
    const sweep = anims.find((a) => a.animationName === "wm-sweep");
    if (!sweep || sweep.currentTime == null) return;
    const PASS = 1350, HALF = 640; // the part of each cycle where the light is moving · its centre crossing the middle
    const t = sweep.currentTime - (sweep.effect.getTiming().delay || 0);
    let left; // until the pass that counts as this hover's is over
    if (t < 0) left = PASS - t; // the first pass hasn't started yet: it's the one
    else if (t % 8000 < HALF) left = PASS - (t % 8000);
    else { const jump = 8000 - (t % 8000); anims.forEach((a) => { a.currentTime += jump; }); left = PASS; }
    anims.forEach((a) => a.play());
    clearTimeout(holdT.current);
    holdT.current = setTimeout(() => anims.forEach((a) => a.pause()), left);
  };
  const release = (e) => { clearTimeout(holdT.current); cycle(e.currentTarget).forEach((a) => a.play()); };

  return (
    <main className="home2">
      {/* arriving through the logo morph, the morph is the entrance: no light-scan wipe to hide
          the wordmark it lands on, and the rest of the hero follows on the short timings */}
      <section className={`ign${seen || viaVT ? " ign-seen" : ""}${viaVT ? " ign-vt" : ""}`} ref={heroRef}>
        {/* r11 launch: runs while the server's HTML is parsed, so a same-session reload never starts the full wipe */}
        <script dangerouslySetInnerHTML={{ __html: 'try{if(sessionStorage.getItem("dm-ignited")==="1")document.currentScript.parentNode.classList.add("ign-seen")}catch(e){}' }} />
        <TLink
          href={ROUTE_TO_PATH.about}
          vt="page-brand"
          className="wm"
          ref={wmRef}
          onPointerEnter={resweep}
          onPointerLeave={release}
          aria-label="Defied Management — about us"
          style={{ viewTransitionName: "brand" }}
        >
          <img className="wm-img" src="/brand/wordmark.webp" width="1100" height="365" alt="" draggable={false} fetchpriority="high" />
          <span className="wm-shine" aria-hidden="true" />
          <span className="wm-spot" aria-hidden="true" />
          <span className="wm-spark" aria-hidden="true" />
        </TLink>
        <h1 className="sr-only">Defied Management — music management and publishing administration</h1>
        <div className="ign-cta">
          <TLink href={ROUTE_TO_PATH.roster} className="pill pill-solid">See the roster</TLink>
          <TLink href={ROUTE_TO_PATH.contact} className="pill pill-ghost">Work with us</TLink>
        </div>
        <Marquee className="ign-ribbon" label="Defied in numbers" seconds={STATS.length * 5} items={STATS} render={(s) => <Stat s={s} />} />
      </section>
    </main>
  );
}
