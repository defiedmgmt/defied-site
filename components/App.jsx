"use client";
import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { flushSync } from "react-dom";
import NextImage from "next/image";
import Link from "next/link";
import { useRouter } from "next/router";
import dynamic from "next/dynamic";
import {
  Instagram, Mail, Menu, X, LogOut, Plus, Trash2, Pencil, Users, Disc3,
  ListMusic, UserCog, Inbox, Check, ChevronUp, ChevronDown, LayoutGrid,
  Folder, ExternalLink, RefreshCw, Download, Handshake, Calculator, Copy,
} from "lucide-react";

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
function Mark({ size = 30 }) {
  return <img src="/brand/d.png" alt="Defied" className="logo-d" style={{ height: size, width: "auto" }} draggable={false} />;
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
function Photo({ src, alt, className = "", fill, sizes, ...rest }) {
  const [loaded, setLoaded] = useState(false);
  const cls = `ph-fade${loaded ? " ph-in" : ""}${className ? " " + className : ""}`;
  // route through next/image for genuinely-remote (http/https) sources AND
  // this deployment's own local /public files — both get real optimization.
  // A bare "/..." path that turns out to actually be this exact same site's
  // own domain written out as a full URL (https://www.defiedmgmt.com/...,
  // how every roster/team photo is stored) was silently capping at a fixed
  // 300x300 output no matter what width was requested — next/image's
  // remote-fetch path behaves differently from its local-file path here.
  // Only real data: URIs (PhotoUpload's base64 output) skip this entirely.
  const isLocalOrRemote = /^https?:\/\//i.test(src || "") || (src || "").startsWith("/");
  if (fill && isLocalOrRemote) {
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
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onLoad={() => setLoaded(true)}
      className={cls}
      {...rest}
    />
  );
}

// Shrinks an element's own font-size just enough to keep its text on one
// line, no matter how long it is — measured against its own container each
// time `text` changes, rather than guessing a font size that happens to
// work for today's names.
function FitText({ text, tag: Tag = "span", className, ...rest }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = "";
      const cs = getComputedStyle(el);
      const baseSize = parseFloat(cs.fontSize);
      const avail = el.clientWidth;
      if (!avail || !baseSize) return;
      const probe = document.createElement("span");
      probe.style.cssText = "position:absolute;visibility:hidden;left:-9999px;top:0;white-space:nowrap;";
      probe.style.font = cs.font;
      probe.style.letterSpacing = cs.letterSpacing;
      probe.style.textTransform = cs.textTransform;
      probe.textContent = text;
      document.body.appendChild(probe);
      const natural = probe.getBoundingClientRect().width;
      probe.remove();
      if (natural > avail) {
        el.style.fontSize = `${(baseSize * (avail / natural) * 0.98).toFixed(1)}px`;
      }
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [text]);
  return <Tag ref={ref} className={className} {...rest}>{text}</Tag>;
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

// Square crop tool: drag to reposition, slider to zoom, outputs a square JPEG data URL.
function CropModal({ src, onCancel, onDone }) {
  const V = 300, OUT = 520;
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef(null);

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

  return (
    <div className="modal crop-overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="crop-card">
        <div className="modal-head"><h3>Position &amp; crop</h3><button onClick={onCancel}><X size={18} /></button></div>
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
    </div>
  );
}

function PhotoUpload({ label, value, onChange }) {
  const [busy, setBusy] = useState(false);
  const [cropSrc, setCropSrc] = useState(null);
  const pick = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try { setCropSrc(await fileToDataURL(file)); }
    catch { alert("Couldn't read that image. HEIC photos need a moment to convert — try again, or use a JPG/PNG."); }
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
function ExtLink({ href, className, label, title, children }) {
  const onClick = (e) => {
    e.preventDefault();
    try {
      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch { /* ignore */ }
  };
  return (
    <a href={href} onClick={onClick} target="_blank" rel="noopener noreferrer" className={className} aria-label={label} title={title}>
      {children}
    </a>
  );
}

function Socials({ c, size = 26 }) {
  const ig = (v) => !v ? "" : (/^https?:\/\//i.test(v) ? v : `https://instagram.com/${v.replace(/^@/, "")}`);
  const tk = (v) => !v ? "" : (/^https?:\/\//i.test(v) ? v : `https://tiktok.com/@${v.replace(/^@/, "")}`);
  const items = [
    ["spotify", webLink(c.spotify)],
    ["apple", webLink(c.apple)],
    ["instagram", ig(c.instagram)],
    ["tiktok", tk(c.tiktok)],
    ["youtube", webLink(c.youtube)],
    ["soundcloud", webLink(c.soundcloud)],
  ].filter(([, url]) => url);
  if (items.length === 0) return null;
  return (
    <div className="socials">
      {items.map(([k, url]) => (
        <ExtLink key={k} href={url} className="social-ic" label={k}>{ICONS[k](size)}</ExtLink>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  splits: pie chart + editor                                          */
/* ------------------------------------------------------------------ */
const PIE_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const splitTotal = (splits) => (splits || []).reduce((a, s) => a + Number(s.percent || 0), 0);

// recharts (~350KB min / ~90KB gzip) is only drawn in the song-splits view (staff Clients tab +
// client portal) — loaded on demand so the public pages never carry it
const SplitsPieChart = dynamic(() => import("./SplitsPieChart"), { ssr: false });
function SplitsPie({ splits, size = 220 }) {
  const data = (splits || []).filter((s) => Number(s.percent) > 0)
    .map((s) => ({ name: s.name || s.role || "—", value: Number(s.percent) || 0 }));
  if (data.length === 0) return <p className="muted">No splits entered yet.</p>;
  return <div style={{ height: size }}><SplitsPieChart data={data} size={size} colors={PIE_COLORS} /></div>;
}

function SplitsEditor({ splits, onChange }) {
  const rows = splits || [];
  const update = (id, key, val) => onChange(rows.map((r) => r.id === id ? { ...r, [key]: val } : r));
  const add = () => onChange([...rows, { id: uid(), name: "", role: "", percent: 50 }]);
  const remove = (id) => onChange(rows.filter((r) => r.id !== id));
  const total = splitTotal(rows);
  return (
    <div className="splits-ed">
      <div className="splits-ed-head"><span>Splits</span><span className={total === 100 ? "split-ok" : "split-warn"}>{total}%</span></div>
      {rows.map((r) => (
        <div key={r.id} className="splits-ed-row">
          <input placeholder="Name" value={r.name} onChange={(e) => update(r.id, "name", e.target.value)} />
          <input placeholder="Role" value={r.role} onChange={(e) => update(r.id, "role", e.target.value)} />
          <span className="pct-in"><input type="number" min="0" max="100" value={r.percent} onChange={(e) => update(r.id, "percent", Number(e.target.value))} />%</span>
          <button type="button" className="split-del" onClick={() => remove(r.id)} aria-label="Remove"><Trash2 size={14} /></button>
        </div>
      ))}
      <button type="button" className="btn ghost sm" onClick={add}><Plus size={14} /> Add split</button>
      {total !== 100 && rows.length > 0 && <p className="split-hint">Splits should total 100% (currently {total}%).</p>}
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
function jumpIntoView(el) {
  if (!el) return;
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
// public pages: each gets .is-in the first time it scrolls into view, and the
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
        e.target.classList.add("is-in");
        io.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.01 });
    let raf = 0;
    const scan = () => {
      raf = 0;
      document.querySelectorAll("[data-reveal]:not(.is-in):not([data-reveal-seen])").forEach((el) => {
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
      return c && Array.isArray(c.clients) ? c : null;
    } catch { return null; } // storage blocked
  });
  const hadCachedData = useRef(publicData !== null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loadErr, setLoadErr] = useState(null);
  useRevealOnScroll(route !== "staff" && route !== "client");

  // the fresh copy (see publicDataRequest) swaps in when it lands; a failed request only shows
  // the banner when there was nothing cached to show instead
  useEffect(() => {
    let alive = true;
    publicDataRequest.then((d) => {
      if (!alive) return;
      if (d) setPublicData(d);
      else if (!hadCachedData.current) setLoadErr("Couldn't load site data — try refreshing.");
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => { if (alive) setSession(d.user); })
      .catch(() => { if (alive) setSession(null); });
    return () => { alive = false; };
  }, []);

  // once a session is known, load its scoped dashboard/portal data —
  // re-fires if the signed-in user actually changes (login/logout/switch).
  useEffect(() => {
    if (!session) { setDb(null); return; }
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/dashboard-data");
        if (res.status === 401) { if (alive) setSession(null); return; }
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(data.error || "Failed to load.");
        setDb(data);
      } catch (err) {
        if (alive) setLoadErr(err.message || "Couldn't load your dashboard data.");
      }
    })();
    return () => { alive = false; };
  }, [session?.id]);

  // mirrors the old commit({...db, changedKey: newValue}) call shape used
  // everywhere in the admin/portal components — update local state
  // optimistically, then persist the same object to the server.
  const commit = async (next) => {
    setDb(next);
    try {
      const res = await fetch("/api/dashboard-data", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Save failed.");
      }
      setLoadErr(null);
    } catch (err) {
      setLoadErr(err.message || "Couldn't save that change — try again.");
    }
  };

  const go = (r) => {
    const path = ROUTE_TO_PATH[r] || "/";
    const nav = router.pathname !== path ? router.push(path) : Promise.resolve();
    setMenuOpen(false);
    window.scrollTo(0, 0);
    return nav;
  };

  const login = async (email, password, remember) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
      body: JSON.stringify({ email, password, remember }),
    });
    const data = await res.json();
    if (!res.ok) return data.error || "Incorrect email or password.";
    setSession(data.user);
    go(data.user.role === "staff" ? "staff" : "client");
    return null;
  };
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", headers: { "X-Requested-With": "defied-site" } }).catch(() => {});
    // navigate home BEFORE clearing session — otherwise the route-guard
    // effect below sees session go null while route is still "staff"/
    // "client" for one render and races router.replace("/login") against
    // this push, sometimes winning and landing back on the login page.
    await go("home");
    setSession(null);
    setDb(null);
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
  }, [route, session]);

  const inPortal = route === "staff" || route === "client";
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
      {loadErr && (
        <div className="storage-warn">{loadErr}</div>
      )}
      {!inPortal && (
        <PublicNav route={route} menuOpen={menuOpen} setMenuOpen={setMenuOpen} session={session} />
      )}

      {/* the open poster menu is modal: the page under it leaves the tab order */}
      <div className={`${route === "home" || route === "login" || route === "notfound" ? "view view-home" : "view"}${canViewTransition ? "" : " view-anim"}`} key={route} {...(menuOpen ? { inert: "" } : {})}>
        <PageGuard data={publicData} onDrop={() => publicDataRequest.then((d) => { if (!d) setLoadErr("Couldn't load site data — try refreshing."); })}>
          {route === "home" && <Home publicData={publicData} />}
          {route === "about" && <About publicData={publicData} />}
          {route === "team" && <TeamPage publicData={publicData} />}
          {route === "roster" && <Roster publicData={publicData} />}
          {route === "contact" && <Contact publicData={publicData} />}
        </PageGuard>
        {route === "login" && <Login login={login} />}
        {route === "notfound" && <NotFound />}

        {route === "staff" && session?.role === "staff" && (
          db ? <StaffDashboard db={db} commit={commit} logout={logout} /> : <p className="muted page">Loading…</p>
        )}
        {route === "client" && session?.role === "client" && (
          db ? <ClientPortal db={db} commit={commit} session={session} logout={logout} /> : <p className="muted page">Loading…</p>
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
const PUBLIC_CACHE_KEY = "dm-public-data-v1";
// Requested as soon as this module runs (PageShell's preload has it in flight already), so it lands
// sooner and overwrites the saved copy even if this visit never manages to draw it (PageGuard drops a
// copy a page can't draw). An error answer (the API sends 502 JSON when the database fails) or an odd
// one never replaces good data.
const publicDataRequest = typeof window === "undefined" ? null : fetch("/api/public-data")
  .then((r) => { if (!r.ok) throw new Error(`public-data ${r.status}`); return r.json(); })
  .then((d) => {
    if (!Array.isArray(d?.clients)) throw new Error("public-data: unexpected shape");
    try { localStorage.setItem(PUBLIC_CACHE_KEY, JSON.stringify(d)); } catch { /* storage full or blocked */ }
    return d;
  })
  .catch(() => null);

const slugOf = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const splitNames = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
// "Presidential (with Jenn Carter, Kyle Richh, TaTa)" -> "Presidential"
const cleanTitle = (song) => String(song || "").replace(/\s*[([](?:with|feat\.?|ft\.?)\s[^)\]]*[)\]]/gi, "").trim();
const primaryArtist = (artist) => splitNames(artist)[0] || "";
const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// streaming links are typed in on the dashboard: only ever hand a real web address to an href
const webLink = (url) => (/^https?:\/\//i.test(String(url || "").trim()) ? String(url).trim() : null);

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
// lift it on hover, so they get the 64px and 300px files. Other hosts get no cover rather than a full-size download.
const coverSet = (url) => /^https:\/\/i\.scdn\.co\/image\/ab67616d0000b273/.test(url || "")
  ? `${url.replace("ab67616d0000b273", "ab67616d00004851")} 64w, ${url.replace("ab67616d0000b273", "ab67616d00001e02")} 300w` : null;

// One placement, credited the way a tracklist would: the cover, the artist, then the song in quotes
// and the roster producer. `sizes` is the cover's size at rest, `lift` its size once it lifts on hover.
function Credit({ c, sizes, lift }) {
  const set = coverSet(c.cover);
  // "Prod. prodbylandn" says prod twice: names that already start with it stand alone
  const prodWord = c.prod.every((n) => /^prod/i.test(n)) ? "" : "Prod. ";
  return (
    <>
      {set && (
        <span className="cr-cov">
          <img srcSet={set} sizes={sizes} data-lift={lift} alt="" width="64" height="64" decoding="async" draggable={false} />
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
const EMOJI_SEQ = /([#*\d]️?⃣|\p{Regional_Indicator}{2}|(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️)\p{Emoji_Modifier}?(?:‍(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️?)\p{Emoji_Modifier}?)*)/u;
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
    const c = clients.find((x) => sameName(x.name, name));
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
function SplitHead({ text, tag: Tag = "h1", className = "", chrome = false, onView = false, strike, delay = 80 }) {
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
          {i < words.length - 1 && " "}
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
      const base = parseFloat(getComputedStyle(el).fontSize);
      const avail = el.clientWidth;
      const natural = el.scrollWidth;
      if (!avail || !natural || !base) return;
      if (natural > avail) {
        const size = Math.max(min, Math.min(max, base * (avail / natural) * 0.985));
        el.style.fontSize = `${size.toFixed(1)}px`;
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
        aria-modal={menuOpen || undefined}
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
function Home({ publicData }) {
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
function ReleaseCard({ r, clients, compact = false, featured = false }) {
  const href = webLink(r.link);
  const Tag = href ? "a" : "div";
  const credits = compact ? [] : rosterCreditsOn(r, clients);
  return (
    <Tag className={`rc${featured ? " rc-feat" : ""}${compact ? " rc-compact" : ""}`} {...(compact ? {} : { "data-reveal": "" })} {...(href ? { href, target: "_blank", rel: "noreferrer" } : {})}>
      <div className="rc-cover">
        {r.cover ? <Photo src={r.cover} alt="" fill sizes={featured ? FEAT_COVER_SIZES : compact ? RAIL_COVER_SIZES : COVER_SIZES} /> : <div className="rc-empty"><Disc3 size={30} /></div>}
        {href && <span className="rc-play" aria-hidden="true">{ICONS.spotify(18)}</span>}
      </div>
      <div className="rc-meta">
        <strong>{r.song}</strong>
        <span className="rc-artist">{r.artist}</span>
        {credits.length > 0 && (
          <span className="rc-chips">
            {/* "Prod. prodbylandn" says prod twice — a name that already starts with it stands alone */}
            {credits.map((c) => <em key={c.name} className="chip-tag">{c.prod && !/^prod/i.test(c.name) && "Prod. "}<Glyphs text={c.name} /></em>)}
          </span>
        )}
        {featured && href && <span className="rc-cta">Play on Spotify <span aria-hidden="true">↗</span></span>}
      </div>
    </Tag>
  );
}

// Four or more releases use the 4-column grid (2 on phones), and the first in
// the dashboard's own order get double-size tiles — as many as keep every row
// full: each big tile fills 4 cells, so 10 → 2 big, 9 → 1, 11 → 3, 8 → none.
const featuredCount = (n) => (n < 5 ? 0 : [2, 1, 3, 0].find((k) => n > k && (n + 3 * k) % 4 === 0) || 0);

function About({ publicData }) {
  if (!publicData) return <main className="pg"><PageLoading /></main>;
  const about = publicData.about || "";
  const notable = (publicData.notableReleases || []).filter((r) => r.song);
  const credits = creditsOf(publicData);
  const nFeat = featuredCount(notable.length);
  return (
    <main className="pg about2">
      <SplitHead text="DEFYING THE NORMS OF TALENT MANAGEMENT." chrome strike="NORMS" className="about2-head" />
      <div className="about2-body">
        {about.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}
      </div>

      {credits.length > 0 && (
        <Marquee
          className="about2-band"
          label="Notable placements"
          seconds={Math.max(45, credits.length * 7)}
          items={credits.map((c) => ({ ...c, text: creditText(c) }))}
          render={(c) => <Credit c={c} sizes="(max-width: 666px) 21px, 42px" lift="105px" />}
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
// loading state until the fresh one lands, then draw again (or show the banner if it can't load).
class PageGuard extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() {
    try { localStorage.removeItem(PUBLIC_CACHE_KEY); } catch { /* storage blocked */ }
    this.props.onDrop?.();
  }
  componentDidUpdate(prev) { if (this.state.failed && prev.data !== this.props.data) this.setState({ failed: false }); }
  render() { return this.state.failed ? <main className="pg"><PageLoading /></main> : this.props.children; }
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
  const slug = slugOf(person.name);
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
          : <div className="pc-empty">{(person.name || "?")[0].toUpperCase()}</div>}
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
  if (!publicData) return <main className="pg"><PageLoading /></main>;
  const staff = publicData.staff || [];
  const founders = staff.filter((s) => /founder/i.test(s.role || ""));
  const rest = staff.filter((s) => !/founder/i.test(s.role || ""));
  // label the second group by its shared role ("Talent Managers") when there is one
  const restRoles = [...new Set(rest.map((s) => (s.role || "").trim()).filter(Boolean))];
  const restLabel = restRoles.length === 1 ? `${restRoles[0]}s` : "Team";
  const groups = founders.length && rest.length
    ? [["Co-Founders", founders], [restLabel, rest]]
    : [["", staff]];
  const card = (s) => (
    <PersonCard key={s.id} person={s} eager={staff.indexOf(s) < 3} sizes="(max-width: 599px) and (min-resolution: 2.5dppx) 29vw, (max-width: 599px) 46vw, (max-width: 899px) 31vw, 340px">
      {s.bio && <p className="pc-bio">{s.bio}</p>}
      <div className="pc-links">
        {s.email && <TeamEmail email={s.email} />}
        {s.instagram && (
          <ExtLink className="hit" href={/^https?:\/\//i.test(s.instagram) ? s.instagram : `https://instagram.com/${s.instagram.replace(/^@/, "")}`} label={`${s.name} on Instagram`}>
            <Instagram size={18} />
          </ExtLink>
        )}
      </div>
    </PersonCard>
  );
  return (
    <main className="pg pg-wide">
      <SplitHead text="TEAM" chrome className="pg-head" />
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

  const activeSlug = router.isReady ? router.query.artist : undefined;
  const active = activeSlug ? clients.find((c) => slugOf(c.name) === activeSlug) || null : null;
  useEffect(() => {
    if (activeSlug) { lastSlug.current = activeSlug; return; }
    pushedRef.current = false;
    // however the panel closed (X, Esc, iPhone back-swipe), leave the grid on the card that was open
    if (lastSlug.current) jumpIntoView(document.querySelector(`.pc[data-slug="${lastSlug.current}"] .pc-frame`));
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
      await router.push({ pathname: "/roster", query: queryWith({ artist: slugOf(c.name) }) }, undefined, { shallow: true, scroll: false });
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
      jumpIntoView(f);
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
    const list = visible.some((c) => slugOf(c.name) === activeSlug) ? visible : clients;
    const i = list.findIndex((c) => slugOf(c.name) === activeSlug);
    const next = list[(i + dir + list.length) % list.length];
    if (!next) return;
    stepFocus.current = dir > 0 ? "next" : "prev";
    document.documentElement.dataset.dir = dir > 0 ? "next" : "prev";
    withViewTransition("artist-step", () =>
      router.replace({ pathname: "/roster", query: queryWith({ artist: slugOf(next.name) }) }, undefined, { shallow: true, scroll: false })
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
      cards().forEach((el) => { if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add("is-in"); });
      name();
      // only now, after the old snapshot: the URL → filter effect would otherwise re-render the grid before it's taken
      router.replace({ pathname: "/roster", query: queryWith({ type: v === "all" ? null : v }) }, undefined, { shallow: true, scroll: false });
    });
    const clear = () => cards().forEach((el) => { el.style.viewTransitionName = ""; });
    if (t) t.finished.finally(clear); else clear();
  };

  if (!publicData) return <main className="pg"><PageLoading /></main>;
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
        <h1 className="pg-head split split-chrome" aria-label={`Roster, ${clients.length} people`}>
          <span className="w" aria-hidden="true"><span style={{ "--i": 0 }}>ROSTER</span></span>
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
          key={slugOf(active.name)}
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
function DecodeName({ name, id }) {
  const boxRef = useRef(null);
  const liveRef = useRef(null);
  useFitLine(boxRef, name, { min: 26, max: 120 });
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
  const slug = slugOf(artist.name);
  const hasLinks = artist.spotify || artist.apple || artist.youtube || artist.instagram || artist.tiktok || artist.soundcloud;
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
              {lo && <NextImage src={artist.photo} alt="" fill sizes={CARD_SIZES} style={{ objectFit: "cover" }} className="ap-photo-lo" />}
              <Photo src={artist.photo} alt={artist.name} fill sizes="(max-width: 899px) 92vw, 620px" priority />
            </>
          ) : <div className="ap-photo-empty">{artist.name[0].toUpperCase()}</div>}
        </div>

        <div className="ap-info">
          <DecodeName name={artist.name} id={`ap-name-${slug}`} />
          <div className="ap-stag" style={{ "--i": 0 }}><span className="chip-tag chip-tag-lg">{artist.role}</span></div>

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
          <button ref={prevRef} onClick={() => onStep(-1)} aria-label={`Previous: ${prev?.name}`}><span aria-hidden="true">←</span> <span className="ap-bar-name"><Glyphs text={prev?.name} /></span></button>
          <span className="ap-bar-pos" aria-hidden="true">{i + 1} / {list.length}</span>
          <button ref={nextRef} onClick={() => onStep(1)} aria-label={`Next: ${next?.name}`}><span className="ap-bar-name"><Glyphs text={next?.name} /></span> <span aria-hidden="true">→</span></button>
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
  useEffect(() => { if (sent) sentHead.current?.focus({ preventScroll: true }); }, [sent]);

  // arriving from an artist's "Work with …" button: preselect Booking and
  // start the message with who it's about
  useEffect(() => {
    if (!router.isReady || !publicData) return;
    const slug = router.query.artist;
    const c = slug && (publicData.clients || []).find((x) => slugOf(x.name) === slug);
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't send that — try again.");
      // busy stays on until the swap, so the morph starts from "Sending…", never a flash of "Send message"
      withViewTransition("sent", () => {
        flushSync(() => { setSent(true); setF(blank); setBusy(false); });
        // the card just got ~500px shorter — bring it (and the check drawing in) to the middle of the screen
        jumpIntoView(cardRef.current);
      });
    } catch (e2) {
      setErr(e2.message || "Couldn't send that — try again.");
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
            <h3 ref={sentHead} tabIndex={-1}>Message sent</h3>
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
              <label className="ct-fld"><span>Email</span><input name="email" type="email" autoComplete="email" required value={f.email} onChange={set("email")} /></label>
            </div>
            <label className="ct-fld"><span>Instagram</span><input name="instagram" placeholder="@yourhandle" autoCapitalize="off" autoCorrect="off" spellCheck={false} required value={f.instagram} onChange={set("instagram")} /></label>
            <div className="ct-fld">
              <span id="ct-subject">Subject</span>
              <ChipGroup name="subject" label="Subject" options={CONTACT_SUBJECTS.map((s) => ({ value: s, label: s }))} value={f.subject} onChange={(v) => setF((cur) => ({ ...cur, subject: v }))} className="ct-chips" />
            </div>
            <label className="ct-fld"><span>Message</span><textarea name="message" rows={5} required value={f.message} onChange={set("message")} /></label>
            {err && <p className="ct-err" role="alert">{err} You can also email submissions@defiedmgmt.com.</p>}
            <button className="pill pill-solid pill-full" type="submit" disabled={busy}>
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
// heading, the contact form's fields and pill, and the D standing large and faint behind them.
function Login({ login }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    let msg;
    try { msg = await login(email, password, remember); }
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
          <input name="email" type="email" autoComplete="username" autoCapitalize="off" spellCheck={false} required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {/* a div, not a wrapping label: the label's text would otherwise take in "Show" as part of the field's name */}
        <div className="ct-fld">
          <label htmlFor="lg-password">Password</label>
          <div className="lg-pw">
            <input id="lg-password" name="password" type={showPw ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="lg-show" onClick={() => setShowPw((v) => !v)} aria-controls="lg-password" aria-label={showPw ? "Hide password" : "Show password"}>{showPw ? "Hide" : "Show"}</button>
          </div>
        </div>
        <label className="lg-check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <i aria-hidden="true" />
          <span>Remember me</span>
        </label>
        {err && <p className="ct-err" role="alert">{err}</p>}
        <button className="pill pill-solid pill-full" type="submit" disabled={busy}>
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
function StaffDashboard({ db, commit, logout }) {
  const [tab, setTab] = useState("website");
  const unreadCount = db.submissions.filter((s) => !s.read).length;
  const tabs = [
    ["website", "Website", Pencil], ["catalog", "Clients", Users],
    ["ar", "A&R", Handshake],
    ["users", "Users", UserCog], ["subs", "Messages", Inbox, unreadCount],
  ];
  return (
    <div className="dash">
      <aside className="dash-side">
        <div className="dash-brand"><Link href={ROUTE_TO_PATH.home} className="logo-link"><Wordmark height={26} /></Link></div>
        <nav>
          {tabs.map(([id, label, Icon, badge]) => (
            <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              <Icon size={17} /> <span className="nav-label">{label}</span>
              {!!badge && <span className="nav-badge">{badge}</span>}
            </button>
          ))}
        </nav>
        <button className="dash-out" onClick={logout}><LogOut size={16} /> Sign out</button>
      </aside>
      <main className="dash-main">
        <div className="dash-role">Staff — full edit access</div>
        {tab === "website" && <WebsiteAdmin db={db} commit={commit} />}
        {tab === "catalog" && <CatalogAdmin db={db} commit={commit} />}
        {tab === "ar" && <ARAdmin />}
        {tab === "users" && <UsersAdmin db={db} commit={commit} />}
        {tab === "subs" && <SubsAdmin db={db} commit={commit} />}
      </main>
    </div>
  );
}

/* generic editable list ------------------------------------------------ */
function Editor({ title, items, columns, blank, onSave, onDelete, extra, maxItems, onReorder, confirmDelete }) {
  const [editing, setEditing] = useState(null); // object or null
  useEffect(() => {
    if (!editing) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [editing]);
  const start = (obj) => setEditing(obj ? { ...obj } : { id: null, ...blank });
  const save = async () => { await onSave(editing); setEditing(null); };
  const remove = (it) => {
    const label = it.name || it.song || it.email || "this entry";
    const msg = confirmDelete ? confirmDelete(it) : `Delete "${label}"? This can't be undone.`;
    if (window.confirm(msg)) onDelete(it.id);
  };
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
              <button onClick={() => start(it)}><Pencil size={14} /></button>
              <button onClick={() => remove(it)}><Trash2 size={14} /></button>
            </span>
          </div>
        ))}
      </div>

      {editing && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setEditing(null)}>
          <div className="modal-card">
            <div className="modal-head">
              <h3>{editing.id ? "Edit" : "New"} {title.replace(/s$/, "")}</h3>
              <button onClick={() => setEditing(null)}><X size={18} /></button>
            </div>
            <div className="modal-body">{extra(editing, setEditing)}</div>
            <div className="modal-foot">
              <button className="btn ghost sm" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn sm" onClick={save}>Save</button>
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
async function deleteClientCascade(db, commit, id) {
  const client = db.clients.find((c) => c.id === id);
  const clientPlacements = db.placements.filter((p) => p.clientId === id);
  // a login account left pointing at a deleted client is a real login that
  // just 404s on their own data forever instead of being cleaned up — same
  // class of gap as data the UI hides but the API still allows; remove it
  // here instead of leaving stale valid credentials with nothing behind them.
  await commit({
    ...db,
    clients: db.clients.filter((c) => c.id !== id),
    placements: db.placements.filter((p) => p.clientId !== id),
    users: db.users.filter((u) => u.clientId !== id),
  });

  const results = await Promise.allSettled(
    clientPlacements
      .filter((p) => (p.splits || []).some((s) => s.name === client?.name))
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

function ClientsAdmin({ db, commit }) {
  const cols = [
    { key: "name", label: "Name", render: (c) => <span className="cell-name"><Avatar src={c.photo} name={c.name} size={30} />{c.name}</span> },
    { key: "role", label: "Role" }, { key: "credit", label: "Credit" },
    { key: "onRoster", label: "Public", render: (c) => c.onRoster !== false ? <span className="badge-yes"><Check size={12} /> Live</span> : <span className="badge-no">Hidden</span> },
  ];
  const [deleteWarn, setDeleteWarn] = useState(null);
  const save = async (o) => {
    const clients = o.id ? db.clients.map((c) => c.id === o.id ? o : c) : [...db.clients, { ...o, id: uid() }];
    await commit({ ...db, clients });
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
      onSave={save} onDelete={del} onReorder={reorder}
      confirmDelete={(c) => {
        const n = db.placements.filter((p) => p.clientId === c.id).length;
        const hasLogin = db.users.some((u) => u.clientId === c.id);
        return `Delete ${c.name}? This also permanently deletes their ${n} song${n === 1 ? "" : "s"}, clears them from the pub sheet${hasLogin ? ", and removes their login" : ""}. This can't be undone.`;
      }}
      extra={(e, set) => (
        <>
          <label className="check-row">
            <input type="checkbox" checked={e.onRoster !== false} onChange={(ev) => set({ ...e, onRoster: ev.target.checked })} />
            <span>Show on the public roster page.</span>
          </label>
          <Field label="Name" value={e.name} onChange={(ev) => set({ ...e, name: ev.target.value })} />
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
          <Field label="Sheet tab name" value={e.sheetTabName} onChange={(ev) => set({ ...e, sheetTabName: ev.target.value })} hint="Only needed if it doesn't match this client's name exactly — e.g. this client is Stack!e but their tab on the pub sheet is named Stackie." />
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
  const save = async (o) => {
    const placements = o.id ? db.placements.map((p) => p.id === o.id ? o : p) : [...db.placements, { ...o, id: uid() }];
    await commit({ ...db, placements });
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
  const run = async () => {
    const t = (link || e.link || "").trim();
    if (!t) return;
    setStatus("loading");
    try {
      const meta = await lookupSpotifyTrack(t);
      set({
        ...e,
        song: meta.title || e.song,
        artist: meta.artist || e.artist,
        releaseDate: e.releaseDate || meta.releaseDate || "",
        cover: meta.cover || e.cover,
        link: meta.link || e.link || t,
      });
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
    await commit({ ...db, staff });
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
    const users = o.id ? db.users.map((u) => u.id === o.id ? o : u) : [...db.users, { ...o, id: uid() }];
    if (!users.some((u) => u.role === "staff")) {
      window.alert("At least one staff account must exist — can't demote the last one.");
      return;
    }
    await commit({ ...db, users });
  };
  const del = async (id) => {
    const users = db.users.filter((u) => u.id !== id);
    if (!users.some((u) => u.role === "staff")) {
      window.alert("At least one staff account must exist — can't delete the last one.");
      return;
    }
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
   MASTER/roster totals and from db/commit() — prospects have no Postgres
   row at all (they aren't signed clients yet), so this reads and writes
   straight to the sheet via /api/ar-data and /api/ar-write. */
async function arWrite(body) {
  const res = await fetch("/api/ar-write", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Save failed.");
  return data;
}

function ARAdmin() {
  const [sec, setSec] = useState("outreach");
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  const load = () => fetch("/api/ar-data")
    .then((r) => r.json())
    .then((d) => { if (d.error) throw new Error(d.error); setData(d); setErr(null); })
    .catch((e) => setErr(e.message || "Couldn't load A&R data."));

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="subnav">
        <button className={sec === "outreach" ? "subpill active" : "subpill"} onClick={() => setSec("outreach")}>Outreach</button>
        <button className={sec === "advance" ? "subpill active" : "subpill"} onClick={() => setSec("advance")}>Advance Calculator</button>
      </div>
      {err && <p className="hint err-text mb">{err}</p>}
      {!data && !err && <p className="muted">Loading…</p>}
      {data && sec === "outreach" && <OutreachPanel data={data} reload={load} />}
      {data && sec === "advance" && <AdvanceCalcPanel data={data} reload={load} />}
    </div>
  );
}

function OutreachPanel({ data, reload }) {
  const cols = "1.2fr 1fr 1fr 1fr 1fr 0.6fr 1fr";
  const [adding, setAdding] = useState(false);
  const [activeRow, setActiveRow] = useState(null); // the prospect row currently open for editing
  // look up fresh each render (not a stale snapshot) so the modal reflects
  // updated sums immediately if reload() ever fires while it's open
  const active = data.prospects.find((p) => p.row === activeRow) || null;

  return (
    <div>
      <div className="admin-head">
        <h2>Outreach pipeline</h2>
        <div style={{ display: "flex", gap: 8 }}>
          {data.links.outreach && (
            <ExtLink href={data.links.outreach} className="btn ghost sm"><ExternalLink size={14} /> Open in sheet</ExtLink>
          )}
          <button className="btn sm" onClick={() => setAdding(true)}><Plus size={15} /> Add prospect</button>
        </div>
      </div>
      <p className="muted mb">
        Up to 5 songs per prospect — fill out their name, contact, and each song's Gross Streams and Writer %,
        then hit Save once. Gross Streams, Net Streams, and Est. Revenue all sum/compute automatically — Net
        Streams is the sum of each song's own streams × its own split, never an average. Never touches MASTER or
        roster totals.
      </p>
      {data.prospects.length === 0 ? (
        <div className="admin-empty">No prospects logged yet — click "Add prospect".</div>
      ) : (
        <div className="admin-table">
          <div className="admin-row admin-hd" style={{ "--cols": cols }}>
            <span>Prospect</span><span>Contact</span><span>Gross Streams</span><span>Net Streams</span><span>Est. Revenue</span><span>Songs</span><span>Status</span>
          </div>
          {data.prospects.map((p) => (
            <button key={p.row} className="admin-row admin-row-link" style={{ "--cols": cols }} onClick={() => setActiveRow(p.row)}>
              <span className="cell">{p.name}</span>
              <span className="cell">{p.contact || "—"}</span>
              <span className="cell">{fmt(p.grossStreams)}</span>
              <span className="cell">{fmt(p.netStreams)}</span>
              <span className="cell">{money(p.grossRevenue)}</span>
              <span className="cell">{p.songs.filter((s) => s.streams > 0).length || "—"}</span>
              <span className="cell">{p.status ? <span className="tag">{p.status}</span> : "—"}</span>
            </button>
          ))}
        </div>
      )}

      {adding && (
        <ProspectForm
          blendedRate={data.assumptions.blendedRate}
          statuses={data.statuses}
          onClose={() => setAdding(false)}
          onChanged={async () => { await reload(); setAdding(false); }}
        />
      )}
      {active && (
        <ProspectForm
          prospect={active}
          blendedRate={data.assumptions.blendedRate}
          statuses={data.statuses}
          onClose={() => setActiveRow(null)}
          onChanged={async () => { await reload(); setActiveRow(null); }}
        />
      )}
    </div>
  );
}

const BLANK_SONGS = [1, 2, 3, 4, 5].map((slot) => ({ slot, streams: "", writerShare: "" }));

// One form for both adding and editing a prospect — name, contact, and all
// 5 song slots are filled out together and saved in a single click via
// saveProspectFull, instead of a separate save per field/song. The preview
// totals are computed the same way the sheet computes them: Gross Streams
// is a straight sum of the streams typed in each slot, and Net Streams is
// the sum of each individual slot's own streams × its own writer % — never
// a single blended percentage applied to the summed total, which is what
// made the old one-pair-per-prospect design inaccurate for anyone with
// more than one song at a different split.
function ProspectForm({ prospect, blendedRate, statuses, onClose, onChanged }) {
  const isNew = !prospect;
  const [name, setName] = useState(prospect?.name || "");
  const [contact, setContact] = useState(prospect?.contact || "");
  const [status, setStatus] = useState(prospect?.status || "");
  const [songs, setSongs] = useState(
    prospect ? prospect.songs.map((s) => ({ ...s, streams: s.streams || "", writerShare: s.writerShare || "" })) : BLANK_SONGS
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const setSong = (slot, patch) => setSongs(songs.map((s) => (s.slot === slot ? { ...s, ...patch } : s)));

  const grossStreams = songs.reduce((sum, s) => sum + (Number(s.streams) || 0), 0);
  const netStreams = songs.reduce((sum, s) => sum + (Number(s.streams) || 0) * ((Number(s.writerShare) || 0) / 100), 0);
  const estRevenue = netStreams * blendedRate;

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true); setErr(null);
    try {
      await arWrite({ action: "saveProspectFull", row: prospect?.row, name: name.trim(), contact: contact.trim(), status, songs });
      await onChanged();
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  const deleteProspect = async () => {
    if (!window.confirm(`Remove ${prospect.name} from the outreach pipeline? This can't be undone.`)) return;
    setBusy(true); setErr(null);
    try {
      await arWrite({ action: "deleteProspect", row: prospect.row });
      await onChanged();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card">
        <div className="modal-head"><h3>{isNew ? "New prospect" : prospect.name}</h3><button onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          {err && <p className="hint err-text">{err}</p>}

          <div className="cat-summary" style={{ marginBottom: 18 }}>
            <div className="cat-summary-grid">
              <div className="cat-stat"><span className="cat-stat-label">Gross Streams</span><span className="cat-stat-val">{fmt(grossStreams)}</span></div>
              <div className="cat-stat"><span className="cat-stat-label">Net Streams</span><span className="cat-stat-val">{fmt(Math.round(netStreams))}</span></div>
              <div className="cat-stat"><span className="cat-stat-label">Est. Revenue</span><span className="cat-stat-val">{money(estRevenue)}</span></div>
            </div>
          </div>

          <Field label="Prospect / Producer" value={name} onChange={(e) => setName(e.target.value)} />
          <Field label="Contact or Handle" value={contact} onChange={(e) => setContact(e.target.value)} />
          <label className="fld"><span>Outreach Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">— not set —</option>
              {(statuses || []).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>

          <p className="fld-label mb" style={{ marginTop: 18 }}>Songs (up to 5) — Gross Streams and Writer %</p>
          {songs.map((s) => (
            <div key={s.slot} className="ar-song-row">
              <span className="ar-song-num">{s.slot}</span>
              <input type="number" placeholder="Gross streams" value={s.streams} onChange={(e) => setSong(s.slot, { streams: e.target.value })} />
              <input type="number" placeholder="Writer %" value={s.writerShare} onChange={(e) => setSong(s.slot, { writerShare: e.target.value })} />
            </div>
          ))}
        </div>
        <div className="modal-foot">
          {!isNew && <button className="btn ghost sm err-text" onClick={deleteProspect} disabled={busy}>Delete prospect</button>}
          <button className="btn ghost sm" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn sm" onClick={save} disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
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

function AdvanceCalcPanel({ data, reload }) {
  const { assumptions, recoupTargetMonths, budget, prospects, signedClients, links } = data;
  const [scenario, setScenario] = useState(BLANK_SCENARIO);
  const [recoupMonths, setRecoupMonths] = useState(recoupTargetMonths);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(false);

  const selectedProspect = scenario.kind === "outreach" ? prospects.find((p) => String(p.row) === String(scenario.key)) : null;
  const selectedClient = scenario.kind === "client" ? signedClients.find((c) => c.id === scenario.key) : null;
  // an existing prospect/client's Net Streams comes straight from the sheet
  // or catalog's own sum across everything they have (could be more than
  // one song) — a from-scratch scenario only ever has the one Gross
  // Streams/Writer % pair being typed, computed the same way the sheet
  // computes each song slot.
  const netStreams = selectedProspect ? selectedProspect.netStreams
    : selectedClient ? selectedClient.netStreams
    : (Number(scenario.grossStreams) || 0) * ((Number(scenario.writerShare) || 0) / 100);

  const selectScenario = (value) => {
    setSaved(false);
    if (!value) { setScenario(BLANK_SCENARIO); return; }
    const [kind, key] = value.split(":");
    if (kind === "outreach") {
      const p = prospects.find((x) => String(x.row) === key);
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
      const { row } = await arWrite({
        action: "saveProspectFull", name: scenario.name.trim(), contact: scenario.contact.trim(),
        songs: [{ slot: 1, streams: Number(scenario.grossStreams) || 0, writerShare: Number(scenario.writerShare) || 0 }],
      });
      await reload();
      setScenario({ kind: "outreach", key: String(row), name: scenario.name, contact: scenario.contact, grossStreams: "", writerShare: "" });
      setSaved(true);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const setGiven = async (given) => {
    if (!selectedProspect) return;
    setBusy(true); setErr(null);
    try {
      await arWrite({ action: "setAdvanceGiven", row: selectedProspect.row, given });
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
      <p className="muted mb">Mirrors the sheet's own math exactly — pick an Outreach prospect or a signed client, or fill out a brand-new scenario and save it to Outreach once you're happy with it.</p>

      <div className="cat-summary" style={{ marginBottom: 20, maxWidth: 560 }}>
        <div className="cat-summary-grid">
          <div className="cat-stat"><span className="cat-stat-label">Starting Budget</span><span className="cat-stat-val">{money(budget.starting)}</span></div>
          <div className="cat-stat"><span className="cat-stat-label">Committed (Given)</span><span className="cat-stat-val">{money(budget.committed)}</span></div>
          <div className="cat-stat"><span className="cat-stat-label">Remaining</span><span className="cat-stat-val">{money(budget.remaining)}</span></div>
        </div>
      </div>

      <div className="form-card" style={{ maxWidth: 560 }}>
        <label className="fld"><span>Prospect or signed client</span>
          <select value={scenario.kind === "new" ? "" : `${scenario.kind}:${scenario.key}`} onChange={(e) => selectScenario(e.target.value)}>
            <option value="">— new prospect —</option>
            {prospects.length > 0 && (
              <optgroup label="Outreach prospects">
                {prospects.map((p) => <option key={p.row} value={`outreach:${p.row}`}>{p.name} ({fmt(p.netStreams)} net streams)</option>)}
              </optgroup>
            )}
            {signedClients.length > 0 && (
              <optgroup label="Signed clients">
                {signedClients.map((c) => <option key={c.id} value={`client:${c.id}`}>{c.name} ({fmt(c.netStreams)} net streams)</option>)}
              </optgroup>
            )}
          </select>
        </label>
        {selectedProspect || selectedClient ? (
          <p className="hint">
            Net Streams ({fmt(netStreams)}) comes from {scenario.name}'s {selectedClient ? "catalog" : "songs in Outreach"} —
            edit {selectedClient ? "their songs on the Clients tab" : "those there"} to change this.
          </p>
        ) : (
          <>
            <Field label="Prospect / Producer" value={scenario.name} onChange={(e) => setField({ name: e.target.value })} placeholder="Who are you evaluating?" />
            <Field label="Contact or Handle" value={scenario.contact} onChange={(e) => setField({ contact: e.target.value })} />
            <Field label="Gross Streams" type="number" value={scenario.grossStreams} onChange={(e) => setField({ grossStreams: e.target.value })} />
            <Field label="Writer %" type="number" value={scenario.writerShare} onChange={(e) => setField({ writerShare: e.target.value })} />
            <p className="hint">Net Streams: {fmt(netStreams)} · Est. Revenue: {money(estRevenue)}</p>
          </>
        )}
        <Field
          label="Recoup target (months)" type="number" value={recoupMonths}
          onChange={(e) => setRecoupMonths(e.target.value)}
          hint="Advance = this many months of Year 1 admin cut · recouped from your 20% admin, not the writer's share · 12-18 mo traditional, 24-36 aggressive"
        />
        {err && <p className="hint err-text">{err}</p>}
        {/* saving flips scenario.kind to "outreach", which swaps in the
            read-only reference block above on the very next render — the
            confirmation has to live outside that block or it vanishes
            before anyone sees it */}
        {saved && <p className="hint" style={{ color: "#9ad39a" }}>Saved to Outreach ✓ — {scenario.name} now appears in the pipeline, shown below with its real numbers.</p>}
        {scenario.kind === "new" && (
          <button className="btn sm" onClick={saveToOutreach} disabled={busy || !scenario.name.trim() || !netStreams}>
            {busy ? "Saving…" : "Save to Outreach"}
          </button>
        )}
        {selectedProspect && (
          <div className="ar-given-row">
            <span className="fld-label">Advance given?</span>
            <button className={selectedProspect.advanceGiven === "Yes" ? "btn sm" : "btn ghost sm"} onClick={() => setGiven(true)} disabled={busy}>Yes</button>
            <button className={selectedProspect.advanceGiven === "No" || !selectedProspect.advanceGiven ? "btn sm" : "btn ghost sm"} onClick={() => setGiven(false)} disabled={busy}>No</button>
          </div>
        )}
        {selectedClient && (
          <p className="hint">Signed clients aren't tracked in the Given/budget total above — this is for planning an additional advance only.</p>
        )}
      </div>

      <div className="cat-summary" style={{ marginTop: 20 }}>
        <div className="cat-summary-grid">
          <div className="cat-stat"><span className="cat-stat-label">Recommended Advance</span><span className="cat-stat-val">{money(result.advance)}</span></div>
          <div className="cat-stat"><span className="cat-stat-label">Months to Recoup</span><span className="cat-stat-val">{result.monthsToRecoup != null ? `${result.monthsToRecoup.toFixed(1)} mo` : "—"}</span></div>
          <div className="cat-stat"><span className="cat-stat-label">Coverage</span><span className="cat-stat-val">{result.coverage != null ? `${result.coverage.toFixed(1)}x` : "—"}</span></div>
          <div className="cat-stat"><span className="cat-stat-label">Verdict</span><span className="cat-stat-val">{result.verdict || "—"}</span></div>
        </div>
      </div>

      <div className="split-list" style={{ marginTop: 16 }}>
        <div className="split-list-row"><span className="split-name">Proj. Royalties Yr 1</span><span className="split-pct">{money(result.royYr1)}</span></div>
        <div className="split-list-row"><span className="split-name">Proj. Royalties Yr 2</span><span className="split-pct">{money(result.royYr2)}</span></div>
        <div className="split-list-row"><span className="split-name">Proj. Royalties Yr 3</span><span className="split-pct">{money(result.royYr3)}</span></div>
        <div className="split-list-row split-list-total"><span>Proj. Royalties 3-Yr</span><span>{money(result.roy3yr)}</span></div>
      </div>
      <div className="split-list" style={{ marginTop: 12 }}>
        <div className="split-list-row"><span className="split-name">Admin Yr 1</span><span className="split-pct">{money(result.adminYr1)}</span></div>
        <div className="split-list-row"><span className="split-name">Admin Yr 2</span><span className="split-pct">{money(result.adminYr2)}</span></div>
        <div className="split-list-row"><span className="split-name">Admin Yr 3</span><span className="split-pct">{money(result.adminYr3)}</span></div>
        <div className="split-list-row split-list-total"><span>Your Admin 3-Yr</span><span>{money(result.admin3yr)}</span></div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CLIENT PORTAL                                                       */
/* ------------------------------------------------------------------ */
/*  shared: song + splits manager (used by client portal and staff)    */
function SongManager({ db, commit, clientId, isStaff }) {
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
      const mine = (p.splits || []).find((s) => s.name === client?.name);
      net += streams * ((Number(mine?.percent) || 0) / 100);
      revenue += p.revenue || 0;
      adminFee += p.adminFee || 0;
    }
    return { gross, net, revenue, adminFee };
  }, [songs, client?.name]);
  const [openId, setOpenId] = useState(null);
  const [editing, setEditing] = useState(null);
  const active = songs.find((p) => p.id === openId);
  const [pushWarn, setPushWarn] = useState(null);
  useEffect(() => {
    if (!active && !editing) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [active, editing]);

  const saveSong = async (o) => {
    // catch likely duplicates before they happen — same title plus at least
    // one more matching signal (the credited artist, or a shared name in
    // the splits) is "probably a dupe"; same title alone isn't (two real,
    // different songs can share a title with different people on them).
    const normTitle = normalizeTitle(o.song);
    const normArtist = normalizeTitle(o.artist);
    const myName = normalizeTitle(client?.name);
    // exclude the client's own name — they're on every song on their own
    // page, so that alone would "match" any two same-titled entries.
    const mySplitNames = new Set((o.splits || []).map((s) => normalizeTitle(s.name)).filter((n) => n && n !== myName));
    const possibleDup = songs.find((p) => {
      if (p.id === o.id) return false;
      if (normalizeTitle(p.song) !== normTitle || !normTitle) return false;
      const artistMatch = normArtist && normalizeTitle(p.artist) === normArtist;
      const splitMatch = (p.splits || []).some((s) => mySplitNames.has(normalizeTitle(s.name)));
      return artistMatch || splitMatch;
    });
    if (possibleDup) {
      const n = (possibleDup.splits || []).length;
      const ok = window.confirm(`This looks like it might already exist here: "${possibleDup.song}" by ${possibleDup.artist || "—"} (${n} split${n === 1 ? "" : "s"}). Save this as a separate song anyway?`);
      if (!ok) return;
    }
    const placementId = o.id || uid();
    const saved = { ...o, id: placementId, clientId };
    const placements = o.id
      ? db.placements.map((p) => p.id === o.id ? saved : p)
      : [...db.placements, saved];
    await commit({ ...db, placements });
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
    const mine = (saved.splits || []).find((s) => s.name === client?.name);
    const splits = mine ? [{ name: client?.sheetTabName || client?.name, percent: mine.percent }] : [];
    fetch("/api/sheets-push", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
      body: JSON.stringify({
        placementId, song: saved.song, artist: saved.artist, luminateId: saved.luminateId, splits,
        // lets the push route tell a genuinely-still-claimed sheet row apart
        // from one whose syncId belongs to a placement that no longer
        // exists on this browser — see findUnclaimedRowByTitle.
        liveIds: placements.map((p) => p.id),
      }),
    }).then(async (res) => {
      if (res.ok) return;
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Sheet sync failed (${res.status})`);
    }).catch((err) => {
      console.error("Sheet push failed:", err);
      if (isStaff) setPushWarn(err.message || "Sheet sync failed — the local save is fine, but the pub sheet wasn't updated.");
    });
  };
  const removeSong = async (id) => {
    const target = songs.find((p) => p.id === id);
    await commit({ ...db, placements: db.placements.filter((p) => p.id !== id) });
    setOpenId(null); setEditing(null);
    if (!target) return;
    const mine = (target.splits || []).find((s) => s.name === client?.name);
    if (!mine) return; // nothing was ever pushed under this client for this song
    const splits = [{ name: client?.sheetTabName || client?.name }];
    fetch("/api/sheets-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
      body: JSON.stringify({ placementId: id, splits }),
    }).then(async (res) => {
      if (res.ok) return;
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Sheet delete failed (${res.status})`);
    }).catch((err) => {
      console.error("Sheet delete failed:", err);
      if (isStaff) setPushWarn(err.message || "Deleted locally, but the pub sheet row wasn't cleared.");
    });
  };
  const startAdd = () => setEditing({ id: null, clientId, song: "", artist: client?.name || "", releaseDate: "", link: "", cover: "", notable: false, luminateId: "", splits: [{ id: uid(), name: client?.name || "", role: client?.role || "", percent: 0 }] });

  return (
    <>
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
                <div className="cat-stat"><span className="cat-stat-label">Pub Money</span><span className="cat-stat-val">{money(summary.revenue)}</span></div>
                <div className="cat-stat"><span className="cat-stat-label">Admin Money</span><span className="cat-stat-val">{money(summary.adminFee)}</span></div>
              </>
            ) : (
              <div className="cat-stat"><span className="cat-stat-label">Songs</span><span className="cat-stat-val">{songs.length}</span></div>
            )}
          </div>
        </div>
      )}

      {songs.length === 0 ? (
        <p className="muted">No songs yet — add the first one.</p>
      ) : (
        <div className="song-grid">
          {songs.map((p) => (
            <button key={p.id} className="song-card" onClick={() => setOpenId(p.id)}>
              <div className="song-cover">
                {p.cover ? <Photo src={p.cover} alt={p.song} /> : <div className="song-cover-empty"><Disc3 size={26} /></div>}
              </div>
              <div className="song-info">
                <strong>{p.song || "Untitled"}</strong>
                <span>{p.artist}</span>
                <em>{(p.splits || []).length} Splits · {splitTotal(p.splits)}%{p.notable ? " · ★ Featured" : ""}</em>
              </div>
            </button>
          ))}
        </div>
      )}

      {active && !editing && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setOpenId(null)}>
          <div className="modal-card song-detail">
            <div className="modal-head"><h3>{active.song || "Untitled"}</h3><button onClick={() => setOpenId(null)}><X size={18} /></button></div>
            <div className="modal-body">
              <div className="song-detail-top">
                <div className="song-detail-cover">
                  {active.cover ? <Photo src={active.cover} alt="" /> : <div className="song-cover-empty"><Disc3 size={30} /></div>}
                </div>
                <div>
                  <div className="song-detail-artist">{active.artist}</div>
                  {active.releaseDate && <div className="song-detail-date">{new Date(active.releaseDate).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</div>}
                  {active.link && <ExtLink className="inline-link" href={active.link}>Open track ↗</ExtLink>}
                </div>
              </div>
              <SplitsPie splits={active.splits} size={230} />
              <div className="split-list">
                {(active.splits || []).map((s) => (
                  <div key={s.id} className="split-list-row">
                    <span className="split-name">{s.name || "—"}{s.role && <em> · {s.role}</em>}</span>
                    <span className="split-pct">{s.percent}%</span>
                  </div>
                ))}
                <div className="split-list-row split-list-total">
                  <span>Total</span><span className={splitTotal(active.splits) === 100 ? "split-ok" : "split-warn"}>{splitTotal(active.splits)}%</span>
                </div>
              </div>
              {db.sheetSync?.lastSyncedAt && (
                <div className="split-list">
                  <div className="split-list-row"><span className="split-name">Streams</span><span className="split-pct">{fmt(active.streams)}</span></div>
                  {isStaff && (
                    <>
                      <div className="split-list-row"><span className="split-name">Gross revenue</span><span className="split-pct">{money(active.revenue)}</span></div>
                      <div className="split-list-row"><span className="split-name">Admin fee</span><span className="split-pct">{money(active.adminFee)}</span></div>
                    </>
                  )}
                  <p className="hint">as of {new Date(db.sheetSync.lastSyncedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</p>
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn ghost sm" onClick={() => { if (window.confirm(`Delete "${active.song || "this song"}"? This can't be undone.`)) removeSong(active.id); }}>Delete</button>
              <button className="btn sm" onClick={() => setEditing({ ...active })}>Edit</button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setEditing(null)}>
          <div className="modal-card">
            <div className="modal-head"><h3>{editing.id ? "Edit song" : "Add song"}</h3><button onClick={() => setEditing(null)}><X size={18} /></button></div>
            <div className="modal-body">
              <SpotifyFill e={editing} set={setEditing} />
              <PhotoUpload label="Cover art" value={editing.cover} onChange={(v) => setEditing({ ...editing, cover: v })} />
              <Field label="Song" value={editing.song} onChange={(ev) => setEditing({ ...editing, song: ev.target.value })} />
              <Field label="Artist" value={editing.artist} onChange={(ev) => setEditing({ ...editing, artist: ev.target.value })} />
              <Field label="Release date" type="date" value={editing.releaseDate} onChange={(ev) => setEditing({ ...editing, releaseDate: ev.target.value })} />
              <Field label="Streaming link" value={editing.link} onChange={(ev) => setEditing({ ...editing, link: ev.target.value })} />
              <SplitsEditor splits={editing.splits} onChange={(v) => setEditing({ ...editing, splits: v })} />
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
            <div className="modal-foot">
              <button className="btn ghost sm" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn sm" onClick={() => saveSong(editing)}>Save</button>
            </div>
          </div>
        </div>
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
          {done && !open && <p className="hint" style={{ color: "#8fce8f" }}>Password changed.</p>}
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

function ClientPortal({ db, commit, session, logout }) {
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
          <button onClick={logout}><LogOut size={16} /> Sign out</button>
        </div>
      </header>
      <main className="portal-main">
        <div className="portal-role">Your catalog — only you and Defied staff can see this</div>
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

// Full site-wide sync — merges sheet data onto existing placements (via
// pullAndMergeSheetData) AND picks up any genuinely new song staff typed
// straight into the sheet, claiming its row back with a Site Sync ID.
// Shared by the "Sync from sheet" button and the Overview page's "Sync
// Streams" button, which chains this right after refreshing STREAM DATA so
// one click keeps both the sheet and the site current — see runStreamSync.
async function fullSiteSync(db, commit) {
  const { data, totalsByClient, rowsByClient, claimedRows, placements } = await pullAndMergeSheetData(db, db.clients);

  // a client's tab can hold more than one row for the same title (an old
  // duplicate row from before this feature existed, a re-typed entry,
  // etc.) — the match above only ever claims ONE row per placement, so
  // track every title a client already has on the site and skip the
  // rest rather than importing each leftover duplicate as a new song.
  const existingTitles = new Map(); // clientId -> Set(normalizedTitle)
  for (const p of db.placements) {
    const set = existingTitles.get(p.clientId) || new Set();
    set.add(normalizeTitle(p.song));
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
      const id = uid();
      created.push({
        id, clientId: c.id, song: row.song, artist: row.artist || c.name,
        releaseDate: "", link: "", cover: "", notable: false,
        luminateId: row.luminateId || "",
        splits: [{ id: uid(), name: c.name, role: c.role || "", percent: row.writerShare || 100 }],
        streams: row.grossStreams, revenue: row.grossRevenue, adminFee: row.adminFee,
      });
      const tabName = c.sheetTabName || c.name;
      claims.push({ tab: tabName, row: row.row, syncId: `${id}:${tabName.toLowerCase()}` });
    }
  }

  const clients = db.clients.map((c) => ({ ...c, totalStreams: totalsByClient[c.id] ?? c.totalStreams }));
  await commit({ ...db, placements: [...placements, ...created], clients, sheetSync: { lastSyncedAt: data.syncedAt } });

  if (claims.length) {
    fetch("/api/sheets-claim", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
      body: JSON.stringify({ claims }),
    }).catch((err) => console.error("Claim-back failed:", err));
  }

  // a client whose tab couldn't be found by name gets nothing synced at
  // all, with no other signal that anything's wrong — surface it here so
  // staff know to set that client's "Sheet tab name" override.
  const missing = data.clients.filter((c) => !c.tabFound).map((c) => db.clients.find((x) => x.id === c.clientId)?.name).filter(Boolean);
  return { missing };
}

// Read-only roster-wide rollup — the landing view of the Clients tab, before
// staff pick an individual client. Pulls the MASTER tab's own precomputed
// per-writer totals directly (rather than re-deriving them from placements)
// so the numbers always match the sheet exactly, including the 3-year
// forecast columns the site doesn't otherwise track anywhere.
function CatalogOverview({ db, commit, onSelectClient }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [streamSync, setStreamSync] = useState({ syncing: false, error: null });

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

  // triggers the "Luminate Portfolio Sync" Apps Script bound to the sheet
  // (reads the latest CSV exports from its Drive folder into STREAM DATA,
  // which every client tab's Gross Streams formula reads from live), then
  // chains a full site sync (fullSiteSync) so this one click — the only
  // manual sync action left anywhere on the site — updates the sheet AND
  // every client's numbers together, with the "as of" date below reflecting
  // that exact moment rather than whenever something last happened to pull.
  const runStreamSync = async () => {
    setStreamSync({ syncing: true, error: null });
    try {
      const res = await fetch("/api/sync-streams", { method: "POST", headers: { "X-Requested-With": "defied-site" } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Stream sync failed.");
      const { missing } = await fullSiteSync(db, commit);
      const res2 = await fetch("/api/sheets-master");
      const data2 = await res2.json();
      if (res2.ok) setState({ loading: false, error: null, data: data2 });
      setStreamSync({
        syncing: false,
        error: missing.length ? `No sheet tab found for: ${missing.join(", ")}. If they do have a tab under a different name, set "Sheet tab name" on their client profile.` : null,
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
  // match against THAT, not the label, with the same punctuation-tolerant
  // comparison as findTab server-side.
  const findClient = (row) => {
    const norm = (s) => (s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
    const target = norm(row.sheetTab || row.writer);
    if (!target) return null;
    return db.clients.find((c) => norm(c.sheetTabName || c.name) === target) || null;
  };

  const links = state.data?.links || {};
  return (
    <div>
      <div className="admin-head">
        <h2>Publishing Overview</h2>
        <div className="overview-links">
          <button className="btn ghost sm" onClick={runStreamSync} disabled={streamSync.syncing} title="Run the Luminate portfolio sync script">
            <RefreshCw size={14} className={streamSync.syncing ? "spin" : ""} /> {streamSync.syncing ? "Syncing streams…" : "Sync Streams"}
          </button>
          {links.folder && <ExtLink href={links.folder} className="btn ghost sm" title="Open the pub sheet's Drive folder"><Folder size={14} /> Folder</ExtLink>}
          {links.portfolioA && <ExtLink href={links.portfolioA} className="btn ghost sm" title="Open Luminate portfolio A"><ExternalLink size={14} /> Portfolio A</ExtLink>}
          {links.portfolioB && <ExtLink href={links.portfolioB} className="btn ghost sm" title="Open Luminate portfolio B"><ExternalLink size={14} /> Portfolio B</ExtLink>}
        </div>
      </div>
      <p className="hint overview-subhint">
        Read-only — pulled live from the MASTER tab.
        {db.sheetSync?.lastSyncedAt && ` Streams as of ${new Date(db.sheetSync.lastSyncedAt).toLocaleString()}.`}
      </p>
      {streamSync.error && <p className="hint err-text overview-subhint">{streamSync.error}</p>}

      {state.loading && <p className="muted">Loading master sheet data…</p>}
      {state.error && <p className="hint err-text">{state.error}</p>}

      {state.data && (
        <>
          <div className="cat-summary">
            <div className="cat-summary-grid">
              <div className="cat-stat"><span className="cat-stat-label">Gross Streams</span><span className="cat-stat-val">{fmt(state.data.totals.rosterGrossStreams)}</span></div>
              <div className="cat-stat"><span className="cat-stat-label">Net Streams</span><span className="cat-stat-val">{fmt(state.data.totals.rosterNetStreams)}</span></div>
              <div className="cat-stat"><span className="cat-stat-label">Revenue Pool</span><span className="cat-stat-val">{money(state.data.totals.grossRevenuePool)}</span></div>
              <div className="cat-stat"><span className="cat-stat-label">Catalog To Date</span><span className="cat-stat-val">{money(state.data.totals.catalogToDate)}</span></div>
              <div className="cat-stat"><span className="cat-stat-label">3-Year Forecast</span><span className="cat-stat-val">{money(state.data.totals.threeYearForecast)}</span></div>
              <div className="cat-stat"><span className="cat-stat-label">Est. Admin Fee</span><span className="cat-stat-val">{money(state.data.totals.totalEstAdminFee)}</span></div>
            </div>
          </div>

          <div className="master-table-wrap">
            <table className="master-table">
              <thead>
                <tr>
                  <th>Writer</th><th>Songs</th><th>Gross streams</th><th>Net streams</th>
                  <th>Gross revenue</th><th>Admin fee</th><th>Yr 1</th><th>Yr 2</th><th>Yr 3</th>
                  <th>3-yr forecast</th><th>Total est. fee</th><th>% of roster</th>
                </tr>
              </thead>
              <tbody>
                {state.data.rows.map((r) => {
                  const client = findClient(r);
                  return (
                    <tr
                      key={r.writer}
                      className={client ? "master-row-link" : ""}
                      onClick={client ? () => onSelectClient(client.id) : undefined}
                      title={client ? `Open ${client.name}` : "Not linked to a client on the site"}
                    >
                      <td>{client ? client.name : r.writer}</td>
                      <td>{r.songs}</td>
                      <td>{fmt(r.grossStreams)}</td>
                      <td>{fmt(r.netStreams)}</td>
                      <td>{money(r.grossRevenue)}</td>
                      <td>{money(r.adminFee)}</td>
                      <td>{money(r.year1)}</td>
                      <td>{money(r.year2)}</td>
                      <td>{money(r.year3)}</td>
                      <td>{money(r.forecastTotal)}</td>
                      <td>{money(r.totalEstAdminFee)}</td>
                      <td>{r.pctOfRoster}%</td>
                    </tr>
                  );
                })}
              </tbody>
              {state.data.rosterTotal && (
                <tfoot>
                  <tr className="master-total-row">
                    <td>Roster total</td>
                    <td>{state.data.rosterTotal.songs}</td>
                    <td>{fmt(state.data.rosterTotal.grossStreams)}</td>
                    <td>{fmt(state.data.rosterTotal.netStreams)}</td>
                    <td>{money(state.data.rosterTotal.grossRevenue)}</td>
                    <td>{money(state.data.rosterTotal.adminFee)}</td>
                    <td>{money(state.data.rosterTotal.year1)}</td>
                    <td>{money(state.data.rosterTotal.year2)}</td>
                    <td>{money(state.data.rosterTotal.year3)}</td>
                    <td>{money(state.data.rosterTotal.forecastTotal)}</td>
                    <td>{money(state.data.rosterTotal.totalEstAdminFee)}</td>
                    <td>{state.data.rosterTotal.pctOfRoster}%</td>
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

function CatalogAdmin({ db, commit }) {
  // null clientId = the read-only Overview landing page, not "no selection"
  const [clientId, setClientId] = useState(null);
  const client = db.clients.find((c) => c.id === clientId);
  const count = (cid) => db.placements.filter((p) => p.clientId === cid).length;
  const [addingClient, setAddingClient] = useState(false);
  const [newClientForm, setNewClientForm] = useState({ name: "", role: "Producer" });
  const [deleteWarn, setDeleteWarn] = useState(null);

  const addClient = async () => {
    const name = newClientForm.name.trim();
    if (!name) return;
    const client = {
      id: uid(), name, role: newClientForm.role, credit: "", bio: "", photo: "",
      spotify: "", apple: "", instagram: "", tiktok: "", youtube: "", soundcloud: "",
      sheetTabName: "", totalStreams: 0, onRoster: false,
    };
    await commit({ ...db, clients: [...db.clients, client] });
    setClientId(client.id);
    setAddingClient(false);
    setNewClientForm({ name: "", role: "Producer" });
  };

  const removeClient = async (c) => {
    const n = db.placements.filter((p) => p.clientId === c.id).length;
    const hasLogin = db.users.some((u) => u.clientId === c.id);
    const ok = window.confirm(`Delete ${c.name}? This also permanently deletes their ${n} song${n === 1 ? "" : "s"}, clears them from the pub sheet, removes them from the public roster if they're on it${hasLogin ? ", and removes their login" : ""}. This can't be undone.`);
    if (!ok) return;
    setDeleteWarn(null);
    if (clientId === c.id) setClientId(db.clients.find((x) => x.id !== c.id)?.id || null);
    const warn = await deleteClientCascade(db, commit, c.id);
    if (warn) setDeleteWarn(warn);
  };

  // db.sheetSync lives in this browser's localStorage, not on a server — a
  // device whose local copy is stale (never synced, or synced a while ago,
  // including before some bug fix here) would otherwise sit stale until
  // someone remembers to press a button. There's now exactly one manual
  // sync action (the Overview page's "Sync Streams" button, which chains a
  // full site sync after refreshing Luminate data) — this silently keeps
  // every other view current in the background instead of asking staff to
  // think about it, refreshing automatically whenever it's gone stale.
  useEffect(() => {
    if (isSheetSyncStale(db)) fullSiteSync(db, commit).catch((err) => console.error("Background sync failed:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="admin-head">
        <h2>Clients &amp; Catalog</h2>
      </div>
      <div className="catalog-wrap">
        <div className="catalog-clients">
          <button className={clientId === null ? "cc active" : "cc"} onClick={() => setClientId(null)}>
            <span className="cc-overview-ic"><LayoutGrid size={16} /></span>
            <span className="cc-name">Overview</span>
          </button>
          <button className="cc cc-add" onClick={() => setAddingClient(true)}><Plus size={14} /> Add client</button>
          {deleteWarn && <p className="hint err-text">{deleteWarn}</p>}
          {db.clients.map((c) => (
            <div key={c.id} className="cc-row">
              <button className={c.id === clientId ? "cc active" : "cc"} onClick={() => setClientId(c.id)}>
                <Avatar src={c.photo} name={c.name} size={30} />
                <span className="cc-name">{c.name}</span>
                <span className="cc-count">{count(c.id)}</span>
              </button>
              <button className="cc-del" onClick={() => removeClient(c)} title={`Delete ${c.name}`}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
        <div className="catalog-main">
          {clientId === null
            ? <CatalogOverview db={db} commit={commit} onSelectClient={setClientId} />
            : (client ? <SongManager db={db} commit={commit} clientId={clientId} isStaff /> : <p className="muted">Select a client.</p>)}
        </div>
      </div>

      {addingClient && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setAddingClient(false)}>
          <div className="modal-card">
            <div className="modal-head"><h3>New client</h3><button onClick={() => setAddingClient(false)}><X size={18} /></button></div>
            <div className="modal-body">
              <Field label="Name" value={newClientForm.name} onChange={(ev) => setNewClientForm({ ...newClientForm, name: ev.target.value })} onKeyDown={(ev) => ev.key === "Enter" && addClient()} />
              <label className="fld"><span>Role</span>
                <select value={newClientForm.role} onChange={(ev) => setNewClientForm({ ...newClientForm, role: ev.target.value })}>
                  <option>Producer</option><option>Artist</option><option>Producer / Artist</option>
                </select>
              </label>
              <p className="hint">Starts hidden from the public roster. Add a photo, bio, socials, and publish them any time from Website → Roster. Their pub sheet tab is created automatically the first time you add a song for them.</p>
            </div>
            <div className="modal-foot">
              <button className="btn ghost sm" onClick={() => setAddingClient(false)}>Cancel</button>
              <button className="btn sm" onClick={addClient} disabled={!newClientForm.name.trim()}>Add client</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* staff: website content (about, roster, staff, notable) -------------- */
function WebsiteAdmin({ db, commit }) {
  const [sec, setSec] = useState("about");
  const secs = [["about", "About page"], ["roster", "Roster"], ["staff", "Team"], ["notable", "Notable releases"]];
  return (
    <div>
      <div className="subnav">
        {secs.map(([id, label]) => (
          <button key={id} className={sec === id ? "subpill active" : "subpill"} onClick={() => setSec(id)}>{label}</button>
        ))}
      </div>
      {sec === "about" && <AboutEditor db={db} commit={commit} />}
      {sec === "roster" && <ClientsAdmin db={db} commit={commit} />}
      {sec === "staff" && <TeamAdmin db={db} commit={commit} />}
      {sec === "notable" && <NotableAdmin db={db} commit={commit} />}
    </div>
  );
}

function AboutEditor({ db, commit }) {
  const [text, setText] = useState(db.site?.about || "");
  const [saved, setSaved] = useState(false);
  const save = async () => {
    await commit({ ...db, site: { ...db.site, about: text } });
    setSaved(true); setTimeout(() => setSaved(false), 1600);
  };
  return (
    <div>
      <div className="admin-head"><h2>About page</h2><button className="btn sm" onClick={save}>{saved ? "Saved ✓" : "Save"}</button></div>
      <p className="muted mb">This text shows on the public About page. Leave a blank line between paragraphs.</p>
      <textarea className="about-editor" rows={9} value={text} onChange={(e) => setText(e.target.value)} />
    </div>
  );
}

function NotableAdmin({ db, commit }) {
  const list = db.notableReleases || [];
  const save = async (o) => {
    const notableReleases = o.id ? list.map((r) => r.id === o.id ? o : r) : [...list, { ...o, id: uid() }];
    await commit({ ...db, notableReleases });
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
      <p className="muted mb">Manually curated — these are the exact songs shown in the homepage “Notable Releases” section, independent of any artist’s song list. Paste a Spotify link below to auto-fill the song details, then enter which of our clients it's for.</p>
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
    .font-display{font-family:'Suntage','Inter',sans-serif;letter-spacing:.02em}


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
    .link-btn{background:none;border:none;color:var(--ink);font-size:13px;display:inline-flex;align-items:center;gap:4px;transition:color .15s ease;text-decoration:none;cursor:pointer}
    .link-btn:hover{color:var(--mut)}
    .link-btn.center{display:flex;margin:14px auto 0}


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
    .artist-overlay{padding:0;align-items:stretch;justify-content:stretch;overflow:hidden}
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
    .cc-del{background:none;border:none;color:var(--mut2);padding:6px;border-radius:6px;cursor:pointer;display:flex;align-items:center;flex-shrink:0;transition:color .15s ease,background-color .15s ease}
    .cc-del:hover{color:#e59a9a;background:var(--panel2)}
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
      .stat-row{grid-template-columns:1fr}
      .dash{flex-direction:column}
      .dash-side{width:auto;height:auto;position:static;flex-direction:row;flex-wrap:wrap;align-items:center;gap:6px}
      .dash-brand{padding:6px 8px;width:100%}
      .dash-side nav{flex-direction:row;flex-wrap:wrap}
      .dash-side nav button .nav-label{display:none}
      .dash-side nav button{padding:11px 13px}
      .dash-main{padding:24px 20px}
      .admin-row{grid-template-columns:1.4fr 1fr 60px !important;gap:8px}
      .admin-row .cell:nth-child(n+3){display:none}
      .admin-hd span:nth-child(n+3):not(.admin-act){display:none}
      /* reorder rows carry 4 action buttons (up/down/edit/delete), not 2 —
         the flat 60px above is too narrow and crams them into an overlapping mess */
      .admin-row-reorder{grid-template-columns:1.3fr 1fr 112px !important}
      .admin-row-reorder .admin-act{gap:4px}
      .admin-row-reorder .admin-act button{padding:5px}
      .splits-ed-row{grid-template-columns:1fr 74px 30px}
      .splits-ed-row input:nth-child(2){grid-column:1 / -1}
      .song-grid{grid-template-columns:repeat(2,1fr);gap:16px}
      .catalog-wrap{grid-template-columns:1fr}
      .catalog-clients{flex-direction:row;flex-wrap:nowrap;overflow-x:auto;max-height:none}
      .cc-row{flex-shrink:0}
      .cc{flex-direction:column;gap:4px;min-width:76px;text-align:center}
      .cc .cc-count{display:none}
      .team-links a,.ros-links a,.social-ic,.icon-btn{padding:6px}
    }
    @media(max-width:520px){
      .page{padding:64px 20px 48px}
      .form-card{padding:20px}
      /* modals sit comfortably in view on phones */
      .modal{align-items:flex-start;padding:16px 14px 28px}
      .artist-overlay{padding:0}
      .modal-body{padding:18px}
      .modal-head{padding:16px 18px}
      .song-detail-top{gap:12px}
      .song-detail-cover{width:70px;height:70px}
      .portal-main{padding:22px 18px 60px}
      .portal-nav{padding:14px 18px}
      .portal-block-head{flex-direction:column;align-items:stretch;gap:12px}
      .portal-block-head .btn{align-self:flex-start}
      .dash-role{margin-bottom:16px}
      .subnav{gap:6px}
      .subpill{padding:7px 13px;font-size:12.5px}
      .splits-ed{padding:11px}
      .split-list-row{font-size:13px}
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

    /* scroll-reveal (shared IntersectionObserver adds .is-in; --rv-delay staggers a batch) */
    [data-reveal]:not([data-reveal=split]){opacity:0;translate:0 26px}
    [data-reveal].is-in:not([data-reveal=split]){opacity:1;translate:none;
      transition:opacity .7s var(--ease-out) var(--rv-delay,0ms),translate .85s var(--ease-out) var(--rv-delay,0ms)}

    /* headline words rising out of clipped slots */
    .split{font-family:'Suntage','Inter',sans-serif;font-weight:400;font-synthesis:none;letter-spacing:.02em;text-transform:uppercase;text-wrap:balance}
    .split .w{display:inline-block;overflow:hidden;overflow:clip;vertical-align:top;padding:.1em .04em .14em;margin:-.1em -.04em -.14em}
    .split .w>span{display:inline-block;transform-origin:0 100%;animation:rise .85s var(--spring) both;animation-delay:calc(var(--d,80ms) + var(--i,0) * 45ms)}
    .split[data-reveal] .w>span{animation-play-state:paused}
    .split[data-reveal].is-in .w>span{animation-play-state:running}
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
    .lg{position:relative;isolation:isolate;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding-bottom:clamp(56px,8vw,100px)}
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
    .lg-check{position:relative;align-self:flex-start;display:flex;align-items:center;gap:12px;min-height:44px;margin:-8px 0;color:#b8b8b8;font-size:14px;cursor:pointer;-webkit-tap-highlight-color:transparent}
    .lg-check input{position:absolute;width:1px;height:1px;opacity:0;font-size:16px}
    .lg-check i{display:grid;place-items:center;flex-shrink:0;width:20px;height:20px;border:1px solid #3a3a3c;border-radius:6px;background:#0d0d0f;transition:background-color .2s ease,border-color .2s ease}
    .lg-check i::after{content:"";width:9px;height:5px;border-left:2px solid #000;border-bottom:2px solid #000;rotate:-45deg;translate:0 -1px;scale:.4;opacity:0;transition:opacity .15s ease,scale .3s var(--ease-out)}
    .lg-check:hover i{border-color:#6a6a6c}
    .lg-check input:checked+i{background:#f5f5f5;border-color:#f5f5f5}
    .lg-check input:checked+i::after{opacity:1;scale:1}
    .lg-check input:focus-visible+i{outline:2px solid #f5f5f5;outline-offset:3px}
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
    .st-ctx{color:#68686a}
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

    /* ---------- about ---------- */
    .about2-head{font-size:clamp(30px,5.3vw,76px);line-height:1.02;margin:0 auto 34px;max-width:1160px}
    .about2-body p{color:#b8b8b8;font-size:clamp(16px,1.3vw,18.5px);line-height:1.7;max-width:660px;margin:0 auto 18px;text-wrap:pretty;animation:rv .75s var(--ease-out) .4s both}
    /* the big credits band: cover, the artist in chrome, and the song and producer as a caption beside it */
    .about2-band{margin:clamp(56px,7vw,88px) calc(50% - 50vw) 0;padding:clamp(18px,2vw,26px) 0;border-top:1px solid var(--hair);border-bottom:1px solid var(--hair);
      font-family:'Suntage','Inter',sans-serif;font-size:clamp(22px,3.3vw,44px);line-height:1;letter-spacing:.03em;text-transform:uppercase;text-align:left;animation:vt-fade-in .8s ease .6s both}
    .about2-band .cr-cov{width:.95em;height:.95em;margin-right:.34em;border-radius:6px;--lift:scale(2.5) rotate(-4deg)}
    .about2-band .cr-txt{align-items:center}
    .about2-band .cr-artist{padding:.05em 0;background:var(--chrome);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
    .about2-band .cr-sub{flex-direction:column;gap:.6em;margin-left:.5em;font-size:max(9px,.25em);letter-spacing:.16em;line-height:1;color:var(--mut3)}
    .about2-band .cr-prod{color:#68686a}
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
    .pc-bio{margin:0;font-size:13.5px;line-height:1.55;color:var(--mut)}
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
    .ap-info>*{max-width:100%}
    .ap-name{align-self:stretch;margin:0;font-family:'Suntage','Inter',sans-serif;font-weight:400;font-synthesis:none;font-size:clamp(40px,8.6vw,132px);line-height:.95;letter-spacing:.01em;text-transform:uppercase;white-space:nowrap;overflow:hidden;
      padding:.04em 0;background:var(--chrome);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
    .ap-name-lock{display:inline-grid}
    .ap-name-lock>*{grid-area:1/1}
    .ap-name-ghost{visibility:hidden}
    .ap-name-live{contain:inline-size;overflow-x:clip}
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
    .ap-bio{margin:0;color:#b8b8b8;font-size:15.5px;line-height:1.7;max-width:560px}
    /* 1fr auto 1fr keeps the "3 / 15" counter dead centre whatever the two names' widths */
    .ap-bar{position:sticky;bottom:0;z-index:4;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;margin-top:-72px;
      padding:24px max(var(--gutter),calc(50% - 720px + var(--gutter))) calc(14px + env(safe-area-inset-bottom));background:linear-gradient(to top,#000 52%,rgba(0,0,0,0))}
    .ap-bar>button:first-child{justify-self:start}
    .ap-bar>button:last-child{justify-self:end}
    .ap-bar button{display:inline-flex;align-items:center;gap:10px;min-width:0;height:44px;padding:0 2px;background:none;border:0;color:var(--mut);
      font-family:'Suntage','Inter',sans-serif;font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;transition:color .2s ease}
    .ap-bar button:hover{color:var(--ink)}
    .ap-bar button:focus-visible{outline:1px solid #f5f5f5;outline-offset:2px;border-radius:6px}
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
    /* a password manager's fill keeps the dark field (browsers otherwise paint it pale blue or yellow) */
    .ct-fld input:-webkit-autofill{-webkit-text-fill-color:var(--ink);caret-color:var(--ink);box-shadow:0 0 0 100px #0d0d0f inset}
    .ct-fld input:-webkit-autofill:focus{box-shadow:0 0 0 100px #111113 inset,0 0 0 4px rgba(255,255,255,.08)}
    .ct-chips{justify-content:flex-start;gap:8px;padding:0;border:0;border-radius:0}
    .ct-chips .chip>span{height:40px;padding:0 15px;border:1px solid #2a2a2c;font-size:10px}
    .ct-chips .chip.on>span{border-color:transparent}
    .ct-err{margin:0;color:#e59a9a;font-size:13.5px;line-height:1.5}
    .ct-direct{margin:30px 0 0;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:4px 8px;color:var(--mut);font-size:14px}
    .ct-direct .inline-link{display:inline-block;padding:12px 0}
    .ct-direct-label::after{content:" —"}
    .ct-mail{display:inline-flex;align-items:center;white-space:nowrap}
    .ct-copy{display:inline-grid;place-items:center;width:44px;height:44px;margin:0 -10px 0 -6px;border-radius:50%;background:none;border:0;color:var(--mut);cursor:pointer;transition:color .2s ease,background-color .2s ease}
    .ct-copy:hover{color:var(--ink);background:#121214}
    .ct-sent{display:flex;flex-direction:column;align-items:center;gap:10px;padding:44px 8px;text-align:center}
    .ct-sent h3:focus{outline:none}
    .ct-check{width:60px;height:60px;margin-bottom:12px}
    .ct-check circle,.ct-check path{fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1}
    .ct-check circle{stroke:#3a3a3c;animation:draw .7s var(--ease-light) .15s forwards}
    .ct-check path{stroke:#f5f5f5;animation:draw .5s var(--ease-light) .55s forwards}
    .ct-sent h3{margin:0;font-family:'Suntage','Inter',sans-serif;font-weight:400;font-size:22px;letter-spacing:.06em;text-transform:uppercase}
    .ct-sent p{margin:0 0 16px;color:var(--mut);font-size:14.5px}
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
      .about2-head{font-size:clamp(28px,8.6vw,40px)}
      .about2-body p{margin-left:0;font-size:16px;line-height:1.65}
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
    `}</style>
  );
}
