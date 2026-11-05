import React, { useState, useEffect } from "react";
import NextImage from "next/image";
import Link from "next/link";
import { useRouter } from "next/router";
import { ROUTE_TO_PATH } from "./routes";
import { webLink } from "../site/data";

// Fades a photo in once it's actually decoded, instead of popping in abruptly —
// the panel-colored background behind it (set per usage in CSS) shows as a
// placeholder until then. `fill` routes remote (http/https) sources through
// Next's image optimizer — some of the roster source photos are raw
// multi-megabyte originals; this serves a properly sized, compressed,
// modern-format copy instead. Needs a position:relative container.
// next/image only fetches the hosts in next.config.js images.remotePatterns (and this site's own
// files); a cover pasted from anywhere else would come back 400 from it, so it loads as-is instead
// (uploaded photos are Vercel Blob links, *.public.blob.vercel-storage.com, listed there too)
export const OPTIMIZABLE = /^(?:\/(?!\/)|https:\/\/(?:i\.scdn\.co|www\.defiedmgmt\.com|[a-z0-9-]+\.public\.blob\.vercel-storage\.com)\/)/i;
// r10 fix (cell data): a small avatar's photo through the same resizer the public roster uses (next/image's
// /_next/image, w from its imageSizes), not the 1-2.5 MB original; anything it can't resize stays as it is
export const thumb = (src, w = 96) => (src && OPTIMIZABLE.test(src) && !/^\/_next\//.test(src) ? `/_next/image?url=${encodeURIComponent(src)}&w=${w}&q=75` : src);
export function Photo({ src: rawSrc, alt, className = "", fill, sizes, ...rest }) {
  const [loaded, setLoaded] = useState(false);
  // the page's security policy only loads https images: an http:// one pasted in gets the secure copy
  const src = /^http:\/\//i.test(rawSrc || "") ? `https://${rawSrc.slice(7)}` : rawSrc;
  const cls = `ph-fade${loaded ? " ph-in" : ""}${className ? " " + className : ""}`;
  // route through next/image for genuinely-remote (http/https) sources AND
  // this deployment's own local /public files — both get real optimization.
  // A bare "/..." path that turns out to actually be this exact same site's
  // own domain written out as a full URL (https://www.defiedmgmt.com/...,
  // how every roster/team photo is stored) was silently capping at a fixed
  // 300x300 output no matter what width was requested — next/image's
  // remote-fetch path behaves differently from its local-file path here.
  // Only data: URIs (photos uploaded before they went to Blob) skip this entirely.
  if (fill && OPTIMIZABLE.test(src || "")) {
    return (
      <NextImage
        src={src}
        alt={alt}
        fill
        sizes={sizes || "(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 280px"}
        style={{ objectFit: "cover" }}
        onLoad={() => setLoaded(true)}
        className={cls}
        {...rest}
      />
    );
  }
  // a dashboard upload (data: URI) or a host the optimizer won't fetch: a plain <img>, sized like next/image's `fill` when asked to fill,
  // and loaded right away when next/image would have been told it's a priority
  const { priority, ...imgProps } = rest;
  return (
    <img
      src={src}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      onLoad={() => setLoaded(true)}
      className={`${cls}${fill ? " ph-fill" : ""}`}
      {...imgProps}
    />
  );
}

/* brand social icons (inline SVG so they always render) */
export const ICONS = {
  instagram: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2.5" y="2.5" width="19" height="19" rx="5.5" /><circle cx="12" cy="12" r="4.2" /><circle cx="17.6" cy="6.4" r="1.1" fill="currentColor" stroke="none" /></svg>,
  tiktok: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 5.82a4.3 4.3 0 0 1-1.06-2.82h-3.2v12.9a2.35 2.35 0 1 1-2.34-2.35c.24 0 .47.04.68.1v-3.3a5.66 5.66 0 0 0-.68-.04 5.62 5.62 0 1 0 5.62 5.62V9.4a7.06 7.06 0 0 0 4.06 1.28V7.4a4.28 4.28 0 0 1-3.08-1.58z" /></svg>,
  youtube: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.12C19.5 3.56 12 3.56 12 3.56s-7.5 0-9.4.52A3 3 0 0 0 .5 6.2 31.3 31.3 0 0 0 0 12a31.3 31.3 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.12c1.9.52 9.4.52 9.4.52s7.5 0 9.4-.52a3 3 0 0 0 2.1-2.12A31.3 31.3 0 0 0 24 12a31.3 31.3 0 0 0-.5-5.8zM9.6 15.6V8.4l6.25 3.6z" /></svg>,
  spotify: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.6 14.42a.62.62 0 0 1-.86.2c-2.35-1.44-5.3-1.76-8.8-.96a.62.62 0 1 1-.27-1.22c3.82-.87 7.1-.5 9.73 1.11.3.18.4.58.2.87zm1.23-2.74a.78.78 0 0 1-1.07.26c-2.7-1.66-6.8-2.14-9.98-1.17a.78.78 0 1 1-.45-1.5c3.63-1.1 8.15-.56 11.24 1.34.36.22.48.7.26 1.07zm.1-2.85C14.82 8.98 9.5 8.8 6.4 9.75a.94.94 0 1 1-.54-1.8c3.56-1.08 9.44-.88 13.16 1.33a.94.94 0 0 1-.96 1.62z" /></svg>,
  apple: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 12.04c-.03-2.6 2.12-3.85 2.22-3.9-1.21-1.78-3.1-2.02-3.78-2.05-1.6-.16-3.13.94-3.94.94-.81 0-2.07-.92-3.4-.9-1.75.03-3.36 1.02-4.26 2.58-1.82 3.16-.47 7.83 1.3 10.4.86 1.25 1.9 2.65 3.25 2.6 1.3-.05 1.79-.84 3.36-.84 1.56 0 2 .84 3.38.81 1.4-.02 2.28-1.27 3.14-2.53.99-1.45 1.4-2.86 1.42-2.93-.03-.02-2.72-1.05-2.75-4.13zM14.6 4.5c.72-.87 1.2-2.08 1.07-3.28-1.03.04-2.28.69-3.02 1.56-.66.77-1.25 2-1.08 3.18 1.15.09 2.32-.58 3.03-1.46z" /></svg>,
  soundcloud: (s) => <svg width={s} height={s / 2.286} viewBox="0 0 91.43 40" fill="currentColor"><path d="M 0.71,23.93 L 0.71,24.46 L 0.54,24.64 L 0.54,25.71 L 0.36,25.89 L 0.36,27.14 L 0.18,27.32 L 0.18,28.39 L 0.00,28.57 L 0.00,29.82 L 0.18,30.00 L 0.18,31.07 L 0.36,31.25 L 0.54,33.75 L 0.71,33.93 L 0.71,34.46 L 1.07,34.46 L 1.25,34.29 L 1.43,32.50 L 1.61,32.32 L 1.61,31.43 L 1.79,31.25 L 1.79,30.18 L 1.96,30.00 L 1.96,28.39 L 1.79,28.21 L 1.79,27.32 L 1.61,27.14 L 1.61,26.07 L 1.43,25.89 L 1.25,24.11 L 1.07,23.93 Z M 4.46,20.71 L 3.93,21.25 L 3.57,26.07 L 3.21,27.86 L 3.21,30.71 L 3.39,30.89 L 3.39,32.32 L 3.57,32.50 L 4.11,37.50 L 4.64,37.32 L 5.54,29.46 L 5.71,29.29 L 5.54,29.11 L 5.54,27.86 L 5.18,26.25 L 4.82,21.96 Z M 15.00,19.46 L 14.64,19.82 L 13.93,30.54 L 14.64,39.11 L 14.82,39.46 L 15.54,39.46 L 15.89,37.86 L 16.61,28.75 L 15.71,19.82 Z M 7.86,19.11 L 7.50,19.46 L 6.96,25.18 L 6.79,31.07 L 7.50,38.75 L 8.21,38.93 L 9.29,28.75 L 8.21,19.29 Z M 11.43,18.75 L 11.07,19.11 L 10.36,27.32 L 10.36,31.07 L 11.07,39.11 L 11.79,39.29 L 12.14,38.21 L 12.86,30.54 L 12.86,27.86 L 11.96,19.11 Z M 18.57,13.57 L 18.21,14.11 L 17.50,29.64 L 18.21,39.11 L 18.93,39.64 L 19.46,39.29 L 20.36,29.11 L 19.46,13.93 Z M 22.68,10.00 L 21.79,10.71 L 21.25,31.61 L 21.79,39.11 L 22.14,39.64 L 23.21,39.29 L 23.93,30.71 L 23.21,10.54 Z M 37.32,8.75 L 36.79,9.29 L 36.25,31.25 L 36.79,39.11 L 37.32,39.64 L 38.04,39.64 L 38.75,38.75 L 39.29,27.50 L 38.75,9.64 L 38.39,8.93 Z M 26.07,8.39 L 25.54,8.93 L 25.00,31.43 L 25.54,39.11 L 26.43,39.64 L 27.14,38.93 L 27.86,28.93 L 27.14,9.11 L 26.61,8.39 Z M 33.75,8.04 L 33.04,8.57 L 32.50,31.79 L 33.04,39.11 L 34.11,39.64 L 34.82,38.93 L 35.36,25.00 L 34.82,8.75 Z M 29.64,7.68 L 29.29,8.04 L 28.75,31.96 L 29.29,39.11 L 30.36,39.64 L 30.89,39.11 L 31.61,27.68 L 30.89,8.04 Z M 41.25,5.00 L 40.54,5.54 L 40.00,29.82 L 40.54,38.93 L 40.89,39.46 L 41.96,39.64 L 42.68,38.75 L 43.21,29.11 L 42.68,5.89 L 42.32,5.18 Z M 44.82,2.86 L 44.29,3.57 L 43.75,30.71 L 44.29,38.93 L 45.54,39.64 L 46.61,38.57 L 47.14,26.96 L 46.61,3.75 L 45.89,2.86 Z M 47.86,2.14 L 48.39,39.46 L 81.25,39.64 L 85.36,38.39 L 89.11,35.18 L 91.25,29.82 L 91.07,26.25 L 89.46,22.32 L 86.96,19.64 L 83.04,17.68 L 79.11,17.32 L 75.89,18.21 L 73.75,11.07 L 68.21,4.29 L 63.21,1.43 L 58.04,0.18 L 52.68,0.36 Z" /></svg>,
};

// Reliable external/email link: mirrors a real click on a target=_blank anchor
// (the behavior that already works for the X link), which opens https in a new
// tab and hands mailto: to the mail client — without ever navigating the app frame.
function openTab(href) {
  try {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch { /* ignore */ }
}
export function ExtLink({ href, className, label, title, children }) {
  const onClick = (e) => { e.preventDefault(); openTab(href); };
  return (
    <a href={href} onClick={onClick} target="_blank" rel="noopener noreferrer" className={className} aria-label={label} title={title}>
      {children}
    </a>
  );
}

const SERVICE_NAMES = { spotify: "Spotify", apple: "Apple Music", instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", soundcloud: "SoundCloud" };
// The Instagram/TikTok fields take a handle ("name", "@name") or a link. A link pasted without its
// https:// ("instagram.com/name", "www.tiktok.com/@name") is still a link, not a handle to append
// to the profile URL (that made https://instagram.com/instagram.com/name)
const handleLink = (v, profile) => {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (/^(?:[a-z0-9-]+\.)*(?:instagram\.com|instagr\.am|tiktok\.com)(?:[/?#]|$)/i.test(s)) return `https://${s}`;
  return profile + s.replace(/^@/, "");
};
export const instagramLink = (v) => handleLink(v, "https://instagram.com/");
export const tiktokLink = (v) => handleLink(v, "https://tiktok.com/@");
export function Socials({ c, size = 26 }) {
  const items = [
    ["spotify", webLink(c.spotify)],
    ["apple", webLink(c.apple)],
    ["instagram", instagramLink(c.instagram)],
    ["tiktok", tiktokLink(c.tiktok)],
    ["youtube", webLink(c.youtube)],
    ["soundcloud", webLink(c.soundcloud)],
  ].filter(([, url]) => url);
  if (items.length === 0) return null;
  return (
    <div className="socials">
      {items.map(([k, url]) => (
        <ExtLink key={k} href={url} className="social-ic" label={`${c.name} on ${SERVICE_NAMES[k]}`}>{ICONS[k](size)}</ExtLink>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  motion helpers                                                      */
/* ------------------------------------------------------------------ */
export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Runs a DOM update inside a View Transition where the browser has one
// (Chrome/Edge 111+, Safari 18+, Firefox 144+) so the old and new states
// morph into each other instead of swapping in one frame. `kind` lands on
// <html data-vt="..."> for the transition's lifetime, which is what the
// ::view-transition CSS keys off (page change vs. roster panel open/close).
// Unsupported browsers and reduced-motion visitors just get the update.
let vtSeq = 0;
export const vtWillRun = () => typeof document !== "undefined" && !!document.startViewTransition && !prefersReducedMotion();
export function withViewTransition(kind, update) {
  if (!vtWillRun()) {
    update();
    return null;
  }
  const root = document.documentElement;
  // starting a transition skips any running one; only the newest may clear the flags
  const id = ++vtSeq;
  root.dataset.vt = kind;
  const t = document.startViewTransition(update);
  const settle = (p) => p.then(() => {}, () => {});
  const finished = settle(t.finished).then(() => {
    if (id === vtSeq) { delete root.dataset.vt; delete root.dataset.dir; }
  });
  return { finished, updated: settle(t.updateCallbackDone) };
}

// Same-document jump that ignores html{scroll-behavior:smooth} (what Next does too).
// `ifNeeded`: leave the page where it is when the element is already fully on screen below the nav.
export function jumpIntoView(el, { ifNeeded = false } = {}) {
  if (!el) return;
  if (ifNeeded) {
    const r = el.getBoundingClientRect(), navBottom = document.querySelector(".nav2")?.getBoundingClientRect().bottom || 0;
    if (r.top >= navBottom && r.bottom <= window.innerHeight) return;
  }
  const html = document.documentElement, sb = html.style.scrollBehavior;
  html.style.scrollBehavior = "auto";
  el.scrollIntoView({ block: "center" });
  html.style.scrollBehavior = sb;
}

// next/link that navigates inside a page View Transition. router.push only
// resolves once the new route has actually committed, so the transition's
// "new" snapshot is always the real next page, never a half-rendered one.
// Modified clicks (new tab, etc.) fall through to the browser untouched.
// `vt="page-brand"` is only for the two logo links: it's the one transition
// where the wordmark and the nav D are named, so they morph into each other.
export const TLink = React.forwardRef(function TLink({ href, onClick, vt = "page", children, ...rest }, ref) {
  const router = useRouter();
  const handle = (e) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (router.asPath === href) { window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" }); return; }
    // the D growing into Home's wordmark hands over faster than the reverse, so the logo slot is never empty
    if (vt === "page-brand") document.documentElement.dataset.dir = href === ROUTE_TO_PATH.home ? "home" : "out";
    withViewTransition(vt, () => router.push(href));
  };
  return <Link href={href} onClick={handle} ref={ref} {...rest}>{children}</Link>;
});

// One shared IntersectionObserver for every [data-reveal] element on the
// public pages: each gets [data-in] the first time it scrolls into view (an attribute, not a class:
// React rewrites className whenever a card's own classes change, which would hide it again), and the
// CSS does the actual animating. Everything that arrives in the same batch is
// staggered in reading order (row by row, left to right — whatever the
// breakpoint), capped so a full row never takes longer than ~1/3s to land.
// Re-scans (batched per frame) whenever React adds elements, so content that
// arrives after the public-data fetch is covered. Public pages only.
export function useRevealOnScroll(enabled) {
  useEffect(() => {
    if (!enabled) return;
    const io = new IntersectionObserver((entries) => {
      const hits = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => (Math.round(a.boundingClientRect.top / 12) - Math.round(b.boundingClientRect.top / 12)) || (a.boundingClientRect.left - b.boundingClientRect.left));
      hits.forEach((e, i) => {
        e.target.style.setProperty("--rv-delay", `${Math.min(i * 60, 360)}ms`);
        e.target.setAttribute("data-in", "");
        io.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.01 });
    let raf = 0;
    const scan = () => {
      raf = 0;
      document.querySelectorAll("[data-reveal]:not([data-in]):not([data-reveal-seen])").forEach((el) => {
        el.setAttribute("data-reveal-seen", "");
        io.observe(el);
      });
    };
    scan();
    // text-only mutations (the panel's name decode rewrites text every frame) can't add [data-reveal]
    const mo = new MutationObserver((ms) => {
      if (!raf && ms.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1))) raf = requestAnimationFrame(scan);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { io.disconnect(); mo.disconnect(); cancelAnimationFrame(raf); };
  }, [enabled]);
}
