"use client";
import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { flushSync, createPortal } from "react-dom";
import NextImage from "next/image";
import Link from "next/link";
import { useRouter } from "next/router";
import dynamic from "next/dynamic";
import {
  Instagram, Mail, X, LogOut, Plus, Trash2, Pencil, Disc3,
  ListMusic, UserCog, Inbox, Check, ChevronUp, ChevronDown, LayoutGrid,
  Folder, ExternalLink, RefreshCw, Download, Handshake, Calculator, Copy,
  Radar, UploadCloud, AlertTriangle, CheckCircle2, Clock, Link2, TrendingUp,
  LayoutDashboard, ListChecks, Receipt, CircleDollarSign, Flag, ChevronRight, Info, Eye,
} from "lucide-react";
import { evenSplit, splitWords, filledSplits } from "../lib/splits";

/* ---- the brand font is /public/fonts/suntage.otf (preloaded in PageShell, so it downloads alongside
   this bundle instead of inside it). The chrome wordmark + D live in /public/brand as transparent
   files — same-origin, cacheable, and usable as CSS masks for the shine. ---- */

const uid = () => Math.random().toString(36).slice(2, 10);

/* ------------------------------------------------------------------ */
/*  logo — real embedded brand assets                                  */
/* ------------------------------------------------------------------ */
function Wordmark({ height = 34, hero = false }) {
  const h = hero ? undefined : height;
  return (
    <img
      src="/brand/wordmark.webp"
      alt="Defied Management"
      className={hero ? "logo-wordmark hero" : "logo-wordmark"}
      style={hero ? undefined : { height: h, width: "auto" }}
      draggable={false}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  tiny UI atoms                                                       */
/* ------------------------------------------------------------------ */
const Field = ({ label, hint, ...p }) => (
  <label className="fld"><span>{label}</span><input {...p} />{hint && <span className="hint">{hint}</span>}</label>
);
const Area = ({ label, ...p }) => (
  <label className="fld"><span>{label}</span><textarea rows={3} {...p} /></label>
);
const Avatar = ({ src, name, size = 56 }) =>
  src
    ? <Photo className="avatar" src={src} alt={name} style={{ width: size, height: size }} />
    : <div className="avatar avatar-ph" style={{ width: size, height: size, fontSize: size * 0.4 }}>{(name || "?")[0].toUpperCase()}</div>;

// Fades a photo in once it's actually decoded, instead of popping in abruptly —
// the panel-colored background behind it (set per usage in CSS) shows as a
// placeholder until then. `fill` routes remote (http/https) sources through
// Next's image optimizer — some of the roster source photos are raw
// multi-megabyte originals; this serves a properly sized, compressed,
// modern-format copy instead. Needs a position:relative container.
// next/image only fetches the hosts in next.config.js images.remotePatterns (and this site's own
// files); a cover pasted from anywhere else would come back 400 from it, so it loads as-is instead
const OPTIMIZABLE = /^(?:\/(?!\/)|https:\/\/(?:i\.scdn\.co|www\.defiedmgmt\.com)\/)/i;
function Photo({ src: rawSrc, alt, className = "", fill, sizes, ...rest }) {
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
  // Only real data: URIs (PhotoUpload's base64 output) skip this entirely.
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

// Lazy-load the HEIC decoder (iPhone photos) from CDN, once.
let _heicPromise = null;
function loadHeic() {
  if (window.heic2any) return Promise.resolve(window.heic2any);
  if (_heicPromise) return _heicPromise;
  _heicPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/heic2any/0.0.4/heic2any.min.js";
    s.onload = () => resolve(window.heic2any);
    s.onerror = reject;
    document.body.appendChild(s);
  });
  return _heicPromise;
}

// Turn any selected image file (incl. HEIC/HEIF) into a data URL.
async function fileToDataURL(file) {
  let blob = file;
  const isHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
  if (isHeic) {
    const heic2any = await loadHeic();
    let out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
    blob = Array.isArray(out) ? out[0] : out;
  }
  return await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

// Escape closes a dashboard dialog the same way its Cancel / X does (typed text goes with it, as
// there). A key something else already took (the crop over an editor), or one that's finishing an
// IME composition, is left alone. `first`: listen ahead of the rest, for a dialog opened over another.
function useEscape(onClose, active = true, first = false) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!active) return;
    const onKey = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      close.current();
    };
    window.addEventListener("keydown", onKey, first);
    return () => window.removeEventListener("keydown", onKey, first);
  }, [active, first]);
}

// Square crop tool: drag to reposition, slider to zoom, outputs a square JPEG data URL.
// It opens from inside an editor's card, but renders at the top of the app: the card's open
// animation leaves it a transform, which would make the card the box this fixed overlay is cut to.
function CropModal({ src, onCancel, onDone }) {
  const V = 300, OUT = 520;
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef(null);
  useEscape(onCancel, true, true); // only the crop closes, not the editor under it

  useEffect(() => {
    const i = new Image();
    i.onload = () => {
      setImg(i);
      const base = Math.max(V / i.width, V / i.height);
      setOff({ x: (V - i.width * base) / 2, y: (V - i.height * base) / 2 });
    };
    i.src = src;
  }, [src]);

  const base = img ? Math.max(V / img.width, V / img.height) : 1;
  const scale = base * zoom;
  const clamp = (o) => {
    if (!img) return o;
    const w = img.width * scale, h = img.height * scale;
    return { x: Math.min(0, Math.max(V - w, o.x)), y: Math.min(0, Math.max(V - h, o.y)) };
  };
  useEffect(() => { setOff((o) => clamp(o)); /* eslint-disable-next-line */ }, [zoom, img]);

  const pt = (e) => e.touches ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY };
  const down = (e) => { const p = pt(e); drag.current = { sx: p.x, sy: p.y, ox: off.x, oy: off.y }; };
  const move = (e) => {
    if (!drag.current) return;
    const p = pt(e);
    setOff(clamp({ x: drag.current.ox + (p.x - drag.current.sx), y: drag.current.oy + (p.y - drag.current.sy) }));
  };
  const up = () => { drag.current = null; };

  const confirm = () => {
    if (!img) return;
    const c = document.createElement("canvas");
    c.width = OUT; c.height = OUT;
    const ctx = c.getContext("2d");
    const sSize = V / scale, sx = -off.x / scale, sy = -off.y / scale;
    ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUT, OUT);
    onDone(c.toDataURL("image/jpeg", 0.9));
  };

  return createPortal(
    <div className="modal crop-overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="crop-card">
        <div className="modal-head"><h3>Position &amp; crop</h3><button onClick={onCancel} aria-label="Close"><X size={18} /></button></div>
        <div className="crop-body">
          <div
            className="crop-view"
            style={{ width: V, height: V }}
            onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up}
            onTouchStart={down} onTouchMove={move} onTouchEnd={up}
          >
            {img && (
              <img
                src={src} alt="" draggable={false}
                style={{ position: "absolute", left: off.x, top: off.y, width: img.width * scale, height: img.height * scale, maxWidth: "none" }}
              />
            )}
            <div className="crop-ring" />
          </div>
          <div className="crop-zoom">
            <span>Zoom</span>
            <input type="range" min="1" max="3" step="0.01" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          </div>
          <p className="crop-hint">Drag the image to reposition, slide to zoom.</p>
        </div>
        <div className="modal-foot">
          <button className="btn ghost sm" onClick={onCancel}>Cancel</button>
          <button className="btn sm" onClick={confirm}>Use photo</button>
        </div>
      </div>
    </div>,
    document.querySelector(".app") || document.body
  );
}

function PhotoUpload({ label, value, onChange }) {
  const [busy, setBusy] = useState(false);
  const [cropSrc, setCropSrc] = useState(null);
  const [err, setErr] = useState(null);
  const pick = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true); setErr(null);
    try { setCropSrc(await fileToDataURL(file)); }
    catch { setErr("Couldn't read that image. HEIC photos need a moment to convert — try again, or use a JPG/PNG."); }
    setBusy(false);
  };
  return (
    <div className="fld">
      <span>{label}</span>
      <div className="photo-up">
        {value ? <img className="photo-prev" src={value} alt="" /> : <div className="photo-prev photo-prev-empty">No photo</div>}
        <div className="photo-actions">
          <label className="btn ghost sm photo-btn">
            {busy ? "Loading…" : value ? "Replace photo" : "Upload photo"}
            <input type="file" accept="image/*,.heic,.heif" onChange={pick} hidden />
          </label>
          {value && <button type="button" className="photo-remove" onClick={() => onChange("")}>Remove</button>}
        </div>
      </div>
      {err && <p className="hint err-text" role="alert">{err}</p>}
      {cropSrc && <CropModal src={cropSrc} onCancel={() => setCropSrc(null)} onDone={(d) => { onChange(d); setCropSrc(null); }} />}
    </div>
  );
}

const fmt = (n) => Number(n || 0).toLocaleString();
// fmt(x.toFixed(2)) can drop a trailing zero (43510.90 -> "43,510.9") since
// toLocaleString() doesn't pad fraction digits on its own — force exactly 2.
const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* brand social icons (inline SVG so they always render) */
const ICONS = {
  instagram: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2.5" y="2.5" width="19" height="19" rx="5.5" /><circle cx="12" cy="12" r="4.2" /><circle cx="17.6" cy="6.4" r="1.1" fill="currentColor" stroke="none" /></svg>,
  tiktok: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 5.82a4.3 4.3 0 0 1-1.06-2.82h-3.2v12.9a2.35 2.35 0 1 1-2.34-2.35c.24 0 .47.04.68.1v-3.3a5.66 5.66 0 0 0-.68-.04 5.62 5.62 0 1 0 5.62 5.62V9.4a7.06 7.06 0 0 0 4.06 1.28V7.4a4.28 4.28 0 0 1-3.08-1.58z" /></svg>,
  youtube: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.12C19.5 3.56 12 3.56 12 3.56s-7.5 0-9.4.52A3 3 0 0 0 .5 6.2 31.3 31.3 0 0 0 0 12a31.3 31.3 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.12c1.9.52 9.4.52 9.4.52s7.5 0 9.4-.52a3 3 0 0 0 2.1-2.12A31.3 31.3 0 0 0 24 12a31.3 31.3 0 0 0-.5-5.8zM9.6 15.6V8.4l6.25 3.6z" /></svg>,
  spotify: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.6 14.42a.62.62 0 0 1-.86.2c-2.35-1.44-5.3-1.76-8.8-.96a.62.62 0 1 1-.27-1.22c3.82-.87 7.1-.5 9.73 1.11.3.18.4.58.2.87zm1.23-2.74a.78.78 0 0 1-1.07.26c-2.7-1.66-6.8-2.14-9.98-1.17a.78.78 0 1 1-.45-1.5c3.63-1.1 8.15-.56 11.24 1.34.36.22.48.7.26 1.07zm.1-2.85C14.82 8.98 9.5 8.8 6.4 9.75a.94.94 0 1 1-.54-1.8c3.56-1.08 9.44-.88 13.16 1.33a.94.94 0 0 1-.96 1.62z" /></svg>,
  apple: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 12.04c-.03-2.6 2.12-3.85 2.22-3.9-1.21-1.78-3.1-2.02-3.78-2.05-1.6-.16-3.13.94-3.94.94-.81 0-2.07-.92-3.4-.9-1.75.03-3.36 1.02-4.26 2.58-1.82 3.16-.47 7.83 1.3 10.4.86 1.25 1.9 2.65 3.25 2.6 1.3-.05 1.79-.84 3.36-.84 1.56 0 2 .84 3.38.81 1.4-.02 2.28-1.27 3.14-2.53.99-1.45 1.4-2.86 1.42-2.93-.03-.02-2.72-1.05-2.75-4.13zM14.6 4.5c.72-.87 1.2-2.08 1.07-3.28-1.03.04-2.28.69-3.02 1.56-.66.77-1.25 2-1.08 3.18 1.15.09 2.32-.58 3.03-1.46z" /></svg>,
  soundcloud: (s) => <svg width={s} height={s / 2.286} viewBox="0 0 91.43 40" fill="currentColor"><path d="M 0.71,23.93 L 0.71,24.46 L 0.54,24.64 L 0.54,25.71 L 0.36,25.89 L 0.36,27.14 L 0.18,27.32 L 0.18,28.39 L 0.00,28.57 L 0.00,29.82 L 0.18,30.00 L 0.18,31.07 L 0.36,31.25 L 0.54,33.75 L 0.71,33.93 L 0.71,34.46 L 1.07,34.46 L 1.25,34.29 L 1.43,32.50 L 1.61,32.32 L 1.61,31.43 L 1.79,31.25 L 1.79,30.18 L 1.96,30.00 L 1.96,28.39 L 1.79,28.21 L 1.79,27.32 L 1.61,27.14 L 1.61,26.07 L 1.43,25.89 L 1.25,24.11 L 1.07,23.93 Z M 4.46,20.71 L 3.93,21.25 L 3.57,26.07 L 3.21,27.86 L 3.21,30.71 L 3.39,30.89 L 3.39,32.32 L 3.57,32.50 L 4.11,37.50 L 4.64,37.32 L 5.54,29.46 L 5.71,29.29 L 5.54,29.11 L 5.54,27.86 L 5.18,26.25 L 4.82,21.96 Z M 15.00,19.46 L 14.64,19.82 L 13.93,30.54 L 14.64,39.11 L 14.82,39.46 L 15.54,39.46 L 15.89,37.86 L 16.61,28.75 L 15.71,19.82 Z M 7.86,19.11 L 7.50,19.46 L 6.96,25.18 L 6.79,31.07 L 7.50,38.75 L 8.21,38.93 L 9.29,28.75 L 8.21,19.29 Z M 11.43,18.75 L 11.07,19.11 L 10.36,27.32 L 10.36,31.07 L 11.07,39.11 L 11.79,39.29 L 12.14,38.21 L 12.86,30.54 L 12.86,27.86 L 11.96,19.11 Z M 18.57,13.57 L 18.21,14.11 L 17.50,29.64 L 18.21,39.11 L 18.93,39.64 L 19.46,39.29 L 20.36,29.11 L 19.46,13.93 Z M 22.68,10.00 L 21.79,10.71 L 21.25,31.61 L 21.79,39.11 L 22.14,39.64 L 23.21,39.29 L 23.93,30.71 L 23.21,10.54 Z M 37.32,8.75 L 36.79,9.29 L 36.25,31.25 L 36.79,39.11 L 37.32,39.64 L 38.04,39.64 L 38.75,38.75 L 39.29,27.50 L 38.75,9.64 L 38.39,8.93 Z M 26.07,8.39 L 25.54,8.93 L 25.00,31.43 L 25.54,39.11 L 26.43,39.64 L 27.14,38.93 L 27.86,28.93 L 27.14,9.11 L 26.61,8.39 Z M 33.75,8.04 L 33.04,8.57 L 32.50,31.79 L 33.04,39.11 L 34.11,39.64 L 34.82,38.93 L 35.36,25.00 L 34.82,8.75 Z M 29.64,7.68 L 29.29,8.04 L 28.75,31.96 L 29.29,39.11 L 30.36,39.64 L 30.89,39.11 L 31.61,27.68 L 30.89,8.04 Z M 41.25,5.00 L 40.54,5.54 L 40.00,29.82 L 40.54,38.93 L 40.89,39.46 L 41.96,39.64 L 42.68,38.75 L 43.21,29.11 L 42.68,5.89 L 42.32,5.18 Z M 44.82,2.86 L 44.29,3.57 L 43.75,30.71 L 44.29,38.93 L 45.54,39.64 L 46.61,38.57 L 47.14,26.96 L 46.61,3.75 L 45.89,2.86 Z M 47.86,2.14 L 48.39,39.46 L 81.25,39.64 L 85.36,38.39 L 89.11,35.18 L 91.25,29.82 L 91.07,26.25 L 89.46,22.32 L 86.96,19.64 L 83.04,17.68 L 79.11,17.32 L 75.89,18.21 L 73.75,11.07 L 68.21,4.29 L 63.21,1.43 L 58.04,0.18 L 52.68,0.36 Z" /></svg>,
};

// Email action that actually works everywhere: copies the address to the clipboard
// with visible feedback, and also attempts to open the mail client.
function EmailButton({ email, size = 18, inline = false }) {
  const [copied, setCopied] = useState(false);
  const act = async (e) => {
    e.preventDefault();
    try { await navigator.clipboard.writeText(email); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = email; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand("copy"); } catch { /* ignore */ }
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1700);
    try {
      const a = document.createElement("a");
      a.href = "mailto:" + email; a.target = "_blank"; a.rel = "noopener noreferrer";
      document.body.appendChild(a); a.click(); a.remove();
    } catch { /* ignore */ }
  };
  if (inline) {
    return (
      <button className="inline-link email-inline" onClick={act} title="Copy email">
        {email}{copied && <span className="copied-tag"> ✓ copied</span>}
      </button>
    );
  }
  return (
    <button className="icon-btn" onClick={act} aria-label="Copy email address" title={email}>
      {copied ? <Check size={size} /> : <Mail size={size} />}
      {copied && <span className="copied-pop">Copied</span>}
    </button>
  );
}

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
function ExtLink({ href, className, label, title, children }) {
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
const instagramLink = (v) => handleLink(v, "https://instagram.com/");
const tiktokLink = (v) => handleLink(v, "https://tiktok.com/@");
function Socials({ c, size = 26 }) {
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
/*  splits: pie chart + editor                                          */
/* ------------------------------------------------------------------ */
const PIE_COLORS = ["#f5f5f5", "#8a8a8a", "#c8c8cc", "#5f5f61", "#a3a3a3", "#3a3a3c", "#e2e2e4", "#6e6e70"];
const splitTotal = (splits) => (splits || []).reduce((a, s) => a + Number(s.percent || 0), 0);
const splitPct = (splits) => Math.round(splitTotal(splits) * 10) / 10;
// the songs whose splits don't add up to 100%, by client: the clients whose songs have the most streams
// first, and in each the biggest songs first (Publishing's Splits to fix list, its Next →, the chips)
function splitsToFix(db) {
  const by = new Map();
  for (const p of db.placements) if (splitTotal(p.splits) !== 100) by.set(p.clientId, [...(by.get(p.clientId) || []), p]);
  const sum = (songs) => songs.reduce((a, p) => a + (p.streams || 0), 0);
  return [...by.entries()]
    .map(([clientId, songs]) => ({ clientId, client: (db.clients || []).find((c) => c.id === clientId) || null, songs: songs.sort((a, b) => (b.streams || 0) - (a.streams || 0)) }))
    .sort((a, b) => sum(b.songs) - sum(a.songs) || (a.client?.name || "").localeCompare(b.client?.name || ""));
}
// one wording for how fresh the streams are (Publishing's subline, a client's page, a song window): the
// day of the Luminate export they come from, and when the site last pulled the pub sheet
function streamsAsOf({ luminateDay, pulledAt }) {
  const pulled = pulledAt ? ` · sheet pulled ${new Date(pulledAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "";
  return luminateDay
    ? `Luminate numbers from ${new Date(`${luminateDay}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}${pulled}`
    : `Not tracked in Luminate yet${pulled}`;
}

// recharts (~350KB min / ~90KB gzip) is only drawn in the song-splits view (staff Clients tab +
// client portal) — loaded on demand so the public pages never carry it
const SplitsPieChart = dynamic(() => import("./SplitsPieChart"), { ssr: false });
function SplitsPie({ splits, size = 220 }) {
  const data = (splits || []).filter((s) => Number(s.percent) > 0)
    .map((s) => ({ name: s.name || s.label || s.role || "—", value: Number(s.percent) || 0 }));
  if (data.length === 0) return <p className="muted">No splits entered yet.</p>;
  return <div style={{ height: size }}><SplitsPieChart data={data} size={size} colors={PIE_COLORS} /></div>;
}

function SplitsEditor({ splits, onChange, focusPct = 0 }) {
  const all = splits || [];
  // the even default (lib/splits.js), live: a 25 typed for a producer shows the unnamed producer at 25 and the
  // artist side at once, and Save writes exactly these rows. While the total is off the unnamed people are the
  // rule's own, so only the named ones are typed into
  const fill = evenSplit(all);
  const rows = fill.status === "ok" ? all : all.filter((r) => !r.unnamed);
  const shown = fill.status === "assumed" ? fill.splits : rows;
  const box = useRef(null);
  // a Fix from Splits to confirm (focusPct = its n) opens on this block, the reason it opened, with the first % ready to type.
  // Only the window's own scroll moves, never the page behind it
  useEffect(() => {
    const el = box.current, body = el?.closest(".modal-body");
    if (!focusPct || !el) return;
    if (body) body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top - 12;
    el.querySelector(".pct-in input")?.focus({ preventScroll: true });
  }, [focusPct]);
  const update = (id, key, val) => onChange(rows.map((r) => r.id === id ? { ...r, [key]: val } : r));
  const add = () => onChange([...rows, { id: uid(), name: "", role: "", percent: 50 }]);
  const remove = (id) => onChange(rows.filter((r) => r.id !== id));
  const total = splitTotal(shown);
  return (
    <div className="splits-ed" ref={box}>
      {/* shown to one decimal like everywhere else (1/3 is 33.3%, not 33.333333333333336%); the saved % is unchanged */}
      <div className="splits-ed-head"><span>Splits</span><span className={total === 100 ? "split-ok" : "split-warn"}>{splitPct(shown)}%</span></div>
      {shown.map((r) => r.unnamed ? (
        <div key={r.id} className="splits-ed-row split-assumed" data-unnamed>
          <input value="" placeholder={r.label || `${r.role} (unnamed)`} readOnly tabIndex={-1} aria-label={r.label || "Unnamed"} />
          <input value={r.role} readOnly tabIndex={-1} aria-label="Role" />
          <span className="pct-in pct-assumed">{splitPct([r])}%</span>
          <span aria-hidden="true" />
        </div>
      ) : (
        <div key={r.id} className="splits-ed-row">
          <input placeholder="Name" value={r.name} onChange={(e) => update(r.id, "name", e.target.value)} />
          <input placeholder="Role" value={r.role} onChange={(e) => update(r.id, "role", e.target.value)} />
          {/* a listed person with no share shows the even share they'll get */}
          <span className="pct-in"><input type="number" min="0" max="100" value={r.percent} placeholder={fill.status === "assumed" && !(Number(rows.find((x) => x.id === r.id)?.percent) > 0) ? String(splitPct([r])) : undefined} onChange={(e) => update(r.id, "percent", Number(e.target.value))} />%</span>
          <button type="button" className="split-del" onClick={() => remove(r.id)} aria-label="Remove"><Trash2 size={14} /></button>
        </div>
      ))}
      <button type="button" className="btn ghost sm" onClick={add}><Plus size={14} /> Add split</button>
      {fill.status === "assumed" && <p className="split-hint split-even" data-even>Even split assumed: {splitWords(fill.splits)}. Save keeps it.</p>}
      {fill.status === "look" && rows.length > 0 && <p className="split-hint">Splits should total 100% (currently {splitPct(rows)}%). {fill.reason}.</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  motion helpers                                                      */
/* ------------------------------------------------------------------ */
const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Runs a DOM update inside a View Transition where the browser has one
// (Chrome/Edge 111+, Safari 18+, Firefox 144+) so the old and new states
// morph into each other instead of swapping in one frame. `kind` lands on
// <html data-vt="..."> for the transition's lifetime, which is what the
// ::view-transition CSS keys off (page change vs. roster panel open/close).
// Unsupported browsers and reduced-motion visitors just get the update.
let vtSeq = 0;
const vtWillRun = () => typeof document !== "undefined" && !!document.startViewTransition && !prefersReducedMotion();
function withViewTransition(kind, update) {
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
function jumpIntoView(el, { ifNeeded = false } = {}) {
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

// a dashboard chip row that scrolls sideways (the sub-navs and the client chooser on phones and
// tablets): the chosen chip comes fully into view instead of staying cut at the edge. The client
// chooser snaps chips to its start, which would snap one only just brought in back out of view, so
// a cut chip goes to the start there. "auto" is instant (the rows set no scroll-behavior, and
// reduced motion turns html's smooth off)
function revealChip(el) {
  const row = el?.closest(".subnav, .catalog-clients");
  if (!row) return;
  // the row's own scroll only: scrollIntoView would move the whole page to reach a chip low in a tall list
  const r = el.getBoundingClientRect(), box = row.getBoundingClientRect();
  let left = row.scrollLeft, top = row.scrollTop;
  if (r.left < box.left || r.right > box.right) left += getComputedStyle(row).scrollSnapType !== "none" || r.left < box.left ? r.left - box.left : r.right - box.right;
  if (r.top < box.top || r.bottom > box.bottom) top += r.top < box.top ? r.top - box.top : r.bottom - box.bottom;
  if (left !== row.scrollLeft || top !== row.scrollTop) row.scrollTo({ left, top, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

// a block the user was sent to: scrolled to only when it starts low on the screen or above it, so a
// section that's already in view keeps its page header and pills on screen
function landOn(el) {
  if (!el) return;
  const top = el.getBoundingClientRect().top;
  if (top >= 0 && top <= window.innerHeight * 0.6) return;
  el.scrollIntoView({ block: "start" });
}

// the line a Delete or "This isn't ours" leaves, with its one next step when there is one
function DropNote({ note, onShow }) {
  if (!note) return null;
  return (
    <p className={note.warn ? "hint del-note warn" : "hint del-note"} role="status">
      {note.warn ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />} <span>{note.text}
        {note.go && onShow && <> <button className="inline-link" data-show-me onClick={() => onShow(note.go)}>View</button></>}</span>
    </p>
  );
}

// next/link that navigates inside a page View Transition. router.push only
// resolves once the new route has actually committed, so the transition's
// "new" snapshot is always the real next page, never a half-rendered one.
// Modified clicks (new tab, etc.) fall through to the browser untouched.
// `vt="page-brand"` is only for the two logo links: it's the one transition
// where the wordmark and the nav D are named, so they morph into each other.
const TLink = React.forwardRef(function TLink({ href, onClick, vt = "page", children, ...rest }, ref) {
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
function useRevealOnScroll(enabled) {
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

/* ================================================================== */
/*  APP                                                                */
/* ================================================================== */
// every internal route name maps to a real, bookmarkable URL — each has its
// own page file (pages/about.jsx etc.) that just renders <App/>; the route
// itself is derived from the current URL, not kept as separate React state.
const ROUTE_TO_PATH = {
  home: "/", about: "/about", team: "/team", roster: "/roster",
  contact: "/contact", login: "/login", staff: "/dashboard", client: "/portal",
};
const PATH_TO_ROUTE = Object.fromEntries(Object.entries(ROUTE_TO_PATH).map(([k, v]) => [v, k]));

export default function App() {
  const router = useRouter();
  // pages/404 renders for any unknown URL; everything else unknown still falls back to Home
  const route = PATH_TO_ROUTE[router.pathname] || (router.pathname === "/404" ? "notfound" : "home");
  // undefined = /api/auth/me hasn't answered yet, null = signed out,
  // {id, role, name, clientId} = signed in. Every route-protection decision
  // below waits for this to leave "undefined" so a real session's data
  // never flashes as "signed out" for a tick, and a genuinely signed-out
  // visitor never sees a protected page render before the redirect fires.
  const [session, setSession] = useState(undefined);
  // authenticated dashboard/portal data — staff gets the full shape, a
  // client gets only their own client record + own placements (server-side,
  // not just hidden in the UI — see /api/dashboard-data). null until loaded.
  const [db, setDb] = useState(null);
  // public marketing-page data — fetched once, always, regardless of auth
  // state, since the public pages and their data were never sensitive.
  // Repeat visits start from the last good copy (read before the first render, so no loading
  // frame) and swap in the fresh one when it lands.
  const [publicData, setPublicData] = useState(() => {
    try {
      const c = JSON.parse(localStorage.getItem(PUBLIC_CACHE_KEY) || "null");
      return c && Array.isArray(c.clients) && Date.now() - (c.savedAt || 0) < PUBLIC_CACHE_MAX_AGE ? withSlugs(c) : null;
    } catch { return null; } // storage blocked
  });
  const hadCachedData = useRef(publicData !== null);
  const pubStale = useRef(false); // set by a dashboard save
  const [menuOpen, setMenuOpen] = useState(false);
  const [loadErr, setLoadErr] = useState(null); // the dashboard's own load / save errors
  const [signIns, setSignIns] = useState(0); // each sign-in reloads its data, even as the same account
  const signedInHere = useRef(false); // login() is already on its way to the dashboard
  const [pubErr, setPubErr] = useState(null); // the public pages' data
  const [authDown, setAuthDown] = useState(false); // /api/auth/me couldn't check the sign-in (not "signed out")
  const [signingOut, setSigningOut] = useState(false); // sign-out is waiting for queued saves to land
  useRevealOnScroll(route !== "staff" && route !== "client");

  // the fresh copy (see publicDataRequest) swaps in when it lands; a failed request only shows
  // the banner when there was nothing cached to show instead
  useEffect(() => {
    let alive = true;
    publicDataRequest.then((d) => {
      if (!alive) return;
      if (d) setPublicData(withSlugs(d));
      else if (!hadCachedData.current) setPubErr("Couldn't load site data — try refreshing.");
    });
    return () => { alive = false; };
  }, []);

  // a tab left open never reloads on its own: coming back to it picks up whatever the dashboard has
  // changed since (public pages only, at most once a minute). An answer with nothing new leaves the
  // page alone, and a failed one keeps what's on screen.
  const pubFetchedAt = useRef(Date.now());
  const onPublicRoute = route !== "staff" && route !== "client";
  useEffect(() => {
    if (!onPublicRoute) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible" || Date.now() - pubFetchedAt.current < PUBLIC_REFRESH_MS) return;
      pubFetchedAt.current = Date.now();
      fetchPublicData().then((d) => {
        if (!d) return;
        const next = withSlugs(d);
        setPublicData((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
        setPubErr(null);
      });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [onPublicRoute]);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; })
      .then((d) => { if (alive) setSession(d.user ?? null); })
      // a 503 (the account couldn't be checked) or no connection: signed out, not "still asking" forever,
      // but the sign-in page says why
      .catch(() => { if (alive) { setSession(null); setAuthDown(true); } });
    return () => { alive = false; };
  }, []);
  // that notice is about one failed check: the sign-in page asks again before repeating it
  useEffect(() => {
    if (route !== "login" || !authDown) return;
    let alive = true;
    fetch("/api/auth/me")
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; })
      .then((d) => { if (!alive) return; setAuthDown(false); if (d.user) setSession(d.user); })
      .catch(() => {}); // still down: the notice stays
    return () => { alive = false; };
  }, [route, authDown]);

  // the db the dashboard last drew — what an edit made in it was derived from
  const shownDb = useRef(null);
  shownDb.current = db;
  // save bookkeeping: chain = the queue saves run through one at a time; pending = saves queued or
  // in flight; calls = saves ever started; failed = one failed since the queue last emptied;
  // server = the latest server copy this tab knows of; gen = bumped per sign-in, so a save still
  // queued from the last one is dropped; freshAt = when server was last fetched
  const saves = useRef({ chain: Promise.resolve(), pending: 0, calls: 0, failed: false, server: null, gen: 0, freshAt: 0 });

  // once a session is known, load its scoped dashboard/portal data —
  // re-fires if the signed-in user actually changes (login/logout/switch).
  useEffect(() => {
    const s = saves.current;
    s.gen++; s.server = null;
    setLoadErr(null); // the last account's banner isn't this one's
    setDb(null); // nor its data: "Loading…" until this account's own copy lands
    if (!session) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/dashboard-data");
        if (res.status === 401) { if (alive) setSession(null); return; }
        const data = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok || !data.role) throw new Error(data.error || "Failed to load.");
        if (data.role !== session.role) throw new Error(ACCOUNT_CHANGED);
        s.server = data; s.freshAt = Date.now();
        setDb(data);
      } catch (err) {
        if (alive) setLoadErr(err.message || "Couldn't load your dashboard data.");
      }
    })();
    return () => { alive = false; };
  }, [session?.id, signIns]);

  // Callers keep the old commit({...db, changedKey: newValue}) shape. The UI updates at once; the
  // save itself waits its turn, then rebases: what this edit changed (base -> next, field by field,
  // see diffDb) is applied to the server's latest copy, and only the tables it touched are sent. So
  // a song a client added, a new message or another staff member's edit since this tab loaded is
  // never wiped by sending this tab's old copy back. base = the db next was built from: the one on
  // screen, or for a slow job (the sheet sync) the copy it started from. Resolves with the server's
  // copy as saved (a row deleted elsewhere is missing from it), or false when nothing was saved.
  const commit = (next, base = shownDb.current) => {
    const patch = diffDb(base, next);
    if (!patch) return Promise.resolve(next);
    const s = saves.current, gen = s.gen;
    setDb((cur) => (cur === base ? next : cur && applyPatch(cur, patch)));
    // leaving now would drop it: the browser asks first while anything is unsaved
    if (s.pending++ === 0) window.addEventListener("beforeunload", holdUnload);
    s.calls++;
    const run = s.chain.then(async () => {
      let saved = false;
      try {
        if (gen !== s.gen) return false; // signed out since
        const got = await fetch("/api/dashboard-data", { cache: "no-store" }).catch(() => null);
        const latest = got && await got.json().catch(() => null);
        // a 404: a client account with no client record (staff demoted with nobody linked)
        if (got?.status === 404) throw new Error(ACCOUNT_CHANGED);
        if (!got?.ok || !latest?.role) throw new Error(saveFailure(got, latest, SAVE_OFFLINE));
        // the account was demoted or re-linked since this tab loaded: keep what's on screen as it is
        if (accountChanged(latest, s.server || base)) throw new Error(ACCOUNT_CHANGED);
        const fresh = inTabOrder(latest, s.server);
        s.server = fresh; s.freshAt = Date.now();
        const merged = applyPatch(fresh, patch);
        const refused = refusal(patch, fresh, merged);
        if (refused) throw new Error(refused);
        const res = await fetch("/api/dashboard-data", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
          body: JSON.stringify(Object.fromEntries(saveKeys(patch, fresh, merged).map((k) => [k, merged[k]]))),
        }).catch(() => null);
        if (!res?.ok) throw new Error(saveFailure(res, res && await res.json().catch(() => null), "Save failed.", fresh.role));
        s.server = saved = withoutPasswords(merged);
        if (!s.failed) setLoadErr(null);
        // the public pages' copy is now out of date: refetch it when staff next open one
        pubStale.current = true;
        try { localStorage.removeItem(PUBLIC_CACHE_KEY); } catch { /* storage blocked */ }
      } catch (err) {
        s.failed = true;
        if (gen === s.gen) setLoadErr(err.message || "Couldn't save that change — try again.");
      } finally {
        // the last save out shows the server's copy: others' changes, minus anything that failed
        if (--s.pending === 0) { s.failed = false; window.removeEventListener("beforeunload", holdUnload); if (gen === s.gen) setDb(s.server); }
        else if (saved && patch.users && gen === s.gen) setDb(withoutPasswords);
      }
      return saved;
    });
    s.chain = run;
    return run;
  };

  // after the server changed data itself (a Luminate update, a link): swap in its copy once the
  // saves queued in this tab have landed. A save started meanwhile brings its own fresh copy.
  const reloadDb = async () => {
    const s = saves.current, gen = s.gen;
    await s.chain;
    if (gen !== s.gen || s.pending) return;
    const calls = s.calls;
    const res = await fetch("/api/dashboard-data", { cache: "no-store" }).catch(() => null);
    const fresh = res?.ok ? await res.json().catch(() => null) : null;
    if (!fresh?.role || gen !== s.gen || s.pending || calls !== s.calls || accountChanged(fresh, s.server || fresh)) return;
    s.server = inTabOrder(fresh, s.server); s.freshAt = Date.now();
    setDb(s.server);
  };

  // an open dashboard shows new contact messages when staff come back to the tab (at most every
  // 30 s, never mid-save). Only the Messages list is swapped in, so nothing being edited is touched.
  useEffect(() => {
    if (route !== "staff" || session?.role !== "staff") return;
    const s = saves.current;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || s.pending || !s.server || Date.now() - s.freshAt < 30000) return;
      s.freshAt = Date.now();
      const { gen, calls } = s;
      try {
        const res = await fetch("/api/dashboard-data", { cache: "no-store" });
        const fresh = res.ok ? await res.json() : null;
        // a save started meanwhile brings its own fresh copy
        if (!Array.isArray(fresh?.submissions) || gen !== s.gen || calls !== s.calls) return;
        s.server = { ...s.server, submissions: fresh.submissions };
        setDb((cur) => cur && { ...cur, submissions: fresh.submissions });
      } catch { /* offline: the next return to the tab tries again */ }
    };
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    refresh(); // back on the dashboard from the public pages, in the same tab
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", onVisible); };
  }, [route, session?.id, session?.role]);

  const go = (r) => {
    const path = ROUTE_TO_PATH[r] || "/";
    const nav = router.pathname !== path ? router.push(path) : Promise.resolve();
    setMenuOpen(false);
    window.scrollTo(0, 0);
    return nav;
  };

  const login = async (email, password) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) return data?.error || (res.status >= 500 || res.ok ? "Sign-in isn't available right now — try again in a minute." : "Incorrect email or password.");
    // in the same render as the route change: the new dashboard never draws the last account's data
    clearDashCaches();
    setDb(null); setSession(data.user); setAuthDown(false); setLoadErr(null); setSignIns((n) => n + 1);
    signedInHere.current = true; // this push goes on from the sign-in page; the effect below needn't
    go(data.user.role === "staff" ? "staff" : "client");
    return null;
  };
  const logout = async () => {
    if (signingOut) return;
    // a save still queued or running needs the session: let it land first (but never hold sign-out
    // long). The Sign out buttons say so meanwhile.
    setSigningOut(true);
    try {
      const s = saves.current, until = Date.now() + 8000;
      while (s.pending && Date.now() < until) await Promise.race([s.chain, new Promise((r) => setTimeout(r, until - Date.now()))]);
      await fetch("/api/auth/logout", { method: "POST", headers: { "X-Requested-With": "defied-site" } }).catch(() => {});
      // navigate home BEFORE clearing session — otherwise the route-guard
      // effect below sees session go null while route is still "staff"/
      // "client" for one render and races router.replace("/login") against
      // this push, sometimes winning and landing back on the login page.
      await go("home");
      clearDashCaches(); // the next account never sees this one's last answers
      setSession(null);
      setDb(null);
      setLoadErr(null); setAuthDown(false);
    } finally { setSigningOut(false); }
  };

  // a direct visit to /dashboard or /portal — a bookmark, a refresh, a
  // shared link — with no session bounces to sign-in instead of rendering
  // nothing. Gated on session !== undefined so this never fires before
  // /api/auth/me has had its one round trip to answer. This is now purely
  // a UX nicety, not the security boundary — the data itself is unreachable
  // without a valid session regardless of what this effect does.
  useEffect(() => {
    if (session === undefined) return;
    if (route === "staff" && session?.role !== "staff") router.replace("/login");
    if (route === "client" && session?.role !== "client") router.replace("/login");
    // already signed in: the sign-in page (Back from the dashboard, a bookmark) goes on to the
    // dashboard or portal instead of asking again
    if (route !== "login") signedInHere.current = false;
    else if (session?.role && !signedInHere.current) router.replace(session.role === "staff" ? "/dashboard" : "/portal");
  }, [route, session]);

  const inPortal = route === "staff" || route === "client";

  // after a dashboard save, going back to the public site (logo, nav) shows what was just saved
  useEffect(() => {
    if (inPortal || !pubStale.current) return;
    pubStale.current = false;
    fetch("/api/public-data")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!Array.isArray(d?.clients)) return;
        try { localStorage.setItem(PUBLIC_CACHE_KEY, JSON.stringify({ ...d, savedAt: Date.now() })); } catch { /* storage full or blocked */ }
        setPublicData(withSlugs(d));
      })
      .catch(() => {});
  }, [inPortal]);
  // browsers with View Transitions animate route changes there; the rest get a CSS entrance
  const canViewTransition = typeof document !== "undefined" && !!document.startViewTransition;

  // the App persists across routes, so the mobile menu has to be told to
  // close on any navigation — including back/forward, not just link taps.
  // Without a view transition to capture it, it waits for the new page, so
  // the page being left never shows through the fading menu.
  useEffect(() => {
    const ev = vtWillRun() ? "routeChangeStart" : "routeChangeComplete";
    const close = () => setMenuOpen(false);
    router.events.on(ev, close);
    // /about#x → /about is hash-only: Next fires hashChange*, never routeChange* (and Back between
    // two fragments of the first page fires no router event at all)
    router.events.on("hashChangeComplete", close);
    window.addEventListener("hashchange", close);
    return () => { router.events.off(ev, close); router.events.off("hashChangeComplete", close); window.removeEventListener("hashchange", close); };
  }, [router.events]);

  return (
    <div className={inPortal ? "app" : "app pub"}>
      <StyleTag />
      {!inPortal && <div className="grain" aria-hidden="true" />}
      {/* signed out mid-edit: the page stays put so typed text can be copied; the link (the sentence's last
          words) reloads it fresh. One span, so text and link wrap as one line of text */}
      {inPortal ? loadErr && <div className="storage-warn" role="alert"><span>{loadErr}{loadErr === SIGNED_OUT && <> <a href={ROUTE_TO_PATH.login} className="inline-link">sign in again.</a></>}</span></div>
        : pubErr && DATA_ROUTES.includes(route) && <div className="storage-warn" role="alert">{pubErr}</div>}
      {!inPortal && (
        <PublicNav route={route} menuOpen={menuOpen} setMenuOpen={setMenuOpen} session={session} />
      )}

      {/* the open poster menu is modal: the page under it leaves the tab order */}
      <div className={`${route === "home" || route === "login" || route === "notfound" ? "view view-home" : "view"}${canViewTransition ? "" : " view-anim"}`} key={route} {...(menuOpen ? { inert: "" } : {})}>
        {/* the banner when there's nothing better coming: the request failed, or the copy that just
            failed to draw already is the fresh one */}
        <PageGuard data={publicData} outage={!!pubErr && !publicData && DATA_ROUTES.includes(route)} onDrop={() => publicDataRequest.then((d) => { if (!d || d === publicData) setPubErr("Couldn't load site data — try refreshing."); })}>
          {route === "home" && <Home />}
          {route === "about" && <About publicData={publicData} />}
          {route === "team" && <TeamPage publicData={publicData} />}
          {route === "roster" && <Roster publicData={publicData} />}
          {route === "contact" && <Contact publicData={publicData} />}
        </PageGuard>
        {route === "login" && <Login login={login} notice={authDown ? "We couldn't check your sign-in just now — try again in a minute." : null} />}
        {route === "notfound" && <NotFound />}

        {/* session undefined = /api/auth/me hasn't answered: the same "Loading…" as the data load after it */}
        {route === "staff" && (session === undefined || session?.role === "staff") && (
          db ? <StaffDashboard db={db} commit={commit} reloadDb={reloadDb} logout={logout} signingOut={signingOut} /> : <p className="muted page">Loading…</p>
        )}
        {route === "client" && (session === undefined || session?.role === "client") && (
          db ? <ClientPortal db={db} commit={commit} session={session} logout={logout} signingOut={signingOut} /> : <p className="muted page">Loading…</p>
        )}
      </div>

      {!inPortal && <Footer route={route} inert={menuOpen} />}
      {!inPortal && <Toast />}
    </div>
  );
}

// a mistyped or old link: say so in the site's own voice, and offer the two ways back in
function NotFound() {
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

/* ------------------------------------------------------------------ */
/*  PUBLIC — shared data helpers                                        */
/* ------------------------------------------------------------------ */
const PUBLIC_LINKS = [["about", "About"], ["team", "Team"], ["roster", "Roster"], ["contact", "Contact"]];
// next/image `sizes` for roster cards — the artist panel reuses this exact
// string for its first paint so the browser hands back the already-decoded
// grid image (same srcset pick) and the card→panel morph never lands on an
// empty frame while the panel-sized photo is still downloading.
// 3x phones get a ~2x photo: it looks the same at card size for about half the bytes (browsers
// without the resolution query fall through to 46vw).
const CARD_SIZES = "(max-width: 599px) and (min-resolution: 2.5dppx) 29vw, (max-width: 599px) 46vw, (max-width: 899px) 31vw, (max-width: 1199px) 23vw, 260px";
// localStorage copy of /api/public-data — bump the version whenever that payload's shape changes
const PUBLIC_CACHE_KEY = "dm-public-data-v2";
// …and how long a saved copy may stand in: past a day a visit waits for the fresh one instead
const PUBLIC_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
// Saves each good answer as the copy the next visit starts from. An error answer (the API sends 502 JSON
// when the database fails) or an odd one resolves to null and never replaces good data.
const fetchPublicData = () => fetch("/api/public-data")
  .then((r) => { if (!r.ok) throw new Error(`public-data ${r.status}`); return r.json(); })
  .then((d) => {
    if (!Array.isArray(d?.clients)) throw new Error("public-data: unexpected shape");
    try { localStorage.setItem(PUBLIC_CACHE_KEY, JSON.stringify({ ...d, savedAt: Date.now() })); } catch { /* storage full or blocked */ }
    return d;
  })
  .catch(() => null);
// Requested as soon as this module runs (PageShell's preload has it in flight already), so it lands
// sooner and overwrites the saved copy even if this visit never manages to draw it (PageGuard drops a
// copy a page can't draw).
const publicDataRequest = typeof window === "undefined" ? null : fetchPublicData();
// how often a tab coming back into view may ask for the site data again
const PUBLIC_REFRESH_MS = 60 * 1000;

// one rule for "is this the same person" wherever a client/writer/split name is compared (never song
// titles), kept identical to lib/names.js: accents and punctuation drop out and a "!" standing in for
// an i counts as one, so Stack!e, STACK!E and Stackie are "stackie" and Stacke ("stacke") is someone else
const personKey = (s) => String(s ?? "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase()
  .replace(/(\p{L})!(?=\p{L})/gu, "$1i").replace(/[^\p{L}\p{N}]+/gu, "");
// the entry of `list` that `name` refers to: an exact (case-insensitive) match always wins over a personKey one
const findByName = (list, name, nameOf = (x) => x.name) => {
  const n = String(name ?? "").trim().toLowerCase(), k = personKey(name);
  return (n && list.find((x) => String(nameOf(x) ?? "").trim().toLowerCase() === n)) || (k && list.find((x) => personKey(nameOf(x)) === k)) || null;
};
// a client's own split on a song (what their own streams/revenue share comes from)
const ownSplit = (p, client) => (client?.name ? findByName(p?.splits || [], client.name) : null);

// a roster member's ?artist= key: "Stack!e" → stackie, "Beyoncé" → beyonce. Letters and digits of any
// alphabet stay; a name with none (emoji only) falls back to the record's id, so every card opens
const nameKey = (person) => personKey(person?.name) || String(person?.id || "");
const slugOf = (person) => person?.slug || nameKey(person);
// links shared before the key counted "!" as an i (?artist=stacke) still open the same panel, as long
// as no one's own key is that
const legacyKey = (person) => String(person?.name || "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const bySlug = (clients, slug) => (slug ? clients.find((c) => slugOf(c) === slug) || clients.find((c) => legacyKey(c) === slug) || null : null);
// Two names can reduce to the same key ("Stack!e" and "Stackie", or one name typed twice): the first
// on the roster keeps it and the others add their record id, so every card still opens its own panel
function withSlugs(d) {
  const seen = new Set();
  return {
    ...d,
    clients: d.clients.map((c) => {
      const key = nameKey(c);
      const slug = seen.has(key) ? `${key}-${c.id}` : key;
      seen.add(key);
      return { ...c, slug };
    }),
  };
}
// a card's placeholder letter: the first whole character (an emoji, not half of one), or "?" for no name
const initialOf = (name) => ([...String(name || "").trim()][0] || "?").toUpperCase();
const splitNames = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
// "Presidential (with Jenn Carter, Kyle Richh, TaTa)" -> "Presidential"
const cleanTitle = (song) => String(song || "").replace(/\s*[([](?:with|feat\.?|ft\.?)\s[^)\]]*[)\]]/gi, "").trim();
const primaryArtist = (artist) => splitNames(artist)[0] || "";
const sameName = (a, b) => !!findByName([a], b, (x) => x);

// streaming links are typed in on the dashboard: only ever hand a real web address to an href.
// One pasted without its https:// ("open.spotify.com/artist/…") gets it back; anything else is dropped.
const webLink = (url) => {
  const u = String(url || "").trim();
  if (/^https?:\/\//i.test(u)) return u;
  return /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#]\S*)?$/i.test(u) ? `https://${u}` : null;
};

function creditsOf(publicData) {
  const clients = publicData?.clients || [];
  return (publicData?.notableReleases || [])
    .filter((r) => r.song && r.artist)
    .map((r) => ({
      id: r.id, artist: primaryArtist(r.artist), title: cleanTitle(r.song), cover: r.cover, href: webLink(r.link),
      // the roster producers on it, on the same rule as the release cards' "Prod." chips
      prod: rosterCreditsOn(r, clients).filter((c) => c.prod).map((c) => c.name),
    }));
}
// what a screen reader hears for one credit: "Q&A by Drake, produced by Stack!e"
const creditText = (c) => `${c.title} by ${c.artist}${c.prod.length ? `, produced by ${c.prod.join(" and ")}` : ""}`;

// Spotify serves every cover at 640/300/64px under the same id. The credit strips show it small and
// lift it on hover, so they get the 64px and 300px files. A dashboard upload (data:) is already in the
// page data, so it shows as it is; other hosts get no cover rather than a full-size download.
const coverSet = (url) => /^https:\/\/i\.scdn\.co\/image\/ab67616d0000b273/.test(url || "")
  ? `${url.replace("ab67616d0000b273", "ab67616d00004851")} 64w, ${url.replace("ab67616d0000b273", "ab67616d00001e02")} 300w` : null;

// One placement, credited the way a tracklist would: the cover, the artist, then the song in quotes
// and the roster producer. `sizes` is the cover's size at rest, `lift` its size once it lifts on hover.
function Credit({ c, sizes, lift }) {
  const set = coverSet(c.cover);
  const upload = !set && /^data:image\//i.test(c.cover || "");
  // "Prod. prodbylandn" says prod twice: names that already start with it stand alone
  const prodWord = c.prod.every((n) => /^prod/i.test(n)) ? "" : "Prod. ";
  return (
    <>
      {(set || upload) && (
        <span className="cr-cov">
          {set
            ? <img srcSet={set} sizes={sizes} data-lift={lift} alt="" width="64" height="64" decoding="async" draggable={false} />
            : <img src={c.cover} alt="" width="64" height="64" decoding="async" draggable={false} />}
        </span>
      )}
      <span className="cr-txt">
        <b className="cr-artist"><Glyphs text={c.artist} amp /></b>
        <span className="cr-sub">
          <span className="cr-song">“<Glyphs text={c.title} amp />”</span>
          {c.prod.length > 0 && <span className="cr-prod">{prodWord}<Glyphs text={c.prod.join(" & ")} amp /></span>}
        </span>
      </span>
    </>
  );
}

// The Home band's headline numbers. Written here rather than on the dashboard, so they only change with
// a deploy: every one is checked against its source (in the comment beside it) before it goes in.
const STATS = [
  // Billboard 200 dated May 30, 2026: MAID OF HONOUR debuted at No. 3 (ICEMAN 1, HABIBTI 2); Stack!e is one of
  // the credited producers on "Q&A" (ca.billboard.com chart-beat; Wikipedia, Maid of Honour track listing)
  { num: "#3", label: "Billboard 200", ctx: "Drake “Q&A” · Prod. Stack!e", text: "Number 3 on the Billboard 200: Drake's Maid of Honour, with Q&A produced by Stack!e" },
  // the roster PDF (2026): the producers' stream totals added up
  { num: "150M+", label: "Streams", ctx: "Across the roster", text: "Over 150 million streams across the roster" },
  // Billboard, chart dated June 28, 2025: No. 1 Top Rap Albums and Top R&B/Hip-Hop Albums (No. 3 on the Billboard 200)
  { num: "#1", label: "Top Rap Albums", ctx: "Lil Tecca “Dopamine”", text: "Number 1 on Billboard's Top Rap Albums: Dopamine by Lil Tecca" },
  // the roster PDF (2026): 122 placements across the ten producers listed, before songs two of them share
  { num: "100+", label: "Placements", ctx: "And counting", text: "Over 100 placements and counting" },
];
// One headline number, set like a credit: the figure in chrome, then what it is and where it's from as a two-line caption
function Stat({ s }) {
  return (
    <span className="st">
      <b className="st-num">{s.num}</b>
      <span className="st-cap">
        <span className="st-label"><Glyphs text={s.label} amp /></span>
        <span className="st-ctx"><Glyphs text={s.ctx} amp /></span>
      </span>
    </span>
  );
}

// Emoji (keycaps, flags, pictographs, skin-tone and ZWJ sequences) get a span of their own: inside
// chrome text (a gradient clipped to transparent glyphs) a colour emoji would paint as a blank silver tile
// (built at runtime so a browser without \p{…} support gets plain text instead of a dead page)
const EMOJI_SEQ = (() => {
  try {
    return new RegExp("([#*\\d]\uFE0F?\u20E3|\\p{Regional_Indicator}{2}|(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\uFE0F)\\p{Emoji_Modifier}?(?:\u200D(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\uFE0F?)\\p{Emoji_Modifier}?)*)", "u");
  } catch { return /(?!)/; }
})();
// `amp`: Suntage's "&" reads as an 8 ("Q8A"), so in the credit strips it's set in the body face instead
function Glyphs({ text, amp = false }) {
  const parts = String(text ?? "").split(EMOJI_SEQ);
  const plain = (part, k) => (amp && part.includes("&")
    ? part.split("&").flatMap((bit, j) => (j ? [<span className="amp" key={`${k}-${j}`}>&</span>, bit] : [bit]))
    : part);
  if (parts.length === 1) return plain(parts[0], 0);
  return parts.map((part, k) => (k % 2 ? <span className="emo" key={k}>{part}</span> : plain(part, k)));
}
// the same, for text written straight into the DOM (the decoded panel name)
function glyphNodes(text) {
  return String(text).split(EMOJI_SEQ).map((part, k) => {
    if (!(k % 2)) return part;
    const s = document.createElement("span");
    s.className = "emo";
    s.textContent = part;
    return s;
  });
}

// roster members credited on a release. "Prod." only when the data actually
// supports it: they're a Producer on the roster AND not a listed artist on
// the song — otherwise just their name, never a guessed role.
function rosterCreditsOn(release, clients) {
  return splitNames(release.client).map((name) => {
    const c = findByName(clients, name);
    const onArtist = splitNames(release.artist).some((a) => sameName(a, name));
    return { name, prod: !!c && /producer/i.test(c.role || "") && !onArtist };
  });
}

const isProducer = (c) => /producer/i.test(c.role || "");
const isArtist = (c) => /artist/i.test(c.role || "");

// tiny app-wide toast — fired from anywhere with toast("COPIED"), rendered once by <Toast/>
const toast = (text) => window.dispatchEvent(new CustomEvent("dm-toast", { detail: text }));
function Toast() {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    let t;
    const on = (e) => { setMsg({ text: e.detail, k: Date.now() }); clearTimeout(t); t = setTimeout(() => setMsg(null), 1700); };
    window.addEventListener("dm-toast", on);
    return () => { window.removeEventListener("dm-toast", on); clearTimeout(t); };
  }, []);
  return (
    <div className="toast-wrap" aria-live="polite">
      {msg && <div className="toast" key={msg.k}>{msg.text}</div>}
    </div>
  );
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand("copy"); } catch { /* ignore */ }
    ta.remove();
    return true;
  }
}

const XIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77L17.75 3zm-1.08 16.17h1.7L7.4 4.73H5.58l11.09 14.44z" />
  </svg>
);

/* ------------------------------------------------------------------ */
/*  PUBLIC — motion atoms                                               */
/* ------------------------------------------------------------------ */
// Headline whose words rise out of clipped slots. Plays on mount by default;
// `onView` waits for the shared reveal observer instead (below-the-fold heads).
// Screen readers get the whole sentence from aria-label, not word fragments.
// `breakAfter`: the word that ends the first line on tablets and up, so the line falls on a phrase, not
// wherever the width runs out (phones wrap on their own)
function SplitHead({ text, tag: Tag = "h1", className = "", chrome = false, onView = false, strike, breakAfter, delay = 80 }) {
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
function Marquee({ items, label, className = "", seconds = 48, render }) {
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
function useLitBand(ref, deps) {
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
function useFitLine(ref, text, { min = 10, max = 400 } = {}) {
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
function FitLine({ text, tag: Tag = "span", className, ...opts }) {
  const ref = useRef(null);
  useFitLine(ref, text, opts);
  return <Tag ref={ref} className={className}><Glyphs text={text} /></Tag>;
}

/* ------------------------------------------------------------------ */
/*  PUBLIC NAV + POSTER MENU + FOOTER                                   */
/* ------------------------------------------------------------------ */
function PublicNav({ route, menuOpen, setMenuOpen, session }) {
  const authRoute = session ? (session.role === "staff" ? "staff" : "client") : "login";
  const [scrolled, setScrolled] = useState(false);
  const burgerRef = useRef(null);
  const router = useRouter();
  // with a view transition the menu leaves inside it; otherwise App closes it once the new
  // page is in. A tap on the page you're already on doesn't navigate, so that closes at once.
  const closeMenu = (e) => {
    if (vtWillRun() || e?.currentTarget?.getAttribute("href") === router.asPath) setMenuOpen(false);
  };

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  // the menu is a modal sheet while open: lock the page behind it, Esc closes,
  // and focus goes back to the burger so keyboard users aren't stranded.
  useEffect(() => {
    if (!menuOpen) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      html.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      burgerRef.current?.focus({ preventScroll: true });
    };
  }, [menuOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // the sheet and burger only exist under 900px — rotating an iPad (or
  // widening the window) past that with the menu open must not leave the
  // page scroll-locked behind a menu that's no longer there
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const onChange = (e) => { if (e.matches) setMenuOpen(false); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <header className={`nav2${scrolled ? " scrolled" : ""}${menuOpen ? " menu-open" : ""}`}>
        <TLink
          href={ROUTE_TO_PATH.home}
          vt="page-brand"
          className="nav2-mark"
          onClick={closeMenu}
          aria-label="Defied Management — home"
          style={{ viewTransitionName: route !== "home" ? "brand" : "nav-d" }}
        >
          <img src="/brand/d.png" alt="" width="45" height="36" draggable={false} />
          <span className="nav2-mark-shine" aria-hidden="true" />
        </TLink>
        <nav className="nav2-links" aria-label="Main">
          {PUBLIC_LINKS.map(([r, label]) => (
            <TLink key={r} href={ROUTE_TO_PATH[r]} className={route === r ? "active" : ""} aria-current={route === r ? "page" : undefined}>
              {label}
              {route === r && <i className="nav2-ind" style={{ viewTransitionName: "nav-ind" }} aria-hidden="true" />}
            </TLink>
          ))}
          <TLink href={ROUTE_TO_PATH[authRoute]} className="nav2-auth" {...(route === authRoute ? { "aria-current": "page" } : {})}>{session ? "Dashboard" : "Sign in"}</TLink>
        </nav>
        <button
          ref={burgerRef}
          className={`burger${menuOpen ? " x" : ""}`}
          onClick={() => setMenuOpen((m) => !m)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="poster-menu"
        >
          <i /><i />
        </button>
      </header>

      <div
        id="poster-menu"
        className={`pm${menuOpen ? " open" : ""}`}
        role="dialog"
        aria-label="Menu"
        aria-hidden={!menuOpen}
        {...(!menuOpen ? { inert: "" } : {})}
      >
        <img className="pm-d" src="/brand/d.png" alt="" aria-hidden="true" draggable={false} />
        <ol className="pm-list">
          {PUBLIC_LINKS.map(([r, label], i) => (
            <li className="pm-line" key={r} style={{ "--i": i }}>
              <TLink href={ROUTE_TO_PATH[r]} onClick={closeMenu} aria-current={route === r ? "page" : undefined} className={route === r ? "on" : ""}>
                <span className="pm-idx" aria-hidden="true">0{i + 1}</span>
                <span className="pm-word">{label}</span>
              </TLink>
            </li>
          ))}
        </ol>
        <div className="pm-foot">
          <TLink href={ROUTE_TO_PATH[authRoute]} onClick={closeMenu} className="pill pill-ghost" {...(route === authRoute ? { "aria-current": "page" } : {})}>{session ? "Dashboard" : "Sign in"}</TLink>
          <div className="pm-social">
            <ExtLink href="https://instagram.com/defiedmgmt" label="Instagram" className="hit"><Instagram size={20} /></ExtLink>
            <ExtLink href="https://x.com/defiedmgmt" label="X" className="hit"><XIcon size={18} /></ExtLink>
          </div>
        </div>
      </div>
    </>
  );
}

function Footer({ route, inert }) {
  // One quiet sign-off, the same on every page: the D (home), the copyright, Contact and the socials.
  // It mirrors the nav bar — mark on the left, links on the right — so the page opens and closes on
  // one line. (Signing in stays in the nav.)
  return (
    <footer className="foot2" {...(inert ? { inert: "" } : {})}>
      <div className="ft">
        <TLink href={ROUTE_TO_PATH.home} className="ft-mark" aria-label="Defied Management — home">
          <img src="/brand/d.png" alt="" width="45" height="36" loading="lazy" decoding="async" draggable={false} />
          <span className="ft-mark-shine" aria-hidden="true" />
        </TLink>
        <p className="ft-copy">© {new Date().getFullYear()} Defied Management</p>
        <nav className="ft-links" aria-label="Footer">
          <TLink href={ROUTE_TO_PATH.contact} {...(route === "contact" ? { "aria-current": "page" } : {})}>Contact</TLink>
        </nav>
        <div className="ft-social">
          <ExtLink href="https://instagram.com/defiedmgmt" className="ft-soc" label="Instagram, @defiedmgmt"><Instagram size={17} /></ExtLink>
          <ExtLink href="https://x.com/defiedmgmt" className="ft-soc" label="X, @defiedmgmt"><XIcon size={15} /></ExtLink>
        </div>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/*  HOME — chrome ignition                                              */
/* ------------------------------------------------------------------ */
function Home() {
  const heroRef = useRef(null);
  const wmRef = useRef(null);
  // the full light-scan intro plays once per visit; coming back to Home in
  // the same session shows the wordmark straight away (just the shine)
  const [seen] = useState(() => { try { return sessionStorage.getItem("dm-ignited") === "1"; } catch { return false; } });
  // mounted inside a view transition's update (data-vt is set for its whole lifetime)
  const [viaVT] = useState(() => !!document.documentElement.dataset.vt);
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
function ReleaseCard({ r, clients, compact = false, featured = false }) {
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

function About({ publicData }) {
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
class PageGuard extends React.Component {
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
const DATA_ROUTES = ["about", "team", "roster"];
// first visit, and the site data couldn't load: an honest page with a way to try again, not an empty one
function PageOutage() {
  return (
    <main className="pg pg-outage">
      <p className="pg-outage-msg">This page couldn't load right now.</p>
      <button type="button" className="pill pill-ghost" onClick={() => window.location.reload()}>Try again</button>
    </main>
  );
}

function PageLoading() {
  return <div className="pg-loading" role="status" aria-label="Loading"><span /><span /><span /></div>;
}

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

function TeamPage({ publicData }) {
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
function ChipGroup({ name, label, options, value, onChange, className = "" }) {
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

function Roster({ publicData }) {
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

  const urlSlug = router.isReady ? router.query.artist : undefined;
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

function ArtistPanel({ artist, publicData, list, onClose, onStep, focusOn, onFocused, morph }) {
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

/* ------------------------------------------------------------------ */
/*  CONTACT                                                             */
/* ------------------------------------------------------------------ */
const CONTACT_SUBJECTS = ["General Inquiry", "Artist Management", "Booking", "Publishing / Admin", "Sync Licensing", "Press / Media", "Other"];

function Contact({ publicData }) {
  const router = useRouter();
  const blank = { name: "", email: "", instagram: "", subject: "General Inquiry", message: "" };
  const [f, setF] = useState(blank);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [website, setWebsite] = useState(""); // honeypot — real visitors never see or fill this in
  const loadedAt = useRef(Date.now());
  const cardRef = useRef(null);
  const sentHead = useRef(null);
  const submitRef = useRef(null);
  useEffect(() => { if (sent) sentHead.current?.focus({ preventScroll: true }); }, [sent]);
  // the submit button is disabled while sending, which drops keyboard focus to <body>: give it back
  useEffect(() => { if (err && document.activeElement === document.body) submitRef.current?.focus(); }, [err]);

  // arriving from an artist's "Work with …" button: preselect Booking and
  // start the message with who it's about
  useEffect(() => {
    if (!router.isReady || !publicData) return;
    const slug = router.query.artist;
    const c = bySlug(publicData.clients || [], slug);
    if (c) setF((cur) => (cur.message ? cur : { ...cur, subject: "Booking", message: `Re: ${c.name} — ` }));
  }, [router.isReady, publicData]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault();
    if (!f.name || !f.email || !f.instagram || !f.message) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/submit-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
        body: JSON.stringify({ ...f, website, loadedAt: loadedAt.current }),
      });
      // an HTML error page (a gateway timeout) has no JSON to read: that's a failure, never a success
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(data?.error || "Couldn't send that — try again.");
      // busy stays on until the swap, so the morph starts from "Sending…", never a flash of "Send message"
      withViewTransition("sent", () => {
        flushSync(() => { setSent(true); setF(blank); setBusy(false); });
        // the card just got ~500px shorter — bring it (and the check drawing in) to the middle of the screen
        jumpIntoView(cardRef.current);
      });
    } catch (e2) {
      // a dropped connection rejects fetch with a TypeError ("Failed to fetch") — not a sentence for visitors
      setErr(e2 instanceof TypeError ? "Couldn't reach the server. Check your connection and try again." : e2.message || "Couldn't send that — try again.");
      setBusy(false);
    }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const copyMail = async () => { await copyText("submissions@defiedmgmt.com"); toast("Copied · submissions@defiedmgmt.com"); };
  const another = () => withViewTransition("sent", () => {
    flushSync(() => setSent(false));
    document.querySelector(".ct-form input[name=name]")?.focus({ preventScroll: true });
  });

  return (
    <main className="pg ct">
      <SplitHead text="LET'S WORK." chrome className="pg-head" />
      <p className="ct-lead">Interested in working with us or have any questions? Please fill out this form and we'll get back to you as soon as possible.</p>
      {/* always mounted, so the confirmation is announced when its text arrives */}
      <p className="sr-only" role="status">{sent ? "Message sent. We'll get back to you as soon as possible." : ""}</p>
      <div className="ct-card" ref={cardRef}>
        {sent ? (
          <div className="ct-sent">
            <svg className="ct-check" viewBox="0 0 48 48" aria-hidden="true">
              <circle cx="24" cy="24" r="22" pathLength="1" />
              <path d="M14.5 24.5l6.5 6.5 13-14" pathLength="1" />
            </svg>
            <h2 ref={sentHead} tabIndex={-1}>Message sent</h2>
            <p>We'll get back to you as soon as possible.</p>
            <button className="pill pill-ghost" onClick={another}>Send another</button>
          </div>
        ) : (
          <form className="ct-form" onSubmit={submit} aria-busy={busy}>
            {/* honeypot — hidden from real visitors via CSS, not type="hidden"
                (bots specifically skip type=hidden fields, but not off-screen ones) */}
            <input
              type="text" name="website" value={website} onChange={(e) => setWebsite(e.target.value)}
              autoComplete="off" tabIndex={-1} aria-hidden="true"
              style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
            />
            <div className="ct-row">
              <label className="ct-fld"><span>Name</span><input name="name" autoComplete="name" required value={f.name} onChange={set("name")} /></label>
              <label className="ct-fld"><span>Email</span><input name="email" type="text" inputMode="email" autoComplete="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} required pattern="\s*[^@\s]+@[^@\s]+\.[^@\s]+\s*" title="An email address, like name@example.com" value={f.email} onChange={set("email")} /></label>
            </div>
            <label className="ct-fld"><span>Instagram</span><input name="instagram" placeholder="@yourhandle" autoCapitalize="off" autoCorrect="off" spellCheck={false} required value={f.instagram} onChange={set("instagram")} /></label>
            <div className="ct-fld">
              <span id="ct-subject">Subject</span>
              <ChipGroup name="subject" label="Subject" options={CONTACT_SUBJECTS.map((s) => ({ value: s, label: s }))} value={f.subject} onChange={(v) => setF((cur) => ({ ...cur, subject: v }))} className="ct-chips" />
            </div>
            <label className="ct-fld"><span>Message</span><textarea name="message" rows={5} required value={f.message} onChange={set("message")} /></label>
            {err && <p className="ct-err" role="alert">{err} You can also email submissions@defiedmgmt.com.</p>}
            <button ref={submitRef} className="pill pill-solid pill-full" type="submit" disabled={busy}>
              {busy ? <><RefreshCw size={15} className="spin" /> Sending…</> : "Send message"}
            </button>
          </form>
        )}
      </div>
      <p className="ct-direct">
        <span className="ct-direct-label">Or reach out directly</span>
        {/* the address and its copy button never wrap apart */}
        <span className="ct-mail">
          <a className="inline-link" href="mailto:submissions@defiedmgmt.com">submissions@defiedmgmt.com</a>
          <button className="ct-copy" onClick={copyMail} aria-label="Copy email address" title="Copy email address"><Copy size={14} /></button>
        </span>
        <span className="ct-dot" aria-hidden="true">·</span>
        <ExtLink className="inline-link" href="https://instagram.com/defiedmgmt">@defiedmgmt</ExtLink>
      </p>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/*  LOGIN                                                               */
/* ------------------------------------------------------------------ */
// The way into the dashboard and the client portal, built from the public pages' own parts: the chrome
// heading and the contact form's fields and pill.
function Login({ login, notice }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submitRef = useRef(null);
  // the submit button is disabled while signing in, which drops keyboard focus to <body>: give it back
  useEffect(() => { if (err && document.activeElement === document.body) submitRef.current?.focus(); }, [err]);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    let msg;
    try { msg = await login(email, password); }
    catch { msg = "Couldn't reach the server. Check your connection and try again."; }
    // signed in: it stays on "Signing in…" until the dashboard takes over
    if (msg) { setBusy(false); setErr(msg); }
  };
  return (
    <main className="pg lg">
      <p className="micro-label lg-label">Staff and client portal</p>
      <SplitHead text="SIGN IN." chrome className="pg-head lg-head" />
      <form className="lg-form" onSubmit={submit} aria-busy={busy}>
        <label className="ct-fld">
          <span>Email</span>
          {/* text, not type=email: accounts are made with a plain text field, so a stored login that
              isn't a strict address must still get through (the live form was plain text too) */}
          <input name="email" type="text" inputMode="email" autoComplete="username" autoCapitalize="off" autoCorrect="off" spellCheck={false} required aria-invalid={err ? true : undefined} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {/* a div, not a wrapping label: the label's text would otherwise take in "Show" as part of the field's name */}
        <div className="ct-fld">
          <label htmlFor="lg-password">Password</label>
          <div className="lg-pw">
            <input id="lg-password" name="password" type={showPw ? "text" : "password"} autoComplete="current-password" required aria-invalid={err ? true : undefined} value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="lg-show" onClick={() => setShowPw((v) => !v)} aria-controls="lg-password" aria-label={showPw ? "Hide password" : "Show password"}>{showPw ? "Hide" : "Show"}</button>
          </div>
        </div>
        {(err || notice) && <p className="ct-err" role="alert">{err || notice}</p>}
        <button ref={submitRef} className="pill pill-solid pill-full" type="submit" disabled={busy}>
          {busy ? <><RefreshCw size={15} className="spin" /> Signing in…</> : "Sign in"}
        </button>
      </form>
      <p className="lg-help">Trouble signing in? <TLink href={ROUTE_TO_PATH.contact} className="inline-link">Contact us</TLink></p>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/*  STAFF DASHBOARD                                                     */
/* ------------------------------------------------------------------ */
/* dashboard saves (see App's commit) ---------------------------------- */
// what each role can write. POST /api/dashboard-data replaces every table it's sent (rows
// reinserted in array order; clients take roster_order from it), so each one goes out whole
const SAVE_TABLES = { staff: ["clients", "placements", "staff", "users", "submissions", "notableReleases"], client: ["placements"] };
const sameValue = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
// b's top-level fields that differ from a's (one b dropped comes back undefined), or null
function changedFields(a = {}, b = {}) {
  const out = {};
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) if (!sameValue(a?.[k], b?.[k])) out[k] = b?.[k];
  return Object.keys(out).length ? out : null;
}
// one edit to a table: ids deleted, rows added, fields changed per id, the new id order, and
// whether the rows on both sides were reordered
function diffRows(base = [], next = []) {
  if (base === next) return null;
  const was = new Map(base.map((r) => [r.id, r]));
  const ids = next.map((r) => r.id);
  const now = new Set(ids);
  const deleted = base.filter((r) => !now.has(r.id)).map((r) => r.id);
  const added = next.filter((r) => !was.has(r.id));
  const changed = {};
  for (const r of next) {
    const f = was.has(r.id) && was.get(r.id) !== r && changedFields(was.get(r.id), r);
    if (f) changed[r.id] = f;
  }
  const reordered = !sameValue(base.map((r) => r.id).filter((id) => now.has(id)), ids.filter((id) => was.has(id)));
  return deleted.length || added.length || Object.keys(changed).length || reordered ? { deleted, added, changed, ids, reordered } : null;
}
// null when next changes nothing
function diffDb(base, next) {
  const patch = {};
  for (const k of SAVE_TABLES[next.role] || []) { const d = diffRows(base[k], next[k]); if (d) patch[k] = d; }
  if (next.role === "staff") for (const k of ["site", "sheetSync"]) { const f = changedFields(base[k], next[k]); if (f) patch[k] = f; }
  return Object.keys(patch).length ? patch : null;
}
// puts each id of seq that isNew into order (a list of ids), in before the next id of seq already
// there — so at the end, for the usual append
const placeNew = (order, seq, isNew) => seq.forEach((id, i) => {
  if (!isNew(id)) return;
  const before = seq.slice(i + 1).find((x) => order.includes(x));
  order.splice(before === undefined ? order.length : order.indexOf(before), 0, id);
});
// one edit's table diff onto the server's latest rows: a row deleted elsewhere isn't brought back,
// a row added elsewhere stays (ahead of this edit's own new rows), and the edit's order wins only
// if it reordered
function applyRows(fresh = [], d) {
  const rows = new Map(fresh.map((r) => [r.id, r]));
  for (const id of d.deleted) rows.delete(id);
  for (const [id, f] of Object.entries(d.changed)) if (rows.has(id)) rows.set(id, { ...rows.get(id), ...f });
  const added = new Set();
  for (const r of d.added) { if (!rows.has(r.id)) added.add(r.id); rows.set(r.id, { ...rows.get(r.id), ...r }); }
  const known = new Set(d.ids);
  const order = (d.reordered ? d.ids : fresh.map((r) => r.id)).filter((id) => known.has(id) && rows.has(id) && !added.has(id));
  placeNew(order, fresh.map((r) => r.id), (id) => rows.has(id) && !known.has(id));
  placeNew(order, d.ids, (id) => added.has(id));
  return order.map((id) => rows.get(id));
}
// these GETs have no ORDER BY, so they come back in whatever order Postgres stored the last
// rewrite; a tab keeps the order it loaded them in (what it shows, and writes back), as saves
// always have. Clients come back in roster order and submissions newest first.
const UNORDERED = ["placements", "staff", "users", "notableReleases"];
function inTabOrder(fresh, tab) {
  const out = { ...fresh };
  for (const k of UNORDERED) {
    if (!Array.isArray(fresh[k]) || !Array.isArray(tab?.[k])) continue;
    const byId = new Map(fresh[k].map((r) => [r.id, r]));
    const order = tab[k].map((r) => r.id).filter((id) => byId.has(id));
    const had = new Set(order);
    placeNew(order, fresh[k].map((r) => r.id), (id) => !had.has(id));
    out[k] = order.map((id) => byId.get(id));
  }
  return out;
}
function applyPatch(fresh, patch) {
  const out = { ...fresh };
  for (const k of SAVE_TABLES[fresh.role] || []) if (patch[k]) out[k] = applyRows(fresh[k], patch[k]);
  for (const k of ["site", "sheetSync"]) if (patch[k]) out[k] = { ...fresh[k], ...patch[k] };
  // deleting a client takes along a song or login someone added for them since, as the server's
  // own cascade would — sent back, it would fail the whole save on the missing client
  const gone = new Set(patch.clients?.deleted);
  if (gone.size) for (const k of ["placements", "users"]) if (out[k].some((r) => gone.has(r.clientId))) out[k] = out[k].filter((r) => !gone.has(r.clientId));
  return out;
}
// what a save sends: the tables it changed, plus any applyPatch rewrote for it (a login dropped with its client)
const saveKeys = (patch, fresh, merged) => [...(SAVE_TABLES[fresh.role] || []), "site", "sheetSync"].filter((k) => patch[k] || merged[k] !== fresh[k]);
const TOO_BIG = "That's too much to save — the photos and covers are over the size limit. Remove or shrink some images and try again.";
// a client can't shrink the photos and covers that fill the data, only the Defied team can
const TOO_BIG_CLIENT = "Your change couldn't be saved right now — please let the Defied team know.";
const SAVE_OFFLINE = "Couldn't reach the server, so that change wasn't saved — check your connection and try again.";
// the banner finishes this sentence with a "sign in again." link
const SIGNED_OUT = "You've been signed out, so that change wasn't saved. Copy anything you need first, then";
const ACCOUNT_CHANGED = "Your account was changed — reload the page.";
// what the banner says about a failed request: the server's own reason when it gave one
const saveFailure = (res, data, fallback, role) => (!res ? SAVE_OFFLINE : res.status === 401 ? SIGNED_OUT
  : data?.error || (res.status === 413 ? (role === "client" ? TOO_BIG_CLIENT : TOO_BIG) : fallback));
const holdUnload = (e) => { e.preventDefault(); e.returnValue = ""; }; // "leave the page?" while a save is unsent
// the dashboard loads everything in one reply (photos and covers included), and Vercel won't send one over 4.5 MB
const MAX_DATA = 3500000;
// weighed the way the server weighs it: UTF-8 bytes, and no typed passwords (those are never stored or sent back)
const dataBytes = (d) => new TextEncoder().encode(JSON.stringify(withoutPasswords(d))).length;
// a save that can't go onto the server's copy as it is now: why, or null. A save that shrinks the data always goes,
// so there's a way back under the limit
function refusal(patch, fresh, merged) {
  // a song or login this save adds (or moves) for a client deleted elsewhere: the server would refuse the
  // whole save on the missing client (fresh itself can't hold one: its rows went with their client)
  const live = merged.clients && new Set(merged.clients.map((c) => c.id));
  if (live && ["placements", "users"].some((k) => patch[k] && merged[k].some((r) => r.clientId && !live.has(r.clientId)))) return goneText("client");
  if (patch.notableReleases?.added.length && merged.notableReleases.length > 10) return "There are already 10 notable releases (someone else added one) — remove one first.";
  const size = dataBytes(merged);
  return size > MAX_DATA && size > dataBytes(fresh) ? (fresh.role === "client" ? TOO_BIG_CLIENT : TOO_BIG) : null;
}
// a demoted or re-linked account: what this tab edits no longer fits what the server would take
const accountChanged = (fresh, known) => fresh.role !== known.role || fresh.client?.id !== known.client?.id;
// an edit of a row someone else deleted meanwhile saves nothing: the form says so
const goneText = (thing) => `That ${thing} was deleted somewhere else, so this change wasn't saved.`;
async function saveRow(commit, next, key, id, thing) {
  const saved = await commit(next);
  return saved && id && !saved[key].some((r) => r.id === id) ? goneText(thing) : saved;
}
// a typed password goes out only with the save it was typed for: re-sent later, it would undo
// one the user has since chosen themselves
const withoutPasswords = (d) => (d?.users?.some((u) => "password" in u) ? { ...d, users: d.users.map(({ password, ...u }) => u) } : d);

const DASH_TABS = ["home", "catalog", "ar", "luminate", "website", "users", "subs"];
function StaffDashboard({ db, commit, reloadDb, logout, signingOut }) {
  // sub = where a Dashboard task or gainer points inside the tab it opens ("advance", "client:<id>",
  // "roster"): read once as the tab mounts, so the sidebar always opens a tab on its usual start
  // The address bar carries {tab, sub} (/dashboard?tab=catalog&sub=splits), so the browser's Back and
  // Forward step through sections instead of leaving the dashboard, and a reload stays where it was
  const router = useRouter();
  const fromQuery = (q) => {
    const t = DASH_TABS.includes(q?.tab) ? q.tab : "home";
    return { tab: t, sub: t !== "home" && typeof q?.sub === "string" && q.sub ? q.sub : null };
  };
  const [{ tab, sub }, setAt] = useState(() => fromQuery(router.query));
  const toUrl = (t, s, how = "push") => {
    const query = t === "home" && !s ? {} : { tab: t, ...(s ? { sub: s } : {}) };
    const next = new URLSearchParams(query).toString();
    if (next === new URLSearchParams(window.location.search).toString()) return; // the same place: no extra Back step
    router[how]({ pathname: "/dashboard", query }, undefined, { shallow: true, scroll: false });
  };
  const setTab = (t) => { setAt({ tab: t, sub: null }); toUrl(t, null); };
  const go = (t, s = null) => { setAt({ tab: t, sub: s }); toUrl(t, s); window.scrollTo(0, 0); };
  // a page's own pickers (Publishing's client, Website's tab) update the address in place: one Back
  // step per section, not one per chip
  const setSub = (s) => { setAt((cur) => (cur.sub === s ? cur : { ...cur, sub: s })); toUrl(tab, s, "replace"); };
  // Back / Forward (and a reload): the address says where to be
  useEffect(() => {
    if (!router.isReady) return;
    const at = fromQuery(router.query);
    setAt((cur) => (cur.tab === at.tab && cur.sub === at.sub ? cur : at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.query.tab, router.query.sub]);
  const unreadCount = db.submissions.filter((s) => !s.read).length;
  // the Luminate page's data (portfolios, ISRCs, songs to link): loaded first, then again whenever the
  // Dashboard opens (its tasks) and after anything that changes it (Luminate's actions, Publishing's
  // "Refresh numbers"). lumErr = it couldn't load, so the cards say so instead of spinning.
  const [lum, setLum] = useState(null);
  const [lumErr, setLumErr] = useState(false);
  const reloadLum = () => {
    setLumErr(false);
    return fetch("/api/luminate", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.portfolios) setLum(d); else setLumErr(true); }).catch(() => setLumErr(true));
  };
  useEffect(() => {
    if (tab === "home" || !lum) reloadLum();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  const lumCount = useMemo(() => {
    if (!lum) return 0;
    return lumGroups(db, lum).filter((g) => g.status === "toAdd" || g.status === "unplaced" || g.status === "missing").length + lum.unlinked.length + (lum.notOursLeft?.length || 0);
  }, [db, lum]);
  // db.sheetSync lives in this browser's localStorage, not on a server — a
  // device whose local copy is stale (never synced, or synced a while ago,
  // including before some bug fix here) would otherwise sit stale until
  // someone remembers to press a button. There's exactly one manual sync
  // action (Publishing's "Refresh numbers") — this silently keeps every
  // other view current in the background instead, whenever the Dashboard or
  // Publishing opens on a stale copy. One run at a time: a quick hop from
  // one to the other doesn't start a second.
  const syncing = useRef(false);
  useEffect(() => {
    if ((tab !== "home" && tab !== "catalog") || syncing.current || !isSheetSyncStale(db)) return;
    syncing.current = true;
    fullSiteSync(db, commit).catch((err) => console.error("Background sync failed:", err)).finally(() => { syncing.current = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  // A&R's badge (follow-ups due + people and songs to add to its Luminate lists) and the Dashboard's
  // A&R task, from one fetch here
  const arSum = useArSummary(tab);
  const toLum = arSum?.toLuminate || null;
  const pubCount = useMemo(() => dashTasks(db, lum).filter((t) => t.area === "roster").length, [db, lum]);
  // each tab's area colours its active icon and its badge (Dashboard, Users and Messages stay white)
  const tabs = [
    ["home", "Dashboard", LayoutDashboard], ["catalog", "Publishing", ListMusic, pubCount, "roster"],
    ["ar", "A&R", Handshake, (arSum?.followUpsDue || 0) + (toLum?.count || 0), "ar"], ["luminate", "Luminate", Radar, lumCount, "luminate"],
    ["website", "Website", Pencil, 0, "site"],
    ["users", "Users", UserCog], ["subs", "Messages", Inbox, unreadCount],
  ];
  return (
    <div className="dash">
      <aside className="dash-side">
        <div className="dash-brand"><Link href={ROUTE_TO_PATH.home} className="logo-link"><Wordmark height={26} /></Link></div>
        <nav>
          {tabs.map(([id, label, Icon, badge, area]) => (
            <button key={id} className={tab === id ? "active" : ""} data-area={area} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
              <Icon size={17} /> <span className="nav-label">{label}</span>
              {!!badge && <span className="nav-badge">{badge}</span>}
            </button>
          ))}
        </nav>
        <div className="dash-side-foot">
          <div className="dash-role">Staff — full edit access</div>
          <button className="dash-out" onClick={logout} disabled={signingOut}>{signingOut ? <><RefreshCw size={16} className="spin" /> Signing out…</> : <><LogOut size={16} /> Sign out</>}</button>
        </div>
      </aside>
      <main className="dash-main">
        {tab === "home" && <HomeDashboard db={db} lum={lum} lumErr={lumErr} reloadLum={reloadLum} onGo={go} toLum={toLum} arTop={arSum?.top} arLoaded={!!arSum} />}
        {tab === "website" && <WebsiteAdmin db={db} commit={commit} sub={sub} onSub={setSub} />}
        {tab === "catalog" && <CatalogAdmin db={db} commit={commit} lum={lum} reloadLum={reloadLum} sub={sub} onGo={go} onSub={setSub} />}
        {tab === "luminate" && <LuminateAdmin db={db} commit={commit} lum={lum} lumErr={lumErr} reloadLum={reloadLum} reloadDb={reloadDb} sub={sub} toLum={toLum} onGo={go} />}
        {tab === "ar" && <ARAdmin onGo={go} sub={sub} />}
        {tab === "users" && <UsersAdmin db={db} commit={commit} />}
        {tab === "subs" && <SubsAdmin db={db} commit={commit} />}
      </main>
    </div>
  );
}

/* generic editable list ------------------------------------------------ */
function Editor({ title, items, columns, blank, onSave, onDelete, extra, maxItems, onReorder, confirmDelete, openId = null }) {
  const [editing, setEditing] = useState(null); // object or null
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState(null);
  const [delAsk, setDelAsk] = useState(null); // the row its Delete asks about
  const [listErr, setListErr] = useState(null); // a Delete that was refused ("There has to be at least one staff account.")
  const from = useRef(null); // the row as it was when the form opened
  useEscape(() => setEditing(null), !!editing && !saving); // as Cancel: a save in flight finishes into its own form
  useEffect(() => {
    if (!editing) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [editing]);
  const start = (obj) => { from.current = obj; setFormErr(null); setEditing(obj ? { ...obj } : { id: null, ...blank }); };
  // a link to one row (To do's "Set X's sheet tab") opens its form
  useEffect(() => { const it = openId && items.find((x) => x.id === openId); if (it) start(it); }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps
  // only what was changed in the form goes onto the row as it is now, so a change that landed while
  // it was open (another tab's save, the Clients-tab sync) isn't put back. A failed save stays open:
  // onSave gives false (the banner says why) or a message for the form.
  const save = async () => {
    const cur = editing.id && items.find((it) => it.id === editing.id);
    setSaving(true); setFormErr(null);
    try {
      const ok = await onSave(cur && from.current ? { ...cur, ...changedFields(from.current, editing) } : editing);
      if (typeof ok === "string") setFormErr(ok);
      else if (ok !== false) setEditing(null);
    } finally { setSaving(false); }
  };
  const remove = (it) => { setListErr(null); setDelAsk(it); };
  // confirmDelete(row) can give its own {title, body, typeName, goLabel}
  const ask = delAsk && { title: `Delete "${delAsk.name || delAsk.song || delAsk.email || "this entry"}"?`, body: "This can't be undone.", goLabel: "Delete", ...(confirmDelete ? confirmDelete(delAsk) : {}) };
  const gridCols = { "--cols": columns.map((c) => c.w || "1fr").join(" ") + (onReorder ? " 128px" : " 72px") };
  const atMax = !!maxItems && items.length >= maxItems;
  // reorder rows carry 4 action buttons (up/down/edit/delete) instead of 2,
  // so they need their own, wider mobile column — see .admin-row-reorder.
  const rowCls = "admin-row" + (onReorder ? " admin-row-reorder" : "");
  return (
    <div>
      <div className="admin-head">
        <h2>{title}{maxItems ? ` — ${items.length}/${maxItems}` : ""}</h2>
        <button className="btn sm" onClick={() => start(null)} disabled={atMax} title={atMax ? `Remove one to add another (max ${maxItems})` : undefined}><Plus size={15} /> Add</button>
      </div>
      {listErr && <p className="hint err-text mb" role="alert">{listErr}</p>}
      {ask && (
        <AskCard title={ask.title} goLabel={ask.goLabel} busyLabel="Deleting…" typeName={ask.typeName} onClose={() => setDelAsk(null)}
          go={async () => { const r = await onDelete(delAsk.id); setDelAsk(null); setListErr(typeof r === "string" ? r : null); }}>
          <p>{ask.body}</p>
        </AskCard>
      )}
      <div className="admin-table">
        <div className={`${rowCls} admin-hd`} style={gridCols}>
          {columns.map((c) => <span key={c.key}>{c.label}</span>)}
          <span className="admin-act">Actions</span>
        </div>
        {items.length === 0 && <div className="admin-empty">Nothing here yet. Click “Add”.</div>}
        {items.map((it, i) => (
          <div className={rowCls} key={it.id} style={gridCols}>
            {columns.map((c) => <span key={c.key} className="cell">{c.render ? c.render(it) : (it[c.key] || "—")}</span>)}
            <span className="admin-act">
              {onReorder && (
                <>
                  <button onClick={() => onReorder(it.id, -1)} disabled={i === 0} title="Move up"><ChevronUp size={14} /></button>
                  <button onClick={() => onReorder(it.id, 1)} disabled={i === items.length - 1} title="Move down"><ChevronDown size={14} /></button>
                </>
              )}
              <button onClick={() => start(it)} aria-label={`Edit ${it.name || it.song || it.email || "entry"}`}><Pencil size={14} /></button>
              <button onClick={() => remove(it)} aria-label={`Delete ${it.name || it.song || it.email || "entry"}`}><Trash2 size={14} /></button>
            </span>
          </div>
        ))}
      </div>

      {editing && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setEditing(null)}>
          <div className="modal-card">
            <div className="modal-head">
              <h3>{editing.id ? "Edit" : "New"} {title.replace(/s$/, "")}</h3>
              <button onClick={() => setEditing(null)} aria-label="Close"><X size={18} /></button>
            </div>
            <div className="modal-body">{extra(editing, setEditing)}</div>
            {formErr && <p className="hint err-text modal-save-warn" role="alert">{formErr}</p>}
            <div className="modal-foot">
              <button className="btn ghost sm" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Shared by ClientsAdmin (Website -> Roster) and CatalogAdmin (Clients tab) —
// deleting a client removes them and every one of their songs locally, then
// clears each song's row off the pub sheet (only this client's own row —
// never a co-writer's) and finally releases the client's own tab back into
// the generic WRITER pool. Returns a warning string on partial failure, or
// null if everything cleared cleanly.
// the client header's More ▾: Delete client lives here, away from the chips you click all day
function ClientMore({ onDelete }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEscape(() => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    const off = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);
  return (
    <div className="client-more" ref={box}>
      <button className="btn ghost sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>More <ChevronDown size={14} /></button>
      {open && (
        <div className="client-more-menu" role="menu">
          <button role="menuitem" data-del-client onClick={() => { setOpen(false); onDelete(); }}><Trash2 size={14} /> Delete client</button>
        </div>
      )}
    </div>
  );
}
// Delete client: what goes with them, and their name typed to confirm (both Publishing and Website › Roster)
function clientDeleteAsk(db, c) {
  const n = db.placements.filter((p) => p.clientId === c.id).length;
  const hasLogin = db.users.some((u) => u.clientId === c.id);
  const tab = c.sheetTabName?.trim() || c.name;
  return {
    title: `Delete ${c.name}?`, goLabel: "Delete client", typeName: c.name,
    body: `${n ? `Deletes ${c.name}'s ${n} song${n === 1 ? "" : "s"} and clears their rows on the ${tab} tab.` : `${c.name} has no songs.`}${c.onRoster ? " Takes them off the public roster." : ""}${hasLogin ? " Removes their login." : ""} This can't be undone. Type ${c.name} to confirm.`,
  };
}
async function deleteClientCascade(db, commit, id) {
  const client = db.clients.find((c) => c.id === id);
  const clientPlacements = db.placements.filter((p) => p.clientId === id);
  // a login account left pointing at a deleted client is a real login that
  // just 404s on their own data forever instead of being cleaned up — same
  // class of gap as data the UI hides but the API still allows; remove it
  // here instead of leaving stale valid credentials with nothing behind them.
  const saved = await commit({
    ...db,
    clients: db.clients.filter((c) => c.id !== id),
    placements: db.placements.filter((p) => p.clientId !== id),
    users: db.users.filter((u) => u.clientId !== id),
  }, db);
  // still on the site: their sheet rows and tab must stay too (the banner says why it failed)
  if (!saved) return null;

  const results = await Promise.allSettled(
    clientPlacements
      .filter((p) => ownSplit(p, client))
      .map(async (p) => {
        const splits = [{ name: client?.sheetTabName || client?.name }];
        const res = await fetch("/api/sheets-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
          body: JSON.stringify({ placementId: p.id, splits }),
        });
        if (!res.ok) throw new Error(p.song);
      })
  );
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed) {
    return `Deleted locally, but ${failed} of ${clientPlacements.length} song row${clientPlacements.length === 1 ? "" : "s"} couldn't be cleared from the pub sheet. Check it manually if needed.`;
  }

  try {
    const tabName = client?.sheetTabName || client?.name;
    if (tabName) {
      const res = await fetch("/api/sheets-release-tab", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
        body: JSON.stringify({ tabName }),
      });
      if (!res.ok) throw new Error();
    }
  } catch {
    return `Deleted and cleared their songs, but couldn't reset their tab on the pub sheet. It'll just sit empty under their old name — harmless, but you can rename it back to a WRITER slot by hand if you'd like.`;
  }
  return null;
}

// another client already going by `value` as their name or sheet tab: the two would share one tab on
// the pub sheet (or one would never find theirs). By personKey, so Stackie is Stack!e's but Stacke is free
const NAME_TAKEN = "Another client already uses that name or sheet tab.";
const nameTaken = (clients, id, value) => !!String(value || "").trim()
  && clients.some((o) => o.id !== id && [o.name, o.sheetTabName].some((s) => String(s || "").trim() && sameName(s, value)));

function ClientsAdmin({ db, commit, openId = null }) {
  const cols = [
    { key: "name", label: "Name", render: (c) => <span className="cell-name"><Avatar src={c.photo} name={c.name} size={30} />{c.name}</span> },
    { key: "role", label: "Role" }, { key: "credit", label: "Credit" },
    { key: "onRoster", label: "Public", render: (c) => c.onRoster !== false ? <span className="badge-yes"><Check size={12} /> Live</span> : <span className="badge-no">Hidden</span> },
  ];
  const [deleteWarn, setDeleteWarn] = useState(null);
  // only a name/tab being changed is checked, so an older pair that already clashes still saves other edits
  const taken = (e, key) => (e[key] || "") !== (db.clients.find((c) => c.id === e.id)?.[key] || "") && nameTaken(db.clients, e.id, e[key]);
  const save = async (o) => {
    if (taken(o, "name") || taken(o, "sheetTabName")) return false; // the form stays open, saying why
    const clients = o.id ? db.clients.map((c) => c.id === o.id ? o : c) : [...db.clients, { ...o, id: uid() }];
    return saveRow(commit, { ...db, clients }, "clients", o.id, "client");
  };
  const del = async (id) => {
    setDeleteWarn(null);
    const warn = await deleteClientCascade(db, commit, id);
    if (warn) setDeleteWarn(warn);
  };
  const reorder = async (id, dir) => {
    const i = db.clients.findIndex((c) => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= db.clients.length) return;
    const clients = [...db.clients];
    [clients[i], clients[j]] = [clients[j], clients[i]];
    await commit({ ...db, clients });
  };
  return (
    <div>
    <p className="muted mb">Order here is the order they appear on the public Roster page — use the arrows to move someone up or down.</p>
    {deleteWarn && <p className="hint err-text mb">{deleteWarn}</p>}
    <Editor title="Clients" items={db.clients} columns={cols}
      blank={{ name: "", role: "Producer", credit: "", bio: "", photo: "", spotify: "", apple: "", instagram: "", tiktok: "", youtube: "", soundcloud: "", sheetTabName: "", onRoster: false }}
      onSave={save} onDelete={del} onReorder={reorder} openId={openId}
      confirmDelete={(c) => clientDeleteAsk(db, c)}
      extra={(e, set) => (
        <>
          <label className="check-row">
            <input type="checkbox" checked={e.onRoster !== false} onChange={(ev) => set({ ...e, onRoster: ev.target.checked })} />
            <span>Show on the public roster page.</span>
          </label>
          <Field label="Name" value={e.name} onChange={(ev) => set({ ...e, name: ev.target.value })} />
          {taken(e, "name") && <p className="hint err-text">{NAME_TAKEN}</p>}
          <label className="fld"><span>Role</span>
            <select value={e.role} onChange={(ev) => set({ ...e, role: ev.target.value })}>
              <option>Producer</option><option>Artist</option><option>Producer / Artist</option>
            </select>
          </label>
          <Field label="Credit / descriptor" value={e.credit} onChange={(ev) => set({ ...e, credit: ev.target.value })} />
          <PhotoUpload label="Photo" value={e.photo} onChange={(v) => set({ ...e, photo: v })} />
          <Area label="Bio" value={e.bio} onChange={(ev) => set({ ...e, bio: ev.target.value })} />
          <Field label="Spotify URL" value={e.spotify} onChange={(ev) => set({ ...e, spotify: ev.target.value })} />
          <Field label="Apple Music URL" value={e.apple} onChange={(ev) => set({ ...e, apple: ev.target.value })} />
          <Field label="YouTube URL" value={e.youtube} onChange={(ev) => set({ ...e, youtube: ev.target.value })} />
          <Field label="Instagram handle" value={e.instagram} onChange={(ev) => set({ ...e, instagram: ev.target.value })} />
          <Field label="TikTok handle" value={e.tiktok} onChange={(ev) => set({ ...e, tiktok: ev.target.value })} />
          <Field label="SoundCloud URL" value={e.soundcloud} onChange={(ev) => set({ ...e, soundcloud: ev.target.value })} />
          {/* opened from To do's "Set X's sheet tab": this field has the focus and says what's wrong */}
          <Field label="Sheet tab name" value={e.sheetTabName} onChange={(ev) => set({ ...e, sheetTabName: ev.target.value })} autoFocus={!!openId && e.id === openId} data-sheet-tab=""
            hint={`${openId && e.id === openId ? `The pub sheet has no tab called ${db.clients.find((c) => c.id === openId)?.sheetTabName?.trim() || db.clients.find((c) => c.id === openId)?.name}. ` : ""}Only needed if their tab on the pub sheet goes by a different name. Case, accents, punctuation and a “!” used as an i don't count — Stack!e already finds a tab named Stackie.`} />
          {taken(e, "sheetTabName") && <p className="hint err-text">{NAME_TAKEN}</p>}
        </>
      )}
    />
    </div>
  );
}

function PlacementsAdmin({ db, commit }) {
  const clientName = (id) => db.clients.find((c) => c.id === id)?.name || "—";
  const cols = [
    { key: "cover", label: "", w: "44px", render: (p) => p.cover ? <img className="rel-thumb" src={p.cover} alt="" /> : <span className="rel-thumb rel-thumb-empty" /> },
    { key: "song", label: "Song", w: "1.3fr" },
    { key: "clientId", label: "Client", w: "1fr", render: (p) => clientName(p.clientId) },
    { key: "splits", label: "Splits", w: "0.8fr", render: (p) => `${(p.splits || []).length} · ${splitTotal(p.splits)}%` },
    { key: "notable", label: "Featured", w: "0.8fr", render: (p) => p.notable ? <span className="badge-yes"><Check size={12} /> Notable</span> : <span className="badge-no">—</span> },
  ];
  const save = async (o0) => {
    const o = { ...o0, splits: filledSplits(o0.splits) }; // what the splits editor shows: the even default filled in
    const placements = o.id ? db.placements.map((p) => p.id === o.id ? o : p) : [...db.placements, { ...o, id: uid() }];
    return commit({ ...db, placements });
  };
  const del = async (id) => commit({ ...db, placements: db.placements.filter((p) => p.id !== id) });
  return (
    <Editor title="Songs" items={db.placements} columns={cols}
      blank={{ clientId: db.clients[0]?.id || "", song: "", artist: "", releaseDate: "", link: "", cover: "", notable: false, splits: [] }}
      onSave={save} onDelete={del}
      extra={(e, set) => (
        <>
          <label className="fld"><span>Client (Defied roster member)</span>
            <select value={e.clientId} onChange={(ev) => set({ ...e, clientId: ev.target.value })}>
              {db.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <SpotifyFill e={e} set={set} />
          <PhotoUpload label="Cover art" value={e.cover} onChange={(v) => set({ ...e, cover: v })} />
          <Field label="Song" value={e.song} onChange={(ev) => set({ ...e, song: ev.target.value })} />
          <Field label="Artist (performer)" value={e.artist} onChange={(ev) => set({ ...e, artist: ev.target.value })} />
          <Field label="Release date" type="date" value={e.releaseDate} onChange={(ev) => set({ ...e, releaseDate: ev.target.value })} />
          <Field label="Streaming link (opens on click)" value={e.link} onChange={(ev) => set({ ...e, link: ev.target.value })} />
          <SplitsEditor splits={e.splits} onChange={(v) => set({ ...e, splits: v })} />
          <label className="check-row">
            <input type="checkbox" checked={!!e.notable} onChange={(ev) => set({ ...e, notable: ev.target.checked })} />
            <span>Feature as a Notable Release — shows on the artist's profile. Split data stays private.</span>
          </label>
        </>
      )}
    />
  );
}

// Resolves a pasted Spotify track link to its title, artist, and cover art
// via our own /api/spotify route (Spotify's track page has no CORS headers,
// so this can't be fetched directly from the browser).
async function lookupSpotifyTrack(link) {
  const res = await fetch("/api/spotify?url=" + encodeURIComponent(link));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Lookup failed");
  return data;
}

function SpotifyFill({ e, set }) {
  const [link, setLink] = useState("");
  const [status, setStatus] = useState(null); // null | loading | ok | err
  const [errMsg, setErrMsg] = useState("");
  const open = useRef(true);
  useEffect(() => { open.current = true; return () => { open.current = false; }; }, []);
  const run = async () => {
    const t = (link || e.link || "").trim();
    if (!t) return;
    setStatus("loading");
    try {
      const meta = await lookupSpotifyTrack(t);
      if (!open.current) return; // the form was closed meanwhile
      // onto the form as it is now, so anything typed during the lookup stays
      set((cur) => ({
        ...cur,
        song: meta.title || cur.song,
        artist: meta.artist || cur.artist,
        releaseDate: cur.releaseDate || meta.releaseDate || "",
        cover: meta.cover || cur.cover,
        link: meta.link || cur.link || t,
      }));
      setStatus("ok");
    } catch (err) {
      setErrMsg(err.message || "Lookup failed");
      setStatus("err");
    }
  };
  return (
    <div className="sp-fill">
      <span className="fld-label">Paste a Spotify song link, then Auto-fill</span>
      <div className="sp-row">
        <input
          value={link}
          placeholder="https://open.spotify.com/track/..."
          onChange={(ev) => setLink(ev.target.value)}
          onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); run(); } }}
        />
        <button type="button" className="btn sm" onClick={run} disabled={status === "loading"}>
          {status === "loading" ? "Fetching…" : "Auto-fill"}
        </button>
      </div>
      {status === "ok" && <span className="sp-note ok"><Check size={12} /> Filled in. Review the fields below.</span>}
      {status === "err" && <span className="sp-note err">{errMsg} — enter the details and upload a cover below.</span>}
    </div>
  );
}

function TeamAdmin({ db, commit }) {
  const cols = [
    { key: "name", label: "Name", render: (s) => <span className="cell-name"><Avatar src={s.photo} name={s.name} size={30} />{s.name}</span> },
    { key: "role", label: "Role" }, { key: "email", label: "Email" },
  ];
  const save = async (o) => {
    const staff = o.id ? db.staff.map((s) => s.id === o.id ? o : s) : [...db.staff, { ...o, id: uid() }];
    return saveRow(commit, { ...db, staff }, "staff", o.id, "team member");
  };
  const del = async (id) => commit({ ...db, staff: db.staff.filter((s) => s.id !== id) });
  return (
    <Editor title="Team" items={db.staff} columns={cols}
      blank={{ name: "", role: "", email: "", instagram: "", bio: "", photo: "" }}
      onSave={save} onDelete={del}
      extra={(e, set) => (
        <>
          <Field label="Name" value={e.name} onChange={(ev) => set({ ...e, name: ev.target.value })} />
          <Field label="Role" value={e.role} onChange={(ev) => set({ ...e, role: ev.target.value })} />
          <Field label="Email" value={e.email} onChange={(ev) => set({ ...e, email: ev.target.value })} />
          <Field label="Instagram handle" value={e.instagram} onChange={(ev) => set({ ...e, instagram: ev.target.value })} />
          <PhotoUpload label="Photo" value={e.photo} onChange={(v) => set({ ...e, photo: v })} />
          <Area label="Bio" value={e.bio} onChange={(ev) => set({ ...e, bio: ev.target.value })} />
        </>
      )}
    />
  );
}

function UsersAdmin({ db, commit }) {
  const cols = [
    { key: "email", label: "Email" }, { key: "role", label: "Role" },
    { key: "clientId", label: "Linked client", render: (u) => db.clients.find((c) => c.id === u.clientId)?.name || "—" },
  ];
  const save = async (o) => {
    // the server skips a new login with no password, which would leave it on screen but never saved
    if (!o.id && !(o.password || "").trim()) return "Enter a password to create this account.";
    const users = o.id ? db.users.map((u) => u.id === o.id ? o : u) : [...db.users, { ...o, id: uid() }];
    if (!users.some((u) => u.role === "staff")) return "There has to be at least one staff account.";
    return saveRow(commit, { ...db, users }, "users", o.id, "user");
  };
  const del = async (id) => {
    const users = db.users.filter((u) => u.id !== id);
    if (!users.some((u) => u.role === "staff")) return "There has to be at least one staff account.";
    await commit({ ...db, users });
  };
  return (
    <Editor title="Users" items={db.users} columns={cols}
      blank={{ email: "", password: "", role: "client", name: "", clientId: null }}
      onSave={save} onDelete={del}
      extra={(e, set) => (
        <>
          <Field label="Email" value={e.email} onChange={(ev) => set({ ...e, email: ev.target.value })} />
          <Field
            label="Password" value={e.password} onChange={(ev) => set({ ...e, password: ev.target.value })}
            hint={e.id ? "Leave blank to keep their current password. At least 8 characters if you're setting a new one." : "At least 8 characters — required to create the account."}
          />
          <label className="fld"><span>Role</span>
            <select value={e.role} onChange={(ev) => set({ ...e, role: ev.target.value })}>
              <option value="client">Client</option><option value="staff">Staff</option>
            </select>
          </label>
          {e.role === "client" && (
            <label className="fld"><span>Link to roster client</span>
              <select value={e.clientId || ""} onChange={(ev) => set({ ...e, clientId: ev.target.value || null })}>
                <option value="">— none —</option>
                {db.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          <p className="hint">Clients only see their own placements and splits. They can never edit the website.</p>
        </>
      )}
    />
  );
}

function SubsAdmin({ db, commit }) {
  const unreadCount = db.submissions.filter((s) => !s.read).length;
  const toggleRead = (id) => {
    commit({ ...db, submissions: db.submissions.map((s) => (s.id === id ? { ...s, read: !s.read } : s)) });
  };
  return (
    <div>
      <div className="admin-head">
        <h2>Messages{unreadCount > 0 && <span className="nav-badge msg-count-badge">{unreadCount}</span>}</h2>
      </div>
      {db.submissions.length === 0 ? <div className="admin-empty">No messages yet.</div> : (
        <div className="subs">
          {db.submissions.map((s) => (
            <div key={s.id} className={s.read ? "sub-card" : "sub-card unread"}>
              <div className="sub-top">
                <div className="sub-top-info">
                  {!s.read && <span className="sub-dot" title="Unread" />}
                  <strong>{s.name}</strong>
                  <span className="tag">{s.subject}</span>
                </div>
                <button className="btn ghost sm" onClick={() => toggleRead(s.id)}>
                  {s.read ? "Mark unread" : <><Check size={13} /> Mark read</>}
                </button>
              </div>
              <div className="sub-contact-row">
                <EmailButton email={s.email} inline />
                {s.instagram && <span className="tag">@{s.instagram.replace(/^@/, "")}</span>}
              </div>
              <p>{s.message}</p>
              <span className="sub-date">{new Date(s.at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* staff: A&R — outreach pipeline + advance calculator, both backed by the
   OUTREACH / ADVANCE CALCULATOR sheet tabs. Deliberately isolated from
   MASTER/roster totals and from db/commit(). Each prospect has a permanent
   id (ar_prospects); /api/ar-write aims every save at that id, sends the
   values this page showed as `expect`, and refuses with a plain reason when
   the sheet changed meanwhile, so a save can never land on the wrong row. */
async function arWrite(body) {
  const res = await fetch("/api/ar-write", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  // a 409 carries what the panel needs to say it plainly: the clashing fields, or "reload"
  if (!res.ok) throw Object.assign(new Error(data.error || "Save failed."), { status: res.status, conflict: data.conflict, reload: !!data.reload });
  return data;
}

// the OUTREACH / ADVANCE CALCULATOR / ASSUMPTIONS read behind A&R's Outreach and Publishing's
// Advance calculator: loaded when either one opens, reloaded after each of their saves
function useArData() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => fetch("/api/ar-data")
    .then((r) => r.json())
    .then((d) => { if (d.error) throw new Error(d.error); setData(d); setErr(null); })
    .catch((e) => setErr(e.message || "Couldn't load A&R data."));
  const retry = () => { setErr(null); load(); }; // shows "Loading…" again until it answers
  useEffect(() => { load(); }, []);
  return { data, err, load, retry };
}
const ArDataError = ({ err, retry }) => <p className="hint err-text mb"><span>{err}</span> <button className="btn ghost sm" onClick={retry}>Try again</button></p>;

// A&R: Summary (default) · Watchlist · Board. One read of the pub sheet (useArData) and one of
// Postgres (/api/ar) serve all three; the sub-page last opened is remembered for the session.
const AR_SECS = [["summary", "Summary"], ["watch", "Watchlist"], ["board", "Board"]];
const AR_SEC_KEY = "dm-ar-sec";
// /api/ar's last answer: Summary, Watchlist and Board share it while it's under 30s old; a save
// always reads it again (loadPg() with no argument)
const arPgCache = { d: null, at: 0 };
function useArAll() {
  const sheet = useArData(); // the sheet read: money, cells, rows free
  const [pg, setPg] = useState(() => arPgCache.d); // /api/ar: Postgres only, so the pages draw before the sheet answers
  const [pgErr, setPgErr] = useState(null);
  const loadPg = (force = true) => {
    if (force === false && arPgCache.d && Date.now() - arPgCache.at < 30000) return Promise.resolve(setPg(arPgCache.d));
    return fetch("/api/ar").then((r) => r.json())
      .then((d) => { if (d.error) throw new Error(d.error); arPgCache.d = d; arPgCache.at = Date.now(); setPg(d); setPgErr(null); })
      .catch((e) => setPgErr(e.message || "Couldn't load the A&R data."));
  };
  useEffect(() => { loadPg(false); }, []);
  // each sheet read can bring in or settle prospects (the first one imports them all), so the
  // Postgres side is read again once it lands
  useEffect(() => { if (sheet.data) loadPg(); }, [sheet.data]);
  return { ...sheet, pg, pgErr, loadPg };
}
// the Dashboard's This week › A&R rows: "watch:open:<key>" (their panel) / "watch:flash:<key>" (a Luminate-only row)
const arWatchAt = (sub) => { const m = /^watch:(open|flash):(.+)$/.exec(sub || ""); return m ? { pill: "people", [m[1]]: m[2] } : null; };
function ARAdmin({ onGo, sub }) {
  const [sec, setSecState] = useState(() => {
    if (arWatchAt(sub)) return "watch";
    try { const s = sessionStorage.getItem(AR_SEC_KEY); return AR_SECS.some(([id]) => id === s) ? s : "summary"; } catch { return "summary"; }
  });
  const [watchAt, setWatchAt] = useState(() => arWatchAt(sub)); // where Summary sends the Watchlist: {pill, open}
  const setSec = (id, at = null) => { setSecState(id); setWatchAt(at); try { sessionStorage.setItem(AR_SEC_KEY, id); } catch { /* private mode */ } };
  // Back / Forward to another Dashboard row while A&R is open
  useEffect(() => { const at = arWatchAt(sub); if (at) setSec("watch", at); }, [sub]); // eslint-disable-line react-hooks/exhaustive-deps
  const ar = useArAll();
  // each page opens on the latest from Postgres (another page may have added someone)
  const opened = useRef(false);
  useEffect(() => { if (opened.current) ar.loadPg(false); opened.current = true; }, [sec]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="ar">
      {/* the page's title first, as on Publishing and Website; each section says only its one line */}
      <div className="admin-head"><h2>A&amp;R</h2></div>
      <div className="subnav">
        {AR_SECS.map(([id, label]) => (
          <button key={id} className={sec === id ? "subpill active" : "subpill"} onClick={(e) => { setSec(id); revealChip(e.currentTarget); }}>{label}</button>
        ))}
      </div>
      {sec === "summary" && <ArSummary ar={ar} onGo={onGo} goBoard={() => setSec("board")} goWatch={(at) => setSec("watch", at)} />}
      {sec === "board" && <ArBoard ar={ar} onGo={onGo} />}
      {sec === "watch" && <ArWatch key={JSON.stringify(watchAt)} ar={ar} onGo={onGo} at={watchAt} />}
    </div>
  );
}
const ArHead = ({ sub, children }) => (
  <div className="admin-head ar-head">
    <div className="ar-head-text"><p className="ar-sub">{sub}</p></div>
    {children && <div className="arb-head-actions">{children}</div>}
  </div>
);

// The Board's stages in plain words. A producer's stage is its sheet status (OUTREACH_STATUSES are
// what's saved); a tracked artist's is saved in the database only (ar_tracked.stage).
const AR_STAGES = [
  { id: "reach", label: "To reach out", hint: "Haven't messaged yet", verb: null, status: "Not Contacted" },
  { id: "reached", label: "Reached out", hint: "Waiting to hear back", verb: "Reached out →", status: "Contacted" },
  { id: "talking", label: "Talking", hint: "Going back and forth", verb: "Started talking →", status: "In Talks" },
  { id: "offer", label: "Offer sent", hint: "Waiting on their answer", verb: "Sent an offer →", status: "Offer Out" },
  { id: "signed", label: "Signed", hint: "Done deals", verb: "Signed ✓", status: "Signed" },
];
const STAGE_OF_STATUS = { "Not Contacted": "reach", Researching: "reach", "": "reach", Contacted: "reached", "In Talks": "talking", "Offer Out": "offer", Signed: "signed", Passed: "passed" };
const stageOfStatus = (s) => STAGE_OF_STATUS[String(s ?? "").trim()] || "other";
const stageLabel = (id) => AR_STAGES.find((s) => s.id === id)?.label || (id === "passed" ? "Passed" : id === "other" ? "Other" : "Just watching");
// one coloured pill per stage (the colour comes from data-stage), the same on every A&R page
const StagePill = ({ id, n, label }) => <span className="ar-stage" data-stage={id}>{label || stageLabel(id)}{n != null && <b>{n}</b>}</span>;
// the status a move saves: "To reach out" keeps Researching when that's what it was
const statusForStage = (id, current) => (id === "passed" ? "Passed" : id === "reach" && String(current ?? "").trim() === "Researching" ? "Researching" : AR_STAGES.find((s) => s.id === id)?.status);
// a card can only be moved onto a real stage: "Other" is whatever was typed by hand, never a target
const canMoveTo = (id) => id === "passed" || AR_STAGES.some((s) => s.id === id);
// one step forward or back (Other and Passed step back into "To reach out")
const stepFrom = (id, d) => { const i = AR_STAGES.findIndex((s) => s.id === id); return i < 0 ? (d < 0 ? AR_STAGES[0] : null) : AR_STAGES[i + d] || null; };
const wholeMoney = (n) => `$${fmt(Math.round(Number(n) || 0))}`;
const centsMoney = (n) => (Math.round(n * 100) % 100 ? money(n) : wholeMoney(n)); // $36,125 · $3,759.26
// stream counts in A&R, one rule everywhere (Board card, Producers tiles, panel, How we estimate): from a
// million, up to two decimals rounded half-up (28.9M · 14.45M · 1.48M), from a thousand whole K (845K)
const bigNum = (n) => {
  const a = Math.abs(Number(n) || 0), s = n < 0 ? "-" : "";
  return a >= 1e6 ? `${s}${Math.round(a / 1e4) / 100}M` : a >= 1e3 ? `${s}${Math.round(a / 1e3)}K` : `${s}${fmt(Math.round(a))}`;
};
// a flat week (rounds to 0.0%) has no arrow: it went neither up nor down
const flatPct = (p) => Math.abs(p) < 0.05;
const pctText = (p) => (flatPct(p) ? "0.0%" : `${p >= 0 ? "▲" : "▼"} ${Math.abs(p).toFixed(1)}%`);
// the week-on-week % as one pill everywhere: ▲ green up, ▼ red down, grey when flat; nothing when there's no last week
const WowPill = ({ pct, big }) => (pct == null ? null : <span className={big ? "wow-pill big" : "wow-pill"} data-dir={flatPct(pct) ? "flat" : pct >= 0 ? "up" : "down"}>{pctText(pct)}</span>);
// someone we track by hand with no row in the Luminate A&R list yet (producers from OUTREACH
// rarely have one, and Passed is done, so neither counts)
const needsLumRow = (r) => r.ref?.type === "tracked" && !r.luminateId && r.stage !== "passed";
const UpDown = ({ r }) => (r.current == null ? <span className="muted">No numbers yet</span>
  : r.changePct == null ? <span className="muted-dash" title="No last week to compare">—</span>
  : <WowPill pct={r.changePct} />);
// a week's span moved by whole days ("compared with Oct 16 – 22" is the 7 days before)
const shiftDay = (iso, d) => { const t = new Date(`${iso}T12:00:00`); t.setDate(t.getDate() + d); return t.toLocaleDateString("en-CA"); };

// Everyone on the Board: producers (prospects, their stage from the sheet) and the tracked artists
// put on the board (stage not null). Built the same way for Summary, the Board and the Watchlist.
function arCards(data, pg) {
  const sheetById = Object.fromEntries((data?.prospects || []).map((p) => [p.id, p]));
  const live = (pg?.prospects || []).filter((p) => !p.removedAt);
  const producers = live.map((p) => {
    const s = sheetById[p.id], status = s?.status ?? p.status;
    return { key: `p:${p.id}`, role: "producer", id: p.id, name: p.name, contact: s?.contact || "", status, stage: stageOfStatus(status), followUp: p.followUp,
      clientId: p.clientId, s, lastContact: s?.lastContact?.date || null, lastText: s?.lastContact?.text || "" };
  });
  const artists = (pg?.tracked || []).filter((t) => t.kind === "artist" && t.stage).map((t) => ({
    key: `t:${t.id}`, role: "artist", id: t.id, name: t.name, contact: t.handle, status: "", stage: t.stage, followUp: null, t, lastContact: t.lastContact, lastText: "",
  }));
  return { cards: [...producers, ...artists], sheetById, live };
}

// the panels the Board and the Watchlist open (a producer's, a tracked artist's or song's, the Add
// form); focus goes back to whatever opened it once it closes
function usePanel() {
  const [open, setOpen] = useState(null);
  const back = useRef(null);
  const openPanel = (o, e) => { back.current = e?.currentTarget?.closest?.("[data-focus]")?.dataset.focus || null; setOpen(o); };
  const closePanel = () => {
    setOpen(null);
    const k = back.current;
    if (k) setTimeout(() => document.querySelector(`[data-focus="${CSS.escape(k)}"]`)?.focus(), 0);
  };
  return { open, openPanel, closePanel };
}
function ArPanels({ ar, open, openPanel, closePanel, onGo }) {
  const { data, pg, load, loadPg } = ar;
  const [kind, setKind] = useState(open?.kind || "producer");
  const [linkErr, setLinkErr] = useState(null);
  useEffect(() => { if (open?.type === "add") setKind(open.kind || "producer"); }, [open]);
  if (!open) return null;
  const canSave = !!data && data.sheet?.ok !== false;
  // one tap picks what's being added, and the form's title follows it
  const picker = (
    <span className="gainer-tabs ar-kind" role="tablist" aria-label="What are you adding?">
      {[["artist", "Artist"], ["producer", "Producer"], ["song", "Song"]].map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={kind === id} className={kind === id ? "active" : ""} onClick={() => setKind(id)}>{label}</button>
      ))}
    </span>
  );
  const addTitle = open.prefill?.name ? `Add details for ${open.prefill.name}` : kind === "artist" ? "Add an artist" : kind === "song" ? "Add a song" : "Add a producer";
  if (open.type === "add" && kind === "producer") {
    return (
      <ProspectForm title={addTitle} picker={picker} blendedRate={data?.assumptions?.blendedRate ?? 0} assume={data?.assumptions} canSave={canSave}
        onClose={closePanel} onChanged={async (r) => { await load(); if (r?.prospect?.id) openPanel({ type: "prospect", id: r.prospect.id }); else closePanel(); }} />
    );
  }
  if (open.type === "add" || open.type === "tracked") {
    const t = open.type === "tracked" ? (pg?.tracked || []).find((x) => x.id === open.id) : null;
    if (open.type === "tracked" && !t) return null;
    return <ArTrackedForm key={t?.id || kind} kind={t?.kind || kind} t={t} prefill={open.prefill} picker={t ? null : picker} title={addTitle} pg={pg}
      onClose={closePanel} onSaved={async () => { await loadPg(); closePanel(); }} />;
  }
  const s = (data?.prospects || []).find((p) => p.id === open.id);
  const p = (pg?.prospects || []).find((x) => x.id === open.id);
  if (!s || !data) return null;
  const artistRows = (pg?.arLists || []).flatMap((l) => l.rows.filter((r) => r.type === "artist"));
  const link = (p?.tracked || []).find((x) => x.kind === "artist" && x.luminateId)?.luminateId || "";
  const mine = (pg?.watch?.people || []).find((r) => r.ref?.id === open.id);
  return (
    <ProspectForm key={s.id} prospect={s} pg={p} blendedRate={data.assumptions.blendedRate} assume={data.assumptions} canSave={canSave} reload={load}
      onClose={closePanel} onChanged={async () => { await load(); closePanel(); }}
      extra={(
        <div className="ar-panel-extra">
          <p className="fld-label mb">Their Luminate numbers</p>
          {mine?.current != null
            ? <p className="ar-nums">{fmt(mine.current)} streams this week <UpDown r={mine} /> · {fmt(mine.atd ?? 0)} all-time</p>
            : <p className="muted ar-nums">No numbers yet. Add them to your A&amp;R list in Luminate, then pick their row here.</p>}
          <label className="fld"><span>Their row in your Luminate A&amp;R Artists list</span>
            <select value={link} onChange={(e) => { setLinkErr(null); arPost({ action: "linkLuminate", prospectId: s.id, luminateId: e.target.value }).then(() => loadPg()).catch((e2) => setLinkErr(e2.message)); }} aria-label="Their row in your Luminate A&R Artists list">
              <option value="">{mine?.luminateId && !link ? `Matched by name: ${artistRows.find((r) => r.id === mine.luminateId)?.name || ""}` : "None yet"}</option>
              {artistRows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            {linkErr && <span className="hint err-text" role="alert">{linkErr}</span>}
          </label>
          <button className="btn ghost sm" onClick={() => onGo("catalog", `advance:${s.id}`)}>Calculate an advance</button>
        </div>
      )} />
  );
}

// Add or edit a tracked artist or song: saved in the dashboard's database only, never the sheet, and
// no money anywhere (only producers have estimates)
function ArTrackedForm({ kind, t, prefill, picker, title, pg, onClose, onSaved }) {
  const isNew = !t;
  const init = t || { name: prefill?.name || "", artist: "", handle: "", spotify: "", isrc: "", genre: "", notes: "", luminateId: prefill?.luminateId || "", personId: null, stage: null };
  const [f, setF] = useState({ ...init, stage: init.stage || "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const dirty = ["name", "artist", "handle", "spotify", "isrc", "genre", "notes", "luminateId", "personId", "stage"].some((k) => String(f[k] ?? "") !== String((k === "stage" ? init.stage || "" : init[k]) ?? ""));
  const guard = useDirtyGuard(dirty, onClose);
  useEscape(guard.tryClose, !busy);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const type = kind === "song" ? "song" : "artist";
  // rows of that A&R list nobody has taken yet (plus this one's own)
  const taken = new Set((pg?.watch?.[type === "song" ? "songs" : "people"] || []).filter((r) => r.ref && r.luminateId && r.ref.id !== t?.id).map((r) => r.luminateId));
  const rows = (pg?.arLists || []).flatMap((l) => l.rows.filter((r) => r.type === type && !taken.has(r.id)));
  const people = (pg?.watch?.people || []).filter((r) => r.ref);
  const save = async () => {
    setBusy(true); setErr(null);
    const body = { name: f.name, artist: f.artist, handle: f.handle, spotify: f.spotify, isrc: f.isrc, genre: f.genre, notes: f.notes, luminateId: f.luminateId, personId: f.personId || null };
    try {
      if (isNew) await arPost({ action: "addTracked", kind: type, ...body, stage: type === "artist" ? f.stage || null : null });
      else {
        await arPost({ action: "editTracked", id: t.id, ...body });
        if (type === "artist" && (f.stage || null) !== (t.stage || null)) await arPost({ action: "stageTracked", id: t.id, stage: f.stage || null });
      }
      await onSaved();
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  const [askStop, setAskStop] = useState(false);
  const remove = async () => {
    setAskStop(false); setBusy(true);
    try { await arPost({ action: "removeTracked", id: t.id }); await onSaved(); } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && !busy && guard.tryClose()}>
      <div className="modal-card ar-tracked-form" data-kind={type}>
        <div className="modal-head"><h3>{isNew ? title || "Add an artist" : t.name}</h3><button onClick={guard.tryClose} aria-label="Close" disabled={busy}><X size={18} /></button></div>
        <div className="modal-body">
          {picker}
          {/* a Luminate-only row: its numbers first, from the row that was clicked */}
          {isNew && prefill?.nums && (
            <p className="ar-nums ar-prefill-nums">This week {fmt(prefill.nums.thisWeek ?? 0)}{prefill.nums.wowPct != null && ` · ${pctText(prefill.nums.wowPct)} vs last week`}{prefill.nums.atd != null && ` · ${bigNum(prefill.nums.atd)} all-time`}</p>
          )}
          {isNew && prefill?.name && <p className="hint mb">Their numbers already come in from Luminate. Add a handle or Spotify link, or put them on the board.</p>}
          {err && <p className="hint err-text" role="alert">{err}</p>}
          <Field label={type === "song" ? "Song title" : "Name"} value={f.name} onChange={set("name")} />
          {type === "artist" && (
            <label className="fld"><span>Stage</span>
              <select value={f.stage} onChange={set("stage")} aria-label="Stage">
                <option value="">Just watching (not on the Board)</option>
                {AR_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                <option value="passed">Passed</option>
              </select>
            </label>
          )}
          {type === "song" && <Field label="Artist" value={f.artist} onChange={set("artist")} />}
          {type === "artist" && <Field label="Instagram or TikTok" value={f.handle} onChange={set("handle")} />}
          <Field label="Spotify link" value={f.spotify} onChange={set("spotify")} />
          {type === "song" && <Field label="ISRC (if you have it)" value={f.isrc} onChange={set("isrc")} />}
          <label className="fld"><span>Their row in your Luminate A&amp;R {type === "song" ? "Songs" : "Artists"} list</span>
            <select value={f.luminateId} onChange={set("luminateId")} aria-label="Their row in Luminate">
              <option value="">None yet</option>
              {rows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <span className="hint">Not there? Add them in Luminate. They show up here after your next export.</span>
          </label>
          {type === "artist" && <Field label="Genre" value={f.genre} onChange={set("genre")} />}
          {type === "song" && (
            <label className="fld"><span>Tied to (optional)</span>
              <select value={f.personId || ""} onChange={set("personId")} aria-label="Tied to">
                <option value="">Nobody</option>
                {people.map((r) => <option key={r.key} value={r.ref.id}>{r.name}</option>)}
              </select>
            </label>
          )}
          <Area label="Notes" value={f.notes} onChange={set("notes")} />
          <p className="hint">Saved here in the dashboard only. Nothing goes into the pub sheet.</p>
        </div>
        {guard.bar}
        <div className="modal-foot">
          {!isNew && <button className="btn ghost sm err-text arb-remove" onClick={() => setAskStop(true)} disabled={busy}>Stop tracking</button>}
          <button className="btn ghost sm" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn sm" onClick={save} disabled={busy || !f.name.trim()}>{busy ? "Saving…" : isNew ? "Save" : "Save changes"}</button>
        </div>
      </div>
      {askStop && (
        <AskCard title={`Stop tracking ${t.name}?`} goLabel="Stop tracking" busyLabel="Stopping…" go={remove} onClose={() => setAskStop(false)}>
          <p>Nothing in Luminate or the pub sheet changes.</p>
        </AskCard>
      )}
    </div>
  );
}

// Summary: the top gainers in the A&R lists, then what needs doing. Nothing else.
// ClickUp's A&R Tasks list for the Summary's task list (read-only, /api/home?list=ar)
function useArClickUp() {
  const [cu, setCu] = useState(() => dashCache.cu.ar || null); // the Dashboard's copy of the same list, refreshed below
  const load = () => fetch("/api/home?list=ar", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (d?.clickup && !d.clickup.error) dashCache.cu.ar = d.clickup; setCu(d?.clickup || { error: "Couldn't reach ClickUp." }); })
    .catch(() => setCu({ error: "Couldn't reach ClickUp." }));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { cu, retry: () => { setCu(null); load(); } };
}

function ArSummary({ ar, onGo, goBoard, goWatch }) {
  const { data, pg, pgErr, loadPg } = ar;
  const { cu, retry: retryCu } = useArClickUp();
  const watch = pg?.watch;
  const { cards } = arCards(data, pg);
  const [showToLum, setShowToLum] = useState(false);
  const phone = useMedia("(max-width: 699px)");
  const [gtab, setGtab] = useState("people"); // phones show one list at a time
  // ranked on the server by week-on-week % (watch.top: keys, ranked = shown with its %)
  const ranked = (list, keys) => (keys || []).map((k) => { const r = list.find((x) => x.key === k.key); return r && { ...r, ranked: k.ranked }; }).filter(Boolean);
  const people = ranked(watch?.people || [], watch?.top?.people), songs = ranked(watch?.songs || [], watch?.top?.songs);
  const to = watch?.period?.to;
  const old = to && daysSince(to) > 8;
  // most urgent first: late follow-ups, then due today, then quiet offers, then what can't get numbers.
  // urg colours the row's dot: red late, amber soon, blue Luminate
  const tasks = [];
  const live = cards.filter((c) => c.stage !== "passed" && c.stage !== "signed");
  for (const c of live.filter((x) => x.followUp?.state === "overdue")) tasks.push({ k: `late:${c.key}`, urg: "late", t: `Follow up with ${c.name}: ${c.followUp.daysLate === 1 ? "1 day" : `${c.followUp.daysLate} days`} late.`, cta: "Open", go: () => goBoard() });
  for (const c of live.filter((x) => x.followUp?.state === "due")) tasks.push({ k: `due:${c.key}`, urg: "soon", t: `Follow up with ${c.name} today.`, cta: "Open", go: () => goBoard() });
  for (const c of cards.filter((x) => x.stage === "offer" && (!x.lastContact || daysSince(x.lastContact) >= 7))) {
    tasks.push({ k: `offer:${c.key}`, urg: "soon", t: `The offer to ${c.name} has had no contact ${c.lastContact ? `since ${shortDay(c.lastContact)}` : "logged"}.`, cta: "Open", go: () => goBoard() });
  }
  // the same task and wording as the Dashboard's (lib/ar.js arToLuminateOf)
  const toLum = pg?.toLuminate;
  if (toLum?.count) tasks.push({ k: "noNumbers", urg: "lum", t: toLum.text, cta: "View list", go: () => setShowToLum(true) });
  if (old) tasks.push({ k: "stale", urg: "lum", t: `A&R numbers are from ${shortDay(to)}.`, cta: "Drop new exports", go: () => onGo("luminate", "drop") });
  // ClickUp's A&R Tasks, merged by urgency: urgent ones above the late follow-ups, high ones right
  // after them, the rest only while the list is short. Each opens the task in ClickUp.
  const cuItem = (t) => ({ k: `cu:${t.id}`, pri: t.priority, t: `${t.name}${t.due ? ` (${dueLate(t.due) ? "late, was due" : "due"} ${shortDay(t.due)})` : ""}`, cta: "Open in ClickUp", go: () => openTab(t.url) });
  const cuOpen = cu?.tasks || [];
  const lateN = tasks.filter((x) => x.k.startsWith("late:")).length;
  const merged = [...cuOpen.filter((t) => t.priority === "urgent").map(cuItem), ...tasks.slice(0, lateN), ...cuOpen.filter((t) => t.priority === "high").map(cuItem), ...tasks.slice(lateN)];
  const others = cuOpen.filter((t) => t.priority !== "urgent" && t.priority !== "high");
  if (merged.length < 5) merged.push(...others.slice(0, 5 - merged.length).map(cuItem));
  if (cu?.error) merged.push({ k: "cu:error", t: "Couldn't reach ClickUp, so its A&R tasks aren't listed here.", cta: "Try again", go: retryCu });
  const value = data?.totals?.totalValue;
  const stageN = (id) => cards.filter((c) => c.stage === id).length;
  // never "All caught up" before both the database and ClickUp's A&R list have answered
  const checking = (!pg && !pgErr) || !cu;
  // someone tracked here opens their panel on the Watchlist; a Luminate-only row is just shown there
  const openGainer = (r, kind) => goWatch(r.ref ? { pill: kind, open: r.key } : { pill: kind, flash: r.key });
  const Gainers = ({ list, kind }) => (
    <div className="gainers ar-gainers" data-list={kind} data-wait={!pg ? "" : undefined}>
      <div className="attn-head"><TrendingUp size={15} /> {kind === "people" ? "People" : "Songs"}{watch?.periods?.[kind] && <span className="ar-dates"> · {dayRange(watch.periods[kind].from, watch.periods[kind].to)}</span>}</div>
      {!pg ? <p className="gainers-empty">Loading…</p> : !list.length ? (
        <p className="gainers-empty">{kind === "people" ? "Nobody" : "No songs"} with numbers yet. <button className="btn ghost sm" onClick={() => onGo("luminate", "drop")}>Drop new exports</button></p>
      ) : list.map((r, i) => {
        const pct = r.ranked && r.wowPct != null;
        const rose = pct && r.wowPct > 0;
        return (
          <button key={r.key} className="gainer" data-ranked={rose ? "" : undefined} data-fall={pct && !rose ? "" : undefined} onClick={() => openGainer(r, kind)}>
            <span className="gainer-n">{rose ? i + 1 : "·"}</span>
            <span className="lm-song-main"><strong>{r.name || r.title}</strong>
              {kind === "people"
                ? <span className="ar-g-sub">{r.role === "producer" ? "Producer" : "Artist"}{r.stage && <StagePill id={r.stage} />}</span>
                : r.artist && <span>{r.artist}</span>}
            </span>
            <span className="gainer-num" data-wow={pct ? (r.wowPct >= 0 ? "up" : "down") : "none"}>
              {pct && <WowPill pct={r.wowPct} big />}<em>{fmt(r.thisWeek)} {old ? "that week" : "this week"}</em>
            </span>
          </button>
        );
      })}
    </div>
  );
  const tabs = [["people", "People", (watch?.people || []).length], ["songs", "Songs", (watch?.songs || []).length]];
  return (
    <div className="ar-summary">
      <ArHead sub="Who's up this week and what needs doing." />
      {pgErr && <ArDataError err={pgErr} retry={loadPg} />}
      {/* the pipeline at a glance: one coloured pill per stage, and the sheet's total value; opens the Board */}
      <button className="ar-strip" onClick={goBoard} aria-label="Open the Board">
        {AR_STAGES.map((st) => <StagePill key={st.id} id={st.id} n={pg ? stageN(st.id) : "–"} />)}
        {/* the sheet's total value: mostly the would-be cut of past earnings, so not "in play" money */}
        <span className="ar-strip-val">{value != null ? `≈ ${wholeMoney(value)} est. value` : !data && !ar.err ? "…" : "Open the Board"} →</span>
      </button>
      <div className="ar-sum-head">
        <h3 className="ar-h3">{old ? "Latest week" : "This week"} <span className="ar-h3-sub">· biggest % rise first</span></h3>
        <button className="inline-link" onClick={() => goWatch(null)}>See everyone →</button>
      </div>
      {phone && (
        <span className="gainer-tabs ar-gainer-toggle" role="tablist" aria-label="People or songs">
          {tabs.map(([id, label, n]) => <button key={id} role="tab" aria-selected={gtab === id} className={gtab === id ? "active" : ""} onClick={() => setGtab(id)}>{label} <span className="arb-n">{n}</span></button>)}
        </span>
      )}
      <div className="home-pair ar-gainer-pair">
        {(!phone || gtab === "people") && <Gainers list={people} kind="people" />}
        {(!phone || gtab === "songs") && <Gainers list={songs} kind="songs" />}
      </div>
      {checking ? <h3 className="ar-h3 ar-todo-h ar-todo-wait">To do <span className="todo-done">· <RefreshCw size={14} className="spin" /> checking…</span></h3> : merged.length ? (
        <>
          <h3 className="ar-h3 ar-todo-h">To do <span className="attn-n">{merged.length}</span></h3>
          <div className="attn ar-tasks">
            {merged.map((it) => (
              // phones: the whole row is the button, with a › instead of the pill (as on the Dashboard)
              <div key={it.k} className="attn-row" data-task={it.k} data-pri={it.pri || undefined}
                {...(phone ? { role: "button", tabIndex: 0, onClick: it.go, onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); it.go(); } } } : {})}>
                {it.urg && <i className="ar-dot" data-urg={it.urg} aria-hidden="true" />}
                <span>{it.pri && <span className="cu-pri" data-pri={it.pri} title={`${PRIORITY[it.pri] || it.pri} priority in ClickUp`}><Flag size={13} /></span>}{it.t}</span>
                <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); it.go(e); }}>{it.cta}</button>
                <ChevronRight size={16} className="attn-chev" aria-hidden="true" />
              </div>
            ))}
          </div>
        </>
      ) : <h3 className="ar-h3 ar-todo-h ar-todo-clear">To do <span className="todo-done">· <CheckCircle2 size={14} /> All caught up</span></h3>}
      {showToLum && toLum && <ArToLuminateModal t={toLum} onGo={onGo} onClose={() => setShowToLum(false)} />}
    </div>
  );
}

// "Follow up Fri" (grey), "Follow up today" (amber), "2 days late" (red)
function followChip(f) {
  if (!f?.on) return null;
  if (f.state === "overdue") return <span className="arb-chip neg">{f.daysLate === 1 ? "1 day late" : `${f.daysLate} days late`}</span>;
  if (f.state === "due") return <span className="arb-chip warn">Follow up today</span>;
  const days = (Date.parse(`${f.on}T12:00:00`) - Date.now()) / 864e5;
  return <span className="arb-chip">Follow up {days < 6 ? weekday(f.on) : shortDay(f.on)}</span>;
}

// Postgres-only A&R calls (/api/ar): merges, the first-run card, tracked artists and songs. They keep
// working while Sheets is down.
async function arPost(body) {
  const res = await fetch("/api/ar", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Save failed.");
  return data;
}

function ArBoard({ ar, onGo }) {
  const { data, err, load, retry, pg, pgErr, loadPg } = ar;
  const reload = () => load();
  const [view, setView] = useState("board");
  const [passedOnly, setPassedOnly] = useState(false);
  const [find, setFind] = useState("");
  const { open, openPanel, closePanel } = usePanel();
  const [moving, setMoving] = useState({}); // card key → the stage shown while its move saves; snaps back if refused
  const [flash, setFlash] = useState(null);
  const [showOff, setShowOff] = useState(false);
  const [showCheck, setShowCheck] = useState(false);
  const [more, setMore] = useState(false);
  const [quick, setQuick] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(null); // the card being dragged
  const [over, setOver] = useState(null); // the column it's over
  const [folds, setFolds] = useState({}); // phone: column → open (unset: only the first non-empty one is)
  // drag and drop on a desktop pointer only; on a phone the buttons do the work
  const [canDrag, setCanDrag] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 700px) and (pointer: fine)"), f = () => setCanDrag(m.matches);
    f(); m.addEventListener("change", f); return () => m.removeEventListener("change", f);
  }, []);
  useEscape(() => setMore(false), more);

  // sheet state: null = still reading, true = in step, false = showing the last copy (saving paused)
  const sheetOk = data ? data.sheet?.ok !== false : err ? false : null;
  const canSave = sheetOk === true;
  const paused = canSave ? undefined : "Saving is paused until the pub sheet can be read again.";
  const { cards, sheetById, live } = useMemo(() => arCards(data, pg), [data, pg]);
  const offBoard = data?.offBoard || (pg?.prospects || []).filter((p) => p.removedAt).map((p) => ({ id: p.id, name: p.name, removedAt: p.removedAt, why: "removed" }));
  const needle = find.trim().toLowerCase();
  const shown = cards.filter((c) => !needle || c.name.toLowerCase().includes(needle) || (c.contact || "").toLowerCase().includes(needle))
    .map((c) => (moving[c.key] ? { ...c, stage: moving[c.key], moving: true } : c));
  const cols = [...AR_STAGES, { id: "other", label: "Other", hint: "Typed in by hand in the sheet" }]
    .map((st) => ({ ...st, cards: shown.filter((c) => c.stage === st.id) })).filter((c) => c.id !== "other" || c.cards.length);
  const passed = shown.filter((c) => c.stage === "passed");
  const firstOpen = cols.find((c) => c.cards.length)?.id || "reach";
  const isOpen = (id) => folds[id] ?? id === firstOpen;

  // one move, from the button, the ⋯ menu or a drop: a producer's saves its sheet status (and is
  // refused, card back where it was, when the sheet says no); an artist's saves in the database only
  const moveTo = async (c, stageId) => {
    if (!stageId || stageId === c.stage || !canMoveTo(stageId)) return;
    const producer = c.role === "producer", s = producer ? sheetById[c.id] : null;
    const status = producer ? statusForStage(stageId, s?.status) : null;
    if (producer && (!s || !canSave || !status || status === s.status)) return;
    setMoving((m) => ({ ...m, [c.key]: stageId })); setFlash(null);
    try {
      if (producer) {
        const r = await arWrite({ action: "setStatus", prospectId: c.id, status, expect: s.cells.O ?? "" });
        setFlash({ ok: true, text: `${c.name} moved to ${stageLabel(stageId)}.${r.followUpSet ? ` Follow-up set for ${shortDay(r.followUpSet)}.` : ""}` });
        await reload();
      } else {
        await arPost({ action: "stageTracked", id: c.id, stage: stageId });
        setFlash({ ok: true, text: `${c.name} moved to ${stageLabel(stageId)}.` });
        await loadPg();
      }
    } catch (e) { setFlash({ ok: false, text: e.message }); }
    setMoving((m) => { const n = { ...m }; delete n[c.key]; return n; });
  };
  const quickAdd = async (e) => {
    e.preventDefault();
    const name = quick.trim();
    if (!name || !canSave) return;
    setBusy(true); setFlash(null);
    try {
      const r = await arWrite({ action: "createProspect", name });
      setQuick("");
      await reload();
      if (r.prospect?.id) openPanel({ type: "prospect", id: r.prospect.id });
      if (r.note) setFlash({ ok: true, text: r.note });
    } catch (e2) { setFlash({ ok: false, text: e2.message }); }
    setBusy(false);
  };
  const act = async (fn) => {
    setBusy(true); setFlash(null);
    try { await fn(); await reload(); } catch (e) { setFlash({ ok: false, text: e.message }); }
    setBusy(false);
  };
  const openCard = (c, e) => openPanel(c.role === "producer" ? { type: "prospect", id: c.id } : { type: "tracked", id: c.id }, e);
  const menuDo = (fn) => () => { setMore(false); fn(); };
  // the sheet read's problems plus what the last Sheet check found: the link counts what the check lists
  const notes = sheetProblems(data?.sheet?.problems, data?.sheet?.checkProblems);
  // the problems this read couldn't ask again (headers, formulas) say when the Sheet check found them
  const checkedOn = shortDay((data?.sheet?.checkProblems || []).find((c) => c.checkedAt)?.checkedAt);

  return (
    <div className="arb">
      <ArHead sub="Everyone we're talking to (artists and producers). Drag a card, or press its button when things move.">
        <input className="arb-find" type="search" placeholder="Find someone" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Find someone" />
        <span className="arb-more" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMore(false)}>
          <button className="btn ghost sm" aria-expanded={more} aria-haspopup="menu" onClick={() => setMore(!more)}>More ▾</button>
          {more && (
            <div className="arb-menu right" role="menu">
              <button role="menuitem" onClick={menuDo(() => { setView(view === "board" ? "list" : "board"); setPassedOnly(false); })}>{view === "board" ? "Show as a list" : "Show as a board"}</button>
              {data?.sheet?.links?.outreach && <ExtLink role="menuitem" href={data.sheet.links.outreach}>Open OUTREACH tab</ExtLink>}
              <button role="menuitem" onClick={menuDo(() => setShowOff(true))}>Off the board ({offBoard.length})</button>
              <button role="menuitem" onClick={menuDo(() => setShowCheck(true))}>Sheet check</button>
            </div>
          )}
        </span>
        <button className="btn sm" data-focus="add" onClick={(e) => openPanel({ type: "add", kind: "producer" }, e)}><Plus size={15} /> Add someone</button>
      </ArHead>

      {sheetOk === false ? (
        <div className="arb-banner neg">
          <AlertTriangle size={16} />
          <span>The pub sheet isn't answering, so saving to it is paused. Showing what it said {data?.sheet?.seenAt ? `at ${clock(data.sheet.seenAt)}` : "last time"}.</span>
          <button className="btn ghost sm" onClick={() => { retry(); loadPg(); }}>Try again</button>
        </div>
      ) : (
        <p className="arb-status">
          {sheetOk === null ? <span className="muted">Reading the OUTREACH tab…</span> : `Saved to your OUTREACH sheet · ${clock(data.sheet.readAt)}`}
          {/* what the sheet read flagged (a status dropdown it couldn't read…) is one quiet link; Sheet check has the full sentence */}
          {notes.length > 0 && <> · <button className="inline-link arb-notes" onClick={() => setShowCheck(true)} title={checkedOn ? `Some of these are from the Sheet check on ${checkedOn}. Opening it checks the sheet again.` : undefined}>{notes.length === 1 ? "1 sheet problem" : `${notes.length} sheet problems`}</button></>}
        </p>
      )}
      {pgErr && <ArDataError err={pgErr} retry={loadPg} />}
      {flash && <p className={`hint ${flash.ok ? "ok-text" : "err-text"} arb-flash`} role="status">{flash.text}</p>}

      {data?.firstRun && (
        <div className="arb-card-note">
          <CheckCircle2 size={16} />
          <span>Brought in {data.firstRun.found} {data.firstRun.found === 1 ? "person" : "people"} from your OUTREACH tab. Nothing in the sheet changed.</span>
          <button className="btn ghost sm" onClick={() => act(() => arPost({ action: "dismissFirstRun" }))} disabled={busy}>Dismiss</button>
        </div>
      )}
      {(data?.givenMismatch || []).length > 0 && (
        <div className="attn arb-check">
          <div className="attn-head"><AlertTriangle size={15} /> Changes to check</div>
          {data.givenMismatch.map((g) => (
            <div key={g.prospectId} className="attn-row">
              <span>{g.name}: the sheet says "{g.sheet || "blank"}" for 'Advance given?', the dashboard last saved "{g.remembered || "blank"}".</span>
              <span className="arb-row-actions">
                <button className="btn ghost sm" disabled={busy} onClick={() => act(() => arWrite({ action: "fixGiven", prospectIds: [g.prospectId], use: "sheet" }))}>Keep the sheet version</button>
                <button className="btn ghost sm" disabled={busy || !canSave} title={paused} onClick={() => act(() => arWrite({ action: "fixGiven", prospectIds: [g.prospectId], use: "remembered" }))}>Put back "{g.remembered || "blank"}"</button>
              </span>
            </div>
          ))}
        </div>
      )}
      {(data?.changesToCheck || []).length > 0 && (
        <div className="attn arb-check">
          <div className="attn-head"><AlertTriangle size={15} /> Saves to double-check</div>
          {data.changesToCheck.map((c, i) => <div key={c.id || i} className="attn-row"><span>{c.text || String(c)}</span></div>)}
        </div>
      )}

      {!pg && !pgErr && <p className="muted dash-wait">Loading…</p>}
      {pg && view === "board" && (
        <div className={`arb-board${drag ? " dragging" : ""}`}>
          {cols.map((c) => {
            const opened = isOpen(c.id), drop = drag && canMoveTo(c.id);
            const dropOk = (e) => { e.preventDefault(); if (over !== c.id) setOver(c.id); };
            return (
              <section key={c.id} className={`arb-col${opened ? "" : " folded"}${over === c.id ? " over" : ""}`} data-col={c.id} data-stage={c.id}
                onDragOver={drop ? dropOk : undefined} onDragEnter={drop ? dropOk : undefined}
                onDragLeave={drop ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver((o) => (o === c.id ? null : o)); } : undefined}
                onDrop={drop ? (e) => { e.preventDefault(); const card = shown.find((x) => x.key === drag); setDrag(null); setOver(null); if (card) moveTo(card, c.id); } : undefined}>
                <button className="arb-col-head" onClick={() => setFolds({ ...folds, [c.id]: !opened })} aria-expanded={opened}>
                  <span className="arb-col-title"><i className="arb-dot" aria-hidden="true" /><span className="arb-col-label">{c.label}</span> <span className="arb-n">{c.cards.length}</span></span>
                  <span className="arb-hint">{c.hint}</span>
                </button>
                <div className="arb-cards">
                  {c.id === "reach" && (
                    <form onSubmit={quickAdd} className="arb-quick">
                      <input placeholder="Add a producer…" value={quick} onChange={(e) => setQuick(e.target.value)} disabled={!canSave || busy} title={paused} aria-label="Add a producer" />
                    </form>
                  )}
                  {c.cards.map((card) => (
                    <ArCard key={card.key} c={card} canSave={canSave} paused={paused} busy={!!card.moving} canDrag={canDrag}
                      onOpen={(e) => openCard(card, e)} onMove={(st) => moveTo(card, st)}
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", card.key); } catch { /* old browsers */ } setDrag(card.key); }}
                      onDragEnd={() => { setDrag(null); setOver(null); }} />
                  ))}
                  {!c.cards.length && c.id !== "reach" && <p className="arb-empty">{drop ? "Drop here" : "Nobody here yet"}</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {pg && view === "list" && (
        <>
          {passedOnly && <p className="arb-status">Passed ({passed.length}) · <button className="inline-link" onClick={() => setPassedOnly(false)}>Show everyone</button></p>}
          <ArList rows={passedOnly ? passed : shown} onOpen={openCard} />
        </>
      )}

      <div className="arb-foot">
        {view === "board" && <><button className="inline-link arb-passed" onClick={() => { setView("list"); setPassedOnly(true); }}>Passed ({passed.length})</button><span aria-hidden="true">·</span></>}
        <button className="inline-link" onClick={() => setShowOff(true)}>Off the board ({offBoard.length})</button>
      </div>

      <ArPanels ar={ar} open={open} openPanel={openPanel} closePanel={closePanel} onGo={onGo} />
      {showOff && <OffBoardList items={offBoard} live={live} canSave={canSave} onClose={() => setShowOff(false)} reload={reload} />}
      {showCheck && <SheetCheck readProblems={data?.sheet?.problems} onClose={() => setShowCheck(false)} onRan={load} />}
    </div>
  );
}

// A card: who, how to reach them, a producer's numbers, the follow-up, and ONE next step (the ⋯ menu
// has the rest). A producer's buttons wait for the sheet; an artist's don't need it.
function ArCard({ c, canSave, paused, busy, canDrag, onOpen, onMove, onDragStart, onDragEnd }) {
  // the ⋯ menu is placed on the screen itself, so a column that scrolls can't cut it off. It opens
  // upward when there's no room below, follows its button while the page or column scrolls, and
  // closes once the button is off screen
  const [menu, setMenu] = useState(null);
  const dots = useRef(null);
  useEscape(() => setMenu(null), !!menu);
  const place = () => {
    const r = dots.current?.getBoundingClientRect();
    if (!r || r.bottom < 0 || r.top > window.innerHeight) return null;
    const up = window.innerHeight - r.bottom < 160;
    return { right: Math.max(8, window.innerWidth - r.right), ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) };
  };
  const isOpen = !!menu;
  useEffect(() => {
    if (!isOpen) return undefined;
    const follow = () => setMenu(place());
    window.addEventListener("scroll", follow, true); window.addEventListener("resize", follow);
    return () => { window.removeEventListener("scroll", follow, true); window.removeEventListener("resize", follow); };
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = () => setMenu(menu ? null : place());
  const next = stepFrom(c.stage, 1), back = stepFrom(c.stage, -1);
  const off = (c.role === "producer" && !canSave) || busy;
  const s = c.s;
  return (
    <div className={`arb-card${c.moving ? " moving" : ""}`} data-card={c.key} draggable={canDrag && !off} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <button className="arb-card-open" data-focus={c.key} onClick={onOpen} disabled={c.role === "producer" && !s} title={c.role === "producer" && !s ? "Waiting for the pub sheet" : undefined}>
        <span className="arb-card-top">
          <span className="arb-name" title={c.name}>{c.name}</span>
          {c.role === "producer" && s && <b className="arb-val">≈ {wholeMoney(s.money.totalEstValue)}</b>}
        </span>
        <span className="arb-contact">{c.role === "artist" ? "Artist" : "Producer"}{c.contact ? ` · ${c.contact}` : ""}{c.clientId && <> <span className="tag" data-tone="pos">Client</span></>}</span>
        {c.status === "Researching" && <span className="arb-sub">Researching</span>}
        {c.role === "producer" && s && <span className="arb-money">{bigNum(s.money.netStreams)} streams (their share)</span>}
        {c.followUp?.on && <span className="arb-tags">{followChip(c.followUp)}</span>}
      </button>
      <div className="arb-card-acts">
        {next && <button className="btn ghost sm arb-next" data-stage={next.id} onClick={() => onMove(next.id)} disabled={off} title={c.role === "producer" ? paused : undefined}>{next.verb}</button>}
        <span className="arb-more" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenu(null)}>
          <button ref={dots} className="btn ghost sm arb-dots" aria-label={`More for ${c.name}`} aria-haspopup="menu" aria-expanded={!!menu} onClick={toggle}>⋯</button>
          {menu && (
            <div className="arb-menu arb-menu-fixed" role="menu" style={menu}>
              {back && <button role="menuitem" disabled={off} onClick={() => { setMenu(null); onMove(back.id); }}>Move back to {back.label}</button>}
              {c.stage !== "passed" && <button role="menuitem" disabled={off} onClick={() => { setMenu(null); onMove("passed"); }}>Mark as passed</button>}
              <button role="menuitem" onClick={(e) => { setMenu(null); onOpen(e); }}>Open details</button>
            </div>
          )}
        </span>
      </div>
    </div>
  );
}

// The Board's list view (More ▾ › Show as a list, and Passed)
function ArList({ rows, onOpen }) {
  const cols = "minmax(0,1.6fr) minmax(0,1fr) minmax(0,.8fr) minmax(0,.8fr) minmax(0,.8fr)";
  if (!rows.length) return <div className="admin-empty">Nobody here yet.</div>;
  return (
    <div className="admin-table arb-list ar-table">
      <div className="admin-row admin-hd" style={{ "--cols": cols }}>
        <span data-col="name">Name</span><span data-col="stage">Stage</span><span data-col="contact">Last contact</span><span data-col="follow">Next follow-up</span><span data-col="value">≈ Value</span>
      </div>
      {rows.map((c) => (
        <button key={c.key} className="admin-row ar-link" data-focus={`list:${c.key}`} style={{ "--cols": cols }} onClick={(e) => (c.role !== "producer" || c.s) && onOpen(c, e)}>
          <span className="cell ar-who" data-col="name"><strong>{c.name}</strong><span className="ar-who-sub">{c.role === "artist" ? "Artist" : "Producer"}{c.contact ? ` · ${c.contact}` : ""}</span></span>
          <span className="cell" data-col="stage">{c.stage === "other" ? <StagePill id="other" label={c.status} /> : <StagePill id={c.stage} />}</span>
          <span className="cell" data-col="contact">{c.lastContact ? shortDay(c.lastContact) : c.lastText || <span className="muted-dash">—</span>}</span>
          <span className="cell" data-col="follow">{c.followUp?.on ? shortDay(c.followUp.on) : <span className="muted-dash">—</span>}</span>
          <span className="cell" data-col="value">{c.role === "producer" && c.s ? `≈ ${wholeMoney(c.s.money.totalEstValue)}` : <span className="muted-dash">—</span>}</span>
        </button>
      ))}
    </div>
  );
}

// Watchlist: everyone and every song tracked (and every row of the A&R Luminate lists), up or down
const SORTS = { name: (r) => String(r.name ?? r.title ?? "").toLowerCase(), current: (r) => r.current, changePct: (r) => r.changePct, atd: (r) => r.atd, value: (r) => r.value };
const SHOW_TABS = [["everyone", "Everyone"], ["artists", "Artists"], ["producers", "Producers"]];
// the Watchlist opens in the server's order: biggest week-on-week % first, no % last (by this week's streams)
function ArWatch({ ar, onGo, at }) {
  const { data, pg, pgErr, loadPg } = ar;
  const [pill, setPill] = useState(at?.pill || "people");
  const [show, setShow] = useState("everyone");
  const [find, setFind] = useState("");
  const [onlyNone, setOnlyNone] = useState(!!at?.noNumbers);
  const [sort, setSort] = useState({ k: "changePct", dir: -1, server: true }); // biggest % first (the server's order) until a column is clicked
  const [lit, setLit] = useState(null); // the row a Summary click points at, lit for about 2 seconds
  const [showToLum, setShowToLum] = useState(false);
  const { open, openPanel, closePanel } = usePanel();
  const { cards, sheetById } = arCards(data, pg);
  const stageBy = Object.fromEntries(cards.map((c) => [c.key, c.stage]));
  const tracked = Object.fromEntries((pg?.tracked || []).map((t) => [t.id, t]));
  const nameOfPerson = (id) => (pg?.watch?.people || []).find((r) => r.ref?.id === id)?.name || "";
  const people = (pg?.watch?.people || []).map((r) => {
    const s = r.ref?.type === "prospect" ? sheetById[r.ref.id] : null, t = r.ref?.type === "tracked" ? tracked[r.ref.id] : null;
    const key = r.ref ? `${r.ref.type === "prospect" ? "p" : "t"}:${r.ref.id}` : r.key;
    return { ...r, handle: s?.contact || t?.handle || "", value: s ? s.money.totalEstValue : null, stage: stageBy[key] ?? r.stage,
      lastContact: s?.lastContact?.date || t?.lastContact || null, lastText: s?.lastContact?.text || "" };
  });
  const songs = (pg?.watch?.songs || []).map((r) => ({ ...r, name: r.title, tiedTo: r.personId ? nameOfPerson(r.personId) : "" }));
  const needle = find.trim().toLowerCase();
  const list = (pill === "people" ? people.filter((r) => show === "everyone" || (show === "artists" ? r.role === "artist" : r.role === "producer")) : songs)
    .filter((r) => !needle || `${r.name} ${r.handle || ""} ${r.artist || ""}`.toLowerCase().includes(needle))
    .filter((r) => !onlyNone || needsLumRow(r));
  const by = SORTS[sort.k];
  const rows = sort.server ? list : [...list].sort((a, b) => {
    const x = by(a), y = by(b);
    if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1; // no numbers sink to the bottom
    return (x < y ? -1 : x > y ? 1 : 0) * (sort.k === "name" ? -sort.dir : sort.dir);
  });
  // a signed client's row opens their page on Publishing, not the add form
  const openRow = (r, e) => (r.clientId && !r.ref ? onGo("catalog", `client:${r.clientId}`)
    : openPanel(r.ref ? { type: r.ref.type, id: r.ref.id } : { type: "add", kind: pill === "songs" ? "song" : "artist", prefill: { name: r.name, luminateId: r.luminateId, nums: r.current != null ? { thisWeek: r.current, wowPct: r.changePct ?? null, atd: r.atd ?? null } : null } }, e));
  // Summary's row click: open that person's panel once it has drawn, or (a Luminate-only row) light it up
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || !pg) return;
    if (at?.flash) {
      jumped.current = true; setLit(at.flash);
      document.querySelector(`.ar-watch-list [data-key="${CSS.escape(at.flash)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!at?.open || !data) return;
    jumped.current = true;
    const r = [...people, ...songs].find((x) => x.key === at.open);
    if (r) openRow(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pg, data]);
  useEffect(() => { if (!lit) return undefined; const t = setTimeout(() => setLit(null), 2000); return () => clearTimeout(t); }, [lit]);
  // each list's own dates (Artists and Songs are often exported on different days)
  const period = pg?.watch?.periods?.[pill] || null;
  const to = period?.to, old = to && daysSince(to) > 8;
  const head = (k, label, col) => (
    <span data-col={col}>
      <button className={`ar-sort${sort.k === k && !sort.server ? " on" : ""}`} onClick={() => setSort({ k, dir: sort.k === k && !sort.server ? -sort.dir : -1 })} aria-label={`Sort by ${label}`}>
        {label}{sort.k === k && !sort.server ? (sort.dir < 0 ? " ↓" : " ↑") : ""}
      </button>
    </span>
  );
  const producers = pill === "people" && show === "producers";
  // 700–1199px: People has no room for All-time as well (its heads were cut off at 1024); a row's panel still has it
  const tight = useMedia("(min-width: 700px) and (max-width: 1199px)") && pill === "people";
  const cols = pill === "songs" ? "minmax(0,2.2fr) 118px minmax(0,.9fr) minmax(0,.9fr)"
    : `minmax(0,1.7fr) 112px minmax(84px,.8fr)${tight ? "" : " minmax(84px,.8fr)"} minmax(112px,1fr) minmax(104px,.8fr)${producers ? " minmax(84px,.8fr)" : ""}`;
  const dash = (title) => <span className="muted-dash" title={title}>—</span>;
  const subOf = (r) => (pill === "people" ? [r.role === "producer" ? "Producer" : "Artist", r.handle]
    : [r.artist || (r.release ? "Release" : ""), r.tiedTo && `tied to ${r.tiedTo}`]).filter(Boolean).join(" · ");
  const rowKey = (e, r) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openRow(r, e); } };
  return (
    <div className="ar-watch">
      <ArHead sub="Everyone and every song we're tracking, and whether they're up or down.">
        <button className="btn sm" data-focus="add" onClick={(e) => openPanel({ type: "add", kind: pill === "songs" ? "song" : show === "producers" ? "producer" : "artist" }, e)}><Plus size={15} /> Add</button>
      </ArHead>
      {pgErr && <ArDataError err={pgErr} retry={loadPg} />}
      <p className="arb-status ar-period">
        {to ? <span>{old ? "Latest week" : "This week"}: {dayRange(period.from, to)} · compared with {dayRange(shiftDay(period.from, -7), shiftDay(to, -7))}</span> : "No numbers from your Luminate A&R lists yet."}
        {(old || (pg && !to)) && <button className="btn ghost sm" onClick={() => onGo("luminate", "drop")}>Drop new exports</button>}
      </p>
      <div className="ar-watch-tools">
        <span className="gainer-tabs" role="tablist" aria-label="People or songs">
          {[["people", "People", people.length], ["songs", "Songs", songs.length]].map(([id, label, n]) => (
            <button key={id} role="tab" aria-selected={pill === id} className={pill === id ? "active" : ""} onClick={() => { setPill(id); setOnlyNone(false); }}>{label} <span className="arb-n">{n}</span></button>
          ))}
        </span>
        {pill === "people" && (
          <span className="gainer-tabs ar-show" role="tablist" aria-label="Show">
            {SHOW_TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={show === id} className={show === id ? "active" : ""} onClick={() => setShow(id)}>{label}</button>)}
          </span>
        )}
        <input className="arb-find" type="search" placeholder={pill === "people" ? "Find someone" : "Find a song"} value={find} onChange={(e) => setFind(e.target.value)} aria-label="Find" />
        {onlyNone && <button className="inline-link" onClick={() => setOnlyNone(false)}>Showing only those with no numbers · show all</button>}
      </div>
      {producers && <ArTotals data={data} />}
      {!pg && !pgErr && <p className="muted dash-wait">Loading…</p>}
      {pg && !rows.length && (
        <div className="admin-empty">{pill === "people" ? "Nobody here yet." : "No songs tracked yet."} <button className="btn sm" onClick={(e) => openPanel({ type: "add", kind: pill === "songs" ? "song" : "artist" }, e)}><Plus size={15} /> Add</button></div>
      )}
      {pg && rows.length > 0 && (
        <div className="admin-table ar-watch-list ar-table" data-pill={pill}>
          <div className="admin-row admin-hd" style={{ "--cols": cols }}>
            {head("name", pill === "people" ? "Name" : "Title", "name")}{head("changePct", "vs last week", "pct")}{head("current", "This week", "week")}{!tight && head("atd", "All-time", "atd")}
            {pill === "people" && <><span data-col="stage">Stage</span><span data-col="contact">Last contact</span></>}
            {producers && head("value", "≈ Value", "value")}
          </div>
          {rows.map((r) => {
            const sub = subOf(r);
            return (
              <div key={r.key} role="button" tabIndex={0} className={`admin-row ar-link ar-row${lit === r.key ? " ar-flash" : ""}`} data-focus={`w:${r.key}`} data-key={r.key} style={{ "--cols": cols }}
                onClick={(e) => openRow(r, e)} onKeyDown={(e) => rowKey(e, r)}>
                <span className="cell ar-who" data-col="name"><strong>{r.name}</strong>
                  {(sub || needsLumRow(r)) && (
                    <span className="ar-who-sub">
                      {sub && <span>{sub}</span>}
                      {/* added here but not in Luminate yet: the same list the To do opens */}
                      {needsLumRow(r) && <button type="button" className="ar-lum-chip" onClick={(e) => { e.stopPropagation(); setShowToLum(true); }}>Add to Luminate</button>}
                    </span>
                  )}
                  {r.clientId ? <span className="tag ar-client-tag" data-tone="pos" title="One of our signed clients">Client</span>
                    : r.fromLuminate && <span className="ar-add-hint" aria-hidden="true">+ Add details</span>}
                </span>
                <span className="cell" data-col="pct">{r.current == null ? dash("No numbers yet") : r.changePct == null ? dash("No last week to compare") : <WowPill pct={r.changePct} />}</span>
                <span className="cell ar-num" data-col="week">{r.current == null ? <>{dash()}<em>No numbers yet</em></> : <><b>{fmt(r.current)}</b><em> {old ? "that week" : "this week"}</em></>}</span>
                {!tight && <span className="cell ar-num" data-col="atd">{r.atd == null ? dash() : fmt(r.atd)}</span>}
                {pill === "people" && <>
                  <span className="cell" data-col="stage">{r.stage ? <StagePill id={r.stage} /> : dash()}</span>
                  <span className="cell" data-col="contact">{r.lastContact ? shortDay(r.lastContact) : r.lastText || dash()}</span>
                </>}
                {producers && <span className="cell ar-num" data-col="value">{r.value != null ? `≈ ${wholeMoney(r.value)}` : dash()}</span>}
              </div>
            );
          })}
        </div>
      )}
      <ArPanels ar={ar} open={open} openPanel={openPanel} closePanel={closePanel} onGo={onGo} />
      {showToLum && pg?.toLuminate && <ArToLuminateModal t={pg.toLuminate} onGo={onGo} onClose={() => setShowToLum(false)} />}
    </div>
  );
}

// The sheet's Year 1 is the run-rate (B9) less one year's decay (B8): H × B9 × (1 − I), so 30% and 25%
// make 22.5%. Say that share, not B9 alone, or a hand check comes out a third too high. One decimal,
// so 22.5% never shows as 23%. null when either lever is missing.
const pct1 = (x) => `${Math.round(x * 1000) / 10}%`;
// "how" says it in words: "30% of all-time a year, less a quarter of that"
const FRACTION_WORDS = { 0.5: "half", 0.25: "a quarter", 0.2: "a fifth", 0.1: "a tenth", 0.75: "three quarters" };
const partWords = (x) => FRACTION_WORDS[Math.round(x * 1e6) / 1e6] || (Math.abs(x - 1 / 3) < 1e-6 ? "a third" : pct1(x));
const yearOne = (a) => (a?.runRate != null && a?.decayRate != null
  ? { share: pct1(a.runRate * (1 - a.decayRate)), run: pct1(a.runRate), decay: pct1(a.decayRate), how: `${pct1(a.runRate)} of all-time a year, less ${partWords(a.decayRate)} of that` } : null);

// Show › Producers: three whole-dollar tiles from OUTREACH's row-1 totals exactly as the sheet works
// them out (never summed here); the rest of that row sits under How we estimate
function ArTotals({ data }) {
  if (!data) return <p className="muted">Reading the OUTREACH tab…</p>;
  const t = data.totals, a = data.assumptions, b = data.budget;
  if (!t) return null;
  const cut = a?.adminFeeRate != null ? `${Math.round(a.adminFeeRate * 100)}%` : "cut";
  // the adminFee total is OUTREACH's own cut of their earnings so far, so its % comes from those two numbers;
  // nobody has paid it: it's what we'd have earned had they been signed
  const feeCut = t.grossRevenue > 0 && t.adminFee != null ? `${Math.round((t.adminFee / t.grossRevenue) * 100)}%` : cut;
  const tiles = [["totalValue", "Total est. value", t.totalValue], ["adminFee", `Our ${feeCut} of their earnings to date (if signed)`, t.adminFee], ...(b ? [["budgetLeft", "Advance budget left", b.remaining]] : [])];
  const rest = [["grossStreams", "Their streams", bigNum], ["netStreams", "Their share of streams", bigNum], ["grossRevenue", "Est. earnings pool", wholeMoney], ["threeYear", "Next 3 years (our cut)", wholeMoney]];
  return (
    <div className="ar-totals">
      <div className="cat-summary"><div className="cat-summary-grid ar-totals-grid">
        {tiles.map(([k, label, v]) => (
          <div key={k} className="cat-stat" data-total={k} data-value={v ?? ""}><span className="cat-stat-label">{label}</span><span className="cat-stat-val">{v == null ? "—" : wholeMoney(v)}</span></div>
        ))}
      </div></div>
      <details className="ar-how">
        <summary>How we estimate</summary>
        <p className="ar-how-nums">{rest.map(([k, label, f]) => <span key={k} data-total={k} data-value={t[k] ?? ""}>{label} <b>{t[k] == null ? "—" : f(t[k])}</b></span>)}</p>
        <p>Streams × their share × ${a?.blendedRate ?? "—"} a stream = their earnings so far; we keep {cut}. Year 1 = {yearOne(a) ? `${yearOne(a).share} of those earnings (${yearOne(a).how})` : "a set share of those earnings"}, then {a?.decayRate != null ? pct1(a.decayRate) : "a set amount"} less each year. These come from the ASSUMPTIONS tab.</p>
        {b && <p className="ar-budget">Advance budget {wholeMoney(b.starting)} · given {wholeMoney(b.committed)} · left {wholeMoney(b.remaining)}</p>}
      </details>
    </div>
  );
}

// short numbers and times for the cards and status lines
const statusTone = (s = "") => /signed/i.test(s) ? "pos" : /offer/i.test(s) ? "warn" : /talk|negotiat/i.test(s) ? "info" : /not contacted|pass|declin/i.test(s) ? "muted" : undefined;
// (rounded half up: toFixed alone reads 14,450,000 as "14.4M", binary floats)
const roundMoney = (n) => { const a = Number(n) || 0; return `$${fmt(a >= 1000 ? Math.round(a / 100) * 100 : Math.round(a / 10) * 10)}`; };
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "");
const weekday = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" });

// "Off the board": removed by staff, or gone from the sheet. Put back writes them into a free row;
// "Same person as…" folds a record into someone already on the board (Postgres only)
function OffBoardList({ items, live, canSave, onClose, reload }) {
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [into, setInto] = useState({});
  useEscape(onClose, !busy);
  const run = async (id, fn) => {
    setBusy(id); setErr(null);
    try { await fn(); await reload(); } catch (e) { setErr(e.message); }
    setBusy(null);
  };
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal-card arb-off">
        <div className="modal-head"><h3>Off the board ({items.length})</h3><button onClick={onClose} aria-label="Close" disabled={!!busy}><X size={18} /></button></div>
        <div className="modal-body">
          <p className="muted mb">Their songs, notes and history are kept. Put back returns them to a free row in the OUTREACH tab.</p>
          {err && <p className="hint err-text">{err}</p>}
          {!items.length && <p className="arb-empty">Nobody is off the board.</p>}
          {items.map((o) => (
            <div key={o.id} className="arb-off-row">
              <div className="arb-off-who">
                <span className="arb-name">{o.name}</span>
                <span className="arb-contact">{o.why === "gone from the sheet" ? "Gone from the sheet" : "Removed"}{o.removedAt ? ` · ${shortDay(o.removedAt)}` : ""}</span>
              </div>
              <div className="arb-off-actions">
                <button className="btn sm" disabled={!!busy || !canSave} title={canSave ? undefined : "Saving is paused until the pub sheet can be read again."}
                  onClick={() => run(o.id, () => arWrite({ action: "restoreProspect", prospectId: o.id }))}>{busy === o.id ? "Putting back…" : "Put back"}</button>
                {live.length > 0 && (
                  <span className="arb-merge">
                    <select value={into[o.id] || ""} onChange={(e) => setInto({ ...into, [o.id]: e.target.value })} aria-label={`${o.name} is the same person as…`}>
                      <option value="">Same person as…</option>
                      {live.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <button className="btn ghost sm" disabled={!!busy || !into[o.id]} onClick={() => run(o.id, () => arPost({ action: "mergeProspect", fromId: o.id, intoId: into[o.id] }))}>Merge</button>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="modal-foot"><button className="btn ghost sm" onClick={onClose} disabled={!!busy}>Close</button></div>
      </div>
    </div>
  );
}

// A check that failed and a sheet-read problem about the same thing are one problem (the read's words win)
const CHECK_TWIN = { statuses: "statusesBuiltIn", advanceRows: "advanceUnmapped", assumptions: "assumptionsOdd", totalRow: "noTotalRow" };
function sheetProblems(read = [], checks = []) {
  const ids = new Set((read || []).map((p) => p.id));
  return [...(read || []).map((p) => p.text || String(p)), ...(checks || []).filter((c) => !ids.has(CHECK_TWIN[c.id])).map((c) => c.fix || c.text)];
}
// Sheet check (spec 5.7): read-only, so it's safe to run against the real sheet before any save.
// What needs fixing comes first, in plain words; every check it ran sits under Technical details.
function SheetCheck({ readProblems = [], onClose, onRan }) {
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const run = () => {
    setRes(null); setErr(null);
    fetch("/api/ar-data?check=1").then((r) => r.json())
      .then((d) => { if (d.error) throw new Error(d.error); setRes(d); onRan?.(); })
      .catch((e) => setErr(e.message || "Couldn't check the pub sheet just now."));
  };
  useEffect(run, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEscape(onClose);
  const notes = sheetProblems(readProblems, (res?.checks || []).filter((c) => !c.ok));
  const bad = notes.length;
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card arb-sheetcheck">
        <div className="modal-head"><h3>Sheet check</h3><button onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-body">
          <p className="muted mb">Reads the OUTREACH, ADVANCE CALCULATOR and ASSUMPTIONS tabs and checks they're laid out the way the dashboard expects. It doesn't change anything in the sheet.</p>
          {err && <ArDataError err={err} retry={run} />}
          {!res && !err && <p className="muted">Checking the sheet…</p>}
          {res && <p className={`hint ${bad ? "err-text" : "ok-text"} mb`}>{bad ? `${bad === 1 ? "1 thing" : `${bad} things`} to fix in the sheet before saving from here:` : "Everything looks right."}</p>}
          {res && notes.map((t) => <p key={t} className="arb-banner warn arb-note ar-sheet-problem"><AlertTriangle size={16} /><span>{t}</span></p>)}
          {res && (
            <details className="arb-tech">
              <summary>Technical details</summary>
              <ul className="arb-checks">
                {res.checks.map((c) => (
                  <li key={c.id} className={c.ok ? "ok" : "bad"}>{c.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}<span>{c.text}</span></li>
                ))}
              </ul>
            </details>
          )}
        </div>
        <div className="modal-foot"><button className="btn ghost sm" onClick={run} disabled={!res && !err}>Check again</button><button className="btn sm" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

const BLANK_SONGS = [1, 2, 3, 4, 5].map((slot) => ({ slot, streams: "", writerShare: "" }));
const FIELD_LABEL = { name: "Name", contact: "Contact", status: "Status", lastContact: "Last contacted", notes: "Notes", given: "'Advance given?'" };
const fieldLabel = (f) => FIELD_LABEL[f] || f.replace(/^slot(\d)\.(streams|share)$/, (_, n, k) => `Song ${n} ${k === "streams" ? "streams" : "writer %"}`);
const showVal = (f, v) => (v === "" || v == null ? "blank" : /\.share$/.test(f) && typeof v === "number" ? `${Math.round(v * 1e6) / 1e4}%` : typeof v === "number" ? fmt(v) : String(v));

// The prospect panel (spec 14 S2), and the same form for a new prospect. Name, contact, notes,
// last contacted and the 5 song slots save together in one click (one createProspect, or one
// updateProspect carrying only what was changed, each with the value this panel opened with as
// `expect`); the status and "Advance given?" save at once. The preview totals are computed the way
// the sheet computes them: Net Streams is the sum of each slot's own streams × its own writer %.
function ProspectForm({ prospect, pg, blendedRate, assume, canSave = true, reload, onClose, onChanged, title, picker, extra }) {
  const isNew = !prospect;
  const [base] = useState(prospect); // what this panel opened with: the `expect` of every Save
  const [name, setName] = useState(prospect?.name || "");
  const [contact, setContact] = useState(prospect?.contact || "");
  const [status, setStatus] = useState(prospect ? prospect.status || "" : "Not Contacted"); // a new one starts in To reach out
  const [notes, setNotes] = useState(prospect?.notes || "");
  const [lastContact, setLastContact] = useState(prospect?.lastContact?.date || "");
  const startSongs = base ? base.songs.map((s) => ({ ...s, streams: s.streams || "", writerShare: s.writerShare || "" })) : BLANK_SONGS;
  const [songs, setSongs] = useState(startSongs);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null); // {text, reload?}
  const [ok, setOk] = useState(null);
  const [conflict, setConflict] = useState(null); // {list, send}
  const [events, setEvents] = useState(null);
  const startSongsNow = base ? base.songs : BLANK_SONGS;
  const dirty = isNew
    ? !!(name.trim() || contact.trim() || notes.trim() || songs.some((s) => s.streams !== "" || s.writerShare !== ""))
    : name !== base.name || contact !== (base.contact || "") || notes !== (base.notes || "") || lastContact !== (base.lastContact?.date || "")
      || songs.some((s, i) => String(s.streams) !== String(startSongsNow[i]?.streams || "") || String(s.writerShare) !== String(startSongsNow[i]?.writerShare || ""));
  const guard = useDirtyGuard(dirty, onClose);
  useEscape(guard.tryClose, !busy && !conflict); // as Cancel, which is off while saving
  const loadEvents = () => !isNew && fetch(`/api/ar?events=${encodeURIComponent(prospect.id)}`).then((r) => r.json()).then((d) => setEvents(d.events || [])).catch(() => setEvents([]));
  useEffect(() => { loadEvents(); }, []);
  const setSong = (slot, patch) => setSongs(songs.map((s) => (s.slot === slot ? { ...s, ...patch } : s)));
  const paused = canSave ? undefined : "Saving is paused until the pub sheet can be read again.";

  const grossStreams = songs.reduce((sum, s) => sum + (Number(s.streams) || 0), 0);
  const netStreams = songs.reduce((sum, s) => sum + (Number(s.streams) || 0) * ((Number(s.writerShare) || 0) / 100), 0);
  const estRevenue = netStreams * blendedRate;

  // a refusal in plain words: a hand edit meanwhile opens the conflict dialog, a moved row asks for a reload
  const fail = (e, send) => {
    if (e.conflict?.length && send) setConflict({ list: e.conflict, send });
    else setErr({ text: e.message, reload: !!e.reload });
    setBusy(false);
  };
  const after = async (r, keepOpen) => {
    if (keepOpen) { await reload?.(); loadEvents(); setBusy(false); setOk(r?.note || "Saved ✓"); }
    else await onChanged(r);
  };
  const send = async (body, keepOpen = false) => {
    setBusy(true); setErr(null); setOk(null);
    try { await after(await arWrite(body), keepOpen); } catch (e) { fail(e, body); }
  };

  // a slot as the sheet holds it: streams, and the writer % as a 0-1 fraction (blank = cleared)
  const slotOf = (s) => ({ slot: s.slot, streams: s.streams === "" ? null : Number(s.streams), share: s.writerShare === "" ? null : Number(s.writerShare) / 100 });
  const save = async () => {
    if (!name.trim()) return;
    if (isNew) return send({ action: "createProspect", name: name.trim(), contact: contact.trim(), status, notes: notes.trim(), slots: songs.filter((s) => s.streams !== "" || s.writerShare !== "").map(slotOf) });
    // only what changed is sent, each with the value this panel opened with, so a hand edit in the
    // sheet meanwhile (to any field) is never overwritten
    const changes = {}, expect = {};
    if (name.trim() !== base.name) { changes.name = name.trim(); expect.name = base.cells.A; }
    if (contact.trim() !== base.contact.trim()) { changes.contact = contact.trim(); expect.contact = base.cells.B; }
    if (notes.trim() !== (base.notes || "").trim()) { changes.notes = notes.trim(); expect.notes = base.cells.Q; }
    if (lastContact !== (base.lastContact?.date || "")) { changes.lastContact = lastContact; expect.lastContact = base.cells.P; }
    // per cell, so a writer % shown rounded (33.3333) is never written back unless it was changed
    const slots = songs.map((s, i) => {
      const was = startSongs[i], out = { slot: s.slot }, cell = slotOf(s);
      if (String(s.streams) !== String(was.streams)) out.streams = cell.streams;
      if (String(s.writerShare) !== String(was.writerShare)) out.share = cell.share;
      return out;
    }).filter((x) => "streams" in x || "share" in x);
    if (slots.length) { changes.slots = slots; expect.slots = slots.map((s) => base.cells.slots[s.slot - 1]); }
    if (!Object.keys(changes).length) return onClose();
    return send({ action: "updateProspect", prospectId: base.id, changes, expect });
  };
  // [Use mine]: the same save again, now expecting what the sheet holds for the fields that clashed
  const useMine = () => {
    const body = JSON.parse(JSON.stringify(conflict.send));
    for (const c of conflict.list) {
      const m = /^slot(\d)\.(streams|share)$/.exec(c.field);
      if (m) { const e = (body.expect.slots || []).find((x) => Number(x.slot) === Number(m[1])); if (e) e[m[2]] = c.sheet; }
      else if (body.action === "setGiven") body.expect = { given: c.sheet };
      else if (body.action === "setStatus") body.expect = c.sheet;
      else body.expect[c.field] = c.sheet;
    }
    setConflict(null);
    send(body, body.action !== "updateProspect");
  };
  const keepSheets = async () => { setConflict(null); setBusy(true); await onChanged(); };
  const saveStatus = (st) => { if (!st || st === prospect.status) return; setStatus(st); send({ action: "setStatus", prospectId: base.id, status: st, expect: prospect.cells.O ?? "" }, true); };
  const saveGiven = (v) => v && send({ action: "setGiven", prospectId: base.id, given: v === "Yes", expect: { given: prospect.advance?.given ?? "" } }, true);
  const logContact = () => send({ action: "logContact", prospectId: base.id, expect: { lastContact: prospect.cells.P ?? "", status: prospect.cells.O ?? "" } }, true);
  const undo = (id) => send({ action: "undo", eventId: id }, true);
  const [askOff, setAskOff] = useState(false);
  const deleteProspect = async () => {
    setAskOff(false);
    await send({ action: "removeProspect", prospectId: prospect.id, expect: { A: prospect.cells.A } });
  };
  const adv = prospect?.advance;

  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && !busy && !conflict && guard.tryClose()}>
      <div className={`modal-card${isNew ? "" : " arb-panel"}`}>
        <div className="modal-head">
          <h3>{isNew ? title || "New prospect" : prospect.name}</h3>
          {/* the Board's stage names; the sheet status they stand for is what's saved (statusForStage) */}
          {!isNew && (
            <select className="arb-panel-status" value={stageOfStatus(prospect.status)} onChange={(e) => saveStatus(statusForStage(e.target.value, prospect.status))} disabled={busy || !canSave} title={paused} aria-label="Stage">
              {stageOfStatus(prospect.status) === "other" && <option value="other">{prospect.status}</option>}
              {[...AR_STAGES, { id: "passed", label: "Passed" }].map((st) => <option key={st.id} value={st.id}>{st.label}</option>)}
            </select>
          )}
          <button onClick={guard.tryClose} aria-label="Close" disabled={busy}><X size={18} /></button>
        </div>
        <div className="modal-body">
          {picker}
          {err && (
            <p className="hint err-text arb-err" role="alert">
              <span>{err.text}</span>
              {err.reload && <button className="btn ghost sm" onClick={() => onChanged()}>Reload</button>}
            </p>
          )}
          {ok && <p className="hint ok-text" role="status">{ok}</p>}
          {!canSave && !isNew && <p className="hint err-text">Couldn't read the pub sheet just now, so saving is paused. What you see is what it said last time.</p>}

          {!isNew && (
            <div className="arb-actions">
              <button className="btn ghost sm" onClick={logContact} disabled={busy || !canSave} title={paused}><Check size={14} /> Log contact</button>
              {pg?.followUp?.on && (pg.followUp.state ? followChip(pg.followUp)
                : <span className="arb-follow">Follow up: {new Date(`${pg.followUp.on}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>)}
            </div>
          )}

          <div className="arb-panel-grid">
            <div>
              <p className="fld-label mb">Contact</p>
              <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} />
              <Field label="Instagram, TikTok or email" value={contact} onChange={(e) => setContact(e.target.value)} />
              {isNew ? (
                <label className="fld"><span>Stage</span>
                  <select value={stageOfStatus(status)} onChange={(e) => setStatus(statusForStage(e.target.value, status))} aria-label="Stage">
                    {[...AR_STAGES, { id: "passed", label: "Passed" }].map((st) => <option key={st.id} value={st.id}>{st.label}</option>)}
                  </select>
                </label>
              ) : (
                <Field label="Last contacted" type="date" value={lastContact} onChange={(e) => setLastContact(e.target.value)} hint={!prospect.lastContact?.date && prospect.lastContact?.text ? `The sheet says "${prospect.lastContact.text}"` : undefined} />
              )}
              <Area label="Notes (also in the OUTREACH sheet)" value={notes} onChange={(e) => setNotes(e.target.value)} />

              <p className="fld-label mb" style={{ marginTop: 18 }}>Songs (up to 5) — Gross Streams and Writer %</p>
              {songs.map((s) => (
                <div key={s.slot} className="ar-song-row">
                  <span className="ar-song-num">{s.slot}</span>
                  <input type="number" placeholder="Gross streams" value={s.streams} onChange={(e) => setSong(s.slot, { streams: e.target.value })} aria-label={`Song ${s.slot} gross streams`} />
                  <input type="number" placeholder="Writer %" value={s.writerShare} onChange={(e) => setSong(s.slot, { writerShare: e.target.value })} aria-label={`Song ${s.slot} writer %`} />
                </div>
              ))}
              <p className="hint">The OUTREACH tab has 5 song slots; those feed the sheet's estimates.</p>
            </div>

            <div>
              <p className="fld-label mb">What they could earn us</p>
              <div className="cat-summary" style={{ marginBottom: 10 }}>
                {/* the sheet's total first and full width; short numbers so nothing is cut off */}
                <div className="cat-summary-grid ar-panel-tiles">
                  {!isNew && <div className="cat-stat ar-tile-wide"><span className="cat-stat-label">Total est. value</span><span className="cat-stat-val">≈ {wholeMoney(prospect.money.totalEstValue)}</span></div>}
                  <div className="cat-stat"><span className="cat-stat-label">Gross streams</span><span className="cat-stat-val">{bigNum(grossStreams)}</span></div>
                  <div className="cat-stat"><span className="cat-stat-label">Net streams (their share)</span><span className="cat-stat-val">{bigNum(netStreams)}</span></div>
                  {/* the writer's own all-time earnings, not ours: our cut (the sheet's admin fee) gets its own readable line under it */}
                  <div className="cat-stat ar-tile-wide"><span className="cat-stat-label">Their est. publishing earnings (all-time)</span><span className="cat-stat-val">{wholeMoney(estRevenue)}</span>{assume?.adminFeeRate != null && <span className="ar-tile-cut" data-our-cut>Our {Math.round(assume.adminFeeRate * 100)}% ≈ {wholeMoney(estRevenue * assume.adminFeeRate)}</span>}</div>
                </div>
              </div>
              <p className="hint arb-money-tip">Estimates, not payouts: all-time streams × their writer share × ${blendedRate} a stream (the rate in ASSUMPTIONS), from the OUTREACH tab's own formulas. Year 1 = {yearOne(assume) ? `${yearOne(assume).share} of their all-time earnings (${yearOne(assume).how})` : "a set share of their all-time earnings"}, then {assume?.decayRate != null ? pct1(assume.decayRate) : "a set amount"} less each year; we keep {assume?.adminFeeRate != null ? `${Math.round(assume.adminFeeRate * 100)}%` : "our cut"}. Real income depends on platform, country and deal.</p>
              {!isNew && (
                <label className="fld"><span>Advance given?</span>
                  <select value={adv?.given || ""} onChange={(e) => saveGiven(e.target.value)} disabled={busy || !canSave || !adv?.editable} title={adv?.editable ? paused : adv?.why || undefined}>
                    {!adv?.given && <option value="">Not answered</option>}
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </select>
                  {adv && !adv.editable && adv.why && <span className="hint">{adv.why}</span>}
                </label>
              )}

              {!isNew && extra}
              {!isNew && (
                <>
                  <p className="fld-label mb" style={{ marginTop: 18 }}>History</p>
                  {!events && <p className="muted">Loading…</p>}
                  {events && !events.length && <p className="arb-empty">Nothing yet.</p>}
                  {events && events.length > 0 && (
                    <ul className="arb-history">
                      {events.map((e) => (
                        <li key={e.id}>
                          <span><span className="arb-when">{shortDay(e.at)}</span> · {e.text}{e.status === "undone" ? " (undone)" : e.status === "failed" ? " (didn't save)" : ""}</span>
                          {e.undoable && <button className="btn ghost sm" onClick={() => undo(e.id)} disabled={busy || !canSave} title={paused}>Undo</button>}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        {guard.bar}
        <div className="modal-foot">
          {!isNew && <button className="btn ghost sm err-text arb-remove" onClick={() => setAskOff(true)} disabled={busy || !canSave} title={paused}>Remove from board</button>}
          <button className="btn ghost sm" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn sm" onClick={save} disabled={busy || !name.trim() || !canSave} title={paused}>{busy ? "Saving…" : isNew ? "Save" : "Save changes"}</button>
        </div>
      </div>
      {askOff && (
        <AskCard title={`Take ${prospect.name} off the board?`} goLabel="Remove from board" busyLabel="Removing…" go={deleteProspect} onClose={() => setAskOff(false)}>
          <p>Their row in the OUTREACH tab is cleared, including 'Advance given?'. Their songs, notes and history stay here, and 'Put back' returns them to the sheet.</p>
        </AskCard>
      )}
      {conflict && (
        <div className="modal arb-conflict" onClick={(e) => e.stopPropagation()}>
          <div className="modal-card">
            <div className="modal-head"><h3>Someone changed this in the sheet</h3></div>
            <div className="modal-body">
              {conflict.list.map((c) => (
                <p key={c.field} className="mb">While you were editing, the OUTREACH tab changed. {fieldLabel(c.field)} now says "{showVal(c.field, c.sheet)}". Yours says "{showVal(c.field, c.yours)}".</p>
              ))}
            </div>
            <div className="modal-foot">
              <button className="btn ghost sm" onClick={keepSheets}>Keep the sheet version</button>
              <button className="btn sm" onClick={useMine}>Keep my changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Mirrors the ADVANCE CALCULATOR tab's own row formulas exactly (verified
// cell-by-cell against a real prospect's computed values before shipping).
// netStreams is the only real input; everything else is an assumption
// pulled live from the sheet, or a target staff can tune per-run.
function calcAdvance({ netStreams, blendedRate, runRate, decay, adminFeeRate, recoupMonths }) {
  const royYr1 = netStreams * blendedRate * runRate * (1 - decay);
  const royYr2 = royYr1 * (1 - decay);
  const royYr3 = royYr2 * (1 - decay);
  const roy3yr = royYr1 + royYr2 + royYr3;
  const adminYr1 = royYr1 * adminFeeRate;
  const adminYr2 = royYr2 * adminFeeRate;
  const adminYr3 = royYr3 * adminFeeRate;
  const admin3yr = roy3yr * adminFeeRate;
  const advance = adminYr1 * (recoupMonths / 12);

  let monthsToRecoup = null;
  if (adminYr1 > 0) {
    if (advance <= adminYr1) monthsToRecoup = (advance / adminYr1) * 12;
    else if (advance <= adminYr1 + adminYr2) monthsToRecoup = (1 + (advance - adminYr1) / adminYr2) * 12;
    else if (advance <= adminYr1 + adminYr2 + adminYr3) monthsToRecoup = (2 + (advance - adminYr1 - adminYr2) / adminYr3) * 12;
    else monthsToRecoup = (3 + (advance - adminYr1 - adminYr2 - adminYr3) / adminYr3) * 12;
  }
  const coverage = advance > 0 ? admin3yr / advance : null;
  const verdict = monthsToRecoup == null ? null
    : monthsToRecoup <= 18 ? "Safe"
    : monthsToRecoup <= 30 ? "Workable"
    : monthsToRecoup <= 36 ? "Tight"
    : "Too high — lower target";

  return { royYr1, royYr2, royYr3, roy3yr, adminYr1, adminYr2, adminYr3, admin3yr, advance, monthsToRecoup, coverage, verdict };
}

// A blank scenario to start from — no prospect/client picked, no streams
// typed. Matches the same field shape Outreach's own single-song entry
// uses (Gross Streams + Writer %), not a raw Net Streams number,
// specifically so a from-scratch scenario can be saved as a real prospect
// later: Net Streams alone can't be decomposed back into streams+split,
// but Gross Streams + Writer % round-trips into Outreach's Song 1 slot
// exactly.
const BLANK_SCENARIO = { kind: "new", key: "", name: "", contact: "", grossStreams: "", writerShare: "" };

function AdvanceCalcPanel({ data, reload, pick = null }) {
  const { assumptions, recoupTargetMonths, budget, prospects, signedClients } = data;
  const links = data.sheet?.links || {};
  // the Watchlist's "Work out an advance" opens it with that prospect picked
  const [scenario, setScenario] = useState(() => (pick && prospects.some((p) => p.id === pick) ? { ...BLANK_SCENARIO, kind: "outreach", key: pick, name: prospects.find((p) => p.id === pick)?.name || "" } : BLANK_SCENARIO));
  const [recoupMonths, setRecoupMonths] = useState(recoupTargetMonths);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(false);

  const selectedProspect = scenario.kind === "outreach" ? prospects.find((p) => p.id && p.id === scenario.key) : null;
  const selectedClient = scenario.kind === "client" ? signedClients.find((c) => c.id === scenario.key) : null;
  // an existing prospect/client's Net Streams comes straight from the sheet
  // or catalog's own sum across everything they have (could be more than
  // one song) — a from-scratch scenario only ever has the one Gross
  // Streams/Writer % pair being typed, computed the same way the sheet
  // computes each song slot.
  const netStreams = selectedProspect ? selectedProspect.money.netStreams
    : selectedClient ? selectedClient.netStreams
    : (Number(scenario.grossStreams) || 0) * ((Number(scenario.writerShare) || 0) / 100);

  const selectScenario = (value) => {
    setSaved(false);
    if (!value) { setScenario(BLANK_SCENARIO); return; }
    const [kind, key] = value.split(":");
    if (kind === "outreach") {
      const p = prospects.find((x) => x.id === key);
      setScenario({ kind, key, name: p?.name || "", contact: p?.contact || "", grossStreams: "", writerShare: "" });
    } else if (kind === "client") {
      const c = signedClients.find((x) => x.id === key);
      setScenario({ kind, key, name: c?.name || "", contact: "", grossStreams: "", writerShare: "" });
    }
  };
  const setField = (patch) => { setSaved(false); setScenario({ ...scenario, ...patch }); };

  const result = useMemo(() => calcAdvance({
    netStreams,
    blendedRate: assumptions.blendedRate,
    runRate: assumptions.runRate,
    decay: assumptions.decayRate,
    adminFeeRate: assumptions.adminFeeRate,
    recoupMonths: Number(recoupMonths) || 12,
  }), [netStreams, recoupMonths, assumptions]);
  const estRevenue = netStreams * assumptions.blendedRate;

  const saveToOutreach = async () => {
    if (!scenario.name.trim() || !netStreams) return;
    setBusy(true); setErr(null);
    try {
      const { prospect } = await arWrite({
        action: "createProspect", name: scenario.name.trim(), contact: scenario.contact.trim(),
        slots: [{ slot: 1, streams: Number(scenario.grossStreams) || 0, share: (Number(scenario.writerShare) || 0) / 100 }],
      });
      await reload();
      setScenario({ kind: "outreach", key: prospect.id, name: scenario.name, contact: scenario.contact, grossStreams: "", writerShare: "" });
      setSaved(true);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const setGiven = async (given) => {
    if (!selectedProspect) return;
    setBusy(true); setErr(null);
    try {
      await arWrite({ action: "setGiven", prospectId: selectedProspect.id, given, expect: { given: selectedProspect.advance.given } });
      await reload();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="admin-head">
        <h2>Advance calculator</h2>
        {links.advanceCalculator && (
          <ExtLink href={links.advanceCalculator} className="btn ghost sm"><ExternalLink size={14} /> Open in sheet</ExtLink>
        )}
      </div>
      <p className="muted mb">Works out an advance the same way the sheet's ADVANCE CALCULATOR tab does.</p>
      {/* the dollars below use the pub sheet's rate (ASSUMPTIONS!B7), read live: say which */}
      <p className="hint adv-rate" title="The rate is ASSUMPTIONS!B7 on the pub sheet">{assumptions.blendedRate != null ? `At $${+Number(assumptions.blendedRate).toFixed(6)} a stream (your pub sheet's rate).` : "At your pub sheet's rate a stream."}</p>

      <div className="cat-summary" style={{ marginBottom: 20, maxWidth: 560 }}>
        <div className="cat-summary-grid">
          <div className="cat-stat"><span className="cat-stat-label">Starting Budget</span><span className="cat-stat-val">{money(budget.starting)}</span></div>
          <div className="cat-stat"><span className="cat-stat-label">Committed (Given)</span><span className="cat-stat-val">{money(budget.committed)}</span></div>
          <div className="cat-stat"><span className="cat-stat-label">Remaining</span><span className="cat-stat-val">{money(budget.remaining)}</span></div>
        </div>
      </div>

      {/* wide screens: the result sits beside the form, so it shows in the first screen as you type */}
      <div className="adv-cols">
      <div className="form-card" style={{ maxWidth: 560 }}>
        <label className="fld"><span>Prospect or signed client</span>
          <select value={scenario.kind === "new" ? "" : `${scenario.kind}:${scenario.key}`} onChange={(e) => selectScenario(e.target.value)}>
            <option value="">— someone new (type their streams) —</option>
            {signedClients.length > 0 && (
              <optgroup label="Our clients">
                {signedClients.map((c) => <option key={c.id} value={`client:${c.id}`}>{c.name} ({fmt(c.netStreams)} net streams)</option>)}
              </optgroup>
            )}
            {prospects.length > 0 && (
              <optgroup label="Prospects (A&R)">
                {prospects.filter((p) => p.id).map((p) => <option key={p.id} value={`outreach:${p.id}`}>{p.name} ({fmt(Math.round(p.money.netStreams))} net streams)</option>)}
              </optgroup>
            )}
          </select>
        </label>
        {selectedProspect || selectedClient ? (
          <p className="hint">
            Net Streams ({fmt(Math.round(netStreams))}) comes from {scenario.name}'s {selectedClient ? "catalog" : "songs in Outreach"} —
            edit {selectedClient ? "their songs on Overview & clients" : "those on the A&R tab"} to change this.
          </p>
        ) : (
          <>
            <Field label="Prospect / Producer" value={scenario.name} onChange={(e) => setField({ name: e.target.value })} placeholder="Who are you evaluating?" />
            <Field label="Contact or Handle" value={scenario.contact} onChange={(e) => setField({ contact: e.target.value })} />
            <Field label="Gross Streams" type="number" value={scenario.grossStreams} onChange={(e) => setField({ grossStreams: e.target.value })} />
            <Field label="Writer %" type="number" value={scenario.writerShare} onChange={(e) => setField({ writerShare: e.target.value })} />
            {netStreams > 0 && <p className="hint">Net streams: {fmt(Math.round(netStreams))} · Their earnings so far: {money(estRevenue)}</p>}
          </>
        )}
        <Field
          label="Recoup target (months)" type="number" value={recoupMonths}
          onChange={(e) => setRecoupMonths(e.target.value)}
          hint="The advance is this many months of our fee in year 1. 12 to 18 is usual, 24 to 36 is aggressive."
        />
        <p className="hint">Paid back out of our fee, not their share.</p>
        {err && <p className="hint err-text">{err}</p>}
        {/* saving flips scenario.kind to "outreach", which swaps in the
            read-only reference block above on the very next render — the
            confirmation has to live outside that block or it vanishes
            before anyone sees it */}
        {saved && <p className="hint ok-text">Added as a prospect ✓ — {scenario.name} is now on the A&amp;R board, shown below with its real numbers.</p>}
        {scenario.kind === "new" && (
          <button className="btn sm" onClick={saveToOutreach} disabled={busy || !scenario.name.trim() || !netStreams}>
            {busy ? "Saving…" : "Add as prospect"}
          </button>
        )}
        {selectedProspect && (
          <div className="ar-given-row">
            {/* a blank cell is "Not answered" (as on the panel), never a lit No; said on the label, before
                the buttons, so it never reads as a third choice */}
            <span className="fld-label">Advance given?{!selectedProspect.advance.given && <span className="ar-given-none"> · Not answered yet</span>}</span>
            <button className={selectedProspect.advance.given === "Yes" ? "btn sm" : "btn ghost sm"} aria-pressed={selectedProspect.advance.given === "Yes"} onClick={() => setGiven(true)} disabled={busy || !selectedProspect.advance.editable}>Yes</button>
            <button className={selectedProspect.advance.given === "No" ? "btn sm" : "btn ghost sm"} aria-pressed={selectedProspect.advance.given === "No"} onClick={() => setGiven(false)} disabled={busy || !selectedProspect.advance.editable}>No</button>
          </div>
        )}
        {selectedProspect && !selectedProspect.advance.editable && selectedProspect.advance.why && <p className="hint">{selectedProspect.advance.why}</p>}
        {selectedClient && (
          <p className="hint">Signed clients aren't tracked in the Given/budget total above — this is for planning an additional advance only.</p>
        )}
      </div>

      <div className="adv-out">
      {/* nothing to work out yet: one line says what to do, instead of rows of $0.00; streams typed with no
          writer % asks for the % */}
      {!selectedProspect && !selectedClient && !netStreams ? <p className="adv-empty">{Number(scenario.grossStreams) > 0 && !(Number(scenario.writerShare) > 0) ? "Add their writer share (%) to see an advance." : "Pick a client or prospect, or type streams, to see an advance."}</p> : <>
      <div className="cat-summary">
        <div className="cat-summary-grid">
          <div className="cat-stat"><span className="cat-stat-label">Recommended Advance</span><span className="cat-stat-val">{money(result.advance)}</span></div>
          <div className="cat-stat"><span className="cat-stat-label">Months to Recoup</span><span className="cat-stat-val">{result.monthsToRecoup != null ? `${result.monthsToRecoup.toFixed(1)} mo` : "—"}</span></div>
          <div className="cat-stat"><span className="cat-stat-label">Coverage</span><span className="cat-stat-val">{result.coverage != null ? `${result.coverage.toFixed(1)}x` : "—"}</span></div>
          <div className="cat-stat"><span className="cat-stat-label">Verdict</span><span className="cat-stat-val" data-tone={!result.verdict ? undefined : result.verdict === "Safe" ? "pos" : result.verdict === "Tight" ? "warn" : result.verdict.startsWith("Too high") ? "neg" : "neutral"}>{result.verdict || "—"}</span></div>
        </div>
      </div>

      <div className="split-list" style={{ marginTop: 16 }}>
        <div className="split-list-row"><span className="split-name">Their earnings yr 1</span><span className="split-pct">{money(result.royYr1)}</span></div>
        <div className="split-list-row"><span className="split-name">Their earnings yr 2</span><span className="split-pct">{money(result.royYr2)}</span></div>
        <div className="split-list-row"><span className="split-name">Their earnings yr 3</span><span className="split-pct">{money(result.royYr3)}</span></div>
        <div className="split-list-row split-list-total"><span>Their earnings next 3 yrs</span><span>{money(result.roy3yr)}</span></div>
      </div>
      <div className="split-list" style={{ marginTop: 12 }}>
        <div className="split-list-row"><span className="split-name">Our fee yr 1</span><span className="split-pct">{money(result.adminYr1)}</span></div>
        <div className="split-list-row"><span className="split-name">Our fee yr 2</span><span className="split-pct">{money(result.adminYr2)}</span></div>
        <div className="split-list-row"><span className="split-name">Our fee yr 3</span><span className="split-pct">{money(result.adminYr3)}</span></div>
        <div className="split-list-row split-list-total"><span>Our fee next 3 yrs</span><span>{money(result.admin3yr)}</span></div>
      </div>
      </>}
      </div>
      </div>
    </div>
  );
}

// Publishing › Advance calculator: the sheet read happens only once this sub-tab opens
function AdvanceTab({ pick = null }) {
  const { data, err, load, retry } = useArData();
  // the calculator's levers and budget come from the sheet itself: nothing to work out without it
  const down = data && data.sheet?.ok === false;
  return (
    <>
      {err && <ArDataError err={err} retry={retry} />}
      {down && <ArDataError err="Couldn't read the pub sheet just now, so the Advance calculator can't work out its numbers." retry={retry} />}
      {!data && !err && <p className="muted">Loading…</p>}
      {data && !down && <div className="pub-sec"><AdvanceCalcPanel data={data} reload={load} pick={pick} /></div>}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  CLIENT PORTAL                                                       */
/* ------------------------------------------------------------------ */
/*  shared: song + splits manager (used by client portal and staff)    */
// a release date is a calendar day (YYYY-MM-DD): new Date() reads it as UTC midnight, which is
// still the day before everywhere in the Americas
const releaseDay = (s) => {
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return (ymd ? new Date(+ymd[1], ymd[2] - 1, +ymd[3]) : new Date(s)).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
};
// An in-app "are you sure?" in place of the browser's own confirm box: a title, what will happen, a
// red button and Cancel. Esc, ×, Cancel or a click outside cancel; the red button waits for go().
// plain: a normal button for a step that loses nothing; typeName: the button stays off until that is typed.
function AskCard({ title, children, goLabel, busyLabel = "Working…", go, onClose, plain = false, typeName = null }) {
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const typedOk = !typeName || typed.trim() === typeName.trim();
  const close = () => { if (!busy) onClose(); };
  useEscape(close, true, true); // ahead of the window it opened over, so Esc closes only this
  const run = async () => { if (!typedOk) return; setBusy(true); try { await go(); } finally { setBusy(false); } };
  return (
    <div className="modal ask-modal" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="modal-card ask-card" role="alertdialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h3>{title}</h3><button onClick={close} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-body ask-body">
          {children}
          {typeName && <input className="ask-type" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} aria-label={`Type ${typeName} to confirm`} placeholder={typeName} autoComplete="off" spellCheck={false} autoFocus />}
        </div>
        <div className="modal-foot">
          {/* Cancel has the focus: Enter never deletes by accident */}
          <button className="btn ghost sm" onClick={close} disabled={busy} autoFocus={!typeName}>Cancel</button>
          <button className={plain ? "btn sm" : "btn sm ask-go"} data-ask-go onClick={run} disabled={busy || !typedOk}>{busy ? busyLabel : goLabel}</button>
        </div>
      </div>
    </div>
  );
}

// A panel with typing in it never closes on a stray Esc, × or click outside: it asks first, in the
// panel. Cancel still discards at once. A clean panel closes as before.
function useDirtyGuard(dirty, onClose) {
  const [asking, setAsking] = useState(false);
  const tryClose = () => (dirty ? setAsking(true) : onClose());
  const bar = asking && dirty && (
    <div className="dirty-bar" role="alert">
      <span>You have unsaved changes</span>
      <button className="btn ghost sm" onClick={() => setAsking(false)} autoFocus>Keep editing</button>
      <button className="btn sm" data-discard onClick={onClose}>Discard</button>
    </div>
  );
  return { tryClose, bar };
}

// Delete and "This isn't ours": the song off the site, then its row off its client's pub sheet tab.
// Resolves what happened on the sheet, once both are done; null when the site save failed.
async function dropSong(db, commit, target, client) {
  if (!(await commit({ ...db, placements: db.placements.filter((p) => p.id !== target.id) }))) return null;
  const tab = client?.sheetTabName?.trim() || client?.name || "";
  if (!ownSplit(target, client)) return { sheet: "none", tab }; // nothing was ever pushed under this client for this song
  try {
    const res = await fetch("/api/sheets-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
      body: JSON.stringify({ placementId: target.id, splits: [{ name: client?.sheetTabName || client?.name }] }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Sheet delete failed (${res.status})`);
    const r = (data.results || [])[0] || {};
    return { sheet: r.cleared ? "cleared" : r.found === false ? "noTab" : "notFound", tab: r.tab || tab };
  } catch (err) {
    console.error("Sheet delete failed:", err);
    return { sheet: "failed", tab, error: err.message };
  }
}
// the last sheet sync found no tab for this client: a Delete or "This isn't ours" has no row to clear
const noSheetTab = (lum, client) => !!client && (lum?.missingTabs || []).includes(client.name);
// the one line a Delete leaves under the client's header: what happened on the pub sheet
const dropNote = (o) => ({
  cleared: { text: `Deleted. Its row on the ${o.tab} tab is cleared.` },
  notFound: { warn: true, text: `Deleted here, but its row on the ${o.tab} tab wasn't found. Delete that row in the pub sheet by hand, or the next numbers sync brings the song back.` },
  noTab: { text: `Deleted. The pub sheet has no ${o.tab} tab, so there was no row to clear.` },
  failed: { warn: true, text: `Deleted here, but the pub sheet couldn't be updated (${o.error || "no answer"}). Delete its row on the ${o.tab} tab by hand.` },
}[o.sheet] || { text: "Deleted. It had no row on the pub sheet." });

// "This isn't ours": every place the app knows the song is, then one step takes it out of all of
// them (site, its sheet row) and notes it, so the sheet never brings it back and Luminate gets a
// To do. Luminate itself can't be changed from here. onDone gets the result line.
function NotOursAsk({ db, commit, lum, target, client, onDone, onClose }) {
  const tab = client?.sheetTabName?.trim() || client?.name || "";
  // another client's page still linked to the same Luminate song keeps it in the portfolio: its numbers come from there
  const sharedLum = target.luminateId && db.placements.some((p) => p.id !== target.id && p.luminateId === target.luminateId);
  const lumPort = !sharedLum && target.luminateId && lum?.inPortfolio?.[target.luminateId] && (lum.portfolios || []).find((p) => p.id === lum.inPortfolio[target.luminateId]);
  const places = [
    target.notable ? `On public page (${client?.name}'s page on the site)` : `On ${client?.name}'s page here (not public)`,
    ownSplit(target, client) && (noSheetTab(lum, client) ? `Not on the pub sheet (there's no ${tab} tab)` : `Its row on the ${tab} tab of the pub sheet`),
    lumPort && `In Luminate: ${lumPort.name} (uses 1 of ${lumPort.capacity || lum.cap} slots)`,
  ].filter(Boolean);
  const go = async () => {
    const out = await dropSong(db, commit, target, client);
    if (!out) return onClose(); // the save's own error banner says why
    let noted = null;
    try { await lumPost({ action: "notOurs", clientId: target.clientId, song: target.song, artist: target.artist, luminateId: target.luminateId || "", placementId: target.id }); } catch (e) { noted = e.message; }
    const sheetBad = out.sheet === "notFound" || out.sheet === "failed";
    const text = [
      out.sheet === "cleared" ? "Removed from the catalog and the pub sheet." : sheetBad ? `Removed from the catalog, but its row on the ${out.tab} tab ${out.sheet === "failed" ? "couldn't be cleared" : "wasn't found"}. Delete that row in the pub sheet by hand.` : "Removed from the catalog.",
      lumPort && `1 thing left: take it out of ${lumPort.name} in Luminate.`,
      noted && `It couldn't be recorded as removed (${noted}), so a numbers sync may bring it back.`,
    ].filter(Boolean).join(" ");
    onDone({ warn: sheetBad || !!noted, text, go: lumPort ? "gone" : null });
  };
  return (
    <AskCard title={`Remove "${target.song || "Untitled"}" from the catalog?`} goLabel="Remove from catalog" busyLabel="Removing…" go={go} onClose={onClose}>
      <p>This takes it out of everywhere the app can reach:</p>
      <ul className="ask-places">{places.map((x) => <li key={x}>{x}</li>)}</ul>
      {lumPort && <p className="hint">The app can't remove songs from Luminate. You'll get a To do to take it out of {lumPort.name} yourself.</p>}
      {sharedLum && <p className="hint">It stays in Luminate: another client's page uses the same Luminate song.</p>}
    </AskCard>
  );
}

// Save's sheet step (the song editor, and Splits to confirm's Confirm): only the split that belongs to
// whoever's catalog page this is goes to the pub sheet. A co-writer typed into another split, or an
// unnamed person from the even default, is just a name on the site, never someone we provision sheet
// tracking for. Resolves null, or what went wrong (a slow or failed push never undoes the site save)
async function pushOwnShare(saved, client, liveIds) {
  const mine = ownSplit(saved, client);
  const splits = mine ? [{ name: client?.sheetTabName || client?.name, percent: mine.percent }] : [];
  try {
    const res = await fetch("/api/sheets-push", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
      body: JSON.stringify({
        placementId: saved.id, song: saved.song, artist: saved.artist, luminateId: saved.luminateId, splits,
        // lets the push route tell a genuinely-still-claimed sheet row apart
        // from one whose syncId belongs to a placement that no longer
        // exists on this browser — see findUnclaimedRowByTitle.
        liveIds,
      }),
    });
    if (res.ok) return null;
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Sheet sync failed (${res.status})`);
  } catch (err) {
    console.error("Sheet push failed:", err);
    return err.message || "Sheet sync failed — the local save is fine, but the pub sheet wasn't updated.";
  }
}

function SongManager({ db, commit, clientId, isStaff, lum, reloadLum, fix, onFix, onFixList, onGo, onDeleteClient }) {
  // staff's db has a `clients` array; a client session's db has just their
  // own `client` record (no `clients` array — that's not sent to them).
  const client = db.clients ? db.clients.find((c) => c.id === clientId) : db.client;
  const songs = useMemo(() => db.placements.filter((p) => p.clientId === clientId), [db.placements, clientId]);
  // MASTER-tab-style rollup across this client's whole catalog. Gross
  // streams (and $ figures) come straight off each placement — the sheet's
  // own Gross Revenue/Admin Fee columns are already this person's share,
  // not the whole song's, since they cascade from Net Streams (Gross ×
  // their own Writer Share %). Net streams isn't stored anywhere, so it's
  // recomputed here the same way the sheet computes it per row.
  const summary = useMemo(() => {
    let gross = 0, net = 0, revenue = 0, adminFee = 0;
    for (const p of songs) {
      const streams = p.streams || 0;
      gross += streams;
      const mine = ownSplit(p, client);
      net += streams * ((Number(mine?.percent) || 0) / 100);
      revenue += p.revenue || 0;
      adminFee += p.adminFee || 0;
    }
    return { gross, net, revenue, adminFee };
  }, [songs, client?.name]);
  const growth = useGrowth();
  // this week = Luminate's own This Period from the export, as the Publishing table says (the songs
  // whose week ends last); an older all-time export's songs fall back to the gain between snapshots
  const weekGain = useMemo(() => {
    if (!growth) return null;
    const gs = songs.map((p) => growth[p.id]).filter(Boolean);
    const end = gs.map((g) => g.thisWeek != null && g.weekOf?.to).filter(Boolean).sort().pop();
    const wk = gs.filter((g) => g.thisWeek != null && (!end || !g.weekOf || g.weekOf.to === end));
    if (wk.length) return wk.reduce((a, g) => a + g.thisWeek, 0);
    const known = gs.filter((g) => g.week != null);
    return known.length ? known.reduce((a, g) => a + g.week, 0) : null;
  }, [growth, songs]);
  // when Luminate made these numbers (the newest export's day), not when the site last pulled the sheet
  const numbersOn = useMemo(() => songs.map((p) => growth?.[p.id]?.latestOn).filter(Boolean).sort().pop() || null, [growth, songs]);
  const [openId, setOpenId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState(null);
  const [splitsFirst, setSplitsFirst] = useState(0); // a Fix's n while its editor is open: it opens on the Splits
  // a closed form takes its message with it, and a Fix's "open on the Splits" with it
  useEffect(() => { if (!editing) { setFormErr(null); setSplitsFirst(0); } }, [editing]);
  const editFrom = useRef(null); // the song as it was when Edit was pressed
  const active = songs.find((p) => p.id === openId);
  const [pushWarn, setPushWarn] = useState(null);
  // a "Fix" from the splits list opens that song's editor at once; after its Save, a strip says how many
  // are left and offers the next one (on any client's page)
  const fixing = useRef(null);
  const [fixNote, setFixNote] = useState(null);
  useEffect(() => {
    const p = fix && db.placements.find((x) => x.id === fix.id);
    if (!p || p.clientId !== clientId) return;
    setOpenId(null); setFixNote(null); fixing.current = p.id;
    editFrom.current = p; setEditing({ ...p }); setSplitsFirst(fix.n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix?.n, clientId]);
  useEscape(() => (editing ? setEditing(null) : setOpenId(null)), !!(active || editing) && !saving);
  useEffect(() => {
    if (!active && !editing) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [active, editing]);

  const saveSong = async (form0, anyway = false) => {
    // the split as the editor shows it: the even default filled in (lib/splits.js), or exactly what was typed
    const form = { ...form0, splits: filledSplits(form0.splits) };
    // only what was changed in the form goes onto the song as it is now — streams the sync
    // brought in while it was open aren't put back (see Editor)
    const cur = form.id && db.placements.find((p) => p.id === form.id);
    const o = cur && editFrom.current ? { ...cur, ...changedFields(editFrom.current, form) } : form;
    // catch likely duplicates before they happen — same title plus at least
    // one more matching signal (the credited artist, or a shared name in
    // the splits) is "probably a dupe"; same title alone isn't (two real,
    // different songs can share a title with different people on them).
    const normTitle = normalizeTitle(o.song);
    const normArtist = normalizeTitle(o.artist);
    const myName = personKey(client?.name);
    // exclude the client's own name — they're on every song on their own
    // page, so that alone would "match" any two same-titled entries.
    const mySplitNames = new Set((o.splits || []).map((s) => personKey(s.name)).filter((n) => n && n !== myName));
    const possibleDup = songs.find((p) => {
      if (p.id === o.id) return false;
      if (normalizeTitle(p.song) !== normTitle || !normTitle) return false;
      const artistMatch = normArtist && normalizeTitle(p.artist) === normArtist;
      const splitMatch = (p.splits || []).some((s) => mySplitNames.has(personKey(s.name)));
      return artistMatch || splitMatch;
    });
    if (possibleDup && !anyway) return setAsk({ kind: "dup", form, dup: possibleDup });
    const placementId = o.id || uid();
    const row = { ...o, id: placementId, clientId };
    const placements = o.id
      ? db.placements.map((p) => p.id === o.id ? row : p)
      : [...db.placements, row];
    setSaving(true); setFormErr(null);
    const done = await commit({ ...db, placements }).finally(() => setSaving(false));
    // a song that didn't save stays in its form, and never reaches the sheet
    if (!done) return;
    // the sheet gets the song as it was saved, others' changes to it included — and a song deleted
    // elsewhere meanwhile gets nothing (a push would re-create its row for the next sync to bring back)
    const saved = done.placements.find((p) => p.id === placementId);
    if (!saved) return setFormErr(goneText(done.clients && !done.clients.some((c) => c.id === clientId) ? "client" : "song"));
    if (isStaff && fixing.current === placementId) {
      const left = splitsToFix(done).flatMap((g) => g.songs.map((p) => ({ p, client: g.client })));
      setFixNote({ left: left.length, next: left.find((x) => x.p.id !== placementId) || null });
    }
    fixing.current = null;
    setEditing(null);
    // push to the pub sheet in the background — a slow/failed network call
    // should never block or undo the local save that already succeeded —
    // but staff still need to know if the sheet side silently fell out of
    // sync, so surface (not throw) whatever the route reports.
    setPushWarn(null);
    // only ever push the split that belongs to whoever's catalog page this
    // is — a co-writer typed into another split is just a name on the site,
    // not someone we auto-provision sheet tracking for. If that person is
    // also a client, their own row comes from adding this same song under
    // their own page, the same way this one did.
    pushOwnShare(saved, client, done.placements.map((p) => p.id)).then((err) => {
      if (err && isStaff) setPushWarn(err);
    });
  };
  // the one-line outcome of a Delete / This isn't ours, under the header (staff only)
  const [delNote, setDelNote] = useState(null);
  const [ask, setAsk] = useState(null); // "delete" | "notOurs": the confirm card over the song window
  useEffect(() => { setDelNote(null); setAsk(null); setFixNote(null); }, [clientId]);
  const removeSong = async (target) => {
    setDelNote(null);
    // not deleted on the site: its sheet row stays too
    const out = await dropSong(db, commit, target, client);
    setAsk(null);
    if (!out) return;
    setOpenId(null); setEditing(null);
    if (isStaff) setDelNote(dropNote(out));
  };
  const startAdd = () => setEditing({ id: null, clientId, song: "", artist: client?.name || "", releaseDate: "", link: "", cover: "", notable: false, luminateId: "", splits: [{ id: uid(), name: client?.name || "", role: client?.role || "", percent: 0 }] });

  return (
    <>
      {/* read-only: shows staff which sheet tab this client's numbers come from (Stack!e reads tab Stackie) */}
      {isStaff && client && (
        <div className="client-head">
          <Avatar src={client.photo} name={client.name} size={40} />
          <div className="client-head-text">
            <div className="client-head-name">{client.name}</div>
            <div className="client-head-meta">{client.role || "Client"} · {!songs.length ? "No songs yet. Their pub sheet tab is made with their first song."
              : noSheetTab(lum, client) ? <span className="warn-text" title={`The pub sheet has no tab called ${client.sheetTabName?.trim() || client.name}.`}>Sheet tab: not found</span>
              : `Sheet tab: ${client.sheetTabName?.trim() || client.name}`}</div>
          </div>
          {onDeleteClient && <ClientMore onDelete={() => onDeleteClient(client)} />}
        </div>
      )}
      {isStaff && fixNote && (
        <p className="hint fix-strip" role="status">
          <CheckCircle2 size={14} /> <span>Saved. {fixNote.left ? `${fixNote.left} left` : "All splits add up now."}</span>
          {fixNote.next && <> · <button className="inline-link" onClick={() => onFix?.(fixNote.next.p.id)}>Next: {fixNote.next.p.song || "Untitled"} ({fixNote.next.client?.name || "a deleted client"}) →</button></>}
          {" · "}<button className="inline-link" onClick={() => onFixList?.()}>Back to the list</button>
        </p>
      )}
      {isStaff && <DropNote note={delNote} onShow={onGo && ((sec) => onGo("luminate", sec))} />}
      <div className="portal-block-head">
        <div>
          <h2>Songs &amp; Splits</h2>
          <p className="muted">
            {/* the song count already lives in the summary's Songs stat for
                clients — repeating it here would just be the same number
                twice. Staff never see a Songs stat there, so keep it here. */}
            {(isStaff || !db.sheetSync?.lastSyncedAt) && `${songs.length} Song${songs.length === 1 ? "" : "s"} · `}
            Click any to see the breakdown.
          </p>
          {isStaff && pushWarn && <p className="hint err-text">{pushWarn}</p>}
        </div>
        <button className="btn sm" onClick={startAdd}><Plus size={15} /> Add Song</button>
      </div>

      {db.sheetSync?.lastSyncedAt && (
        <div className="cat-summary">
          <div className="cat-summary-grid">
            <div className="cat-stat"><span className="cat-stat-label">Gross Streams</span><span className="cat-stat-val">{fmt(summary.gross)}</span></div>
            <div className="cat-stat"><span className="cat-stat-label">Net Streams</span><span className="cat-stat-val">{fmt(Math.round(summary.net))}</span></div>
            {isStaff ? (
              <>
                {/* estimates, not cash we hold: clients are paid their publishing directly, our commission is billed through Stripe */}
                <div className="cat-stat"><span className="cat-stat-label">Their earnings <span className="cat-stat-note">(est., paid to them directly)</span></span><span className="cat-stat-val">{money(summary.revenue)}</span></div>
                <div className="cat-stat"><span className="cat-stat-label">Our fee so far <span className="cat-stat-note">(est. admin fee)</span></span><span className="cat-stat-val">{money(summary.adminFee)}</span></div>
              </>
            ) : (
              <>
                <div className="cat-stat"><span className="cat-stat-label">Songs</span><span className="cat-stat-val">{songs.length}</span></div>
                {weekGain != null && <div className="cat-stat"><span className="cat-stat-label">This Week</span><span className="cat-stat-val grow-val">{signed(weekGain)}</span></div>}
              </>
            )}
          </div>
          <p className="hint cat-asof">
            {isStaff ? streamsAsOf({ luminateDay: numbersOn, pulledAt: db.sheetSync.lastSyncedAt })
              : `Streams as of ${new Date(numbersOn ? `${numbersOn}T12:00:00` : db.sheetSync.lastSyncedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`}
            {isStaff && weekGain != null && ` · ${signed(weekGain)} this week`}
          </p>
        </div>
      )}

      {songs.length === 0 ? (
        <p className="muted">No songs yet — add the first one.</p>
      ) : (
        <div className="song-grid">
          {(isStaff ? [...songs].sort((a, b) => (splitTotal(a.splits) === 100) - (splitTotal(b.splits) === 100)) : songs).map((p) => (
            <button key={p.id} className="song-card" onClick={() => setOpenId(p.id)}>
              <div className="song-cover">
                {p.cover ? <Photo src={p.cover} alt={p.song} /> : <div className="song-cover-empty"><Disc3 size={26} /></div>}
              </div>
              <div className="song-info">
                <strong>{p.song || "Untitled"}</strong>
                <span>{p.artist}</span>
                <em>{isStaff && splitTotal(p.splits) !== 100
                  ? <span className="split-chip">Splits {splitPct(p.splits)}%</span>
                  : <>{(p.splits || []).length} {(p.splits || []).length === 1 ? "split" : "splits"} · <span className={splitTotal(p.splits) === 100 ? undefined : "split-warn"}>{splitTotal(p.splits)}%</span></>}</em>
                {/* its own line: on the splits line it was cut off by the card's width */}
                {p.notable && <span className="song-public"><Eye size={12} aria-hidden="true" /> On public page</span>}
                <GrowthChip g={growth?.[p.id]} />
              </div>
            </button>
          ))}
        </div>
      )}

      {active && !editing && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setOpenId(null)}>
          <div className="modal-card song-detail">
            <div className="modal-head"><h3>{active.song || "Untitled"}</h3><button onClick={() => setOpenId(null)} aria-label="Close"><X size={18} /></button></div>
            <div className="modal-body">
              <div className="song-detail-top">
                <div className="song-detail-cover">
                  {active.cover ? <Photo src={active.cover} alt="" /> : <div className="song-cover-empty"><Disc3 size={30} /></div>}
                </div>
                <div>
                  <div className="song-detail-artist">{active.artist}</div>
                  {active.releaseDate && <div className="song-detail-date">{releaseDay(active.releaseDate)}</div>}
                  {active.link && <ExtLink className="inline-link" href={active.link}>Open track ↗</ExtLink>}
                  {active.notable && <div className="song-detail-public"><Eye size={13} aria-hidden="true" /> Shown on {client?.name}'s public page.</div>}
                </div>
              </div>
              {/* streams but $0: the sheet row's Writer Share is blank (Spots. on the Stackie tab), so its earnings formulas
                  give nothing. Up here under the title, so it's read before anything else and never sits behind the buttons */}
              {isStaff && db.sheetSync?.lastSyncedAt && active.streams > 0 && !active.revenue && Number(ownSplit(active, client)?.percent) > 0 && (
                <p className="hint song-sheet-warn"><AlertTriangle size={14} /> <span>The pub sheet has no writer share for this song ({client?.sheetTabName?.trim() || client?.name} tab), so it earns $0 there. Edit and Save to send the split to the sheet, or use Remove from catalog.</span></p>
              )}
              <SplitsPie splits={active.splits} size={230} />
              <div className="split-list">
                {(active.splits || []).map((s) => (
                  <div key={s.id} className="split-list-row">
                    <span className="split-name">{s.name || s.label || "—"}{s.role && !s.unnamed && <em> · {s.role}</em>}</span>
                    <span className="split-pct">{s.percent}%</span>
                  </div>
                ))}
                <div className="split-list-row split-list-total">
                  <span>Total</span><span className={splitTotal(active.splits) === 100 ? "split-ok" : "split-warn"}>{splitTotal(active.splits)}%</span>
                </div>
              </div>
              {growth?.[active.id]?.series?.length > 1 && (
                <div className="song-growth">
                  <div className="song-growth-nums">
                    {growth[active.id].thisWeek != null ? <span><b className="grow-val">{signed(growth[active.id].thisWeek)}</b> this week{growth[active.id].weekOf ? ` (${dayRange(growth[active.id].weekOf.from, growth[active.id].weekOf.to)})` : ""}</span>
                      : growth[active.id].week != null ? <span><b className="grow-val">{signed(growth[active.id].week)}</b> since {shortDay(growth[active.id].weekFrom)}</span>
                      : growth[active.id].gain != null && <span><b className="grow-val">{signed(growth[active.id].gain)}</b> since {shortDay(growth[active.id].gainFrom)}</span>}
                    {growth[active.id].ytd != null && <span><b>{fmt(growth[active.id].ytd)}</b> this year</span>}
                  </div>
                  <Sparkline series={growth[active.id].series} />
                  <p className="hint">All-time streams, from {shortDay(growth[active.id].series[0][0])} to {shortDay(growth[active.id].latestOn)}</p>
                </div>
              )}
              {db.sheetSync?.lastSyncedAt && (
                <div className="split-list">
                  <div className="split-list-row"><span className="split-name">Streams</span><span className="split-pct">{fmt(active.streams)}</span></div>
                  {isStaff && (
                    <>
                      <div className="split-list-row"><span className="split-name">Their earnings <em>(est., paid to them directly)</em></span><span className="split-pct">{money(active.revenue)}</span></div>
                      <div className="split-list-row"><span className="split-name">Our fee so far <em>(est. admin fee)</em></span><span className="split-pct">{money(active.adminFee)}</span></div>
                    </>
                  )}
                  <p className="hint song-asof">{isStaff ? streamsAsOf({ luminateDay: growth?.[active.id]?.latestOn, pulledAt: db.sheetSync.lastSyncedAt })
                    : `as of ${new Date(growth?.[active.id]?.latestOn ? `${growth[active.id].latestOn}T12:00:00` : db.sheetSync.lastSyncedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`}</p>
                </div>
              )}
            </div>
            <div className="modal-foot">
              {isStaff && <button className="btn ghost sm" data-not-ours onClick={() => setAsk({ kind: "notOurs", p: active })}>Remove from catalog</button>}
              <button className="btn ghost sm" data-del onClick={() => setAsk({ kind: "delete", p: active })}>Delete</button>
              <button className="btn sm" onClick={() => { editFrom.current = active; setEditing({ ...active }); }}>Edit</button>
            </div>
          </div>
        </div>
      )}

      {ask?.kind === "delete" && (
        <AskCard title={`Delete "${ask.p.song || "Untitled"}"?`} goLabel="Delete song" busyLabel="Deleting…" go={() => removeSong(ask.p)} onClose={() => setAsk(null)}>
          <p>It comes off {client?.name}'s page here.{ownSplit(ask.p, client) && !noSheetTab(lum, client) ? ` Its row on the ${client?.sheetTabName?.trim() || client?.name} tab of the pub sheet is cleared too.` : ""} This can't be undone.</p>
          {ask.p.notable && <p>It's also shown on {client?.name}'s public page; it goes from there too.</p>}
        </AskCard>
      )}
      {ask?.kind === "notOurs" && (
        <NotOursAsk db={db} commit={commit} lum={lum} target={ask.p} client={client} onClose={() => setAsk(null)}
          onDone={(n) => { setAsk(null); setOpenId(null); setDelNote(n); reloadLum?.(); }} />
      )}

      {editing && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setEditing(null)}>
          <div className="modal-card">
            <div className="modal-head"><h3>{editing.id ? "Edit song" : "Add song"}</h3><button onClick={() => setEditing(null)} aria-label="Close"><X size={18} /></button></div>
            <div className="modal-body">
              <SpotifyFill e={editing} set={setEditing} />
              <PhotoUpload label="Cover art" value={editing.cover} onChange={(v) => setEditing({ ...editing, cover: v })} />
              <Field label="Song" value={editing.song} onChange={(ev) => setEditing({ ...editing, song: ev.target.value })} />
              <Field label="Artist" value={editing.artist} onChange={(ev) => setEditing({ ...editing, artist: ev.target.value })} />
              <Field label="Release date" type="date" value={editing.releaseDate} onChange={(ev) => setEditing({ ...editing, releaseDate: ev.target.value })} />
              <Field label="Streaming link" value={editing.link} onChange={(ev) => setEditing({ ...editing, link: ev.target.value })} />
              <SplitsEditor splits={editing.splits} onChange={(v) => setEditing({ ...editing, splits: v })} focusPct={splitsFirst} />
              {isStaff && (
                <Field label="Luminate ID" value={editing.luminateId || ""} onChange={(ev) => setEditing({ ...editing, luminateId: ev.target.value })} hint="Leave blank if you haven't looked it up yet — the pub sheet row will just come through blank until you fill it in there." />
              )}
              <label className="check-row">
                <input type="checkbox" checked={!!editing.notable} onChange={(ev) => setEditing({ ...editing, notable: ev.target.checked })} />
                <span>Feature as a Notable Release on your artist profile.</span>
              </label>
            </div>
            {isStaff && splitTotal(editing.splits) <= 0 && (
              <p className="hint err-text modal-save-warn">Nothing has a split percentage set — give at least one person a % above 0, or this song saves here but won't sync to the pub sheet at all.</p>
            )}
            {formErr && <p className="hint err-text modal-save-warn" role="alert">{formErr}</p>}
            <div className="modal-foot">
              <button className="btn ghost sm" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn sm" onClick={() => saveSong(editing)} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
      {ask?.kind === "dup" && (
        <AskCard title="Save as a separate song?" goLabel="Save anyway" busyLabel="Saving…" plain onClose={() => setAsk(null)}
          go={async () => { const f = ask.form; setAsk(null); await saveSong(f, true); }}>
          <p>This looks like it might already exist here: "{ask.dup.song}" by {ask.dup.artist || "—"} ({(ask.dup.splits || []).length} split{(ask.dup.splits || []).length === 1 ? "" : "s"}).</p>
        </AskCard>
      )}
    </>
  );
}

// Self-service password change — staff can already reset anyone's password
// blind (UsersAdmin's password field), but that means typing a brand-new
// one; this lets a client change theirs without going through staff at all.
function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(false);

  const reset = () => { setCurrent(""); setNext(""); setConfirm(""); setErr(null); };

  const submit = async () => {
    setErr(null);
    if (next.trim().length < 8) return setErr("New password must be at least 8 characters.");
    if (next !== confirm) return setErr("New passwords don't match.");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't change your password.");
      reset();
      setDone(true);
      setOpen(false);
    } catch (e) {
      setErr(e.message || "Couldn't change your password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="portal-block">
      <div className="portal-block-head">
        <div>
          <h2>Password</h2>
          {done && !open && <p className="hint ok-text">Password changed.</p>}
        </div>
        {!open && <button className="btn ghost sm" onClick={() => { setOpen(true); setDone(false); }}>Change password</button>}
      </div>
      {open && (
        <div className="form-card">
          <Field label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <Field label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} hint="At least 8 characters." />
          <Field label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {err && <p className="hint err-text">{err}</p>}
          <div className="portal-block-head">
            <button className="btn ghost sm" onClick={() => { setOpen(false); reset(); }} disabled={busy}>Cancel</button>
            <button className="btn sm" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ClientPortal({ db, commit, session, logout, signingOut }) {
  // db here is already scoped to just this client by /api/dashboard-data —
  // db.client is their own record, db.placements is only their own songs.
  // The old per-browser "pull streams from the sheet on load" workaround is
  // gone: now that data lives in one shared database, whenever staff run
  // Sync Streams every client's numbers update immediately, with nothing
  // for the client's own browser to do.
  const client = db.client;

  return (
    <div className="portal">
      <header className="portal-nav">
        <Link href={ROUTE_TO_PATH.home} className="logo-link"><Wordmark height={26} /></Link>
        <div className="portal-who">
          <span>{client?.name || session.name}</span>
          <button onClick={logout} disabled={signingOut}>{signingOut ? <><RefreshCw size={16} className="spin" /> Signing out…</> : <><LogOut size={16} /> Sign out</>}</button>
        </div>
      </header>
      <main className="portal-main">
        <div className="portal-role">Your catalog — only you and Defied staff can see this</div>
        <h1 className="portal-title">{client?.name || session.name}</h1>
        <div className="portal-block">
          <SongManager db={db} commit={commit} clientId={session.clientId} />
        </div>
        <ChangePassword />
      </main>
    </div>
  );
}

/* staff: full client catalog with splits ------------------------------ */
// keep in sync with lib/sheets.js's normalizeTitle — staff often hand-type
// a "(feat. X)" tag onto the sheet's title cell that the site never stores,
// so a title match has to tolerate that tag or it never links up.
const normalizeTitle = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  .replace(/\s+(feat|ft|featuring)\s+.*$/, "").trim();

// db.sheetSync lives in this browser's own localStorage, not on a server, so
// "is this data current" can't just mean "has this browser ever synced" —
// a device that synced once, a while ago (including before some bug fix
// that only affects sync logic itself), would otherwise sit stale
// indefinitely with no way to notice. Both silent background auto-syncs
// (CatalogAdmin, ClientPortal) re-check against this instead of a one-time
// gate, so nobody has to remember to press a button for routine staleness.
const SYNC_STALE_MS = 5 * 60 * 1000; // 5 minutes
const isSheetSyncStale = (db) => {
  const at = db.sheetSync?.lastSyncedAt;
  return !at || Date.now() - new Date(at).getTime() > SYNC_STALE_MS;
};

// Shared by the Overview page's "Sync Streams" flow (via fullSiteSync) and
// each portal's silent background refresh (see the auto-sync effects
// below) — pulls sheet rows for the given clients and merges streams/
// revenue/adminFee/luminateId onto matching placements. Doesn't create new
// placements or claim rows back to the sheet; fullSiteSync layers that on
// top using rowsByClient.
async function pullAndMergeSheetData(db, clients) {
  const res = await fetch("/api/sheets-pull", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
    body: JSON.stringify({ clients: clients.map((c) => ({ id: c.id, name: c.name, sheetTabName: c.sheetTabName })) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Sync failed");

  const totalsByClient = {};
  const rowsByClient = {};
  for (const c of data.clients) {
    totalsByClient[c.clientId] = c.totalStreams;
    rowsByClient[c.clientId] = c.rows;
  }
  const claimedRows = new Set(); // `${clientId}:${row}` — rows already matched to a placement below
  // a row's syncId only means something if the placement it names still
  // exists — if that placement was deleted/re-added since the last push,
  // the row is really unclaimed even though its Site Sync ID column isn't
  // blank, so title-fallback needs to be able to reclaim it too.
  const livePlacementIds = new Set(db.placements.map((p) => p.id));
  const rowIsAvailableForTitleMatch = (r) => !r.syncId || !livePlacementIds.has(r.syncId.split(":")[0]);
  const placements = db.placements.map((p) => {
    const rows = rowsByClient[p.clientId] || [];
    // same priority as the push side: an exact syncId always wins; next,
    // the Luminate ID is the one field that identifies the actual song
    // regardless of what's sitting in the sheet's Site Sync ID column —
    // if this placement's id ever changed (deleted and re-added, a stale
    // duplicate that got merged), its old syncId may now be stuck on a row
    // that isn't "unclaimed" by the title-fallback's definition, so
    // streams/revenue would never update again without this; finally, fall
    // back to a row with a matching title that's genuinely unclaimed OR
    // whose syncId points at a placement that no longer exists (see
    // rowIsAvailableForTitleMatch above) — a placement with no locally-
    // stored Luminate ID at all would otherwise never be able to reclaim
    // its own row through either of the first two paths.
    const bySyncId = rows.find((r) => r.syncId && r.syncId.split(":")[0] === p.id);
    const byLuminateId = !bySyncId && p.luminateId
      ? rows.find((r) => r.luminateId && r.luminateId === p.luminateId)
      : null;
    const row = bySyncId || byLuminateId
      || rows.find((r) => rowIsAvailableForTitleMatch(r) && normalizeTitle(r.song) === normalizeTitle(p.song));
    if (!row) return p;
    claimedRows.add(`${p.clientId}:${row.row}`);
    return {
      ...p,
      streams: row.grossStreams,
      revenue: row.grossRevenue,
      adminFee: row.adminFee,
      // the sheet wins here, not fill-blanks-only like everything else on
      // this route — staff correct/update Luminate IDs directly on the
      // sheet as part of the weekly refresh, and a fill-blanks rule would
      // mean a sheet-side correction could never take effect once any
      // value (even a wrong one) was ever set. Only falls back to the
      // site's own value when the sheet cell is genuinely blank — e.g.
      // staff typed it on the site before it ever reached the sheet.
      luminateId: row.luminateId || p.luminateId,
    };
  });

  return { data, totalsByClient, rowsByClient, claimedRows, placements };
}

// a song brought in from the sheet gets an id made from its client + title, so two syncs that
// overlap (two staff, or Sync Streams pressed while the Clients-tab sync still runs) save one
// song, not two: the second save finds that id already there and just updates it
const sheetSongId = (clientId, title) => {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (const ch of `${clientId}:${title}`) { const c = ch.codePointAt(0); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x5bd1e995); }
  return [a, b].map((h) => ((h >>> 0) % 1679616).toString(36).padStart(4, "0")).join("");
};

// Full site-wide sync — merges sheet data onto existing placements (via
// pullAndMergeSheetData) AND picks up any genuinely new song staff typed
// straight into the sheet, claiming its row back with a Site Sync ID.
// Shared by the "Sync from sheet" button and the Overview page's "Sync
// Streams" button, which chains this right after refreshing STREAM DATA so
// one click keeps both the sheet and the site current — see runStreamSync.
// It starts from the server's latest copy, not the tab's (which only falls in
// when that can't be fetched): a song added elsewhere since the tab loaded is
// matched to its sheet row instead of coming in again as a stripped duplicate.
// Saved as the base, that copy makes the save carry only the sync's own
// changes, so an edit made during the pull stays.
async function fullSiteSync(tabDb, commit) {
  const latest = await fetch("/api/dashboard-data", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const db = latest?.role === "staff" ? latest : tabDb;
  const { data, totalsByClient, rowsByClient, claimedRows, placements } = await pullAndMergeSheetData(db, db.clients);

  // a client's tab can hold more than one row for the same title (an old
  // duplicate row from before this feature existed, a re-typed entry,
  // etc.) — the match above only ever claims ONE row per placement, so
  // track every title a client already has on the site and skip the
  // rest rather than importing each leftover duplicate as a new song.
  const existingTitles = new Map(); // clientId -> Set(normalizedTitle)
  // a title removed as "not ours" counts as already there, so its leftover row is never imported again
  for (const p of [...db.placements.map((x) => ({ clientId: x.clientId, key: normalizeTitle(x.song) })), ...(db.notOurs || []).map((x) => ({ clientId: x.clientId, key: x.songKey }))]) {
    const set = existingTitles.get(p.clientId) || new Set();
    set.add(p.key);
    existingTitles.set(p.clientId, set);
  }

  // any row left over in a client's own tab — after both the syncId/title
  // match above AND the already-tracked-title check — is a genuinely new
  // song staff typed straight into the sheet. Bring it onto the site,
  // then stamp its Site Sync ID so future syncs match it directly.
  const created = [];
  const claims = [];
  for (const c of db.clients) {
    const rows = rowsByClient[c.id] || [];
    // seen tracks titles claimed *within this pass* too — two unclaimed
    // rows sharing a title (a re-typed duplicate, a copy-paste mistake)
    // must only ever produce one new placement, not one each.
    const seen = existingTitles.get(c.id) || new Set();
    for (const row of rows) {
      if (claimedRows.has(`${c.id}:${row.row}`)) continue;
      const title = normalizeTitle(row.song);
      if (seen.has(title)) continue;
      seen.add(title);
      const key = sheetSongId(c.id, title);
      const id = db.placements.some((p) => p.id === key) ? uid() : key;
      created.push({
        id, clientId: c.id, song: row.song, artist: row.artist || c.name,
        releaseDate: "", link: "", cover: "", notable: false,
        luminateId: row.luminateId || "",
        // a blank Writer Share on the sheet comes in as 0%, never an invented 100%: the splits task flags it
        splits: [{ id: uid(), name: c.name, role: c.role || "", percent: row.writerShare || 0 }],
        streams: row.grossStreams, revenue: row.grossRevenue, adminFee: row.adminFee,
      });
      const tabName = c.sheetTabName || c.name;
      claims.push({ tab: tabName, row: row.row, syncId: `${id}:${tabName.toLowerCase()}` });
    }
  }

  const clients = db.clients.map((c) => ({ ...c, totalStreams: totalsByClient[c.id] ?? c.totalStreams }));
  const saved = await commit({ ...db, placements: [...placements, ...created], clients, sheetSync: { lastSyncedAt: data.syncedAt } }, db);
  // songs that never reached the site get no Site Sync IDs on the sheet
  if (!saved) throw new Error("The sheet was read, but the synced numbers couldn't be saved — try again.");
  const onSite = new Set(saved.placements.map((p) => p.id));
  const kept = claims.filter((c) => onSite.has(c.syncId.split(":")[0]));

  if (kept.length) {
    fetch("/api/sheets-claim", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
      body: JSON.stringify({ claims: kept }),
    }).catch((err) => console.error("Claim-back failed:", err));
  }

  // a client whose tab couldn't be found by name gets nothing synced at
  // all, with no other signal that anything's wrong — surface it here so
  // staff know to set that client's "Sheet tab name" override.
  const missing = data.clients.filter((c) => !c.tabFound).map((c) => db.clients.find((x) => x.id === c.clientId)?.name).filter(Boolean);
  return { missing };
}

// Read-only roster-wide rollup — the landing view of Publishing, before
// staff pick an individual client. Pulls the MASTER tab's own precomputed
// per-writer totals directly (rather than re-deriving them from placements)
// so the numbers always match the sheet exactly, including the 3-year
// forecast columns the site doesn't otherwise track anywhere.
// every song whose splits don't add up, in two groups (lib/splits.js): "Assumed (even split)" is the owner's
// even default, ready to Confirm; "Needs a look" can't be completed evenly, so Fix opens its editor. Confirm is
// the song editor's Save (the site, then the client's own share to their writer tab); nothing reaches the
// sheet before it. This isn't ours clears out a song that was never ours
function splitsToConfirm(db) {
  const assumed = [], look = [];
  for (const g of splitsToFix(db)) {
    for (const p of g.songs) {
      const r = evenSplit(p.splits);
      (r.status === "assumed" ? assumed : look).push({ p, client: g.client, r });
    }
  }
  return { assumed, look };
}
function SplitsToFix({ db, commit, lum, reloadLum, onFix, focus, onGo }) {
  const { assumed, look } = useMemo(() => splitsToConfirm(db), [db]);
  const n = assumed.length + look.length;
  const [ask, setAsk] = useState(null);
  const [note, setNote] = useState(null);
  const [all, setAll] = useState(false); // the Confirm all card
  const [busy, setBusy] = useState(null); // the song being confirmed
  const box = useRef(null);
  // opened from the Dashboard's To do: the list is what to look at
  useEffect(() => { if (focus) landOn(box.current); }, [focus]);
  // the songs that write a share: the client is on the split (otherwise Save sends nothing to the sheet either)
  const writes = (items) => items.filter((x) => x.client && ownSplit({ splits: x.r.splits }, x.client));
  const confirm = async (items) => {
    setNote(null);
    const by = new Map(items.map((x) => [x.p.id, x.r.splits]));
    const done = await commit({ ...db, placements: db.placements.map((p) => (by.has(p.id) ? { ...p, splits: by.get(p.id) } : p)) });
    if (!done) return; // the save's own error banner says why, and nothing went to the sheet
    const live = done.placements.map((p) => p.id);
    const failed = [];
    // one at a time: two pushes to the same tab at once could both pick the same empty row
    for (const x of items) {
      const saved = done.placements.find((p) => p.id === x.p.id);
      const client = done.clients?.find((c) => c.id === x.p.clientId) || x.client;
      if (!saved || !client) continue;
      const err = await pushOwnShare(saved, client, live);
      if (err) failed.push(`${saved.song || "Untitled"} (${err})`);
    }
    const w = writes(items).length;
    setNote(failed.length
      ? { warn: true, text: `Confirmed on the site, but the pub sheet wasn't updated for ${failed.join(", ")}. Open the song and Save again.` }
      : { text: items.length === 1 ? `Confirmed "${items[0].p.song || "Untitled"}": ${splitWords(items[0].r.splits)}.${w ? " Its writer share is on the sheet." : ""}` : `Confirmed ${items.length} even splits.${w ? ` ${w} writer share${w === 1 ? " is" : "s are"} on the sheet.` : ""}` });
  };
  const one = async (x) => { setBusy(x.p.id); try { await confirm([x]); } finally { setBusy(null); } };
  const allWrites = writes(assumed);
  const tabs = new Set(allWrites.map((x) => x.client.id)).size;
  const row = (x, acts, mid) => (
    <div className="fix-row" key={x.p.id} data-song={x.p.id}>
      <span className="fix-song"><span className="fix-who">{x.client?.name || "A deleted client"} · </span>{x.p.song || "Untitled"}</span>
      {mid}
      <span className="fix-streams">{fmt(x.p.streams || 0)} streams</span>
      <span className="fix-acts">{acts}</span>
    </div>
  );
  return (
    <div className={`fix-panel${focus ? " flash" : ""}`} ref={box} data-sec="splits">
      <div className="fix-head">
        <h3>{n ? `Splits to confirm (${n})` : "Splits"}</h3>
        <span className="hint">{n ? "The default is even: the artist side is 50% and the producer side is 50%, shared evenly. Biggest songs first." : "All splits add up."}</span>
      </div>
      <DropNote note={note} onShow={onGo && ((sec) => onGo("luminate", sec))} />
      {assumed.length > 0 && (
        <div className="fix-group" data-group="assumed">
          <div className="fix-sub">
            <span className="fix-client">Assumed (even split) · {assumed.length}</span>
            <button className="btn sm" data-confirm-all disabled={!!busy} onClick={() => setAll(true)}>Confirm all {assumed.length}</button>
          </div>
          {assumed.map((x) => row(x,
            <button className="btn sm" data-confirm disabled={!!busy} onClick={() => one(x)}>{busy === x.p.id ? "Confirming…" : "Confirm"}</button>,
            <span className="fix-words" title={splitWords(x.r.splits)}>{splitWords(x.r.splits)}</span>))}
        </div>
      )}
      {look.length > 0 && (
        <div className="fix-group" data-group="look">
          <div className="fix-sub"><span className="fix-client">Needs a look · {look.length}</span></div>
          {look.map((x) => row(x, <>
            <button className="btn sm" onClick={() => onFix(x.p.id)}>Fix</button>
            {x.client && <button className="quiet-act" data-not-ours onClick={() => { setNote(null); setAsk({ p: x.p, client: x.client }); }}>Remove from catalog</button>}
          </>, <span className="fix-words fix-why"><span className="split-warn fix-pct">{splitPct(x.p.splits)}%</span> {x.r.reason}</span>))}
        </div>
      )}
      {all && (
        <AskCard title={`Confirm ${assumed.length} even split${assumed.length === 1 ? "" : "s"}?`} goLabel={`Confirm all ${assumed.length}`} busyLabel="Confirming…" plain
          go={async () => { await confirm(assumed); setAll(false); }} onClose={() => setAll(false)}>
          <p data-ask-writes>{allWrites.length
            ? `Writes the writer share for ${allWrites.length} song${allWrites.length === 1 ? "" : "s"} on ${tabs} client${tabs === 1 ? "'s" : "s'"} sheet tab${tabs === 1 ? "" : "s"}.`
            : "Nothing is written to the pub sheet: none of these clients is on their own split."} Unnamed people are only kept on the site.</p>
          <ul className="ask-places">{assumed.map((x) => <li key={x.p.id}>{x.p.song || "Untitled"} ({x.client?.name || "no client"}): {splitWords(x.r.splits)}</li>)}</ul>
        </AskCard>
      )}
      {ask && (
        <NotOursAsk db={db} commit={commit} lum={lum} target={ask.p} client={ask.client} onClose={() => setAsk(null)}
          onDone={(r) => { setAsk(null); setNote(r); reloadLum?.(); }} />
      )}
    </div>
  );
}

function CatalogOverview({ db, commit, lum, reloadLum, onSelectClient, onGo, onFix, focusSplits }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [streamSync, setStreamSync] = useState({ syncing: false, error: null });
  const dbNow = useRef(db); // the sheet pull below starts from the db as it is then, not at the click
  dbNow.current = db;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/sheets-master");
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(data.error || "Failed to load.");
        setState({ loading: false, error: null, data });
      } catch (err) {
        if (!alive) return;
        setState({ loading: false, error: err.message || "Failed to load master sheet data.", data: null });
      }
    })();
    return () => { alive = false; };
  }, []);

  // rebuilds STREAM DATA from the newest exports dropped on the Luminate page
  // (the same as its "Update the sheet again"), then chains a full site sync
  // (fullSiteSync) so this one click updates the sheet AND every client's
  // numbers together, with the "as of" date below reflecting that exact
  // moment. It no longer runs the sheet's Apps Script: that reads the Drive
  // folder, which stops getting new exports once they're dropped here, so
  // one press would roll every client back to older numbers. (The
  // /api/sync-streams route stays as a fallback.)
  const runStreamSync = async () => {
    setStreamSync({ syncing: true, error: null });
    try {
      await lumPost({ action: "resync" });
      window.dispatchEvent(new Event(STREAMS_EVENT));
      reloadLum?.(); // the resync linked songs and re-checked sheet tabs: the task counts and badge follow
      const { missing } = await fullSiteSync(dbNow.current, commit);
      const res2 = await fetch("/api/sheets-master");
      const data2 = await res2.json();
      if (res2.ok) setState({ loading: false, error: null, data: data2 });
      setStreamSync({
        syncing: false,
        error: missing.length ? `No sheet tab found for: ${missing.join(", ")}. If they do have a tab under a different name, set "Sheet tab name" on each one in Website › Roster.` : null,
      });
    } catch (err) {
      setStreamSync({ syncing: false, error: err.message || "Stream sync failed." });
    }
  };

  // MASTER's "Writer" column is just hand-typed display text — it can go
  // stale (a client renamed their tab but not this cell) or even be
  // outright wrong (a row labeled "WRITER 13" was found to actually pull
  // from the "prodgavin" tab via its formulas). readMasterRollup already
  // extracts the real tab each row's formulas reference as row.sheetTab —
  // match against THAT, not the label, the way findTab does server-side:
  // exact first, then personKey, a "Sheet tab name" override before a name.
  const findClient = (row) => {
    const byTab = [...db.clients.filter((c) => c.sheetTabName), ...db.clients.filter((c) => !c.sheetTabName)];
    return findByName(byTab, row.sheetTab || row.writer, (c) => c.sheetTabName || c.name);
  };

  const links = state.data?.links || {};
  // the task list lives on the Dashboard now: here, only how many of them are this tab's to fix
  // the splits task is the Splits to fix list right under this line: only the others point to the Dashboard
  const pubTasks = useMemo(() => dashTasks(db, lum).filter((t) => t.area === "roster" && t.k !== "splits").length, [db, lum]);
  const rate = state.data?.rate;
  // the writers' table: This week first (each writer's songs that have both weeks, added up, as
  // lib/weekly.js sumWeeks), biggest % first; any column head re-sorts. The 6 forecast columns wait
  // behind a toggle
  const { growth } = useGrowthState();
  const [sort, setSort] = useState({ col: "week", dir: -1 });
  const [forecast, setForecast] = useState(false);
  const weekOf = (client) => {
    let ws = client && growth ? db.placements.filter((p) => p.clientId === client.id).map((p) => growth[p.id]).filter((w) => w && w.thisWeek != null && w.lastWeek != null) : [];
    // one real week, as on the Dashboard (lib/weekly.js sameWeek): the songs whose week ends last
    const end = ws.map((w) => w.weekOf?.to).filter(Boolean).sort().pop();
    if (end) ws = ws.filter((w) => !w.weekOf || w.weekOf.to === end);
    if (!ws.length) return null;
    const t = ws.reduce((a, w) => a + w.thisWeek, 0), l = ws.reduce((a, w) => a + w.lastWeek, 0);
    // under 1,000 streams this week a % says little (1 → 2 is "▲ 100%"): streams only, as on the Dashboard
    return { thisWeek: t, wowPct: l > 0 && t >= WEEK_PCT_MIN ? (t / l - 1) * 100 : null, weekOf: ws.find((w) => w.weekOf)?.weekOf || null };
  };
  const cols = [["writer", "Writer"], ["songs", "Songs"], ["week", "This week"], ["gross", "Gross streams"], ["net", "Net streams"], ["earn", "Their earnings"], ["fee", "Our fee"],
    ...(forecast ? [["y1", "Our fee yr 1"], ["y2", "Our fee yr 2"], ["y3", "Our fee yr 3"], ["fc", "Our fee next 3 yrs"], ["tot", "Our fee in all"], ["share", "% of roster fee"]] : [])];
  const val = { songs: (x) => x.r.songs, gross: (x) => x.r.grossStreams, net: (x) => x.r.netStreams, earn: (x) => x.r.grossRevenue, fee: (x) => x.r.adminFee, y1: (x) => x.r.year1, y2: (x) => x.r.year2, y3: (x) => x.r.year3, fc: (x) => x.r.forecastTotal, tot: (x) => x.r.totalEstAdminFee, share: (x) => Number(x.r.pctOfRoster) };
  const rows = (state.data?.rows || []).map((r) => { const client = findClient(r); return { r, client, wk: weekOf(client) }; });
  const name = (x) => (x.client ? x.client.name : x.r.writer).toLowerCase();
  // the days This week covers, said once in the source line (the Dashboard says the same)
  const weeks = rows.map((x) => x.wk?.weekOf).filter(Boolean);
  const span = weeks.length ? { from: weeks.map((w) => w.from).sort()[0], to: weeks.map((w) => w.to).sort().pop() } : null;
  rows.sort((a, b) => {
    if (sort.col === "writer") return sort.dir * name(a).localeCompare(name(b));
    if (sort.col === "week") {
      // no % goes last either way, by this week's streams (none at all at the very end)
      const pa = a.wk?.wowPct ?? null, pb = b.wk?.wowPct ?? null;
      if (pa == null || pb == null) return pa == null && pb == null ? (b.wk?.thisWeek ?? -1) - (a.wk?.thisWeek ?? -1) : pa == null ? 1 : -1;
      return sort.dir * (pa - pb) || name(a).localeCompare(name(b));
    }
    return sort.dir * ((Number(val[sort.col](a)) || 0) - (Number(val[sort.col](b)) || 0)) || name(a).localeCompare(name(b));
  });
  return (
    <div>
      <div className="admin-head">
        <h2>Overview</h2>
        <div className="overview-links">
          <button className="btn ghost sm" onClick={runStreamSync} disabled={streamSync.syncing} title="Rebuild STREAM DATA from the newest exports dropped on the Luminate page and pull every client's numbers again">
            <RefreshCw size={14} className={streamSync.syncing ? "spin" : ""} /> {streamSync.syncing ? "Refreshing numbers…" : "Refresh numbers"}
          </button>
          {links.folder && <ExtLink href={links.folder} className="btn ghost sm" title="Open the pub sheet's Drive folder"><Folder size={14} /> Folder</ExtLink>}
          {links.portfolioA && <ExtLink href={links.portfolioA} className="btn ghost sm" title="Open Luminate Portfolio 1"><ExternalLink size={14} /> Portfolio 1</ExtLink>}
          {links.portfolioB && <ExtLink href={links.portfolioB} className="btn ghost sm" title="Open Luminate Portfolio 2"><ExternalLink size={14} /> Portfolio 2</ExtLink>}
        </div>
      </div>
      <p className="hint overview-subhint">
        From the pub sheet · {streamsAsOf({ luminateDay: growth ? Object.values(growth).map((g) => g?.latestOn).filter(Boolean).sort().pop() : null, pulledAt: db.sheetSync?.lastSyncedAt })}
        {span && <span className="overview-week"> · This week = {dayRange(span.from, span.to)} vs the week before</span>}
      </p>
      {streamSync.error && <p className="hint err-text overview-subhint">{streamSync.error}</p>}
      {pubTasks > 0 && (
        <p className="pub-tasks"><AlertTriangle size={14} /> {pubTasks} {splitsToFix(db).length ? "more " : ""}publishing task{pubTasks === 1 ? "" : "s"} · <button className="inline-link" onClick={() => onGo("home")}>see the Dashboard</button></p>
      )}
      <SplitsToFix db={db} commit={commit} lum={lum} reloadLum={reloadLum} onFix={onFix} focus={focusSplits} onGo={onGo} />

      {state.loading && <p className="muted">Loading master sheet data…</p>}
      {state.error && <p className="hint err-text">{state.error}</p>}

      {state.data && (
        <>
          <div className="cat-summary">
            <div className="cat-summary-grid">
              {/* MASTER adds each writer's gross up: a song two roster writers share is in it twice */}
              <div className="cat-stat"><span className="cat-stat-label">Gross Streams <span className="cat-stat-note">(added up by writer: a shared song counts once per writer)</span></span><span className="cat-stat-val">{fmt(state.data.totals.rosterGrossStreams)}</span></div>
              <div className="cat-stat"><span className="cat-stat-label">Net Streams</span><span className="cat-stat-val">{fmt(state.data.totals.rosterNetStreams)}</span></div>
              {/* the same words as each client's page; the fee figures are the sheet's own: the fee so far
                  (MASTER's "CATALOG TO DATE", the table's "Our fee"), its 3-year forecast, and the two together. The words are the
                  Advance calculator's: "Their earnings" and "Our fee" */}
              <div className="cat-stat"><span className="cat-stat-label">Their earnings <span className="cat-stat-note">(est., paid to them directly)</span></span><span className="cat-stat-val">{money(state.data.totals.grossRevenuePool)}</span></div>
              <div className="cat-stat"><span className="cat-stat-label">Our fee so far <span className="cat-stat-note">(est. admin fee)</span></span><span className="cat-stat-val">{money(state.data.totals.catalogToDate)}</span></div>
              {/* the sheet's forecast: Year 1 = the fee so far × B9 × (1 − B8), then B8 less each year; a guess, said so */}
              <div className="cat-stat"><span className="cat-stat-label">Our fee next 3 yrs <span className="cat-stat-note">(rough guess{yearOne(state.data) ? `: ${yearOne(state.data).share} of the fee so far in year 1, then ${yearOne(state.data).decay} less a year` : ""})</span></span><span className="cat-stat-val">{money(state.data.totals.threeYearForecast)}</span></div>
              <div className="cat-stat"><span className="cat-stat-label">Our fee in all <span className="cat-stat-note">(so far + 3 years)</span></span><span className="cat-stat-val">{money(state.data.totals.totalEstAdminFee)}</span></div>
            </div>
            {/* the one place the money's explained: everything below (and each client's page) is the same estimate */}
            <p className="hint cat-asof money-hint" title="The rate is ASSUMPTIONS!B7 on the pub sheet">
              Estimates from the pub sheet: all-time streams × the writer's share × {rate ? `$${+rate.toFixed(6)} a stream` : "the sheet's blended rate"}. Clients are paid directly; our commission is billed through Stripe.
            </p>
          </div>

          <div className="master-tools">
            <button className="btn ghost sm" aria-pressed={forecast} onClick={() => { setForecast((f) => !f); if (forecast && ["y1", "y2", "y3", "fc", "tot", "share"].includes(sort.col)) setSort({ col: "week", dir: -1 }); }}>{forecast ? "Hide forecast columns" : "Show forecast columns"}</button>
          </div>
          <div className="master-table-wrap">
            <table className="master-table">
              <thead>
                <tr>
                  {cols.map(([id, label]) => (
                    <th key={id} data-col={id} aria-sort={sort.col === id ? (sort.dir < 0 ? "descending" : "ascending") : undefined}>
                      <button className={sort.col === id ? "ar-sort on" : "ar-sort"} onClick={() => setSort((o) => ({ col: id, dir: o.col === id ? -o.dir : id === "writer" ? 1 : -1 }))}>{label}{sort.col === id ? (sort.dir < 0 ? "\u00a0▼" : "\u00a0▲") : ""}</button>
                      {/* which week it is, right on the column */}
                      {id === "week" && span && <span className="master-week-of">{dayRange(span.from, span.to)} vs the week before</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ r, client, wk }) => (
                  <tr
                    key={r.writer}
                    className={client ? "master-row-link" : ""}
                    onClick={client ? () => onSelectClient(client.id) : undefined}
                    title={client ? `Open ${client.name}` : "Not linked to a client on the site"}
                  >
                    <td>{client ? client.name : r.writer}</td>
                    <td>{r.songs}</td>
                    <td className="master-week">{wk ? <><WowPill pct={wk.wowPct} /><em>{fmt(wk.thisWeek)}</em></> : <span className="muted-dash" title="No last week to compare">—</span>}</td>
                    <td>{fmt(r.grossStreams)}</td>
                    <td>{fmt(r.netStreams)}</td>
                    <td>{money(r.grossRevenue)}</td>
                    <td>{money(r.adminFee)}</td>
                    {forecast && <>
                      <td>{money(r.year1)}</td>
                      <td>{money(r.year2)}</td>
                      <td>{money(r.year3)}</td>
                      <td>{money(r.forecastTotal)}</td>
                      <td>{money(r.totalEstAdminFee)}</td>
                      <td>{r.pctOfRoster}%</td>
                    </>}
                  </tr>
                ))}
              </tbody>
              {state.data.rosterTotal && (
                <tfoot>
                  <tr className="master-total-row">
                    <td>Roster total</td>
                    <td>{state.data.rosterTotal.songs}</td>
                    <td />
                    <td>{fmt(state.data.rosterTotal.grossStreams)}</td>
                    <td>{fmt(state.data.rosterTotal.netStreams)}</td>
                    <td>{money(state.data.rosterTotal.grossRevenue)}</td>
                    <td>{money(state.data.rosterTotal.adminFee)}</td>
                    {forecast && <>
                      <td>{money(state.data.rosterTotal.year1)}</td>
                      <td>{money(state.data.rosterTotal.year2)}</td>
                      <td>{money(state.data.rosterTotal.year3)}</td>
                      <td>{money(state.data.rosterTotal.forecastTotal)}</td>
                      <td>{money(state.data.rosterTotal.totalEstAdminFee)}</td>
                      <td>{state.data.rosterTotal.pctOfRoster}%</td>
                    </>}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// Publishing: the clients, their songs and splits, the MASTER totals, and the Advance calculator.
// A Dashboard task can open it on a client ("client:<id>") or on the calculator ("advance").
function CatalogAdmin({ db, commit, lum, reloadLum, sub, onGo, onSub }) {
  const [sec, setSec] = useState(sub === "advance" || sub?.startsWith("advance:") ? "advance" : "overview");
  const editSong = sub?.startsWith("edit:") ? db.placements.find((p) => p.id === sub.slice(5)) : null;
  // null clientId = the read-only Overview landing page, not "no selection"
  const [clientId, setClientIdOnly] = useState(sub?.startsWith("client:") ? sub.slice(7) : editSong ? editSong.clientId : null);
  // the address bar follows the client picked (in place: Back leaves Publishing, not chip by chip)
  const setClientId = (id) => { setClientIdOnly(id); onSub?.(id ? `client:${id}` : null); setFix(null); };
  // "Fix" (the Splits to fix list, a Next →): that song's client page with its editor open; n re-opens the same song
  // One-shot: a chip, Back to the list or any other pick clears it, so an old Fix never reopens its song.
  // n only counts up (a ref), so the same song asked for again still opens.
  const [fix, setFix] = useState(editSong ? { id: editSong.id, n: 1 } : null);
  const fixN = useRef(fix ? 1 : 0);
  const openFix = (id) => {
    const p = db.placements.find((x) => x.id === id);
    if (!p) return;
    setSec("overview"); setClientIdOnly(p.clientId); onSub?.(`client:${p.clientId}`); setFix({ id, n: ++fixN.current });
  };
  const toFix = useMemo(() => Object.fromEntries(splitsToFix(db).map((g) => [g.clientId, g.songs.length])), [db]);
  const client = db.clients.find((c) => c.id === clientId);
  const count = (cid) => db.placements.filter((p) => p.clientId === cid).length;
  const [addingClient, setAddingClient] = useState(false);
  const [newClientForm, setNewClientForm] = useState({ name: "", role: "Producer" });
  const [adding, setAdding] = useState(false);
  const [deleteWarn, setDeleteWarn] = useState(null);
  useEscape(() => setAddingClient(false), addingClient && !adding);
  const newNameTaken = nameTaken(db.clients, null, newClientForm.name);
  // the chip row scrolls sideways under 1200px: whichever way a client gets picked (a chip, a MASTER
  // row, a new client, a Dashboard task) its chip comes into view. Not on arriving at the tab on Overview
  const chips = useRef(null), picked = useRef(clientId !== null);
  useEffect(() => {
    if (picked.current) {
      // picked from deep in the taller Overview: back to the top, so Publishing's title, pills and the
      // client's header are all in view (not the client's page started under a cut-off header)
      const m = document.querySelector(".catalog-main");
      if (m && m.getBoundingClientRect().top < 0) window.scrollTo({ top: 0, behavior: "instant" });
      revealChip(chips.current?.querySelector(".cc.active"));
    }
    picked.current = true;
  }, [clientId]);

  const addClient = async () => {
    const name = newClientForm.name.trim();
    if (!name || adding || newNameTaken) return; // the form says why
    const client = {
      id: uid(), name, role: newClientForm.role, credit: "", bio: "", photo: "",
      spotify: "", apple: "", instagram: "", tiktok: "", youtube: "", soundcloud: "",
      sheetTabName: "", totalStreams: 0, onRoster: false,
    };
    setAdding(true);
    const ok = await commit({ ...db, clients: [...db.clients, client] }).finally(() => setAdding(false));
    if (!ok) return; // the form stays open with the name typed
    setClientId(client.id);
    setAddingClient(false);
    setNewClientForm({ name: "", role: "Producer" });
  };

  const [delAsk, setDelAsk] = useState(null); // the client whose Delete is being asked about
  const removeClient = async (c) => {
    setDelAsk(null);
    setDeleteWarn(null);
    if (clientId === c.id) setClientId(db.clients.find((x) => x.id !== c.id)?.id || null);
    const warn = await deleteClientCascade(db, commit, c.id);
    if (warn) setDeleteWarn(warn);
  };

  // (a stale copy of the numbers catches up in the background: StaffDashboard starts it)
  const pick = (id) => (e) => { setSec(id); revealChip(e.currentTarget); onSub?.(id === "advance" ? "advance" : clientId ? `client:${clientId}` : null); };
  return (
    <div>
      <div className="admin-head">
        <h2>Publishing</h2>
      </div>
      <div className="subnav">
        <button className={sec === "overview" ? "subpill active" : "subpill"} onClick={pick("overview")}>Overview &amp; clients</button>
        <button className={sec === "advance" ? "subpill active" : "subpill"} onClick={pick("advance")}>Advance<span className="pill-long"> calculator</span></button>
      </div>
      {sec === "advance" && <AdvanceTab pick={sub?.startsWith("advance:") ? sub.slice(8) : null} />}
      {sec === "overview" && <div className="catalog-wrap">
        <div className="catalog-clients" ref={chips}>
          <button className={clientId === null ? "cc active" : "cc"} onClick={() => setClientId(null)}>
            <span className="cc-overview-ic"><LayoutGrid size={16} /></span>
            <span className="cc-name">Overview</span>
          </button>
          <button className="cc cc-add" onClick={() => { setNewClientForm({ name: "", role: "Producer" }); setAddingClient(true); }}><Plus size={14} /> Add client</button>
          {deleteWarn && <p className="hint err-text">{deleteWarn}</p>}
          {db.clients.map((c) => (
            <div key={c.id} className="cc-row">
              <button className={c.id === clientId ? "cc active" : "cc"} onClick={() => setClientId(c.id)}>
                <Avatar src={c.photo} name={c.name} size={30} />
                {/* under the name, so the name keeps its width at 1280 */}
                <span className="cc-text"><span className="cc-name">{c.name}</span>
                  {toFix[c.id] > 0 && <span className="cc-fix" title="Songs whose splits don't add up to 100%">{toFix[c.id]} to fix</span>}</span>
                <span className="cc-count">{count(c.id)}</span>
              </button>
            </div>
          ))}
        </div>
        <div className="catalog-main">
          {clientId === null
            ? <CatalogOverview db={db} commit={commit} lum={lum} reloadLum={reloadLum} onSelectClient={setClientId} onGo={onGo} onFix={openFix} focusSplits={sub === "splits"} />
            : (client ? <SongManager db={db} commit={commit} clientId={clientId} isStaff lum={lum} reloadLum={reloadLum} fix={fix} onFix={openFix} onFixList={() => setClientId(null)} onGo={onGo} onDeleteClient={setDelAsk} />
              // deleted in another tab (this one's next save brought the news): their songs went with them
              : <p className="hint err-text">That client was deleted somewhere else.</p>)}
        </div>
      </div>}

      {delAsk && (() => {
        const a = clientDeleteAsk(db, delAsk);
        return <AskCard title={a.title} goLabel={a.goLabel} busyLabel="Deleting…" typeName={a.typeName} go={() => removeClient(delAsk)} onClose={() => setDelAsk(null)}><p>{a.body}</p></AskCard>;
      })()}
      {addingClient && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setAddingClient(false)}>
          <div className="modal-card">
            <div className="modal-head"><h3>New client</h3><button onClick={() => setAddingClient(false)} aria-label="Close"><X size={18} /></button></div>
            <div className="modal-body">
              <Field label="Name" value={newClientForm.name} onChange={(ev) => setNewClientForm({ ...newClientForm, name: ev.target.value })} onKeyDown={(ev) => ev.key === "Enter" && addClient()} />
              {newNameTaken && <p className="hint err-text">{NAME_TAKEN}</p>}
              <label className="fld"><span>Role</span>
                <select value={newClientForm.role} onChange={(ev) => setNewClientForm({ ...newClientForm, role: ev.target.value })}>
                  <option>Producer</option><option>Artist</option><option>Producer / Artist</option>
                </select>
              </label>
              <p className="hint">Starts hidden from the public roster. Add a photo, bio, socials, and publish them any time from Website → Roster. Their pub sheet tab is created automatically the first time you add a song for them.</p>
            </div>
            <div className="modal-foot">
              <button className="btn ghost sm" onClick={() => setAddingClient(false)}>Cancel</button>
              <button className="btn sm" onClick={addClient} disabled={!newClientForm.name.trim() || adding || newNameTaken}>{adding ? "Adding…" : "Add client"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* staff: Luminate — the songs to add to its portfolios, and this week's exports ------------- */
// One entry per real-world song: the same song on two co-writers' pages is one thing to add to a
// Luminate portfolio and one Luminate id. Status: tracked (its Luminate song is in a clients'
// portfolio's latest export), unplaced (has a Luminate id no export holds), waiting (added in
// Luminate, no numbers yet), missing (marked as added before its portfolio's latest export but not
// in it: takes no room), toAdd, or skipped ("don't track").
function lumGroups(db, lum) {
  const t = lum?.tracking || {}, inPortfolio = lum?.inPortfolio || {};
  const ports = (lum?.portfolios || []).filter((p) => p.kind === "roster");
  const hasExports = ports.some((p) => p.exportedAt);
  // the same rule as the server's pendingCount: added before the file was made, and not in it
  const missed = (g) => {
    const p = ports.find((x) => x.id === g.portfolioId);
    if (!p) return true;
    const made = p.exportedAt || p.uploadedAt;
    return !!(made && g.addedAt && new Date(g.addedAt) < new Date(made));
  };
  // a song is its Luminate id once it has one; a copy with no id joins the only linked copy of the
  // same title and artist (the next update gives it that id too)
  const title = (p) => `${normalizeTitle(p.song)}|${normalizeTitle(p.artist)}`;
  const idsOf = new Map();
  for (const p of db.placements) if (p.luminateId) idsOf.set(title(p), new Set([...(idsOf.get(title(p)) || []), p.luminateId]));
  const byKey = new Map();
  for (const p of db.placements) {
    const only = !p.luminateId && idsOf.get(title(p))?.size === 1 ? [...idsOf.get(title(p))][0] : null;
    const key = p.luminateId || only ? `lum:${p.luminateId || only}` : `t:${title(p)}`;
    const g = byKey.get(key) || { key, song: p.song, artist: p.artist, cover: "", ids: [], clientIds: [], isrc: "", checked: false, portfolioId: null, addedAt: null, skip: true, luminateId: "" };
    const tr = t[p.id] || {};
    g.ids.push(p.id);
    if (!g.clientIds.includes(p.clientId)) g.clientIds.push(p.clientId);
    g.cover ||= p.cover;
    g.isrc ||= tr.isrc || "";
    g.checked ||= !!tr.isrcCheckedAt;
    g.portfolioId ||= tr.portfolioId || null;
    g.addedAt ||= tr.addedAt || null;
    g.skip &&= !!tr.skip;
    g.luminateId ||= p.luminateId || only || "";
    byKey.set(key, g);
  }
  // a song Luminate already has under a matching title (offered in "which song is this?") is matched
  // there, never added a second time, nor called missing from an export that holds it (it was only
  // not linked by itself: two rows or two songs share the title). The server's missingCount agrees.
  const offered = new Set((lum?.unlinked || []).flatMap((u) => u.suggestions));
  for (const g of byKey.values()) {
    g.inPortfolio = g.luminateId ? inPortfolio[g.luminateId] || null : null;
    g.status = g.skip ? "skipped" : g.inPortfolio || (g.luminateId && !hasExports) ? "tracked"
      : !g.luminateId && g.ids.some((id) => offered.has(id)) ? "match"
      : g.portfolioId ? (missed(g) ? "missing" : "waiting") : g.luminateId ? "unplaced" : "toAdd";
  }
  return [...byKey.values()];
}

// the songs to add, split over the roster portfolios that still have room (in their order)
function lumPlan(groups, lum) {
  const todo = groups.filter((g) => g.status === "toAdd" || g.status === "unplaced");
  const slots = (lum?.portfolios || []).filter((p) => p.kind === "roster")
    .map((p) => ({ p, room: Math.max(0, p.capacity - (p.usedCount ?? p.songCount) - p.pendingCount), songs: [] }));
  const left = [];
  for (const g of todo) {
    const s = slots.find((x) => x.songs.length < x.room);
    if (s) s.songs.push(g); else left.push(g);
  }
  return { slots: slots.filter((s) => s.songs.length), left };
}

const ago = (iso) => {
  if (!iso) return "";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};
// a bare date ("2026-10-14", a snapshot's day) is that day wherever this is read, not UTC midnight
// "all four" on the Luminate page's step 2 (digits past ten)
const countWord = (n) => ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] || String(n);
const shortDay = (iso) => (iso ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
// a payment's day, with its year when it isn't this year's ("Dec 19, 2025" in a list of 2026 rows)
const payDay = (iso) => (iso && new Date(iso).getFullYear() !== new Date().getFullYear()
  ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : shortDay(iso));
// a run of days, as short as it reads: "Sep 17 – 23", "Aug 27 – Sep 8" (with the year when it isn't this one)
const dayRange = (from, to) => {
  const day = (iso) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso);
  const a = day(from), b = day(to), yr = (d) => (d.getFullYear() !== new Date().getFullYear() ? `, ${d.getFullYear()}` : "");
  const md = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (a.toDateString() === b.toDateString()) return md(b) + yr(b);
  if (a.getFullYear() !== b.getFullYear()) return `${md(a)}, ${a.getFullYear()} – ${md(b)}, ${b.getFullYear()}`;
  return `${md(a)} – ${a.getMonth() === b.getMonth() ? b.toLocaleDateString(undefined, { day: "numeric" }) : md(b)}${yr(b)}`;
};
// whole days from a date ("2026-10-14") to today, wherever this is read
const daysSince = (iso) => Math.round((new Date().setHours(12, 0, 0, 0) - new Date(`${iso}T12:00:00`).getTime()) / 86400000);
const signed = (n) => `${n >= 0 ? "+" : "−"}${fmt(Math.abs(Math.round(n)))}`;
const compact = (n) => {
  const a = Math.abs(n), s = n < 0 ? "−" : "+";
  return a >= 1e6 ? `${s}${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e3 ? `${s}${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K` : `${s}${a}`;
};

async function lumPost(body) {
  const res = await fetch("/api/luminate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
    body: JSON.stringify(body),
  }).catch(() => null);
  const data = res && await res.json().catch(() => null);
  if (!res?.ok) throw Object.assign(new Error(data?.error || "That didn't go through — check your connection and try again."), { data });
  return data;
}

// stream history for the songs this session can see ({ [placementId]: growth }); refetched after a
// Luminate update lands anywhere on the page. failed = it couldn't load (retry tries again); the song
// cards just go without, the Dashboard's gainers say so.
const STREAMS_EVENT = "dm-streams";
function useGrowthState() {
  const [growth, setGrowth] = useState(null);
  const [failed, setFailed] = useState(false);
  const loader = useRef(null);
  useEffect(() => {
    let alive = true;
    const load = () => { setFailed(false); return fetch("/api/growth", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!alive) return; if (d?.growth) setGrowth(d.growth); else setFailed(true); }).catch(() => alive && setFailed(true)); };
    loader.current = load;
    load();
    window.addEventListener(STREAMS_EVENT, load);
    return () => { alive = false; window.removeEventListener(STREAMS_EVENT, load); };
  }, []);
  return { growth, failed, retry: () => loader.current?.() };
}
const useGrowth = () => useGrowthState().growth;

// a song's all-time streams over time, as a small line (no axes: the numbers sit beside it)
function Sparkline({ series, height = 56 }) {
  if (!series || series.length < 2) return null;
  const w = 300, h = height, pad = 3;
  const xs = series.map(([d]) => new Date(`${d}T00:00:00Z`).getTime()), ys = series.map(([, s]) => s);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)], [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const px = (x) => pad + ((x - x0) / (x1 - x0 || 1)) * (w - pad * 2);
  const py = (y) => h - pad - ((y - y0) / (y1 - y0 || 1)) * (h - pad * 2);
  const line = series.map((_, i) => `${i ? "L" : "M"}${px(xs[i]).toFixed(1)},${py(ys[i]).toFixed(1)}`).join("");
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`Streams from ${fmt(ys[0])} to ${fmt(ys[ys.length - 1])}`}>
      <path d={`${line}L${px(x1).toFixed(1)},${h}L${px(x0).toFixed(1)},${h}Z`} className="spark-fill" />
      <path d={line} className="spark-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// "+12K this week" when the last two numbers are about a week apart, else the real gain with its
// date ("+30K since Oct 16"), never stretched or squeezed into a week
function GrowthChip({ g }) {
  if (!g) return null;
  // the export's own week first (Luminate's This Period), the same number the Publishing table shows
  if (g.thisWeek != null) return g.thisWeek > 0 ? <span className="grow-chip" title={`${fmt(g.thisWeek)} streams${g.weekOf ? `, ${dayRange(g.weekOf.from, g.weekOf.to)}` : " this week"}`}>{compact(g.thisWeek)} this week</span> : null;
  if (g.week != null) return g.week > 0 ? <span className="grow-chip" title={`${signed(g.week)} streams since ${shortDay(g.weekFrom)}`}>{compact(g.week)} this week</span> : null;
  if (!(g.gain > 0)) return null;
  return <span className="grow-chip" title={`${signed(g.gain)} streams since ${shortDay(g.gainFrom)}`}>{compact(g.gain)} since {shortDay(g.gainFrom)}</span>;
}

function CopyButton({ text, label = "Copy", onCopied }) {
  const [done, setDone] = useState(false);
  return (
    <button className={done ? "btn ghost sm lm-copy done" : "btn ghost sm lm-copy"} onClick={async () => {
      await copyText(text); setDone(true); onCopied?.(); setTimeout(() => setDone(false), 1600);
    }}>
      {done ? <><Check size={13} /> Copied</> : <><Copy size={13} /> {label}</>}
    </button>
  );
}

function PortfolioForm({ initial, onClose, onSaved }) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const [canMove, setCanMove] = useState(0); // its link is a portfolio taken in as A&R: how many files it has
  const [askMove, setAskMove] = useState(false);
  useEscape(onClose, !busy && !askMove);
  const save = async (action, sure = false) => {
    // "It's a clients' portfolio": a wrong "What's in it?" answer, taken back on purpose
    if (action === "move" && !sure) return setAskMove(true);
    setAskMove(false); setBusy(true); setErr(null);
    try {
      await lumPost(f.ar ? { action: "arLink", portfolioId: f.luminateId, url: f.url }
        : action === "remove" ? { action: "removePortfolio", id: f.id } : { action: "savePortfolio", ...f, fromAR: action === "move" });
      onSaved();
    }
    catch (e) { setErr(e.message); setCanMove(e.data?.canMove ? e.data.heldFiles || 1 : 0); setBusy(false); }
  };
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal-card">
        <div className="modal-head"><h3>{f.ar ? `The ${f.name} link` : f.id ? "Edit portfolio" : "Add a portfolio"}</h3><button onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-body">
          {f.ar ? <>
            <Field label="Link to it in Luminate" value={f.url} placeholder="https://…" onChange={(e) => setF({ ...f, url: e.target.value })}
              hint="Open the portfolio in Luminate and copy the address bar. Used for its Open button." />
            {err && <p className="hint err-text" role="alert">{err}</p>}
          </> : <>
          <Field label="Name" value={f.name} placeholder="Portfolio C" onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Field label="Link to it in Luminate" value={f.url} placeholder="https://…" onChange={(e) => setF({ ...f, url: e.target.value })}
            hint="Open the portfolio in Luminate and copy the address bar. Used for the Open buttons, and to recognize its exports." />
          <Field label="Slots it holds (songs, artists and releases)" type="number" min={1} max={1000} value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })}
            hint="For your clients' songs. A&R portfolios aren't added here: their exports are recognized by themselves." />
          {err && <p className="hint err-text" role="alert">{err}</p>}
          </>}
        </div>
        <div className="modal-foot">
          {canMove > 0 && <button className="btn ghost sm" onClick={() => save("move")} disabled={busy}>Move to client portfolios</button>}
          {f.id && !f.ar && <button className="btn ghost sm" onClick={() => save("remove")} disabled={busy}>Remove</button>}
          <button className="btn ghost sm" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn sm" onClick={() => save()} disabled={busy || !String(f.name).trim()}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
      {askMove && (
        <AskCard title="Move it to your clients' portfolios?" goLabel="Move" busyLabel="Moving…" plain go={() => save("move", true)} onClose={() => setAskMove(false)}>
          <p>Its {canMove} saved export{canMove === 1 ? "" : "s"} become{canMove === 1 ? "s" : ""} clients' numbers: the sheet and every client's page update now, and its songs show up to match and to add.</p>
        </AskCard>
      )}
    </div>
  );
}

// one line per portfolio in an upload's answer: its newest file, with the older ones of the same drop
// folded in (kept as growth history, or skipped as duplicates)
function lumByPortfolio(results) {
  const by = new Map();
  for (const r of results) by.set(r.portfolioId, [...(by.get(r.portfolioId) || []), r]);
  return [...by.values()].map((list) => {
    const used = list.filter((r) => r.status === "ready" || r.status === "taken").sort((a, b) => String(a.exportedAt).localeCompare(String(b.exportedAt)));
    const r = used[used.length - 1] || list.find((x) => x.status === "blocked") || list[list.length - 1];
    return { r, history: used.filter((x) => x !== r), dupes: list.filter((x) => x.status === "older").length };
  });
}

const AR_AREAS = ["ar_artists", "ar_songs"];
// An A&R file's growth line: the all-time growth of the rows both files hold, since when, leaving out
// any whose all-time went down (each has its own line), and how many rows are new. "+6,612,612
// all-time streams since Aug 27 (9 weeks) across the 2 artists in both files (5 artists are new to the list)"
function lumGainText(r) {
  const p = r.preview || {}, what = r.area === "ar_artists" || r.artists === r.entities ? "artist" : "song";
  const n = (k, w) => `${k} ${w}${k === 1 ? "" : "s"}`;
  const days = p.gainFrom && r.exportedAt ? Math.round((new Date(r.exportedAt) - new Date(p.gainFrom)) / 864e5) : null;
  const since = p.gainFrom ? `since ${shortDay(p.gainFrom)}${days >= 14 ? ` (${Math.round(days / 7)} weeks)` : ""}` : "since its last export";
  const fresh = p.newCount ? ` (${n(p.newCount, what)} ${p.newCount === 1 ? "is" : "are"} new to the list)` : "";
  return `${signed(p.gain || 0)} all-time streams ${since} across the ${n(p.gainRows ?? 0, what)} in both files${fresh}`;
}
// what one drop can carry: the upload route's 60 files and its 4 MB request (a long-uncleaned Downloads
// folder holds more), kept with room to spare for the request's own wrapping
const DROP_MAX_FILES = 60, DROP_MAX_CHARS = 3_500_000;
// Dropped CSVs are checked first and nothing changes yet: the preview says what each file would do
// (songs and slots, growth since the last export, new songs, songs that would link), then Apply
// takes them in. A blocked file can be applied on purpose ("use it anyway") after a warning. A
// portfolio this page has never seen asks "What's in it?": one that looks like A&R (only artists,
// or weekly numbers) has no answer picked for it, so it's never taken by accident. A&R files are
// only kept for the A&R tab; they never touch STREAM DATA or the clients' numbers.
function ExportDrop({ onDone, saved = [] }) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(null); // "checking" | "applying"
  const [out, setOut] = useState(null);
  const [areas, setAreas] = useState({}); // POR id -> the picker's answer, for portfolios never seen
  const [askBlocked, setAskBlocked] = useState(false);
  const files = useRef(null);
  const leftOut = useRef(null); // "Only 60 files at a time…": said on the preview and after Apply
  const post = async (body) => {
    const res = await fetch("/api/luminate-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = res && await res.json().catch(() => null);
    if (!data) throw new Error("That didn't go through — check your connection and try again.");
    return { ok: res.ok, data };
  };
  const check = async (list) => {
    setBusy("checking"); setOut(null);
    try {
      const { data } = await post({ files: list, dryRun: true });
      // a clients'-looking new portfolio starts on "Clients' songs", an all-artist one on "A&R artists";
      // anything else that looks A&R waits for an answer
      const first = {};
      for (const r of data.results || []) if (r.unknown) first[r.portfolioId] = !r.needsArea ? "clients" : r.entities && r.artists === r.entities ? "ar_artists" : "";
      setAreas(first);
      setOut(data.error && !data.results ? { fatal: data.error } : withLeftOut(data));
    }
    catch (e) { setOut({ fatal: e.message }); }
    finally { setBusy(null); }
  };
  const apply = async (force = false) => {
    const pick = (out?.results || []).filter((r) => r.status === "ready" || (force && r.status === "blocked")).map((r) => r.fileName);
    setBusy("applying");
    try {
      const { data } = await post({ files: files.current.filter((f) => pick.includes(f.name)), force, areas });
      setOut(withLeftOut({ ...data, applied: true, fatal: data.updated ? null : data.error || null }));
      if (data.updated) window.dispatchEvent(new Event(STREAMS_EVENT));
      if (data.updated || data.kept) onDone();
    } catch (e) { setOut({ ...out, fatal: e.message }); }
    finally { setBusy(null); }
  };
  const withLeftOut = (data) => (leftOut.current ? { ...data, errors: [leftOut.current, ...(data.errors || [])] } : data);
  const take = async (list) => {
    const read = await Promise.all([...list].filter((f) => /\.csv$/i.test(f.name) || f.type === "text/csv").map(async (f) => ({ name: f.name, text: await f.text() })));
    if (!read.length) return setOut({ fatal: "Those weren't CSV files. Drop the portfolio exports (portfolio-export-POR….csv)." });
    // more than one request can carry is cut here, the way the route cuts at 60 files, and said the
    // same way; sent whole, it would only come back as "check your connection"
    let size = 0;
    const fit = read.filter((f, i) => i < DROP_MAX_FILES && (size += f.text.length) <= DROP_MAX_CHARS);
    const n = read.length - fit.length;
    leftOut.current = n ? { fileName: "", leftOut: n, message: fit.length === DROP_MAX_FILES
      ? `Only ${DROP_MAX_FILES} files at a time: ${n} ${n === 1 ? "was" : "were"} left out. Drop ${n === 1 ? "it" : "them"} again.`
      : `Only ${fit.length} of these files fit in one drop: ${n} ${n === 1 ? "was" : "were"} left out. Drop ${n === 1 ? "it" : "them"} again.` } : null;
    files.current = fit;
    check(fit);
  };
  const results = out?.results || [];
  const ready = results.filter((r) => r.status === "ready"), blocked = results.filter((r) => r.status === "blocked");
  const slots = (r) => [r.songs && `${r.songs} song${r.songs === 1 ? "" : "s"}`, r.artists && `${r.artists} artist${r.artists === 1 ? "" : "s"}`,
    r.releases && `${r.releases} release${r.releases === 1 ? "" : "s"}`, r.otherTypes && `${r.otherTypes} other (${(r.otherNames || []).join(", ")})`].filter(Boolean).join(" + ") || "nothing";
  const areaOf = (r) => (r.unknown ? areas[r.portfolioId] || "" : r.area);
  const unanswered = lumByPortfolio(results).filter(({ r }) => r.unknown && r.status === "ready" && !areas[r.portfolioId]);
  // a saved portfolio (either area) with no file in this drop: easy to forget one of the four
  const notIn = results.length ? saved.filter((p) => p.luminateId && !results.some((r) => r.portfolioId === p.luminateId)).map((p) => p.name) : [];
  return (
    <div className="lm-drop-wrap" data-sec="drop">
      <label
        className={`lm-drop${over ? " over" : ""}${busy ? " busy" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) take(e.dataTransfer.files); }}
      >
        <input type="file" accept=".csv,text/csv" multiple disabled={!!busy} onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
        {busy ? <RefreshCw size={22} className="spin" /> : <UploadCloud size={22} />}
        <strong>{busy === "checking" ? "Checking the files…" : busy === "applying" ? "Updating the sheet and every client's numbers…" : saved.length > 1 ? `Drop all ${saved.length} of this week's exports here` : "Drop this week's portfolio exports here"}</strong>
        <span>{busy ? "This takes a few seconds." : "or click to choose them. The A&R ones go to the A&R tab by themselves. Nothing changes until you press Apply."}</span>
      </label>
      {out && (
        <div className={`lm-result${out.preview ? " lm-preview" : ""}`} role="status">
          {out.preview && <p className="lm-result-title">{ready.length ? "Here's what this update would do. Nothing has changed yet." : "Nothing in these files can be used."}</p>}
          {out.fatal && <p className="hint err-text">{out.fatal}</p>}
          {lumByPortfolio(results).map(({ r, history, dupes }) => (
            <div key={r.fileName} className={`lm-result-row ${r.status}`}>
              {r.status === "taken" || r.status === "ready" ? <CheckCircle2 size={15} /> : r.status === "blocked" || r.status === "needsArea" ? <AlertTriangle size={15} /> : <Clock size={15} />}
              <span>
                <strong>{r.portfolioName || `New portfolio …${String(r.portfolioId).slice(-4)}`}</strong>
                {r.status === "ready" && <>
                  {AR_AREAS.includes(areaOf(r)) ? ` · ${slots(r)}` : ` · ${slots(r)} (${r.entities} of ${r.capacity || 100} slots)`}
                  {r.preview?.first ? ` · first export of this portfolio · ${fmt(r.preview.totalStreams)} all-time streams`
                    : AR_AREAS.includes(areaOf(r)) ? ` · ${lumGainText(r)}`
                    : ` · ${signed(r.preview?.gain || 0)} streams since its last export`}
                  {r.preview?.newCount && !r.preview.first ? <em> {r.preview.newCount} new: {r.preview.newSongs.slice(0, 6).join(", ")}{r.preview.newCount > 6 ? "…" : ""}.</em> : null}
                  {r.preview?.goneCount ? <em> {r.preview.goneCount} no longer in it: {r.preview.goneSongs.slice(0, 4).join(", ")}{r.preview.goneCount > 4 ? "…" : ""}.</em> : null}
                  {AR_AREAS.includes(areaOf(r)) && <em> A&amp;R export: saved for the A&amp;R tab. It doesn't change any client numbers.</em>}
                </>}
                {r.status === "taken" && (AR_AREAS.includes(r.area) ? ` · ${slots(r)} · ${r.message}` : ` · ${slots(r)} taken in`)}
                {r.status !== "ready" && r.status !== "taken" && ` · ${r.message}`}
                {r.unknown && r.status === "ready" && (
                  <span className="lm-area">
                    <label>What's in it?{" "}
                      <select className="lm-pick" value={areas[r.portfolioId] || ""} disabled={!!busy} onChange={(e) => setAreas((a) => ({ ...a, [r.portfolioId]: e.target.value }))}>
                        <option value="" disabled>Pick one…</option>
                        <option value="clients">Clients' songs</option>
                        <option value="ar_artists">A&amp;R artists</option>
                        <option value="ar_songs">A&amp;R songs</option>
                      </select>
                    </label>
                    {r.needsArea && <em> {r.entities && r.artists === r.entities ? "It only holds artists" : "It has weekly numbers"}, so it looks like an A&amp;R portfolio.{areas[r.portfolioId] ? "" : " Pick what it holds before you apply."}</em>}
                  </span>
                )}
                {/* each note on its own line (one per artist whose all-time went down) */}
                {(r.notes || []).map((n) => <em key={n} className="lm-note"> {n}</em>)}
                {history.length > 0 && <em> Plus {history.length} earlier export{history.length === 1 ? "" : "s"} ({shortDay(history[0].exportedAt)} – {shortDay(history[history.length - 1].exportedAt)}) {r.status === "ready" ? "to keep" : "kept"} as growth history.</em>}
                {dupes > 0 && <em> {dupes} duplicate{dupes === 1 ? "" : "s"} or older file{dupes === 1 ? "" : "s"} skipped.</em>}
              </span>
            </div>
          ))}
          {(out.errors || []).map((e) => (
            <div key={e.fileName || e.message} className="lm-result-row blocked"><AlertTriangle size={15} /><span>{e.message}</span></div>
          ))}
          {notIn.length > 0 && <div className="lm-result-row lm-notin"><Clock size={15} /><span>Not in this drop: {notIn.join(", ")}.</span></div>}
          {out.preview && out.links?.length > 0 && <p className="hint">Would link {out.links.length} song{out.links.length === 1 ? "" : "s"} you marked as added: {[...new Set(out.links.map((l) => l.song))].join(", ")}.</p>}
          {out.preview && out.copied?.length > 0 && <p className="hint">Would also give {out.copied.length === 1 ? "a co-writer's copy" : `${out.copied.length} co-writers' copies`} the Luminate id the same song already has on another page, so {out.copied.length === 1 ? "that share counts" : "those shares count"} in the sheet: {[...new Set(out.copied.map((l) => l.song))].join(", ")}.</p>}
          {out.applied && out.updated && (
            <p className="hint lm-result-sum">
              Done: sheet and site updated{out.summary?.linked ? ` · ${out.summary.linked} new song${out.summary.linked === 1 ? "" : "s"} linked` : ""}
              {out.summary?.weekTotal != null && out.summary.gainers?.length ? ` · ${signed(out.summary.weekTotal)} streams this week` : ""}.
            </p>
          )}
          {out.applied && !out.updated && out.kept > 0 && !out.error && (
            <p className="hint lm-result-sum">Kept {out.kept === 1 ? "the A&R export" : `${out.kept} A&R exports`} for the A&amp;R tab. Nothing else changed.</p>
          )}
          {out.applied && out.summary?.copied?.length > 0 && (
            <p className="hint">Gave {out.summary.copied.length === 1 ? "a co-writer's copy" : `${out.summary.copied.length} co-writers' copies`} the Luminate id their song already had: {[...new Set(out.summary.copied)].join(", ")}.</p>
          )}
          {out.applied && out.error && <p className="hint err-text">{out.error} The exports are saved: press "Update the sheet again" up top.</p>}
          {out.preview && (
            <div className="lm-result-acts">
              {ready.length > 0 && <button className="btn sm" disabled={!!busy || unanswered.length > 0} onClick={() => apply(false)}><Check size={14} /> {busy === "applying" ? "Applying…" : `Apply this update${blocked.length ? ` (${ready.length} file${ready.length === 1 ? "" : "s"})` : ""}`}</button>}
              {unanswered.length > 0 && <span className="hint">Pick what {unanswered.length === 1 ? "the new portfolio holds" : `the ${unanswered.length} new portfolios hold`} first.</span>}
              {blocked.length > 0 && <button className="btn ghost sm" disabled={!!busy} onClick={() => setAskBlocked(true)}>Use the blocked file anyway</button>}
              <button className="btn ghost sm" disabled={!!busy} onClick={() => setOut(null)}>Cancel</button>
            </div>
          )}
        </div>
      )}
      {askBlocked && (
        <AskCard title="Use the blocked file anyway?" goLabel="Use anyway" busyLabel="Applying…" go={async () => { setAskBlocked(false); await apply(true); }} onClose={() => setAskBlocked(false)}>
          <p>Its lower numbers will replace the current ones for every song in that portfolio.</p>
        </AskCard>
      )}
    </div>
  );
}

function LuminateAdmin({ db, commit, lum, lumErr, reloadLum, reloadDb, sub, toLum, onGo }) {
  const groups = useMemo(() => lumGroups(db, lum), [db, lum]);
  const plan = useMemo(() => lumPlan(groups, lum), [groups, lum]);
  const clientName = (id) => db.clients.find((c) => c.id === id)?.name || "";
  const [editing, setEditing] = useState(null); // a portfolio form
  const [checked, setChecked] = useState(() => new Set()); // group keys ticked as added
  const [copied, setCopied] = useState(() => new Set());
  const [finding, setFinding] = useState(() => new Set());
  const [typed, setTyped] = useState({}); // group key -> ISRC being typed
  const [busy, setBusy] = useState(null), [err, setErr] = useState(null);
  const [arList, setArList] = useState(false); // the A&R names to add (the same list the Dashboard opens)
  const [ask, setAsk] = useState(null); // a confirm card: { notOurs: placement } | { lumOnly: unlinked row }
  const [note, setNote] = useState(null); // what the last "This isn't ours" did
  const [flash, setFlash] = useState(null); // the block a jump landed on, lit up for a moment
  const refresh = async () => { await reloadLum(); await reloadDb(); };
  const run = async (what, fn) => {
    setBusy(what); setErr(null);
    try { await fn(); await refresh(); } catch (e) { setErr(e.message); } finally { setBusy(null); }
  };

  // songs still needing an ISRC are looked up in the background, a few at a time: one run at a
  // time, picking up whatever still needs one after each batch (the list moves as it goes)
  // a Dashboard task can point at a list further down ("add", "match", "missing", "gone"): shown once
  // it has drawn, lit up for a moment so the eye finds it
  const jumpTo = (sec) => {
    const el = document.querySelector(`.lm [data-sec="${CSS.escape(String(sec))}"]`); // sec comes from the address bar
    if (!el) return;
    el.scrollIntoView({ block: "start" });
    setFlash(sec); setTimeout(() => setFlash((f) => (f === sec ? null : f)), 1200);
  };
  const jumped = useRef(false);
  useEffect(() => {
    if (!sub || !lum || jumped.current) return;
    jumped.current = true;
    jumpTo(sub);
  }, [sub, lum]);
  const looked = useRef(new Set()), looking = useRef(false), latest = useRef(groups);
  latest.current = groups;
  useEffect(() => {
    const next = () => latest.current.filter((g) => (g.status === "toAdd" || g.status === "unplaced") && !g.isrc && !g.checked && !looked.current.has(g.key)).slice(0, 4);
    if (!lum || looking.current || !next().length) return;
    looking.current = true;
    (async () => {
      try {
        for (let batch = next(); batch.length; batch = next()) {
          batch.forEach((g) => looked.current.add(g.key));
          setFinding((s) => new Set([...s, ...batch.map((g) => g.key)]));
          try { await lumPost({ action: "findIsrcs", groups: batch.map((g) => g.ids) }); } catch { /* Deezer down: a box to type it in, until the next visit */ }
          setFinding((s) => { const n = new Set(s); batch.forEach((g) => n.delete(g.key)); return n; });
          await reloadLum();
        }
      } finally { looking.current = false; }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lum, groups]);

  const saveIsrc = (g) => run(`isrc:${g.key}`, () => lumPost({ action: "setIsrc", placementIds: g.ids, isrc: typed[g.key] || "" }).then(() => setTyped((t) => ({ ...t, [g.key]: undefined }))));
  const markAdded = (slot) => {
    const chosen = slot.songs.filter((g) => checked.has(g.key));
    if (!chosen.length) return;
    run(`mark:${slot.p.id}`, async () => {
      await lumPost({ action: "markAdded", portfolioId: slot.p.id, placementIds: chosen.flatMap((g) => g.ids) });
      setChecked((s) => { const n = new Set(s); chosen.forEach((g) => n.delete(g.key)); return n; });
    });
  };
  const toggle = (k) => setChecked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  if (!lum) return lumErr
    ? <p className="hint err-text"><span>Couldn't load the Luminate page.</span> <button className="btn ghost sm" onClick={reloadLum}>Try again</button></p>
    : <p className="muted">Loading…</p>;
  const roster = lum.portfolios.filter((p) => p.kind === "roster");
  // every weekly export, the clients' portfolios first, then A&R (an A&R one's link form saves by POR id)
  const arPorts = (lum.arPortfolios || []).map((p) => ({ ...p, ar: true }));
  const allExports = [...lum.portfolios, ...arPorts];
  const waiting = groups.filter((g) => g.status === "waiting");
  const missing = groups.filter((g) => g.status === "missing");
  const portOf = (id) => lum.portfolios.find((p) => p.id === id);
  // what a portfolio's latest export holds, by type: "33 songs + 2 releases", "3 artists"
  const held = (p) => [p.songCount && `${p.songCount} song${p.songCount === 1 ? "" : "s"}`, p.artistCount && `${p.artistCount} artist${p.artistCount === 1 ? "" : "s"}`,
    p.releaseCount && `${p.releaseCount} release${p.releaseCount === 1 ? "" : "s"}`, p.otherTypes && `${p.otherTypes} other`].filter(Boolean).join(" + ") || "0 songs";
  const last = lum.lastUpload;
  const pName = (id) => lum.portfolios.find((p) => p.id === id)?.name || "a portfolio";
  const candidates = groups.filter((g) => !g.luminateId && !g.skip);
  const skipped = groups.filter((g) => g.status === "skipped");

  return (
    <div className="lm">
      <div className="admin-head lm-head">
        <h2>Luminate</h2>
        <div className="overview-links">
          <button className="btn ghost sm" disabled={!!busy} onClick={() => run("resync", () => lumPost({ action: "resync" }).then(() => window.dispatchEvent(new Event(STREAMS_EVENT))))} title="Rebuild STREAM DATA from the newest exports and pull every client's numbers again">
            <RefreshCw size={14} className={busy === "resync" ? "spin" : ""} /> {busy === "resync" ? "Updating…" : "Update the sheet again"}
          </button>
          <button className="btn ghost sm" onClick={() => setEditing({ name: "", url: "", kind: "roster", capacity: lum.cap })}><Plus size={14} /> Add portfolio</button>
        </div>
      </div>
      <p className="hint overview-subhint">
        {last ? <>Last update {shortDay(last.at)} ({ago(last.at)}){last.by ? ` by ${last.by}` : ""}.</> : "No exports taken in yet. Drop the portfolio exports below to start."}
        {last?.weekTotal != null && last.gainers?.length ? ` That week: ${signed(last.weekTotal)} streams.` : ""}
        {(last?.files || []).filter((f) => f.longWeeks).map((f) => ` ${f.portfolio}'s file covered about ${f.longWeeks} weeks, so its weekly numbers weren't used.`).join("")}
      </p>
      {err && <p className="hint err-text overview-subhint" role="alert">{err}</p>}
      {lum.alertsConnected === false && <p className="hint overview-subhint">ClickUp alerts aren't connected yet: they start once the Dashboard Alerts channel is set up.</p>}

      <ol className="lm-steps">
        <li className={plan.slots.length || plan.left.length ? "todo" : "done"}>
          <span className="lm-step-n">1</span>
          <div><strong>Add new songs to Luminate</strong>{plan.slots.length || plan.left.length
            ? <span><button className="inline-link lm-show-add" onClick={() => jumpTo(plan.slots.length ? "add" : "full")}>Show the {plan.slots.reduce((a, s) => a + s.songs.length, 0) + plan.left.length} ↓</button> with their ISRCs</span>
            : <span>Nothing new to add</span>}</div>
        </li>
        <li>
          <span className="lm-step-n">2</span>
          <div><strong>{allExports.length > 1 ? `Export all ${countWord(allExports.length)} with 1 week · Worldwide` : "Export each portfolio with 1 week · Worldwide"}</strong><span>Open each one, then Export CSV.</span>
            <div className="lm-step-links">
              {lum.portfolios.length === 0 && <span className="hint">Your portfolios appear here after the first drop.</span>}
              {allExports.map((p) => (p.url
                ? <ExtLink key={p.id} href={p.url} className="btn ghost sm"><ExternalLink size={13} /> Open {p.name} ↗</ExtLink>
                : <button key={p.id} className="btn ghost sm" onClick={() => setEditing({ ...p })}><Link2 size={13} /> Add the {p.name} link</button>))}
            </div>
          </div>
        </li>
        <li>
          <span className="lm-step-n">3</span>
          <div><strong>Drop the files here</strong><span>The sheet, every client's numbers and this week's growth update by themselves.</span></div>
        </li>
      </ol>

      <ExportDrop onDone={refresh} saved={allExports} />

      {allExports.length > 0 && (
        <div className="lm-ports">
          {lum.portfolios.map((p) => {
            const used = (p.usedCount ?? p.songCount) + p.pendingCount, pct = Math.min(100, (used / p.capacity) * 100);
            // a full one says where new songs go; an export over 8 days old breaks the weekly %, so it's amber
            const room = used >= p.capacity && lum.portfolios.find((q) => q.id !== p.id && q.area === p.area && (q.usedCount ?? q.songCount) + q.pendingCount < q.capacity);
            const age = p.exportedAt ? Math.floor((Date.now() - new Date(p.exportedAt).getTime()) / 86400000) : null;
            return (
              <button key={p.id} className="lm-port" onClick={() => setEditing({ ...p })} title="Edit name, link or size">
                <span className="lm-port-top"><strong>{p.name}</strong></span>
                <span className="lm-port-count"><b>{used}</b> / {p.capacity}{used >= p.capacity ? ` · Full${room ? ` · new songs go in ${room.name}` : ""}` : ""}</span>
                <span className="lm-port-meta">{held(p)}{p.pendingCount ? ` + ${p.pendingCount} just added` : ""}</span>
                <span className={`lm-bar${pct >= 95 ? " full" : pct >= 80 ? " near" : ""}`}><i style={{ width: `${pct}%` }} /></span>
                <span className={age > 8 ? "lm-port-meta lm-port-old" : "lm-port-meta"}>{p.exportedAt ? `Exported ${shortDay(p.exportedAt)}${age > 8 ? ` (${age} days ago)` : ""}${p.songCount ? ` · ${fmt(p.totalStreams)} all-time streams` : ""}` : "No export yet"}</span>
                {/* its newest file was made for longer than a week: no weekly numbers from it */}
                {p.longWeeks && <span className="lm-port-meta lm-port-old">That file covers about {p.longWeeks} weeks, so it gave no weekly numbers. Export it again with 1 week.</span>}
              </button>
            );
          })}
          {/* the A&R ones, read-only: their numbers go to the A&R tab */}
          {arPorts.map((p) => (
            <div key={p.id} className="lm-arcard">
              <strong>{p.name}</strong>
              <span className="lm-port-meta">{p.exportedAt ? `Exported ${shortDay(p.exportedAt)}` : "No export yet"} · for the A&amp;R tab</span>
            </div>
          ))}
        </div>
      )}

      <DropNote note={note} onShow={jumpTo} />
      {/* removed as "not ours" but still in a portfolio: the app can't take it out of Luminate */}
      {lum.notOursLeft?.length > 0 && (
        <div className={flash === "gone" ? "lm-block lm-gone lm-flash" : "lm-block lm-gone"} data-sec="gone">
          <div className="lm-block-head"><div><strong>Taken off the site, still in Luminate</strong><span className="hint"> The next export after you take it out clears this by itself.</span></div></div>
          <div className="lm-list">
            {lum.notOursLeft.map((r) => (
              <div key={r.luminateId} className="lm-song lm-gone-row">
                <span className="lm-cover"><Radar size={16} /></span>
                <span className="lm-song-main"><strong>{r.name}</strong><span>In {r.portfolioName}{r.lumName && r.lumName !== r.name ? ` as "${r.lumName}"` : ""} · uses 1 slot</span></span>
                <span className="lm-unl-acts">
                  {r.url ? <ExtLink href={r.url} className="btn ghost sm"><ExternalLink size={13} /> Open {r.portfolioName} ↗</ExtLink>
                    : portOf(r.portfolioId) && <button className="btn ghost sm" onClick={() => setEditing({ ...portOf(r.portfolioId) })}><Link2 size={13} /> Add the {r.portfolioName} link</button>}
                  <button className="btn sm" disabled={!!busy} onClick={() => run(`out:${r.luminateId}`, () => lumPost({ action: "notOursOut", luminateId: r.luminateId }))}><Check size={13} /> Mark as removed</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(plan.slots.length > 0 || plan.left.length > 0 || toLum?.count > 0) && <h3 className="lm-h3">Add to Luminate</h3>}
      {plan.slots.length > 0 && <p className="hint lm-acts-hint">Exclude from Luminate: it's ours, it just stays out of Luminate. Remove from catalog: takes it off the site and the pub sheet too.</p>}
      {plan.slots.map((slot, i) => (
        <div key={slot.p.id} className={i === 0 && flash === "add" ? "lm-block lm-flash" : "lm-block"} data-sec={i === 0 ? "add" : undefined}>
          <div className="lm-block-head">
            <div>
              <strong>Add {slot.songs.length === 1 ? "this song" : `these ${slot.songs.length}`} to {slot.p.name}</strong>
              <span className="hint"> In Luminate: open {slot.p.name} → Add songs → paste each ISRC, select the song, repeat. Then tick them here.</span>
            </div>
            <div className="lm-block-acts">
              {slot.p.url && <ExtLink href={slot.p.url} className="btn ghost sm"><ExternalLink size={13} /> Open {slot.p.name}</ExtLink>}
              <button className="btn sm" disabled={!slot.songs.some((g) => checked.has(g.key)) || !!busy} onClick={() => markAdded(slot)}>
                <Check size={14} /> {busy === `mark:${slot.p.id}` ? "Saving…" : `Mark ${slot.songs.filter((g) => checked.has(g.key)).length || ""} as added`}
              </button>
            </div>
          </div>
          <div className="lm-list">
            {slot.songs.map((g) => (
              <div key={g.key} className={`lm-song${checked.has(g.key) ? " on" : ""}${copied.has(g.key) ? " copied" : ""}`}>
                <label className="lm-tick"><input type="checkbox" checked={checked.has(g.key)} onChange={() => toggle(g.key)} aria-label={`Added ${g.song}`} /></label>
                <span className="lm-cover">{g.cover ? <Photo src={g.cover} alt="" fill sizes="40px" /> : <Disc3 size={16} />}</span>
                <span className="lm-song-main">
                  <strong>{g.song || "Untitled"}</strong>
                  <span>{g.artist}{g.clientIds.length ? ` · ${g.clientIds.map(clientName).filter(Boolean).join(", ")}` : ""}{g.status === "unplaced" ? " · has a Luminate id but isn't in a portfolio" : ""}</span>
                </span>
                <span className="lm-isrc">
                  {g.isrc ? (
                    <><code>{g.isrc}</code><CopyButton text={g.isrc} onCopied={() => setCopied((s) => new Set([...s, g.key]))} /></>
                  ) : finding.has(g.key) ? (
                    <span className="hint"><RefreshCw size={12} className="spin" /> Finding ISRC…</span>
                  ) : (
                    <span className="lm-isrc-in">
                      <input value={typed[g.key] ?? ""} placeholder="Type the ISRC" aria-label={`ISRC for ${g.song}`}
                        onChange={(e) => setTyped((t) => ({ ...t, [g.key]: e.target.value }))}
                        onKeyDown={(e) => e.key === "Enter" && saveIsrc(g)} />
                      <button className="btn ghost sm" disabled={!typed[g.key] || !!busy} onClick={() => saveIsrc(g)}>Save</button>
                      <ExtLink href="https://isrcsearch.ifpi.org/" className="inline-link lm-find" title="IFPI's free ISRC search">Find it ↗</ExtLink>
                    </span>
                  )}
                </span>
                <span className="lm-row-acts">
                  <button className="quiet-act lm-skip" title="Leave this song out of Luminate. It stays on the site." disabled={!!busy} onClick={() => run(`skip:${g.key}`, () => lumPost({ action: "skip", placementIds: g.ids, skip: true }))}>Exclude from Luminate</button>
                  <button className="quiet-act lm-not-ours" data-not-ours disabled={!!busy} onClick={() => setAsk({ notOurs: db.placements.find((p) => p.id === g.ids[0]) })}>Remove from catalog</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {plan.left.length > 0 && (
        <div className="lm-block lm-full" data-sec={plan.slots.length ? undefined : "full"}>
          <AlertTriangle size={16} />
          <div>
            <strong>{roster.length ? `Every portfolio is full: ${plan.left.length} more song${plan.left.length === 1 ? " needs" : "s need"} a new one.` : `${plan.left.length} songs to add, and no portfolio yet.`}</strong>
            <span className="hint"> {roster.length ? "Make a new portfolio in Luminate, then add it here with its link." : "Drop your current exports above and your portfolios appear by themselves, or add one by hand."}</span>
          </div>
          <button className="btn sm" onClick={() => setEditing({ name: `Portfolio ${String.fromCharCode(65 + lum.portfolios.length)}`, url: "", kind: "roster", capacity: lum.cap })}><Plus size={14} /> Add portfolio</button>
        </div>
      )}
      {/* A&R names added on the site that its Luminate A&R lists don't have yet (they clear by themselves after the next A&R export) */}
      {toLum?.count > 0 && (
        <div className="lm-block lm-ar-add" data-sec="ar">
          <div className="lm-block-head">
            <div><strong>Add to your A&amp;R lists</strong><span className="hint"> {toLum.text}</span></div>
            <div className="lm-block-acts"><button className="btn sm" onClick={() => setArList(true)}>View list</button></div>
          </div>
        </div>
      )}
      {arList && toLum && <ArToLuminateModal t={toLum} onGo={onGo} onClose={() => setArList(false)} />}

      {lum.unlinked.length > 0 && (
        <>
          <h3 className="lm-h3" data-sec="match">New in Luminate: which song is this?</h3>
          <div className="lm-list">
            {lum.unlinked.map((u) => {
              const sugg = groups.filter((g) => g.ids.some((id) => u.suggestions.includes(id)));
              return (
                <div key={u.luminateId} className="lm-song lm-unl">
                  <span className="lm-cover"><Radar size={16} /></span>
                  <span className="lm-song-main"><strong>{u.name}</strong><span>{pName(u.portfolioId)} · {fmt(u.streams)} streams</span></span>
                  <span className="lm-unl-acts">
                    {sugg.map((g) => (
                      <button key={g.key} className="btn sm" disabled={!!busy} onClick={() => run(`link:${u.luminateId}`, () => lumPost({ action: "link", luminateId: u.luminateId, placementIds: g.ids }).then(() => window.dispatchEvent(new Event(STREAMS_EVENT))))}>
                        <Link2 size={13} /> It's {g.song} · {g.clientIds.map(clientName).join(", ")}
                      </button>
                    ))}
                    {!sugg.length && (
                      <select className="lm-pick" value="" aria-label={`Link ${u.name} to a song`} disabled={!!busy}
                        onChange={(e) => { const g = candidates.find((x) => x.key === e.target.value); if (g) run(`link:${u.luminateId}`, () => lumPost({ action: "link", luminateId: u.luminateId, placementIds: g.ids })); }}>
                        <option value="">Link to a song…</option>
                        {candidates.map((g) => <option key={g.key} value={g.key}>{g.song} · {g.clientIds.map(clientName).join(", ")}</option>)}
                      </select>
                    )}
                    <button className="btn ghost sm" disabled={!!busy} onClick={() => setAsk({ lumOnly: u })}>Not in our catalog</button>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {waiting.length > 0 && (
        <>
          <h3 className="lm-h3">Added, waiting for their first numbers</h3>
          <p className="hint lm-h3-sub">They link up by themselves when the next export of their portfolio is dropped here.</p>
          <div className="lm-list">
            {waiting.map((g) => (
              <div key={g.key} className="lm-song lm-wait">
                <span className="lm-cover">{g.cover ? <Photo src={g.cover} alt="" fill sizes="40px" /> : <Disc3 size={16} />}</span>
                <span className="lm-song-main"><strong>{g.song}</strong><span>{pName(g.portfolioId)} · added {shortDay(g.addedAt)}{g.isrc ? ` · ${g.isrc}` : ""}</span></span>
                <button className="btn ghost sm" disabled={!!busy} onClick={() => run(`un:${g.key}`, () => lumPost({ action: "unmark", placementIds: g.ids }))}>Mark as not added</button>
              </div>
            ))}
          </div>
        </>
      )}

      {missing.length > 0 && (
        <>
          <h3 className="lm-h3" data-sec="missing">Marked as added, but not in the latest export</h3>
          <p className="hint lm-h3-sub">Luminate didn't keep {missing.length === 1 ? "this song" : "these songs"}, or {missing.length === 1 ? "it was" : "they were"} added to another portfolio. {missing.length === 1 ? "It doesn't" : "They don't"} take up a slot until {missing.length === 1 ? "it's" : "they're"} added again.</p>
          <div className="lm-list">
            {missing.map((g) => {
              const p = portOf(g.portfolioId);
              return (
                <div key={g.key} className="lm-song lm-missing">
                  <span className="lm-cover">{g.cover ? <Photo src={g.cover} alt="" fill sizes="40px" /> : <Disc3 size={16} />}</span>
                  <span className="lm-song-main">
                    <strong>{g.song || "Untitled"}</strong>
                    <span>{p ? `Marked as added to ${p.name} on ${shortDay(g.addedAt)}, but not in the ${shortDay(p.exportedAt || p.uploadedAt)} export. Add it again?` : "Marked as added to a portfolio that isn't on this page any more."}{g.isrc ? ` · ${g.isrc}` : ""}</span>
                  </span>
                  <span className="lm-unl-acts">
                    {p && <button className="btn sm" disabled={!!busy} onClick={() => run(`re:${g.key}`, () => lumPost({ action: "markAdded", portfolioId: p.id, placementIds: g.ids }))}><Check size={13} /> Mark as added again</button>}
                    <button className="btn ghost sm" disabled={!!busy} onClick={() => run(`un:${g.key}`, () => lumPost({ action: "unmark", placementIds: g.ids }))}>Return to the add list</button>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* everything set aside, folded: Don't track and "Not ours" can be undone from here */}
      {(skipped.length + (lum.ignoredList || []).length + (lum.notOursList || []).length) > 0 && (
        <details className="lm-hidden" data-sec="hidden">
          <summary>Excluded from Luminate ({skipped.length + (lum.ignoredList || []).length + (lum.notOursList || []).length})</summary>
          <div className="lm-list">
            {skipped.map((g) => (
              <div key={g.key} className="lm-song lm-hidden-row">
                <span className="lm-song-main"><strong>{g.song || "Untitled"}</strong><span>{g.clientIds.map(clientName).filter(Boolean).join(", ")} · excluded from Luminate</span></span>
                <button className="btn ghost sm" disabled={!!busy} onClick={() => run(`unskip:${g.key}`, () => lumPost({ action: "skip", placementIds: g.ids, skip: false }))}>Include in Luminate</button>
              </div>
            ))}
            {(lum.ignoredList || []).map((r) => (
              <div key={r.luminateId} className="lm-song lm-hidden-row">
                <span className="lm-song-main"><strong>{r.name}</strong><span>In Luminate · not in our catalog</span></span>
                <button className="btn ghost sm" disabled={!!busy} onClick={() => run(`unign:${r.luminateId}`, () => lumPost({ action: "ignore", luminateId: r.luminateId, ignore: false }))}>Include in Luminate</button>
              </div>
            ))}
            {(lum.notOursList || []).map((r) => (
              <div key={`${r.clientId}:${r.song}:${r.luminateId}`} className="lm-song lm-hidden-row">
                <span className="lm-song-main"><strong>{r.song}</strong><span>Removed from the catalog · {shortDay(r.removedAt)}</span></span>
              </div>
            ))}
          </div>
        </details>
      )}

      {ask?.notOurs && (
        <NotOursAsk db={db} commit={commit} lum={lum} target={ask.notOurs} client={db.clients.find((c) => c.id === ask.notOurs.clientId)} onClose={() => setAsk(null)}
          onDone={(n) => { setAsk(null); setNote(n); refresh(); }} />
      )}
      {ask?.lumOnly && (
        <AskCard title={`Mark "${ask.lumOnly.name}" as not in our catalog?`} goLabel="Not in our catalog" busyLabel="Saving…" onClose={() => setAsk(null)}
          go={async () => { const u = ask.lumOnly; await run(`ign:${u.luminateId}`, () => lumPost({ action: "notOurs", song: u.name, luminateId: u.luminateId })); setAsk(null); }}>
          <p>The app stops asking about it. It's still in {pName(ask.lumOnly.portfolioId)} in Luminate and uses a slot; you'll get a To do to take it out.</p>
        </AskCard>
      )}
      {editing && <PortfolioForm initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reloadLum(); }} />}
    </div>
  );
}

// What needs a person, across the whole company: a short headline each (t), an optional detail line
// under it (d), and the one place it's fixed ({ tab, sub } for onGo). Pure, so Publishing can count
// its own share (area "roster"). lum = null while the Luminate page's data loads: only what the db
// alone shows, until then. Every task has an area for its colour: luminate | roster | money | ar |
// clickup | site.
function dashTasks(db, lum) {
  // both groups of Splits to confirm, in plain words: the even default ready to confirm, and the ones to fix by hand
  const { assumed, look } = splitsToConfirm(db);
  const nSplits = assumed.length + look.length;
  const splits = nSplits && {
    k: "splits", area: "roster", t: `${nSplits} song${nSplits === 1 ? "'s split needs" : "s' splits need"} confirming`,
    d: [assumed.length && `${assumed.length} assumed as an even split`, look.length && `${look.length} need${look.length === 1 ? "s" : ""} a look`].filter(Boolean).join(" · "),
    tab: "catalog", sub: "splits", cta: "Review splits",
  };
  if (!lum) return [splits].filter(Boolean);
  const groups = lumGroups(db, lum);
  // one row for every song that still has to go into a portfolio (the Luminate badge counts the same)
  const toAdd = groups.filter((g) => g.status === "toAdd" || g.status === "unplaced").length;
  const noIsrc = groups.filter((g) => (g.status === "toAdd" || g.status === "unplaced") && !g.isrc && g.checked).length;
  const missing = groups.filter((g) => g.status === "missing").length;
  // how old the numbers are: from when Luminate made them (the oldest portfolio's newest export), not
  // when they were dropped, so month-old files or one forgotten portfolio still read as stale
  const up = lum.lastUpload, at = up?.at ? new Date(up.at).getTime() : null, made = up?.numbersFrom ? new Date(up.numbersFrom).getTime() : null;
  const byNumbers = made !== null && (at === null || made < at);
  const stale = byNumbers ? (Date.now() - made) / 86400000 : at !== null ? (Date.now() - at) / 86400000 : null;
  // only clients with songs: a brand-new client with no tab yet has no numbers to miss
  const tabClient = (n) => db.clients.find((x) => x.name === n || (x.sheetTabName || "").trim() === n);
  const noTab = (lum.missingTabs || []).filter((n) => { const c = tabClient(n); return !c || db.placements.some((p) => p.clientId === c.id); });
  const noTabOne = noTab.length === 1 ? tabClient(noTab[0]) : null;
  const L = { area: "luminate", tab: "luminate" };
  // which portfolio is behind, how big it is, and how to fix it (lib/sync-tasks.js says the same)
  const ports = lum.portfolios || [];
  const behind = byNumbers ? ports.find((p) => up.numbersPortfolioId && p.luminateId === up.numbersPortfolioId) || ports.find((p) => p.name === up.numbersPortfolio) || null : null;
  const behindName = behind?.name || up?.numbersPortfolio;
  const staleT = byNumbers && behindName
    ? `${behindName}${behind?.songCount ? ` (${behind.songCount} song${behind.songCount === 1 ? "" : "s"})` : ""} hasn't had a new export since ${shortDay(up.numbersFrom)}`
    : byNumbers ? `The newest Luminate numbers are ${Math.floor(stale)} days old` : `The last Luminate update was ${Math.floor(stale)} days ago`;
  const staleD = byNumbers && behindName ? "In Luminate, export it with 1 week · Worldwide, then drop it here." : "In Luminate, export each portfolio with 1 week · Worldwide, then drop them here.";
  const tabNames = noTab.length > 1 ? `${noTab.slice(0, -1).join(", ")} or ${noTab[noTab.length - 1]}` : noTab[0];
  return [
    stale === null ? { ...L, k: "none", t: "No Luminate export has been dropped in yet", cta: "Open Luminate" }
      : stale > 8 && { ...L, k: "stale", sub: "drop", t: staleT, d: staleD, cta: "Drop new exports" },
    (lum.notOursLeft || []).length && { ...L, k: "gone", sub: "gone", t: lum.notOursLeft.length === 1 ? `Take "${lum.notOursLeft[0].name}" out of ${lum.notOursLeft[0].portfolioName} in Luminate` : `Take ${lum.notOursLeft.length} songs that aren't ours out of Luminate`,
      d: lum.notOursLeft.length === 1 ? `It's off the site but still uses a slot.${lum.notOursLeft[0].lumName && lum.notOursLeft[0].lumName !== lum.notOursLeft[0].name ? ` In Luminate it's "${lum.notOursLeft[0].lumName}".` : ""}` : "They're off the site but still use slots.", cta: "View" },
    toAdd && { ...L, k: "add", sub: "add", t: `${toAdd} song${toAdd === 1 ? " needs" : "s need"} adding to Luminate`, d: noIsrc ? (toAdd === 1 ? "It still needs its ISRC typed in" : `${noIsrc} of them still need${noIsrc === 1 ? "s its" : " their"} ISRC typed in`) : undefined, cta: "View list" },
    lum.unlinked.length && { ...L, k: "unlinked", sub: "match", t: `${lum.unlinked.length} new Luminate song${lum.unlinked.length === 1 ? " needs" : "s need"} matching to a song here`, cta: "Match them" },
    missing && { ...L, k: "missing", sub: "missing", t: `${missing} song${missing === 1 ? "" : "s"} marked as added ${missing === 1 ? "isn't" : "aren't"} in the latest export`, d: "Check them in Luminate, then add them again or unmark them.", cta: "View list" },
    splits,
    // the fix is each one's "Sheet tab name", which lives in Website › Roster
    // one client: its edit window opens on that field
    noTab.length && (noTabOne ? {
      k: "tabs", area: "roster", t: `${noTab[0]}'s numbers can't sync`,
      d: `The pub sheet has no tab called ${noTab[0]}. If theirs has another name, type it in.`,
      tab: "website", sub: `roster:${noTabOne.id}`, cta: `Set ${noTabOne.name}'s sheet tab`,
    } : {
      k: "tabs", area: "roster", t: noTab.length === 1 ? `${noTab[0]}'s numbers can't sync` : `${noTab.length} clients' numbers can't sync`,
      d: `The pub sheet has no tab called ${tabNames}. If ${noTab.length === 1 ? "it has another name, type it" : "theirs have other names, type them"} under Website › Roster › Sheet tab name.`,
      tab: "website", sub: "roster", cta: "Open the roster",
    }),
  ].filter(Boolean);
}

// true while a media query matches (false on the first paint, like the server's)
function useMedia(q) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(q), f = () => setOn(m.matches);
    f(); m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [q]);
  return on;
}

// A Dashboard card's body that scrolls inside the card (900px and up): data-more while there's more
// below, for the fade at its foot, and how many rows are out of sight, for ScrollFoot (a fade alone
// can land on blank padding, and macOS hides the scrollbar). Checked after every render (rows
// arriving), on scroll and on resize.
// (This week's "no weekly numbers yet" note isn't a row: it's never counted as one more)
// a writer's week-on-week % needs this many streams this week (lib/weekly.js TOP_MIN)
const WEEK_PCT_MIN = 1000;
const SCROLL_ROWS = ".attn-row,.cu-row,.gainer,.pay-row,.acct-row:not(.acct-row-hd)";
// section labels: one that reaches into the fade at the foot is hidden until it's scrolled fully into view,
// so a half-cut "CLICKUP" never peeks above "1 more"
// (Money's "Not in the sheet" head is above its scroll box, never one of these)
const SCROLL_LABELS = ".todo-group,.todo-sub,.gainer-split,.acct-row-hd";
const LABEL_FADE = 24; // the mask's height (.home-scroll[data-more])
function useScrollMore(ref) {
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
const ScrollFoot = ({ n, box }) => (n ? (
  <button type="button" className="home-scroll-foot" onClick={() => box.current?.scrollBy({ top: box.current.clientHeight - 48, behavior: "smooth" })}>
    <ChevronDown size={14} /> {n > 0 ? `${n} more` : "More below"}
  </button>
) : null);
// phones get no scroll box inside the page: each list shows this many rows, then "Show N more"
const HOME_ROWS = 4;
const HomeMore = ({ n, open, onToggle }) => (n > 0 ? <button className="btn ghost sm home-more" onClick={onToggle}>{open ? "Show less" : `Show ${n} more`}</button> : null);

// This week's biggest movers on the roster: its songs (one line per title and artist) and its artists
// (each client's songs that have both weeks, added up), ranked on the server by week-on-week %
// (GET /api/growth?top=1): from 1,000 streams this week, the rest filling in by streams without a %.
// Each list says the days it covers ("This week" on the Dashboard). The A&R lists' movers live on
// the A&R tab, not here.
const GAINER_TABS = [["songs", "Songs"], ["artists", "Artists"], ["ar", "A&R"]];
// "▲ 157.5%", "▼ 12.0%": the same as the A&R tab's
const wowText = pctText;
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
    window.addEventListener(STREAMS_EVENT, load);
    return () => { alive = false; window.removeEventListener(STREAMS_EVENT, load); };
  }, []);
  return { top, failed, retry: () => loader.current?.() };
}
// the pill over this week's streams; a row with no % (too few streams) shows its streams alone, in grey
function GainNum({ r }) {
  return r.ranked && r.wowPct != null
    ? <span className="gainer-num" data-wow={r.wowPct >= 0 ? "up" : "down"}><WowPill pct={r.wowPct} /><em>{fmt(r.thisWeek)} this week</em></span>
    : <span className="gainer-num" data-wow="none"><em>{fmt(r.thisWeek)} this week</em></span>;
}
function TopGainers({ db, lum, onGo, arTop, arLoaded }) {
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
  const empty = isAR ? (!arTop ? (arLoaded ? "Couldn't load the A&R numbers." : "Loading…") : !rows.length && "No A&R numbers this week yet.")
    : !top ? (failed ? "Couldn't load this week's numbers." : "Loading…")
    : !rows.length && !top.noWeekly?.length && (lum?.lastUpload ? "Shows up after next week's Luminate export." : "Shows up after two weekly Luminate exports.");
  const firstOff = rows ? rows.findIndex((r) => !(r.ranked && r.wowPct != null)) : -1;
  // the rows without a % sit under one caption, after the ranked ones
  const split = (i) => i === firstOff && <div key="split" className="gainer-split">Not enough streams for a % yet</div>;
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
        {span && <p className="gainer-sub">{dayRange(span.from, span.to)} · vs the week before</p>}
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
              <span className="lm-song-main"><strong>{c.name}</strong><span>{a.topSong}{a.songCount > 1 ? ` + ${a.songCount - 1} more` : ""}</span></span>
              <GainNum r={a} />
            </button>
          )];
        }) : rows.map((s, i) => {
          const p = placement(s.placementId);
          return [split(i), (
            <button key={s.key} className="gainer" data-ranked={s.ranked && s.wowPct != null ? "" : undefined} data-fall={fall(s)} onClick={() => onGo("catalog", `client:${s.clientIds[0]}`)}>
              {rank(s, i)}
              <span className="lm-cover">{p.cover ? <Photo src={p.cover} alt="" fill sizes="40px" /> : <Disc3 size={16} />}</span>
              <span className="lm-song-main"><strong>{p.song}</strong><span>{p.artist} · {s.clientIds.map((id) => client(id)?.name || "").filter(Boolean).join(", ")}</span></span>
              <GainNum r={s} />
            </button>
          )];
        })}
        {/* a portfolio still exported the old way has no week to rank: one plain line each */}
        {!isAR && top && (top.noWeekly || []).map((p) => (
          <p key={p.name} className="gainers-noweek">
            <i aria-hidden="true" /><span><span className="gainers-noweek-t">{p.name} has no weekly numbers yet. Drop its new export to include its songs.</span> <button className="inline-link" onClick={() => onGo("luminate", "drop")}>Drop new exports</button></span>
          </p>
        ))}
      </div>
      <ScrollFoot n={hidden} box={body} />
    </div>
  );
}

// The landing tab: the company at a glance, in four blocks. Money first (Defied's commission, from
// Stripe), then To do (the Dashboard's own tasks and ClickUp's) beside This week (what's growing),
// then one Money card (payments, the accounting sheet, what the sheet doesn't have yet). Publishing's own detail (MASTER, the clients, their splits) stays on
// Publishing. The money, accounting and ClickUp parts come from /api/home; each says on its own
// when it can't load, so the rest of the page never waits on it.
// The Dashboard's last answers, kept while the app is open: coming back to it draws them at once and a
// fresh copy loads quietly ("updated 7:34 PM" says how fresh the money is). Only good answers are kept.
const dashCache = { cu: {} };
// sign-in and sign-out start clean (the same tab can sign in as someone else)
function clearDashCaches() { dashCache.home = null; dashCache.top = null; dashCache.cu = {}; arPgCache.d = null; arPgCache.at = 0; }
function useHome() {
  const [home, setHome] = useState(() => dashCache.home || null);
  const [failed, setFailed] = useState(false);
  const loader = useRef(null);
  useEffect(() => {
    let alive = true;
    const load = () => { setFailed(false); return fetch("/api/home", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!alive) return; if (d?.money) { dashCache.home = d; setHome(d); } else setFailed(true); }).catch(() => alive && setFailed(true)); };
    loader.current = load;
    load();
    return () => { alive = false; };
  }, []);
  return { home, failed, retry: () => loader.current?.() };
}
const monthName = (ym) => (ym ? new Date(`${ym}-15T12:00:00`).toLocaleDateString(undefined, { month: "long" }) : "This month");

// A&R's counts (GET /api/ar?summary=1): follow-ups due, and who you added that the Luminate A&R lists
// don't have yet (toLuminate). Loaded once by StaffDashboard for the A&R badge and the Dashboard's task,
// again when the Dashboard opens. null while loading or when it couldn't load (no badge, no task).
function useArSummary(tab) {
  const [t, setT] = useState(null);
  useEffect(() => {
    if (tab !== "home" && t) return;
    let alive = true;
    // a failed read keeps the last answer, or marks it answered so the To do count doesn't wait forever
    const miss = () => alive && setT((x) => x || { failed: true });
    fetch("/api/ar?summary=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => (d ? alive && setT(d) : miss())).catch(miss);
    return () => { alive = false; };
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  return t;
}

// "See the list": the names to add, by the Luminate list they go in (with how full that list is),
// each with Copy name and its Spotify link when one is saved. The Dashboard, A&R Summary and the
// Watchlist's chips all open this one.
function ArToLuminateModal({ t, onGo, onClose }) {
  useEscape(onClose);
  const groups = [["artists", `Add to your ${t.lists.artists.name} list in Luminate`, t.artists, t.lists.artists], ["songs", `Add to your ${t.lists.songs.name} list`, t.songs, t.lists.songs]].filter(([, , items]) => items.length);
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card ar-tolum-modal">
        <div className="modal-head"><h3>Add these to Luminate</h3><button onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-body">
          <p className="hint mb">In Luminate, open the list → Add → search the name; it shows up here after your next export.</p>
          {groups.map(([k, head, items, list]) => {
            const pct = list.count == null ? null : Math.min(100, Math.round((list.count / list.cap) * 100));
            return (
              <div key={k} className="lm-block ar-tolum-group" data-group={k}>
                <div className="lm-block-head ar-tolum-head">
                  <h4>{head}</h4>
                  {pct != null && (
                    <span className="ar-tolum-meter">
                      <span className={`lm-bar${list.full ? " full" : pct >= 90 ? " near" : ""}`}><i style={{ width: `${pct}%` }} /></span>
                      <em className={list.full || pct >= 90 ? "warn-text" : undefined}>{list.count} of {list.cap} used</em>
                    </span>
                  )}
                </div>
                {list.full && <p className="ar-tolum-full"><AlertTriangle size={14} /> Your {list.name} list is full ({list.count} of {list.cap}). Remove one there first, then add these.</p>}
                {items.map((x) => (
                  <div key={x.id} className="ar-tolum-row">
                    <span className="ar-tolum-name"><strong>{x.name}</strong>{x.artist ? <span className="muted"> · {x.artist}</span> : null}</span>
                    <span className="ar-tolum-acts">
                      {x.spotify && <ExtLink className="btn ghost sm" href={x.spotify}>Spotify ↗</ExtLink>}
                      <CopyButton text={x.name} label="Copy name" />
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <div className="modal-foot">
          {onGo && <button className="btn ghost sm ar-tolum-drop" onClick={() => { onClose(); onGo("luminate", "drop"); }}>Drop new exports</button>}
          <button className="btn sm" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function HomeDashboard({ db, lum, lumErr = false, reloadLum, onGo, toLum, arTop, arLoaded }) {
  const { home, failed, retry } = useHome();
  const [showToLum, setShowToLum] = useState(false);
  // the Money card's tab lives here, so the "not in the sheet" task can open it on that list
  const [moneyTab, setMoneyTab] = useState("payments");
  const unlogged = home?.accounting?.unlogged;
  const tabPicked = useRef(false);
  useEffect(() => {
    if (!home || tabPicked.current) return;
    tabPicked.current = true;
    if (unlogged?.length > 0) setMoneyTab("unlogged");
  }, [home]); // eslint-disable-line react-hooks/exhaustive-deps
  const tasks = useMemo(() => {
    const list = dashTasks(db, lum);
    // phase 6 logs them in one click; until then the button shows the list on the Money card
    const tests = (unlogged || []).filter((p) => p.test), testSum = tests.reduce((s, p) => s + p.amount, 0);
    const testD = !tests.length ? undefined : unlogged.length === 1 ? `It's a ${money(testSum)} test payment.`
      : tests.length === 1 ? `1 of them is a ${money(testSum)} test payment.` : `${tests.length} of them are test payments (${money(testSum)}).`;
    if (unlogged?.length) list.push({ k: "unlogged", area: "money", t: `${unlogged.length} Stripe payment${unlogged.length === 1 ? "" : "s"} (${money(home.accounting.unloggedTotal)} paid) ${unlogged.length === 1 ? "isn't" : "aren't"} in the accounting sheet yet`, d: testD, cta: "Review",
      go: () => { setMoneyTab("unlogged"); requestAnimationFrame(() => document.getElementById("money")?.scrollIntoView({ behavior: "smooth", block: "start" })); } });
    if (toLum?.count) list.push({ k: "arLuminate", area: "ar", t: toLum.text.replace(/\.$/, ""), cta: "View list", go: () => setShowToLum(true) });
    return list;
  }, [db, lum, unlogged, toLum]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = home?.money;
  return (
    <div className="home">
      <div className="admin-head"><h2>Dashboard</h2>{m?.connected && !m.error && <span className="home-src">From Stripe · updated {clock(m.updatedAt)}</span>}</div>
      <MoneyRow money={m} failed={failed} retry={retry} />
      <div className="home-row">
        <ToDoCard items={tasks} loading={!lum && !lumErr} failed={!lum && lumErr} onRetry={reloadLum} onGo={onGo} cuFirst={home?.clickup} homeFailed={failed} homeRetry={retry}
          settled={(!!lum || lumErr) && (!!home || failed) && arLoaded} />
        <TopGainers db={db} lum={lum} onGo={onGo} arTop={arTop} arLoaded={arLoaded} />
      </div>
      <MoneyCard home={home} failed={failed} retry={retry} tab={moneyTab} setTab={(t) => { tabPicked.current = true; setMoneyTab(t); }} />
      {showToLum && toLum && <ArToLuminateModal t={toLum} onGo={onGo} onClose={() => setShowToLum(false)} />}
    </div>
  );
}

// A card's calm line while /api/home is on its way, or when it couldn't load at all
function HomeWait({ failed, retry, what }) {
  return failed
    ? <p className="home-muted"><AlertTriangle size={15} /> <span>Couldn't load {what}. <button className="inline-link" onClick={retry}>Try again</button></span></p>
    : <p className="home-muted"><RefreshCw size={15} className="spin" /> Loading…</p>;
}

// "October", "September": this month and the one before, in words
const monthWord = (offset) => { const d = new Date(); d.setDate(15); d.setMonth(d.getMonth() + offset); return d.toLocaleDateString(undefined, { month: "long" }); };
function MoneyRow({ money: m, failed, retry }) {
  if (!m || !m.connected || m.error) {
    return (
      <div className="home-money">
        <span className="cat-stat-label">Through Stripe</span>
        {!m ? <HomeWait failed={failed} retry={retry} what="the commission" />
          : !m.connected ? <p className="home-muted"><CircleDollarSign size={15} /> Connect Stripe to see your commission here.</p>
          : <p className="home-muted"><AlertTriangle size={15} /> {m.error}</p>}
      </div>
    );
  }
  const stats = [["thisMonth", `Through Stripe · ${m.month ? monthName(m.month) : monthWord(0)}`], ["lastMonth", monthWord(-1)], ["thisYear", "This year"]];
  return (
    <div className="cat-summary home-money-row">
      <div className="cat-summary-grid">
        {stats.map(([k, label]) => <div key={k} className="cat-stat" data-stat={k}><span className="cat-stat-label">{label}</span><span className="cat-stat-val">{money(m[k])}</span></div>)}
      </div>
      {/* the tiles add up Defied's whole cut through Stripe: say so, so nobody reads it as management commission alone.
          Desktop: an (i) on the strip that shows it on hover or focus (the Dashboard fits one screen); phones: a small line */}
      <span className="home-money-info" tabIndex={0} aria-describedby="home-money-note"><Info size={14} aria-hidden="true" /><span className="sr-only">What these count</span></span>
      <p className="hint home-money-note" id="home-money-note" role="note">Everything Defied's cut took in through Stripe, before Stripe's card fees. It also counts test payments and other income paid through Stripe, like studio work.</p>
    </div>
  );
}

// a $2-or-less or "test" payment (the server's isTestPay): still counted and listed, only marked
const TestChip = () => <span className="pay-test" title="A test payment: $2 or less, or &quot;test&quot; in its description">Test</span>;
// "via Devin's link", or straight to Defied's own account (tests and deposits so far)
const viaText = (p) => (p.direct ? "paid to Defied directly" : p.via ? `via ${p.via}'s link` : "via a payment link");
// green = Defied's share; what they paid in all sits under it only when it's different
function PayRow({ p, over, onLog }) {
  return (
    <div className={over ? "pay-row over" : "pay-row"} data-pay={p.id}>
      <span className="pay-main"><strong>{p.client || p.payer || "Unknown payer"}</strong>
        <span>{payDay(p.at)} · {viaText(p)}{p.test && <> <TestChip /></>}{p.logged === false && <> · <span className="pay-flag">Not in the sheet yet</span></>}</span></span>
      {onLog && p.logged === false && <button className="btn ghost sm pay-log" data-log={p.id} onClick={() => onLog([p.id])}>Log it</button>}
      <span className="pay-amt"><b>{money(p.fee)}</b>{p.fee !== p.amount && <em>{money(p.amount)} paid</em>}</span>
    </div>
  );
}

// "Log it" / "Log all": the exact rows first (a dry run on the server, fresh from Stripe and the
// sheet), then one click adds them to the accounting sheet's Income tab. Off until the server's
// ACCOUNTING_SHEET_WRITES is on, and then it only says so.
function LogConfirm({ ids, canLog, onClose, onDone }) {
  const [plan, setPlan] = useState(null); // {rows, skipped} | {error}
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // the write's answer
  const [off, setOff] = useState(() => new Set()); // rows unticked: left out of this write, still to log
  const close = () => { if (busy) return; if (done) onDone(); onClose(); };
  useEscape(close);
  const post = (body) => fetch("/api/accounting-log", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify(body) })
    .then((r) => r.json().catch(() => ({})).then((d) => (r.ok ? d : { error: d.error || "Couldn't reach the server. Try again in a minute." })))
    .catch(() => ({ error: "Couldn't reach the server. Try again in a minute." }));
  useEffect(() => {
    if (!canLog) return;
    let alive = true;
    post({ ids, dryRun: true }).then((d) => alive && setPlan(d));
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => { setBusy(true); const d = await post({ ids: ids.filter((id) => !off.has(id)) }); setBusy(false); setDone(d); };
  const rowsN = plan?.rows?.length || 0;
  const n = (plan?.rows || []).filter((r) => !off.has(r.id)).length; // the ticked ones
  const tick = (id) => setOff((s) => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x; });
  const reasons = (list) => list?.length > 0 && <ul className="log-skipped">{list.map((x) => <li key={x.id} data-skip={x.id}>{x.reason}</li>)}</ul>;
  let body;
  if (!canLog) body = <p className="home-muted" data-log-off><AlertTriangle size={15} /> Logging from the dashboard isn't switched on yet. For now, add {ids.length === 1 ? "it" : "them"} in the sheet as a new row with the full amount paid.</p>;
  else if (done) {
    body = done.error && !done.logged?.length ? <p className="home-muted"><AlertTriangle size={15} /> {done.error}</p> : (
      <>
        {done.logged?.length > 0 && <p className="log-done" data-log-done><CheckCircle2 size={15} /> Added to the Income tab: {done.logged.length === 1 ? `row ${done.logged[0].row}` : `rows ${done.logged[0].row}–${done.logged[done.logged.length - 1].row}`}.{done.left > 0 ? ` ${done.left} still to log.` : " Every Stripe payment is in the sheet now."}</p>}
        {done.error && <p className="home-muted"><AlertTriangle size={15} /> {done.error}</p>}
        {reasons(done.skipped)}
      </>
    );
  } else if (!plan) body = <p className="home-muted"><RefreshCw size={15} className="spin" /> Checking Stripe and the sheet…</p>;
  else if (plan.error) body = <p className="home-muted"><AlertTriangle size={15} /> {plan.error}</p>;
  else {
    body = (
      <>
        {rowsN > 0 && <p className="log-lead">{rowsN === 1 ? "This row goes" : `These ${rowsN} rows go`} on the Income tab, under its last row. The sheet works out the month, manager and shares, the same as a row typed by hand.{rowsN > 1 ? " Untick one to leave it out for now." : ""}</p>}
        {rowsN > 0 && (
          <div className="log-table" role="table" aria-label="Rows to add">
            <div className="log-tr log-th" role="row"><span role="columnheader">Date</span><span role="columnheader">Artist / Client</span><span role="columnheader">Revenue type</span><span role="columnheader" className="acct-amt">Gross commission</span></div>
            {plan.rows.map((r) => (
              <label key={r.id} className={off.has(r.id) ? "log-tr off" : "log-tr"} role="row" data-row={r.id}>
                <span role="cell" className="log-date"><input type="checkbox" checked={!off.has(r.id)} disabled={busy} onChange={() => tick(r.id)} aria-label={`Add ${r.client}, ${money(r.amount)}`} />{r.date}</span>
                <span role="cell" className="acct-who">{r.client}{r.test && <> <TestChip /></>}{r.notes ? <em> · {r.notes}</em> : null}</span><span role="cell">{r.type}</span><span role="cell" className="acct-amt">{money(r.amount)}</span>
              </label>
            ))}
          </div>
        )}
        {rowsN > 0 && <p className="hint log-acct">Account: {plan.rows[0].account}. The full amount paid goes in Gross Commission, like the rows already there. Names are written the way the sheet already spells them.</p>}
        {reasons(plan.skipped)}
        {rowsN === 0 && !plan.skipped?.length && <p className="home-muted">Nothing to add.</p>}
      </>
    );
  }
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="modal-card log-modal" role="dialog" aria-label="Log to the accounting sheet">
        <div className="modal-head"><h3>{done ? "Logged" : ids.length === 1 ? "Log this payment" : `Log ${ids.length} payments`}</h3><button onClick={close} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-body">{body}</div>
        <div className="modal-foot">
          {done || !canLog || !rowsN ? <button className="btn sm" onClick={close}>{done ? "Done" : "Close"}</button> : (
            <>
              <button className="btn ghost sm" onClick={close} disabled={busy}>Cancel</button>
              <button className="btn sm" data-log-go onClick={go} disabled={busy || !n}>{busy ? "Adding…" : !n ? "Nothing ticked" : n === 1 ? "Add 1 row to the sheet" : `Add ${n} rows to the sheet`}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PaymentsModal({ onClose, onLog }) {
  const [P, setP] = useState(null);
  const [err, setErr] = useState(false);
  useEscape(onClose);
  useEffect(() => {
    let alive = true;
    fetch("/api/home?all=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!alive) return; if (d?.payments?.items) setP(d.payments); else setErr(d?.payments?.error || true); }).catch(() => alive && setErr(true));
    return () => { alive = false; };
  }, []);
  const title = !P ? "All payments" : P.total > P.items.length ? `Newest ${P.items.length} of ${fmt(P.total)} payments` : `All payments (${P.items.length})`;
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card pay-modal">
        <div className="modal-head"><h3>{title}</h3><button onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-body">
          {err ? <p className="home-muted"><AlertTriangle size={15} /> {typeof err === "string" ? err : "Couldn't load the payments. Close this and try again."}</p>
            : !P ? <p className="home-muted"><RefreshCw size={15} className="spin" /> Loading…</p>
            : <><p className="pay-legend">Green = Defied's share of each payment</p>{P.items.map((p) => <PayRow key={p.id} p={p} onLog={onLog} />)}</>}
        </div>
        <div className="modal-foot"><button className="btn sm" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

// One Money card: Stripe's payments, the accounting sheet's numbers, and the payments the sheet
// doesn't have yet (its count in amber on the tab: the one thing here that needs doing)
function MoneyCard({ home, failed, retry, tab, setTab }) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState(false);
  const [logIds, setLogIds] = useState(null); // the payments the Log confirm is for
  const body = useRef(null);
  const hidden = useScrollMore(body);
  const P = home?.payments, A = home?.accounting;
  const U = A?.connected && !A.error ? A.unlogged : null;
  const tabs = [["payments", "Payments"], ["accounting", "Accounting"], ["unlogged", <span>Not in <span className="tab-the">the </span>sheet</span>]];
  const month = monthName(A?.month);
  const more = (n) => <HomeMore n={n - HOME_ROWS} open={open} onToggle={() => setOpen((o) => !o)} />;
  let content;
  if (!home) content = <HomeWait failed={failed} retry={retry} what={tab === "payments" ? "the payments" : "the accounting sheet"} />;
  else if (tab === "payments") {
    content = !P.connected ? <p className="home-muted">Connect Stripe to see recent payments here.</p>
      : P.error ? <p className="home-muted"><AlertTriangle size={15} /> {P.error}</p>
      : !P.items.length ? <p className="home-muted">No payments yet.</p>
      : <><p className="pay-legend">Green = Defied's share of each payment</p>{P.items.map((p, i) => <PayRow key={p.id} p={p} over={i >= HOME_ROWS} />)}{more(P.items.length)}</>;
  } else if (!A.connected) content = <p className="home-muted">Accounting sheet: not connected yet. Once it's shared, live numbers and one-click logging of payments show up here.</p>;
  else if (A.error) content = <p className="home-muted"><AlertTriangle size={15} /> {A.error}</p>;
  else if (tab === "accounting") {
    const stats = [["monthNet", `Net · ${month}`, `${money(A.monthRevenue)} in · ${money(A.monthExpenses)} out`], ["yearNet", "Net this year"], ["checkingBalance", "Business Checking"], ["taxSetAside", "Tax set-aside (this quarter)"]];
    content = (
      <div className="cat-summary-grid acct-grid">
        {stats.map(([k, label, note]) => <div key={k} className="cat-stat" data-stat={k}><span className="cat-stat-label">{label}</span><span className="cat-stat-val">{money(A[k])}</span>{note && <span className="acct-note">{note}</span>}</div>)}
      </div>
    );
  } else {
    content = U === null ? <p className="home-muted">Stripe couldn't be read just now, so the payments missing from the sheet can't be checked.</p>
      : !U.length ? <p className="home-muted acct-clear"><CheckCircle2 size={15} /> Every Stripe payment is in the accounting sheet.</p>
      : (
        <div className="acct-unlogged">
          <div className="acct-row acct-row-hd" aria-hidden="true"><span>Date</span><span>Who</span><span className="acct-amt">Paid</span><span /></div>
          {[...U].reverse().map((p, i) => (
            <div key={p.id} className={i >= HOME_ROWS ? "acct-row over" : "acct-row"} data-pay={p.id}><span>{shortDay(p.at)}</span><span className="acct-who">{p.client || p.payer || "Unknown payer"}{p.test && <> <TestChip /></>}</span><span className="acct-amt">{money(p.amount)}</span>
              <button className="btn ghost sm acct-log" data-log={p.id} onClick={() => setLogIds([p.id])}>Log it</button></div>
          ))}
          {more(U.length)}
          <p className="hint">{A.canLog ? "Log it adds the row to the sheet's Income tab for you, after showing you the row. They leave this list once the sheet has them." : "Add each one as a new row in the sheet with the full amount paid. They leave this list once the sheet has them."}</p>
        </div>
      );
  }
  return (
    <div className="home-card home-money-card" id="money">
      <div className="attn-head">
        <Receipt size={15} /> Money
        <span className="gainer-tabs money-tabs" role="tablist" aria-label="Money">
          {tabs.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} data-tab={id} onClick={() => { setTab(id); setOpen(false); }}>
              {label}{id === "unlogged" && U?.length > 0 && <span className="attn-n">{U.length}</span>}
            </button>
          ))}
        </span>
        {/* a narrow card (one-screen Dashboard at 1280) drops the word "payments" so the head stays one line */}
        {P?.items?.length > 0 && <button className="inline-link pay-all" onClick={() => setAll(true)} title="All payments">All<span className="pay-all-w"> payments</span> ({fmt(P.total ?? P.items.length)}) ›</button>}
      </div>
      {/* Not in the sheet's head sits above the scroll box, so "Log all N" never hides under the fade
          and the first payment row starts at the top of the box (1280x800, 1366x768) */}
      {tab === "unlogged" && U?.length > 0 && (
        <div className="acct-unlogged acct-unlogged-top">
          <p className="acct-unlogged-head"><span>Add {U.length === 1 ? "this one" : `these ${U.length}`}<span className="acct-hd-w"> to the accounting sheet</span> · {money(A.unloggedTotal)} paid<span className="acct-hd-w"> in total</span></span>
            {U.length > 1 && <button className="btn sm acct-log-all" data-log-all onClick={() => setLogIds(U.map((p) => p.id))}>Log all {U.length}</button>}</p>
        </div>
      )}
      <div className={open ? "home-scroll open" : "home-scroll"} ref={body}>{content}</div>
      <ScrollFoot n={hidden} box={body} />
      {all && <PaymentsModal onClose={() => setAll(false)} onLog={(ids) => { setAll(false); setLogIds(ids); }} />}
      {logIds && <LogConfirm ids={logIds} canLog={!!A?.canLog} onClose={() => setLogIds(null)} onDone={retry} />}
    </div>
  );
}

// ClickUp's open tasks, read-only, as the To do card's last group: all three lists at once. Each
// row opens the task in ClickUp in a new tab.
const CU_LISTS = [["internal", "Internal Tasks"], ["pub", "Pub Tasks"], ["ar", "A&R Tasks"]];
// the two tasks the dashboard writes into ClickUp itself: the rows above already say the same
const OWN_CU = /^(Weekly dashboard sync:|Log new payments:)/;
const PRIORITY = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };
const dueLate = (iso) => !!iso && new Date(iso).getTime() < new Date().setHours(0, 0, 0, 0);
function useClickUpLists(first) {
  // Pub and A&R start from the saved copy; Internal always from this visit's /api/home (first), which
  // is fresh on every Dashboard visit; a saved Internal would win over it and never refresh
  const [lists, setLists] = useState(() => { const { internal, ...rest } = dashCache.cu; return rest; }); // eslint-disable-line no-unused-vars
  const failed = (k) => ({ key: k, error: "Couldn't reach ClickUp." });
  // quiet: the list on screen (the last answer) stays until the fresh one lands
  const load = (k, quiet = false) => {
    if (!quiet) setLists((x) => ({ ...x, [k]: null }));
    return fetch(`/api/home?list=${k}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.clickup && !d.clickup.error && k !== "internal") dashCache.cu[k] = d.clickup; setLists((x) => ({ ...x, [k]: d?.clickup || failed(k) })); })
      .catch(() => setLists((x) => ({ ...x, [k]: failed(k) })));
  };
  // Internal Tasks comes with the Dashboard's own load; Pub and A&R right away beside it
  useEffect(() => { load("pub", true); load("ar", true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { lists: CU_LISTS.map(([k]) => (k in lists ? lists[k] : k === "internal" ? first || null : null)), load };
}
function CuTask({ t, over }) {
  const late = dueLate(t.due);
  return (
    <ExtLink href={t.url} className={over ? "cu-row over" : "cu-row"} title="Open in ClickUp">
      <span className="cu-main"><strong>{t.name}</strong>
        <span className="cu-meta">
          <span className="cu-status">{t.status}</span>
          {t.due && <span className={late ? "cu-due late" : "cu-due"}>{late ? "Late · " : "Due "}{shortDay(t.due)}</span>}
        </span>
      </span>
      {t.priority && <span className="cu-pri" data-pri={t.priority} title={`${PRIORITY[t.priority] || t.priority} priority`}><Flag size={13} /></span>}
      <span className="cu-who">{t.assignees.slice(0, 3).map((a, i) => <span key={i} className="cu-av">{a}</span>)}</span>
    </ExtLink>
  );
}

// To do: the Dashboard's own tasks under coloured area labels (Luminate, Publishing, Money, A&R,
// Website), then ClickUp's three lists. On phones a whole row is the button (with a ›), and the list
// stops at 4 rows with "Show N more". failed = the Luminate data couldn't load: a plain line to try
// again, never "All caught up" or a spinner that never stops.
const TODO_GROUPS = [["luminate", "Luminate"], ["roster", "Publishing"], ["money", "Money"], ["ar", "A&R"], ["site", "Website"]];
function ToDoCard({ items, loading, failed, onRetry, onGo, cuFirst, homeFailed, homeRetry, settled = true }) {
  const phone = useMedia("(max-width: 599px)");
  const [open, setOpen] = useState(false);
  const body = useRef(null);
  const hidden = useScrollMore(body);
  const { lists, load } = useClickUpLists(cuFirst);
  const cu = lists.map((l, i) => (l?.tasks ? { ...l, tasks: l.tasks.filter((t) => !OWN_CU.test(t.name)) } : l ? { ...l, name: l.name || CU_LISTS[i][1] } : l));
  const cuOpen = cu.reduce((n, l) => n + (l?.tasks?.length || 0), 0);
  // ClickUp is still on its way only while the Dashboard's own load is (Internal) or Pub/A&R are
  const cuWait = cu.some((l, i) => !l && !(i === 0 && homeFailed));
  const cuErr = cu.map((l, i) => (l?.error ? CU_LISTS[i][0] : null)).filter(Boolean);
  const total = items.length + cuOpen;
  if (!total && !loading && !failed && !cuWait && !cuErr.length && !homeFailed) {
    return <div className="attn clear todo"><div className="attn-head"><ListChecks size={15} /> To do <span className="todo-done">· <CheckCircle2 size={14} /> All caught up</span></div></div>;
  }
  if (!total && loading && cuWait) {
    return <div className="attn clear wait todo"><div className="attn-head"><RefreshCw size={15} className="spin" /> Checking what needs doing…</div></div>;
  }
  // rows past the 4th fold away on phones; a label or line goes with the row under it
  let n = 0;
  const over = (isRow) => { const o = n >= HOME_ROWS; if (isRow) n += 1; return o; };
  const out = [];
  const act = (it) => (it.go ? it.go() : onGo(it.tab, it.sub));
  for (const [area, label] of TODO_GROUPS) {
    const mine = items.filter((it) => (it.area || "site") === area);
    if (!mine.length) continue;
    out.push(<div key={`g:${area}`} className={over(false) ? "todo-group over" : "todo-group"} data-area={area}>{label}</div>);
    for (const it of mine) {
      const tap = phone ? { role: "button", tabIndex: 0, onClick: () => act(it), onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(it); } } } : {};
      out.push(
        <div key={it.k} className={over(true) ? "attn-row over" : "attn-row"} data-task={it.k} data-area={area} {...tap}>
          <span className="attn-main" title={it.d ? `${it.t}. ${it.d}` : it.t}><b>{it.t}</b>{it.d && <em>{it.d}</em>}</span>
          <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); act(it); }}>{it.cta}</button>
          <ChevronRight size={16} className="attn-chev" aria-hidden="true" />
        </div>,
      );
    }
  }
  if (loading && items.length > 0) out.push(<div key="lwait" className={over(true) ? "attn-row attn-wait over" : "attn-row attn-wait"}><span>Checking Luminate…</span></div>);
  if (failed) {
    out.push(
      <div key="lfail" className={over(true) ? "attn-row attn-wait attn-failed over" : "attn-row attn-wait attn-failed"}>
        <span>Couldn't load the Luminate tasks.</span>
        <button className="btn ghost sm" onClick={onRetry}>Try again</button>
      </div>,
    );
  }
  // ClickUp: each list with open tasks under its own subhead; the empty ones share one quiet line
  out.push(<div key="g:clickup" className={over(false) ? "todo-group over" : "todo-group"} data-area="clickup">ClickUp</div>);
  cu.forEach((l, i) => {
    if (!l?.tasks?.length) return;
    out.push(<div key={`s:${l.key}`} className={over(false) ? "todo-sub over" : "todo-sub"} data-list={CU_LISTS[i][0]}>{l.name} · {l.tasks.length} · <ExtLink href={l.url} className="inline-link">Open in ClickUp ↗</ExtLink></div>);
    for (const t of l.tasks) out.push(<CuTask key={t.id} t={t} over={over(true)} />);
  });
  const empty = cu.filter((l) => l?.tasks && !l.tasks.length).map((l) => `${l.name}: nothing open`);
  if (empty.length) out.push(<p key="cuempty" className={over(true) ? "todo-line over" : "todo-line"}>{empty.join(" · ")}</p>);
  if (homeFailed && !cu[0]) out.push(<p key="cuhome" className={over(true) ? "todo-line over" : "todo-line"}>Couldn't load ClickUp. <button className="inline-link" onClick={homeRetry}>Try again</button></p>);
  if (cuErr.length) out.push(<p key="cuerr" className={over(true) ? "todo-line over" : "todo-line"}><AlertTriangle size={14} /> Couldn't reach ClickUp. <button className="inline-link" onClick={() => cuErr.forEach(load)}>Try again</button></p>);
  if (cuWait) out.push(<p key="cuwait" className={over(true) ? "todo-line over" : "todo-line"}><RefreshCw size={14} className="spin" /> Loading ClickUp…</p>);
  return (
    <div className="attn home-card todo">
      {/* no number until every group (Luminate, the Dashboard's own, ClickUp, A&R) has answered: it never counts up */}
      <div className="attn-head"><ListChecks size={15} /> To do {total > 0 && settled && !cuWait && <span className="attn-n">{total}</span>}</div>
      <div className={open ? "home-scroll open" : "home-scroll"} ref={body}>
        {out}
        <HomeMore n={n - HOME_ROWS} open={open} onToggle={() => setOpen((o) => !o)} />
      </div>
      <ScrollFoot n={hidden} box={body} />
    </div>
  );
}

/* staff: website content (about, roster, staff, notable) -------------- */
const WEBSITE_SECS = [["roster", "Roster"], ["notable", "Notable releases"], ["staff", "Team"], ["about", "About page"]];
const WEB_SEC_KEY = "dm-web-sec";
function WebsiteAdmin({ db, commit, sub, onSub }) {
  const secs = WEBSITE_SECS;
  // a Dashboard task's sub wins, then the last tab used in this browser tab, then Roster (the weekly work)
  const openId = sub?.startsWith("roster:") ? sub.slice(7) : null; // To do's "Set X's sheet tab"
  const [sec, setSecOnly] = useState(() => {
    if (openId) return "roster";
    if (secs.some(([id]) => id === sub)) return sub;
    try { const v = sessionStorage.getItem(WEB_SEC_KEY); if (secs.some(([id]) => id === v)) return v; } catch { /* storage blocked */ }
    return "roster";
  });
  const setSec = (id) => { setSecOnly(id); onSub?.(id); try { sessionStorage.setItem(WEB_SEC_KEY, id); } catch { /* storage blocked */ } };
  return (
    <div className="website-main">
      <div className="admin-head website-head"><h2>Website</h2></div>
      <div className="subnav">
        {secs.map(([id, label]) => (
          <button key={id} className={sec === id ? "subpill active" : "subpill"} onClick={(e) => { setSec(id); revealChip(e.currentTarget); }}>{label}</button>
        ))}
      </div>
      {sec === "about" && <AboutEditor db={db} commit={commit} />}
      {sec === "roster" && <ClientsAdmin db={db} commit={commit} openId={openId} />}
      {sec === "staff" && <TeamAdmin db={db} commit={commit} />}
      {sec === "notable" && <NotableAdmin db={db} commit={commit} />}
    </div>
  );
}

function AboutEditor({ db, commit }) {
  const [text, setText] = useState(db.site?.about || "");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const ok = await commit({ ...db, site: { ...db.site, about: text } }).finally(() => setSaving(false));
    if (!ok) return; // the banner says why; the text stays in the box
    setSaved(true); setTimeout(() => setSaved(false), 1600);
  };
  return (
    <div>
      <div className="admin-head"><h2>About page</h2><button className="btn sm" onClick={save} disabled={saving}>{saving ? "Saving…" : saved ? "Saved ✓" : "Save"}</button></div>
      <p className="muted mb">This text shows on the public About page. Leave a blank line between paragraphs.</p>
      <textarea className="about-editor" rows={9} value={text} onChange={(e) => setText(e.target.value)} />
    </div>
  );
}

function NotableAdmin({ db, commit }) {
  const list = db.notableReleases || [];
  const save = async (o) => {
    const notableReleases = o.id ? list.map((r) => r.id === o.id ? o : r) : [...list, { ...o, id: uid() }];
    return saveRow(commit, { ...db, notableReleases }, "notableReleases", o.id, "notable release");
  };
  const del = async (id) => commit({ ...db, notableReleases: list.filter((r) => r.id !== id) });
  const cols = [
    { key: "cover", label: "", w: "44px", render: (r) => r.cover ? <img className="rel-thumb" src={r.cover} alt="" /> : <span className="rel-thumb rel-thumb-empty" /> },
    { key: "song", label: "Song", w: "1.2fr" },
    { key: "artist", label: "Artist", w: "0.9fr" },
    { key: "client", label: "Client", w: "0.9fr" },
  ];
  return (
    <div>
      <p className="muted mb">Manually curated — these are the exact songs shown on the About page (the “Notable Releases” grid and the credits band), independent of any artist’s song list. Paste a Spotify link below to auto-fill the song details, then enter which of our clients it's for.</p>
      <Editor title="Notable releases" items={list} columns={cols} maxItems={10}
        blank={{ song: "", artist: "", client: "", releaseDate: "", link: "", cover: "" }}
        onSave={save} onDelete={del}
        extra={(e, set) => (
          <>
            <SpotifyFill e={e} set={set} />
            <PhotoUpload label="Cover art" value={e.cover} onChange={(v) => set({ ...e, cover: v })} />
            <Field label="Song" value={e.song} onChange={(ev) => set({ ...e, song: ev.target.value })} />
            <Field label="Artist" value={e.artist} onChange={(ev) => set({ ...e, artist: ev.target.value })} />
            <Field label="Client" value={e.client} onChange={(ev) => set({ ...e, client: ev.target.value })} />
            <Field label="Release date" type="date" value={e.releaseDate} onChange={(ev) => set({ ...e, releaseDate: ev.target.value })} />
            <Field label="Streaming link (opens on click)" value={e.link} onChange={(ev) => set({ ...e, link: ev.target.value })} />
          </>
        )}
      />
    </div>
  );
}

/* ================================================================== */
/*  STYLES                                                             */
/* ================================================================== */
function StyleTag() {
  return (
    <style>{`
    @font-face{
      font-family:'Suntage';
      src:url(/fonts/suntage.otf) format('opentype');
      font-weight:normal;font-style:normal;font-display:swap;
    }
    :root{
      --bg:#000000; --panel:#0d0d0e; --panel2:#141416; --line:#242426;
      --ink:#f5f5f5; --mut:#8a8a8a; --mut2:#5f5f61; --acc:#ffffff;
      --r:12px;
    }
    *{box-sizing:border-box}
    body{margin:0}
    html,body{background:var(--bg);min-height:100%}
    html{scroll-behavior:smooth}
    .app{background:var(--bg);color:var(--ink);min-height:100vh;min-height:100dvh;
      display:flex;flex-direction:column;
      font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
      -webkit-font-smoothing:antialiased;line-height:1.5}

    .storage-warn{position:sticky;top:0;z-index:400;background:#3a1f1f;color:#f2c9c9;font-size:13px;
      text-align:center;padding:10px 20px;border-bottom:1px solid #5a2c2c}

    /* smooth entrance on load + navigation */
    @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
    @keyframes popIn{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
    @keyframes spin{to{transform:rotate(360deg)}}
    .spin{animation:spin 1s linear infinite}
    /* only routes with little enough content to always fit one screen (home,
       login) use this — everywhere else should size to its own content, or
       a short page (e.g. Contact) would strand the footer far below it on
       a tall screen */
    .view-home{flex:1;display:flex;flex-direction:column}

    @media(prefers-reduced-motion:reduce){ html{scroll-behavior:auto} }
    .boot{background:#000;color:#666;height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui}
    a{color:inherit}
    button{font-family:inherit;cursor:pointer}
    .muted{color:var(--mut)}
    .hint{color:var(--mut2);font-size:12.5px;margin-top:4px}

    /* logo images */
    .logo-wordmark{display:block;user-select:none}
    .logo-wordmark.hero{width:min(820px,90vw);height:auto}
    .logo-d{display:block;user-select:none}


    /* hero */
    .hero{max-width:900px;margin:0 auto;padding:96px 28px 60px;text-align:center}
    .hero-logo{display:flex;justify-content:center;margin-bottom:34px;opacity:.96}
    .hero-head{font-size:clamp(34px,6vw,60px);line-height:1.04;letter-spacing:-.02em;font-weight:800;margin:0 0 20px}
    .hero-sub{max-width:600px;margin:0 auto 30px;color:var(--mut);font-size:16.5px}
    .hero-cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}

    .btn{background:#fff;color:#000;border:none;border-radius:100px;padding:12px 24px;font-weight:600;font-size:14px;transition:opacity .15s ease,border-color .15s ease}
    .btn:hover{opacity:.88}
    .btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
    .btn.ghost:hover{border-color:#444;opacity:1}
    .btn.sm{padding:8px 15px;font-size:13px;display:inline-flex;align-items:center;gap:6px}
    .btn.full{width:100%;justify-content:center;display:flex}

    .block{max-width:1080px;margin:0 auto;padding:44px 28px}
    .block-head{display:flex;align-items:baseline;justify-content:space-between}
    .eyebrow{font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:var(--mut);font-weight:600;margin:0 0 22px}


    /* dashboard: photo upload */
    .photo-up{display:flex;align-items:center;gap:14px}
    .photo-prev{width:64px;height:64px;border-radius:10px;object-fit:cover;background:var(--panel2);border:1px solid var(--line);flex-shrink:0}
    .photo-prev-empty{display:flex;align-items:center;justify-content:center;color:var(--mut2);font-size:11px;text-align:center}
    .photo-actions{display:flex;align-items:center;gap:10px}
    .photo-btn{position:relative;cursor:pointer}
    .photo-remove{background:none;border:none;color:var(--mut2);font-size:12px;text-decoration:underline}
    .photo-remove:hover{color:var(--ink)}

    /* dashboard: spotify auto-fill */
    .sp-fill{display:flex;flex-direction:column;gap:8px;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:14px}
    .fld-label{font-size:12.5px;color:var(--mut)}
    .sp-row{display:flex;gap:8px}
    .sp-row input{flex:1;background:var(--panel);border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:11px 13px;font-size:13.5px;font-family:inherit}
    .sp-row input:focus{outline:none;border-color:#4a4a4a}
    .sp-note{display:inline-flex;align-items:center;gap:6px;font-size:12px}
    .sp-note.ok{color:#8fce8f}
    .sp-note.err{color:#e0a0a0}
    /* dashboard: release thumbnails in table */
    .rel-thumb{width:34px;height:34px;border-radius:6px;object-fit:cover;background:var(--panel2);display:block}
    .rel-thumb-empty{border:1px solid var(--line)}

    .svc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
    .svc-card{position:relative;text-align:left;background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:20px;color:var(--ink)}
    .svc-card:hover{border-color:#3a3a3a}
    .svc-card strong{display:block;font-size:15px;margin-bottom:8px}
    .svc-card span{color:var(--mut);font-size:13.5px}
    .svc-arrow{position:absolute;top:18px;right:16px;color:var(--mut2)}

    .ros-preview{display:grid;grid-template-columns:repeat(6,1fr);gap:18px}
    .ros-mini{background:none;border:none;color:var(--ink);display:flex;flex-direction:column;align-items:center;gap:10px;font-size:13px}
    .ros-mini:hover{color:var(--mut)}

    .cta-strip{max-width:1080px;margin:24px auto 60px;padding:48px 28px;text-align:center;background:var(--panel);border:1px solid var(--line);border-radius:16px}
    .cta-strip.inline{margin-top:40px}
    .cta-strip h2{font-size:24px;font-weight:700;margin:0 0 20px;letter-spacing:-.01em}

    /* generic page */
    .page{max-width:1000px;margin:0 auto;padding:80px 28px 60px;text-align:center}
    .how-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin:0 0 34px}
    .how-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:22px}
    .how-card strong{display:block;margin-bottom:8px;font-size:15px}
    .how-card p{margin:0;color:var(--mut);font-size:13.5px}

    .svc-full{display:flex;flex-direction:column;gap:2px}
    .svc-row{border-top:1px solid var(--line);padding:26px 0}
    .svc-row h3{font-size:20px;margin:0 0 8px;font-weight:700}
    .svc-row p{color:var(--mut);margin:0 0 14px}
    .svc-row ul{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:10px 24px}
    .svc-row li{display:flex;align-items:center;gap:7px;font-size:13.5px;color:var(--ink)}
    .svc-row li svg{color:var(--mut2)}

    .socials{display:flex;gap:22px;align-items:center}
    .social-ic{color:var(--ink);display:inline-flex;opacity:.92;transition:opacity .12s,transform .12s}
    .social-ic:hover{opacity:1;transform:translateY(-2px)}

    .avatar{border-radius:10px;object-fit:cover;object-position:center;background:#1c1c1e;flex-shrink:0;aspect-ratio:1}
    .ph-fade{opacity:0;transition:opacity .4s ease}
    .ph-fade.ph-in{opacity:1}
    @media(prefers-reduced-motion:reduce){ .ph-fade{transition:none;opacity:1} }
    .avatar-ph{border-radius:10px;display:flex;align-items:center;justify-content:center;background:#1c1c1e;color:#666;font-weight:700;flex-shrink:0;aspect-ratio:1}

    .tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:26px}
    .tab{background:var(--panel);border:1px solid var(--line);color:var(--mut);border-radius:100px;padding:8px 16px;font-size:13px;transition:background-color .15s ease,color .15s ease,border-color .15s ease}
    .tab.active{background:#fff;color:#000;border-color:#fff}

    /* forms */
    .form-card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:26px;display:flex;flex-direction:column;gap:16px;max-width:520px;margin:0 auto 20px;text-align:left}
    .fld{display:flex;flex-direction:column;gap:7px}
    .fld span{font-size:12.5px;color:var(--mut);letter-spacing:.02em}
    .fld input,.fld select,.fld textarea{background:var(--panel2);border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:11px 13px;font-size:14px;font-family:inherit}
    .fld input:focus,.fld select:focus,.fld textarea:focus{outline:none;border-color:#4a4a4a}


    .logo-link{background:none;border:none;display:inline-flex;text-decoration:none}
    .err{background:#2a1414;border:1px solid #5a2a2a;color:#e59a9a;border-radius:8px;padding:10px 12px;font-size:13px}

    /* ============ DASHBOARD ============ */
    .dash{display:flex;min-height:100vh}
    .dash-side{width:220px;background:var(--bg);border-right:1px solid var(--line);padding:22px 14px;display:flex;flex-direction:column;gap:6px;position:sticky;top:0;height:100vh}
    .dash-brand{padding:6px 10px 18px}
    .dash-side nav{display:flex;flex-direction:column;gap:2px;flex:1}
    .dash-side nav button{display:flex;align-items:center;gap:11px;background:none;border:none;color:var(--mut);padding:11px 12px;border-radius:9px;font-size:14px;text-align:left;transition:color .15s ease,background-color .15s ease}
    .dash-side nav button:hover{color:var(--ink);background:var(--panel2)}
    .dash-side nav button.active{color:#000;background:#fff}
    .nav-label{flex:1}
    .nav-badge{background:#e5484d;color:#fff;font-size:11px;font-weight:700;line-height:1;min-width:18px;height:18px;border-radius:100px;display:inline-flex;align-items:center;justify-content:center;padding:0 5px;flex-shrink:0}
    .dash-out{display:flex;align-items:center;gap:9px;background:none;border:1px solid var(--line);color:var(--mut);padding:10px 12px;border-radius:9px;font-size:13px;transition:color .15s ease,border-color .15s ease}
    .dash-out:hover{color:var(--ink);border-color:#3a3a3a}
    .dash-main{flex:1;padding:30px 34px;max-width:1240px}
    .dash-role{font-size:12px;color:var(--mut2);letter-spacing:.06em;margin-bottom:22px;text-transform:uppercase}

    .admin-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:10px 16px}
    .overview-links{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .overview-links a.btn{display:inline-flex;align-items:center;gap:6px;text-decoration:none}
    .overview-subhint{margin:-10px 0 18px}
    .err-text{color:#e59a9a}
    .modal-save-warn{margin:0 20px 14px;padding:10px 12px;border-radius:8px;background:#3a1f1f;border:1px solid #5a2c2c;font-size:13px}
    .admin-head h2{font-size:22px;margin:0}
    .admin-table{border:1px solid var(--line);border-radius:12px;overflow:hidden}
    .admin-row{display:grid;grid-template-columns:var(--cols, 1fr 1fr 1fr 72px);gap:14px;align-items:center;padding:13px 16px;border-bottom:1px solid var(--line);font-size:13.5px}
    .admin-row:last-child{border-bottom:none}
    .admin-hd{background:var(--panel2);color:var(--mut);font-size:11.5px;letter-spacing:.08em;text-transform:uppercase}
    .cell{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)}
    .cell-name{display:flex;align-items:center;gap:10px}
    .admin-act{display:flex;gap:6px;justify-content:flex-end}
    .admin-act button{background:var(--panel2);border:1px solid var(--line);color:var(--mut);border-radius:7px;padding:6px;display:flex}
    .admin-act button:disabled{opacity:.35;cursor:not-allowed}
    .admin-act button:hover{color:var(--ink);border-color:#3a3a3a}
    .admin-empty{padding:26px 16px;color:var(--mut2);font-size:13.5px;text-align:center}
    .admin-row-link{width:100%;background:none;border:none;border-bottom:1px solid var(--line);cursor:pointer;text-align:left;font-family:inherit}
    .admin-row-link:last-child{border-bottom:none}
    .admin-row-link:hover{background:var(--panel2)}
    .ar-song-row{display:grid;grid-template-columns:20px 1fr 1fr;gap:8px;align-items:center;margin-bottom:8px}
    .ar-song-row input{background:var(--panel2);border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:9px 11px;font-size:13.5px;font-family:inherit;width:100%}
    .ar-song-num{color:var(--mut);font-size:12.5px;text-align:center}
    .ar-given-row{display:flex;align-items:center;gap:10px;margin-top:14px}

    .subs{display:flex;flex-direction:column;gap:12px}
    .sub-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px}
    .sub-card.unread{border-left:3px solid #e5484d}
    .sub-top{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 10px;margin-bottom:4px}
    .sub-top-info{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0}
    .sub-contact-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:4px}
    .sub-dot{width:8px;height:8px;border-radius:50%;background:#e5484d;flex-shrink:0}
    .tag{font-size:11px;background:var(--panel2);border:1px solid var(--line);color:var(--mut);padding:3px 9px;border-radius:100px}
    .sub-email{color:var(--mut);font-size:13px;text-decoration:none}
    .sub-card p{margin:8px 0;font-size:14px}
    .sub-date{font-size:11.5px;color:var(--mut2)}
    .msg-count-badge{margin-left:9px;vertical-align:middle}

    /* modal */
    .modal{position:fixed;inset:0;background:rgba(0,0,0,.6);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);display:flex;align-items:flex-start;justify-content:center;padding:40px 20px;z-index:60;overflow-y:auto}
    .crop-overlay{align-items:center;z-index:80}
    .crop-card{background:var(--panel);border:1px solid var(--line);border-radius:16px;width:100%;max-width:380px;animation:popIn .28s cubic-bezier(.22,.61,.36,1) both}
    .crop-body{padding:22px;display:flex;flex-direction:column;align-items:center;gap:16px}
    .crop-view{position:relative;overflow:hidden;border-radius:12px;background:#000;cursor:grab;touch-action:none;user-select:none}
    .crop-view:active{cursor:grabbing}
    .crop-view img{pointer-events:none}
    .crop-ring{position:absolute;inset:0;box-shadow:0 0 0 1px rgba(255,255,255,.25) inset;border-radius:12px;pointer-events:none}
    .crop-zoom{display:flex;align-items:center;gap:12px;width:100%}
    .crop-zoom span{font-size:12px;color:var(--mut);letter-spacing:.06em;text-transform:uppercase}
    .crop-zoom input[type=range]{flex:1;accent-color:#fff}
    .crop-hint{font-size:12px;color:var(--mut2);margin:0;text-align:center}
    .modal-card{background:var(--panel);border:1px solid var(--line);border-radius:16px;width:100%;max-width:460px;animation:popIn .28s cubic-bezier(.22,.61,.36,1) both}
    .modal-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:20px 22px;border-bottom:1px solid var(--line)}
    .modal-head h3{margin:0;font-size:17px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .modal-head button{flex-shrink:0}
    .modal-head button{background:none;border:none;color:var(--mut)}
    .modal-body{padding:22px;display:flex;flex-direction:column;gap:14px}
    .modal-foot{display:flex;justify-content:flex-end;gap:10px;padding:16px 22px;border-top:1px solid var(--line)}

    /* ============ PORTAL ============ */
    .portal{min-height:100vh}
    .portal-nav{display:flex;align-items:center;justify-content:space-between;padding:16px 28px;border-bottom:1px solid var(--line);position:sticky;top:0;background:rgba(10,10,10,.85);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);z-index:20}
    .portal-who{display:flex;align-items:center;gap:16px;font-size:14px}
    .portal-who button{display:flex;align-items:center;gap:7px;background:none;border:1px solid var(--line);color:var(--mut);border-radius:100px;padding:8px 14px;font-size:13px}
    .portal-who button:hover{color:var(--ink);border-color:#3a3a3a}
    .portal-main{max-width:960px;margin:0 auto;padding:30px 28px 60px}
    .portal-role{font-size:12px;color:var(--mut2);letter-spacing:.06em;text-transform:uppercase;margin-bottom:22px}
    .sync-bar{display:flex;align-items:center;gap:14px;margin-bottom:26px;flex-wrap:wrap}
    .sync-bar > div{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
    .sync-note{font-size:12.5px;color:var(--mut)}
    .sync-msg{color:var(--mut2)}
    .stat-row{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:34px}
    .stat{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:22px}
    .stat-label{display:block;color:var(--mut);font-size:12.5px;margin-bottom:8px}
    .stat strong{font-size:30px;font-weight:800;letter-spacing:-.01em}
    .portal-block{margin-bottom:38px}
    .portal-block h2{font-size:19px;margin:0 0 4px}
    .portal-block .muted{margin:0 0 16px;font-size:13.5px}
    .portal-block-head{display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:10px 16px;margin-bottom:16px}
    .portal-block-head .btn{flex-shrink:0}
    .portal-block-head h2{margin:0 0 4px}
    .portal-block-head .muted{margin:0}
    .cat-summary{margin-bottom:22px}
    .cat-summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}
    .cat-stat{container-type:inline-size;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 16px;display:flex;flex-direction:column;gap:4px;min-width:0}
    .cat-stat-label{font-size:clamp(9px,6.5cqi,11px);letter-spacing:.06em;text-transform:uppercase;color:var(--mut2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .cat-stat-val{font-size:clamp(15px,9cqi,20px);font-weight:700;letter-spacing:-.01em;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .chart-wrap{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px 8px 8px}

    /* client portal: songs + splits */
    .song-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:16px}
    .song-card{background:none;border:none;padding:0;text-align:left;color:var(--ink);display:flex;flex-direction:column;gap:11px;cursor:pointer}
    .song-cover{aspect-ratio:1;border-radius:12px;overflow:hidden;background:var(--panel2);border:1px solid var(--line);transition:transform .15s ease,border-color .15s ease}
    .song-card:hover .song-cover{transform:translateY(-4px);border-color:#3d3d40}
    .song-cover img{width:100%;height:100%;object-fit:cover;display:block}
    .song-cover-empty{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#3a3a3a}
    .song-info{display:flex;flex-direction:column;gap:2px}
    .song-info strong{font-size:14.5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .song-info span{color:var(--mut);font-size:12.5px}
    .song-info em{color:var(--mut2);font-size:11.5px;font-style:normal;margin-top:2px}

    .song-detail{max-width:440px}
    .song-detail-top{display:flex;gap:16px;align-items:center;margin-bottom:8px}
    .song-detail-cover{width:88px;height:88px;border-radius:10px;overflow:hidden;background:var(--panel2);border:1px solid var(--line);flex-shrink:0}
    .song-detail-cover img{width:100%;height:100%;object-fit:cover;display:block}
    .song-detail-artist{font-size:16px;font-weight:600}
    .song-detail-date{color:var(--mut);font-size:13px;margin:3px 0 6px}
    .split-list{margin-top:6px;border-top:1px solid var(--line)}
    .split-list-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--line);font-size:14px}
    .split-list-row:last-child{border-bottom:none}
    .split-name em{color:var(--mut2);font-style:normal}
    .split-pct{color:var(--mut);font-variant-numeric:tabular-nums}
    .split-list-total{font-weight:600}

    /* splits editor */
    .splits-ed{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:9px}
    .splits-ed-head{display:flex;align-items:center;justify-content:space-between;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut)}
    .splits-ed-row{display:grid;grid-template-columns:1.3fr 1fr 74px 30px;gap:8px;align-items:center}
    .splits-ed-row input{width:100%;background:var(--panel);border:1px solid var(--line);color:var(--ink);border-radius:7px;padding:8px 9px;font-size:13px;font-family:inherit}
    .splits-ed-row input:focus{outline:none;border-color:#4a4a4a}
    .pct-in{display:flex;align-items:center;gap:4px;color:var(--mut)}
    .pct-in input{width:48px}
    .split-del{background:none;border:none;color:var(--mut2);display:flex;justify-content:center;cursor:pointer}
    .split-del:hover{color:#e0a0a0}
    .split-ok{color:#8fce8f}
    .split-warn{color:#e0b48f}
    .split-hint{color:#e0b48f;font-size:12px;margin:0}

    /* staff website sub-nav */
    .subnav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:26px;border-bottom:1px solid var(--line);padding-bottom:16px}
    .subpill{background:var(--panel2);border:1px solid var(--line);color:var(--mut);border-radius:100px;padding:8px 16px;font-size:13px;font-family:inherit;cursor:pointer;transition:background-color .15s ease,color .15s ease,border-color .15s ease}
    .subpill:hover{color:var(--ink)}
    .subpill.active{background:var(--ink);color:#000;border-color:var(--ink);font-weight:600}
    .mb{margin-bottom:16px}
    .about-editor{width:100%;max-width:760px;background:var(--panel2);border:1px solid var(--line);color:var(--ink);border-radius:10px;padding:14px;font-size:14px;line-height:1.6;font-family:inherit;resize:vertical}
    .about-editor:focus{outline:none;border-color:#4a4a4a}

    /* staff catalog: client list + song manager */
    .catalog-wrap{display:grid;grid-template-columns:240px 1fr;gap:26px;align-items:start}
    .catalog-clients{display:flex;flex-direction:column;gap:4px;border:1px solid var(--line);border-radius:12px;padding:8px;max-height:70vh;overflow-y:auto}
    .cc{display:flex;align-items:center;gap:10px;background:none;border:none;color:var(--ink);padding:8px 10px;border-radius:8px;cursor:pointer;text-align:left;width:100%}
    .cc:hover{background:var(--panel2)}
    .cc.active{background:var(--panel2)}
    .cc-row{display:flex;align-items:center;gap:2px}
    .cc-row .cc{flex:1;width:auto}
    .cc-name{flex:1;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .cc-add{border:1px dashed var(--line);color:var(--mut);font-size:13px;justify-content:center;margin-bottom:2px}
    .cc-add:hover{color:var(--ink);border-color:var(--mut2);background:var(--panel2)}
    .cc-count{color:var(--mut2);font-size:12px;font-variant-numeric:tabular-nums}
    .cc-overview-ic{width:30px;height:30px;border-radius:50%;background:var(--panel2);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--mut)}
    .catalog-main{min-width:0}

    /* staff overview: read-only MASTER-tab rollup */
    .master-table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px}
    .master-table{width:100%;border-collapse:collapse;font-size:13px;white-space:nowrap}
    .master-table th,.master-table td{padding:11px 14px;text-align:right;font-variant-numeric:tabular-nums}
    .master-table th:first-child,.master-table td:first-child{text-align:left;font-variant-numeric:normal}
    .master-table thead th{background:var(--panel2);color:var(--mut);font-size:11px;letter-spacing:.06em;text-transform:uppercase;font-weight:600;border-bottom:1px solid var(--line)}
    .master-table tbody td{border-bottom:1px solid var(--line);color:var(--ink)}
    .master-table tbody tr:last-child td{border-bottom:none}
    .master-row-link{cursor:pointer;transition:background-color .15s ease}
    .master-row-link:hover{background:var(--panel2)}
    .master-total-row td{font-weight:700;border-top:1px solid var(--line);border-bottom:none;background:var(--panel2)}


    /* dashboard misc */
    .badge-yes{display:inline-flex;align-items:center;gap:4px;color:#8fce8f;font-size:12px}
    .badge-no{color:var(--mut2)}
    .check-row{display:flex;align-items:flex-start;gap:10px;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:12px 14px;cursor:pointer}
    .check-row input{margin-top:2px;width:16px;height:16px;accent-color:#fff;flex-shrink:0}
    .check-row span{font-size:13px;color:var(--ink);line-height:1.5}

    .releases-empty-note{text-align:center;padding:20px 0}
    .rel-filter{display:flex;justify-content:center;margin:0 0 30px}
    .rel-filter select{background:var(--panel2);border:1px solid var(--line);color:var(--ink);border-radius:100px;padding:10px 40px 10px 18px;font-size:13.5px;font-family:inherit;letter-spacing:.02em;cursor:pointer;
      appearance:none;-webkit-appearance:none;
      background-image:linear-gradient(45deg,transparent 50%,var(--mut) 50%),linear-gradient(135deg,var(--mut) 50%,transparent 50%);
      background-position:calc(100% - 20px) 50%,calc(100% - 15px) 50%;background-size:5px 5px,5px 5px;background-repeat:no-repeat}
    .rel-filter select:focus{outline:none;border-color:#4a4a4a}
    .inline-link{color:var(--ink);text-decoration:underline;text-underline-offset:2px}
    .inline-link:hover{color:var(--mut)}
    .icon-btn{position:relative;background:none;border:none;color:var(--mut);display:inline-flex;align-items:center;padding:0;cursor:pointer}
    .icon-btn:hover{color:var(--ink)}
    .copied-pop{position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);background:#fff;color:#000;font-size:10.5px;font-weight:600;padding:3px 7px;border-radius:5px;white-space:nowrap;letter-spacing:.02em}
    .email-inline{background:none;border:none;padding:0;font:inherit;color:var(--ink);text-decoration:underline;text-underline-offset:2px;cursor:pointer}
    .email-inline:hover{color:var(--mut)}
    .copied-tag{color:#8fce8f;text-decoration:none;font-size:12px}


    /* footer login */

    /* responsive */
    @media(max-width:820px){
      .team-links a,.ros-links a,.social-ic,.icon-btn{padding:6px}
    }
    @media(max-width:520px){
      .page{padding:64px 20px 48px}
    }

    /* ================================================================ */
    /*  DASHBOARD + PORTAL v2 — every rule scoped to .app:not(.pub)     */
    /* ================================================================ */
    .app:not(.pub){
      --d-bg:#000;--d-side:#050506;--d-s1:#0b0b0c;--d-s2:#111113;--d-s3:#161618;--d-field:#0d0d0f;
      --d-hover:rgba(255,255,255,.04);--d-active:rgba(255,255,255,.07);--d-overlay:rgba(0,0,0,.72);
      --d-line:#1c1c1e;--d-line-2:#2a2a2c;--d-line-3:#3a3a3c;
      --d-ink:#f5f5f5;--d-ink-2:#d4d4d6;--d-ink-3:#a3a3a3;--d-ink-4:#8a8a8a;--d-ink-off:#5f5f61;--d-ph:#7a7a7c;
      --d-pos:#8fce8f;--d-pos-bg:rgba(143,206,143,.08);--d-pos-line:rgba(143,206,143,.24);
      --d-warn:#e0b48f;--d-warn-bg:rgba(224,180,143,.08);--d-warn-line:rgba(224,180,143,.24);
      --d-neg:#ef8f8f;--d-neg-bg:rgba(229,72,77,.10);--d-neg-line:rgba(229,72,77,.30);
      --d-info:#8ab4ff;--d-info-bg:rgba(138,180,255,.08);--d-info-line:rgba(138,180,255,.24);
      --d-ban-neg-bg:#231111;--d-ban-neg-line:#552727;--d-ban-neg-ink:#f2c9c9;
      --d-ban-warn-bg:#1c150e;--d-ban-warn-line:#4a3820;--d-ban-warn-ink:#ecd3b8;
      /* area colours: which part of the business a task, nav item or badge belongs to (never on numbers) */
      --d-a-lum:var(--d-info);--d-a-pub:#6fd6c4;--d-a-ar:#c4a7ff;--d-a-cu:#f29bc8;--d-a-money:var(--d-pos);--d-a-site:var(--d-ink-3);
      --d-display:'Suntage','Inter',sans-serif;
      --d-body:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
      --d-r-xs:6px;--d-r-sm:8px;--d-r-md:10px;--d-r-field:12px;--d-r-card:14px;--d-r-modal:16px;
      --d-ctl-sm:36px;--d-ctl:40px;--d-ctl-lg:48px;--d-field-h:44px;--d-icon:32px;
      --d-side-w:232px;--d-tab-h:64px;--d-ban-h:44px;
      --d-t-fast:150ms;--d-t-press:120ms;--d-t-open:240ms;--d-t-sheet:280ms;
      --d-shadow-pop:0 24px 64px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.06);
      --d-chev:linear-gradient(45deg,transparent 50%,#8a8a8a 50%),linear-gradient(135deg,#8a8a8a 50%,transparent 50%);
      --d-ic-alert:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cpath d='M12 8v4M12 16h.01'/%3E%3C/svg%3E");
      --d-ic-empty:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='rgb(138,138,138)' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M22 12h-6l-2 3h-4l-2-3H2'/%3E%3Cpath d='M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'/%3E%3C/svg%3E");
      --d-ic-disc:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='rgb(138,138,138)' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cpath d='M6 12c0-1.7.7-3.2 1.8-4.2'/%3E%3Ccircle cx='12' cy='12' r='2'/%3E%3Cpath d='M18 12c0 1.7-.7 3.2-1.8 4.2'/%3E%3C/svg%3E");
      color-scheme:dark;font-size:14px;line-height:1.55;
    }
    @media (pointer:coarse){ .app:not(.pub){--d-ctl-sm:44px;--d-ctl:44px;--d-field-h:48px;--d-icon:44px} }
    html:has(.app:not(.pub) .dash),html:has(.app:not(.pub) .portal){scrollbar-gutter:stable}
    .app:not(.pub) :is(.dash-main,.portal-main,.modal){font-variant-numeric:tabular-nums}
    .app:not(.pub) :is(button,a,select,input,textarea,[tabindex]):focus-visible{outline:1px solid #f5f5f5;outline-offset:2px}
    .app:not(.pub) .muted{color:var(--d-ink-3)}
    .app:not(.pub) .hint{color:var(--d-ink-4);font-size:12.5px;line-height:1.45;margin:4px 0 0}
    .app:not(.pub) .err-text{color:var(--d-neg)}
    .app:not(.pub) .ok-text{color:var(--d-pos)}
    .app:not(.pub) .avatar,.app:not(.pub) .avatar-ph{background:var(--d-s3)}
    .app:not(.pub) .avatar-ph{color:var(--d-ink-3)}
    .app:not(.pub) :is(.master-table-wrap,.catalog-clients,.modal-body){scrollbar-width:thin;scrollbar-color:#3a3a3c transparent}

    .app:not(.pub) .dash{display:flex;min-height:100vh;min-height:100dvh}
    .app:not(.pub) .dash-side{flex:none;width:var(--d-side-w);align-self:flex-start;position:sticky;top:0;height:100vh;height:100dvh;
      padding:20px 12px 16px;gap:0;background:var(--d-side);border-right:1px solid var(--d-line)}
    .app:not(.pub):has(> .storage-warn) .dash-side{top:var(--d-ban-h);height:calc(100dvh - var(--d-ban-h))}
    .app:not(.pub) .dash-brand{padding:4px 12px 28px}
    .app:not(.pub) .dash-side nav{flex:1 1 auto;min-height:0;overflow-y:auto;gap:2px}
    .app:not(.pub) .dash-side nav button{height:40px;padding:0 12px;gap:12px;border-radius:var(--d-r-md);background:none;
      color:var(--d-ink-3);font-size:14px;font-weight:500;transition:background-color var(--d-t-fast) ease,color var(--d-t-fast) ease}
    .app:not(.pub) .dash-side nav button svg{flex:none;width:18px;height:18px;stroke-width:1.75;color:var(--d-ink-4);transition:color var(--d-t-fast) ease}
    @media (hover:hover){ .app:not(.pub) .dash-side nav button:hover{background:var(--d-hover);color:var(--d-ink)} }
    .app:not(.pub) .dash-side nav button.active{background:var(--d-active);color:var(--d-ink)}
    .app:not(.pub) .dash-side nav button.active svg{color:var(--d-ink)}
    /* a ring tells the selected tab from a hovered one (same as the selected client) */
    @media (min-width:900px){ .app:not(.pub) .dash-side nav button.active{box-shadow:inset 0 0 0 1px var(--d-line-2)} }
    .app:not(.pub) .nav-badge{height:18px;min-width:18px;padding:0 6px;border-radius:100px;background:#f5f5f5;color:#000;-webkit-text-fill-color:#000;
      font:700 11px/1 var(--d-body);font-variant-numeric:tabular-nums}
    .app:not(.pub) .dash-side-foot{display:flex;flex-direction:column;gap:4px;margin-top:12px;padding-top:12px;border-top:1px solid var(--d-line)}
    .app:not(.pub) .dash-role{margin:0;padding:4px 12px 6px;font:600 11px/1.3 var(--d-body);letter-spacing:.06em;
      text-transform:uppercase;color:var(--d-ink-4)}
    .app:not(.pub) .dash-out{width:100%;height:40px;padding:0 12px;gap:12px;border:0;border-radius:var(--d-r-md);background:none;
      color:var(--d-ink-3);font-size:14px;font-weight:500}
    @media (hover:hover){ .app:not(.pub) .dash-out:hover{background:var(--d-hover);color:var(--d-ink)} }
    .app:not(.pub) :is(.dash-out,.portal-who button):disabled{cursor:progress}   /* "Signing out…": waiting for a save to land */
    .app:not(.pub) .dash-main{flex:1 1 auto;min-width:0;max-width:none;padding:32px 40px 64px}
    .app:not(.pub) .dash-main > *{max-width:1200px;margin-inline:auto}

    .app:not(.pub) .admin-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px 16px;margin:0 0 20px}
    .app:not(.pub) .dash-main .admin-head{min-height:var(--d-ctl-sm)}   /* titles sit at one height whether or not the head has a button */
    .app:not(.pub) .admin-head h2{flex:1 1 auto;min-width:0}
    .app:not(.pub) .dash-main .admin-head h2{margin:0;padding:0;font:400 24px/1.1 var(--d-display);font-synthesis:none;letter-spacing:.02em;
      text-transform:uppercase;overflow-wrap:anywhere;color:var(--d-ink);
      background:var(--chrome);background-size:100% 1.1em;background-repeat:repeat-y;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
    /* the Messages count badge lives INSIDE that h2: undo the text clip for it or its digits vanish */
    .app:not(.pub) .dash-main .admin-head h2 .nav-badge{margin-left:12px;vertical-align:.25em;background:#f5f5f5;-webkit-background-clip:border-box;background-clip:border-box;
      color:#000;-webkit-text-fill-color:#000}
    /* second level (must come AFTER the rule above: same specificity) */
    .app:not(.pub) .catalog-main .admin-head h2,
    .app:not(.pub) .portal-block-head h2,
    .app:not(.pub) .portal-block h2{margin:0 0 6px;padding:0;font:400 14px/1.2 var(--d-display);font-synthesis:none;letter-spacing:.08em;text-transform:uppercase;
      color:var(--d-ink);background:none;-webkit-text-fill-color:currentColor}
    /* one-line description under a title (About, Outreach, Advance) */
    .app:not(.pub) .admin-head + p.muted{max-width:68ch;margin:-8px 0 24px;font-size:14px;line-height:1.55;color:var(--d-ink-3)}
    .app:not(.pub) .overview-subhint{margin:-8px 0 20px;color:var(--d-ink-4)}
    .app:not(.pub) .admin-head:has(~ .form-card),.app:not(.pub) .admin-head:has(~ .form-card) + p.muted{max-width:560px}
    .app:not(.pub) .overview-links{gap:4px}
    /* About: field and its Save share one 760px column */
    .app:not(.pub) .subnav ~ div:has(> .about-editor){max-width:760px}
    /* Roster + Notable: their how-to paragraph sits ABOVE the Editor in the DOM; show it as a hint UNDER the table
       (CSS order only — DOM order, and therefore the tests that read the first .dash-main p.muted, are unchanged) */
    .app:not(.pub) .subnav ~ div:has(> div > .admin-head):has(> p.muted.mb){display:flex;flex-direction:column}
    .app:not(.pub) .subnav ~ div:has(> div > .admin-head):has(> p.muted.mb) > div:has(> .admin-head){order:1}
    .app:not(.pub) .subnav ~ div:has(> div > .admin-head):has(> p.muted.mb) > p.muted.mb{order:2;max-width:68ch;margin:12px 0 0;font-size:12.5px;line-height:1.5;color:var(--d-ink-4)}
    /* segmented sub-nav (Website, A&R) */
    .app:not(.pub) .subnav{display:inline-flex;flex-wrap:nowrap;gap:4px;max-width:100%;margin:0 0 28px;padding:4px;
      border:1px solid var(--d-line-2);border-radius:100px;overflow-x:auto;scrollbar-width:none}
    .app:not(.pub) .subnav::-webkit-scrollbar{display:none}
    .app:not(.pub) .subpill{flex:none;height:36px;padding:0 16px;border:1px solid transparent;border-radius:100px;background:none;color:var(--d-ink-3);
      font:400 10.5px/1 var(--d-display);font-synthesis:none;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap;
      transition:background-color var(--d-t-fast) ease,color var(--d-t-fast) ease,border-color var(--d-t-fast) ease}
    @media (hover:hover){ .app:not(.pub) .subpill:hover{color:var(--d-ink)} }
    .app:not(.pub) .subpill.active{background:var(--d-active);border-color:var(--d-line-3);color:var(--d-ink);font-weight:400}
    @media (pointer:coarse){ .app:not(.pub) .subpill{height:44px} }

    .app:not(.pub) .admin-table{background:var(--d-s1);border:1px solid var(--d-line-2);border-radius:var(--d-r-card);overflow:hidden}
    .app:not(.pub) .admin-row{min-height:52px;padding:0 12px 0 16px;gap:16px;border-bottom:1px solid var(--d-line);font-size:14px;color:var(--d-ink-3)}
    .app:not(.pub) .admin-row:last-child{border-bottom:0}
    .app:not(.pub) .admin-hd{min-height:40px;background:transparent;border-bottom-color:var(--d-line-2);color:var(--d-ink-4);
      font:600 11.5px/1 var(--d-body);letter-spacing:.06em;text-transform:uppercase}
    .app:not(.pub) .cell{line-height:24px;color:var(--d-ink-3)}
    .app:not(.pub) .admin-row:not(.admin-hd) > .cell:first-child,
    .app:not(.pub) .admin-row:has(.rel-thumb) > .cell:nth-child(2){color:var(--d-ink);font-weight:500}
    /* name ellipsis: .cell-name was flex, so its bare text node could never ellipsize */
    .app:not(.pub) .cell-name{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
    .app:not(.pub) .cell-name > .avatar{display:inline-block;vertical-align:middle;margin-right:12px;border-radius:var(--d-r-sm)}
    .app:not(.pub) .cell-name > .avatar-ph{display:inline-flex}
    /* chips inside a single-line cell were clipped top/bottom. min-width:0: every row is its own grid, so a
       visible-overflow cell would otherwise size its own row's tracks and the columns drift row to row */
    .app:not(.pub) .cell:has(> .tag),.app:not(.pub) .cell:has(> .badge-yes),.app:not(.pub) .cell:has(> .badge-no){overflow:visible;min-width:0}
    .app:not(.pub) .rel-thumb{width:36px;height:36px;border-radius:var(--d-r-xs)}
    /* clickable rows (Outreach) */
    .app:not(.pub) .admin-row-link{color:var(--d-ink-3);transition:background-color var(--d-t-fast) ease}
    @media (hover:hover){ .app:not(.pub) .admin-row-link:hover{background:var(--d-hover)} }
    .app:not(.pub) .admin-row-link:focus-visible{outline:1px solid #f5f5f5;outline-offset:-1px}
    .app:not(.pub) .admin-row-link > .cell:nth-child(n+3):nth-child(-n+6),
    .app:not(.pub) .admin-table:has(.admin-row-link) .admin-hd > span:nth-child(n+3):nth-child(-n+6){text-align:right}
    /* content-blind tracks, so every row lines up. Outreach: 144px fits the widest status chip (NOT CONTACTED).
       Roster: the name gets most of the row; Public and the 4 row actions are fixed */
    .app:not(.pub) .admin-table:has(.admin-row-link) .admin-row{grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) repeat(3,minmax(0,1fr)) minmax(0,.6fr) 144px}
    .app:not(.pub) .admin-table:has(.cell-name):has(.badge-yes,.badge-no) .admin-row{grid-template-columns:minmax(0,1.7fr) minmax(64px,.8fr) minmax(0,1.1fr) 84px calc(var(--d-icon) * 4 + 6px)}
    @media (min-width:900px) and (max-width:1199px){
      /* half-screen: Outreach drops Gross Streams + Songs (as the phone list does) so the numbers stay readable */
      .app:not(.pub) .admin-table:has(.admin-row-link) .admin-row{grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) repeat(2,minmax(88px,1fr)) 144px}
      .app:not(.pub) .admin-table:has(.admin-row-link) .admin-row > :is(:nth-child(3),:nth-child(6)){display:none}
    }
    /* Users: role shows "Staff"/"Client" (CSS only — textContent stays "staff"/"client") */
    .app:not(.pub) .admin-table:not(:has(.cell-name,.rel-thumb,.admin-row-link)) .admin-row:not(.admin-hd) > .cell:nth-child(2){text-transform:capitalize}
    /* row actions: quiet icon buttons, always visible, delete turns red on hover */
    .app:not(.pub) .admin-act{gap:2px}
    .app:not(.pub) .admin-act button{width:var(--d-icon);height:var(--d-icon);padding:0;align-items:center;justify-content:center;border:0;
      border-radius:var(--d-r-sm);background:none;color:var(--d-ink-4);transition:background-color var(--d-t-fast) ease,color var(--d-t-fast) ease}
    .app:not(.pub) .admin-act button svg{width:16px;height:16px}
    .app:not(.pub) .admin-act button:disabled{opacity:.5;color:var(--d-ink-off)}
    /* tablets: the inline 72px actions track would shrink two 44px targets to 35px; let them run into the column gap */
    @media (pointer:coarse) and (min-width:900px){ .app:not(.pub) .admin-act button{flex:none} }
    @media (hover:hover){
      .app:not(.pub) .admin-act button:hover{background:var(--d-active);color:var(--d-ink)}
      .app:not(.pub) .admin-act button:last-child:hover{background:var(--d-neg-bg);color:var(--d-neg)}
    }

    .app:not(.pub) .cat-summary{margin:0 0 24px}
    .app:not(.pub) .cat-summary-grid{display:grid;gap:1px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
      background:var(--d-line-2);border:1px solid var(--d-line-2);border-radius:var(--d-r-card);overflow:hidden}
    @media (min-width:600px){
      .app:not(.pub) .cat-summary-grid:has(> .cat-stat:nth-child(2):last-child){grid-template-columns:repeat(2,minmax(0,1fr))}
      .app:not(.pub) .cat-summary-grid:has(> .cat-stat:nth-child(3):last-child){grid-template-columns:repeat(3,minmax(0,1fr))}
      .app:not(.pub) .cat-summary-grid:has(> .cat-stat:nth-child(4):last-child){grid-template-columns:repeat(4,minmax(0,1fr))}
      .app:not(.pub) .cat-summary-grid:has(> .cat-stat:nth-child(6):last-child){grid-template-columns:repeat(3,minmax(0,1fr))}
    }
    .app:not(.pub) .cat-stat{justify-content:space-between;gap:8px;padding:16px 18px;background:var(--d-s1);border:0;border-radius:0}
    .app:not(.pub) .cat-stat-label{font:400 10px/1.35 var(--d-display);font-synthesis:none;letter-spacing:.12em;text-transform:uppercase;color:var(--d-ink-4);
      white-space:normal;overflow:visible;text-overflow:clip}
    .app:not(.pub) .cat-stat-val{font-size:clamp(16px,11cqi,22px);font-weight:600;line-height:1.15;letter-spacing:-.01em;color:var(--d-ink)}
    /* Advance: Verdict may wrap instead of being cut ("Too high — lower target") */
    .app:not(.pub) .form-card ~ .cat-summary .cat-stat:last-child .cat-stat-val{white-space:normal;font-size:16px;line-height:1.3}
    .app:not(.pub) .modal .cat-stat{padding:14px}   /* "Gross streams" fits one line in the 520px prospect card */

    .app:not(.pub) .master-table-wrap{overflow-x:auto;overscroll-behavior-x:contain;border:1px solid var(--d-line-2);border-radius:var(--d-r-card);
      background-color:var(--d-s1);
      /* scroll hint: a right-edge shadow that disappears when scrolled to the end (cover = local, shadow = scroll) */
      background-image:linear-gradient(to left,var(--d-s1) 30%,rgba(11,11,12,0)),radial-gradient(farthest-side at 100% 50%,rgba(255,255,255,.16),rgba(255,255,255,0));
      background-position:right center,right center;background-size:40px 100%,16px 100%;background-repeat:no-repeat;background-attachment:local,scroll}
    .app:not(.pub) .master-table{width:100%;min-width:max-content;font-size:13px}
    .app:not(.pub) .master-table th,.app:not(.pub) .master-table td{height:44px;padding:0 14px}
    .app:not(.pub) .master-table thead th{height:40px;background:transparent;border-bottom:1px solid var(--d-line-2);color:var(--d-ink-4);
      font:600 11px/1 var(--d-body);letter-spacing:.06em;text-transform:uppercase}
    .app:not(.pub) .master-table tbody td{border-bottom:1px solid var(--d-line);color:var(--d-ink-2)}
    .app:not(.pub) .master-table th:first-child,.app:not(.pub) .master-table td:first-child{position:sticky;left:0;z-index:1;background:var(--d-s1);box-shadow:inset -1px 0 0 var(--d-line)}
    .app:not(.pub) .master-table tbody tr:not(.master-row-link) td:first-child{color:var(--d-ink-4)}
    .app:not(.pub) .master-table tbody tr.master-row-link td:first-child{color:var(--d-ink);font-weight:500}
    .app:not(.pub) .master-table tbody tr.master-row-link td:first-child::after{content:"›";margin-left:8px;color:var(--d-ink-4)}
    @media (hover:hover){
      .app:not(.pub) .master-row-link:hover{background:var(--d-hover)}
      .app:not(.pub) .master-row-link:hover td:first-child{background:var(--d-s2)}
    }
    .app:not(.pub) .master-total-row td{background:transparent;border-top:1px solid var(--d-line-3);border-bottom:0;font-weight:600;color:var(--d-ink)}
    .app:not(.pub) .master-total-row td:first-child{background:var(--d-s1)}

    .app:not(.pub) .catalog-wrap{grid-template-columns:260px minmax(0,1fr);gap:28px}
    .app:not(.pub) .catalog-clients{position:sticky;top:24px;max-height:calc(100dvh - 48px);gap:2px;padding:6px;background:var(--d-s1);
      border:1px solid var(--d-line-2);border-radius:var(--d-r-card);overscroll-behavior:contain}
    .app:not(.pub) .catalog-clients > *{flex:none}
    .app:not(.pub):has(> .storage-warn) .catalog-clients{top:calc(var(--d-ban-h) + 24px);max-height:calc(100dvh - var(--d-ban-h) - 48px)}
    .app:not(.pub) .cc{min-height:44px;padding:6px 8px;gap:10px;border-radius:var(--d-r-md);color:var(--d-ink-3);transition:background-color var(--d-t-fast) ease,color var(--d-t-fast) ease}
    @media (hover:hover){ .app:not(.pub) .cc:hover{background:var(--d-hover);color:var(--d-ink)} }
    .app:not(.pub) .cc.active{background:var(--d-active);color:var(--d-ink);box-shadow:inset 0 0 0 1px var(--d-line-3)}
    /* flex:1 kept min-width:auto, so a long name pushed the count + trash out of the card instead of ellipsizing
       (the chip rule's min-width:76px below still wins: same specificity, later) */
    .app:not(.pub) .cc-row .cc{min-width:0}
    .app:not(.pub) .cc-name{font-size:14px}
    .app:not(.pub) .cc.active .cc-name{font-weight:500}
    .app:not(.pub) .cc-count{color:var(--d-ink-4);font-size:12px}
    .app:not(.pub) .cc-overview-ic{background:var(--d-s2);border-color:var(--d-line-2);color:var(--d-ink-3)}
    .app:not(.pub) .catalog-clients .cc-add{height:40px;min-height:0;margin:2px 0 6px;justify-content:center;gap:8px;border:1px dashed var(--d-line-3);
      border-radius:var(--d-r-md);color:var(--d-ink-3);font-size:13.5px}
    @media (hover:hover){ .app:not(.pub) .catalog-clients .cc-add:hover{border-style:solid;color:var(--d-ink);background:var(--d-hover)} }
    /* no trash on the chips: Delete client is in the client header's More ▾ */
    .app:not(.pub) .cc-row{gap:2px}

    .app:not(.pub) .client-head{display:flex;align-items:flex-start;gap:14px;min-width:0;margin:0 0 24px;padding:0 0 20px;border-bottom:1px solid var(--d-line)}
    /* the photo stays by the name's first line: where centring put it beside a one-line name (name + meta = 50.5px),
       and no lower when a long name wraps */
    .app:not(.pub) .client-head > .avatar{flex:none;margin-top:5px}
    .app:not(.pub) .client-head-text{min-width:0}
    .app:not(.pub) .client-head-name{font-size:22px;font-weight:600;line-height:1.2;letter-spacing:-.01em;color:var(--d-ink);overflow-wrap:anywhere}
    .app:not(.pub) .client-head-meta{margin-top:4px;font-size:13px;color:var(--d-ink-3);overflow-wrap:anywhere}
    .app:not(.pub) .client-head-meta .warn-text{color:var(--d-warn)}
    .app:not(.pub) .portal-block-head{gap:12px 16px;margin:0 0 20px}
    .app:not(.pub) .portal-block-head .muted{margin:0;font-size:13.5px;color:var(--d-ink-3)}

    .app:not(.pub) .song-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:24px 16px}
    .app:not(.pub) .song-card{min-width:0;gap:10px;color:var(--d-ink)}
    .app:not(.pub) .song-cover{border:0;border-radius:var(--d-r-field);background:var(--d-s2);box-shadow:0 0 0 1px var(--d-line-2);transition:box-shadow var(--d-t-fast) ease}
    .app:not(.pub) .song-card:hover .song-cover{transform:none}
    /* keep the shared .ph-fade opacity fade when adding the transform transition */
    .app:not(.pub) .song-cover img{transition:transform .3s var(--ease-out),opacity .4s ease}
    @media (hover:hover){
      .app:not(.pub) .song-card:hover .song-cover{box-shadow:0 0 0 1px var(--d-line-3)}
      .app:not(.pub) .song-card:hover .song-cover img{transform:scale(1.03)}
    }
    .app:not(.pub) .song-card:focus-visible{outline:0}
    .app:not(.pub) .song-card:focus-visible .song-cover{box-shadow:0 0 0 2px #f5f5f5}
    .app:not(.pub) .song-cover-empty{color:var(--d-ink-off)}
    .app:not(.pub) .song-info{min-width:0;gap:2px}
    .app:not(.pub) .song-info strong{font-size:14px;font-weight:600;line-height:1.35}
    .app:not(.pub) .song-info span{font-size:13px;color:var(--d-ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .app:not(.pub) .song-info em{margin-top:4px;font-size:12px;color:var(--d-ink-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    /* the split total inside the meta line (not the artist span above): amber when it isn't 100% */
    .app:not(.pub) .song-info em > span{font-size:inherit;color:inherit}
    .app:not(.pub) .song-info em > span.split-warn{color:var(--d-warn)}

    .app:not(.pub) .subs{gap:8px}
    .app:not(.pub) .sub-card{min-width:0;padding:16px 18px;background:transparent;border:1px solid var(--d-line);border-radius:var(--d-r-card);overflow-wrap:anywhere}
    .app:not(.pub) .sub-card.unread{background:var(--d-s1);border:1px solid var(--d-line-2)}   /* replaces the 3px red left border */
    .app:not(.pub) .sub-top{flex-wrap:nowrap;align-items:flex-start;gap:12px;margin:0 0 2px}
    .app:not(.pub) .sub-top-info{flex:1 1 auto;min-width:0;gap:8px 10px}
    .app:not(.pub) .sub-top-info strong{min-width:0;max-width:calc(100% - 16px);font-size:15px;font-weight:500;line-height:1.4;overflow-wrap:anywhere}
    .app:not(.pub) .sub-card.unread .sub-top-info strong{font-weight:600}
    .app:not(.pub) .sub-card:not(.unread) .sub-top-info strong,.app:not(.pub) .sub-card:not(.unread) > p{color:var(--d-ink-3)}   /* read = quieter */
    .app:not(.pub) .sub-dot{width:6px;height:6px;background:#f5f5f5}
    .app:not(.pub) .sub-top .btn{flex:none;margin:calc((21px - var(--d-ctl-sm)) / 2) -10px calc((21px - var(--d-ctl-sm)) / 2) 0}   /* centred on the name line */
    /* "Mark unread" has no icon in the markup: the unread dot, so both labels line up the same */
    .app:not(.pub) .sub-top .btn:not(:has(svg))::before{content:"";flex:none;width:15px;height:15px;background:radial-gradient(circle,currentColor 3px,transparent 3.5px)}
    .app:not(.pub) .sub-contact-row{gap:8px 10px;margin:6px 0 0;font-size:13.5px}
    .app:not(.pub) .email-inline{min-width:0;max-width:100%;text-align:left;color:var(--d-ink-2);text-decoration-color:var(--d-line-3);text-underline-offset:3px;overflow-wrap:anywhere}
    @media (hover:hover){ .app:not(.pub) .email-inline:hover{color:var(--d-ink);text-decoration-color:currentColor} }
    .app:not(.pub) .copied-tag{color:var(--d-pos);font-size:12px}
    .app:not(.pub) .sub-card > p{max-width:72ch;margin:10px 0 8px;font-size:14.5px;line-height:1.6;color:var(--d-ink-2);white-space:pre-line;overflow-wrap:anywhere}
    .app:not(.pub) .sub-date{display:block;font-size:12.5px;color:var(--d-ink-4)}

    .app:not(.pub) .fld{gap:8px;min-width:0}
    .app:not(.pub) .fld > span:first-child{font-size:12.5px;letter-spacing:.04em;color:var(--d-ink-3)}
    .app:not(.pub) .fld span.hint{margin:0;font-size:12.5px;letter-spacing:0;line-height:1.45;color:var(--d-ink-4)}
    /* NEVER set "display" on .fld inputs: the hidden file input inside .photo-btn relies on the UA [hidden]{display:none},
       which any author "display" would override. :where() keeps the type guards out of the specificity, or this rule
       would outrank the :hover / :focus / 16px-on-phones rules below */
    .app:not(.pub) .fld :is(input:where(:not([type=file]):not([type=checkbox]):not([type=range])),select,textarea),
    .app:not(.pub) .sp-row input,.app:not(.pub) .splits-ed-row input,.app:not(.pub) .ar-song-row input,.app:not(.pub) .about-editor{
      width:100%;min-width:0;height:var(--d-field-h);padding:0 14px;border:1px solid var(--d-line-2);border-radius:var(--d-r-field);
      background-color:var(--d-field);color:var(--d-ink);font:400 15px/1.4 var(--d-body);
      transition:border-color var(--d-t-fast) ease,background-color var(--d-t-fast) ease,box-shadow var(--d-t-fast) ease}
    .app:not(.pub) .fld textarea,.app:not(.pub) .about-editor{height:auto;min-height:112px;padding:12px 14px;line-height:1.6;resize:vertical}
    .app:not(.pub) .about-editor{max-width:none;min-height:240px}
    .app:not(.pub) :is(.fld,.sp-row,.splits-ed-row,.ar-song-row) :is(input,select,textarea)::placeholder,.app:not(.pub) .about-editor::placeholder{color:var(--d-ph)}
    @media (hover:hover){
      .app:not(.pub) :is(.fld,.sp-row,.splits-ed-row,.ar-song-row) :is(input,select,textarea):hover:not(:focus),.app:not(.pub) .about-editor:hover:not(:focus){border-color:var(--d-line-3)}
    }
    .app:not(.pub) :is(.fld,.sp-row,.splits-ed-row,.ar-song-row) :is(input,select,textarea):focus,.app:not(.pub) .about-editor:focus{
      outline:none;border-color:#f5f5f5;background-color:var(--d-s2);box-shadow:0 0 0 3px rgba(255,255,255,.08)}
    .app:not(.pub) .fld select{-webkit-appearance:none;appearance:none;padding-right:40px;cursor:pointer;
      background-image:var(--d-chev);background-position:calc(100% - 20px) 50%,calc(100% - 15px) 50%;background-size:5px 5px,5px 5px;background-repeat:no-repeat}
    .app:not(.pub) input[type=number]{-moz-appearance:textfield;appearance:textfield}
    .app:not(.pub) input[type=number]::-webkit-inner-spin-button,.app:not(.pub) input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
    .app:not(.pub) input[type=date]::-webkit-calendar-picker-indicator{filter:invert(.75);cursor:pointer}
    .app:not(.pub) .fld input:-webkit-autofill{-webkit-text-fill-color:var(--d-ink);caret-color:var(--d-ink);box-shadow:0 0 0 100px var(--d-field) inset}
    @media (max-width:599px),(pointer:coarse){
      .app:not(.pub) :is(.fld,.sp-row,.splits-ed-row,.ar-song-row) :is(input,select,textarea),.app:not(.pub) .about-editor{font-size:16px}
    }
    /* form cards (Advance calculator, portal password) — left-aligned, no longer centred */
    .app:not(.pub) .form-card{margin:0 0 20px;padding:20px;gap:16px;background:var(--d-s1);border:1px solid var(--d-line-2);border-radius:var(--d-r-card)}
    .app:not(.pub) .form-card > .btn{align-self:flex-start}           /* "Add as prospect" no longer stretches */
    .app:not(.pub) .form-card ~ .cat-summary,.app:not(.pub) .form-card ~ .split-list{max-width:560px}   /* one 560px column on Advance */
    /* wide screens: the answer (result strip + ledgers) sits beside the form, so it stays in view while typing.
       Rows 1-3 = title, description, budget; the form spans 4-6 and the last row takes its extra height */
    @media (min-width:1280px){
      .app:not(.pub) div:has(> .form-card ~ .split-list){display:grid;grid-template-columns:560px minmax(0,440px);grid-template-rows:repeat(5,auto) 1fr;column-gap:24px;align-items:start}
      .app:not(.pub) div:has(> .form-card ~ .split-list) > *{grid-column:1}
      .app:not(.pub) div:has(> .form-card ~ .split-list) > .form-card{grid-row:4 / span 3}
      .app:not(.pub) div:has(> .form-card ~ .split-list) > .form-card ~ *{grid-column:2}
      /* rows pinned: auto-placement would start column 2 beside the budget strip */
      .app:not(.pub) div:has(> .form-card ~ .split-list) > .form-card + .cat-summary{grid-row:4;margin:0!important}   /* inline marginTop */
      .app:not(.pub) div:has(> .form-card ~ .split-list) > .form-card + .cat-summary + .split-list{grid-row:5}
      .app:not(.pub) div:has(> .form-card ~ .split-list) > .form-card + .cat-summary + .split-list + .split-list{grid-row:6}
      .app:not(.pub) div:has(> .form-card ~ .split-list) > .form-card + .cat-summary .cat-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
    }
    .app:not(.pub) .form-card .portal-block-head{flex-direction:row;justify-content:flex-end;align-items:center;gap:8px;margin:4px 0 0}  /* Cancel + Save together, right */
    /* checkbox rows */
    .app:not(.pub) .check-row{align-items:center;gap:12px;min-height:48px;padding:12px 14px;background:var(--d-s2);border:1px solid var(--d-line-2);border-radius:var(--d-r-field)}
    .app:not(.pub) .check-row input{margin:0;width:18px;height:18px;accent-color:#f5f5f5}
    .app:not(.pub) .check-row span{font-size:14px;color:var(--d-ink)}
    /* photo upload */
    .app:not(.pub) .photo-up{gap:16px}
    .app:not(.pub) .photo-prev{width:64px;height:64px;border:0;border-radius:var(--d-r-field);background:var(--d-s2);box-shadow:0 0 0 1px var(--d-line-2)}
    .app:not(.pub) .photo-prev-empty{color:var(--d-ink-4);font-size:11px}
    .app:not(.pub) .photo-actions{flex-wrap:wrap;gap:4px}
    .app:not(.pub) .photo-remove{height:var(--d-ctl-sm);padding:0 12px;border-radius:var(--d-r-md);color:var(--d-ink-3);font-size:13.5px;font-weight:500;text-decoration:none}
    @media (hover:hover){ .app:not(.pub) .photo-remove:hover{background:var(--d-active);color:var(--d-ink)} }
    /* Spotify auto-fill */
    .app:not(.pub) .sp-fill{gap:10px;padding:14px;background:var(--d-s2);border:1px solid var(--d-line-2);border-radius:var(--d-r-field)}
    .app:not(.pub) .fld-label{font-size:12.5px;letter-spacing:.04em;color:var(--d-ink-3)}
    .app:not(.pub) .sp-row input{height:var(--d-ctl)}
    .app:not(.pub) .sp-note{font-size:12.5px;line-height:1.45}
    .app:not(.pub) .sp-note.ok{color:var(--d-pos)}
    .app:not(.pub) .sp-note.err{padding:0;border:0;border-radius:0;background:none;color:var(--d-neg)}   /* was also caught by the boxed .err rule */
    /* splits editor */
    .app:not(.pub) .splits-ed{gap:8px;padding:14px;background:var(--d-s2);border:1px solid var(--d-line-2);border-radius:var(--d-r-field)}
    .app:not(.pub) .splits-ed-head{margin-bottom:4px;font:400 10px/1.2 var(--d-display);font-synthesis:none;letter-spacing:.14em;color:var(--d-ink-4)}
    .app:not(.pub) .splits-ed-row{grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) 92px var(--d-icon);gap:8px}
    .app:not(.pub) .splits-ed-row input{height:var(--d-ctl)}
    .app:not(.pub) .pct-in{gap:6px;font-size:13px;color:var(--d-ink-4)}
    .app:not(.pub) .pct-in input{flex:1 1 auto;width:100%;padding:0 10px;text-align:right}
    .app:not(.pub) .split-del{width:var(--d-icon);height:var(--d-icon);align-items:center;border-radius:var(--d-r-sm);color:var(--d-ink-4)}
    @media (hover:hover){ .app:not(.pub) .split-del:hover{color:var(--d-neg);background:var(--d-neg-bg)} }
    .app:not(.pub) .splits-ed > .btn{align-self:flex-start;margin-top:4px}
    .app:not(.pub) .split-hint{font-size:12.5px;color:var(--d-warn)}
    /* A&R prospect song rows: numbers right-aligned + CSS-only column headers (placeholders vanish once typed) */
    .app:not(.pub) .ar-song-row{position:relative;grid-template-columns:24px minmax(0,1fr) minmax(0,1fr);gap:8px;margin-bottom:0}
    .app:not(.pub) .ar-song-row + .ar-song-row{margin-top:-6px}
    .app:not(.pub) .modal-body > p.fld-label.mb{margin-bottom:0}
    .app:not(.pub) .ar-song-row input{height:var(--d-ctl);text-align:right}
    .app:not(.pub) .ar-song-num{font-size:12.5px;color:var(--d-ink-4)}
    .app:not(.pub) p.fld-label + .ar-song-row{margin-top:22px}
    .app:not(.pub) p.fld-label + .ar-song-row::before,.app:not(.pub) p.fld-label + .ar-song-row::after{position:absolute;top:-20px;
      font:600 11px/1 var(--d-body);letter-spacing:.06em;text-transform:uppercase;color:var(--d-ink-4)}
    .app:not(.pub) p.fld-label + .ar-song-row::before{content:"Gross streams";right:calc(50% + 2px)}
    .app:not(.pub) p.fld-label + .ar-song-row::after{content:"Writer %";right:14px}

    .app:not(.pub) .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:var(--d-ctl);padding:0 18px;
      border:1px solid #f5f5f5;border-radius:100px;background:#f5f5f5;color:#000;font:600 14px/1 var(--d-body);white-space:nowrap;text-decoration:none;opacity:1;cursor:pointer;
      transition:background-color var(--d-t-fast) ease,border-color var(--d-t-fast) ease,color var(--d-t-fast) ease,transform var(--d-t-press) ease}
    .app:not(.pub) .btn.sm{height:var(--d-ctl-sm);padding:0 14px;gap:6px;font-size:13.5px}
    .app:not(.pub) .btn svg{flex:none;width:15px;height:15px}
    @media (hover:hover){ .app:not(.pub) .btn:hover{background:#fff;border-color:#fff;opacity:1} }
    .app:not(.pub) .btn:active{transform:scale(.97)}
    .app:not(.pub) .btn:disabled{opacity:.45;cursor:not-allowed;transform:none}
    /* secondary: .btn.ghost, plus the Auto-fill button so a modal never has two white pills */
    .app:not(.pub) :is(.btn.ghost,.sp-fill .btn){background:transparent;border-color:var(--d-line-3);color:var(--d-ink)}
    @media (hover:hover){ .app:not(.pub) :is(.btn.ghost,.sp-fill .btn):hover{background:var(--d-hover);border-color:#f5f5f5} }
    .app:not(.pub) .sp-fill .btn{height:var(--d-ctl)}   /* same height as the link field beside it */
    /* disabled primary: a flat grey pill (45% white read as "pressed") */
    .app:not(.pub) .btn:not(.ghost):disabled{background:var(--d-s3);border-color:var(--d-line-2);color:var(--d-ink-4);opacity:1}
    /* quiet: outbound links (Open in sheet / Folder / Portfolio A/B), Mark read/unread */
    .app:not(.pub) :is(.overview-links a.btn,.admin-head a.btn,.sub-top .btn){padding:0 10px;border-color:transparent;border-radius:var(--d-r-md);background:transparent;color:var(--d-ink-3)}
    @media (hover:hover){ .app:not(.pub) :is(.overview-links a.btn,.admin-head a.btn,.sub-top .btn):hover{background:var(--d-active);border-color:transparent;color:var(--d-ink)} }
    /* destructive: Delete prospect (.btn.err-text) and the song window's Delete ([data-del]). The song window's
       first button (This isn't ours for staff) is pushed left but stays a plain ghost: its red is in its confirm */
    .app:not(.pub) .song-detail .modal-foot .btn:first-child{margin-right:auto}
    .app:not(.pub) .modal-foot .btn.err-text{margin-right:auto}
    .app:not(.pub) :is(.modal-foot .btn.err-text,.song-detail .modal-foot .btn[data-del]){border-color:var(--d-neg-line);color:var(--d-neg)}
    @media (hover:hover){ .app:not(.pub) :is(.modal-foot .btn.err-text,.song-detail .modal-foot .btn[data-del]):hover{background:var(--d-neg-bg);border-color:var(--d-neg)} }
    /* Advance "Advance given?" Yes/No = a selected toggle, not two primary pills */
    .app:not(.pub) .ar-given-row{gap:6px}
    .app:not(.pub) .ar-given-row .fld-label{margin-right:6px}
    .app:not(.pub) .ar-given-row .btn{min-width:56px}
    .app:not(.pub) .ar-given-row .btn:not(.ghost){background:var(--d-active);border-color:var(--d-line-3);color:var(--d-ink)}
    .app:not(.pub) .ar-given-row .btn.ghost{border-color:var(--d-line-2);color:var(--d-ink-2)}   /* an unpicked choice still looks like a button */
    /* chips (public .chip-tag shape; copied, not shared) */
    .app:not(.pub) :is(.tag,.badge-yes,.badge-no){display:inline-flex;align-items:center;gap:6px;height:22px;max-width:100%;padding:0 9px;vertical-align:middle;
      border:1px solid #262628;border-radius:100px;background:var(--d-s3);color:var(--d-ink-2);
      font:400 9.5px/1 var(--d-display);font-synthesis:none;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .app:not(.pub) .sub-contact-row .tag{font:500 12.5px/1 var(--d-body);letter-spacing:0;text-transform:none}   /* a typed @handle stays body font */
    .app:not(.pub) .badge-yes{color:var(--d-pos);background:var(--d-pos-bg);border-color:var(--d-pos-line)}
    .app:not(.pub) .badge-yes svg{display:none}
    .app:not(.pub) .badge-yes::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:currentColor}
    .app:not(.pub) .badge-no{color:var(--d-ink-4);background:transparent;border-color:var(--d-line-2)}
    /* tone hooks (J7 adds data-tone; neutral = the default above) */
    .app:not(.pub) [data-tone=pos]{color:var(--d-pos);background:var(--d-pos-bg);border-color:var(--d-pos-line)}
    .app:not(.pub) [data-tone=warn]{color:var(--d-warn);background:var(--d-warn-bg);border-color:var(--d-warn-line)}
    .app:not(.pub) [data-tone=neg]{color:var(--d-neg);background:var(--d-neg-bg);border-color:var(--d-neg-line)}
    .app:not(.pub) [data-tone=info]{color:var(--d-info);background:var(--d-info-bg);border-color:var(--d-info-line)}
    .app:not(.pub) [data-tone=muted]{color:var(--d-ink-4);background:transparent;border-color:var(--d-line-2)}
    .app:not(.pub) [data-tone=neutral]{color:var(--d-ink-2);background:var(--d-s3);border-color:#262628}
    /* border-width/style only: a "border" shorthand here would reset the tone's border-color */
    .app:not(.pub) .cat-stat-val[data-tone]{align-self:flex-start;display:inline-flex;align-items:center;min-height:26px;padding:2px 10px;border-width:1px;border-style:solid;border-radius:100px;font-size:13px;line-height:1.25}
    /* split totals as chips (editor head + detail total) */
    .app:not(.pub) :is(.splits-ed-head,.split-list-total) :is(.split-ok,.split-warn){display:inline-flex;align-items:center;height:22px;padding:0 9px;border:1px solid;border-radius:100px;
      font:600 12px/1 var(--d-body);letter-spacing:0;font-variant-numeric:tabular-nums}
    .app:not(.pub) .split-ok{color:var(--d-pos)}
    .app:not(.pub) .split-warn{color:var(--d-warn)}
    .app:not(.pub) :is(.splits-ed-head,.split-list-total) .split-ok{background:var(--d-pos-bg);border-color:var(--d-pos-line)}
    .app:not(.pub) :is(.splits-ed-head,.split-list-total) .split-warn{background:var(--d-warn-bg);border-color:var(--d-warn-line)}

    .app:not(.pub) .modal{align-items:center;padding:24px;overflow:hidden;overscroll-behavior:contain;background:var(--d-overlay);
      -webkit-backdrop-filter:none;backdrop-filter:none;animation:fadeIn .16s ease both}
    @media (hover:hover){ .app:not(.pub) .modal{-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)} }
    html:has(.app:not(.pub) .modal){overflow:hidden}
    .app:not(.pub) .modal-card{display:flex;flex-direction:column;max-width:520px;max-height:calc(100vh - 48px);max-height:calc(100dvh - 48px);overflow:hidden;
      background:var(--d-s1);border:1px solid var(--d-line-2);border-radius:var(--d-r-modal);box-shadow:var(--d-shadow-pop);
      animation:popIn var(--d-t-open) var(--ease-out) backwards}   /* backwards: no transform left once open (it would cut fixed things inside) */
    .app:not(.pub) .modal-card.song-detail{max-width:440px}
    /* the sticky app banner (z 400) sits over the overlay: start the card below it (phone sheets: see the 599px block) */
    @media (min-width:600px){
      .app:not(.pub):has(> .storage-warn) .modal:not(.crop-overlay){padding-top:calc(var(--d-ban-h) + 24px)}
      .app:not(.pub):has(> .storage-warn) .modal-card{max-height:calc(100vh - var(--d-ban-h) - 48px);max-height:calc(100dvh - var(--d-ban-h) - 48px)}
    }
    .app:not(.pub) .modal-head{flex:none;min-height:60px;gap:12px;padding:12px 12px 12px 22px;border-bottom:1px solid var(--d-line)}
    /* up to 2 lines: the song detail is the only place a long title shows in full (tiles clamp too) */
    .app:not(.pub) .modal-head h3{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;white-space:normal;overflow-wrap:anywhere;
      font-size:17px;font-weight:600;line-height:1.3;letter-spacing:-.01em}
    .app:not(.pub) .modal-head button{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:0;border-radius:var(--d-r-md);color:var(--d-ink-4)}
    @media (hover:hover){ .app:not(.pub) .modal-head button:hover{background:var(--d-active);color:var(--d-ink)} }
    @media (pointer:coarse){ .app:not(.pub) .modal-head button{width:44px;height:44px} }
    .app:not(.pub) .modal-body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;gap:16px;padding:20px 22px}
    .app:not(.pub) .modal-foot{flex:none;align-items:center;gap:8px;padding:14px 22px;border-top:1px solid var(--d-line);background:var(--d-s1)}
    .app:not(.pub) .modal-foot .btn{height:var(--d-ctl)}
    /* crop (stays centred on every size). It never runs past the screen: on a short one the picture area scrolls
       and Cancel / Use photo stay in view (phones held sideways get the side-by-side layout below) */
    .app:not(.pub) .modal.crop-overlay{padding:12px}
    .app:not(.pub):has(> .storage-warn) .modal.crop-overlay{padding-top:calc(var(--d-ban-h) + 12px)}
    .app:not(.pub) .crop-card{display:flex;flex-direction:column;max-width:380px;max-height:100%;background:var(--d-s1);border:1px solid var(--d-line-2);box-shadow:var(--d-shadow-pop);
      animation:popIn var(--d-t-open) var(--ease-out) backwards}
    .app:not(.pub) .crop-card > :is(.modal-head,.modal-foot){flex:none}
    .app:not(.pub) .crop-body{flex:1 1 auto;min-height:0;align-items:center;align-items:safe center;padding:20px 16px;overflow-y:auto;overscroll-behavior:contain}
    .app:not(.pub) .crop-body > *{flex:none}   /* the 300px square never squashes (the crop maths assume it) */
    /* short and wide (a phone held sideways, a short window): the square on the left, zoom and buttons beside it.
       The overlay scrolls only if even that doesn't fit */
    .app:not(.pub) .modal.crop-overlay{align-items:safe center;overflow-y:auto}
    @media (max-height:599px) and (min-width:600px){
      .app:not(.pub) .crop-card{display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-rows:auto auto 1fr auto;max-width:600px}
      .app:not(.pub) .crop-body{display:contents}
      .app:not(.pub) .crop-view{grid-column:1;grid-row:1 / -1;margin:12px}
      .app:not(.pub) .crop-card > .modal-head{grid-column:2;grid-row:1}
      .app:not(.pub) .crop-card .crop-zoom{grid-column:2;grid-row:2;width:auto;margin:20px 20px 0}
      .app:not(.pub) .crop-hint{grid-column:2;grid-row:3;margin:12px 20px;text-align:left}
      .app:not(.pub) .crop-card > .modal-foot{grid-column:2;grid-row:4;border-top:0}
    }
    .app:not(.pub) .crop-zoom{width:300px;max-width:100%;margin-inline:auto}   /* edges line up with the 300px image */
    .app:not(.pub) .crop-zoom span{font:400 10px/1 var(--d-display);font-synthesis:none;letter-spacing:.14em;color:var(--d-ink-4)}
    .app:not(.pub) .crop-zoom input[type=range]{accent-color:#f5f5f5}
    .app:not(.pub) .crop-hint{font-size:12.5px;color:var(--d-ink-4)}
    /* song detail */
    .app:not(.pub) .song-detail-top{gap:16px;margin:0 0 4px}
    .app:not(.pub) .song-detail-cover{width:88px;height:88px;border:0;border-radius:var(--d-r-field);box-shadow:0 0 0 1px var(--d-line-2)}
    .app:not(.pub) .song-detail-artist{font-size:16px;font-weight:600}
    .app:not(.pub) .song-detail-date{font-size:13px;color:var(--d-ink-3)}
    .app:not(.pub) .song-detail-top a.inline-link{display:inline-flex;align-items:center;height:var(--d-ctl-sm);margin-left:-10px;padding:0 10px;border-radius:var(--d-r-md);
      color:var(--d-ink-3);font-size:13.5px;font-weight:500;text-decoration:none}
    @media (hover:hover){ .app:not(.pub) .song-detail-top a.inline-link:hover{background:var(--d-active);color:var(--d-ink)} }
    .app:not(.pub) .split-list{margin:0;border-top:1px solid var(--d-line)}
    .app:not(.pub) .split-list-row{min-height:44px;gap:12px;padding:8px 0;border-bottom:1px solid var(--d-line);font-size:14px}
    .app:not(.pub) .split-name{min-width:0;overflow-wrap:anywhere}
    .app:not(.pub) .split-name em{color:var(--d-ink-4)}
    .app:not(.pub) .split-pct{color:var(--d-ink-2)}
    .app:not(.pub) .split-list-total{font-weight:600;color:var(--d-ink)}
    .app:not(.pub) .split-list-row:last-child{border-bottom:0}
    .app:not(.pub) .split-list + .split-list{margin-top:16px}
    .app:not(.pub) .split-list > p.hint{margin:8px 0 0}
    /* Advance ledgers reuse .split-list: give them a card */
    .app:not(.pub) .form-card ~ .split-list{padding:0 16px;background:var(--d-s1);border:1px solid var(--d-line-2);border-radius:var(--d-r-card)}
    .app:not(.pub) .form-card ~ .split-list .split-list-row:last-child{border-bottom:0}

    /* App-level banner. Shared class: style ONLY the dashboard/portal copy (direct child of the root). */
    .app:not(.pub) > .storage-warn{display:flex;align-items:center;justify-content:center;gap:10px;min-height:var(--d-ban-h);padding:10px 20px;
      background:var(--d-ban-neg-bg);border-bottom:1px solid var(--d-ban-neg-line);color:var(--d-ban-neg-ink);font-size:13.5px;line-height:1.45;text-align:center}
    .app:not(.pub) > .storage-warn > span{min-width:0}   /* the message and its link: one run of text beside the icon */
    .app:not(.pub) > .storage-warn a{white-space:nowrap}
    .app:not(.pub) > .storage-warn::before,.app:not(.pub) p.hint.err-text::before{content:"";flex:none;width:16px;height:16px;background:currentColor;
      -webkit-mask:var(--d-ic-alert) center/contain no-repeat;mask:var(--d-ic-alert) center/contain no-repeat}
    /* every in-page error line (.hint.err-text) becomes an inline banner: sync errors, missing tab, push warning,
       delete warnings, A&R load error, prospect/advance/password errors */
    .app:not(.pub) p.hint.err-text{display:flex;align-items:flex-start;gap:10px;max-width:80ch;margin:0 0 16px;padding:12px 14px;
      background:var(--d-ban-neg-bg);border:1px solid var(--d-ban-neg-line);border-radius:var(--d-r-field);color:var(--d-ban-neg-ink);font-size:13.5px;line-height:1.5}
    .app:not(.pub) p.hint.err-text::before{margin-top:2px}
    .app:not(.pub) .dash-main p.hint.err-text{max-width:none}   /* page banners run the width of the tables they sit over */
    /* A&R's "Try again": at the line's end, centred on its first line of text (wraps under it on a phone) */
    .app:not(.pub) p.hint.err-text:has(> .btn){flex-wrap:wrap;align-items:center;row-gap:8px}
    .app:not(.pub) p.hint.err-text:has(> .btn) > span{flex:1 1 240px;min-width:0}
    .app:not(.pub) p.hint.err-text > .btn{flex:none;margin:-6px -4px -6px 0}
    .app:not(.pub) p.hint.err-text.overview-subhint{margin:0 0 16px}
    .app:not(.pub) .portal-block-head p.hint.err-text{margin:10px 0 0}
    .app:not(.pub) :is(.modal-body,.form-card) > p.hint.err-text{margin:0}
    .app:not(.pub) .modal-body > p.hint.err-text:first-child{position:sticky;top:-20px;z-index:2;flex:none;box-shadow:0 0 0 8px var(--d-s1)}   /* sticky insets by the body's padding */
    .app:not(.pub) .catalog-clients p.hint.err-text{margin:4px 0;padding:10px 12px;font-size:12.5px}
    .app:not(.pub) p.hint.err-text.modal-save-warn{flex:none;margin:0 22px 14px}
    /* the staff "no split > 0" notice is a warning, not an error (form errors in that slot carry role=alert) */
    .app:not(.pub) p.hint.err-text.modal-save-warn:not([role=alert]){padding:8px 12px;background:var(--d-ban-warn-bg);border-color:var(--d-ban-warn-line);color:var(--d-ban-warn-ink);
      font-size:12.5px;line-height:1.4}   /* compact: it shows on every new song, and the splits box says the same */
    /* empty states (text unchanged) */
    .app:not(.pub) .admin-empty,.app:not(.pub) .portal-block-head ~ p.muted{display:flex;flex-direction:column;align-items:center;gap:12px;margin:0;padding:40px 24px;
      text-align:center;font-size:14px;line-height:1.5;color:var(--d-ink-3)}
    .app:not(.pub) .admin-empty::before,.app:not(.pub) .portal-block-head ~ p.muted::before{content:"";width:40px;height:40px;border:1px solid var(--d-line-2);border-radius:50%;
      background:var(--d-s2) var(--d-ic-empty) center/18px no-repeat}
    .app:not(.pub) .portal-block-head ~ p.muted{border:1px dashed var(--d-line-2);border-radius:var(--d-r-card)}
    .app:not(.pub) .portal-block-head ~ p.muted::before{background-image:var(--d-ic-disc)}   /* no songs: a disc, not the inbox tray */
    .app:not(.pub) .admin-head ~ .admin-empty{background:var(--d-s1);border:1px solid var(--d-line-2);border-radius:var(--d-r-card)}  /* Messages / Outreach empty (outside a table) */
    /* first-load "Loading…" (p.muted.page, text frozen): centred spinner + micro-label, only after 300ms */
    .app:not(.pub) .view > p.muted.page{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;max-width:none;min-height:60vh;min-height:60dvh;margin:0;padding:24px;
      font:400 10.5px/1 var(--d-display);font-synthesis:none;letter-spacing:.18em;text-transform:uppercase;color:var(--d-ink-4);animation:fadeIn .2s .3s both}
    .app:not(.pub) .view > p.muted.page::before{content:"";width:20px;height:20px;border:2px solid var(--d-line-3);border-top-color:#f5f5f5;border-radius:50%;animation:spin 1s linear infinite}
    .app:not(.pub) > .storage-warn ~ .view > p.muted.page{display:none}   /* load failed: the banner says so, nothing is still coming */
    /* in-tab loading lines: A&R "Loading…" (.dash-wait: it has no sub-nav above it now), Advance and Overview "Loading master sheet data…" */
    .app:not(.pub) :is(:is(.subnav,.overview-subhint) ~ p.muted,p.muted.dash-wait){display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 16px;font-size:13.5px;color:var(--d-ink-4);animation:fadeIn .2s .3s both}
    .app:not(.pub) :is(:is(.subnav,.overview-subhint) ~ p.muted,p.muted.dash-wait)::before{content:"";flex:none;width:14px;height:14px;border:2px solid var(--d-line-3);border-top-color:#f5f5f5;border-radius:50%;animation:spin 1s linear infinite}
    .app:not(.pub) :is(:is(.subnav,.overview-subhint) ~ p.muted,p.muted.dash-wait)::after{content:"";flex:0 0 100%;height:240px;margin-top:6px;border-radius:var(--d-r-card);
      background:linear-gradient(100deg,#0c0c0d 40%,#18181a 50%,#0c0c0d 60%) 0 0/200% 100%;animation:shimmer 1.4s linear infinite}
    /* motion: dashboard/portal had no reduced-motion handling at all */
    @keyframes d-sheet-in{from{opacity:0;transform:translateY(24px)}}
    @media (prefers-reduced-motion:reduce){
      .app:not(.pub) *,.app:not(.pub) *::before,.app:not(.pub) *::after{animation-duration:.01ms!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:.01ms!important}
      .app:not(.pub) :is(:is(.subnav,.overview-subhint) ~ p.muted,p.muted.dash-wait)::after{background:var(--d-s2)}
    }

    .app:not(.pub) .portal{min-height:100vh;min-height:100dvh}
    .app:not(.pub) .portal-nav{height:60px;padding:0 max(16px,calc(50% - 488px));background:rgba(0,0,0,.88);
      -webkit-backdrop-filter:blur(20px) saturate(1.3);backdrop-filter:blur(20px) saturate(1.3);border-bottom:1px solid rgba(255,255,255,.07)}
    .app:not(.pub):has(> .storage-warn) .portal-nav{top:var(--d-ban-h)}
    .app:not(.pub) .portal-who{min-width:0;gap:12px;font-size:14px}
    .app:not(.pub) .portal-who span{min-width:0;color:var(--d-ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .app:not(.pub) .portal-who button{flex:none;height:var(--d-ctl-sm);padding:0 14px;gap:8px;border:1px solid var(--d-line-3);border-radius:100px;background:transparent;color:var(--d-ink);font-size:13.5px;font-weight:500}
    @media (hover:hover){ .app:not(.pub) .portal-who button:hover{border-color:#f5f5f5;background:var(--d-hover)} }
    .app:not(.pub) .portal-main{max-width:1024px;padding:40px 24px 80px}
    .app:not(.pub) .portal-role{margin:0 0 10px;font:400 11px/1.3 var(--d-display);font-synthesis:none;letter-spacing:.18em;text-transform:uppercase;color:var(--d-ink-4)}
    .app:not(.pub) .portal-title{margin:0 0 32px;padding:0;font:400 clamp(28px,6vw,44px)/1.1 var(--d-display);font-synthesis:none;letter-spacing:.02em;text-transform:uppercase;overflow-wrap:anywhere;
      color:var(--d-ink);background:var(--chrome);background-size:100% 1.1em;background-repeat:repeat-y;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
    .app:not(.pub) .portal-block{margin:0 0 48px}
    /* the Password block is the last child of .portal-main (ClientPortal 3265) */
    .app:not(.pub) .portal-main > .portal-block:last-child{padding:20px;background:var(--d-s1);border:1px solid var(--d-line-2);border-radius:var(--d-r-card)}
    .app:not(.pub) .portal-main > .portal-block:last-child > .portal-block-head{align-items:center;margin:0}
    .app:not(.pub) .portal-main > .portal-block:last-child .form-card{max-width:440px;margin:16px 0 0;padding:0;background:none;border:0}

    @media (max-width:1199px){
      /* client list becomes a horizontal chip scroller (also on tablets, so the song grid keeps its width) */
      .app:not(.pub) .catalog-wrap{grid-template-columns:minmax(0,1fr);gap:20px}
      .app:not(.pub) .catalog-clients{position:static;flex-direction:row;flex-wrap:nowrap;align-items:flex-start;gap:4px;max-height:none;padding:6px;overflow-x:auto;scroll-snap-type:x proximity;scrollbar-width:none}
      .app:not(.pub) .catalog-clients > *{flex:none;scroll-snap-align:start}
      .app:not(.pub) .catalog-clients .cc{flex-direction:column;justify-content:flex-start;gap:6px;width:76px;min-width:76px;height:auto;min-height:0;padding:8px 4px;text-align:center;background:none;box-shadow:none}
      .app:not(.pub) .catalog-clients .cc .avatar{width:44px!important;height:44px!important;font-size:17px!important;border-radius:50%}  /* Avatar sizes are inline styles */
      .app:not(.pub) .catalog-clients .cc-overview-ic{width:44px;height:44px}
      .app:not(.pub) .catalog-clients .cc-name{flex:none;width:100%;font-size:11.5px;color:var(--d-ink-3)}
      .app:not(.pub) .catalog-clients .cc.active .cc-name{color:var(--d-ink)}
      .app:not(.pub) .catalog-clients .cc.active :is(.avatar,.cc-overview-ic){box-shadow:0 0 0 2px var(--d-s1),0 0 0 4px #f5f5f5}
      .app:not(.pub) .catalog-clients .cc-count{display:none}
      .app:not(.pub) .catalog-clients .cc-add{height:auto;margin:0;border:0;font-size:11.5px}
      .app:not(.pub) .catalog-clients .cc-add svg{width:44px;height:44px;padding:13px;border:1px dashed var(--d-line-3);border-radius:50%}
      .app:not(.pub) .cc-row{align-items:flex-start}
      .app:not(.pub) .catalog-clients p.hint.err-text{order:-1;flex:0 0 min(320px,calc(100% - 12px));white-space:normal}
    }
    @media (max-width:899px){
      /* top bar (static) */
      .app:not(.pub) .dash{flex-direction:column}
      .app:not(.pub) .dash-side,.app:not(.pub):has(> .storage-warn) .dash-side{position:static;top:auto;width:auto;height:auto;flex-direction:row;align-items:center;justify-content:space-between;
        align-self:stretch;gap:12px;padding:10px 16px;background:var(--d-bg);border-right:0;border-bottom:1px solid var(--d-line)}
      .app:not(.pub) .dash-brand{width:auto;padding:0}
      .app:not(.pub) .dash-side-foot{flex-direction:row;align-items:center;margin:0;padding:0;border:0}
      .app:not(.pub) .dash-role{display:none}
      .app:not(.pub) .dash-out{width:auto;height:var(--d-ctl-sm);padding:0 14px;gap:8px;border:1px solid var(--d-line-3);border-radius:100px;color:var(--d-ink);font-size:13.5px}
      /* bottom tab bar = the existing nav, fixed. No transform/filter/backdrop-filter may sit on ANY ancestor (.dash-side, .dash, .view, .app) */
      .app:not(.pub) .dash-side nav{position:fixed;left:0;right:0;bottom:0;z-index:40;display:grid;grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:0;
        height:calc(var(--d-tab-h) + env(safe-area-inset-bottom));padding:0 4px env(safe-area-inset-bottom);overflow:visible;
        background:rgba(0,0,0,.88);-webkit-backdrop-filter:blur(20px) saturate(1.3);backdrop-filter:blur(20px) saturate(1.3);border-top:1px solid rgba(255,255,255,.07)}
      .app:not(.pub) .dash-side nav button{position:relative;flex-direction:column;justify-content:center;gap:4px;height:var(--d-tab-h);padding:0 2px;border-radius:0;background:none;color:var(--d-ink-4)}
      .app:not(.pub) .dash-side nav button .nav-label{display:block;flex:none;max-width:100%;font-size:11px;font-weight:500;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .app:not(.pub) .dash-side nav button svg{width:22px;height:22px}
      .app:not(.pub) .dash-side nav button.active{background:none;color:var(--d-ink)}
      .app:not(.pub) .dash-side nav .nav-badge{position:absolute;top:8px;left:calc(50% + 6px)}
      .app:not(.pub) .dash-side nav button:focus-visible{outline-offset:-4px;border-radius:var(--d-r-md)}
      .app:not(.pub) .dash-main{padding:20px 16px calc(var(--d-tab-h) + 24px + env(safe-area-inset-bottom))}
      html:has(.app:not(.pub) .dash){scroll-padding-bottom:calc(var(--d-tab-h) + 16px + env(safe-area-inset-bottom))}
      .app:not(.pub):has(.dash) .toast-wrap{bottom:calc(var(--d-tab-h) + 16px + env(safe-area-inset-bottom))}   /* for phase-2 toasts */
      /* headers */
      .app:not(.pub) .admin-head{align-items:flex-start}
      /* sub-nav: an edge-to-edge chip row; the chip cut (and faded) by the screen edge says "scroll" */
      .app:not(.pub) .subnav{display:flex;gap:6px;max-width:none;margin:0 -16px 20px;padding:0 16px;border:0;border-radius:0;scroll-padding-inline:16px;
        -webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 20px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 20px),transparent)}
      .app:not(.pub) .subpill{padding:0 14px;border-color:var(--d-line-2);letter-spacing:.12em}
      .app:not(.pub) .subpill.active{border-color:var(--d-line-3)}
      .app:not(.pub) .subpill:focus-visible{outline-offset:-4px}   /* the row has no vertical padding to show an outside ring */
      /* quiet links that start a line: text on the 16px gutter, not their padding */
      .app:not(.pub) .admin-head > a.btn,.app:not(.pub) .admin-head > div > a.btn:first-child{margin-left:-10px}
      .app:not(.pub) .about-editor{min-height:320px}
      /* tables -> list rows: line 1 = name (+ actions / status), line 2 = the other columns joined by "·" */
      .app:not(.pub) .admin-table .admin-hd{display:none}
      .app:not(.pub) .admin-table .admin-row:not(.admin-hd){display:flex;flex-wrap:wrap;align-items:center;column-gap:8px;row-gap:0;min-height:60px;padding:8px 8px 10px 14px}
      .app:not(.pub) .admin-row:not(.admin-hd) > .cell{display:block;order:3;flex:0 1 auto;min-width:0;max-width:100%;font-size:13px;line-height:20px;color:var(--d-ink-3)}
      .app:not(.pub) .admin-row:not(.admin-hd) > .cell:first-child{order:0;flex:1 1 0;font-size:15px;line-height:24px;font-weight:500;color:var(--d-ink)}
      .app:not(.pub) .admin-row:not(.admin-hd) > .admin-act{order:1;flex:none}
      .app:not(.pub) .admin-row:not(.admin-hd)::after{content:"";order:2;flex-basis:100%;height:0}
      .app:not(.pub) .admin-row:not(.admin-hd) > .cell:nth-child(n+3)::before{content:"·";margin-right:8px;color:var(--d-ink-off)}
      .app:not(.pub) .admin-row:has(.cell-name) > .cell:nth-child(2){margin-left:42px}
      /* line 2 stays one line (no "·" orphaned onto a third): the last column takes what's left and ellipsizes;
         on Roster that's the credit, so the Live/Hidden chip lines up on the right */
      .app:not(.pub) .admin-row:not(.admin-hd):not(.admin-row-link) > .cell:not(:first-child){max-width:70%}
      .app:not(.pub) .admin-row:not(.admin-hd):not(.admin-row-link) > .cell:nth-last-child(2){flex:1 1 0;max-width:none}
      .app:not(.pub) .admin-row:not(.admin-hd):not(.admin-row-link):has(.badge-yes,.badge-no) > .cell:nth-last-child(2){flex:none}
      .app:not(.pub) .admin-row:not(.admin-hd):not(.admin-row-link):has(.badge-yes,.badge-no) > .cell:nth-last-child(2)::before{content:none}
      .app:not(.pub) .admin-row:not(.admin-hd):not(.admin-row-link):has(.badge-yes,.badge-no) > .cell:nth-last-child(3){flex:1 1 0;max-width:none}
      /* Notable: thumb + song on line 1 */
      .app:not(.pub) .admin-row:has(.rel-thumb) > .cell:first-child{flex:none}
      .app:not(.pub) .admin-row:has(.rel-thumb) > .cell:nth-child(2){order:0;flex:1 1 0;margin-left:0;font-size:15px;line-height:24px;font-weight:500;color:var(--d-ink)}
      .app:not(.pub) .admin-row:has(.rel-thumb) > .cell:nth-child(3){margin-left:44px}
      .app:not(.pub) .admin-row:has(.rel-thumb) > .cell:nth-child(3)::before{content:none}
      /* Outreach: name + status chip on line 1; contact · Net · revenue on line 2 (gross + songs hidden) */
      .app:not(.pub) .admin-row.admin-row-link > .cell:nth-child(7){order:1;flex:none}
      .app:not(.pub) .admin-row.admin-row-link > .cell:nth-child(7)::before{content:none}
      .app:not(.pub) .admin-row.admin-row-link > .cell:nth-child(3),.app:not(.pub) .admin-row.admin-row-link > .cell:nth-child(6){display:none}
      .app:not(.pub) .admin-row.admin-row-link > .cell:nth-child(4)::before{content:"· Net ";margin-right:2px}
      .app:not(.pub) .admin-row.admin-row-link > .cell:nth-child(2){max-width:calc(100% - 210px)}   /* a long contact ellipsizes instead of pushing Net down */
      /* modals: a centred card on tablets, as on desktop (a little wider); phones get bottom sheets (599px block) */
      .app:not(.pub) .modal-card{max-width:560px}
      .app:not(.pub) .modal-head{padding:10px 8px 10px 18px}
      .app:not(.pub) .modal-body{padding:18px 16px}
      .app:not(.pub) .modal-body > p.hint.err-text:first-child{top:-18px}
      .app:not(.pub) .modal-foot{padding:12px 16px}
      .app:not(.pub) p.hint.err-text.modal-save-warn{margin:0 16px 12px}
      /* messages */
      .app:not(.pub) .sub-card{padding:14px}
    }
    @media (max-width:599px){
      .app:not(.pub) .dash-main .admin-head h2{font-size:20px;background:none;-webkit-text-fill-color:currentColor;color:var(--d-ink)}  /* solid on phones: a wrapped chrome title bands badly */
      .app:not(.pub) .catalog-main .admin-head h2{font-size:14px}   /* second level stays second level (same specificity: after) */
      .app:not(.pub) .cat-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
      .app:not(.pub) .cat-stat:last-child:nth-child(odd){grid-column:1 / -1}
      /* one size: the full-width odd cell would otherwise scale its value up (11cqi) */
      .app:not(.pub) .cat-stat-val{font-size:17px}
      /* Overview: Sync Streams on its own row, the three quiet links together on the next */
      .app:not(.pub) .overview-links{display:grid;grid-template-columns:repeat(3,max-content);gap:4px}
      .app:not(.pub) .overview-links > :first-child{grid-column:1 / -1;justify-self:start}
      .app:not(.pub) .overview-links > :nth-child(2){margin-left:-10px}
      .app:not(.pub) .song-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 12px}
      /* modals -> bottom sheets (crop stays centred) */
      .app:not(.pub) .modal:not(.crop-overlay){align-items:flex-end;padding:0}
      .app:not(.pub) .modal:not(.crop-overlay) .modal-card{max-width:none;max-height:92vh;max-height:92dvh;border-bottom:0;border-radius:16px 16px 0 0;animation:d-sheet-in var(--d-t-sheet) var(--ease-out) backwards}
      /* under the app banner (which wraps to 2-3 lines here) the sheet starts lower */
      .app:not(.pub):has(> .storage-warn) .modal:not(.crop-overlay) .modal-card{max-height:calc(100vh - 96px);max-height:calc(100dvh - 96px)}
      .app:not(.pub) .modal:not(.crop-overlay) .modal-foot{padding-bottom:calc(12px + env(safe-area-inset-bottom))}
      .app:not(.pub):has(> .storage-warn) .modal.crop-overlay{padding-top:96px}
      .app:not(.pub) .modal-foot{flex-wrap:wrap}
      .app:not(.pub) .modal-foot .btn{flex:1 1 0;height:var(--d-ctl-lg)}
      .app:not(.pub) p.hint.err-text > .btn{margin-left:26px}   /* A&R's Try again wraps here: under the text, not the icon */
      /* Delete prospect = a full-width row under Cancel/Save, but quieter than them (not the biggest thumb target).
         Selector weight matches the destructive :is() rule above, so this one (later) wins */
      .app:not(.pub) .modal-card .modal-foot .btn.ghost.err-text{order:1;flex-basis:100%;height:var(--d-ctl);margin-right:0;border-color:transparent}
      .app:not(.pub) .splits-ed-row{grid-template-columns:minmax(0,1fr) 96px var(--d-icon)}
      .app:not(.pub) .splits-ed-row > input:first-child{grid-column:1 / -1}
      .app:not(.pub) .splits-ed-row input:nth-child(2){grid-column:auto}
      .app:not(.pub) .splits-ed-row + .splits-ed-row{margin-top:4px;padding-top:12px;border-top:1px solid var(--d-line)}
      .app:not(.pub) .form-card{padding:16px}
      .app:not(.pub) .portal-nav{height:56px}
      .app:not(.pub) .portal-main{padding:24px 16px 64px}
      .app:not(.pub) .portal-who span{max-width:40vw}
      .app:not(.pub) .portal-block-head{flex-direction:row;flex-wrap:wrap;align-items:flex-start}
      .app:not(.pub) .portal-block-head .btn{align-self:auto}
      .app:not(.pub) .song-detail-cover{width:72px;height:72px}
    }
    @media (pointer:coarse){
      .app:not(.pub) :is(.dash-brand,.portal-nav) .logo-link{min-height:44px;align-items:center}
      .app:not(.pub) .crop-zoom input[type=range]{height:44px}
      .app:not(.pub) .cc{min-height:44px}
      .app:not(.pub) .email-inline{padding:12px 0;margin:-12px 0}
    }

    /* ================================================================ */
    /*  PUBLIC SITE — "chrome catches light"                              */
    /* ================================================================ */
    :root{
      --line-2:#2a2a2c; --mut3:#a3a3a3; --hair:#161618;
      --chrome:linear-gradient(180deg,#ffffff 0%,#ececec 36%,#8f8f8f 50%,#f6f6f6 63%,#c4c4c4 100%);
      --chrome-border:linear-gradient(135deg,#fafafa,#6b6b6b 30%,#e9e9e9 50%,#4a4a4a 70%,#d8d8d8);
      /* arrivals/morphs/reveals · departures (always faster) · travelling light · wipes · springy text */
      --ease-out:cubic-bezier(.16,1,.3,1);
      --ease-exit:cubic-bezier(.4,0,1,1);
      --ease-light:cubic-bezier(.45,0,.55,1);
      --ease-wipe:cubic-bezier(.7,0,.2,1);
      --spring:cubic-bezier(.34,1.4,.64,1);
      --gutter:clamp(16px,4vw,56px);
      --nav-h:64px;
    }
    /* has to sit inside @supports: a custom property holding an unsupported
       linear() silently becomes "ease", not the cubic-bezier above */
    @supports (transition-timing-function:linear(0,1)){ :root{
      --spring:linear(0,0.034,0.118,0.232,0.358,0.485,0.604,0.71,0.801,0.876,0.935,0.979,1.01,1.031,1.043,1.049,1.05,1.047,1.042,1.036,1.03,1.024,1.018,1.013,1.009,1.005,1.002,1);
    } }
    @keyframes rv{from{opacity:0;translate:0 16px}}
    @keyframes rise{from{transform:translateY(112%) rotate(5deg)}}
    @keyframes sheen{from{translate:-120% 0}to{translate:120% 0}}
    @keyframes shimmer{to{background-position:-200% 0}}
    @keyframes draw{to{stroke-dashoffset:0}}
    @keyframes vt-out{to{opacity:0;transform:translateY(-10px)}}
    @keyframes vt-in{from{opacity:0;transform:translateY(18px)}}
    @keyframes vt-fade-out{to{opacity:0}}
    @keyframes vt-fade-in{from{opacity:0}}

    .pub{overflow-x:clip}
    .sr-only{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    /* opacity only: a transform (even a finished one) would make .view the containing block for the fixed panel and modals */
    .view-anim{animation:vt-fade-in .4s var(--ease-out) backwards}
    @media (prefers-reduced-motion:reduce){ .view-anim{animation:none} }

    /* film grain — barely there, but it makes flat #000 read as a printed/lit surface.
       Under the nav (50), menu (45) and artist panel (70), so those stay true black; lighter on OLED phones */
    .grain{position:fixed;inset:-120px;z-index:40;pointer-events:none;opacity:.04;view-transition-name:grain;
      background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 -2.4 1.55'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
      background-size:220px 220px}
    @media (hover:none){ .grain{opacity:.03} }
    @media (hover:hover) and (prefers-reduced-motion:no-preference){ .grain{animation:grain 1.1s steps(4) infinite} }
    @keyframes grain{0%{transform:translate(0,0)}25%{transform:translate(-40px,25px)}50%{transform:translate(30px,-35px)}75%{transform:translate(-15px,-20px)}100%{transform:translate(0,0)}}
    ::view-transition-group(grain){z-index:100}
    ::view-transition-old(grain){display:none}
    ::view-transition-new(grain){animation:none}

    /* scroll-reveal (shared IntersectionObserver sets [data-in]; --rv-delay staggers a batch) */
    [data-reveal]:not([data-reveal=split]){opacity:0;translate:0 26px}
    [data-reveal][data-in]:not([data-reveal=split]){opacity:1;translate:none;
      transition:opacity .7s var(--ease-out) var(--rv-delay,0ms),translate .85s var(--ease-out) var(--rv-delay,0ms)}

    /* headline words rising out of clipped slots */
    .split{font-family:'Suntage','Inter',sans-serif;font-weight:400;font-synthesis:none;letter-spacing:.02em;text-transform:uppercase;text-wrap:balance}
    .split .w{display:inline-block;overflow:hidden;overflow:clip;vertical-align:top;padding:.1em .04em .14em;margin:-.1em -.04em -.14em}
    .split .w>span{display:inline-block;transform-origin:0 100%;animation:rise .85s var(--spring) both;animation-delay:calc(var(--d,80ms) + var(--i,0) * 45ms)}
    .split[data-reveal] .w>span{animation-play-state:paused}
    .split[data-reveal][data-in] .w>span{animation-play-state:running}
    .split-chrome .w>span{background:var(--chrome);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
    .w-strike{position:relative}
    /* drawn by a clip-path wipe, not dashes: with non-scaling-stroke Chrome lays a pathLength dash out in
       screen pixels, which broke the line into two pieces */
    .strike{position:absolute;left:2%;right:2%;width:96%;top:40%;height:.3em;overflow:visible;pointer-events:none;
      clip-path:inset(-60% 100% -60% -6%);animation:strike-in .8s var(--ease-light) 1.05s forwards}
    .strike path{fill:none;stroke:#fff;stroke-width:max(3px,.07em);stroke-linecap:round;vector-effect:non-scaling-stroke;filter:drop-shadow(0 0 6px rgba(0,0,0,.6))}
    @keyframes strike-in{to{clip-path:inset(-60% -6% -60% -6%)}}


    /* pills (CTAs) — white pill gets one dark sheen pass on hover */
    .pill{position:relative;overflow:hidden;isolation:isolate;display:inline-flex;align-items:center;justify-content:center;gap:9px;height:48px;padding:0 26px;border-radius:100px;
      font-family:'Suntage','Inter',sans-serif;font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;text-decoration:none;white-space:nowrap;cursor:pointer;
      transition:transform .12s ease,border-color .2s ease,background-color .2s ease,color .2s ease;-webkit-tap-highlight-color:transparent}
    .pill-solid{background:#f5f5f5;color:#000;border:1px solid #f5f5f5}
    .pill-solid::after{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(110deg,transparent 30%,rgba(0,0,0,.16) 50%,transparent 70%);translate:-120% 0}
    .pill-solid:hover::after{animation:sheen .8s var(--ease-light)}
    .pill-ghost{background:rgba(0,0,0,.25);color:var(--ink);border:1px solid #3a3a3c}
    .pill-ghost:hover{border-color:#f5f5f5}
    .pill:active{transform:scale(.97)}
    .pill:disabled{opacity:.65;cursor:default;transform:none}
    .pill-full{width:100%}
    .pill:focus-visible,.hit:focus-visible,.nav2 a:focus-visible,.foot2 a:focus-visible{outline:1px solid #f5f5f5;outline-offset:3px}
    .hit{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;padding:0;background:none;border:0;color:var(--mut);cursor:pointer;text-decoration:none;transition:color .2s ease,background-color .2s ease}
    .hit:hover{color:var(--ink);background:#121214}
    .chip-tag{display:inline-block;font-style:normal;font-family:'Suntage','Inter',sans-serif;font-size:9.5px;line-height:1.2;letter-spacing:.12em;text-transform:uppercase;color:#ededed;background:#161618;border:1px solid #262628;border-radius:100px;padding:4px 8px;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
    /* a credit chip wraps onto a second line rather than ever cutting the producer's name */
    .rc-chips .chip-tag{white-space:normal;overflow:visible;overflow-wrap:anywhere;text-overflow:clip;text-align:left;line-height:1.35;border-radius:9px}
    .chip-tag-lg{font-size:10.5px;padding:6px 11px}
    .micro-label{margin:0;font-family:'Suntage','Inter',sans-serif;font-weight:400;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--mut)}

    /* marquee */
    /* clipped across but open above and below, so a cover lifting on hover isn't cut off by the rail */
    .mq{position:relative;overflow:hidden;overflow:clip visible}
    .mq-rail{display:flex;width:max-content;animation:mq var(--mq-dur,48s) linear infinite}
    /* paused while pressed (a mouse eases it to a stop in JS instead): touch screens keep :hover on the
       last thing tapped, so a hover pause would leave the rail frozen when the visitor comes back */
    .mq:active .mq-rail{animation-play-state:paused}
    .mq-track{display:flex;flex-shrink:0}
    .mq-item{position:relative;display:inline-flex;align-items:center;white-space:nowrap}
    .mq-link{display:inline-flex;align-items:center;color:inherit;text-decoration:none;-webkit-tap-highlight-color:transparent;transition:opacity .35s ease}
    .about2-band .mq-link{padding:10px 0;margin:-10px 0}
    .mq-sep{display:inline-flex;flex-shrink:0}
    .mq-sep img{display:block;width:auto;height:100%;transition:opacity .35s ease}
    /* one credit: the cover, the artist, then the song and the producer beside it */
    .cr-cov{position:relative;flex-shrink:0;display:block;overflow:hidden;border-radius:5px;background:#0c0c0d;transform-origin:100% 100%;
      transition:transform .55s var(--ease-out),box-shadow .55s var(--ease-out)}
    .cr-cov::after{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 1px rgba(255,255,255,.09)}
    .cr-cov::before{content:"";position:absolute;inset:0;z-index:1;background:linear-gradient(115deg,transparent 30%,rgba(255,255,255,.34) 50%,transparent 70%);translate:-120% 0;pointer-events:none}
    .cr-cov img{display:block;width:100%;height:100%;object-fit:cover}
    .cr-txt{display:inline-flex;min-width:0}
    .cr-artist{font-weight:400}
    .cr-sub{display:flex;transition:color .35s ease}
    .nobr{white-space:nowrap}
    .ph-fill{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
    .amp{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-weight:800}
    /* hover: the rail eases to a stop, the other credits step back, and this one's cover lifts up and away
       from its name (it grows from its bottom-right corner) while a light runs across it once */
    @media (hover:hover){
      .mq-rail:has(.mq-link:hover) .mq-link:not(:hover),.mq-rail:has(.mq-link:hover) .mq-sep img{opacity:.3}
      .mq-item:has(.mq-link:hover){z-index:2}
      .mq-link:hover .cr-cov{transform:var(--lift);box-shadow:0 24px 48px rgba(0,0,0,.8)}
      .mq-link:hover .cr-cov::before{translate:120% 0;transition:translate .9s var(--ease-light) .15s}
    }
    @keyframes mq{to{transform:translateX(calc(-100% / 3))}}

    /* image placeholders shimmer until the photo has decoded */
    .rc-cover,.pc-frame,.ap-photo{background:linear-gradient(100deg,#0c0c0d 40%,#18181a 50%,#0c0c0d 60%) 0 0/200% 100%;animation:shimmer 1.4s linear infinite}
    .rc-cover:has(.ph-in),.pc-frame:has(.ph-in),.ap-photo:has(.ph-in),.pc-frame:has(.pc-empty),.ap-photo:has(.ap-photo-empty),.rc-cover:has(.rc-empty){animation:none;background:#0c0c0d}

    /* ---------- nav ---------- */
    /* on wide screens the nav lines up with the 1248px content column instead of the screen edges */
    .nav2{position:sticky;top:0;z-index:50;height:var(--nav-h);display:flex;align-items:center;justify-content:space-between;padding:0 max(var(--gutter),calc(50% - 624px));view-transition-name:nav;transition:opacity .2s ease,background-color .3s ease,-webkit-backdrop-filter .3s ease,backdrop-filter .3s ease}
    /* frosted once scrolled, on the bar itself: in Chrome a backdrop-filter on anything inside the bar
       (its ::before included) never sees the page under it — it only darkened, so photos showed through sharp */
    .nav2.scrolled:not(.menu-open){background-color:rgba(0,0,0,.88);-webkit-backdrop-filter:blur(20px) saturate(1.3);backdrop-filter:blur(20px) saturate(1.3)}
    .nav2::before{content:"";position:absolute;inset:0;z-index:-1;border-bottom:1px solid rgba(255,255,255,.07);opacity:0;transition:opacity .25s ease}
    .nav2.scrolled::before{opacity:1}
    .nav2.menu-open::before{opacity:0}
    .app:has(.ap) .nav2{opacity:0;pointer-events:none}
    .nav2-mark{position:relative;display:block;line-height:0;padding:7px 6px;margin-left:-6px;-webkit-tap-highlight-color:transparent}
    .nav2-mark img{display:block;height:30px;width:auto}
    .nav2-mark-shine{position:absolute;inset:7px 6px;overflow:hidden;pointer-events:none;mix-blend-mode:plus-lighter;
      -webkit-mask:url(/brand/d-mask.png) center/100% 100% no-repeat;mask:url(/brand/d-mask.png) center/100% 100% no-repeat}
    .nav2-mark-shine::before{content:"";position:absolute;top:-30%;bottom:-30%;left:0;width:55%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.9),transparent);transform:translateX(-150%) skewX(-14deg)}
    .nav2-mark:hover .nav2-mark-shine::before,.nav2-mark:focus-visible .nav2-mark-shine::before{animation:dsheen .85s var(--ease-light)}
    @keyframes dsheen{to{transform:translateX(280%) skewX(-14deg)}}
    .nav2-links{display:flex;align-items:center;gap:30px}
    @media (pointer:coarse){
      .nav2-links a:not(.nav2-auth)::before{content:"";position:absolute;left:-12px;right:-12px;top:50%;height:44px;transform:translateY(-50%)}
      .nav2-links .nav2-auth::before{content:"";position:absolute;left:0;right:0;top:50%;height:44px;transform:translateY(-50%)}
    }
    .nav2-links a{position:relative;color:var(--mut);text-decoration:none;font-family:'Suntage','Inter',sans-serif;font-size:12.5px;letter-spacing:.16em;text-transform:uppercase;line-height:1.2;transition:color .35s ease}
    .nav2-links a:hover,.nav2-links a:focus-visible,.nav2-links a.active{color:var(--ink)}
    /* hover: a chrome underline draws in from the left and leaves to the right, so sweeping
       across the links reads as one line travelling along them; the current page keeps its own */
    .nav2-ind,.nav2-links a:not(.nav2-auth):not(.active)::after{position:absolute;left:0;right:.16em;bottom:-8px;height:1px;background:var(--chrome-border)}
    /* the line's two ends are animated separately (--ul-r draws the right end in, --ul-l carries the
       left end off to the right): the visible span is [max(0, l + r - 1), r] of the link's width */
    @property --ul-l{syntax:'<number>';inherits:false;initial-value:1}
    @property --ul-r{syntax:'<number>';inherits:false;initial-value:0}
    .nav2-links a:not(.nav2-auth):not(.active)::after{content:"";--ul-l:1;--ul-r:0;transform-origin:left;
      transform:translateX(calc(max(0, var(--ul-l) + var(--ul-r) - 1) * 100%)) scaleX(calc(var(--ul-r) - max(0, var(--ul-l) + var(--ul-r) - 1)));
      transition:--ul-l .5s var(--ease-out),--ul-r 0s .5s}
    .nav2-links a:not(.nav2-auth):not(.active):is(:hover,:focus-visible)::after{--ul-l:0;--ul-r:1;transition:--ul-l .3s var(--ease-out),--ul-r .5s var(--ease-out)}
    /* keyboard focus: a pill around the link and its line, like Sign in's, not a box with a stray line under it */
    .nav2-links a:not(.nav2-auth):focus-visible{outline-offset:12px;border-radius:100px}
    .nav2-links .nav2-auth{margin-left:2px;height:36px;display:inline-flex;align-items:center;padding:0 16px;border:1px solid var(--line-2);border-radius:100px;font-size:11px;color:#b5b5b5;transition:border-color .35s ease,color .35s ease,background-color .35s ease}
    .nav2-links .nav2-auth:hover,.nav2-links .nav2-auth:focus-visible{border-color:#f5f5f5;color:#fff;background:rgba(255,255,255,.06)}
    .nav2-links .nav2-auth[aria-current],.pm-foot .pill-ghost[aria-current]{border-color:#f5f5f5;color:#fff} /* on the sign-in page itself */
    .burger{display:none;position:relative;width:44px;height:44px;margin-right:-11px;background:none;border:0;color:var(--ink);-webkit-tap-highlight-color:transparent}
    .burger i{position:absolute;left:12px;right:12px;height:2px;border-radius:2px;background:currentColor;transition:transform .4s var(--ease-out)}
    .burger i:first-child{top:17px}
    .burger i:last-child{top:25px}
    .burger.x i:first-child{transform:translateY(4px) rotate(45deg)}
    .burger.x i:last-child{transform:translateY(-4px) rotate(-45deg)}

    /* ---------- poster menu (phones/tablets) ---------- */
    /* scrolls (rather than clipping CONTACT and Sign in) when a phone in landscape is too short for it */
    .pm{position:fixed;inset:0;z-index:45;background:#000;display:flex;flex-direction:column;justify-content:flex-start;
      padding:calc(var(--nav-h) + 22px) var(--gutter) calc(22px + env(safe-area-inset-bottom));overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;
      opacity:0;visibility:hidden;clip-path:inset(0 0 100% 0);transition:opacity .2s ease,clip-path 0s linear .2s,visibility 0s linear .2s}
    .pm.open{opacity:1;visibility:visible;clip-path:inset(0 0 0 0);transition:opacity 0s,clip-path .5s cubic-bezier(.3,.6,.1,1),visibility 0s}
    .pm-d{position:absolute;right:-14vw;bottom:10vh;width:80vw;max-width:520px;opacity:.06;pointer-events:none;user-select:none}
    .pm-list{list-style:none;margin:0;padding:0;position:relative}
    .pm-line{overflow:hidden;border-bottom:1px solid #141416}
    .pm-line a{display:flex;align-items:flex-start;gap:12px;padding:10px 0 8px;color:var(--ink);text-decoration:none;-webkit-tap-highlight-color:transparent;
      transform:translateY(105%);transition:transform .2s ease}
    .pm.open .pm-line a{transform:none;transition:transform .65s var(--ease-out) calc(var(--i) * 55ms + 120ms)}
    .pm-word{font-family:'Suntage','Inter',sans-serif;font-size:clamp(28px,min(11.5vw,9svh),76px);line-height:1;letter-spacing:.01em;text-transform:uppercase;padding:0 .06em}
    .pm-line a.on .pm-word{background:linear-gradient(#f5f5f5,#f5f5f5) top/100% calc(100% - .07em) no-repeat;color:#000} /* caps have no descenders: trim the white under them */
    .pm-idx{font-size:11px;letter-spacing:.08em;color:var(--mut);font-variant-numeric:tabular-nums;line-height:1;margin-top:.5em}
    .pm-idx{width:20px;flex-shrink:0}
    .pm-foot{position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:auto;padding-top:20px;opacity:0;transition:opacity .15s ease}
    .pm.open .pm-foot{opacity:1;transition:opacity .5s ease .5s}
    .pm-social{display:flex;gap:2px;margin-right:-10px}

    /* ---------- footer ---------- */
    /* one quiet row, the same on every page and built from the nav's own parts (the D, a nav link with
       its travelling underline), so the page opens and closes on the same line.
       Phones fold the row in two: Contact and the socials, then the D and the © */
    .foot2{margin-top:clamp(64px,8vw,104px);padding:0 max(var(--gutter),calc(50% - 624px))}
    .app:has(.ign) .foot2{margin-top:0} /* Home: the hero fills the first screen and ends on the credits ribbon */
    .ft{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;grid-template-areas:"mark copy links social";align-items:center;column-gap:24px;
      padding:28px 0 calc(28px + env(safe-area-inset-bottom))}
    .ft::before{content:"";position:absolute;left:0;right:0;top:0;height:1px;background:var(--line-2)}
    .app:has(.ign-ribbon) .ft::before{display:none} /* the ribbon right above already draws that line */
    .ft-mark{grid-area:mark;position:relative;display:block;line-height:0;padding:7px 6px;margin-left:-6px;-webkit-tap-highlight-color:transparent}
    .ft-mark img{display:block;height:26px;width:auto}
    .ft-mark-shine{position:absolute;inset:7px 6px;overflow:hidden;pointer-events:none;mix-blend-mode:plus-lighter;
      -webkit-mask:url(/brand/d-mask.png) center/100% 100% no-repeat;mask:url(/brand/d-mask.png) center/100% 100% no-repeat}
    .ft-mark-shine::before{content:"";position:absolute;top:-30%;bottom:-30%;left:0;width:55%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.9),transparent);transform:translateX(-150%) skewX(-14deg)}
    .ft-mark:hover .ft-mark-shine::before,.ft-mark:focus-visible .ft-mark-shine::before{animation:dsheen .85s var(--ease-light)}
    .foot2 .ft-mark:focus-visible{outline-offset:0;border-radius:8px}
    .ft-copy{grid-area:copy;margin:0;padding-left:24px;border-left:1px solid var(--line-2);font-size:12.5px;line-height:20px;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ft-links{grid-area:links;display:flex;align-items:center;gap:28px}
    .ft-links a{position:relative;display:inline-flex;align-items:center;height:36px;color:var(--mut3);text-decoration:none;font-family:'Suntage','Inter',sans-serif;font-size:12px;letter-spacing:.16em;text-transform:uppercase;line-height:1.2;white-space:nowrap;transition:color .35s ease,border-color .35s ease,background-color .35s ease}
    .ft-links a:hover,.ft-links a:focus-visible,.ft-links a[aria-current]{color:var(--ink)}
    .ft-links a::after{content:"";position:absolute;left:0;right:.16em;bottom:4px;height:1px;background:var(--chrome-border);--ul-l:1;--ul-r:0;transform-origin:left;
      transform:translateX(calc(max(0, var(--ul-l) + var(--ul-r) - 1) * 100%)) scaleX(calc(var(--ul-r) - max(0, var(--ul-l) + var(--ul-r) - 1)));
      transition:--ul-l .5s var(--ease-out),--ul-r 0s .5s}
    .ft-links a:is(:hover,:focus-visible)::after{--ul-l:0;--ul-r:1;transition:--ul-l .3s var(--ease-out),--ul-r .5s var(--ease-out)}
    .ft-links a[aria-current]::after{--ul-l:0;--ul-r:1;transition:none}
    .foot2 .ft-links a:focus-visible{outline-offset:8px;border-radius:4px}
    .foot2 .ft-soc:focus-visible{border-radius:100px}
    .ft-social{grid-area:social;display:flex;align-items:center;gap:8px}
    .ft-soc{display:inline-grid;place-items:center;width:36px;height:36px;border:1px solid var(--line-2);border-radius:50%;color:var(--mut3);transition:color .35s ease,border-color .35s ease,background-color .35s ease}
    .ft-soc:hover,.ft-soc:focus-visible{color:var(--ink);border-color:#f5f5f5;background:rgba(255,255,255,.06)}
    .ft-soc svg{display:block}
    /* touch screens: every target at least 44px */
    @media (any-pointer:coarse){
      .ft-links a{height:44px}
      .ft-soc{width:44px;height:44px}
      .ft-mark{padding:9px 6px}
      .ft-mark-shine{inset:9px 6px}
    }
    /* phones: the same row folded in two — the links and the socials, then the D and the © */
    @media(max-width:719px){
      .ft{grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"links links social" "mark copy copy";column-gap:16px;row-gap:14px;padding-top:20px}
      .ft-copy{padding-left:16px;font-size:12px}
    }
    @media (prefers-reduced-motion:reduce){
      .ft-mark-shine::before{animation:none!important}
    }

    /* ---------- 404 ---------- */
    .nf{flex:1;display:flex;flex-direction:column;justify-content:center;padding-bottom:clamp(56px,8vw,100px)}
    .nf-code{margin:0 0 18px;animation:rv .6s var(--ease-out) both}
    .nf-lead{max-width:520px;margin:0 auto 40px;color:#b8b8b8;font-size:clamp(16px,1.3vw,17.5px);line-height:1.65;animation:rv .6s var(--ease-out) .25s both}
    .nf-cta{display:flex;flex-wrap:wrap;justify-content:center;gap:12px}
    .nf-cta>*{animation:rv .6s var(--ease-out) .35s both}
    .nf-cta>:nth-child(2){animation-delay:.42s}
    @media(max-width:599px){ .nf-lead{margin-left:0} .nf-cta{flex-direction:column;align-items:stretch;width:min(100%,280px)} }

    /* ---------- sign in ---------- */
    /* one narrow column, centred like the 404 */
    .lg{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding-bottom:clamp(56px,8vw,100px)}
    .lg-label{margin:0 0 18px;animation:rv .6s var(--ease-out) both}
    .lg-head{margin:0 0 36px}
    .lg-form{width:100%;max-width:420px;display:flex;flex-direction:column;gap:20px;text-align:left;animation:rv .7s var(--ease-out) .3s both}
    .lg .ct-fld>label{font-size:12.5px;letter-spacing:.04em;color:var(--mut)}
    .lg .ct-err{margin:-4px 0 0}
    .lg-pw{position:relative}
    .lg-pw input{padding-right:84px}
    .lg-show{position:absolute;top:4px;right:4px;bottom:4px;padding:0 14px;border:0;border-radius:9px;background:none;color:var(--mut3);
      font-family:'Suntage','Inter',sans-serif;font-size:10px;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:color .2s ease,background-color .2s ease}
    .lg-show:hover{color:var(--ink);background:rgba(255,255,255,.06)}
    .lg-show:focus-visible{outline:2px solid #f5f5f5;outline-offset:-2px}
    /* the checkbox drawn to match the fields: a dark square that fills white with a black tick */
    .lg-help{margin:22px 0 0;color:var(--mut);font-size:14px;animation:rv .6s var(--ease-out) .4s both}
    .lg-help .inline-link{display:inline-block;padding:12px 0}
    @media(max-width:599px){
      .lg{align-items:stretch}
      .lg-form{max-width:none}
    }

    /* ---------- home: chrome ignition ---------- */
    .home2{flex:1;display:flex;flex-direction:column}
    .ign{position:relative;isolation:isolate;min-height:calc(100vh - var(--nav-h));min-height:calc(100svh - var(--nav-h));display:flex;flex-direction:column;align-items:center;justify-content:center;
      padding:24px var(--gutter) 120px;overflow:hidden;overflow:clip}
    .wm{position:relative;display:block;width:min(82vw,800px);aspect-ratio:1100/365;line-height:0;-webkit-tap-highlight-color:transparent;
      transform:perspective(1100px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg))}
    .wm:focus-visible{outline:1px solid #f5f5f5;outline-offset:10px;border-radius:8px}
    /* the light-scan reveal: 250% is the mask size at which 100%→0% runs exactly from fully hidden to
       fully revealed for this 42–58% feather, so the whole animation is a visible left-to-right front */
    .wm-img{display:block;width:100%;height:100%;user-select:none;
      -webkit-mask:linear-gradient(100deg,#000 42%,transparent 58%) 100% 0/250% 100% no-repeat;mask:linear-gradient(100deg,#000 42%,transparent 58%) 100% 0/250% 100% no-repeat;
      animation:wm-wipe .75s cubic-bezier(.4,.1,.2,1) .05s both}
    @keyframes wm-wipe{to{-webkit-mask-position:0 0;mask-position:0 0}}
    .ign-seen .wm-img{-webkit-mask:none;mask:none;animation:vt-fade-in .5s ease both}
    /* arriving through a view transition, that transition is the fade — don't stack a second one */
    .ign-seen.ign-vt .wm-img{animation:none}
    .wm-shine,.wm-spot{position:absolute;inset:0;pointer-events:none;overflow:hidden;mix-blend-mode:plus-lighter;
      -webkit-mask:url(/brand/wordmark-mask.webp) center/100% 100% no-repeat;mask:url(/brand/wordmark-mask.webp) center/100% 100% no-repeat}
    .wm-shine::before{content:"";position:absolute;top:-30%;bottom:-30%;left:0;width:34%;
      background:linear-gradient(100deg,transparent 12%,rgba(255,255,255,.5) 44%,rgba(214,230,255,.42) 54%,transparent 84%);
      transform:translateX(-130%) skewX(-14deg);animation:wm-sweep 8s var(--ease-light) .8s infinite}
    .ign-seen .wm-shine::before{animation-delay:.35s}
    @keyframes wm-sweep{0%{transform:translateX(-130%) skewX(-14deg)}16%,100%{transform:translateX(330%) skewX(-14deg)}}
    .wm-spot{opacity:var(--spot,0);background:radial-gradient(240px circle at var(--mx,50%) var(--my,50%),rgba(255,255,255,.34),transparent 62%)}
    .wm-spark{position:absolute;left:61.6%;top:31.6%;width:11%;aspect-ratio:1;translate:-50% -50%;pointer-events:none;mix-blend-mode:plus-lighter;
      opacity:0;scale:0;animation:spark-pop .7s var(--spring) .95s forwards}
    .ign-seen .wm-spark{animation-delay:.5s}
    .wm-spark::before{content:"";position:absolute;inset:0;
      background:radial-gradient(circle,#fff 0 4%,rgba(255,255,255,.55) 8%,transparent 20%),
        linear-gradient(90deg,transparent 0,rgba(255,255,255,.95) 50%,transparent 100%) center/100% 1.5px no-repeat,
        linear-gradient(0deg,transparent 0,rgba(255,255,255,.95) 50%,transparent 100%) center/1.5px 100% no-repeat;
      animation:spark-tw 8s var(--ease-light) .8s infinite}
    .ign-seen .wm-spark::before{animation-delay:.35s}
    @keyframes spark-pop{to{opacity:1;scale:1}}
    @keyframes spark-tw{0%,5%{transform:rotate(0deg) scale(.8);opacity:.65}9%{transform:rotate(45deg) scale(1.45);opacity:1}14%,100%{transform:rotate(90deg) scale(.8);opacity:.65}}
    .ign-cta{display:flex;flex-wrap:wrap;justify-content:center;gap:12px;margin-top:clamp(36px,4.5vw,52px)}
    .ign-cta>*{animation:rv .6s var(--ease-out) .4s both}
    .ign-cta>:nth-child(2){animation-delay:.47s}
    .ign-seen .ign-cta>*{animation-delay:.12s}
    .ign-seen .ign-cta>:nth-child(2){animation-delay:.2s}
    /* the Home numbers band: each figure in chrome, with what it is and where it's from as a two-line caption
       beside it. Sized off its font-size, so the phone and landscape rules only change that */
    .ign-ribbon{position:absolute;left:0;right:0;bottom:calc(20px + env(safe-area-inset-bottom));padding:15px 0;border-top:1px solid var(--hair);border-bottom:1px solid var(--hair);
      font-family:'Suntage','Inter',sans-serif;font-size:clamp(20px,1.9vw,27px);line-height:1;letter-spacing:.03em;text-transform:uppercase;text-align:left;
      animation:vt-fade-in .7s ease .6s both}
    .ign-seen .ign-ribbon{animation-delay:.2s}
    /* the ends fade into the black */
    .ign-ribbon::before,.ign-ribbon::after{content:"";position:absolute;top:0;bottom:0;z-index:3;width:7%;pointer-events:none}
    .ign-ribbon::before{left:0;background:linear-gradient(90deg,#000,transparent)}
    .ign-ribbon::after{right:0;background:linear-gradient(270deg,#000,transparent)}
    .st{display:inline-flex;align-items:center}
    .st-num{font-weight:400;padding:.05em 0;background:var(--chrome);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
    .st-cap{display:flex;flex-direction:column;gap:.55em;margin-left:.55em;font-size:max(9px,.22em);letter-spacing:.16em;line-height:1}
    .st-label{color:var(--ink)}
    .st-ctx{color:#7d7d7f}
    .ign-ribbon .mq-sep{height:.45em;margin:0 1.1em;opacity:.55}
    /* the rail rolls from the first frame, so the band is already moving as it fades in */
    @media (prefers-reduced-motion:no-preference){
      /* the lead stat starts in from the edge, with the copy before it already behind it, so no gap ever passes */
      .ign-ribbon .mq-rail{animation-name:mq-park}
      @keyframes mq-park{from{transform:translateX(calc(min(9vw,130px) - 100% / 3))}to{transform:translateX(calc(min(9vw,130px) - 200% / 3))}}
    }

    /* ---------- generic public page ---------- */
    .pg{width:100%;max-width:1240px;margin:0 auto;padding:clamp(56px,8vw,100px) var(--gutter) 0;text-align:center}
    .pg-wide{max-width:1360px}
    .pg-head{font-size:clamp(42px,8.4vw,112px);line-height:.95;margin:0 0 26px}
    .pg-loading{display:flex;justify-content:center;gap:8px;padding:120px 0;box-sizing:border-box;min-height:calc(100vh - var(--nav-h));min-height:calc(100svh - var(--nav-h))}
    .pg-loading span{width:6px;height:6px;border-radius:50%;background:#3a3a3c;animation:dot 1s ease-in-out infinite}
    .pg-loading span:nth-child(2){animation-delay:.15s}.pg-loading span:nth-child(3){animation-delay:.3s}
    /* the load failed: no dots promising it's still coming (kept in the flow so the footer stays put) */
    .storage-warn~.view .pg-loading{visibility:hidden}
    .storage-warn~.view .pg-loading span{animation:none}
    @keyframes dot{50%{background:#f5f5f5;transform:translateY(-4px)}}
    .pg-outage{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;box-sizing:border-box;min-height:calc(100vh - var(--nav-h));min-height:calc(100svh - var(--nav-h));padding-bottom:var(--nav-h)}
    .pg-outage-msg{margin:0;color:var(--mut);font-size:15px}

    /* ---------- about ---------- */
    /* "DEFYING THE NORMS / OF TALENT MANAGEMENT." — sized so the longer second line (16.9em) always fits */
    .about2-head{font-size:clamp(30px,5vw,64px);line-height:1.02;margin:0 auto 34px;max-width:1160px}
    /* the intro reads as a lead: bigger, about 70 characters a line, and the lines balanced to even lengths */
    .about2-body p{color:#b8b8b8;font-size:clamp(17px,1.6vw,22px);line-height:1.6;max-width:34em;margin:0 auto 18px;text-wrap:balance;overflow-wrap:break-word;animation:rv .75s var(--ease-out) .4s both}
    /* the big credits band: cover, the artist in chrome, and the song and producer as a caption beside it */
    .about2-band{margin:clamp(56px,7vw,88px) calc(50% - 50vw) 0;padding:clamp(18px,2vw,26px) 0;border-top:1px solid var(--hair);border-bottom:1px solid var(--hair);
      font-family:'Suntage','Inter',sans-serif;font-size:clamp(22px,3.3vw,44px);line-height:1;letter-spacing:.03em;text-transform:uppercase;text-align:left;animation:vt-fade-in .8s ease .6s both}
    .about2-band .cr-cov{width:.95em;height:.95em;margin-right:.34em;border-radius:6px;--lift:scale(2.5) rotate(-4deg)}
    .about2-band .cr-txt{align-items:center}
    .about2-band .cr-artist{padding:.05em 0;background:var(--chrome);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
    .about2-band .cr-sub{flex-direction:column;gap:.6em;margin-left:.5em;font-size:max(9px,.25em);letter-spacing:.16em;line-height:1;color:var(--mut3)}
    .about2-band .cr-prod{color:#7d7d7f}
    .about2-band .mq-sep{height:.46em;margin:0 .9em}
    @media (hover:hover){ .about2-band .mq-link:hover .cr-song{color:var(--ink)} }
    .rel2{margin-top:clamp(64px,8vw,108px)}
    .sec-head{font-size:clamp(24px,3.4vw,42px);line-height:1.05;margin:0 0 38px}
    .rel2-grid{--cols:5;--g:20px;display:flex;flex-wrap:wrap;justify-content:center;gap:30px var(--g)}
    .rel2-grid>.rc{width:calc((100% - (var(--cols) - 1) * var(--g)) / var(--cols))}
    /* lead releases as double tiles; About only turns this on when the count fills every row */
    .rel2-grid.rel2-feat{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-flow:dense;gap:30px 20px;max-width:1128px;margin:0 auto}
    .rel2-feat>.rc{width:auto}
    .rel2-feat>.rc-feat{grid-column:span 2;grid-row:span 2}
    .rc-feat .rc-meta strong{font-size:20px;line-height:1.25}
    .rc-feat .rc-artist{font-size:14px}
    .rc-cta{margin-top:10px;font-family:'Suntage','Inter',sans-serif;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink)}
    .rc-cta span{display:inline-block;transition:transform .35s var(--ease-out)}
    .rc:is(:hover,:focus-visible) .rc-cta span{transform:translate(3px,-3px)}

    /* release card */
    .rc{display:flex;flex-direction:column;gap:13px;color:var(--ink);text-decoration:none;text-align:left;-webkit-tap-highlight-color:transparent}
    .rc-cover{position:relative;aspect-ratio:1;border-radius:12px;overflow:hidden;isolation:isolate;outline:1px solid #2a2a2c;outline-offset:-1px}
    .rc-cover img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;transition:opacity .4s ease,scale .7s var(--ease-out);
      outline:1px solid rgba(255,255,255,.14);outline-offset:-1px;border-radius:inherit}
    .rc-cover::before{content:"";position:absolute;inset:0;z-index:3;border-radius:inherit;padding:1px;background:var(--chrome-border);pointer-events:none;
      -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;opacity:0;transition:opacity .3s ease}
    .rc-cover::after{content:"";position:absolute;inset:0;z-index:2;pointer-events:none;background:linear-gradient(115deg,transparent 35%,rgba(255,255,255,.2) 48%,transparent 62%);translate:-120% 0}
    .rc-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#3a3a3a}
    .rc-play{position:absolute;top:10px;right:10px;z-index:4;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;color:#fff;background:rgba(0,0,0,.6);
      -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);opacity:0;translate:0 4px;transition:opacity .2s ease,translate .35s var(--ease-out)}
    .rc:is(:hover,:focus-visible) .rc-cover img{scale:1.04}
    .rc:is(:hover,:focus-visible) .rc-cover::before{opacity:1}
    .rc:is(:hover,:focus-visible) .rc-cover::after{animation:sheen .9s var(--ease-light) both}
    .rc:is(:hover,:focus-visible) .rc-play{opacity:1;translate:0 0}
    .rc:active .rc-cover{scale:.98;transition:scale .12s ease}
    .rc:focus-visible{outline:none}
    .rc:focus-visible .rc-cover{outline:1px solid #f5f5f5;outline-offset:3px}
    .rc-meta{flex:1;display:flex;flex-direction:column;gap:3px;min-width:0}
    .rc-meta strong{font-size:14px;font-weight:600;line-height:1.3;text-wrap:pretty;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .rc-artist{font-size:13px;color:var(--mut3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .rc-chips{display:flex;flex-wrap:wrap;gap:5px;padding-top:8px;min-width:0}

    /* ---------- people cards (roster + team) ---------- */
    .pgrid{--cols:5;--g:28px;display:flex;flex-wrap:wrap;justify-content:center;gap:40px var(--g)}
    .pgrid>.pc{width:calc((100% - (var(--cols) - 1) * var(--g)) / var(--cols))}
    .pgrid-team{--cols:3;max-width:1120px;margin:0 auto}
    .team2-group+.team2-group{margin-top:clamp(56px,7vw,88px)}
    .team2-group{max-width:1120px;margin-left:auto;margin-right:auto}
    .team2-group .micro-label{margin-bottom:22px;text-align:left}
    .pc{position:relative;display:flex;flex-direction:column;gap:15px;padding:0;margin:0;background:none;border:0;color:var(--ink);text-align:left;font:inherit;-webkit-tap-highlight-color:transparent}
    button.pc{cursor:pointer}
    .pc-frame{position:relative;aspect-ratio:1;border-radius:14px;overflow:hidden;isolation:isolate;outline:1px solid #1d1d1f;outline-offset:-1px}
    .pc-frame img{transition:opacity .4s ease,scale .8s var(--ease-out)}
    .pc-frame::before{content:"";position:absolute;inset:0;z-index:3;border-radius:inherit;padding:1px;background:var(--chrome-border);pointer-events:none;
      -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;opacity:0;transition:opacity .35s ease}
    .pc-frame::after{content:"";position:absolute;inset:0;z-index:2;pointer-events:none;background:linear-gradient(115deg,transparent 35%,rgba(255,255,255,.18) 48%,transparent 62%);translate:-120% 0}
    .pc:is(:hover,:focus-visible,.is-lit) .pc-frame img{scale:1.045}
    .pc:is(:hover,:focus-visible,.is-lit) .pc-frame::before{opacity:1}
    .pc:is(:hover,:focus-visible,.is-lit) .pc-frame::after{animation:sheen 1s var(--ease-light) both}
    .pc:active .pc-frame{scale:.98;transition:scale .12s ease}
    .pc:focus-visible{outline:none}
    .pc:focus-visible .pc-frame{outline:1px solid #f5f5f5;outline-offset:4px}
    .pc-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:'Suntage','Inter',sans-serif;font-size:56px;color:#2c2c2e}
    .pc-cap{display:flex;flex-direction:column;gap:6px;min-width:0}
    .pc-name{display:block;font-family:'Suntage','Inter',sans-serif;font-weight:400;font-size:16px;line-height:18.4px;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap;overflow:hidden}
    .pc-role{font-size:11px;line-height:1.45;letter-spacing:.12em;text-transform:uppercase;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pc-bio{margin:0;font-size:13.5px;line-height:1.55;color:var(--mut);overflow-wrap:break-word;white-space:pre-line}
    .pc-links{display:flex;gap:2px;margin:-8px 0 0 -12px}

    /* roster header + filter chips */
    .ros2-head{display:flex;flex-direction:column;align-items:center}
    .chips{position:relative;display:inline-flex;flex-wrap:wrap;justify-content:center;gap:4px;padding:4px;border:1px solid #1f1f21;border-radius:26px;max-width:100%}
    .ros2-filter{flex-wrap:nowrap}
    .chip{position:relative;z-index:1;border-radius:100px;cursor:pointer;-webkit-tap-highlight-color:transparent}
    .chip input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
    .chip>span{display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 17px;border-radius:100px;white-space:nowrap;
      font-family:'Suntage','Inter',sans-serif;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--mut);transition:color .25s ease}
    .chip>span em{font-style:normal;font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;font-size:11px;letter-spacing:0;font-variant-numeric:tabular-nums}
    .chip.on>span em{opacity:.6}
    .chip:hover>span{color:var(--ink)}
    .chip.on>span{color:#000}
    .chip input:focus-visible+span{outline:1px solid #f5f5f5;outline-offset:2px}
    .chip-pill{position:absolute;left:0;top:0;z-index:0;border-radius:100px;background:#f5f5f5}
    .chips.ready .chip-pill{transition:transform .45s var(--ease-out),width .45s var(--ease-out),height .45s var(--ease-out)}
    .ros2-filter{margin:4px 0 48px;animation:rv .55s var(--ease-out) .25s both}

    /* ---------- artist panel ---------- */
    /* flex column: .ap-inner fills the screen, so the prev/next bar always sits on the bottom edge
       instead of floating wherever a short panel's content happens to end */
    .ap{position:fixed;inset:0;z-index:70;background:#000;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column}
    .ap-close{position:fixed;top:16px;right:16px;z-index:5;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;color:var(--ink);
      background:rgba(18,18,20,.72);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border:1px solid #2a2a2c;
      transition:border-color .2s ease,transform .35s var(--ease-out);animation:vt-fade-in .3s ease .15s both}
    .ap-close:hover{border-color:#f5f5f5;transform:rotate(90deg)}
    .ap-close:focus-visible{outline:1px solid #f5f5f5;outline-offset:3px}
    .ap-inner{flex:1 0 auto;width:100%;max-width:1440px;margin:0 auto;padding:clamp(72px,10vh,108px) var(--gutter) 130px;display:grid;grid-template-columns:minmax(0,min(46vw,640px)) minmax(0,1fr);gap:clamp(32px,4.5vw,68px);align-items:start;text-align:left}
    /* tall screens: centre the photo in the space above the prev/next bar (712 = the 640px photo cap + the bar's 72px overlap) */
    @media(min-width:1392px){ .ap-inner{padding-top:max(clamp(72px,10vh,108px),calc((100vh - 712px) / 2))} }
    .ap-photo{position:relative;aspect-ratio:1;border-radius:16px;overflow:hidden;isolation:isolate}
    .ap-photo img{object-fit:cover}
    .ap-photo .ph-fade{z-index:1}
    .ap-photo-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:'Suntage','Inter',sans-serif;font-size:96px;color:#2c2c2e}
    .ap-info{display:flex;flex-direction:column;align-items:flex-start;gap:24px;min-width:0;padding-top:clamp(0px,1.5vw,20px)}
    .ap-info>.ap-stag{max-width:100%}
    .ap .pill-solid{max-width:100%} .ap .pill-solid>span{min-width:0;overflow:hidden;text-overflow:ellipsis}
    .ap-info>*{max-width:100%}
    .ap-name{align-self:stretch;margin:0;font-family:'Suntage','Inter',sans-serif;font-weight:400;font-synthesis:none;font-size:clamp(40px,8.6vw,132px);line-height:.95;letter-spacing:.01em;text-transform:uppercase;white-space:nowrap;overflow:hidden;
      padding:.04em 0;background:var(--chrome);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
    .ap-name-lock{display:inline-grid}
    .ap-name-lock>*{grid-area:1/1}
    .ap-name-ghost{visibility:hidden}
    .ap-name-live{contain:inline-size;overflow-x:clip}
    .ap-name[data-wrap],.pc-name[data-wrap]{white-space:normal;overflow-wrap:anywhere;text-wrap:balance}
    .pc-name[data-wrap]{line-height:1.15}
    .ap-name .emo,.about2-band b .emo{-webkit-text-fill-color:#fff}
    .ap-stag{animation:rv .55s var(--ease-out) both;animation-delay:calc(240ms + var(--i) * 55ms)}
    .ap-rel{align-self:stretch}
    .ap-rel-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px}
    .ap-count{display:none;font-size:12px;color:var(--mut);font-variant-numeric:tabular-nums;letter-spacing:.06em}
    .ap-rail{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:16px}
    .rc-compact .rc-meta strong{font-size:13.5px;min-height:0}
    .rc-compact .rc-artist{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;text-overflow:clip}
    /* the 97px tiles at laptop widths need a third line for long titles and features */
    .rc-compact .rc-artist,.rc-compact .rc-meta strong{-webkit-line-clamp:3}
    .ap .socials{gap:4px;margin-left:-10px}
    .ap .social-ic{width:44px;height:44px;align-items:center;justify-content:center;border-radius:50%}
    .ap .social-ic:hover{background:#121214;transform:none}
    .ap-bio{margin:0;color:#b8b8b8;font-size:15.5px;line-height:1.7;max-width:560px;overflow-wrap:break-word;white-space:pre-line}
    /* 1fr auto 1fr keeps the "3 / 15" counter dead centre whatever the two names' widths */
    .ap-bar{position:sticky;bottom:0;z-index:4;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;margin-top:-72px;
      padding:24px max(var(--gutter),calc(50% - 720px + var(--gutter))) calc(14px + env(safe-area-inset-bottom));background:linear-gradient(to top,#000 52%,rgba(0,0,0,0))}
    .ap-bar>button:first-child{justify-self:start}
    .ap-bar>button:last-child{justify-self:end}
    .ap-bar button{display:inline-flex;align-items:center;gap:10px;min-width:0;height:44px;padding:0 2px;background:none;border:0;color:var(--mut);
      font-family:'Suntage','Inter',sans-serif;font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;transition:color .2s ease}
    .ap-bar button:hover{color:var(--ink)}
    .ap-bar button:focus-visible{outline:1px solid #f5f5f5;outline-offset:2px;border-radius:6px}
    @media (hover:none){ .ap-bar button:focus-visible{outline:none} }
    .ap-bar-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:32vw}
    .ap-bar-pos{font-size:11px;color:var(--mut);font-variant-numeric:tabular-nums;letter-spacing:.12em}

    /* ---------- contact ---------- */
    .ct{max-width:860px}
    .ct-lead{color:#b8b8b8;font-size:clamp(16px,1.3vw,17.5px);line-height:1.65;max-width:600px;margin:0 auto 40px;animation:rv .6s var(--ease-out) .25s both}
    .ct-card{max-width:660px;margin:0 auto;text-align:left;background:#070708;border:1px solid #1c1c1e;border-radius:20px;padding:clamp(20px,4vw,34px);animation:rv .7s var(--ease-out) .35s both;scroll-margin-top:calc(var(--nav-h) + 16px)}
    html[data-vt=sent] .ct-card{view-transition-name:contact-card}
    .ct-form{display:flex;flex-direction:column;gap:20px}
    .ct-row{display:grid;grid-template-columns:1fr 1fr;gap:20px}
    .ct-fld{display:flex;flex-direction:column;gap:9px;min-width:0}
    .ct-fld>span{font-size:12.5px;letter-spacing:.04em;color:var(--mut)}
    .ct-fld input,.ct-fld textarea{width:100%;height:52px;padding:0 16px;border-radius:12px;background:#0d0d0f;border:1px solid #232325;color:var(--ink);font-size:16px;font-family:inherit;
      transition:border-color .15s ease,box-shadow .15s ease,background-color .15s ease}
    .ct-fld textarea{height:auto;min-height:140px;padding:14px 16px;line-height:1.5;resize:vertical}
    .ct-fld input::placeholder{color:#7a7a7c}
    .ct-fld input:focus,.ct-fld textarea:focus{outline:none;border-color:#f5f5f5;background:#111113;box-shadow:0 0 0 4px rgba(255,255,255,.08)}
    .ct-fld input:user-invalid,.ct-fld textarea:user-invalid{border-color:#e59a9a}
    .ct-fld input:user-invalid:focus,.ct-fld textarea:user-invalid:focus{box-shadow:0 0 0 4px rgba(229,154,154,.14)}
    /* a password manager's fill keeps the dark field (browsers otherwise paint it pale blue or yellow) */
    .ct-fld input:-webkit-autofill{-webkit-text-fill-color:var(--ink);caret-color:var(--ink);box-shadow:0 0 0 100px #0d0d0f inset}
    .ct-fld input:-webkit-autofill:focus{box-shadow:0 0 0 100px #111113 inset,0 0 0 4px rgba(255,255,255,.08)}
    .ct-chips{justify-content:flex-start;gap:8px;padding:0;border:0;border-radius:0}
    .ct-chips .chip>span{height:40px;padding:0 15px;border:1px solid #2a2a2c;font-size:10px}
    @media (min-width:1180px) and (max-width:1299px){ .ct-chips{gap:6px} .ct-chips .chip>span{padding:0 10px;letter-spacing:.11em} }
    .ct-chips .chip.on>span{border-color:transparent}
    .ct-err{margin:0;color:#e59a9a;font-size:13.5px;line-height:1.5}
    .ct-direct{margin:30px 0 0;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:4px 8px;color:var(--mut);font-size:14px}
    .ct-direct .inline-link{display:inline-block;padding:12px 0}
    .ct-direct-label::after{content:" —"}
    .ct-mail{display:inline-flex;align-items:center;white-space:nowrap}
    .ct-copy{display:inline-grid;place-items:center;width:44px;height:44px;margin:0 -10px 0 -6px;border-radius:50%;background:none;border:0;color:var(--mut);cursor:pointer;transition:color .2s ease,background-color .2s ease}
    .ct-copy:hover{color:var(--ink);background:#121214}
    .ct-sent{display:flex;flex-direction:column;align-items:center;gap:10px;padding:44px 8px;text-align:center}
    .ct-sent h2:focus{outline:none}
    .ct-check{width:60px;height:60px;margin-bottom:12px}
    .ct-check circle,.ct-check path{fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1}
    .ct-check circle{stroke:#3a3a3c;animation:draw .7s var(--ease-light) .15s forwards}
    .ct-check path{stroke:#f5f5f5;animation:draw .5s var(--ease-light) .55s forwards}
    .ct-sent h2{margin:0;font-family:'Suntage','Inter',sans-serif;font-weight:400;font-size:22px;letter-spacing:.06em;text-transform:uppercase}
    .ct-sent p{margin:0 0 16px;color:var(--mut);font-size:14.5px}
    .ct-lead,.ct-sent p{text-wrap:pretty}
    @supports not (text-wrap:pretty){ .ct-lead,.ct-sent p{text-wrap:balance} }
    /* desktop: poster headline left, form right, so SEND sits above the fold (must come after the .ct rules above) */
    @media (min-width:1024px){
      .ct{max-width:1360px;display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);grid-template-rows:auto auto 1fr;column-gap:clamp(40px,5vw,80px);align-items:start;text-align:left}
      .ct .pg-head{grid-column:1;grid-row:1;font-size:clamp(56px,6.4vw,96px)}
      .ct-lead{grid-column:1;grid-row:2;margin:0}
      .ct-direct{grid-column:1;grid-row:3;flex-direction:column;align-items:flex-start;gap:0;margin-top:28px}
      @media (pointer:fine){ .ct-direct .inline-link{padding:8px 0} } /* touch screens this wide (iPad landscape) keep 44px targets */
      .ct-dot{display:none}
      .ct-card{grid-column:2;grid-row:1 / 4;max-width:none;margin:0}
    }
    /* stacked (desktop column, phones): the lead-in is a small label over the two links */
    @media (min-width:1024px),(max-width:599px){
      .ct-direct-label{margin-bottom:6px;font-family:'Suntage','Inter',sans-serif;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase}
      .ct-direct-label::after{content:none}
    }
    @media (min-width:1024px) and (max-height:899px){
      .ct{padding-top:clamp(32px,5vh,56px)}
      .ct-form{gap:16px}
      .ct-fld textarea{min-height:96px}
    }

    /* toast */
    .toast-wrap{position:fixed;left:0;right:0;bottom:calc(24px + env(safe-area-inset-bottom));z-index:90;display:flex;justify-content:center;pointer-events:none}
    .toast{padding:12px 18px;border-radius:100px;background:#f5f5f5;color:#000;font-family:'Suntage','Inter',sans-serif;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;
      box-shadow:0 10px 30px rgba(0,0,0,.5);animation:toast-in .45s var(--spring) both}
    @keyframes toast-in{from{opacity:0;transform:translateY(14px) scale(.96)}}

    /* ---------- view transitions ---------- */
    /* page change = fade through black: the old page is gone before the new one rises, never both at once (≤480ms) */
    html[data-vt^=page]::view-transition-old(root){animation:.16s cubic-bezier(.2,0,.4,1) both vt-out}
    html[data-vt^=page]::view-transition-new(root){animation:.34s var(--ease-out) .14s both vt-in}
    html[data-vt^=page]::view-transition-old(nav){display:none}
    html[data-vt^=page]::view-transition-new(nav){animation:none}
    /* an open panel's photo isn't part of a page change — it leaves with the page */
    html[data-vt^=page] .ap-photo{view-transition-name:none!important}
    ::view-transition-group(nav-ind){animation-duration:.45s;animation-timing-function:var(--ease-out)}
    /* the logo morph (wordmark ⇄ nav D) only runs on the two logo links; on every other
       navigation the logos stay put inside the page/nav snapshots */
    html:not([data-vt=page-brand]) .wm,html:not([data-vt=page-brand]) .nav2-mark{view-transition-name:none!important}
    html[data-vt=page-brand]::view-transition-new(root){animation-duration:.3s;animation-delay:.18s}
    ::view-transition-group(brand){animation-duration:.5s;animation-timing-function:var(--ease-out)}
    /* both images pinned to the group's left edge at full height, so the D sits on the wordmark's own D */
    ::view-transition-old(brand),::view-transition-new(brand){height:100%;width:auto;left:0;translate:none}
    /* the two overlap, so the logo slot is never empty mid-flight */
    ::view-transition-old(brand){animation:vt-fade-out .2s ease-in both}
    ::view-transition-new(brand){animation:vt-fade-in .22s ease-out .12s both}
    /* Home's own small nav D: gone at once when leaving Home, fades in after the morph when arriving */
    ::view-transition-old(nav-d){display:none}
    ::view-transition-new(nav-d){animation:vt-fade-in .18s ease .3s both}
    html[data-vt=page-brand][data-dir=home]::view-transition-old(brand){animation:vt-fade-out .12s ease-in both}
    html[data-vt=page-brand][data-dir=home]::view-transition-new(brand){animation:vt-fade-in .22s ease-out .06s both}
    html[data-vt^=artist]::view-transition-old(root){animation:.16s linear both vt-fade-out}
    html[data-vt^=artist]::view-transition-new(root){animation:.3s ease .12s both vt-fade-in}
    ::view-transition-group(artist-photo){z-index:10;animation-duration:.55s;animation-timing-function:var(--ease-out)}
    ::view-transition-old(artist-photo),::view-transition-new(artist-photo){height:100%;object-fit:cover}
    /* prev/next: the old face is out before the new one slides in — a slide, not a double exposure */
    html[data-vt=artist-step]::view-transition-group(artist-photo){animation:none}
    html[data-vt=artist-step][data-dir=next]::view-transition-old(artist-photo){animation:.2s cubic-bezier(.3,0,.6,1) both slide-out-l}
    html[data-vt=artist-step][data-dir=next]::view-transition-new(artist-photo){animation:.36s var(--ease-out) .16s both slide-in-r}
    html[data-vt=artist-step][data-dir=prev]::view-transition-old(artist-photo){animation:.2s cubic-bezier(.3,0,.6,1) both slide-out-r}
    html[data-vt=artist-step][data-dir=prev]::view-transition-new(artist-photo){animation:.36s var(--ease-out) .16s both slide-in-l}
    html[data-vt=artist-step]::view-transition-old(root){animation:.14s linear both vt-fade-out}
    html[data-vt=artist-step]::view-transition-new(root){animation:.28s ease .14s both vt-fade-in}
    @keyframes slide-out-l{to{opacity:0;transform:translateX(-10%)}}
    @keyframes slide-out-r{to{opacity:0;transform:translateX(10%)}}
    @keyframes slide-in-r{from{opacity:0;transform:translateX(10%)}}
    @keyframes slide-in-l{from{opacity:0;transform:translateX(-10%)}}
    /* filter: the footer glides up with the cards instead of snapping */
    html[data-vt=filter] .foot2{view-transition-name:flt-foot}
    html[data-vt=filter]::view-transition-group(*){animation-duration:.5s;animation-timing-function:var(--ease-out)}
    html[data-vt=filter]::view-transition-old(*):only-child{animation:.26s ease both vt-drop}
    html[data-vt=filter]::view-transition-new(*):only-child{animation:.42s var(--ease-out) .12s both vt-pop}
    html[data-vt=filter]::view-transition-old(root),html[data-vt=filter]::view-transition-new(root){animation:none}
    html[data-vt=filter]::view-transition-old(flt-foot){animation:none;opacity:0}
    html[data-vt=filter]::view-transition-new(flt-foot){animation:none}
    @keyframes vt-drop{to{opacity:0;transform:translateY(18px) scale(.95)}}
    @keyframes vt-pop{from{opacity:0;transform:translateY(18px) scale(.96)}}
    /* contact sent: the card morphs, and what's under it glides with it rather than cross-fading */
    html[data-vt=sent] .ct-direct{view-transition-name:ct-direct}
    html[data-vt=sent] .foot2{view-transition-name:ct-foot}
    html[data-vt=sent]::view-transition-group(contact-card){animation-duration:.5s;animation-timing-function:var(--ease-out);overflow:clip;border-radius:20px}
    html[data-vt=sent]::view-transition-group(ct-direct),html[data-vt=sent]::view-transition-group(ct-foot){animation-duration:.5s;animation-timing-function:var(--ease-out)}
    html[data-vt=sent]::view-transition-old(contact-card){animation:.2s ease both vt-fade-out}
    html[data-vt=sent]::view-transition-new(contact-card){animation:.36s ease .14s both vt-fade-in}
    html[data-vt=sent]::view-transition-old(root){animation:.12s linear both vt-fade-out}
    html[data-vt=sent]::view-transition-new(root){animation:.24s ease .1s both vt-fade-in}

    /* ---------- public responsive ---------- */
    @media(max-width:1199px){ .pgrid-roster{--cols:4;--g:24px} }
    /* 15 cards: 5-up keeps the last row on the grid at laptop widths (4-up leaves 3 floating) */
    @media(min-width:1000px) and (max-width:1199px){ .pgrid-roster{--cols:5;--g:20px} }
    /* 900-999: five full rows of 3 (4-up leaves 3 floating between the columns) */
    @media(min-width:900px) and (max-width:999px){ .pgrid-roster{--cols:3} }
    /* a centred short last row only lines up with the columns when (columns - cards in it) is even —
       otherwise it starts on column 1 (the roster size is set in the dashboard, so this can't be tuned to 15) */
    @media(min-width:1000px){ .pgrid-roster:has(> .pc:last-child:is(:nth-child(5n+7),:nth-child(5n+9))){justify-content:flex-start} }
    @media(min-width:600px) and (max-width:999px){ .pgrid-roster:has(> .pc:last-child:nth-child(3n+5)){justify-content:flex-start} }
    @media(max-width:1099px){ .rel2-grid{--cols:4} }
    @media(max-width:899px){
      :root{--nav-h:60px}
      .nav2-links{display:none}
      .burger{display:block}
      .pgrid{--cols:3;--g:20px}
      .ap-inner{grid-template-columns:1fr;gap:0;padding:68px 16px 120px}
      .ap-photo{width:100%}
      .ap-info{gap:22px}
      .ap-name{position:relative;z-index:2;margin-top:-.42em;font-size:clamp(34px,15vw,72px);filter:drop-shadow(0 2px 14px rgba(0,0,0,.85))}
      .ap-rail{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:12px;margin:0 -16px;padding:0 16px 4px;scrollbar-width:none;-webkit-overflow-scrolling:touch}
      .ap-rail::-webkit-scrollbar{display:none}
      .ap-rail-item{flex:0 0 min(68vw,300px);scroll-snap-align:center}
      .ap-count{display:block}
      .ap-bar-name{max-width:28vw}
    }
    @media(min-width:900px){ .pm{display:none} }
    @media (orientation:landscape) and (max-height:400px){ .pm{padding-top:calc(var(--nav-h) + 10px);padding-bottom:12px} }
    /* iPad portrait: a full-width square photo would push the name, credits and CTA off the first screen */
    @media(min-width:600px) and (max-width:899px){ .ap-inner{max-width:560px} }
    /* …and the credits rail still bleeds to the screen edges like on phones (234px = half the 500px column minus its padding) */
    @media(min-width:600px) and (max-width:899px) and (orientation:portrait){
      .ap{overflow-x:hidden}
      .ap-inner{max-width:500px}
      .ap-rail{margin:0 calc(234px - 50vw);padding:0 calc(50vw - 234px) 4px;scroll-padding:0 calc(50vw - 234px)}
      .ap-rail-item{flex-basis:180px}
    }
    /* phone landscape: photo left, name and credits right, so the first screen isn't just a cropped photo */
    @media(max-width:899px) and (orientation:landscape) and (max-height:500px){
      .ap-inner{max-width:none;grid-template-columns:minmax(0,40%) minmax(0,1fr);gap:28px;padding:20px 24px 100px}
      .ap-photo{position:sticky;top:20px}
      .ap-info{padding-top:44px}
      .ap-name{margin-top:0;font-size:clamp(30px,6vw,56px)}
      .ap-rail{margin:0;padding:0 0 4px}
      .ap-rail-item{flex-basis:168px}
    }
    /* phone landscape Home: size the wordmark by height too, so both CTAs and the credits ribbon sit inside the first screen */
    @media(orientation:landscape) and (max-height:500px){
      .wm{width:min(82vw,800px,96svh)} .ign{padding-top:8px;padding-bottom:72px} .ign-cta{margin-top:28px}
      .ign .ign-cta{flex-direction:row;align-items:center;width:auto} /* beats the later phone stacking */
      /* a slimmer ribbon, set lower, so it keeps clear of the CTAs on the shortest phones */
      .ign-ribbon{bottom:calc(12px + env(safe-area-inset-bottom));padding:11px 0;font-size:16px}
    }
    @media(min-width:900px) and (max-width:1199px){ .ap-rail{grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:12px} }
    @media(max-width:819px){ .rel2-grid{--cols:3} }
    @media (pointer:coarse){ .chip>span,.ct-chips .chip>span{height:44px} }
    @media(max-width:599px){
      .pg{text-align:left}
      .ros2-head{align-items:flex-start}
      .chips{justify-content:flex-start}
      /* sized so MANAGEMENT. (9.55em) runs the full width: the heading reads as one block, edge to edge */
      .about2-head{font-size:min(56px,calc((100vw - 2 * var(--gutter)) / 9.7));line-height:.98} .split-br{display:none}
      /* small enough that THE ROSTER stays on one line down to a 320px phone */
      .pg-head{font-size:clamp(32px,10.5vw,42px)}
      .about2-body p{margin-left:0;font-size:17px;line-height:1.6;text-wrap:pretty}
      .sec-head{text-align:left}
      .rel2-grid,.pgrid{--cols:2;--g:12px;row-gap:28px}
      .rel2-grid,.pgrid{justify-content:flex-start} /* phones are left-aligned: a short last row starts on column 1 */
      .rel2-grid.rel2-feat{grid-template-columns:repeat(2,minmax(0,1fr));gap:28px 12px}
      .rc-feat .rc-meta strong{font-size:17px}
      .chip-tag{font-size:9.5px;letter-spacing:.06em;padding:4px 7px}
      .about2-band .cr-artist{background:none;color:var(--ink);-webkit-text-fill-color:currentColor}
      .ros2-filter{align-self:stretch;margin-bottom:36px}
      .ros2-filter .chip{flex:1}
      .ros2-filter .chip>span{display:flex;justify-content:center;padding:0 8px;font-size:9.5px;letter-spacing:.1em;gap:6px}
      .ct-row{grid-template-columns:1fr}
      .ct-lead{margin-left:0}
      .ct-direct{flex-direction:column;align-items:flex-start;gap:0}
      .ct-dot{display:none}
      .ct-direct-label{margin-bottom:4px}
      /* subject chips as a tidy two-column grid ("Other" spans the last row) instead of six ragged rows */
      .ct-chips{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .ct-chips .chip{display:flex}
      .ct-chips .chip>span{flex:1;justify-content:center;text-align:center;white-space:normal;height:auto;min-height:44px;padding:6px 10px;line-height:1.2;font-size:9.5px;letter-spacing:.08em}
      .ct-chips .chip:last-child{grid-column:1/-1}
      .ign-cta{flex-direction:column;align-items:stretch;width:min(100%,280px)}
      .pill{height:46px;padding:0 22px;font-size:10.5px}
    }
    @media(max-width:359px){ .rc-chips .chip-tag{letter-spacing:0} .ap .pill-solid{max-width:100%;padding:0 16px;letter-spacing:.1em} }
    /* the release grid's narrow cards (2 across on phones, 4 on tablets): the credit chips set tighter so
       "Prod. Sauceproducedit" stays one pill instead of folding into a two-line box */
    @media(max-width:899px){ .rc:not(.rc-feat) .rc-chips .chip-tag{font-size:8.5px;letter-spacing:0;padding:4px 6px} }

    /* ---------- reduced motion (public pages only; the dashboard keeps its own) ---------- */
    @media (prefers-reduced-motion:reduce){
      .pub *,.pub *::before,.pub *::after{animation-duration:.01ms!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:.01ms!important;transition-delay:0s!important}
      /* fitted lines measure right after resetting their font-size — even a .01ms font-size transition hands them the stale size */
      .pub .ap-name,.pub .ap-name *,.pub .pc-name,.pub .pc-name *{transition:none!important}
      ::view-transition-group(*),::view-transition-old(*),::view-transition-new(*){animation:none!important}
      .wm-img{-webkit-mask:none!important;mask:none!important}
      .wm-shine,.wm-spot{display:none}
      .wm-spark{opacity:.85!important;scale:1!important}
      /* marquees become a still, wrapped block that starts at the first credit */
      .ign-ribbon::before,.ign-ribbon::after{display:none}
      .mq-rail{animation:none!important;width:100%;transform:none!important}
      .mq-track{flex-shrink:1;width:100%;flex-wrap:wrap;justify-content:center;gap:14px 34px;padding:0 var(--gutter)}
      .mq-track+.mq-track,.mq-rep,.mq-sep{display:none}
      .mq-item:not(.mq-rep){max-width:100%;white-space:normal}
      /* in the flow under the CTAs, so the taller wrapped ribbon can never cover them */
      .ign{padding-bottom:28px}
      .ign-ribbon{position:relative;left:auto;right:auto;bottom:auto;align-self:stretch;margin:44px calc(-1 * var(--gutter)) 0}
      .about2-band{font-size:clamp(18px,2.2vw,28px)}
      .grain{display:none}
      [data-reveal]:not([data-reveal=split]){opacity:1!important;translate:none!important}
      .split[data-reveal] .w>span{animation-play-state:running!important}
      .strike{clip-path:none!important}
      .ct-check circle,.ct-check path{stroke-dashoffset:0!important}
    }
    /* ...but on a phone a wrapped ribbon is a tall ragged stack under the hero (and can't fit a landscape
       phone's first screen at all): one still row there, swipe for more */
    @media (prefers-reduced-motion:reduce) and (orientation:landscape) and (max-height:500px),(prefers-reduced-motion:reduce) and (max-width:599px){
      .mq.ign-ribbon{overflow-x:auto;scrollbar-width:none;overscroll-behavior-x:contain;-webkit-mask:linear-gradient(90deg,#000 85%,transparent);mask:linear-gradient(90deg,#000 85%,transparent)}
      .mq.ign-ribbon .mq-rail{width:max-content}
      .ign-ribbon .mq-track{flex-wrap:nowrap;justify-content:flex-start;width:max-content;gap:28px}
      .ign-ribbon .mq-item:not(.mq-rep){display:inline-flex;white-space:nowrap}
    }
    @media (prefers-reduced-motion:reduce) and (orientation:landscape) and (max-height:500px){
      .home2 .ign{padding-bottom:8px} .ign .ign-ribbon{margin-top:28px}
    }
    /* phones read left-aligned: the still credits band too, one credit under the next like a tracklist */
    @media (prefers-reduced-motion:reduce) and (max-width:599px){
      .about2-band .mq-track{justify-content:flex-start;gap:16px 28px}
    }
    /* ---- Luminate page, needs-attention, top gainers, stream growth (dashboard v2, batch 1) ---- */
    .app:not(.pub) .lm-steps{list-style:none;margin:0 0 16px;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--d-line-2);border:1px solid var(--d-line-2);border-radius:var(--d-r-card);overflow:hidden}
    .app:not(.pub) .lm-steps li{display:flex;gap:12px;padding:16px 18px;background:var(--d-s1);min-width:0}
    .app:not(.pub) .lm-steps li > div{display:flex;flex-direction:column;gap:4px;min-width:0}
    .app:not(.pub) .lm-steps strong{font-size:14px;font-weight:600;color:var(--d-ink)}
    .app:not(.pub) .lm-steps li > div > span{font-size:12.5px;line-height:1.45;color:var(--d-ink-4)}
    .app:not(.pub) .lm-step-n{flex:none;display:grid;place-items:center;width:24px;height:24px;border-radius:50%;border:1px solid var(--d-line-3);font:600 12px/1 var(--d-body);color:var(--d-ink-3)}
    .app:not(.pub) .lm-steps li.todo .lm-step-n{border-color:var(--d-warn-line);color:var(--d-warn);background:var(--d-warn-bg)}
    .app:not(.pub) .lm-steps li.done .lm-step-n{border-color:var(--d-pos-line);color:var(--d-pos);background:var(--d-pos-bg)}
    .app:not(.pub) .lm-step-links{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
    .app:not(.pub) .lm-drop-wrap{margin:0 0 24px}
    .app:not(.pub) .lm-drop{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:132px;padding:22px;text-align:center;
      border:1px dashed var(--d-line-3);border-radius:var(--d-r-card);background:var(--d-s1);color:var(--d-ink-3);cursor:pointer;
      transition:border-color var(--d-t-fast) ease,background-color var(--d-t-fast) ease}
    .app:not(.pub) .lm-drop input{position:absolute;inset:0;opacity:0;cursor:pointer}
    .app:not(.pub) .lm-drop strong{font-size:15px;font-weight:600;color:var(--d-ink)}
    .app:not(.pub) .lm-drop span{font-size:12.5px;color:var(--d-ink-4)}
    .app:not(.pub) .lm-drop:hover,.app:not(.pub) .lm-drop.over{border-color:#f5f5f5;background:var(--d-s2)}
    .app:not(.pub) .lm-drop:focus-within{outline:1px solid #f5f5f5;outline-offset:2px}
    .app:not(.pub) .lm-drop.busy{cursor:progress;border-style:solid}
    .app:not(.pub) .lm-result{display:flex;flex-direction:column;gap:8px;margin-top:10px;padding:14px 16px;border:1px solid var(--d-line-2);border-radius:var(--d-r-card);background:var(--d-s1)}
    .app:not(.pub) .lm-result .btn{align-self:flex-start}
    .app:not(.pub) .lm-result.lm-preview{border-color:var(--d-info-line)}
    .app:not(.pub) .lm-result-title{margin:0 0 2px;font-size:14px;font-weight:600;color:var(--d-ink)}
    .app:not(.pub) .lm-result-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
    .app:not(.pub) .lm-result-row.ready svg{color:var(--d-info)}
    .app:not(.pub) .lm-result-row{display:flex;gap:10px;align-items:flex-start;font-size:13.5px;line-height:1.5;color:var(--d-ink-2)}
    .app:not(.pub) .lm-result-row svg{flex:none;margin-top:2px}
    .app:not(.pub) .lm-result-row.taken svg{color:var(--d-pos)}
    .app:not(.pub) .lm-result-row.blocked{color:var(--d-ban-warn-ink)} .app:not(.pub) .lm-result-row.blocked svg{color:var(--d-warn)}
    .app:not(.pub) .lm-result-row.older{color:var(--d-ink-4)}
    .app:not(.pub) .lm-result-row em{font-style:normal;color:var(--d-ink-4)}
    .app:not(.pub) .lm-result-row em.lm-note{display:block;margin-top:2px}
    .app:not(.pub) .lm-result-sum{margin:2px 0 0;color:var(--d-pos)}
    .app:not(.pub) .lm-ports{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin:0 0 28px}
    .app:not(.pub) .lm-port{font:inherit;display:flex;flex-direction:column;gap:8px;padding:16px;text-align:left;border:1px solid var(--d-line-2);border-radius:var(--d-r-card);background:var(--d-s1);color:var(--d-ink-3);cursor:pointer;
      transition:border-color var(--d-t-fast) ease,background-color var(--d-t-fast) ease}
    .app:not(.pub) .lm-port:hover{border-color:var(--d-line-3);background:var(--d-s2)}
    .app:not(.pub) .lm-port:focus-visible{outline:1px solid #f5f5f5;outline-offset:2px}
    .app:not(.pub) .lm-port-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .app:not(.pub) .lm-port-top strong{font-size:14.5px;font-weight:600;color:var(--d-ink)}
    .app:not(.pub) .lm-port-count{font-size:13px} .app:not(.pub) .lm-port-count b{font-size:20px;font-weight:600;color:var(--d-ink);letter-spacing:-.01em}
    .app:not(.pub) .lm-port-meta{font-size:12px;color:var(--d-ink-4)}
    .app:not(.pub) .lm-arcard{display:flex;flex-direction:column;gap:8px;padding:16px;border:1px dashed var(--d-line-2);border-radius:var(--d-r-card);color:var(--d-ink-3)}
    .app:not(.pub) .lm-arcard strong{font-size:14px;font-weight:600;color:var(--d-ink-2)}
    .app:not(.pub) .lm-bar{display:block;height:6px;border-radius:100px;background:var(--d-s3);overflow:hidden}
    .app:not(.pub) .lm-bar i{display:block;height:100%;border-radius:inherit;background:var(--d-ink-3);transition:width .5s cubic-bezier(.2,.8,.2,1)}
    .app:not(.pub) .lm-bar.near i{background:var(--d-warn)} .app:not(.pub) .lm-bar.full i{background:var(--d-warn)}
    .app:not(.pub) .lm-h3{margin:28px 0 12px;font:600 15px/1.3 var(--d-body);color:var(--d-ink);letter-spacing:0;text-transform:none}
    .app:not(.pub) .lm-h3-sub{margin:-6px 0 12px}
    .app:not(.pub) .lm-block{margin:0 0 16px;border:1px solid var(--d-line-2);border-radius:var(--d-r-card);background:var(--d-s1);overflow:hidden}
    .app:not(.pub) .lm-block-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px 16px;padding:14px 16px;border-bottom:1px solid var(--d-line)}
    .app:not(.pub) .lm-block-head strong{font-size:14px;color:var(--d-ink)}
    .app:not(.pub) .lm-block-head .hint{display:block;margin-top:4px;max-width:60ch}
    .app:not(.pub) .lm-block-acts{display:flex;flex-wrap:wrap;gap:6px}
    .app:not(.pub) .lm-block.lm-full{display:flex;align-items:center;gap:12px;padding:14px 16px;border-color:var(--d-warn-line);background:var(--d-ban-warn-bg);color:var(--d-ban-warn-ink)}
    .app:not(.pub) .lm-block.lm-full > div{flex:1;min-width:0} .app:not(.pub) .lm-block.lm-full > svg{flex:none;color:var(--d-warn)}
    .app:not(.pub) .lm-block.lm-full .hint{display:block;margin-top:2px}
    .app:not(.pub) .lm-list{display:flex;flex-direction:column}
    .app:not(.pub) .lm-block > .lm-list{border:0}
    .app:not(.pub) .lm > .lm-list{border:1px solid var(--d-line-2);border-radius:var(--d-r-card);background:var(--d-s1);overflow:hidden}
    .app:not(.pub) .lm-song{display:flex;align-items:center;gap:12px;min-height:60px;padding:10px 12px 10px 14px;border-bottom:1px solid var(--d-line);transition:background-color var(--d-t-fast) ease}
    .app:not(.pub) .lm-song:last-child{border-bottom:0}
    .app:not(.pub) .lm-song.on{background:var(--d-pos-bg)}
    .app:not(.pub) .lm-song.copied:not(.on) .lm-isrc code{color:var(--d-ink-4);text-decoration:line-through;text-decoration-color:var(--d-line-3)}
    .app:not(.pub) .lm-tick{display:grid;place-items:center;width:28px;height:28px;flex:none;cursor:pointer}
    .app:not(.pub) .lm-tick input{width:18px;height:18px;accent-color:#8fce8f;cursor:pointer}
    .app:not(.pub) .lm-cover{position:relative;flex:none;display:grid;place-items:center;width:40px;height:40px;border-radius:var(--d-r-xs);overflow:hidden;background:var(--d-s3);color:var(--d-ink-off)}
    .app:not(.pub) .lm-cover img{width:100%;height:100%;object-fit:cover}
    .app:not(.pub) .lm-song-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
    .app:not(.pub) .lm-song-main strong{font-size:14px;font-weight:500;color:var(--d-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .app:not(.pub) .lm-song-main span{font-size:12.5px;color:var(--d-ink-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .app:not(.pub) .lm-isrc{display:flex;align-items:center;gap:8px;flex:none}
    .app:not(.pub) .lm-isrc code{font:500 13px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;color:var(--d-ink-2)}
    .app:not(.pub) .lm-isrc .hint{display:inline-flex;align-items:center;gap:6px;margin:0}
    .app:not(.pub) .lm-copy{min-width:86px} .app:not(.pub) .lm-copy.done{color:var(--d-pos);border-color:var(--d-pos-line)}
    .app:not(.pub) .lm-isrc-in{display:flex;align-items:center;gap:6px}
    .app:not(.pub) .lm-isrc-in input{width:150px;height:var(--d-ctl-sm);padding:0 10px;border:1px solid var(--d-line-2);border-radius:var(--d-r-sm);background:var(--d-field);color:var(--d-ink);font:500 13px/1 ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase}
    .app:not(.pub) .lm-isrc-in input::placeholder{color:var(--d-ph);text-transform:none;font-family:var(--d-body)}
    .app:not(.pub) .lm-isrc-in input:focus{outline:none;border-color:#f5f5f5}
    .app:not(.pub) .lm-find{font-size:12.5px;white-space:nowrap}
    /* Don't track / This isn't ours: words, not an unlabelled × */
    .app:not(.pub) .lm-row-acts{display:flex;align-items:center;gap:6px;flex:none}
    .app:not(.pub) .lm-row-acts .btn{white-space:nowrap}
    .app:not(.pub) .lm-show-add{font:inherit;color:var(--d-info)}
    /* a Dashboard task's jump lands here: a short outline so the eye finds it */
    .app:not(.pub) .lm [data-sec]{scroll-margin-top:16px}   /* a jump leaves the block's top edge (and its outline) in view */
    .app:not(.pub) .lm-flash{outline:2px solid var(--d-info-line);outline-offset:2px;animation:lm-flash 1.2s ease-out}
    @keyframes lm-flash{0%{outline-color:var(--d-info)}100%{outline-color:var(--d-info-line)}}
    @media (prefers-reduced-motion:reduce){.app:not(.pub) .lm-flash{animation:none}}
    .app:not(.pub) .lm-gone{border-color:var(--d-warn-line)}
    .app:not(.pub) .lm-hidden{margin:28px 0 0}
    .app:not(.pub) .lm-hidden summary{cursor:pointer;font:600 14px/1.3 var(--d-body);color:var(--d-ink-3);padding:10px 0;min-height:40px}
    .app:not(.pub) .lm-hidden .lm-list{margin-top:6px}
    .app:not(.pub) .lm-hidden-row .lm-song-main{flex:1}
    /* the in-app confirm card, and the one line a Delete / This isn't ours leaves behind */
    .app:not(.pub) .ask-card{max-width:480px}
    .app:not(.pub) .ask-body > p{margin:0 0 10px;font-size:13.5px;line-height:1.5;color:var(--d-ink-2)}
    .app:not(.pub) .ask-body > p.hint{font-size:12.5px;color:var(--d-ink-3);margin-bottom:0}
    .app:not(.pub) .ask-places{margin:0 0 12px;padding-left:18px;font-size:13.5px;line-height:1.6;color:var(--d-ink)}
    .app:not(.pub) .ask-type{width:100%;height:40px;margin-top:4px}
    .app:not(.pub) .client-head .client-more{margin-left:auto;position:relative;flex:none}
    .app:not(.pub) .client-more-menu{position:absolute;right:0;top:calc(100% + 4px);z-index:30;min-width:170px;padding:4px;border:1px solid var(--d-line);border-radius:10px;background:var(--d-s2);box-shadow:0 10px 30px rgba(0,0,0,.45)}
    .app:not(.pub) .client-more-menu button{display:flex;align-items:center;gap:8px;width:100%;min-height:36px;padding:8px 10px;border:0;border-radius:7px;background:none;color:var(--d-neg);font:inherit;font-size:13.5px;text-align:left;cursor:pointer}
    .app:not(.pub) .client-more-menu button:hover,.app:not(.pub) .client-more-menu button:focus-visible{background:var(--d-s3)}
    .app:not(.pub) .btn.ask-go{background:var(--d-neg);border-color:var(--d-neg);color:#160606}
    /* a list row's side actions (Don't track, This isn't ours): quiet words after the row's main button,
       so they don't shout next to real songs. Red only on hover / focus, and inside the confirm */
    .app:not(.pub) .quiet-act{font:inherit;font-size:12.5px;line-height:1.2;min-height:30px;padding:6px 6px;border:0;border-radius:6px;background:none;color:var(--d-ink-4);cursor:pointer;white-space:nowrap;text-decoration:underline;text-decoration-color:transparent;text-underline-offset:3px}
    .app:not(.pub) .quiet-act:hover:not(:disabled), .app:not(.pub) .quiet-act:focus-visible{color:var(--d-ink-2);text-decoration-color:currentColor}
    .app:not(.pub) .quiet-act[data-not-ours]:hover:not(:disabled), .app:not(.pub) .quiet-act[data-not-ours]:focus-visible{color:var(--d-neg)}
    .app:not(.pub) .quiet-act:focus-visible{outline:1px solid var(--d-line-3);outline-offset:1px}
    .app:not(.pub) .quiet-act:disabled{opacity:.5;cursor:default}
    @media (max-width:700px){.app:not(.pub) .quiet-act{min-height:40px}}
    .app:not(.pub) .del-note [data-show-me]{margin-left:4px;font-weight:600}
    .app:not(.pub) .fix-panel{scroll-margin-top:16px}
    .app:not(.pub) p.hint.del-note{display:flex;align-items:flex-start;gap:8px;margin:0 0 14px;padding:10px 12px;border:1px solid var(--d-pos-line);border-radius:var(--d-r-md);background:var(--d-pos-bg);color:var(--d-ink-2);font-size:13px;line-height:1.5;max-width:80ch}
    .app:not(.pub) p.hint.del-note svg{flex:none;margin-top:3px;color:var(--d-pos)}
    .app:not(.pub) p.hint.del-note.warn{border-color:var(--d-warn-line);background:var(--d-warn-bg);color:var(--d-ban-warn-ink)}
    .app:not(.pub) p.hint.del-note.warn svg{color:var(--d-warn)}
    .app:not(.pub) .adv-out > .cat-summary{margin-top:20px}
    @media (min-width:1100px){
      .app:not(.pub) .adv-cols{display:grid;grid-template-columns:minmax(0,560px) minmax(0,1fr);gap:24px;align-items:start}
      .app:not(.pub) .adv-out{position:sticky;top:16px;min-width:0}
      .app:not(.pub) .adv-out > .cat-summary,.app:not(.pub) .adv-out > .adv-empty{margin-top:0}
      /* the side column is narrow: the 4 result tiles go 2 by 2 so no number is cut off */
      .app:not(.pub) .adv-out .cat-summary-grid:has(> .cat-stat:nth-child(4):last-child){grid-template-columns:repeat(2,minmax(0,1fr))}
    }
    .app:not(.pub) .adv-empty{margin:20px 0 0;padding:16px;border:1px dashed var(--d-line-3);border-radius:var(--d-r-md);color:var(--d-ink-3);font-size:13.5px;max-width:560px}
    /* Publishing: Splits to fix (one list, Fix opens the editor) and the strip after a Save */
    .app:not(.pub) .fix-panel{margin:0 0 18px;padding:14px 16px;border:1px solid var(--d-line-2);border-radius:var(--d-r-card);background:var(--d-s1)}
    .app:not(.pub) .fix-panel.flash{animation:lm-flash 1.2s ease-out;outline:2px solid transparent}
    .app:not(.pub) .fix-head{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 12px;margin-bottom:8px}
    .app:not(.pub) .fix-head h3{margin:0;font:600 14px/1.3 var(--d-body);color:var(--d-ink)}
    .app:not(.pub) .fix-head .hint{margin:0;font-size:12.5px}
    .app:not(.pub) .fix-client{margin:10px 0 2px;font:500 12px/1.3 var(--d-body);color:var(--d-ink-3)}
    .app:not(.pub) .fix-row{display:grid;grid-template-columns:minmax(0,1fr) 56px 120px auto;align-items:center;gap:10px;padding:6px 0;border-top:1px solid var(--d-line);font-size:13.5px}
    .app:not(.pub) .fix-song{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--d-ink)}
    .app:not(.pub) .fix-pct,.app:not(.pub) .fix-streams{font-variant-numeric:tabular-nums;text-align:right;color:var(--d-ink-3)}
    .app:not(.pub) .fix-row .fix-pct{color:var(--d-warn)}
    .app:not(.pub) .fix-acts{display:flex;align-items:center;gap:6px;justify-content:flex-end}
    /* Splits to confirm: the two groups' heads, the assumed split in words, and the unnamed rows in the editor */
    .app:not(.pub) .fix-sub{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:10px 0 4px}
    .app:not(.pub) .fix-sub .fix-client{margin:0}
    .app:not(.pub) .fix-group[data-group] .fix-row{grid-template-columns:minmax(0,1fr) minmax(0,1.2fr) 120px auto}
    .app:not(.pub) .fix-who{color:var(--d-ink-3)}
    .app:not(.pub) .fix-words{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--d-ink-2);font-size:13px}
    .app:not(.pub) .fix-why .fix-pct{margin-right:6px}
    .app:not(.pub) .splits-ed-row.split-assumed input{border-style:dashed;color:var(--d-ink-3)}
    .app:not(.pub) .pct-in.pct-assumed{padding-left:10px;color:var(--d-ink-3);font-variant-numeric:tabular-nums}
    .app:not(.pub) .split-hint.split-even{color:var(--d-ink-3)}
    .app:not(.pub) p.hint.fix-strip{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;margin:0 0 14px;padding:10px 12px;border:1px solid var(--d-pos-line);border-radius:var(--d-r-md);background:var(--d-pos-bg);color:var(--d-ink-2);font-size:13px}
    .app:not(.pub) p.hint.fix-strip svg{color:var(--d-pos)}
    .app:not(.pub) .cc-text{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:3px}
    .app:not(.pub) .cc-text .cc-name{max-width:100%}
    @media (max-width:1199px){ .app:not(.pub) .catalog-clients .cc-text{flex:none;width:100%;align-items:center} }
    .app:not(.pub) .cc-fix{flex:none;padding:1px 7px;border:1px solid var(--d-warn-line);border-radius:100px;background:var(--d-warn-bg);color:var(--d-warn);font-size:11px;line-height:1.5;white-space:nowrap}
    .app:not(.pub) .song-info em > .split-chip{display:inline-flex;align-items:center;height:20px;padding:0 8px;border:1px solid var(--d-warn-line);border-radius:100px;background:var(--d-warn-bg);color:var(--d-warn);font-style:normal}
    .app:not(.pub) .song-info .song-public{display:flex;align-items:center;gap:4px;margin-top:3px;font-size:12px;color:var(--d-ink-3)}
    .app:not(.pub) .song-detail-public{display:flex;align-items:center;gap:6px;margin-top:6px;font-size:12.5px;color:var(--d-ink-3)}
    .app:not(.pub) p.hint.song-sheet-warn{display:flex;align-items:flex-start;gap:8px;margin:14px 0 4px;padding:10px 12px;border:1px solid var(--d-warn-line);border-radius:var(--d-r-md);background:var(--d-warn-bg);color:var(--d-ban-warn-ink);font-size:13px;line-height:1.5}
    .app:not(.pub) p.hint.song-sheet-warn svg{flex:none;margin-top:3px;color:var(--d-warn)}
    @media (max-width:700px){
      .app:not(.pub) .subpill .pill-long{display:none}  /* the phone pill reads "Advance" */
      .app:not(.pub) .fix-row{grid-template-columns:minmax(0,1fr) auto;row-gap:6px}
      .app:not(.pub) .fix-streams{text-align:left}
      .app:not(.pub) .fix-acts{grid-column:1 / -1;justify-content:flex-start}
      .app:not(.pub) .fix-acts .btn{min-height:40px}
      /* Splits to confirm on phones: song, then the split in words on its own full line, then streams and the button */
      .app:not(.pub) .fix-group[data-group] .fix-row{grid-template-columns:minmax(0,1fr) auto}
      .app:not(.pub) .fix-group[data-group] .fix-words{grid-column:1 / -1;white-space:normal}
      .app:not(.pub) .fix-sub .btn{min-height:40px}
      /* thumb-sized taps: the segmented toggles, the A&R strip in two lines, Luminate's buttons under its title */
      .app:not(.pub) .gainer-tabs button{min-height:40px}
      .app:not(.pub) .ar-strip{flex-wrap:wrap;overflow-x:visible}
      .app:not(.pub) .ar-strip-val{flex-basis:100%;margin-left:0;padding:4px 0 0}
      .app:not(.pub) .lm-head{flex-wrap:wrap}
      .app:not(.pub) .lm-head .overview-links{flex-basis:100%;display:grid;grid-template-columns:1fr;gap:8px}
      .app:not(.pub) .lm-head .overview-links .btn{width:100%;justify-content:center;min-height:40px}
    }
    .app:not(.pub) .lm-unl-acts{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;flex:none;max-width:60%}
    .app:not(.pub) .lm-pick{height:var(--d-ctl-sm);max-width:260px;padding:0 12px;border:1px solid var(--d-line-2);border-radius:var(--d-r-sm);background:var(--d-field);color:var(--d-ink);font:400 13.5px/1 var(--d-body)}
    .app:not(.pub) .attn,.app:not(.pub) .gainers{display:flex;flex-direction:column;border:1px solid var(--d-line-2);border-radius:var(--d-r-card);background:var(--d-s1);overflow:hidden;align-self:start}
    .app:not(.pub) .attn-head{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--d-line);font:600 13px/1.2 var(--d-body);color:var(--d-ink)}
    .app:not(.pub) .attn .attn-head svg{color:var(--d-warn)} .app:not(.pub) .attn.clear .attn-head{border-bottom:0} .app:not(.pub) .attn.clear .attn-head svg{color:var(--d-pos)}
    .app:not(.pub) .gainers .attn-head svg{color:var(--d-pos)}
    .app:not(.pub) .attn-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px 10px 16px;border-bottom:1px solid var(--d-line);font-size:13.5px;line-height:1.45;color:var(--d-ink-2)}
    .app:not(.pub) .attn-row:last-child{border-bottom:0} .app:not(.pub) .attn-row .btn{flex:none}
    .app:not(.pub) .gainer{width:100%;border:0;border-radius:0;background:none;cursor:pointer;font:inherit;display:flex;align-items:center;gap:12px;padding:8px 14px 8px 12px;border-bottom:1px solid var(--d-line);text-align:left;color:inherit;transition:background-color var(--d-t-fast) ease}
    .app:not(.pub) .gainer:last-child{border-bottom:0} .app:not(.pub) .gainer:hover{background:var(--d-hover)}
    .app:not(.pub) .gainer:focus-visible{outline:1px solid #f5f5f5;outline-offset:-1px}
    .app:not(.pub) .gainer-n{flex:none;width:16px;font:600 12px/1 var(--d-body);color:var(--d-ink-off);text-align:center}
    .app:not(.pub) .gainer-num{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:2px}
    .app:not(.pub) .gainer-num b{font-size:15px;font-weight:600;color:var(--d-pos)} .app:not(.pub) .gainer-num em{font-style:normal;font-size:11.5px;color:var(--d-ink-4)}
    .app:not(.pub) .gainer-av{border-radius:50%;font:600 15px/1 var(--d-body);color:var(--d-ink-3)}   /* an artist: their photo in a circle, a song's cover stays square */
    .app:not(.pub) .grow-chip{display:inline-flex;align-self:flex-start;margin-top:6px;padding:3px 8px;border:1px solid var(--d-pos-line);border-radius:100px;background:var(--d-pos-bg);font:500 11.5px/1.2 var(--d-body);color:var(--d-pos)}
    .app:not(.pub) .grow-val{color:var(--d-pos)}
    .app:not(.pub) .cat-asof{margin:8px 2px 0}
    .app:not(.pub) .song-growth{display:flex;flex-direction:column;gap:8px;margin:18px 0 6px;padding:14px 16px;border:1px solid var(--d-line-2);border-radius:var(--d-r-card);background:var(--d-s2)}
    .app:not(.pub) .song-growth-nums{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;color:var(--d-ink-4)}
    .app:not(.pub) .song-growth-nums b{font-size:15px;font-weight:600;color:var(--d-ink)} .app:not(.pub) .song-growth-nums b.grow-val{color:var(--d-pos)}
    .app:not(.pub) .song-growth .hint{margin:0}
    .app:not(.pub) .spark{display:block;width:100%;height:56px;overflow:visible}
    .app:not(.pub) .spark-line{fill:none;stroke:#8fce8f;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
    .app:not(.pub) .spark-fill{fill:rgba(143,206,143,.10)}
    @media (max-width:899px){
      .app:not(.pub) .lm-steps{grid-template-columns:minmax(0,1fr)}
    }
    @media (max-width:599px){
      .app:not(.pub) .lm-song{flex-wrap:wrap;row-gap:8px;position:relative;padding-right:12px}
      .app:not(.pub) .lm-row-acts{flex-basis:100%;padding-left:40px}
      .app:not(.pub) .lm-tick + .lm-cover ~ .lm-row-acts{padding-left:80px}
      .app:not(.pub) .lm-row-acts .btn,.app:not(.pub) .lm-unl-acts .btn,.app:not(.pub) .lm-hidden-row .btn{min-height:40px}
      .app:not(.pub) .lm-song-main{flex-basis:calc(100% - 140px)}
      .app:not(.pub) .lm-isrc,.app:not(.pub) .lm-unl-acts{flex-basis:100%;max-width:none;justify-content:flex-start;padding-left:40px}
      .app:not(.pub) .lm-tick + .lm-cover + .lm-song-main + .lm-isrc{padding-left:80px}
      .app:not(.pub) .lm-isrc-in input{width:132px}
      .app:not(.pub) .lm-block-acts{width:100%} .app:not(.pub) .lm-block-acts .btn{flex:1}
      .app:not(.pub) .attn-row{flex-direction:column;align-items:flex-start}
      .app:not(.pub) .lm-pick{max-width:100%}
    }
    /* the drop preview's "What's in it?" for a portfolio never seen before */
    .app:not(.pub) .lm-area{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin-top:6px}
    .app:not(.pub) .lm-area label{display:inline-flex;align-items:center;gap:8px;font-weight:600;color:var(--d-ink)}
    .app:not(.pub) .lm-result-row.needsArea{color:var(--d-ban-warn-ink)} .app:not(.pub) .lm-result-row.needsArea svg{color:var(--d-warn)}
    .app:not(.pub) .lm-result-acts .hint{align-self:center;margin:0}
    /* "Marked as added … Add it again?" is the point of the row: it wraps instead of being cut off */
    .app:not(.pub) .lm-missing .lm-song-main span{white-space:normal}
    /* Dashboard (home): the money line, then tasks beside gainers, then payments beside accounting */
    .app:not(.pub) .home-money{display:flex;flex-direction:column;gap:8px;margin:0 0 12px;padding:16px 18px;border:1px solid var(--d-line-2);border-radius:var(--d-r-card);background:var(--d-s1)}
    .app:not(.pub) .home-muted{display:flex;align-items:flex-start;gap:8px;margin:0;font-size:13.5px;line-height:1.5;color:var(--d-ink-4)}
    .app:not(.pub) .home-muted svg{flex:none;margin-top:2px}
    .app:not(.pub) .home-pair{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:12px;margin:0 0 12px}
    .app:not(.pub) .home-pair > *{align-self:stretch}   /* the two cards of a row end on one line */
    .app:not(.pub) .home-card{display:flex;flex-direction:column;border:1px solid var(--d-line-2);border-radius:var(--d-r-card);background:var(--d-s1);overflow:hidden}
    .app:not(.pub) .home-card .home-muted{padding:14px 16px}
    .app:not(.pub) .home .attn-head{min-height:52px;padding-top:8px;padding-bottom:8px}   /* side-by-side heads line up, gainer tabs or not */
    .app:not(.pub) .attn-n{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 6px;border-radius:100px;background:var(--d-warn-bg);border:1px solid var(--d-warn-line);font:600 11px/1 var(--d-body);color:var(--d-warn)}
    .app:not(.pub) .attn.wait .attn-head svg{color:var(--d-ink-4)}
    .app:not(.pub) .attn-wait span{color:var(--d-ink-4)}
    .app:not(.pub) .gainers .attn-head{flex-wrap:wrap;row-gap:10px}
    .app:not(.pub) :is(.gainer-tabs,.cu-tabs){margin-left:auto;display:inline-flex;gap:2px;padding:2px;border:1px solid var(--d-line-2);border-radius:100px}
    .app:not(.pub) :is(.gainer-tabs,.cu-tabs) button{height:26px;padding:0 10px;border:0;border-radius:100px;background:none;color:var(--d-ink-4);font:500 12px/1 var(--d-body);white-space:nowrap;cursor:pointer;transition:background-color var(--d-t-fast) ease,color var(--d-t-fast) ease}
    @media (hover:hover){ .app:not(.pub) :is(.gainer-tabs,.cu-tabs) button:hover{color:var(--d-ink)} }
    .app:not(.pub) :is(.gainer-tabs,.cu-tabs) button.active{background:var(--d-active);color:var(--d-ink)}
    .app:not(.pub) .gainers-empty{margin:0;padding:14px 16px;font-size:13.5px;line-height:1.5;color:var(--d-ink-4)}
    .app:not(.pub) .gainers-noweek{border-top:1px solid var(--d-line-2)}
    /* "See the list" (A&R artists and songs to add in Luminate) */
    .app:not(.pub) .ar-tolum-group{margin-top:14px} .app:not(.pub) .ar-tolum-group h4{margin:0 0 6px;font-size:13.5px}
    .app:not(.pub) .ar-tolum-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--d-line-2);flex-wrap:wrap}
    .app:not(.pub) .ar-tolum-acts{display:flex;gap:6px;flex:none}
    @media (max-width:899px){
      .app:not(.pub) .home-pair{grid-template-columns:minmax(0,1fr)}
      /* 7 tabs: each as wide as its label plus an even share of what's left (never under 44px), so the
         long labels ("Dashboard", "Publishing") get their room and a gap, instead of equal slices */
      .app:not(.pub) .dash-side nav{grid-auto-columns:minmax(44px,auto)}
    }
    @media (max-width:420px){
      /* phones: iOS-size labels (10px), so all 7 stay whole and apart down to 360px */
      .app:not(.pub) .dash-side nav{padding-left:2px;padding-right:2px}
      .app:not(.pub) .dash-side nav button{padding:0 1px}
      .app:not(.pub) .dash-side nav button .nav-label{font-size:10px;letter-spacing:-.01em}
    }
    @media (max-width:599px){ .app:not(.pub) :is(.gainer-tabs,.cu-tabs){margin-left:0;width:100%} .app:not(.pub) :is(.gainer-tabs,.cu-tabs) button{flex:1} }
    /* Dashboard money (Stripe), payments, the accounting sheet and ClickUp's lists */
    .app:not(.pub) .home-money-row{margin:0 0 12px}
    .app:not(.pub) .home-money-note{margin:8px 2px 0;font-size:12px;line-height:1.45;color:var(--d-ink-4)}
    .app:not(.pub) .home-money-row .cat-stat-val{font-size:clamp(18px,10cqi,26px)}
    .app:not(.pub) .home-src{margin:8px 2px 0}
    .app:not(.pub) .pay-all{margin-left:auto;font:500 12.5px/1 var(--d-body);color:var(--d-ink-3);background:none;border:0;padding:6px 0}
    .app:not(.pub) :is(.pay-row,.cu-row){display:flex;align-items:center;gap:12px;min-height:56px;padding:9px 16px;border-bottom:1px solid var(--d-line);text-decoration:none;color:inherit}
    .app:not(.pub) :is(.pay-row,.cu-row):last-of-type{border-bottom:0}
    .app:not(.pub) :is(.pay-main,.cu-main){flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
    .app:not(.pub) :is(.pay-main,.cu-main) strong{font-size:14px;font-weight:500;color:var(--d-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .app:not(.pub) .pay-main > span,.app:not(.pub) .cu-meta{font-size:12.5px;color:var(--d-ink-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .app:not(.pub) .pay-amt{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:2px}
    .app:not(.pub) .pay-amt b{font-size:15px;font-weight:600;color:var(--d-pos)} .app:not(.pub) .pay-amt em{font-style:normal;font-size:11.5px;color:var(--d-ink-4)}
    .app:not(.pub) .pay-modal{max-width:620px} .app:not(.pub) .pay-modal .modal-body{padding:0}
    .app:not(.pub) .acct-grid{margin:12px 16px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
    .app:not(.pub) .acct-card{margin:0 0 12px}
    .app:not(.pub) .acct-card > .home-muted{padding:14px 16px}
    .app:not(.pub) .acct-clear svg{color:var(--d-pos)}
    .app:not(.pub) .acct-unlogged{margin:0 16px 14px;border:1px solid var(--d-warn-line);border-radius:var(--d-r-md);background:var(--d-warn-bg)}
    .app:not(.pub) .acct-unlogged-head{margin:0;padding:10px 14px;font-size:13.5px;color:var(--d-ink-2);border-bottom:1px solid var(--d-line)}
    .app:not(.pub) .acct-unlogged-head strong{color:var(--d-warn);font-weight:600}
    .app:not(.pub) .acct-row{display:grid;grid-template-columns:64px minmax(0,1fr) auto;gap:12px;padding:8px 14px;border-bottom:1px solid var(--d-line);font-size:13.5px;color:var(--d-ink-3)}
    .app:not(.pub) .acct-who{color:var(--d-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis} .app:not(.pub) .acct-amt{color:var(--d-ink-2)}
    .app:not(.pub) .acct-unlogged .hint{margin:0;padding:9px 14px}
    .app:not(.pub) .cu-card .attn-head{flex-wrap:wrap;row-gap:10px}
    @media (hover:hover){ .app:not(.pub) .cu-row:hover{background:var(--d-hover)} }
    .app:not(.pub) .cu-meta{display:flex;align-items:center;gap:8px}
    .app:not(.pub) .cu-status{display:inline-flex;align-items:center;gap:5px;text-transform:uppercase;letter-spacing:.04em;font-size:11px}
    .app:not(.pub) .cu-status::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--d-ink-4)}   /* neutral, not ClickUp's own colours */
    .app:not(.pub) .cu-due.late{color:var(--d-neg)}
    .app:not(.pub) .cu-pri{flex:none;display:inline-flex;color:var(--d-ink-4)}
    .app:not(.pub) .cu-pri[data-pri=urgent]{color:var(--d-neg)} .app:not(.pub) .cu-pri[data-pri=high]{color:var(--d-ink)}   /* blue means Luminate and amber needs-attention elsewhere */
    .app:not(.pub) .attn-row .cu-pri{margin-right:6px;vertical-align:-2px}
    .app:not(.pub) .cu-who{flex:none;display:flex;gap:2px}
    .app:not(.pub) .cu-av{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--d-s3);border:1px solid var(--d-line-2);font:600 10px/1 var(--d-body);color:var(--d-ink-3)}
    .app:not(.pub) .cu-foot{margin-top:auto;padding:10px 16px;border-top:1px solid var(--d-line);font-size:12.5px}
    .app:not(.pub) .cu-foot a{display:inline-flex;align-items:center;gap:4px;color:var(--d-ink-3)}
    @media (max-width:599px){
      .app:not(.pub) .acct-row{grid-template-columns:52px minmax(0,1fr) auto;gap:8px}
      .app:not(.pub) .cu-who{display:none}
    }
    /* Publishing: "2 publishing tasks · see the Dashboard", the calculator's title one level down, money notes */
    .app:not(.pub) .pub-tasks{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin:-8px 0 20px;font-size:13px;line-height:1.45;color:var(--d-ink-3)}
    .app:not(.pub) .pub-tasks svg{flex:none;color:var(--d-warn)}
    .app:not(.pub) .pub-tasks .inline-link{padding:0;border:0;background:none;font:inherit;color:var(--d-ink);cursor:pointer}
    .app:not(.pub) .pub-sec .admin-head h2{margin:0;font:400 14px/1.2 var(--d-display);font-synthesis:none;letter-spacing:.08em;text-transform:uppercase;
      color:var(--d-ink);background:none;-webkit-text-fill-color:currentColor}
    .app:not(.pub) .cat-stat-label:has(.cat-stat-note){white-space:normal}
    .app:not(.pub) .cat-stat-note{display:block;margin-top:2px;font:400 11px/1.35 var(--d-body);letter-spacing:0;text-transform:none;color:var(--d-ink-4)}
    .app:not(.pub) .money-hint{max-width:80ch}
    /* A&R board (spec 8 / 14): status columns of cards, the panel, off-the-board list, Sheet check */
    .app:not(.pub) .arb-head-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
    .app:not(.pub) .arb-head-actions .gainer-tabs{margin-left:0}
    .app:not(.pub) .arb-status{margin:-6px 0 14px;font-size:13px;line-height:1.45;color:var(--d-ink-3)}
    .app:not(.pub) .arb-banner,.app:not(.pub) .arb-card-note{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:0 0 12px;padding:11px 14px;border-radius:var(--d-r-card);font-size:13.5px;line-height:1.45}
    .app:not(.pub) .arb-banner span,.app:not(.pub) .arb-card-note span{flex:1 1 240px}
    .app:not(.pub) .arb-banner svg,.app:not(.pub) .arb-card-note svg{flex:none}
    .app:not(.pub) .arb-banner.neg{background:var(--d-ban-neg-bg);border:1px solid var(--d-ban-neg-line);color:var(--d-ban-neg-ink)}
    .app:not(.pub) .arb-banner.warn{background:var(--d-ban-warn-bg);border:1px solid var(--d-ban-warn-line);color:var(--d-ban-warn-ink)}
    .app:not(.pub) .arb-card-note{background:var(--d-s1);border:1px solid var(--d-line-2);color:var(--d-ink-2)} .app:not(.pub) .arb-card-note svg{color:var(--d-pos)}
    .app:not(.pub) .arb-check{margin:0 0 12px}
    .app:not(.pub) .arb-row-actions{display:flex;flex-wrap:wrap;gap:6px;flex:none}
    .app:not(.pub) .arb-flash{margin:0 0 12px}
    .app:not(.pub) .arb-tools{display:flex;gap:8px;margin:0 0 14px}
    .app:not(.pub) .arb-find,.app:not(.pub) .arb-quick input,.app:not(.pub) .arb-move,.app:not(.pub) .arb-merge select,.app:not(.pub) .arb-panel-status{background:var(--d-field);border:1px solid var(--d-line-2);color:var(--d-ink);border-radius:9px;font:400 13px/1.2 var(--d-body);min-width:0}
    .app:not(.pub) .arb-find{width:280px;max-width:100%;height:36px;padding:0 12px}
    .app:not(.pub) .arb-board{display:grid;grid-template-columns:repeat(4,minmax(0,1fr)) minmax(150px,.7fr);gap:10px;align-items:start}
    .app:not(.pub) .arb-board:has(.arb-col[data-col=other]){grid-template-columns:repeat(4,minmax(0,1fr)) minmax(150px,.7fr) minmax(0,1fr)}
    .app:not(.pub) .arb-col{display:flex;flex-direction:column;min-width:0;background:var(--d-s1);border:1px solid var(--d-line-2);border-radius:var(--d-r-card);overflow:hidden}
    .app:not(.pub) .arb-col-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 14px;border-bottom:1px solid var(--d-line);font:600 13px/1.2 var(--d-body);color:var(--d-ink)}
    .app:not(.pub) .arb-col-toggle{width:100%;background:none;border:0;border-bottom:1px solid var(--d-line);cursor:pointer;text-align:left;font-family:inherit}
    .app:not(.pub) .arb-col.collapsed .arb-col-toggle{border-bottom:0;color:var(--d-ink-3)}
    .app:not(.pub) .arb-n{font:500 12px/1 var(--d-body);color:var(--d-ink-4)}
    .app:not(.pub) .arb-cards{display:flex;flex-direction:column;gap:8px;padding:10px}
    .app:not(.pub) .arb-quick input{width:100%;height:36px;padding:0 10px}
    .app:not(.pub) .arb-card{display:flex;flex-direction:column;gap:8px;padding:12px;background:var(--d-s2);border:1px solid var(--d-line-2);border-radius:10px;transition:border-color var(--d-t-fast) ease}
    @media (hover:hover){ .app:not(.pub) .arb-card:hover{border-color:var(--d-line-3)} }
    .app:not(.pub) .arb-card-open{display:flex;flex-direction:column;align-items:flex-start;gap:5px;padding:0;background:none;border:0;color:inherit;text-align:left;cursor:pointer;font-family:inherit;min-width:0}
    .app:not(.pub) .arb-card-open:disabled{cursor:default}
    .app:not(.pub) .arb-card-top{display:flex;align-items:center;gap:6px;max-width:100%}
    .app:not(.pub) .arb-name{font:600 14px/1.3 var(--d-body);color:var(--d-ink);overflow-wrap:anywhere}
    /* a Board card's name: one line, cut with … (the whole name on hover), never broken mid-word */
    .app:not(.pub) .arb-card-top .arb-name{flex:0 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;overflow-wrap:normal}
    .app:not(.pub) .arb-card-top .arb-val{flex:none}
    .app:not(.pub) .arb-contact{font-size:12.5px;line-height:1.35;color:var(--d-ink-4);overflow-wrap:anywhere}
    .app:not(.pub) .arb-tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:2px}
    .app:not(.pub) .arb-money{font:500 12.5px/1.35 var(--d-body);color:var(--d-ink-2);font-variant-numeric:tabular-nums}
    .app:not(.pub) .arb-tracked{font-size:12px;line-height:1.35;color:var(--d-ink-4)}
    .app:not(.pub) .arb-chip{font-size:11px;padding:3px 9px;border-radius:100px;border:1px solid var(--d-line-2);color:var(--d-ink-3)}
    .app:not(.pub) .arb-chip.warn{background:var(--d-warn-bg);border-color:var(--d-warn-line);color:var(--d-warn)}
    .app:not(.pub) .arb-chip.neg{background:var(--d-neg-bg);border-color:var(--d-neg-line);color:var(--d-neg)}
    .app:not(.pub) .arb-move{width:100%;height:32px;padding:0 8px}
    .app:not(.pub) .arb-empty{margin:0;padding:4px 2px;font-size:13px;color:var(--d-ink-4)}
    .app:not(.pub) .arb-foot{display:flex;align-items:center;gap:8px;margin:16px 0 0;font-size:13px;color:var(--d-ink-4)}
    .app:not(.pub) .arb-foot .inline-link{padding:0;border:0;background:none;font:inherit;color:var(--d-ink-2);cursor:pointer;text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--d-line-3)}
    .app:not(.pub) .modal-card.arb-panel{max-width:920px;width:100%}
    .app:not(.pub) .arb-panel .modal-head{gap:10px} .app:not(.pub) .arb-panel .modal-head h3{flex:1;min-width:0}
    .app:not(.pub) .arb-panel-status{height:34px;padding:0 8px}
    .app:not(.pub) .arb-panel-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px}
    .app:not(.pub) .arb-panel .cat-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
    .app:not(.pub) .arb-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 16px}
    .app:not(.pub) .arb-follow{font-size:13px;color:var(--d-ink-3)}
    .app:not(.pub) .arb-money-tip{margin:0 0 16px;color:var(--d-ink-3)}   /* readable on the dark panel */
    .app:not(.pub) .adv-rate{margin:-8px 0 16px}
    .app:not(.pub) .ar-given-none{color:var(--d-ink-4);letter-spacing:0}
    .app:not(.pub) .ar-tile-cut{font-size:12.5px;line-height:1.35;color:var(--d-ink-3)}
    .app:not(.pub) .ar-client-tag{margin-left:6px;vertical-align:1px;align-self:flex-start}
    .app:not(.pub) .gainer[data-fall]{opacity:.62}   /* a fall under a "rise first" list: listed, not ranked */
    .app:not(.pub) .arb-err{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
    .app:not(.pub) .arb-history{list-style:none;margin:0;padding:0;border:1px solid var(--d-line-2);border-radius:10px;overflow:hidden}
    .app:not(.pub) .arb-history li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;border-bottom:1px solid var(--d-line);font-size:13px;line-height:1.45;color:var(--d-ink-2)}
    .app:not(.pub) .arb-history li:last-child{border-bottom:0}
    .app:not(.pub) .arb-when{color:var(--d-ink-4);font-variant-numeric:tabular-nums}
    .app:not(.pub) .modal-foot .arb-remove{margin-right:auto}
    .app:not(.pub) .arb-conflict{z-index:2}
    .app:not(.pub) .arb-off-row{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:12px 0;border-bottom:1px solid var(--d-line)}
    .app:not(.pub) .arb-off-row:last-child{border-bottom:0}
    .app:not(.pub) .arb-off-who{display:flex;flex-direction:column;gap:3px;min-width:0}
    .app:not(.pub) .arb-off-actions,.app:not(.pub) .arb-merge{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
    .app:not(.pub) .arb-merge select{height:32px;padding:0 8px;max-width:180px}
    .app:not(.pub) .arb-checks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
    .app:not(.pub) .arb-checks li{display:flex;gap:9px;align-items:flex-start;font-size:13.5px;line-height:1.45;color:var(--d-ink-2)}
    .app:not(.pub) .arb-checks li svg{flex:none;margin-top:2px} .app:not(.pub) .arb-checks li.ok svg{color:var(--d-pos)} .app:not(.pub) .arb-checks li.bad svg{color:var(--d-warn)}
    .app:not(.pub) .arb-checks li.bad span{color:var(--d-ink)}
    .app:not(.pub) .arb-checks li span{min-width:0;overflow-wrap:anywhere}   /* a quoted formula wraps instead of running off a phone */
    @media (max-width:1100px){
      /* narrower screens: the columns wrap two or three across instead of squeezing */
      .app:not(.pub) .arb-board,.app:not(.pub) .arb-board:has(.arb-col[data-col=other]){grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
    }
    @media (max-width:699px){
      /* phones: the columns stack as full-width sections, the panel goes full screen */
      .app:not(.pub) .arb-board,.app:not(.pub) .arb-board:has(.arb-col[data-col=other]){grid-template-columns:minmax(0,1fr)}
      .app:not(.pub) .arb-find{width:100%}
      .app:not(.pub) .arb-panel-grid{grid-template-columns:minmax(0,1fr);gap:8px}
      .app:not(.pub) .admin-head .arb-head-actions{width:100%}
      .app:not(.pub) .arb-head-actions .btn{flex:1 1 auto;justify-content:center}
      .app:not(.pub) .modal-card.arb-panel{max-width:none;max-height:100dvh;height:100dvh;border-radius:0}
      .app:not(.pub) .modal:has(.arb-panel){padding:0}
      .app:not(.pub) .arb-history li{flex-wrap:wrap}
    }
    /* A&R rebuild: Summary · Board · Watchlist (one plain sentence under each title) */
    .app:not(.pub) .ar-head{align-items:center}
    .app:not(.pub) .ar-head-text{display:flex;flex-direction:column;gap:4px;min-width:0}
    .app:not(.pub) .ar-sub{margin:0;font-size:13.5px;line-height:1.45;color:var(--d-ink-3)}
    .app:not(.pub) .ar-h3{margin:0;font:600 15px/1.3 var(--d-body);color:var(--d-ink)}
    .app:not(.pub) .ar-sum-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 0 10px}
    .app:not(.pub) .ar-summary > .ar-h3{margin:24px 0 10px}
    .app:not(.pub) .ar-gainer-pair{align-items:start}
    .app:not(.pub) .ar-ch{font-style:normal;font-variant-numeric:tabular-nums;white-space:nowrap}
    .app:not(.pub) .ar-ch.up{color:var(--d-pos)} .app:not(.pub) .ar-ch.down{color:var(--d-neg)}
    .app:not(.pub) .gainer-num b.ar-week{color:var(--d-ink);font-variant-numeric:tabular-nums;white-space:nowrap}
    .app:not(.pub) .ar-role{font-size:10.5px;padding:2px 7px}
    .app:not(.pub) .inline-link{padding:0;border:0;background:none;font:inherit;color:var(--d-ink-2);cursor:pointer;text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--d-line-3)}
    .app:not(.pub) .arb-board{grid-template-columns:repeat(5,minmax(0,1fr))}
    .app:not(.pub) .arb-board:has(.arb-col[data-col=other]){grid-template-columns:repeat(6,minmax(0,1fr))}
    .app:not(.pub) .arb-col-head{width:100%;flex-direction:column;align-items:flex-start;gap:3px;background:none;border:0;border-bottom:1px solid var(--d-line);text-align:left;font-family:inherit;cursor:default}
    .app:not(.pub) .arb-hint{font:400 12px/1.3 var(--d-body);color:var(--d-ink-4)}
    .app:not(.pub) .arb-col.over{border-color:var(--d-ink-3);background:var(--d-s2)}
    .app:not(.pub) .arb-board.dragging .arb-col{border-style:dashed}
    .app:not(.pub) .arb-card[draggable=true]{cursor:grab}
    .app:not(.pub) .arb-card.moving{opacity:.6}
    .app:not(.pub) .arb-sub{font-size:12px;color:var(--d-ink-4)}
    .app:not(.pub) .arb-card-acts{display:flex;align-items:center;gap:6px}
    .app:not(.pub) .arb-next{flex:1 1 0;min-width:0;justify-content:center;padding-inline:10px}
    /* 1280-1366: the card is too narrow for "Started talking →" on one line, so the words wrap inside the button
       (balanced, so the arrow never sits alone on the second line). .arb-card-acts .btn: outranks .btn.sm's height and size */
    @media (max-width:1366px){ .app:not(.pub) .arb-card-acts .btn.arb-next{height:auto;min-height:var(--d-ctl-sm);padding:5px 8px;font-size:12.5px;white-space:normal;text-wrap:balance;text-align:center;line-height:1.2;border-radius:14px} }
    .app:not(.pub) .arb-card .arb-card-top{flex-wrap:wrap}   /* the Artist/Producer tag drops under a long name instead of squeezing it */
    .app:not(.pub) .arb-dots{flex:none}
    .app:not(.pub) .arb-more{position:relative;display:inline-flex}
    .app:not(.pub) .arb-dots{min-width:34px;padding-inline:8px;justify-content:center}
    .app:not(.pub) .arb-menu{position:absolute;top:calc(100% + 4px);left:0;z-index:5;display:flex;flex-direction:column;min-width:190px;padding:4px;background:var(--d-s2);border:1px solid var(--d-line-3);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.35)}
    .app:not(.pub) .arb-card .arb-menu{left:auto;right:0}
    .app:not(.pub) .arb-menu.right{left:auto;right:0}
    .app:not(.pub) .arb-menu > button,.app:not(.pub) .arb-menu > a{padding:8px 10px;border:0;border-radius:7px;background:none;color:var(--d-ink-2);font:400 13px/1.3 var(--d-body);text-align:left;cursor:pointer;text-decoration:none}
    .app:not(.pub) .arb-menu > button:hover,.app:not(.pub) .arb-menu > a:hover{background:var(--d-s3);color:var(--d-ink)}
    .app:not(.pub) .arb-menu > button:disabled{opacity:.45;cursor:default}
    .app:not(.pub) .ar-watch-tools{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 14px}
    .app:not(.pub) .ar-watch-tools .gainer-tabs{margin-left:0}
    .app:not(.pub) .ar-show{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--d-ink-3)}
    .app:not(.pub) .ar-show select,.app:not(.pub) .ar-kind select{height:36px;padding:0 10px;background:var(--d-field);border:1px solid var(--d-line-2);border-radius:9px;color:var(--d-ink);font:400 13px var(--d-body)}
    .app:not(.pub) .ar-sort{padding:0;border:0;background:none;font:inherit;color:inherit;cursor:pointer;text-align:left}
    .app:not(.pub) .ar-sort.on{color:var(--d-ink)}
    .app:not(.pub) .admin-table.ar-watch-list .admin-row{grid-template-columns:var(--cols)}   /* its own columns, not the generic link-table's 7 */
    .app:not(.pub) .ar-who{display:flex;flex-direction:column;gap:2px;min-width:0}
    .app:not(.pub) .ar-watch-list .ar-who,.app:not(.pub) .ar-watch-list .ar-who > *{white-space:normal;overflow:visible}
    .app:not(.pub) .ar-watch-list .ar-row{padding-block:10px}
    .app:not(.pub) .ar-num{font-variant-numeric:tabular-nums}
    .app:not(.pub) .ar-period{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
    .app:not(.pub) .ar-totals{margin:0 0 16px}
    .app:not(.pub) .ar-totals-grid{grid-template-columns:repeat(6,minmax(0,1fr))}
    .app:not(.pub) .ar-how{margin:10px 0 0;font-size:13px;color:var(--d-ink-3)}
    .app:not(.pub) .ar-how summary{cursor:pointer;color:var(--d-ink-2)} .app:not(.pub) .ar-how p{margin:6px 0 0;line-height:1.5}
    .app:not(.pub) .ar-budget{margin:8px 0 0}
    .app:not(.pub) .ar-panel-extra{margin:16px 0 0} .app:not(.pub) .ar-nums{margin:0 0 10px;font-size:13px}
    .app:not(.pub) .ar-kind{margin:0 0 14px}
    @media (max-width:1100px){
      .app:not(.pub) .ar-totals-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
      .app:not(.pub) .arb-board,.app:not(.pub) .arb-board:has(.arb-col[data-col=other]){grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
    }
    @media (max-width:699px){
      /* phones: stacked full-width sections that fold ("Talking · 2"), the first non-empty one open; no dragging */
      .app:not(.pub) .arb-board,.app:not(.pub) .arb-board:has(.arb-col[data-col=other]){grid-template-columns:minmax(0,1fr)}
      .app:not(.pub) .arb-col-head{cursor:pointer}
      .app:not(.pub) .arb-col.folded .arb-cards{display:none}
      .app:not(.pub) .arb-col.folded .arb-col-head{border-bottom:0}
      .app:not(.pub) .arb-col.folded .arb-hint{display:none}
      .app:not(.pub) .ar-totals-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
      .app:not(.pub) .ar-sum-head{flex-wrap:wrap}
    }
    /* ---- polish: one colour system. Area colours say which part of the business (To do labels and
       bars, the active nav icon, nav badges); they never go on numbers */
    .app:not(.pub) [data-area=luminate]{--area:var(--d-a-lum)} .app:not(.pub) [data-area=roster]{--area:var(--d-a-pub)}
    .app:not(.pub) [data-area=money]{--area:var(--d-a-money)} .app:not(.pub) [data-area=ar]{--area:var(--d-a-ar)}
    .app:not(.pub) [data-area=clickup]{--area:var(--d-a-cu)} .app:not(.pub) [data-area=site]{--area:var(--d-a-site)}
    .app:not(.pub) .dash-side nav button.active[data-area] svg{color:var(--area)}
    .app:not(.pub) .dash-side nav button[data-area] .nav-badge{background:var(--area);color:#000;-webkit-text-fill-color:#000}
    /* the week pill: the same on every page */
    .app:not(.pub) .wow-pill{display:inline-flex;align-items:center;height:24px;padding:0 8px;border-radius:100px;font:600 13px/1 var(--d-body);font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--d-pos);background:var(--d-pos-bg);border:1px solid var(--d-pos-line)}
    .app:not(.pub) .wow-pill[data-dir=down]{color:var(--d-neg);background:var(--d-neg-bg);border-color:var(--d-neg-line)}
    .app:not(.pub) .wow-pill[data-dir=flat]{color:var(--d-ink-3);background:transparent;border-color:var(--d-line-2)}
    .app:not(.pub) .wow-pill.big{height:28px;font-size:15px}
    /* Dashboard: the money strip, To do beside This week, then Money. From 900px each card stops
       growing and its body scrolls (fading at the foot while there's more); under 900 nothing scrolls
       inside the page: lists stop at 4 rows with "Show N more" */
    .app:not(.pub) .home .admin-head{align-items:baseline}
    .app:not(.pub) .home-src{flex:none;font-size:12px;color:var(--d-ink-4)}
    .app:not(.pub) .home-money-row .cat-summary-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
    .app:not(.pub) .home-row{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:12px;margin:0 0 12px;align-items:stretch}
    .app:not(.pub) .home-row > .home-card{align-self:stretch}
    .app:not(.pub) .home-money-card{margin:0 0 12px}
    .app:not(.pub) .home-more{display:flex;margin:10px auto 12px}
    @media (min-width:900px){
      .app:not(.pub) .home-row > .home-card{max-height:452px}   /* the taller card sets the row, never past 452 */
      .app:not(.pub) .home-money-card{max-height:380px}
      .app:not(.pub) .home-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#3a3a3c transparent}
      .app:not(.pub) .home-scroll[data-more]{-webkit-mask-image:linear-gradient(#000 calc(100% - 24px),transparent);mask-image:linear-gradient(#000 calc(100% - 24px),transparent)}
      .app:not(.pub) .home-scroll-foot{flex:none;display:flex;align-items:center;justify-content:center;gap:6px;width:100%;height:34px;border:0;border-top:1px solid var(--d-line);border-radius:0 0 var(--d-r-card,12px) var(--d-r-card,12px);
        background:var(--d-s1);font:500 12.5px/1 var(--d-body);color:var(--d-ink-2);cursor:pointer}
      @media (hover:hover){ .app:not(.pub) .home-scroll-foot:hover{color:var(--d-ink);background:var(--d-s2)} }
      .app:not(.pub) .home-more{display:none}
      .app:not(.pub) .home-money-card .acct-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
    }
    @media (max-width:899px){
      .app:not(.pub) .home-row{grid-template-columns:minmax(0,1fr)}
      .app:not(.pub) .home-scroll-foot{display:none}   /* phones list N rows and "Show N more" instead */
      .app:not(.pub) .home-scroll:not(.open) .over{display:none}   /* a scroll box inside a scrolling page traps the thumb */
      .app:not(.pub) .home-money-card .acct-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
    }
    /* One screen (the owner's ask): from 900px wide and 640px tall the Dashboard fits the window with no
       page scroll. The head and a slim money strip on top, then To do over Money on the left and This
       week down the right, sharing what's left of the window; each card keeps its head and scrolls inside
       (fade + "N more" at the foot). Lower or narrower windows scroll the page as before. The DOM is
       unchanged: .home-row steps aside (display:contents) so its two cards sit in the page's grid. */
    .app:not(.pub) .home-money-row{position:relative}
    .app:not(.pub) .home-money-info{display:none}
    .app:not(.pub) .home-scroll [data-cut]{visibility:hidden}   /* a label in the foot's fade waits until it's fully in view */
    @media (min-width:900px){
      /* the strip's note: an (i) at its top right that shows the line on hover or keyboard focus */
      .app:not(.pub) .home-money-row .cat-stat{gap:4px;padding:10px 18px 11px}
      .app:not(.pub) .home-money-row .cat-stat-val{font-size:clamp(18px,8cqi,22px)}
      .app:not(.pub) .home-money-info{position:absolute;top:7px;right:8px;z-index:2;display:inline-grid;place-items:center;width:26px;height:26px;border-radius:50%;color:var(--d-ink-4);cursor:help;outline-offset:2px}
      .app:not(.pub) .home-money-info:is(:hover,:focus-visible){color:var(--d-ink);background:var(--d-active)}
      .app:not(.pub) .home-money-row .home-money-note{position:absolute;top:calc(100% + 6px);right:0;z-index:40;width:min(380px,calc(100% - 12px));margin:0;padding:10px 12px;
        border:1px solid var(--d-line-2);border-radius:var(--d-r-md);background:var(--d-s2);box-shadow:var(--d-shadow-pop);color:var(--d-ink-2);font-size:13px;line-height:1.45;
        opacity:0;visibility:hidden;pointer-events:none;transition:opacity var(--d-t-fast) ease,visibility var(--d-t-fast)}
      .app:not(.pub) .home-money-info:is(:hover,:focus) + .home-money-note{opacity:1;visibility:visible}
    }
    @media (min-width:900px) and (min-height:640px){
      .app:not(.pub) .dash-main:has(> .home){padding-bottom:20px}
      .app:not(.pub) .home{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);grid-template-rows:auto auto minmax(0,auto) minmax(200px,1fr);gap:12px;
        height:calc(100vh - 52px);height:calc(100dvh - 52px)}   /* the page's 32px top and 20px bottom padding */
      .app:not(.pub):has(> .storage-warn) .home{height:calc(100dvh - 52px - var(--d-ban-h))}
      .app:not(.pub) .home > :is(.admin-head,.home-money-row,.home-money){grid-column:1 / -1;margin:0}
      .app:not(.pub) .home-row{display:contents}
      /* To do (the longest list) takes the whole left column; This week sits top-right at its own
         height (its top 5), and Money gets the rest of the right column under it */
      .app:not(.pub) .home-row > .todo{grid-column:1;grid-row:3 / span 2;min-height:0}
      .app:not(.pub) .home-row > .todo.clear{align-self:start}   /* "All caught up" stays one line */
      .app:not(.pub) .home-row > .gainers{grid-column:2;grid-row:3;min-height:0}
      .app:not(.pub) .home > .home-money-card{grid-column:2;grid-row:4;min-height:0;margin:0}
      .app:not(.pub) .home .home-card{max-height:none}
      .app:not(.pub) .home .home-card > .attn-head{flex:none}   /* the head never gives way to the list */
      .app:not(.pub) .home-money-card{container-type:inline-size}
      @container (max-width:560px){ .app:not(.pub) .pay-all-w{display:none} }
      @container (max-width:500px){ .app:not(.pub) .money-tabs .tab-the{display:none} }   /* "Not in sheet" keeps the head on one line at 1280 */
      /* Not in the sheet's head sits above the list. On a short window (1366x768, 1280x800) the card is
         small: the head is one line ("Add these 5 · $… paid", Log all 5) and the column labels go, so a
         whole payment row shows without scrolling */
      .app:not(.pub) .home-money-card .acct-unlogged-top{flex:none}
      .app:not(.pub) .home-money-card .acct-log-all{flex:none}
      @media (max-height:820px){
        .app:not(.pub) .home-money-card .acct-unlogged-top .acct-unlogged-head{flex-wrap:nowrap}
        .app:not(.pub) .home-money-card .acct-unlogged-top .acct-unlogged-head > span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .app:not(.pub) .acct-hd-w{display:none}
        .app:not(.pub) .home-money-card .acct-row-hd{display:none}
      }
    }
    /* below 1400 the two columns share evenly, so Money's head (tabs + "All (N) ›") fits on one line */
    @media (min-width:900px) and (max-width:1399px) and (min-height:640px){
      .app:not(.pub) .home{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
    }
    /* To do: caps labels in each area's colour, a 3px bar on each row */
    .app:not(.pub) .todo .attn-head svg{color:var(--d-warn)}
    .app:not(.pub) .todo.clear .attn-head svg{color:var(--d-pos)}
    .app:not(.pub) .todo-done{display:inline-flex;align-items:center;gap:6px;color:var(--d-pos);font-weight:500}
    .app:not(.pub) .todo-group{padding:14px 16px 6px;font:600 11px/1.2 var(--d-body);letter-spacing:.08em;text-transform:uppercase;color:var(--area)}
    .app:not(.pub) .todo .attn-row,.app:not(.pub) .todo .cu-row{box-shadow:inset 3px 0 0 var(--area,var(--d-a-cu));border-bottom:0;border-top:1px solid var(--d-line)}
    .app:not(.pub) .todo :is(.todo-group,.todo-sub) + :is(.attn-row,.cu-row){border-top-color:transparent}
    .app:not(.pub) .todo .attn-row{min-height:56px;padding:9px 12px 9px 16px}
    .app:not(.pub) .todo .cu-row{min-height:52px}
    .app:not(.pub) .attn-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
    .app:not(.pub) .attn-main b{font-size:14px;font-weight:500;line-height:1.35;color:var(--d-ink);white-space:normal;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}   /* two lines: the end ("since Oct 21") is often the point */
    .app:not(.pub) .attn-main em{font-style:normal;font-size:12.5px;line-height:1.35;color:var(--d-ink-4);white-space:normal;overflow-wrap:anywhere}   /* wraps in full: the detail is often the fix (the card scrolls) */
    .app:not(.pub) .attn-chev{display:none}
    .app:not(.pub) .todo-sub{display:flex;flex-wrap:wrap;align-items:center;gap:0 4px;padding:8px 16px 6px;font-size:12px;color:var(--d-ink-4)}
    .app:not(.pub) .todo-sub .inline-link{font-size:12px;color:var(--d-ink-3)}
    .app:not(.pub) .todo-line{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;margin:0;padding:10px 16px 12px;font-size:12.5px;line-height:1.45;color:var(--d-ink-4)}
    .app:not(.pub) .todo-line svg{flex:none}
    .app:not(.pub) .todo-line .inline-link{font-size:12.5px}
    @media (max-width:599px){
      /* phones: a whole task row is the button, with a › instead of the pill */
      .app:not(.pub) .home .attn-row{flex-direction:row;align-items:center}
      .app:not(.pub) .home .attn-row[data-task]{cursor:pointer}
      .app:not(.pub) .home .attn-row[data-task] .btn{display:none}
      .app:not(.pub) .home .attn-row[data-task] .attn-chev{display:block;flex:none;color:var(--d-ink-4)}
      .app:not(.pub) .home-money-row .cat-stat-val{font-size:16px}
      /* this month's label stays on one line: its tile takes the whole first row, the other two share the next (no money words in CSS: the portal's leak check reads the page text) */
      .app:not(.pub) .home-money-row .cat-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
      .app:not(.pub) .home-money-row .cat-stat:first-child{grid-column:1 / -1}
      .app:not(.pub) .home-money-row .cat-stat:last-child:nth-child(odd){grid-column:auto}
      .app:not(.pub) .home-money-row .cat-stat{padding:12px}
      .app:not(.pub) .home-money-row .cat-stat-label{white-space:nowrap}
      /* To do on phones: every headline and detail line shows whole (wraps, never cut) */
      .app:not(.pub) .home .attn-main :is(b,em){white-space:normal;overflow:visible;text-overflow:clip;display:block;-webkit-line-clamp:unset}
      .app:not(.pub) .home-src{flex-basis:100%}
    }
    @media (hover:hover){ .app:not(.pub) .home .attn-row[role=button]:hover{background:var(--d-hover)} }
    /* This week: the subtitle with its dates, the pill over this week's streams, the no-% rows under a caption */
    .app:not(.pub) .gainer-sub{margin:0;padding:10px 16px 6px;font-size:12px;color:var(--d-ink-4)}
    .app:not(.pub) .gainer-num b{color:inherit}
    .app:not(.pub) .gainer-num em{font-size:12px}
    .app:not(.pub) .gainer-num[data-wow=none] em{font-size:12.5px}
    .app:not(.pub) .gainer-split{margin:4px 0 0;padding:10px 16px 6px;border-top:1px solid var(--d-line-2);font-size:11px;color:var(--d-ink-4)}
    .app:not(.pub) .gainer-split + .gainer{border-top:0}
    .app:not(.pub) .gainers .gainer:last-of-type{border-bottom:0}
    .app:not(.pub) .gainers-noweek{display:flex;align-items:flex-start;gap:8px;margin:0;padding:12px 16px;border-top:1px solid var(--d-line-2);font-size:12.5px;line-height:1.5;color:var(--d-ink-3)}
    .app:not(.pub) .gainers-noweek > i{flex:none;width:7px;height:7px;margin-top:6px;border-radius:50%;background:var(--d-warn)}
    .app:not(.pub) .gainers-noweek .inline-link{font-size:12.5px}
    /* Money: Payments · Accounting · Not in the sheet */
    .app:not(.pub) .home-money-card .attn-head{flex-wrap:wrap;row-gap:10px}
    .app:not(.pub) .money-tabs{margin-left:8px}
    .app:not(.pub) .money-tabs button{display:inline-flex;align-items:center;gap:6px}
    .app:not(.pub) .money-tabs .attn-n{height:16px;min-width:16px;padding:0 5px;font-size:10.5px}
    .app:not(.pub) .pay-legend{margin:0;padding:10px 16px 4px;font-size:12px;color:var(--d-ink-4)}
    .app:not(.pub) .pay-flag{color:var(--d-warn);white-space:nowrap}
    .app:not(.pub) .pay-amt b{font-variant-numeric:tabular-nums}
    .app:not(.pub) .home-money-card .acct-grid{margin:14px 16px}
    .app:not(.pub) .home-money-card .acct-grid .cat-stat{justify-content:flex-start}   /* values line up across the row; a note sits under its own */
    .app:not(.pub) .acct-note{font-size:12px;line-height:1.35;color:var(--d-ink-4)}
    .app:not(.pub) .home-money-card .acct-unlogged{margin:0;border:0;border-radius:0;background:none}
    .app:not(.pub) .home-money-card .acct-unlogged-head{padding:12px 16px 8px;border-bottom:0;font-size:13.5px;font-weight:500;color:var(--d-ink)}
    .app:not(.pub) .home-money-card .acct-row{padding:8px 16px}
    .app:not(.pub) .acct-row-hd{padding-block:4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--d-ink-4)}
    .app:not(.pub) .acct-amt{text-align:right}
    .app:not(.pub) .home-money-card .acct-unlogged .hint{padding:10px 16px 14px}
    @media (max-width:599px){.app:not(.pub) .home-money-card .acct-unlogged .hint{padding:8px 16px 10px}}   /* the card opens here on phones too: keeps it under 560px */
    /* one-click logging: a Log it on each row, Log all in the head, the confirm's rows */
    .app:not(.pub) .home-money-card .acct-unlogged-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
    .app:not(.pub) .home-money-card .acct-row{grid-template-columns:64px minmax(0,1fr) auto auto;align-items:center}
    .app:not(.pub) .acct-log,.app:not(.pub) .pay-log{padding:3px 10px;font-size:12px}
    .app:not(.pub) .pay-row .pay-log{flex:none;align-self:center}
    .app:not(.pub) .log-modal{max-width:640px}
    .app:not(.pub) .log-lead{margin:0 0 10px;font-size:13.5px;line-height:1.5;color:var(--d-ink-2)}
    .app:not(.pub) .log-table{border:1px solid var(--d-line);border-radius:var(--d-r-md);overflow:hidden}
    .app:not(.pub) .log-tr{display:grid;grid-template-columns:116px minmax(0,1fr) minmax(0,1.1fr) 112px;gap:10px;padding:8px 12px;border-top:1px solid var(--d-line);font-size:13px;color:var(--d-ink)}
    .app:not(.pub) .log-tr:first-child{border-top:0}
    .app:not(.pub) label.log-tr{cursor:pointer;align-items:center}
    .app:not(.pub) .log-tr .acct-who{white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere}   /* the Test chip stays in view */
    .app:not(.pub) label.log-tr:hover{background:var(--d-hover)}
    .app:not(.pub) .log-th > :first-child{padding-left:24px}   /* over the date, past the tick box */
    .app:not(.pub) .log-date{display:flex;align-items:center;gap:8px;white-space:nowrap}
    .app:not(.pub) .log-date input{flex:none;width:16px;height:16px;margin:0;accent-color:var(--d-ink)}
    .app:not(.pub) .log-tr.off > :not(.log-date), .app:not(.pub) .log-tr.off .log-date{color:var(--d-ink-4);text-decoration:line-through;text-decoration-color:var(--d-line-3)}
    .app:not(.pub) .pay-test{display:inline-block;padding:0 6px;border:1px solid var(--d-line-2);border-radius:999px;font-size:11px;font-weight:500;line-height:16px;letter-spacing:.02em;color:var(--d-ink-3);text-decoration:none;vertical-align:1px}
    .app:not(.pub) .log-tr em{font-style:normal;color:var(--d-ink-4)}
    .app:not(.pub) .log-th{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--d-ink-4);background:var(--d-hover)}
    .app:not(.pub) .log-acct{margin:10px 0 0}
    .app:not(.pub) .log-skipped{margin:10px 0 0;padding-left:18px;font-size:13px;line-height:1.5;color:var(--d-warn)}
    .app:not(.pub) .log-done{display:flex;align-items:flex-start;gap:8px;margin:0;font-size:14px;line-height:1.5;color:var(--d-ink)}
    .app:not(.pub) .log-done svg{flex:none;margin-top:3px;color:var(--d-pos)}
    @media (max-width:599px){
      .app:not(.pub) .log-tr{grid-template-columns:100px minmax(0,1fr) 84px;row-gap:2px}
      .app:not(.pub) .log-tr > :nth-child(3){grid-row:2;grid-column:2;font-size:12px;color:var(--d-ink-3)}   /* the revenue type goes under who */
    }
    .app:not(.pub) .home-money-card > .home-scroll > .home-muted{padding:14px 16px}
    @media (max-width:599px){
      .app:not(.pub) .money-tabs{order:3;margin-left:0;width:100%;overflow-x:auto;scrollbar-width:none}
      .app:not(.pub) .money-tabs button{flex:1 0 auto}
      .app:not(.pub) .home-money-card .pay-main > span{white-space:normal}   /* "Not in the sheet yet" wraps instead of being cut off */
    }
    /* Luminate: an old export's line is amber; Website's sections are second level under its title */
    .app:not(.pub) .lm-port-old{color:var(--d-warn)}
    .app:not(.pub) .website-main .admin-head:not(.website-head) h2{margin:0;padding:0;font:400 14px/1.2 var(--d-display);font-synthesis:none;letter-spacing:.08em;text-transform:uppercase;color:var(--d-ink);background:none;-webkit-text-fill-color:currentColor}
    /* Publishing overview: the This week column (pill over streams) and sortable heads */
    .app:not(.pub) .master-tools{display:flex;justify-content:flex-end;margin:0 0 8px}
    .app:not(.pub) .master-table th .ar-sort{text-align:inherit;white-space:nowrap}
    .app:not(.pub) .master-table td.master-week{height:auto;padding-block:8px;white-space:nowrap}
    .app:not(.pub) .master-week em{display:block;margin-top:3px;font-style:normal;font-size:12px;color:var(--d-ink-4)}
    .app:not(.pub) .master-week-of{display:block;margin-top:2px;font-size:11px;font-weight:400;letter-spacing:0;text-transform:none;white-space:nowrap;color:var(--d-ink-4)}
    /* the table without its forecast columns fits beside the client list at 1280 and up: it no longer
       stretches to its widest (max-content), so heads wrap to two lines ("Gross / streams") and the
       week's dates under "This week" wrap too; figures stay on one line. The forecast columns still scroll. */
    .app:not(.pub) .master-table{min-width:0}
    .app:not(.pub) .master-table th,.app:not(.pub) .master-table td{padding:0 9px}
    .app:not(.pub) .master-table td:first-child{max-width:150px;overflow:hidden;text-overflow:ellipsis}   /* a long writer name ends in … (its row title says it whole) */
    @media (min-width:1200px) and (max-width:1399px){ .app:not(.pub) .catalog-wrap{grid-template-columns:224px minmax(0,1fr);gap:20px} }   /* room for the table at 1280 */
    .app:not(.pub) .master-table thead th{height:auto;padding-block:8px;white-space:normal;vertical-align:bottom;letter-spacing:.04em;line-height:1.3}
    .app:not(.pub) .master-table th .ar-sort{white-space:normal}
    .app:not(.pub) .master-week-of{white-space:normal;min-width:7em}
    .app:not(.pub) .muted-dash{color:var(--d-ink-off)}
    /* ---- polish: A&R. Stage colours live here only (they reuse the area hexes on purpose: cool → hot →
       green, never red or amber, which mean "down" and "needs attention"); one pill per stage everywhere ---- */
    .app:not(.pub) .ar{--d-st-reach:#a3a3a3;--d-st-reached:#6fd6c4;--d-st-talking:#c4a7ff;--d-st-offer:#f29bc8;--d-st-signed:#8fce8f;--d-st-passed:#8a8a8a}
    .app:not(.pub) .ar [data-stage=reach]{--st:var(--d-st-reach)} .app:not(.pub) .ar [data-stage=reached]{--st:var(--d-st-reached)}
    .app:not(.pub) .ar [data-stage=talking]{--st:var(--d-st-talking)} .app:not(.pub) .ar [data-stage=offer]{--st:var(--d-st-offer)}
    .app:not(.pub) .ar [data-stage=signed]{--st:var(--d-st-signed)} .app:not(.pub) .ar [data-stage=passed]{--st:var(--d-st-passed)}
    .app:not(.pub) .ar [data-stage=other]{--st:var(--d-ink-4)}
    .app:not(.pub) .ar-stage{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 9px 0 8px;border-radius:100px;font:500 12px/1 var(--d-body);white-space:nowrap;
      color:var(--st);background:color-mix(in srgb,var(--st) 12%,transparent);border:1px solid color-mix(in srgb,var(--st) 30%,transparent)}
    .app:not(.pub) .ar-stage::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:currentColor}
    .app:not(.pub) .ar-stage[data-stage=passed]{background:none}
    .app:not(.pub) .ar-stage[data-stage=other]{background:none;border:1px dashed var(--d-line-3);color:var(--d-ink-3)}
    .app:not(.pub) .ar-stage b{margin-left:2px;font-weight:600;color:var(--d-ink);font-variant-numeric:tabular-nums}
    /* Summary: the pipeline strip (opens the Board), the movers, To do with an urgency dot per row */
    .app:not(.pub) .ar-strip{display:flex;align-items:center;gap:8px;width:100%;margin:0 0 24px;padding:10px 14px 10px 12px;border:1px solid var(--d-line-2);border-radius:var(--d-r-card);
      background:var(--d-s1);color:inherit;font:inherit;text-align:left;cursor:pointer;overflow-x:auto;scrollbar-width:none;transition:border-color var(--d-t-fast) ease}
    .app:not(.pub) .ar-strip::-webkit-scrollbar{display:none}
    .app:not(.pub) .ar-strip > .ar-stage{flex:none}
    .app:not(.pub) .ar-strip-val{flex:none;margin-left:auto;padding-left:12px;font:600 13.5px/1 var(--d-body);color:var(--d-ink);white-space:nowrap;font-variant-numeric:tabular-nums}
    @media (hover:hover){ .app:not(.pub) .ar-strip:hover{border-color:var(--d-line-3)} }
    .app:not(.pub) .ar-strip:focus-visible{outline:1px solid #f5f5f5;outline-offset:2px}
    .app:not(.pub) .ar-h3-sub{font-weight:400;font-size:13px;color:var(--d-ink-4)}
    .app:not(.pub) .ar-summary .ar-gainer-pair{align-items:start}
    .app:not(.pub) .ar-summary .ar-gainers{align-self:start;height:auto}
    .app:not(.pub) .ar-gainers .gainer{min-height:60px}
    /* while loading, side by side: about 5 rows, so To do doesn't jump down when they arrive (once loaded each card is
       its own height: no empty space under a short list; a phone shows one list at a time) */
    @media (min-width:700px){ .app:not(.pub) .ar-summary .ar-gainers[data-wait]{min-height:341px} }
    .app:not(.pub) .dirty-bar{flex:none;display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:10px 22px;border-top:1px solid var(--d-warn-line);background:var(--d-warn-bg);font-size:13.5px;color:var(--d-ink)}
    .app:not(.pub) .dirty-bar > span{margin-right:auto;font-weight:600}
    @media (max-width:700px){
      /* phones: every tap target at least 40px tall, and nothing moves for it (easy-spec B9): text links grow
         an invisible 12px above and below, the Luminate tick gets a 44px box over the same 28px slot */
      .app:not(.pub) .dash-main .inline-link:not(.song-detail-top .inline-link){padding-block:12px;margin-block:-12px}
      .app:not(.pub) .lm-tick{width:44px;height:44px;margin:-8px}
      .app:not(.pub) .arb-find,.app:not(.pub) .dash-main input[type=search]{height:40px}
    }
    .app:not(.pub) .ar-prefill-nums{margin:0 0 8px;font-size:13.5px;color:var(--d-ink-2);font-variant-numeric:tabular-nums}
    .app:not(.pub) .ar-gainers .gainer-n{color:var(--d-ink-4)} .app:not(.pub) .ar-gainers .gainer:not([data-ranked]) .gainer-n{color:var(--d-ink-off)}
    .app:not(.pub) .ar-g-sub{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px}
    .app:not(.pub) .ar-gainers .gainer-num em{font-style:normal;font-size:12px;color:var(--d-ink-4);white-space:nowrap}
    .app:not(.pub) .ar-gainers .gainer-num[data-wow=none] em{font-size:12.5px}
    .app:not(.pub) .ar-gainer-toggle{margin:0 0 10px}
    .app:not(.pub) .ar-summary > .ar-todo-h{display:flex;align-items:center;gap:8px;margin:28px 0 10px}
    .app:not(.pub) .ar-todo-clear .todo-done{font-size:13.5px}
    .app:not(.pub) .ar-tasks .attn-row{justify-content:flex-start}
    .app:not(.pub) .ar-tasks .attn-row > span{flex:1;min-width:0}
    .app:not(.pub) .ar-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--d-info)}
    .app:not(.pub) .ar-dot[data-urg=late]{background:var(--d-neg)} .app:not(.pub) .ar-dot[data-urg=soon]{background:var(--d-warn)}
    /* Watchlist and the Board's list: their own rows (not the generic link table), every cell named by
       data-col; numbers right-aligned under right-aligned heads; the head row stays on screen */
    .app:not(.pub) .ar-link{position:relative;width:100%;background:none;border:0;border-bottom:1px solid var(--d-line);color:var(--d-ink-3);font-family:inherit;text-align:left;cursor:pointer;transition:background-color .6s ease}
    .app:not(.pub) .ar-link:last-child{border-bottom:0}
    @media (hover:hover){ .app:not(.pub) .ar-link:hover{background:var(--d-hover);transition-duration:var(--d-t-fast)} }
    .app:not(.pub) .ar-link:focus-visible{outline:1px solid #f5f5f5;outline-offset:-1px}
    .app:not(.pub) .ar-link.ar-flash{background:var(--d-active);box-shadow:inset 3px 0 0 var(--d-a-ar);transition:none}   /* a Summary click lands here; it fades back */
    .app:not(.pub) .ar-table .admin-row{grid-template-columns:var(--cols)}
    .app:not(.pub) .ar-table :is([data-col=pct],[data-col=week],[data-col=atd],[data-col=value]){text-align:right;font-variant-numeric:tabular-nums}
    .app:not(.pub) .ar-sort{font:inherit;text-transform:inherit;letter-spacing:inherit;color:inherit;text-align:inherit}
    @media (hover:hover){ .app:not(.pub) .ar-sort:hover{color:var(--d-ink)} }
    .app:not(.pub) .ar-table .cell[data-col=week] b{font-weight:inherit;color:var(--d-ink-2)}
    .app:not(.pub) .ar-table .cell[data-col=week] em{display:none;font-style:normal}
    .app:not(.pub) .ar-table .cell:is([data-col=stage],[data-col=pct]){overflow:visible}
    .app:not(.pub) .ar-table .admin-hd > span{white-space:nowrap}
    @media (min-width:700px){ .app:not(.pub) .ar-table [data-col=stage]{padding-left:12px} }   /* a breath after the right-aligned numbers */
    .app:not(.pub) .admin-table.ar-watch-list{overflow:clip}   /* clip, not hidden, so the sticky head can stick */
    .app:not(.pub) .ar-watch-list .admin-hd{position:sticky;top:0;z-index:1;background:var(--d-s1)}
    .app:not(.pub) .ar-table .ar-who{gap:3px}
    .app:not(.pub) .ar-table .ar-who strong{font-weight:500;color:var(--d-ink)}
    .app:not(.pub) .ar-who-sub{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;font-size:12.5px;line-height:1.35;font-weight:400;color:var(--d-ink-4)}
    .app:not(.pub) .ar-lum-chip{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:100px;border:1px solid var(--d-info-line);background:var(--d-info-bg);
      color:var(--d-info);font:500 11.5px/1 var(--d-body);white-space:nowrap;cursor:pointer}
    @media (hover:hover){ .app:not(.pub) .ar-lum-chip:hover{border-color:var(--d-info)} }
    .app:not(.pub) .ar-add-hint{position:absolute;right:12px;top:50%;transform:translateY(-50%);padding:5px 10px;border:1px solid var(--d-line-3);border-radius:100px;background:var(--d-s2);
      font:500 12px/1 var(--d-body);color:var(--d-ink-2);opacity:0;pointer-events:none;transition:opacity var(--d-t-fast) ease}
    .app:not(.pub) .ar-link:is(:hover,:focus-visible) .ar-add-hint{opacity:1}
    .app:not(.pub) .ar-period{color:var(--d-ink-3)}
    .app:not(.pub) .ar-totals .cat-summary-grid.ar-totals-grid:has(> .cat-stat){grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr)}
    @media (max-width:699px){ .app:not(.pub) .ar-totals .cat-summary-grid.ar-totals-grid:has(> .cat-stat){grid-template-columns:repeat(2,minmax(0,1fr))} }
    .app:not(.pub) .ar-how-nums{display:flex;flex-wrap:wrap;gap:4px 18px} .app:not(.pub) .ar-how-nums b{font-weight:600;color:var(--d-ink-2)}
    .app:not(.pub) .ar-kind{display:flex;margin:0 0 16px} .app:not(.pub) .ar-kind button{flex:1;height:32px;padding:0 16px;font-size:13px}
    @media (min-width:700px) and (max-width:899px){
      /* the generic phone list rows start at 899; these tables keep their columns down to 700 */
      .app:not(.pub) .ar-table .admin-hd{display:grid}
      .app:not(.pub) .ar-table .admin-row:not(.admin-hd){display:grid;min-height:52px;padding:8px 12px 8px 16px;column-gap:16px}
      .app:not(.pub) .ar-table .admin-row:not(.admin-hd) > .cell{order:0;max-width:none;font-size:14px;line-height:24px;font-weight:400}
      .app:not(.pub) .ar-table .admin-row:not(.admin-hd) > .cell::before,.app:not(.pub) .ar-table .admin-row:not(.admin-hd)::after{content:none}
    }
    @media (max-width:699px){
      /* phones: each row is two lines; the name over its subtitle, the % pill over "N this week". The
         long prefix outranks the generic phone list rows (their "·" joins, 70% caps and nth-child hides) */
      .app:not(.pub) .admin-table.ar-table .admin-row.ar-link:not(.admin-hd):not(.admin-row-link){display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto auto;column-gap:12px;row-gap:3px;align-items:center;min-height:60px;padding:10px 14px}
      .app:not(.pub) .admin-table.ar-table .admin-row.ar-link:not(.admin-hd):not(.admin-row-link) > .cell{order:0;flex:none;max-width:none;min-width:0;overflow:visible}
      .app:not(.pub) .admin-table.ar-table .admin-row.ar-link:not(.admin-hd):not(.admin-row-link) > .cell::before,.app:not(.pub) .admin-table.ar-table .admin-row.ar-link:not(.admin-hd):not(.admin-row-link)::after{content:none}
      .app:not(.pub) .admin-table.ar-table .ar-link > .cell[data-col=name]{grid-column:1;grid-row:1 / span 2;font-size:15px;line-height:22px;overflow:hidden}
      .app:not(.pub) .admin-table.ar-table .ar-link > .cell:is([data-col=pct],[data-col=stage]){grid-column:2;grid-row:1;justify-self:end}
      .app:not(.pub) .admin-table.ar-table .ar-link > .cell:is([data-col=week],[data-col=value]){grid-column:2;grid-row:2;justify-self:end;font-size:12px;line-height:16px;color:var(--d-ink-4);white-space:nowrap}
      .app:not(.pub) .admin-table.ar-table .ar-link > .cell:is([data-col=atd],[data-col=contact],[data-col=follow]){display:none}
      .app:not(.pub) .admin-table.ar-watch-list .ar-link > .cell:is([data-col=stage],[data-col=value]){display:none}
      .app:not(.pub) .ar-table .cell[data-col=week] em{display:inline}
      .app:not(.pub) .ar-table .cell[data-col=week] b{color:var(--d-ink-3)}
      .app:not(.pub) .ar-table .cell[data-col=week] .muted-dash{display:none}
      .app:not(.pub) .admin-table.ar-table .ar-link > .cell[data-col=pct]:has(.muted-dash){display:none}
      .app:not(.pub) .admin-table.ar-table .ar-link:has(> [data-col=pct] .muted-dash) > .cell[data-col=week]{grid-row:1 / span 2}
      .app:not(.pub) .ar-add-hint{display:none}
      .app:not(.pub) .ar-totals-grid > .cat-stat:first-child{grid-column:1 / -1}
      .app:not(.pub) .ar-totals-grid > .cat-stat:last-child:nth-child(odd){grid-column:auto}   /* the total spans; the other two share a row */
      .app:not(.pub) .ar-watch-tools .arb-find{flex:1 1 100%}
      /* Summary: the strip fades at the edge while it scrolls; a task row is dot | text, its button under the text */
      .app:not(.pub) .ar-strip{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent)}
      .app:not(.pub) .ar-tasks .attn-row{display:grid;grid-template-columns:8px minmax(0,1fr) 16px;column-gap:10px;align-items:center;cursor:pointer}
      .app:not(.pub) .ar-tasks .attn-row > span{grid-column:2}
      .app:not(.pub) .ar-tasks .attn-row .btn{display:none}
      .app:not(.pub) .ar-tasks .attn-row .attn-chev{display:block;grid-column:3;color:var(--d-ink-4)}
      .app:not(.pub) .ar-tasks .attn-row > .ar-dot{grid-column:1}
      .app:not(.pub) .ar-tasks .attn-row[data-pri] > span{grid-column:1 / 3}
      .app:not(.pub) .ar-tasks .attn-row[data-pri] > .btn{grid-column:1 / -1;margin-left:19px}
    }
    /* Board: a coloured top edge, dot and count per column; the next step outlined in the next stage's colour */
    .app:not(.pub) .arb-col{overflow:visible;box-shadow:inset 0 2px 0 var(--st,transparent)}
    .app:not(.pub) .arb-col-head{border-radius:var(--d-r-card) var(--d-r-card) 0 0}
    .app:not(.pub) .arb-col-title{display:flex;align-items:center;gap:8px}
    .app:not(.pub) .arb-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--st)}
    .app:not(.pub) .arb-col .arb-n{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:18px;padding:0 6px;border-radius:100px;font:600 11px/1 var(--d-body);
      color:var(--st);background:color-mix(in srgb,var(--st) 12%,transparent);border:1px solid color-mix(in srgb,var(--st) 30%,transparent)}
    .app:not(.pub) .arb-empty{color:var(--d-ink-off)}
    .app:not(.pub) .arb-board.dragging .arb-col[data-col]:not([data-col=other]) .arb-empty{color:var(--d-ink-3)}
    .app:not(.pub) .arb-card-open{width:100%}
    .app:not(.pub) .arb-card .arb-card-top{flex-wrap:nowrap;align-items:baseline;justify-content:space-between;gap:10px;width:100%}
    .app:not(.pub) .arb-val{flex:none;font:600 13px/1.3 var(--d-body);color:var(--d-ink);font-variant-numeric:tabular-nums;white-space:nowrap}
    @media (max-width:1366px){
      /* laptops: a name wraps to 2 lines and ≈ $value goes under it (the columns: below, after the sideways row) */
      .app:not(.pub) .arb-card .arb-card-top{flex-direction:column;align-items:flex-start;gap:2px}
      .app:not(.pub) .arb-card-top .arb-name{white-space:normal;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    }
    .app:not(.pub) .arb-tech{margin-top:12px} .app:not(.pub) .arb-tech summary{cursor:pointer;font-size:13px;color:var(--d-ink-3);padding:8px 0}
    .app:not(.pub) .arb-contact .tag{margin-left:2px;vertical-align:1px}
    .app:not(.pub) .arb-money{color:var(--d-ink-3)}
    .app:not(.pub) .arb-next[data-stage]{color:var(--st);border-color:color-mix(in srgb,var(--st) 45%,transparent);background:color-mix(in srgb,var(--st) 8%,transparent)}
    @media (hover:hover){ .app:not(.pub) .arb-next[data-stage]:hover:not(:disabled){border-color:var(--st);background:color-mix(in srgb,var(--st) 16%,transparent)} }
    .app:not(.pub) .arb-menu.arb-menu-fixed{position:fixed;top:auto;left:auto;z-index:50}
    .app:not(.pub) .arb-quick input{text-overflow:ellipsis}   /* a narrow column ends the hint with "…", not mid-word */
    .app:not(.pub) .arb-notes{font-size:inherit;color:var(--d-warn);text-decoration-color:var(--d-warn-line)}
    .app:not(.pub) .arb-note{margin:0 0 12px}
    @media (min-width:700px){
      /* one row of columns that scrolls sideways (never a 3 + 2 wrap); each column scrolls inside */
      .app:not(.pub) .arb-board,.app:not(.pub) .arb-board:has(.arb-col[data-col=other]){grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:minmax(208px,1fr);
        overflow-x:auto;scroll-snap-type:x proximity;padding-bottom:6px;scrollbar-width:thin;scrollbar-color:#3a3a3c transparent}
      .app:not(.pub) .arb-col{scroll-snap-align:start}
      .app:not(.pub) .arb-cards{max-height:calc(100dvh - 320px);min-height:64px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#3a3a3c transparent}
    }
    @media (min-width:700px) and (max-width:1366px){
      /* laptops: the stages share the width evenly, so Signed is always on screen (no sideways scroll) */
      .app:not(.pub) .arb-board{grid-auto-flow:row;grid-template-columns:repeat(5,minmax(0,1fr));overflow-x:visible}
      .app:not(.pub) .arb-board:has(.arb-col[data-col=other]){grid-template-columns:repeat(6,minmax(0,1fr))}
    }
    /* producer panel: the sheet's total first and full width, then two per row; roomier fields */
    .app:not(.pub) .modal-card .cat-summary-grid.ar-panel-tiles:has(> .cat-stat){grid-template-columns:repeat(2,minmax(0,1fr))}
    .app:not(.pub) .ar-panel-tiles > .ar-tile-wide{grid-column:1 / -1}
    .app:not(.pub) :is(.arb-panel,.ar-tracked-form) .fld{margin-bottom:18px}
    /* Add these to Luminate: one block per list, with how full it is */
    .app:not(.pub) .ar-tolum-modal .lm-block.ar-tolum-group{margin:14px 0 0}
    .app:not(.pub) .ar-tolum-head{flex-direction:column;align-items:stretch;gap:8px}
    .app:not(.pub) .ar-tolum-head h4{margin:0;font-size:14px;font-weight:600;color:var(--d-ink)}
    .app:not(.pub) .ar-tolum-meter{display:flex;align-items:center;gap:10px}
    .app:not(.pub) .ar-tolum-meter .lm-bar{flex:1}
    .app:not(.pub) .ar-tolum-meter em{flex:none;font-style:normal;font-size:12px;color:var(--d-ink-4)}
    .app:not(.pub) .ar-tolum-meter em.warn-text{color:var(--d-warn)}
    .app:not(.pub) .ar-tolum-full{display:flex;align-items:flex-start;gap:8px;margin:0;padding:10px 16px;border-bottom:1px solid var(--d-line);background:var(--d-warn-bg);color:var(--d-warn);font-size:13px;line-height:1.45}
    .app:not(.pub) .ar-tolum-full svg{flex:none;margin-top:2px}
    .app:not(.pub) .ar-tolum-group .ar-tolum-row{padding:10px 12px 10px 16px;border-top:1px solid var(--d-line)}
    .app:not(.pub) .ar-tolum-group .lm-block-head + .ar-tolum-row{border-top:0}
    .app:not(.pub) .ar-tolum-name{min-width:0;font-size:13.5px}
    .app:not(.pub) .modal-foot .ar-tolum-drop{margin-right:auto}
    `}</style>
  );
}
