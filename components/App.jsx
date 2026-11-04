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
  AlertTriangle, CheckCircle2, Clock, Link2, TrendingUp,
  LayoutDashboard, ListChecks, Receipt, CircleDollarSign, Flag, ChevronRight, Info, Eye, MoreHorizontal,
  Globe, CalendarDays, ChevronLeft, List as ListIcon,
} from "lucide-react";
import { evenSplit, splitWords, filledSplits, orderSplits } from "../lib/splits";
import LinkBox from "./LinkBox";
import { ArTrackers, HomeMomentum } from "./ar/ArTrackers";
import { ArRadar } from "./ar/ArRadar";
import { songGaps, netStreamsOf, SONG_GAPS } from "../lib/sheet-facts";
import { likelyDuplicates, mergedCard, mergedTitle, plainTitle } from "../lib/duplicates";
import { biggestTasks, dueBucket, nyDay } from "../lib/todo-rank";
import { shareFixes, autoConfirms, autoWords } from "../lib/split-fixes";
import { foldMonths } from "../lib/months";
import { SECTIONS, ROLES, ROLE_KEYS, TAB_SECTION, AREA_SECTION, accessFor, cleanAccess, sameManager } from "../lib/roles";
import { MAX_DATA_BYTES } from "../lib/image-links";
import { PhoneSort, LazySection } from "./ui/responsive";
import { swrJson, peekJson } from "./ui/fetch-cache";

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
// (uploaded photos are Vercel Blob links, *.public.blob.vercel-storage.com, listed there too)
const OPTIMIZABLE = /^(?:\/(?!\/)|https:\/\/(?:i\.scdn\.co|www\.defiedmgmt\.com|[a-z0-9-]+\.public\.blob\.vercel-storage\.com)\/)/i;
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

// A cropped photo (a data: URI) goes to file storage (/api/upload-image, Vercel Blob) and the row keeps
// only its link: { url } or { error }. Where storage isn't set up, the image stays inside the row as before.
async function storeImage(dataUrl) {
  const type = /^data:([^;,]+)/.exec(dataUrl)?.[1] || "image/jpeg";
  const bin = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  let res = null, data = null;
  try {
    res = await fetch("/api/upload-image", { method: "POST", headers: { "Content-Type": type, "X-Requested-With": "defied-site" }, body: bytes });
    data = await res.json().catch(() => null);
  } catch { return { error: "Couldn't reach the server, so the photo wasn't added. Check your connection and try again." }; }
  if (res.ok && data?.url) return { url: data.url };
  if (res.status === 503 && data?.code === "no-store") return { url: dataUrl };
  if (res.status === 401) return { error: "You've been signed out. Sign in again, then add the photo." };
  return { error: data?.error || "Couldn't add that photo. Try again." };
}

function PhotoUpload({ label, value, onChange }) {
  const [busy, setBusy] = useState(false);
  const [cropSrc, setCropSrc] = useState(null);
  const [err, setErr] = useState(null);
  // the upload takes a moment: its link goes onto the form as it is then (typed changes kept), and is
  // dropped if the form was closed meanwhile
  const latest = useRef(onChange);
  latest.current = onChange;
  const open = useRef(true);
  useEffect(() => () => { open.current = false; }, []);
  const pick = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setBusy("Loading…"); setErr(null);
    try { setCropSrc(await fileToDataURL(file)); }
    catch { setErr("Couldn't read that image. HEIC photos need a moment to convert — try again, or use a JPG/PNG."); }
    setBusy(false);
  };
  const use = async (d) => {
    setCropSrc(null); setBusy("Uploading…"); setErr(null);
    const r = await storeImage(d);
    if (!open.current) return;
    setBusy(false);
    if (r.url) latest.current(r.url); else setErr(r.error);
  };
  return (
    <div className="fld" data-photo-upload="">
      <span>{label}</span>
      <div className="photo-up">
        {value ? <img className="photo-prev" src={value} alt="" /> : <div className="photo-prev photo-prev-empty">No photo</div>}
        <div className="photo-actions">
          <label className={`btn ghost sm photo-btn${busy ? " is-busy" : ""}`} aria-busy={!!busy}>
            {busy || (value ? "Replace photo" : "Upload photo")}
            <input type="file" accept="image/*,.heic,.heif" onChange={pick} hidden disabled={!!busy} />
          </label>
          {value && !busy && <button type="button" className="photo-remove" onClick={() => onChange("")}>Remove</button>}
        </div>
      </div>
      {err && <p className="hint err-text" role="alert">{err}</p>}
      {cropSrc && <CropModal src={cropSrc} onCancel={() => setCropSrc(null)} onDone={use} />}
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
// one wording for how fresh the sheet's streams are (Publishing's subline, a client's page, a song window):
// they're the pub sheet's, whose STREAM DATA tab keeps Luminate's last numbers (lumDay) and isn't updated
// any more (list B #3), and when the site last pulled the sheet
// sheet: STREAM DATA's writer (GET /api/songs streamSheet): once it has written, the sheet's streams are its numbers
function streamsAsOf({ lumDay, pulledAt, sheet }) {
  const pulled = pulledAt ? ` · sheet pulled ${new Date(pulledAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "";
  const short = (d) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (sheet?.on && sheet.at) return `Pub sheet streams (${sheet.mode === "spotify" ? "Spotify plays" : "Spotify estimate"}, ${short(sheet.at)})${pulled}`;
  return `Pub sheet streams${lumDay ? ` (Luminate's last numbers, ${short(`${lumDay}T12:00:00`)})` : ""}${pulled}`;
}
// the one line staff see about it (Publishing's overview and a client's page): the owner decides what feeds the sheet next

// recharts (~350KB min / ~90KB gzip) is only drawn in the song-splits view (staff Clients tab +
// client portal) — loaded on demand so the public pages never carry it
const SplitsPieChart = dynamic(() => import("./SplitsPieChart"), { ssr: false });
function SplitsPie({ splits, size = 220 }) {
  const data = (splits || []).filter((s) => Number(s.percent) > 0)
    .map((s) => ({ name: s.name || s.label || s.role || "—", value: Number(s.percent) || 0 }));
  if (data.length === 0) return <p className="muted">No splits entered yet.</p>;
  return <div style={{ height: size }}><SplitsPieChart data={data} size={size} colors={PIE_COLORS} /></div>;
}

function SplitsEditor({ splits, onChange, focusPct = 0, assume = true, owner = null }) {
  const all = splits || [];
  // the even default (lib/splits.js), live: a 25 typed for a producer shows the unnamed producer at 25 and the
  // artist side at once, and Save writes exactly these rows. While the total is off the unnamed people are the
  // rule's own, so only the named ones are typed into. A client's own editor (assume = false) never fills:
  // the even default is the owner's to confirm, so a client saves exactly what they typed
  const fill = assume ? evenSplit(all) : { status: splitTotal(all) === 100 ? "ok" : "look", splits: all, added: [], reason: "" };
  const rows = !assume || fill.status === "ok" ? all : all.filter((r) => !r.unnamed);
  const shown = fill.status === "assumed" ? fill.splits : rows;
  const filled = (id) => fill.splits.find((x) => x.id === id);
  // a blank share stays blank in its box (the even share is only its placeholder), so typing replaces it and
  // never adds to it. Named people keep the order they were typed in; the rule's unnamed people come after
  const blankShare = (r) => fill.status === "assumed" && !(Number(r.percent) > 0);
  // listed in the song window's order (orderSplits), taken once when the editor opens, so a row never jumps
  // while its role is typed; rows added after that stay at the end
  const [order] = useState(() => orderSplits(all).map((r) => r.id));
  const at = (r) => { const i = order.indexOf(r.id); return i === -1 ? order.length : i; };
  const named = rows.map((r, i) => [r, i]).sort((a, b) => at(a[0]) - at(b[0]) || a[1] - b[1]).map(([r]) => r);
  const list = fill.status === "assumed" ? [...named, ...orderSplits(fill.added).map((r, i) => ({ ...r, key: `unnamed-${i}` }))] : named;
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
  const mine = fill.status === "assumed" && owner?.name ? findByName(fill.splits, owner.name) : null;
  return (
    <div className="splits-ed" ref={box}>
      {/* shown to one decimal like everywhere else (1/3 is 33.3%, not 33.333333333333336%); the saved % is unchanged */}
      <div className="splits-ed-head"><span>Splits</span><span className={total === 100 ? "split-ok" : "split-warn"}>{splitPct(shown)}%</span></div>
      {list.map((r) => r.unnamed ? (
        <div key={r.key || r.id} className="splits-ed-row split-assumed" data-unnamed>
          {/* one box over the name and role columns: "Producer 2 (unnamed)" already says the role, and is never cut */}
          <span className="split-unnamed" title={r.label || `${r.role} (unnamed)`}>{r.label || `${r.role} (unnamed)`}</span>
          <span className="pct-in pct-assumed">{splitPct([r])}%</span>
          <span aria-hidden="true" />
        </div>
      ) : (
        <div key={r.id} className="splits-ed-row">
          <input placeholder="Name" value={r.name} onChange={(e) => update(r.id, "name", e.target.value)} />
          <input placeholder="Role" value={r.role} onChange={(e) => update(r.id, "role", e.target.value)} />
          {/* a listed person with no share shows the even share they'll get, as a placeholder only */}
          <span className={`pct-in${blankShare(r) ? " pct-blank" : ""}`}><input type="number" min="0" max="100" value={blankShare(r) ? "" : r.percent} placeholder={blankShare(r) ? String(splitPct([filled(r.id) || r])) : undefined} onChange={(e) => update(r.id, "percent", e.target.value === "" ? 0 : Number(e.target.value))} />%</span>
          <button type="button" className="split-del" onClick={() => remove(r.id)} aria-label="Remove"><Trash2 size={14} /></button>
        </div>
      ))}
      <button type="button" className="btn ghost sm" onClick={add}><Plus size={14} /> Add split</button>
      {fill.status === "assumed" && <p className="split-hint split-even" data-even>Even split assumed: {splitWords(fill.splits, rows)}. Save keeps this split{mine ? ` and writes ${owner.name}'s ${splitPct([mine])}% to the ${owner.sheetTabName?.trim() || owner.name} tab of the pub sheet` : ""}. Unnamed people stay on the site only.</p>}
      {fill.status === "look" && rows.length > 0 && <p className="split-hint">Splits should total 100% (currently {splitPct(rows)}%).{fill.reason ? ` ${fill.reason}.` : ""}</p>}
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

// the line a Delete, "This isn't ours" or a To do answer leaves
function DropNote({ note }) {
  if (!note) return null;
  return (
    <p className={note.warn ? "hint del-note warn" : "hint del-note"} role="status">
      {note.warn ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />} <span>{note.text}</span>
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
  const saves = useRef({ chain: Promise.resolve(), pending: 0, held: 0, calls: 0, failed: false, server: null, gen: 0, freshAt: 0 });

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
  // quiet: a save the dashboard makes by itself (r7: an even split the sheet already has), which the next load
  // would make again: leaving the page while it's on its way doesn't ask "leave the page?"
  const commit = (next, base = shownDb.current, { quiet = false } = {}) => {
    const patch = diffDb(base, next);
    if (!patch) return Promise.resolve(next);
    const s = saves.current, gen = s.gen;
    setDb((cur) => (cur === base ? next : cur && applyPatch(cur, patch)));
    // leaving now would drop it: the browser asks first while anything is unsaved
    s.pending++;
    if (!quiet && s.held++ === 0) window.addEventListener("beforeunload", holdUnload);
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
        if (!quiet && --s.held === 0) window.removeEventListener("beforeunload", holdUnload);
        if (--s.pending === 0) { s.failed = false; if (gen === s.gen) setDb(s.server); }
        else if (saved && patch.users && gen === s.gen) setDb(withoutPasswords);
      }
      return saved;
    });
    s.chain = run;
    return run;
  };

  // after the server changed data itself (a sheet tab fixed, a song removed): swap in its copy once the
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
// the dashboard loads everything in one reply, and Vercel won't send one over 4.5 MB (lib/image-links.js: photos
// are links now, so only the ones from before still count much)
const MAX_DATA = MAX_DATA_BYTES;
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

// Roles (lib/roles.js): may this account use that section? The server says which in db.access (and
// enforces it on every request); with no db.access (a client's portal) nothing here applies.
const canUse = (db, k) => !db?.access || db.access.sections.includes(k);
// r7: Home (numbers), To do (every to-do, finished in place), the dashboards, and Site (Website, Users,
// Messages, Sync). The old tabs and links keep working: placeOf says where each one lives now.
const DASH_TABS = ["home", "todo", "catalog", "numbers", "money", "ar", "site"];
const TODO_AREAS = ["money", "roster", "ar", "clickup", "site"];
function placeOf(t, s) {
  const sub = typeof s === "string" && s ? s : null;
  if (t === "accounting") return sub === "log" || sub === "check" ? { tab: "todo", sub } : { tab: "money", sub: sub === "payments" ? "payments" : null };
  if (t === "website") return { tab: "site", sub };
  if (t === "users") return { tab: "site", sub: "users" };
  if (t === "subs") return { tab: "site", sub: "messages" };
  if (t === "catalog" && ["splits", "update", "dupes"].includes(sub)) return { tab: "todo", sub };
  // (list B #3: the Luminate tab is gone; its old links open Numbers, where the new numbers are)
  if (t === "luminate") return { tab: "numbers", sub: null };
  const tab = DASH_TABS.includes(t) ? t : "home";
  return { tab, sub: tab !== "home" ? sub : null };
}
function StaffDashboard({ db, commit, reloadDb, logout, signingOut }) {
  // sub = where a link points inside the tab it opens ("advance", "client:<id>", To do's item or area):
  // read once as the tab mounts, so the sidebar always opens a tab on its usual start
  // The address bar carries {tab, sub} (/dashboard?tab=catalog&sub=advance), so the browser's Back and
  // Forward step through sections instead of leaving the dashboard, and a reload stays where it was
  const router = useRouter();
  const fromQuery = (q) => placeOf(q?.tab, q?.sub);
  const [{ tab, sub }, setAt] = useState(() => fromQuery(router.query));
  const toUrl = (t, s, how = "push") => {
    const query = t === "home" && !s ? {} : { tab: t, ...(s ? { sub: s } : {}) };
    const next = new URLSearchParams(query).toString();
    if (next === new URLSearchParams(window.location.search).toString()) return; // the same place: no extra Back step
    router[how]({ pathname: "/dashboard", query }, undefined, { shallow: true, scroll: false });
  };
  const setTab = (t) => { setAt({ tab: t, sub: null }); toUrl(t, null); };
  const go = (t0, s0 = null) => { const { tab: t, sub: s } = placeOf(t0, s0); setAt({ tab: t, sub: s }); toUrl(t, s); window.scrollTo(0, 0); };
  // a page's own pickers (Publishing's client, Site's tab) update the address in place: one Back
  // step per section, not one per chip
  const setSub = (s) => { setAt((cur) => (cur.sub === s ? cur : { ...cur, sub: s })); toUrl(tab, s, "replace"); };
  // Back / Forward (and a reload): the address says where to be; an old address is rewritten to its new place
  useEffect(() => {
    if (!router.isReady) return;
    const at = fromQuery(router.query);
    setAt((cur) => (cur.tab === at.tab && cur.sub === at.sub ? cur : at));
    if (router.query.tab && (router.query.tab !== at.tab || (router.query.sub || null) !== at.sub)) toUrl(at.tab, at.sub, "replace");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.query.tab, router.query.sub]);
  // each song's extra facts (GET /api/songs: ISRCs, the finder's guesses, the pairs that aren't the same
  // song, the sheet tabs the last pull couldn't find): loaded first, then again whenever Home or To do
  // opens and after anything that changes them. songInfoErr = it couldn't load, so the cards say so.
  const [songInfo, setSongInfo] = useState(null);
  const [songInfoErr, setSongInfoErr] = useState(false);
  const reloadSongInfo = () => {
    setSongInfoErr(false);
    return fetch("/api/songs", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.tracking) setSongInfo(d); else setSongInfoErr(true); }).catch(() => setSongInfoErr(true));
  };
  const can = (k) => canUse(db, k);
  const songInfoOff = !can("publishing");
  useEffect(() => {
    if (songInfoOff) return;
    if (tab === "home" || tab === "todo" || !songInfo) reloadSongInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  // what the old Luminate portfolios' starting list still needs (list B #3): To do's two rows
  const seeds = useSeeds(tab, can("publishing") || can("ar"));
  // db.sheetSync is the site's last sheet sync (site_settings.last_synced_at
  // in the database) — a copy that's stale (never synced, or synced a while
  // ago, including before some bug fix here) would otherwise sit stale until
  // someone remembers to press a button. There's exactly one manual sync
  // action (Publishing's "Refresh numbers") — this silently keeps every
  // other view current in the background instead, whenever Home, To do or
  // Publishing opens on a stale copy. One run at a time: a quick hop from
  // one to the other doesn't start a second.
  const syncing = useRef(false);
  useEffect(() => {
    if ((tab !== "home" && tab !== "catalog" && tab !== "todo") || syncing.current || !can("publishing") || !isSheetSyncStale(db)) return;
    syncing.current = true;
    fullSiteSync(db, commit).catch((err) => console.error("Background sync failed:", err)).finally(() => { syncing.current = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  // A&R's counts (follow-ups due), Money's (payments to
  // log, rows to check), ClickUp's open tasks and the sync checks: To do's rows, its one count in the
  // sidebar, Home's biggest tasks and each tab's count chip all come from these
  const arSum = useArSummary(tab === "todo" ? "home" : tab);
  const [acctN, setAcctN] = useState(null);
  const loadAcctN = () => !can("money") ? Promise.resolve() : fetch("/api/accounting?counts=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => d?.counts && setAcctN(d.counts)).catch(() => {});
  useEffect(() => { loadAcctN(); }, []);
  useEffect(() => { if (tab === "todo") loadAcctN(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const cu = useCuTasks(tab);
  const sync = useSyncChecks(tab);
  const fixes = useSplitFixes();
  const doneForYou = useAutoConfirm({ db, commit, songInfo, fixes });
  // only the areas this account may use (lib/roles.js)
  const todo = useMemo(() => todoItems({ db, songInfo, acct: acctN, ar: arSum, sync: sync.data, seeds: seeds.data }).filter((it) => can(AREA_SECTION[it.area] || "todo")), [db, songInfo, acctN, arSum, sync.data, seeds.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const cuDue = (cu.data?.tasks || []).filter((t) => dueBucket(t.due) === "overdue" || dueBucket(t.due) === "today");
  const todoN = todo.length + cuDue.length;
  const areaN = (a) => (a === "clickup" ? cuDue.length : todo.filter((it) => it.area === a).length);
  const ctx = { db, commit, reloadDb, songInfo, songInfoErr, songInfoOff, reloadSongInfo, onGo: go, cu, sync, ar: arSum, acct: acctN, reloadAcct: loadAcctN, setAcct: setAcctN, fixes, doneForYou, can, seeds };
  const allTabs = [
    ["home", "Home", LayoutDashboard], ["todo", "To do", ListChecks, todoN],
    ["catalog", "Publishing", ListMusic, 0, "roster"], ["numbers", "Numbers", TrendingUp, 0, "roster"], ["money", "Money", Receipt, 0, "money"],
    ["ar", "A&R", Handshake, 0, "ar"], ["site", "Site", Globe, 0, "site"],
  ];
  // the tabs this account may use: Site holds Users too. Any other address opens the first of them.
  const tabs = allTabs.filter(([id]) => (id === "site" ? can("site") || can("users") : id === "numbers" ? can("publishing") : can(TAB_SECTION[id])));
  const at = tabs.some(([id]) => id === tab) ? tab : tabs[0]?.[0];
  const roleWord = db.access ? `${ROLES[db.access.role]?.label || "Staff"}${db.access.ownOnly ? " · own artists" : ""}` : "Staff — full edit access";
  return (
    <div className="dash">
      <aside className="dash-side">
        <div className="dash-brand"><Link href={ROUTE_TO_PATH.home} className="logo-link"><Wordmark height={26} /></Link></div>
        <nav>
          {tabs.map(([id, label, Icon, badge, area]) => (
            <button key={id} className={[at === id && "active", PHONE_MORE.has(id) && "nav-more-item"].filter(Boolean).join(" ")} data-area={area} data-tab={id} aria-current={at === id ? "page" : undefined} onClick={() => setTab(id)}>
              <Icon size={17} /> <span className="nav-label">{label}</span>
              {!!badge && <span className="nav-badge">{badge}</span>}
            </button>
          ))}
          <NavMore tabs={tabs.filter(([id]) => PHONE_MORE.has(id))} tab={at} badge={0} setTab={setTab} />
        </nav>
        <div className="dash-side-foot">
          <div className="dash-role" data-role={db.access?.role}>{roleWord}</div>
          <button className="dash-out" onClick={logout} disabled={signingOut}>{signingOut ? <><RefreshCw size={16} className="spin" /> Signing out…</> : <><LogOut size={16} /> Sign out</>}</button>
        </div>
      </aside>
      <main className="dash-main">
        {!at && <div className="admin-empty" data-no-sections>Your account has nothing turned on yet. Ask a Founder to turn on what you need in Site › Users.</div>}
        {at === "home" && <HomeDashboard ctx={ctx} todo={todo} cuTasks={cu.data?.tasks || []} todoN={todoN} onAcct={setAcctN} />}
        {at === "todo" && <TodoPage ctx={ctx} todo={todo} sub={sub} onSub={setSub} areaN={areaN} />}
        {at === "money" && <AccountingAdmin sub={sub} onSub={setSub} onCounts={setAcctN} chip={<TodoChip n={areaN("money")} area="money" onGo={go} />} onGo={go} />}
        {at === "site" && <SiteAdmin ctx={ctx} sub={sub} onSub={setSub} chip={<TodoChip n={areaN("site")} area="site" onGo={go} />} />}
        {at === "catalog" && <CatalogAdmin db={db} commit={commit} songInfo={songInfo} reloadSongInfo={reloadSongInfo} sub={sub} onGo={go} onSub={setSub} chip={<TodoChip n={areaN("roster")} area="roster" onGo={go} />} />}
        {at === "ar" && <ARAdmin onGo={go} sub={sub} chip={<TodoChip n={areaN("ar")} area="ar" onGo={go} />} />}
        {at === "numbers" && <NumbersPage ctx={ctx} />}
      </main>
    </div>
  );
}

/* Numbers (list B #4): the automated numbers ------------------------------ */
// Every roster artist (and watchlist artist) with their numbers, each labelled by platform ("Spotify
// streams, global"), with this week against last week, a small chart, and "last updated <date>" when its
// source hasn't refreshed it on time (the last good number stays). Tap an artist for their songs and
// campaign mode (daily updates while we push them). Sounds: TikTok sounds we track by link. Sources &
// cost: how often each source runs, which scraper it uses, its monthly budget and what a month costs.
const dataPost = async (body) => {
  const r = await fetch("/api/data", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "defied-site" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Couldn't save that — try again.");
  return j;
};
const usd = (v) => `$${(Number(v) || 0).toFixed(Number(v) >= 10 ? 0 : 2)}`;
const big = (n) => (n == null ? "—" : Math.abs(n) >= 1e4 ? compact(n).replace(/^\+/, "") : fmt(n));
const pctWord = (p) => (p == null ? null : `${p >= 0 ? "+" : "−"}${Math.abs(Math.round(p * 100))}%`);
function NumTile({ m, label, sub, k }) {
  if (!m) return <div className="nums-tile nums-none" data-tile={k}><span className="nums-lab">{label}</span><b>—</b><span className="nums-sub">Not read yet</span></div>;
  const week = m.thisWeek != null ? `${compact(m.thisWeek)} this week` : m.daily != null ? `${compact(m.daily)} yesterday` : null;
  const vs = pctWord(m.pct);
  return (
    <div className={`nums-tile${m.stale ? " nums-stale" : ""}`} data-tile={k}>
      <span className="nums-lab">{m.label}</span>
      <b title={fmt(m.latest)}>{m.approx ? "about " : ""}{big(m.latest)}</b>
      {(week || sub) && <span className="nums-sub">{week}{week && vs ? <> · <span className={m.pct >= 0 ? "pos" : "neg"}>{vs} vs last week</span></> : null}{sub && <>{week ? " · " : ""}{sub}</>}</span>}
      <Sparkline series={m.series} height={34} />
      <span className="nums-when" data-when>{m.stale ? <><AlertTriangle size={11} /> last updated {shortDay(m.day)}</> : `updated ${shortDay(m.day)}`}</span>
    </div>
  );
}
function NumbersPage({ ctx }) {
  const [d, setD] = useState(() => peekJson("/api/data") || null), [err, setErr] = useState(false);
  const [view, setView] = useState("artists"), [open, setOpen] = useState(null);
  const load = () => swrJson("/api/data", (j) => { setD(j); setErr(false); }).catch(() => setErr(true));
  useEffect(() => { load(); }, []);
  if (err && !d) return <div className="nums"><div className="admin-head"><h2>Numbers</h2></div><p className="hint err-text">Couldn't load the numbers. <button className="inline-link" onClick={load}>Try again</button></p></div>;
  if (!d) return <div className="nums"><div className="admin-head"><h2>Numbers</h2></div><p className="hint"><RefreshCw size={14} className="spin" /> Loading…</p></div>;
  const st = d.state;
  const line = !st.refreshOn ? "Automatic updates are off." : !st.keys?.apify ? "Apify isn't connected, so streams and followers don't update." : `Streams and YouTube update daily, followers weekly${st.lastAt ? ` · last update ${shortDay(st.lastAt)}, ${clock(st.lastAt)}` : ""}`;
  return (
    <div className="nums" data-numbers>
      <div className="admin-head"><h2>Numbers</h2><span className="home-src" data-nums-status>{line}</span>
        <button type="button" className="nums-cost" data-nums-cost onClick={() => setView("sources")} title="What the automatic numbers cost a month at this schedule">About {usd(d.cost.estMonthlyUsd)}/month</button></div>
      {d.spikes.length > 0 && (
        <div className="nums-spikes" data-nums-spikes>
          {d.spikes.slice(0, 4).map((s, i) => <span key={i} className="nums-spike"><TrendingUp size={13} /> <b>{s.name}</b> {s.text}</span>)}
        </div>
      )}
      <span className="gainer-tabs nums-views" role="tablist" aria-label="Numbers">
        {[["artists", "Artists"], ["sounds", "Sounds"], ["sources", "Sources & cost"], ["digest", "Monday digest"]].map(([k, l]) => <button key={k} role="tab" aria-selected={view === k} data-nums-view={k} className={view === k ? "active" : ""} onClick={() => setView(k)}>{l}</button>)}
      </span>
      {view === "artists" && (!d.artists.length ? <div className="admin-empty">No numbers yet. They start with the first daily update.</div> : (
        <div className="nums-list">{d.artists.map((a) => <ArtistNums key={a.id} a={a} open={open === a.id} onToggle={() => setOpen(open === a.id ? null : a.id)} onSaved={load} />)}</div>
      ))}
      {view === "sounds" && <SoundNums sounds={d.sounds} onSaved={load} />}
      {view === "sources" && <SourceNums d={d} canEdit={ctx.can("money")} onSaved={load} />}
      {view === "digest" && <DigestPreview />}
    </div>
  );
}

// List B #9: "Preview this week's digest": exactly what Monday's team digest and this account's own
// digest would say (GET /api/digest), for the sections this account may see. A Founder can look at
// anyone's personal digest, and sees who gets one and what this week's run did.
const pctSigned = (p) => (p == null ? "" : `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p)}%`);
function DigestItem({ k, it }) {
  const main = k === "radar" ? `${it.title}${it.artist ? ` — ${it.artist}` : ""}` : it.name || it.title || "";
  const nums = k === "roster"
    ? [it.streams && <span key="s"><b>{fmt(it.streams.thisWeek)}</b> streams this week <span className={it.streams.pct >= 0 ? "pos" : "neg"}>{pctSigned(it.streams.pct)}</span></span>,
      ...(it.followers || []).map((f) => <span key={f.key}>{f.label} <b>{f.approx ? "about " : ""}{big(f.latest)}</b> <span className={f.pct >= 0 ? "pos" : "neg"}>{pctSigned(f.pct)}</span></span>)]
    : k === "radar" ? [<span key="v"><b>{fmt(it.newVideos)}</b> new videos{it.pct != null && <> <span className={it.pct >= 0 ? "pos" : "neg"}>{pctSigned(Math.round(it.pct * 10) / 10)}</span></>}</span>]
      : k === "expiring" ? [<span key="e">{it.expiresAt || it.expires ? `ends ${String(it.expiresAt || it.expires).slice(0, 10)}` : ""}</span>]
        : [<span key="m">momentum <b>{fmt(it.score)}</b>{it.trend != null && it.trend !== "" && <> · {typeof it.trend === "number" ? pctSigned(Math.round(it.trend * 10) / 10) : String(it.trend)}</>}</span>, it.why && <span key="w">{it.why}</span>];
  return (
    <li className="dg-item" data-dg-item>
      <a className="dg-name" href={it.url} target="_blank" rel="noreferrer">{main}</a>
      <span className="dg-nums">{nums.filter(Boolean)}</span>
    </li>
  );
}
function DigestBlock({ d, label }) {
  const [raw, setRaw] = useState(false);
  return (
    <section className="dg-block" data-dg={d.kind}>
      <div className="dg-head"><h3>{label}</h3><button type="button" className="inline-link dg-raw" onClick={() => setRaw(!raw)} aria-pressed={raw}>{raw ? "Show as cards" : "Show the ClickUp text"}</button></div>
      {raw ? <pre className="dg-text" data-dg-text>{d.text}</pre> : d.sections.map((s) => (
        <div key={s.key} className="dg-sec" data-dg-sec={s.key}>
          <h4>{s.title}</h4>{s.note && <p className="hint">{s.note}</p>}
          {s.pending ? <p className="dg-pending" data-dg-pending>{s.pending}.</p> : s.error ? <p className="hint err-text">{s.error}</p>
            : !s.items.length ? <p className="hint" data-dg-empty>{s.empty}</p> : <ol className="dg-list">{s.items.map((it, i) => <DigestItem key={it.id || it.url || i} k={s.key} it={it} />)}</ol>}
        </div>
      ))}
    </section>
  );
}
function DigestPreview() {
  const [who, setWho] = useState("");
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  useEffect(() => {
    let gone = false;
    setErr(null);
    fetch(`/api/digest${who ? `?user=${encodeURIComponent(who)}` : ""}`, { cache: "no-store" }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Couldn't build the preview."); return j; })
      .then((j) => { if (!gone) setD(j); }).catch((e) => { if (!gone) setErr(e.message); });
    return () => { gone = true; };
  }, [who]);
  if (err) return <p className="hint err-text" role="alert">{err}</p>;
  if (!d) return <p className="hint"><RefreshCw size={14} className="spin" /> Building this week's digest…</p>;
  const me = d.people?.find((p) => p.id === d.personal.user?.id);
  return (
    <div className="dg" data-digest-preview>
      <p className="dg-status" data-dg-status>{d.writesOn ? `Posts to ClickUp ${d.schedule}.` : `Posting is off for now (DIGEST_WRITES), so nothing is sent. This is exactly what ${d.schedule.replace(/^Mondays/, "Monday")} would send.`}{d.writesOn && !d.team.channelSet ? " The team channel isn't set yet (DIGEST_CHANNEL_ID)." : ""}</p>
      <DigestBlock d={d.team} label="Team digest (the team's ClickUp channel)" />
      {d.people && (
        <label className="fld dg-who"><span>Personal digest for</span>
          <select value={who || d.personal.user?.id || ""} onChange={(e) => setWho(e.target.value)} aria-label="Personal digest for">
            {d.people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.getsPersonal ? "" : " (not getting one yet)"}</option>)}
          </select>
        </label>
      )}
      {d.personal.sections.length ? <DigestBlock d={d.personal} label={`${d.personal.user?.name ? `${d.personal.user.name}'s` : "Your"} digest (a ClickUp direct message)`} />
        : <p className="hint" data-dg-no-personal>No personal digest: it holds A&R trackers, and this account has no A&R.</p>}
      {me && !me.getsPersonal && <p className="hint">Personal digests go to Devin first (DIGEST_PERSONAL_TO). Set it to "all" to send everyone theirs.</p>}
    </div>
  );
}
function ModeSwitch({ id, mode, onSaved, what = "artist" }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const set = async (m) => { setBusy(true); setErr(null); try { await dataPost({ action: "mode", entityId: id, mode: m, days: m === "campaign" ? 30 : null }); await onSaved(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <div className="nums-mode" data-nums-mode={mode || "auto"}>
      <label className="nums-switch"><input type="checkbox" checked={mode === "campaign"} disabled={busy || mode === "off"} onChange={(e) => set(e.target.checked ? "campaign" : "auto")} /> Campaign mode: everything about this {what} updates daily for 30 days</label>
      {mode === "off" ? <button type="button" className="inline-link" disabled={busy} onClick={() => set("auto")}>Start updating again</button>
        : <button type="button" className="inline-link nums-off" disabled={busy} onClick={() => set("off")}>Stop updating</button>}
      {err && <span className="hint err-text">{err}</span>}
    </div>
  );
}
function ArtistNums({ a, open, onToggle, onSaved }) {
  const m = a.metrics;
  const [all, setAll] = useState(false);
  const tiles = [
    (a.streams || a.songs.length > 0) && <NumTile key="st" k="streams" label="Spotify streams, global" m={a.streams} sub={a.streams?.songs ? `${a.streams.songs} song${a.streams.songs === 1 ? "" : "s"}` : null} />,
    (m.spotify_monthly_listeners || a.links.spotify) && <NumTile key="ml" k="listeners" label="Spotify monthly listeners" m={m.spotify_monthly_listeners} sub={m.spotify_followers ? `${big(m.spotify_followers.latest)} followers` : null} />,
    (m.instagram_followers || a.links.instagram) && <NumTile key="ig" k="instagram" label="Instagram followers" m={m.instagram_followers} />,
    (m.tiktok_followers || a.links.tiktok) && <NumTile key="tt" k="tiktok" label="TikTok followers" m={m.tiktok_followers} />,
    (m.youtube_subscribers || a.links.youtube) && <NumTile key="yt" k="youtube" label="YouTube subscribers" m={m.youtube_subscribers} sub={m.youtube_views ? `${big(m.youtube_views.latest)} views` : null} />,
  ].filter(Boolean);
  const songs = all ? a.songs : a.songs.slice(0, 12);
  return (
    <div className={`nums-card${open ? " open" : ""}`} data-nums-artist={a.id}>
      <button type="button" className="nums-head" aria-expanded={open} onClick={onToggle}>
        {a.image ? <img className="nums-av" src={a.image} alt="" loading="lazy" /> : <span className="nums-av" aria-hidden="true">{(a.name || "?").slice(0, 1)}</span>}
        <span className="nums-name">{a.name}</span>
        {a.watchlist && <span className="nums-tag">Watchlist</span>}
        {a.mode === "campaign" && <span className="nums-tag hot">Campaign · daily</span>}
        {a.mode === "off" && <span className="nums-tag">Not updating</span>}
        <ChevronDown size={16} className="nums-chev" aria-hidden="true" />
      </button>
      <div className="nums-tiles">{tiles.length ? tiles : <span className="hint">No links to read numbers from yet. Add their Spotify, Instagram, TikTok or YouTube in Site › Roster.</span>}</div>
      {/* list B #3: what Luminate last had for them, all platforms, kept as history (read only) */}
      {a.lum?.atd != null && <p className="nums-lum" data-nums-lum>Luminate, all platforms: {fmt(a.lum.atd)} all-time streams on {shortDay(a.lum.on)}{a.lum.songs ? ` (${a.lum.songs} song${a.lum.songs === 1 ? "" : "s"})` : ""}{a.lum.week != null ? ` · ${fmt(a.lum.week)} that week` : ""}</p>}
      {open && (
        <div className="nums-more" data-nums-more>
          <ModeSwitch id={a.id} mode={a.mode} onSaved={onSaved} />
          {a.songs.length > 0 && (
            <div className="nums-songs" data-nums-songs>
              <div className="nums-song nums-song-hd"><span>Song</span><span>Spotify streams, global</span><span>Yesterday</span><span>This week</span><span>vs last week</span><span title="Luminate's last all-time streams, all platforms (history)">Luminate, all-time</span></div>
              {songs.map((s) => (
                <div key={s.id} className="nums-song" data-song={s.id}>
                  <span className="nums-song-t">{s.name}{s.isNew && <span className="nums-tag hot">New</span>}<em>{s.artist}</em></span>
                  <span data-l="All-time" title={s.under1k ? "Spotify shows no count under 1,000 plays" : undefined}>{s.streams ? big(s.streams.latest) : s.under1k ? "Under 1K" : "—"}{s.streams?.stale && <em className="nums-when"> last updated {shortDay(s.streams.day)}</em>}</span>
                  <span data-l="Yesterday">{s.streams?.daily != null ? compact(s.streams.daily) : "—"}</span>
                  <span data-l="This week">{s.streams?.thisWeek != null ? compact(s.streams.thisWeek) : "—"}</span>
                  <span data-l="vs last week" className={s.streams?.pct == null ? "" : s.streams.pct >= 0 ? "pos" : "neg"}>{pctWord(s.streams?.pct) || "—"}</span>
                  <span data-l="Luminate, all-time" className="nums-song-lum" title={s.lum ? `Luminate, all platforms, ${shortDay(s.lum.on)}` : undefined}>{s.lum?.atd != null ? big(s.lum.atd) : "—"}</span>
                </div>
              ))}
              {a.songs.length > 12 && <button type="button" className="inline-link" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${a.songs.length} songs`}</button>}
              {!a.songs.some((s) => s.streams?.thisWeek != null) && <p className="hint">Weekly changes show once there are two weeks of numbers.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
function SoundNums({ sounds, onSaved }) {
  const [url, setUrl] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const add = async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { await dataPost({ action: "addSound", url }); setUrl(""); await onSaved(); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  return (
    <div className="nums-sounds" data-nums-sounds>
      <form className="nums-add" onSubmit={add}>
        <input type="url" inputMode="url" placeholder="Paste a TikTok sound link (tiktok.com/music/…)" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="TikTok sound link" />
        <button className="btn sm" disabled={busy || !url.trim()}>{busy ? "Adding…" : "Track sound"}</button>
      </form>
      {err && <p className="hint err-text" role="alert">{err}</p>}
      {!sounds.length ? <div className="admin-empty">No sounds tracked yet. Paste a TikTok sound link to start.</div> : sounds.map((s) => (
        <div key={s.id} className="nums-card" data-nums-sound={s.id}>
          <div className="nums-head nums-head-static"><span className="nums-name">{s.name || "A TikTok sound"}{s.artist && <em> · {s.artist}</em>}</span>
            {s.url && <a className="inline-link" href={s.url} target="_blank" rel="noreferrer">Open ↗</a>}
            <RowMenu label={`More for ${s.name || "this sound"}`} items={[{ label: "Stop tracking", onClick: async () => { await dataPost({ action: "removeSound", entityId: s.id }).catch(() => {}); onSaved(); } }]} /></div>
          <div className="nums-tiles"><NumTile k="videos" label="TikTok videos with this sound" m={s.videos} /></div>
          <ModeSwitch id={s.id} mode={s.mode} onSaved={onSaved} what="sound" />
        </div>
      ))}
    </div>
  );
}
function SourceNums({ d, canEdit, onSaved }) {
  const [f, setF] = useState(() => Object.fromEntries(d.sources.map((s) => [s.key, { schedule: s.schedule, adapter: s.adapter, softCapUsd: String(s.softCapUsd) }])));
  const [total, setTotal] = useState(String(d.cost.totalCapUsd));
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(null);
  const set = (k, p) => setF((x) => ({ ...x, [k]: { ...x[k], ...p } }));
  const save = async () => { setBusy(true); setMsg(null); try { await dataPost({ action: "sources", sources: f, totalCapUsd: total }); setMsg({ ok: "Saved." }); await onSaved(); } catch (e) { setMsg({ err: e.message }); } finally { setBusy(false); } };
  const acct = d.cost.account;
  const month = new Date().toLocaleDateString(undefined, { month: "long" });
  return (
    <div className="nums-src" data-nums-sources>
      <p className="nums-costline" data-costline>About <b>{usd(d.cost.estMonthlyUsd)} a month</b> at this schedule · {usd(d.cost.spentUsd)} spent in {month}{acct ? ` · Apify: ${usd(acct.usageUsd)} of its ${usd(acct.limitUsd)} limit used` : ""}</p>
      {d.sources.map((s) => (
        <div key={s.key} className="nums-srow" data-source={s.key}>
          <div className="nums-srow-t"><b>{s.label}</b><span className="hint">{s.tracked} tracked{s.campaign ? ` · ${s.campaign} in campaign mode` : ""} · about {usd(s.estMonthlyUsd)}/month{s.paid ? ` · ${usd(s.spentUsd)} this month` : " · free"}</span>
            <span className={`hint${s.last?.status === "failed" ? " err-text" : ""}`} data-last>{s.skipped ? `Skipped ${shortDay(s.skipped.at)}: ${s.skipped.why}` : s.last ? `${s.last.status === "failed" ? "Failed" : s.last.status === "started" ? "Running since" : "Last run"} ${shortDay(s.last.at)}${s.last.error ? `: ${s.last.error}` : ""}` : "Not run yet"}</span></div>
          {canEdit ? (
            <div className="nums-srow-f">
              {s.key !== "spotify_catalog" && <select aria-label="How often" value={f[s.key].schedule} onChange={(e) => set(s.key, { schedule: e.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly</option></select>}
              {s.adapters.length > 1 && <select aria-label="Scraper" value={f[s.key].adapter} onChange={(e) => set(s.key, { adapter: e.target.value })}>{s.adapters.map((a) => <option key={a.id} value={a.id}>{a.actor}</option>)}</select>}
              {s.paid && <label className="nums-cap">Budget $<input type="number" min="0" max="19" step="0.5" value={f[s.key].softCapUsd} onChange={(e) => set(s.key, { softCapUsd: e.target.value })} />/mo</label>}
            </div>
          ) : <div className="nums-srow-f hint">{s.schedule === "daily" ? "Daily" : "Weekly"} · {s.adapters.find((a) => a.id === s.adapter)?.actor}{s.paid ? ` · budget ${usd(s.softCapUsd)}/mo` : ""}</div>}
        </div>
      ))}
      {canEdit ? (
        <div className="nums-save"><label className="nums-cap">All sources together: $<input type="number" min="0" max="19" step="0.5" value={total} onChange={(e) => setTotal(e.target.value)} />/month</label>
          <button className="btn sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          {msg && <span className={`hint${msg.err ? " err-text" : ""}`} role="status">{msg.err || msg.ok}</span>}</div>
      ) : <p className="hint">Changing schedules and budgets needs Money access.</p>}
      <p className="hint">Apify's own hard limit stops every run at the plan's cap. A run that would go past this month's budget waits until next month.</p>
    </div>
  );
}
// Home: spikes and new releases from the automated numbers, and what they cost a month. Nothing to say: nothing shown.
function HomeNumbers({ onGo }) {
  const [d, setD] = useState(() => peekJson("/api/data?home=1") || null);
  useEffect(() => { swrJson("/api/data?home=1", setD).catch(() => {}); }, []);
  if (!d || (!d.spikes.length && !d.newReleases.length)) return null;
  return (
    <div className="home-card nums-home" data-home-numbers>
      <div className="attn-head"><TrendingUp size={15} /> Spikes and new releases
        <button type="button" className="inline-link home-all" onClick={() => onGo("numbers")}>Numbers · about {usd(d.cost.estMonthlyUsd)}/month ›</button></div>
      {d.spikes.map((s, i) => <p key={`s${i}`} className="todo-line" data-spike><b>{s.name}</b>&nbsp;{s.text}</p>)}
      {d.newReleases.map((r, i) => <p key={`r${i}`} className="todo-line" data-new-release><b>{r.artist}</b>&nbsp;released “{r.name}” ({shortDay(r.releaseDate)}), picked up for tracking</p>)}
    </div>
  );
}

// A dashboard tab's one link to its to-dos: "3 to do ›", opening To do on that area (none: nothing shown)
function TodoChip({ n, area, onGo }) {
  if (!n) return null;
  return <button type="button" className="todo-chip" data-area={area} data-todo-chip={area} onClick={() => onGo("todo", area)}>{n} to do <ChevronRight size={14} aria-hidden="true" /></button>;
}

/* generic editable list ------------------------------------------------ */
function Editor({ title, items, columns, blank, onSave, onDelete, extra, maxItems, onReorder, confirmDelete, openId = null, noAdd = false }) {
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
        {!noAdd && <button className="btn sm" onClick={() => start(null)} disabled={atMax} title={atMax ? `Remove one to add another (max ${maxItems})` : undefined}><Plus size={15} /> Add</button>}
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
              {onDelete && <button onClick={() => remove(it)} aria-label={`Delete ${it.name || it.song || it.email || "entry"}`}><Trash2 size={14} /></button>}
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

function ClientsAdmin({ db, commit, openId = null, songInfo = null }) {
  // the clients the "numbers can't sync" To do names: each row says so, and its form says why
  const noTab = noTabNames(db, songInfo).map((n) => findTabClient(db, n)).filter(Boolean);
  const noTabIds = new Set(noTab.map((c) => c.id));
  const cols = [
    { key: "name", label: "Name", render: (c) => <span className="cell-name"><Avatar src={c.photo} name={c.name} size={30} />{c.name}{noTabIds.has(c.id) && <span className="tab-missing" data-tab-missing title="The pub sheet has no tab by this name">No sheet tab</span>}</span> },
    // Credit (the edit form's "Credit / descriptor") only gets a column once a client has one (list A 7: all blank)
    { key: "role", label: "Role" }, ...(db.clients.some((c) => (c.credit || "").trim()) ? [{ key: "credit", label: "Credit" }] : []),
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
    {noTab.length > 1 && <p className="hint warn-text mb" data-tab-missing-note><AlertTriangle size={14} /> {noTab.length} clients have no tab on the pub sheet, so their numbers can't sync. Open each one marked "No sheet tab" and type its tab name.</p>}
    <Editor title="Clients" items={db.clients} columns={cols}
      blank={{ name: "", role: "Producer", credit: "", bio: "", photo: "", spotify: "", apple: "", instagram: "", tiktok: "", youtube: "", soundcloud: "", sheetTabName: "", onRoster: false }}
      onSave={save} onDelete={canUse(db, "publishing") && !db.access?.ownOnly ? del : undefined} onReorder={db.access?.ownOnly ? undefined : reorder} noAdd={!!db.access?.ownOnly} openId={openId}
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
            hint={`${(openId && e.id === openId) || noTabIds.has(e.id) ? `The pub sheet has no tab called ${db.clients.find((c) => c.id === e.id)?.sheetTabName?.trim() || db.clients.find((c) => c.id === e.id)?.name}. ` : ""}Only needed if their tab on the pub sheet goes by a different name. Case, accents, punctuation and a “!” used as an i don't count — Stack!e already finds a tab named Stackie.`} />
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
    { key: "cover", label: "", w: "44px", render: (p) => p.cover ? <img className="rel-thumb" src={p.cover} alt="" loading="lazy" decoding="async" /> : <span className="rel-thumb rel-thumb-empty" /> },
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

// The song forms' "paste a link" box (list B #7: components/LinkBox.jsx, POST /api/resolve-link): a
// Spotify song link fills in the title, artist, cover and release date, and says when the song is
// already on someone's page (co-writers share songs, so it can still be filled in)
function SpotifyFill({ e, set }) {
  const [done, setDone] = useState(false);
  const fill = (r) => {
    const c = r.card || {};
    // onto the form as it is now, so anything typed during the lookup stays
    set((cur) => ({
      ...cur,
      song: c.name || cur.song,
      artist: c.artist || cur.artist,
      releaseDate: cur.releaseDate || c.releaseDate || "",
      cover: c.image || cur.cover,
      link: r.link?.url || cur.link,
    }));
    setDone(true);
  };
  return (
    <div className="sp-fill" data-sp-fill>
      <span className="fld-label">Paste the song's Spotify link to fill this in</span>
      <LinkBox context="roster" kinds={["song"]} addLabel="Fill in" allowDuplicate onAdd={fill} />
      {done && <span className="sp-note ok"><Check size={12} /> Filled in. Review the fields below.</span>}
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

// Site › Users: the logins. A Founder also sets each staff login's role (lib/roles.js: Founder,
// Co-manager, Intern) and can turn any section on or off for that person on top of the role. The
// server checks all of it on every request; this only shows it.
const ROLE_PICK = [["founder", "Founder"], ["comanager", "Co-manager"], ["intern", "Intern"], ["client", "Client"]];
const SECTION_OF = Object.fromEntries(SECTIONS);
function useManagers(reloadDb) {
  const [st, setSt] = useState({ at: undefined, busy: false, err: null });
  const update = async () => {
    setSt((x) => ({ ...x, busy: true, err: null }));
    const r = await fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify({ action: "managers" }) }).catch(() => null);
    const d = r && (await r.json().catch(() => null));
    if (r?.ok) { await reloadDb?.(); setSt({ at: d.at, busy: false, err: null }); } else setSt((x) => ({ ...x, busy: false, err: d?.error || "Couldn't read the accounting sheet just now." }));
  };
  useEffect(() => {
    let alive = true;
    fetch("/api/access", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!alive || !d) return;
      setSt((x) => ({ ...x, at: d.managersAt }));
      if (!d.managersAt) update(); // never read yet: read it once now
    }).catch(() => {});
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...st, update };
}
function UsersAdmin({ db, commit, reloadDb }) {
  const founder = db.access?.role === "founder";
  const anyFounder = db.users.some((u) => u.role === "staff" && u.staffRole === "founder");
  const pickOf = (u) => (u.role === "client" ? "client" : ROLES[u.staffRole] ? u.staffRole : anyFounder ? "comanager" : "founder");
  const accessOf = (u) => accessFor({ staffRole: pickOf(u), access: u.access, name: u.name }, { anyFounder: true });
  const artistsOf = (name) => db.clients.filter((c) => sameManager(c.manager, name));
  const managers = useManagers(reloadDb);
  const who = (u) => {
    if (u.role === "client") return `Client · ${db.clients.find((c) => c.id === u.clientId)?.name || "no client linked"}`;
    const a = accessOf(u);
    return `${ROLES[a.role].label}${a.ownOnly ? ` · own artists (${artistsOf(u.name).length})` : ""}`;
  };
  const cols = [
    { key: "email", label: "Email", render: (u) => <span className="cell-name">{u.email}{u.name ? <span className="muted"> · {u.name}</span> : null}</span> },
    { key: "role", label: "Access", render: (u) => <span data-user-access={u.id}>{who(u)}</span> },
  ];
  const save = async (o) => {
    // the server skips a new login with no password, which would leave it on screen but never saved
    if (!o.id && !(o.password || "").trim()) return "Enter a password to create this account.";
    const users = o.id ? db.users.map((u) => u.id === o.id ? o : u) : [...db.users, { ...o, id: uid() }];
    if (!users.some((u) => u.role === "staff")) return "There has to be at least one staff account.";
    if (anyFounder && !users.some((u) => u.role === "staff" && u.staffRole === "founder")) return "There has to be at least one Founder.";
    return saveRow(commit, { ...db, users }, "users", o.id, "user");
  };
  const del = async (id) => {
    const users = db.users.filter((u) => u.id !== id);
    if (!users.some((u) => u.role === "staff")) return "There has to be at least one staff account.";
    if (anyFounder && !users.some((u) => u.role === "staff" && u.staffRole === "founder")) return "There has to be at least one Founder.";
    await commit({ ...db, users });
  };
  const setPick = (e, set, v) => set({ ...e, role: v === "client" ? "client" : "staff", staffRole: v === "client" ? null : v,
    access: v === "comanager" && e.access?.ownOnly ? { ownOnly: true } : {} });
  const setSection = (e, set, k, on) => set({ ...e, access: cleanAccess(pickOf(e), { ...e.access, sections: { ...(e.access?.sections || {}), [k]: on } }) });
  return (
    <>
    <Editor title="Users" items={db.users} columns={cols}
      blank={{ email: "", password: "", role: "staff", staffRole: "comanager", access: {}, name: "", clientId: null }}
      onSave={save} onDelete={del}
      extra={(e, set) => {
        const pick = pickOf(e), a = e.role === "staff" ? accessOf(e) : null, mine = a?.ownOnly ? artistsOf(e.name) : [];
        return (
        <>
          <Field label="Email" value={e.email} onChange={(ev) => set({ ...e, email: ev.target.value })} />
          <Field label="Name" value={e.name || ""} onChange={(ev) => set({ ...e, name: ev.target.value })} />
          <Field
            label="Password" value={e.password} onChange={(ev) => set({ ...e, password: ev.target.value })}
            hint={e.id ? "Leave blank to keep their current password. At least 8 characters if you're setting a new one." : "At least 8 characters — required to create the account."}
          />
          <label className="fld"><span>Role</span>
            <select value={pick} data-role-pick onChange={(ev) => setPick(e, set, ev.target.value)} disabled={!founder && e.role === "staff"}>
              {ROLE_PICK.filter(([k]) => founder || k === "client" || k === pick).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
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
          {e.role === "staff" && founder && pick === "comanager" && (
            <label className="check-row" data-own-only>
              <input type="checkbox" checked={!!e.access?.ownOnly} onChange={(ev) => set({ ...e, access: cleanAccess("comanager", { ...e.access, ownOnly: ev.target.checked }) })} />
              <span>Only their own artists: the ones with this name as Assigned Manager on the accounting sheet's INFO tab.</span>
            </label>
          )}
          {a?.ownOnly && (
            <p className="hint" data-own-artists>{!(e.name || "").trim() ? "Type their name above, as INFO spells it." : mine.length ? `Their artists: ${mine.map((c) => c.name).join(", ")}.` : `No artist has "${e.name.trim()}" as Assigned Manager yet.`}
              {" "}<button type="button" className="inline-link" onClick={managers.update} disabled={managers.busy}>{managers.busy ? "Reading the sheet…" : "Update from the sheet"}</button>
              {managers.err && <span className="err-text"> {managers.err}</span>}</p>
          )}
          {e.role === "staff" && founder && (
            <fieldset className="fld sec-picks" data-sections>
              <legend>What they can open</legend>
              {SECTIONS.map(([k]) => {
                const locked = k === "users" && pick === "founder";
                return (
                  <label key={k} className={`sec-pick${locked ? " locked" : ""}`} data-section={k}>
                    <input type="checkbox" checked={a.sections.includes(k)} disabled={locked} onChange={(ev) => setSection(e, set, k, ev.target.checked)} />
                    <span>{SECTION_OF[k]}</span>
                  </label>
                );
              })}
              <p className="hint">{ROLES[pick].label} starts with {pick === "founder" ? "everything" : pick === "comanager" ? "everything but Money and Users" : "Site only"}. Tick or untick to change it for this person.</p>
            </fieldset>
          )}
          <p className="hint">Clients only see their own placements and splits. They can never edit the website.</p>
        </>
        );
      }}
    />
    {founder && <p className="hint users-managers" data-managers-at>Each artist's manager comes from the accounting sheet's INFO tab{managers.at ? `, read ${shortDay(managers.at)}` : ""}. <button type="button" className="inline-link" onClick={managers.update} disabled={managers.busy}>{managers.busy ? "Reading the sheet…" : "Update from the sheet"}</button>{managers.err && <span className="err-text"> {managers.err}</span>}</p>}
    </>
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
  const [data, setData] = useState(() => peekJson("/api/ar-data") || null);
  const [err, setErr] = useState(null);
  const load = () => swrJson("/api/ar-data", (d) => { setData(d); setErr(null); }, { anyStatus: true })
    .then((d) => { if (d?.error) throw new Error(d.error); })
    .catch((e) => setErr(e.message || "Couldn't load A&R data."));
  const retry = () => { setErr(null); load(); }; // shows "Loading…" again until it answers
  useEffect(() => { load(); }, []);
  return { data, err, load, retry };
}
const ArDataError = ({ err, retry }) => <p className="hint err-text mb"><span>{err}</span> <button className="btn ghost sm" onClick={retry}>Try again</button></p>;

// A&R: Summary (default) · Watchlist · Board. One read of the pub sheet (useArData) and one of
// Postgres (/api/ar) serve all three; the sub-page last opened is remembered for the session.
const AR_SECS = [["summary", "Summary"], ["watch", "Watchlist"], ["board", "Board"], ["trackers", "Trackers"], ["radar", "Radar"]];
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
// the Dashboard's This week › A&R rows: "watch:open:<key>" (their panel) / "watch:flash:<key>" (a row only the old Artist Tracker had)
const arSecOf = (sub) => ({ trackers: "trackers", tracker: "trackers", radar: "radar", watchlist: "watch", watch: "watch", board: "board" })[sub] || null; // Home's momentum card, the digests' links
const arWatchAt = (sub) => { const m = /^watch:(open|flash):(.+)$/.exec(sub || ""); return m ? { pill: "people", [m[1]]: m[2] } : null; };
function ARAdmin({ onGo, sub, chip = null }) {
  const [sec, setSecState] = useState(() => {
    if (arWatchAt(sub)) return "watch";
    if (arSecOf(sub)) return arSecOf(sub);
    try { const s = sessionStorage.getItem(AR_SEC_KEY); return AR_SECS.some(([id]) => id === s) ? s : "summary"; } catch { return "summary"; }
  });
  const [watchAt, setWatchAt] = useState(() => arWatchAt(sub)); // where Summary sends the Watchlist: {pill, open}
  const setSec = (id, at = null) => { setSecState(id); setWatchAt(at); try { sessionStorage.setItem(AR_SEC_KEY, id); } catch { /* private mode */ } };
  // Back / Forward to another Dashboard row while A&R is open
  useEffect(() => { const at = arWatchAt(sub); if (at) setSec("watch", at); else if (arSecOf(sub)) setSec(arSecOf(sub)); }, [sub]); // eslint-disable-line react-hooks/exhaustive-deps
  const ar = useArAll();
  // each page opens on the latest from Postgres (another page may have added someone)
  const opened = useRef(false);
  useEffect(() => { if (opened.current) ar.loadPg(false); opened.current = true; }, [sec]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="ar">
      {/* the page's title first, as on Publishing and Website; each section says only its one line */}
      <div className="admin-head"><h2>A&amp;R</h2>{chip}</div>
      <div className="subnav">
        {AR_SECS.map(([id, label]) => (
          <button key={id} className={sec === id ? "subpill active" : "subpill"} onClick={(e) => { setSec(id); revealChip(e.currentTarget); }}>{label}</button>
        ))}
      </div>
      {sec === "summary" && <ArSummary ar={ar} onGo={onGo} goBoard={() => setSec("board")} goWatch={(at) => setSec("watch", at)} />}
      {sec === "board" && <ArBoard ar={ar} onGo={onGo} />}
      {sec === "watch" && <ArWatch key={JSON.stringify(watchAt)} ar={ar} onGo={onGo} at={watchAt} />}
      {sec === "trackers" && <ArTrackers />}
      {sec === "radar" && <ArRadar />}
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
// someone we track by hand with no numbers yet (Passed is done, so it doesn't count): the "no numbers" filter
const noNums = (r) => r.ref?.type === "tracked" && r.current == null && r.stage !== "passed";
// a row's number in words: an artist's Spotify monthly listeners, a song's Spotify streams this week
const unitWords = (r, old = false) => (r.unit === "listeners" ? "monthly listeners" : old ? "streams that week" : "streams this week");
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
  const mine = (pg?.watch?.people || []).find((r) => r.ref?.id === open.id);
  return (
    <ProspectForm key={s.id} prospect={s} pg={p} blendedRate={data.assumptions.blendedRate} assume={data.assumptions} canSave={canSave} reload={load}
      onClose={closePanel} onChanged={async () => { await load(); closePanel(); }}
      extra={(
        <div className="ar-panel-extra">
          <p className="fld-label mb">Their numbers</p>
          {mine?.current != null
            ? <p className="ar-nums">{fmt(mine.current)} {unitWords(mine)} <UpDown r={mine} />{mine.lum?.atd != null && ` · Luminate: ${fmt(mine.lum.atd)} all-time on ${shortDay(mine.lum.on)}`}</p>
            : <p className="muted ar-nums">No numbers yet: they come in once an artist on the Watchlist with their name has a Spotify link.</p>}
          <button className="btn ghost sm" onClick={() => onGo("catalog", `advance:${s.id}`)}>Calculate an advance</button>
        </div>
      )} />
  );
}

// Add or edit a tracked artist or song: saved in the dashboard's database only, never the sheet, and
// no money anywhere (only producers have estimates)
function ArTrackedForm({ kind, t, prefill, picker, title, pg, onClose, onSaved }) {
  const isNew = !t;
  // (luminateId: an Artist / Song Tracker row this one was added from, so its numbers and history stay with it)
  const init = t || { name: prefill?.name || "", artist: prefill?.artist || "", handle: "", spotify: prefill?.spotify || "", isrc: "", genre: "", notes: "", luminateId: prefill?.luminateId || "", personId: null, stage: null, photo: "" };
  const [f, setF] = useState({ ...init, stage: init.stage || "", photo: init.photo || "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const dirty = ["name", "artist", "handle", "spotify", "isrc", "genre", "notes", "luminateId", "personId", "stage"].some((k) => String(f[k] ?? "") !== String((k === "stage" ? init.stage || "" : init[k]) ?? ""));
  const guard = useDirtyGuard(dirty, onClose);
  useEscape(guard.tryClose, !busy);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const type = kind === "song" ? "song" : "artist";
  // Add artist (r7 C2): paste a Spotify or Instagram link and the name, photo and genre fill in (GET
  // /api/ar?lookup=); then Watching or Signed. Their numbers follow their Spotify link.
  const simple = isNew && type === "artist";
  const [link, setLink] = useState("");
  const [look, setLook] = useState(null); // null | { busy: true } | the lookup's answer
  const auto = useRef({}); // what the last lookup filled in: replaced by the next one unless typed over
  useEffect(() => {
    const v = link.trim();
    if (!simple || !v) { setLook(null); return undefined; }
    setLook((l) => (l?.ok ? l : null)); // a filled-in card stays while typing; an old error doesn't
    let gone = false;
    const timer = setTimeout(async () => {
      if (!/(spotify\.com|spotify\.link|instagram\.com|instagr\.am|tiktok\.com)\//i.test(v)) { setLook({ ok: false, error: "Paste a Spotify artist link or an Instagram or TikTok profile." }); return; }
      setLook({ busy: true });
      const r = await fetch(`/api/ar?lookup=${encodeURIComponent(v)}`, { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (gone) return;
      if (!r) { setLook({ ok: false, error: "Couldn't look that up just now. Type their details in." }); return; }
      setLook(r);
      if (!r.ok) return;
      setF((x) => {
        const keep = (k) => x[k].trim() && x[k] !== auto.current[k];
        const next = { ...x, name: keep("name") || !r.name ? x.name : r.name, genre: keep("genre") || !r.genre ? x.genre : r.genre, photo: r.photo || x.photo };
        if (r.spotify) next.spotify = r.spotify;
        if (r.handle) next.handle = r.handle;
        auto.current = { name: next.name, genre: next.genre };
        return next;
      });
    }, 350);
    return () => { gone = true; clearTimeout(timer); };
  }, [link, simple]);
  const people = (pg?.watch?.people || []).filter((r) => r.ref);
  const save = async () => {
    setBusy(true); setErr(null);
    const body = { name: f.name, artist: f.artist, handle: f.handle, spotify: f.spotify, isrc: f.isrc, genre: f.genre, notes: f.notes, luminateId: f.luminateId, personId: f.personId || null, ...(type === "artist" && { photo: f.photo || "" }) };
    try {
      if (isNew) await arPost({ action: "addTracked", kind: type, ...body, stage: type === "artist" ? f.stage || null : null });
      else {
        await arPost({ action: "editTracked", id: t.id, ...body });
        if (type === "artist" && (f.stage || null) !== (t.stage || null)) await arPost({ action: "stageTracked", id: t.id, stage: f.stage || null });
      }
      await onSaved();
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  // an A&R song the ISRC finder wasn't sure about: one tap saves the right one
  const pickIsrc = async (c) => {
    setBusy(true); setErr(null);
    try { await arPost({ action: "editTracked", id: t.id, isrc: c.isrc }); await onSaved(); } catch (e) { setErr(e.message); setBusy(false); }
  };
  const [askStop, setAskStop] = useState(false);
  const remove = async () => {
    setAskStop(false); setBusy(true);
    try { await arPost({ action: "removeTracked", id: t.id }); await onSaved(); } catch (e) { setErr(e.message); setBusy(false); }
  };
  const whereFrom = (r) => (r.kind === "spotify" ? "from Spotify" : `${r.kind === "instagram" ? "Instagram" : "TikTok"} ${r.handle}`);
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && !busy && guard.tryClose()}>
      <div className="modal-card ar-tracked-form" data-kind={type}>
        <div className="modal-head"><h3>{isNew ? title || "Add an artist" : t.name}</h3><button onClick={guard.tryClose} aria-label="Close" disabled={busy}><X size={18} /></button></div>
        <div className="modal-body">
          {picker}
          {/* a row only the old Tracker had: its numbers first, from the row that was clicked */}
          {isNew && prefill?.nums && (
            <p className="ar-nums ar-prefill-nums">{fmt(prefill.nums.thisWeek ?? 0)} {unitWords(prefill.nums)}{prefill.nums.wowPct != null && ` · ${pctText(prefill.nums.wowPct)} vs a week ago`}{prefill.nums.atd != null && ` · ${bigNum(prefill.nums.atd)} all-time`}</p>
          )}
          {isNew && prefill?.name && !simple && <p className="hint mb">Tracked from the old Luminate {type === "song" ? "Song" : "Artist"} Tracker. Add a handle, or put them on the board.</p>}
          {err && <p className="hint err-text" role="alert">{err}</p>}
          {simple && <>
            <label className="fld"><span>Spotify or Instagram link</span>
              <input data-ar-link value={link} onChange={(e) => setLink(e.target.value)} placeholder="open.spotify.com/artist/… or instagram.com/…" aria-label="Spotify or Instagram link" autoFocus inputMode="url" />
            </label>
            {look?.busy && <p className="hint ar-look-wait"><RefreshCw size={12} className="spin" /> Looking them up…</p>}
            {look && !look.busy && !look.ok && <p className="hint err-text" data-ar-look-err>{look.error}</p>}
            {look?.ok && (
              <div className="ar-look" data-ar-look>
                <Avatar src={f.photo} name={f.name || "?"} size={48} />
                <span className="ar-look-main">
                  <strong>{f.name || "We couldn't read their name: type it below"}</strong>
                  <span>{[f.genre, look.fans != null && `${fmt(look.fans)} Deezer fans`, whereFrom(look)].filter(Boolean).join(" · ")}</span>
                </span>
              </div>
            )}
          </>}
          <Field label={type === "song" ? "Song title" : "Name"} value={f.name} onChange={set("name")} />
          {simple && (
            <div className="fld"><span>Watching or signed?</span>
              <span className="gainer-tabs ar-watch-signed" role="tablist" aria-label="Watching or signed">
                {[["", "Watching"], ["signed", "Signed"]].map(([id, label]) => (
                  <button key={label} type="button" role="tab" aria-selected={f.stage === id} className={f.stage === id ? "active" : ""} data-stage-pick={id || "watching"} onClick={() => setF({ ...f, stage: id })}>{label}</button>
                ))}
              </span>
            </div>
          )}
          {type === "artist" && !simple && (
            <label className="fld"><span>Stage</span>
              <select value={f.stage} onChange={set("stage")} aria-label="Stage">
                <option value="">Just watching (not on the Board)</option>
                {AR_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                <option value="passed">Passed</option>
              </select>
            </label>
          )}
          {type === "song" && <Field label="Artist" value={f.artist} onChange={set("artist")} />}
          {type === "artist" && !simple && <Field label="Instagram or TikTok" value={f.handle} onChange={set("handle")} />}
          {!simple && <Field label="Spotify link" value={f.spotify} onChange={set("spotify")} />}
          {type === "song" && <Field label="ISRC (if you have it)" value={f.isrc} onChange={set("isrc")} />}
          {type === "song" && t?.isrcCandidates?.length > 0 && !f.isrc && <IsrcPicks list={t.isrcCandidates} busy={busy} onPick={pickIsrc} />}
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
          <p className="hint" data-ar-form-line>{simple ? "Their Spotify link brings in their numbers. No Spotify artist page yet? Add their songs: we add them up here." : "Saved here in the dashboard only. Nothing goes into the pub sheet."}</p>
        </div>
        {guard.bar}
        <div className="modal-foot">
          {!isNew && <button className="btn ghost sm err-text arb-remove" onClick={() => setAskStop(true)} disabled={busy}>Stop tracking</button>}
          <button className="btn ghost sm" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn sm" onClick={save} disabled={busy || look?.busy || !f.name.trim()}>{busy ? "Saving…" : isNew ? "Save" : "Save changes"}</button>
        </div>
      </div>
      {askStop && (
        <AskCard title={`Stop tracking ${t.name}?`} goLabel="Stop tracking" busyLabel="Stopping…" go={remove} onClose={() => setAskStop(false)}>
          <p>Nothing in the pub sheet changes.</p>
        </AskCard>
      )}
    </div>
  );
}


// Summary: the top gainers in the A&R lists and the pipeline at a glance (its to-dos are To do's, r7)
function ArSummary({ ar, onGo, goBoard, goWatch }) {
  const { data, pg, pgErr, loadPg } = ar;
  const watch = pg?.watch;
  const { cards } = arCards(data, pg);
  const phone = useMedia("(max-width: 699px)");
  const [gtab, setGtab] = useState("people"); // phones show one list at a time
  // ranked on the server by week-on-week % (watch.top: keys, ranked = shown with its %)
  const ranked = (list, keys) => (keys || []).map((k) => { const r = list.find((x) => x.key === k.key); return r && { ...r, ranked: k.ranked }; }).filter(Boolean);
  const people = ranked(watch?.people || [], watch?.top?.people), songs = ranked(watch?.songs || [], watch?.top?.songs);
  const to = watch?.period?.to;
  const old = to && daysSince(to) > 8;
  // its to-dos (follow-ups, ClickUp's A&R Tasks, the old Trackers' rows to find on Spotify) are To do's now (r7): the chip counts them
  const value = data?.totals?.totalValue;
  const stageN = (id) => cards.filter((c) => c.stage === id).length;
  // someone tracked here opens their panel on the Watchlist; a row only the old Artist Tracker had is just shown there
  const openGainer = (r, kind) => goWatch(r.ref ? { pill: kind, open: r.key } : { pill: kind, flash: r.key });
  const Gainers = ({ list, kind }) => (
    <div className="gainers ar-gainers" data-list={kind} data-wait={!pg ? "" : undefined}>
      <div className="attn-head"><TrendingUp size={15} /> {kind === "people" ? "People" : "Songs"}{watch?.periods?.[kind] && <span className="ar-dates"> · {dayRange(watch.periods[kind].from, watch.periods[kind].to)}</span>}</div>
      {!pg ? <p className="gainers-empty">Loading…</p> : !list.length && (watch?.[kind] || []).some((r) => r.wowPct != null) ? (
        <p className="gainers-empty">No rises this week.</p>
      ) : !list.length ? (
        <p className="gainers-empty">{kind === "people" ? "Nobody" : "No songs"} with a week of Spotify numbers yet.</p>
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
              {pct && <WowPill pct={r.wowPct} big />}<em>{fmt(r.thisWeek)} {unitWords(r, old)}</em>
            </span>
          </button>
        );
      })}
    </div>
  );
  const tabs = [["people", "People", (watch?.people || []).length], ["songs", "Songs", (watch?.songs || []).length]];
  return (
    <div className="ar-summary">
      <ArHead sub="Who's up this week." />
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
      <ArHead sub="Everyone we're talking to. Drag a card when things move.">
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

// Watchlist: everyone and every song tracked (and every row the old Artist and Song Trackers had), up or down
const SORTS = { name: (r) => String(r.name ?? r.title ?? "").toLowerCase(), current: (r) => r.current, changePct: (r) => r.changePct, atd: (r) => r.atd ?? r.lum?.atd, value: (r) => r.value };
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
  const { open, openPanel, closePanel } = usePanel();
  const { cards, sheetById } = arCards(data, pg);
  const stageBy = Object.fromEntries(cards.map((c) => [c.key, c.stage]));
  const tracked = Object.fromEntries((pg?.tracked || []).map((t) => [t.id, t]));
  const nameOfPerson = (id) => (pg?.watch?.people || []).find((r) => r.ref?.id === id)?.name || "";
  const people = (pg?.watch?.people || []).map((r) => {
    const s = r.ref?.type === "prospect" ? sheetById[r.ref.id] : null, t = r.ref?.type === "tracked" ? tracked[r.ref.id] : null;
    const key = r.ref ? `${r.ref.type === "prospect" ? "p" : "t"}:${r.ref.id}` : r.key;
    return { ...r, handle: s?.contact || t?.handle || "", value: s ? s.money.totalEstValue : null, stage: stageBy[key] ?? r.stage,
      lastContact: s?.lastContact?.date || t?.lastContact || null, lastText: s?.lastContact?.text || "", photo: t?.photo || r.deezer?.picture || "" };
  });
  const songs = (pg?.watch?.songs || []).map((r) => ({ ...r, name: r.title, tiedTo: r.personId ? nameOfPerson(r.personId) : "" }));
  const needle = find.trim().toLowerCase();
  const list = (pill === "people" ? people.filter((r) => show === "everyone" || (show === "artists" ? r.role === "artist" : r.role === "producer")) : songs)
    .filter((r) => !needle || `${r.name} ${r.handle || ""} ${r.artist || ""}`.toLowerCase().includes(needle))
    .filter((r) => !onlyNone || noNums(r));
  const by = SORTS[sort.k];
  const rows = sort.server ? list : [...list].sort((a, b) => {
    const x = by(a), y = by(b);
    if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1; // no numbers sink to the bottom
    return (x < y ? -1 : x > y ? 1 : 0) * (sort.k === "name" ? -sort.dir : sort.dir);
  });
  // a signed client's row opens their page on Publishing, not the add form
  const openRow = (r, e) => (r.clientId && !r.ref ? onGo("catalog", `client:${r.clientId}`)
    : openPanel(r.ref ? { type: r.ref.type, id: r.ref.id } : { type: "add", kind: pill === "songs" ? "song" : "artist", prefill: { name: r.name, artist: r.artist || "",
      // a row from the old Artist / Song Tracker: its Luminate id (so the numbers and history stay with it) and its Spotify song
      luminateId: r.entityId?.startsWith("l:") ? r.entityId.slice(2) : "", spotify: r.entityId?.startsWith("t:") ? `https://open.spotify.com/track/${r.entityId.slice(2)}` : "",
      nums: r.current != null ? { thisWeek: r.current, unit: r.unit, wowPct: r.changePct ?? null, atd: r.atd ?? null } : null } }, e));
  // Summary's row click: open that person's panel once it has drawn, or (a row only the old Artist Tracker had) light it up
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
  // someone only the old Artist Tracker had (not on OUTREACH) is tracked all the same (the owner): said so;
  // an artist with no Spotify artist link: their songs' numbers added up, and their Deezer fans
  const subOf = (r) => (pill === "people" ? [r.role === "producer" ? "Producer" : "Artist", r.fromList ? "From the old Artist Tracker" : r.handle, r.songsOnly && `${r.songCount} ${r.songCount === 1 ? "song" : "songs"}`, r.deezer?.fans != null && `${fmt(r.deezer.fans)} Deezer fans`]
    : [r.artist || (r.release ? "Release" : ""), r.tiedTo && `tied to ${r.tiedTo}`]).filter(Boolean).join(" · ");
  const rowKey = (e, r) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openRow(r, e); } };
  return (
    <div className="ar-watch">
      <ArHead sub="Everyone and every song we're tracking, and whether they're up or down.">
        <button className="btn sm" data-focus="add" onClick={(e) => openPanel({ type: "add", kind: pill === "songs" ? "song" : show === "producers" ? "producer" : "artist" }, e)}><Plus size={15} /> Add</button>
      </ArHead>
      {pgErr && <ArDataError err={pgErr} retry={loadPg} />}
      <p className="arb-status ar-period">
        {to ? <span>{old ? "Latest week" : "This week"}: {dayRange(period.from, to)} · compared with {dayRange(shiftDay(period.from, -7), shiftDay(to, -7))} · {pill === "people" ? "Spotify monthly listeners" : "Spotify streams, global"}</span>
          : "No Spotify numbers here yet: they come in with the daily update once someone has a Spotify link."}
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
            {head("name", pill === "people" ? "Name" : "Title", "name")}{head("changePct", pill === "people" ? "vs a week ago" : "vs last week", "pct")}{head("current", pill === "people" ? "Listeners" : "This week", "week")}{!tight && head("atd", pill === "people" ? "Luminate, all-time" : "All-time", "atd")}
            {pill === "people" && <><span data-col="stage">Stage</span><span data-col="contact">Last contact</span></>}
            {producers && head("value", "≈ Value", "value")}
          </div>
          {rows.map((r) => {
            const sub = subOf(r);
            return (
              <div key={r.key} role="button" tabIndex={0} className={`admin-row ar-link ar-row${lit === r.key ? " ar-flash" : ""}`} data-focus={`w:${r.key}`} data-key={r.key} style={{ "--cols": cols }}
                onClick={(e) => openRow(r, e)} onKeyDown={(e) => rowKey(e, r)}>
                <span className="cell ar-who" data-col="name">{r.photo ? <span className="ar-who-top"><Avatar src={r.photo} name={r.name} size={24} /><strong>{r.name}</strong></span> : <strong>{r.name}</strong>}
                  {sub && (
                    <span className="ar-who-sub">
                      <span>{sub}</span>
                    </span>
                  )}
                  {r.clientId ? <span className="tag ar-client-tag" data-tone="pos" title="One of our signed clients">Client</span>
                    : r.songsOnly ? <span className="tag ar-songs-only" data-songs-only title="No Spotify artist link yet: these are their songs added up">Songs only</span>
                    : r.fromList && <span className="ar-add-hint" aria-hidden="true">+ Add details</span>}
                </span>
                <span className="cell" data-col="pct">{r.current == null ? dash("No numbers yet") : r.changePct == null ? dash("No last week to compare") : <WowPill pct={r.changePct} />}</span>
                <span className="cell ar-num" data-col="week">{r.current == null ? <>{dash()}<em>No numbers yet</em></> : <><b>{fmt(r.current)}</b><em> {r.unit === "listeners" ? "listeners" : old ? "that week" : "this week"}</em></>}</span>
                {!tight && <span className="cell ar-num" data-col="atd">{pill === "people" ? (r.lum?.atd == null ? dash() : <span title={`Luminate's last all-time streams, ${shortDay(r.lum.on)}`}>{fmt(r.lum.atd)}</span>) : r.atd == null ? dash() : fmt(r.atd)}</span>}
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
                {signedClients.map((c) => <option key={c.id} value={`client:${c.id}`}>{c.name} ({fmt(c.netStreams)} net streams{c.netFromSheet === false ? ", estimate" : ", from the pub sheet"})</option>)}
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
            Net Streams ({fmt(Math.round(netStreams))}) comes from {selectedClient ? (selectedClient.netFromSheet === false ? `an estimate from ${scenario.name}'s catalog (no sheet tab read yet)` : `${scenario.name}'s tab of the pub sheet`) : `${scenario.name}'s songs in Outreach`} —
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
function AdvanceTab({ pick = null, db = null }) {
  const { data, err, load, retry } = useArData();
  // the calculator's levers and budget come from the sheet itself: nothing to work out without it
  const down = data && data.sheet?.ok === false;
  return (
    <>
      {err && <ArDataError err={err} retry={retry} />}
      {down && <ArDataError err="Couldn't read the pub sheet just now, so the Advance calculator can't work out its numbers." retry={retry} />}
      {!data && !err && <p className="muted">Loading…</p>}
      {data && !down && <div className="pub-sec"><AdvanceCalcPanel data={data} reload={load} pick={pick} /></div>}
      <RosterForecast db={db} />
    </>
  );
}

// Publishing › Advance calculator: the pub sheet's own 3-year forecast of our fee (MASTER), for the roster and
// by writer (r7: it moved here from Publishing's Overview). The sheet's Year 1 is the fee so far × B9 × (1 − B8),
// then B8 less each year: a rough guess, said so.
function RosterForecast({ db }) {
  const [d, setD] = useState(null);
  const [failed, setFailed] = useState(false);
  const [byWriter, setByWriter] = useState(false);
  useEffect(() => {
    let alive = true;
    swrJson("/api/sheets-master", (x) => alive && setD(x), { keep: (x) => !!x?.totals }).then((x) => { if (alive && !x?.totals) setFailed(true); }).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, []);
  if (failed) return <p className="hint">Couldn't read the roster's forecast from the pub sheet just now.</p>;
  if (!d) return null;
  const y = yearOne(d);
  // MASTER's Writer label can be stale ("Stackie", "WRITER 13"): the client its formulas read, as on Overview
  const writerOf = (r) => { const cs = db?.clients || []; const c = findByName([...cs.filter((x) => x.sheetTabName), ...cs.filter((x) => !x.sheetTabName)], r.sheetTab || r.writer, (x) => x.sheetTabName || x.name); return c ? c.name : r.writer; };
  return (
    <div className="pub-sec adv-forecast" data-forecast>
      <h3 className="lm-h3">Our fee, next 3 years</h3>
      <p className="hint">The pub sheet's rough guess{y ? `: ${y.share} of the fee so far in year 1, then ${y.decay} less a year` : ""}.</p>
      <div className="cat-summary"><div className="cat-summary-grid">
        <div className="cat-stat" data-stat="next3"><span className="cat-stat-label">Next 3 years</span><span className="cat-stat-val">{money(d.totals.threeYearForecast)}</span></div>
        <div className="cat-stat" data-stat="inAll"><span className="cat-stat-label">So far + 3 years</span><span className="cat-stat-val">{money(d.totals.totalEstAdminFee)}</span></div>
      </div></div>
      <button className="btn ghost sm" data-forecast-writers aria-pressed={byWriter} onClick={() => setByWriter((v) => !v)}>{byWriter ? "Hide writers" : "By writer"}</button>
      {byWriter && (
        <div className="master-table-wrap m-cards-wrap">
          <table className="master-table m-cards">
            <thead><tr>{["Writer", "Year 1", "Year 2", "Year 3", "Next 3 yrs", "In all"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{(d.rows || []).map((r) => <tr key={r.writer}><td>{writerOf(r)}</td><td data-label="Year 1">{money(r.year1)}</td><td data-label="Year 2">{money(r.year2)}</td><td data-label="Year 3">{money(r.year3)}</td><td data-label="Next 3 yrs">{money(r.forecastTotal)}</td><td data-label="In all">{money(r.totalEstAdminFee)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
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
// alt: { label, run } a second answer beside the red one (the merge card's "Not the same song"); wide: room for columns
function AskCard({ title, children, goLabel, busyLabel = "Working…", go, onClose, plain = false, typeName = null, alt = null, wide = false, goDisabled = false }) {
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const running = useRef(false); // set at once: a double click lands before the busy re-render
  const typedOk = !typeName || typed.trim() === typeName.trim();
  const close = () => { if (!busy) onClose(); };
  useEscape(close, true, true); // ahead of the window it opened over, so Esc closes only this
  const run = async (fn = go) => { if (!typedOk || running.current) return; running.current = true; setBusy(true); try { await fn(); } finally { running.current = false; setBusy(false); } };
  return (
    <div className="modal ask-modal" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className={wide ? "modal-card ask-card ask-wide" : "modal-card ask-card"} role="alertdialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h3>{title}</h3><button onClick={close} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-body ask-body">
          {children}
          {typeName && <input className="ask-type" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} disabled={busy} aria-label={`Type ${typeName} to confirm`} placeholder={typeName} autoComplete="off" spellCheck={false} autoFocus />}
        </div>
        <div className="modal-foot">
          {/* Cancel has the focus: Enter never deletes by accident */}
          <button className="btn ghost sm" onClick={close} disabled={busy} autoFocus={!typeName}>Cancel</button>
          {alt && <button className="btn ghost sm" data-ask-alt onClick={() => run(alt.run)} disabled={busy}>{alt.label}</button>}
          <button className={plain ? "btn sm" : "btn sm ask-go"} data-ask-go onClick={() => run()} disabled={busy || !typedOk || goDisabled}>{busy ? busyLabel : goLabel}</button>
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
      <button className="btn sm" data-keep-editing onClick={() => setAsking(false)} autoFocus>Keep editing</button>
      <button className="btn ghost sm" data-discard onClick={onClose}>Discard</button>
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
const noSheetTab = (songInfo, client) => !!client && (songInfo?.missingTabs || []).includes(client.name);
// the one line a Delete leaves under the client's header: what happened on the pub sheet
const dropNote = (o) => ({
  cleared: { text: `Deleted. Its row on the ${o.tab} tab is cleared.` },
  notFound: { warn: true, text: `Deleted here, but its row on the ${o.tab} tab wasn't found. Delete that row in the pub sheet by hand, or the next numbers sync brings the song back.` },
  noTab: { text: `Deleted. The pub sheet has no ${o.tab} tab, so there was no row to clear.` },
  failed: { warn: true, text: `Deleted here, but the pub sheet couldn't be updated (${o.error || "no answer"}). Delete its row on the ${o.tab} tab by hand.` },
}[o.sheet] || { text: "Deleted. It had no row on the pub sheet." });

// "This isn't ours": every place the app knows the song is, then one step takes it out of all of
// them (site, its sheet row) and notes it, so the sheet never brings it back. onDone gets the result line.
function NotOursAsk({ db, commit, songInfo, target, client, onDone, onClose }) {
  const tab = client?.sheetTabName?.trim() || client?.name || "";
  const places = [
    target.notable ? `On public page (${client?.name}'s page on the site)` : `On ${client?.name}'s page here (not public)`,
    ownSplit(target, client) && (noSheetTab(songInfo, client) ? `Not on the pub sheet (there's no ${tab} tab)` : `Its row on the ${tab} tab of the pub sheet`),
  ].filter(Boolean);
  const go = async () => {
    const out = await dropSong(db, commit, target, client);
    if (!out) return onClose(); // the save's own error banner says why
    let noted = null;
    try { await songsPost({ action: "notOurs", clientId: target.clientId, song: target.song, artist: target.artist, luminateId: target.luminateId || "", placementId: target.id }); } catch (e) { noted = e.message; }
    const sheetBad = out.sheet === "notFound" || out.sheet === "failed";
    const text = [
      out.sheet === "cleared" ? "Removed from the catalog and the pub sheet." : sheetBad ? `Removed from the catalog, but its row on the ${out.tab} tab ${out.sheet === "failed" ? "couldn't be cleared" : "wasn't found"}. Delete that row in the pub sheet by hand.` : "Removed from the catalog.",
      noted && `It couldn't be recorded as removed (${noted}), so a numbers sync may bring it back.`,
    ].filter(Boolean).join(" ");
    onDone({ warn: sheetBad || !!noted, text });
  };
  return (
    <AskCard title={`Remove "${target.song || "Untitled"}" from the catalog?`} goLabel="Remove from catalog" busyLabel="Removing…" go={go} onClose={onClose}>
      <p>This takes it out of everywhere the app can reach:</p>
      <ul className="ask-places">{places.map((x) => <li key={x}>{x}</li>)}</ul>
    </AskCard>
  );
}

// Save's sheet step (the song editor, and Splits to confirm's Confirm): only the split that belongs to
// whoever's catalog page this is goes to the pub sheet. A co-writer typed into another split, or an
// unnamed person from the even default, is just a name on the site, never someone we provision sheet
// tracking for. Resolves null, or what went wrong (a slow or failed push never undoes the site save)
async function pushOwnShare(saved, client, liveIds, keepPercent = null) {
  const mine = ownSplit(saved, client);
  // keepPercent: the share as the sheet has it, for a write that only renames the row (a merge, build I2)
  const splits = mine ? [{ name: client?.sheetTabName || client?.name, percent: keepPercent ?? mine.percent }] : [];
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

// editorOnly (To do's Fix / Update): only the song's editor and the strip after its Save, none of the client's page
function SongManager({ db, commit, clientId, isStaff, songInfo, reloadSongInfo, fix, onFix, onFixList, onGo, onDeleteClient, editorOnly = false }) {
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
  // the net streams shown are the sheet's own (MASTER's writer table, from the last pull); the sum above is
  // only an estimate, used where the sheet has no tab read for this client yet (build G3)
  const netShown = netStreamsOf(db.sheetFacts?.clients?.[clientId], summary.net);
  const growth = useGrowth();
  // this week = Spotify streams this week (the automated numbers, lib/data/growth.js), the songs whose week
  // ends last, as the Publishing table says
  const weekGain = useMemo(() => {
    if (!growth) return null;
    const gs = songs.map((p) => growth[p.id]).filter(Boolean);
    const end = gs.map((g) => g.thisWeek != null && g.weekOf?.to).filter(Boolean).sort().pop();
    const wk = gs.filter((g) => g.thisWeek != null && (!end || !g.weekOf || g.weekOf.to === end));
    return wk.length ? wk.reduce((a, g) => a + g.thisWeek, 0) : null;
  }, [growth, songs]);
  // the sheet's streams are Luminate's last numbers (db.streamsOn), not the day the site last pulled the sheet
  const numbersOn = db.streamsOn || null;
  const [openId, setOpenId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState(null);
  const [splitsFirst, setSplitsFirst] = useState(0); // a Fix's n while its editor is open: it opens on the Splits
  const [fieldFirst, setFieldFirst] = useState(null); // Songs to update's Update: { f: the field to open on, n }
  // a closed form takes its message with it, and a Fix's "open on the Splits" with it
  useEffect(() => { if (!editing) { setFormErr(null); setSplitsFirst(0); setFieldFirst(null); } }, [editing]);
  // an Update from Songs to update opens on its first missing field (the window's own scroll only)
  useEffect(() => {
    const el = fieldFirst && document.querySelector(`.modal-body [data-field="${fieldFirst.f}"]`), body = el?.closest(".modal-body");
    if (!el) return;
    if (body) body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top - 40;
    el.focus({ preventScroll: true });
  }, [fieldFirst?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const editFrom = useRef(null); // the song as it was when Edit was pressed
  const active = songs.find((p) => p.id === openId);
  // the song window shows an even split the rule can fill as it would be confirmed (lib/splits.js); staff only
  const activeEven = active && isStaff && splitTotal(active.splits) !== 100 && evenSplit(active.splits).status === "assumed" ? evenSplit(active.splits) : null;
  const [pushWarn, setPushWarn] = useState(null);
  // a "Fix" from the splits list opens that song's editor at once; after its Save, a strip says how many
  // are left and offers the next one (on any client's page)
  const fixing = useRef(null);
  const [fixNote, setFixNote] = useState(null);
  // an Update from Songs to update: { id, order (the list as it was), saved }. When its editor closes (Save or
  // Cancel) a strip offers the next song in that order and the way back to the list, as the splits Fix does
  const updating = useRef(null);
  useEffect(() => {
    const u = updating.current;
    if (editing || !u) return;
    updating.current = null;
    const now = songsToUpdate(db, songInfo), at = new Map(now.map((x) => [x.p.id, x]));
    const after = u.order.slice(u.order.indexOf(u.id) + 1).find((id) => at.has(id));
    setFixNote({ upd: true, saved: u.saved, next: at.get(after) || now.find((x) => x.p.id !== u.id) || null });
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const p = fix && db.placements.find((x) => x.id === fix.id);
    if (!p || p.clientId !== clientId) return;
    // a split Fix says what's left after Save; an Update from Songs to update says what's next when it closes
    const onSplits = !fix.field || fix.field === "splits";
    setOpenId(null); setFixNote(null); fixing.current = fix.field ? null : p.id;
    updating.current = fix.field ? { id: p.id, order: songsToUpdate(db, songInfo).map((x) => x.p.id), saved: false } : null;
    editFrom.current = p; setEditing({ ...p }); setSplitsFirst(onSplits ? fix.n : 0); setFieldFirst(onSplits ? null : { f: fix.field, n: fix.n });
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
    // the split as the editor shows it: for staff the even default filled in (lib/splits.js), or exactly what was
    // typed. A client's Save never fills it: the assumed default stays for the owner to confirm in Splits to confirm,
    // so a client fixing a link never writes an assumed share to their own sheet tab
    const form = isStaff ? { ...form0, splits: filledSplits(form0.splits) } : form0;
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
      const left = splitsToConfirm(done, songInfo).all; // the list's own order: biggest streams first
      setFixNote({ left: left.length, next: left.find((x) => x.p.id !== placementId) || null });
    }
    fixing.current = null;
    if (updating.current?.id === placementId) updating.current.saved = true;
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
      {isStaff && client && !editorOnly && (
        <div className="client-head">
          <Avatar src={client.photo} name={client.name} size={40} />
          <div className="client-head-text">
            <div className="client-head-name">{client.name}</div>
            <div className="client-head-meta">{client.role || "Client"} · {!songs.length ? "No songs yet. Their pub sheet tab is made with their first song."
              : noSheetTab(songInfo, client) ? <span className="warn-text" title={`The pub sheet has no tab called ${client.sheetTabName?.trim() || client.name}.`}>Sheet tab: not found</span>
              : `Sheet tab: ${client.sheetTabName?.trim() || client.name}`}</div>
          </div>
          {onDeleteClient && <ClientMore onDelete={() => onDeleteClient(client)} />}
        </div>
      )}
      {isStaff && fixNote?.upd && (
        <p className="hint fix-strip" role="status" data-upd-strip>
          {fixNote.saved && <><CheckCircle2 size={14} /> <span>Saved.</span></>}
          {fixNote.next
            ? <button className="inline-link" data-upd-next onClick={() => onFix?.(fixNote.next.p.id, fixNote.next.gaps[0].field)}>Next to update: {fixNote.next.p.song || "Untitled"} ({fixNote.next.client?.name || "a deleted client"}) →</button>
            : <span>No more songs to update.</span>}
          {" · "}<button className="inline-link" data-upd-back onClick={() => onFixList?.("update")}>Back to Songs to update</button>
        </p>
      )}
      {isStaff && fixNote && !fixNote.upd && (
        <p className="hint fix-strip" role="status">
          <CheckCircle2 size={14} /> <span>Saved. {fixNote.left ? `${fixNote.left} left` : "All splits add up now."}</span>
          {fixNote.next && <> · <button className="inline-link" onClick={() => onFix?.(fixNote.next.p.id)}>Next: {fixNote.next.p.song || "Untitled"} ({fixNote.next.client?.name || "a deleted client"}) →</button></>}
          {" · "}<button className="inline-link" onClick={() => onFixList?.()}>Back to the list</button>
        </p>
      )}
      {isStaff && <DropNote note={delNote} />}
      {!editorOnly && <>
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
            <div className="cat-stat" data-gross="site"><span className="cat-stat-label">Gross Streams{isStaff && <span className="cat-stat-note"> (songs on the site)</span>}</span><span className="cat-stat-val">{fmt(summary.gross)}</span></div>
            {/* staff see where each comes from, as the two can differ: the net is the pub sheet's own figure once a pull read the tab */}
            <div className="cat-stat" data-net={netShown.fromSheet ? "sheet" : "estimate"}><span className="cat-stat-label">Net Streams{!netShown.fromSheet ? <span className="cat-stat-note"> (estimate)</span> : isStaff && <span className="cat-stat-note"> (from the pub sheet)</span>}</span><span className="cat-stat-val">{fmt(netShown.value)}</span></div>
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
            {isStaff ? streamsAsOf({ lumDay: numbersOn, pulledAt: db.sheetSync.lastSyncedAt, sheet: songInfo?.streamSheet })
              : `Streams as of ${new Date(numbersOn ? `${numbersOn}T12:00:00` : db.sheetSync.lastSyncedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`}
            {isStaff && weekGain != null && ` · ${signed(weekGain)} Spotify streams this week`}
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
                {/* an even split the rule can fill is the owner's to confirm, not a broken one (Splits to confirm says the same) */}
                <em>{isStaff && splitTotal(p.splits) !== 100
                  ? (evenSplit(p.splits).status === "assumed" ? <span className="split-chip split-chip-even">Even split assumed</span> : <span className="split-chip">Splits {splitPct(p.splits)}%</span>)
                  : <>{(p.splits || []).length} {(p.splits || []).length === 1 ? "split" : "splits"} · <span className={splitTotal(p.splits) === 100 ? undefined : "split-warn"}>{splitTotal(p.splits)}%</span></>}</em>
                {/* its own line: on the splits line it was cut off by the card's width */}
                {p.notable && <span className="song-public"><Eye size={12} aria-hidden="true" /> On public page</span>}
                <GrowthChip g={growth?.[p.id]} />
              </div>
            </button>
          ))}
        </div>
      )}

      </>}

      {active && !editing && !editorOnly && (
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
              {/* an even split the rule can fill: shown as it would be confirmed, in a neutral note, never as a broken 0% */}
              {isStaff && activeEven && (
                <p className="hint song-even" data-song-even>Even split assumed: {splitWords(activeEven.splits, active.splits)}. Edit and Save confirms it (or Confirm in To do).</p>
              )}
              {/* the numbers before the pie (build I3): at 1440x900 Net streams is in view without scrolling, the warning above it too */}
              {db.sheetSync?.lastSyncedAt && (
                <div className="split-list song-nums">
                  <div className="split-list-row"><span className="split-name">Streams</span><span className="split-pct">{fmt(active.streams)}</span></div>
                  {/* the song's row on the sheet gives its net streams (gross × the sheet's writer share); without a row, the site's split estimates it */}
                  {(() => {
                    const f = db.sheetFacts?.songs?.[active.id];
                    const net = f ? f.net : Math.round((active.streams || 0) * ((Number(ownSplit(active, client)?.percent) || 0) / 100));
                    return <div className="split-list-row" data-song-net={f ? "sheet" : "estimate"}><span className="split-name">Net streams{!f && <em> (estimate)</em>}</span><span className="split-pct">{fmt(net)}</span></div>;
                  })()}
                  {isStaff && (
                    <>
                      <div className="split-list-row"><span className="split-name">Their earnings <em>(est., paid to them directly)</em></span><span className="split-pct">{money(active.revenue)}</span></div>
                      <div className="split-list-row"><span className="split-name">Our fee so far <em>(est. admin fee)</em></span><span className="split-pct">{money(active.adminFee)}</span></div>
                    </>
                  )}
                  <p className="hint song-asof">{isStaff ? streamsAsOf({ lumDay: numbersOn, pulledAt: db.sheetSync.lastSyncedAt, sheet: songInfo?.streamSheet })
                    : `as of ${new Date(numbersOn ? `${numbersOn}T12:00:00` : db.sheetSync.lastSyncedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`}</p>
                </div>
              )}
              <SplitsPie splits={activeEven ? activeEven.splits : active.splits} size={230} />
              <div className="split-list">
                {orderSplits(activeEven ? activeEven.splits : active.splits || []).map((s, i) => (
                  <div key={s.unnamed ? `u${i}` : s.id} className="split-list-row">
                    <span className="split-name">{s.name || s.label || "—"}{s.role && !s.unnamed && <em> · {s.role}</em>}{activeEven && (s.unnamed || !(Number((active.splits || []).find((t) => t.id === s.id)?.percent) > 0)) && <em> · assumed</em>}</span>
                    {/* one decimal, as the editor shows it (a third is 16.7%, not 16.666666666666668%); the saved % is unchanged */}
                    <span className="split-pct">{splitPct([s])}%</span>
                  </div>
                ))}
                <div className="split-list-row split-list-total">
                  <span>Total</span><span className={splitTotal(active.splits) === 100 ? "split-ok" : activeEven ? undefined : "split-warn"}>{activeEven ? `${splitPct(activeEven.splits)}% (assumed)` : `${splitPct(active.splits)}%`}</span>
                </div>
              </div>
              {growth?.[active.id]?.series?.length > 1 && (
                <div className="song-growth">
                  <div className="song-growth-nums">
                    {growth[active.id].thisWeek != null ? <span><b className="grow-val">{signed(growth[active.id].thisWeek)}</b> this week{growth[active.id].weekOf ? ` (${dayRange(growth[active.id].weekOf.from, growth[active.id].weekOf.to)})` : ""}</span>
                      : growth[active.id].daily != null && <span><b className="grow-val">{signed(growth[active.id].daily)}</b> yesterday</span>}
                    <span><b>{fmt(growth[active.id].latest)}</b> on Spotify</span>
                  </div>
                  <Sparkline series={growth[active.id].series} />
                  <p className="hint">Spotify streams, global, all-time, from {shortDay(growth[active.id].series[0][0])} to {shortDay(growth[active.id].latestOn)}</p>
                </div>
              )}
            </div>
            {/* the two ways a song leaves the page read alike, so say which is which */}
            {isStaff && <p className="hint song-foot-help" data-foot-help>Remove from catalog: a song that was never ours (it comes off the site and the pub sheet). Delete: a duplicate or a mistake on the site.</p>}
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
          <p>It comes off {client?.name}'s page here.{ownSplit(ask.p, client) && !noSheetTab(songInfo, client) ? ` Its row on the ${client?.sheetTabName?.trim() || client?.name} tab of the pub sheet is cleared too.` : ""} This can't be undone.</p>
          {ask.p.notable && <p>It's also shown on {client?.name}'s public page; it goes from there too.</p>}
        </AskCard>
      )}
      {ask?.kind === "notOurs" && (
        <NotOursAsk db={db} commit={commit} songInfo={songInfo} target={ask.p} client={client} onClose={() => setAsk(null)}
          onDone={(n) => { setAsk(null); setOpenId(null); setDelNote(n); reloadSongInfo?.(); }} />
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
              <Field label="Release date" type="date" data-field="releaseDate" value={editing.releaseDate} onChange={(ev) => setEditing({ ...editing, releaseDate: ev.target.value })} />
              <Field label="Streaming link" data-field="link" value={editing.link} onChange={(ev) => setEditing({ ...editing, link: ev.target.value })} />
              <SplitsEditor splits={editing.splits} onChange={(v) => setEditing({ ...editing, splits: v })} focusPct={splitsFirst} assume={!!isStaff} owner={client} />
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

// db.sheetSync is when the site last synced from the sheet (kept in the
// database, shared by every device), so "is this data current" can't just
// mean "has it ever synced" — a sync a while ago (including before some bug
// fix that only affects sync logic itself) would otherwise sit stale
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
// stored the way the live site's pull stores them (the sheet's shown values): money to the cent, a new
// card's share to one decimal (33.3, as the tab shows 1/3), the same as lib/site-sync.js
const toCents = (n) => Math.round((Number(n) || 0) * 100 + (n >= 0 ? 1e-9 : -1e-9)) / 100;
const toShare1 = (n) => Math.round((Number(n) || 0) * 10 + 1e-9) / 10;
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
      revenue: toCents(row.grossRevenue),
      adminFee: toCents(row.adminFee),
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
        splits: [{ id: uid(), name: c.name, role: c.role || "", percent: toShare1(row.writerShare) }],
        streams: row.grossStreams, revenue: toCents(row.grossRevenue), adminFee: toCents(row.adminFee),
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
  // the cards just imported have no sheet facts yet (the pull above ran before they existed), so they'd read as
  // having no row: read those clients' tabs once more, which keeps their facts (a read of the sheet only)
  const got = [...new Set(created.filter((p) => onSite.has(p.id)).map((p) => p.clientId))].map((id) => db.clients.find((c) => c.id === id)).filter(Boolean);
  if (got.length) {
    await fetch("/api/sheets-pull", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
      body: JSON.stringify({ clients: got.map((c) => ({ id: c.id, name: c.name, sheetTabName: c.sheetTabName })) }),
    }).catch(() => {}); // the next pull keeps them instead
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
// the two shares with one clear answer (lib/split-fixes.js), from the last sheet pull's facts
const shareFixesOf = (db) => shareFixes({ placements: db.placements || [], clients: db.clients || [], facts: db.sheetFacts || {}, makeId: uid });
function splitsToConfirm(db, songInfo = null) {
  const assumed = [], look = [];
  // a card in a possible duplicate pair waits for the merge card: confirming the kept one first would
  // keep its even default and drop the other card's named split, and Save on the other one adds a sheet row
  const held = dupeIds(db, songInfo);
  // (r7) no split here while the sheet has 100%: To do's own "Use the sheet's split" row, not a split to review
  for (const x of shareFixesOf(db).site) held.add(x.p.id);
  for (const g of splitsToFix(db)) {
    for (const p of g.songs) {
      if (held.has(p.id)) continue;
      const r = evenSplit(p.splits);
      (r.status === "assumed" ? assumed : look).push({ p, client: g.client, r });
    }
  }
  // one flat list, biggest streams first across every client (the client is named on each row)
  const byStreams = (a, b) => (b.p.streams || 0) - (a.p.streams || 0) || (a.client?.name || "").localeCompare(b.client?.name || "") || (a.p.song || "").localeCompare(b.p.song || "");
  assumed.sort(byStreams); look.sort(byStreams);
  return { assumed, look, all: [...assumed, ...look].sort(byStreams) };
}
// a song's row on its client's tab, in the same order the sheet pull matches them (pullAndMergeSheetData):
// its own Site Sync ID, then its Luminate ID, then a row with its title that no live song has claimed
const sheetRowOf = (p, rows, live) => rows.find((r) => r.syncId && r.syncId.split(":")[0] === p.id)
  || (p.luminateId && rows.find((r) => r.luminateId && r.luminateId === p.luminateId))
  || rows.find((r) => (!r.syncId || !live.has(r.syncId.split(":")[0])) && normalizeTitle(r.song) === normalizeTitle(p.song)) || null;
const pctOf = (v) => `${splitPct([{ percent: v }])}%`;
function SplitsToFix({ db, commit, songInfo, reloadSongInfo, onFix, focus, onGo, dupes = [], onDupe }) {
  const { assumed, look, all: flat } = useMemo(() => splitsToConfirm(db, songInfo), [db, songInfo]);
  const n = assumed.length + look.length;
  const [ask, setAsk] = useState(null);
  const [note, setNote] = useState(null);
  const [all, setAll] = useState(false); // the Confirm all card
  const [askOne, setAskOne] = useState(null); // a single Confirm that changes the sheet: its card
  const [busy, setBusy] = useState(null); // the song being confirmed
  const box = useRef(null);
  // opened from the Dashboard's To do: the list is what to look at
  useEffect(() => { if (focus) landOn(box.current); }, [focus]);
  const tabOf = (c) => c?.sheetTabName?.trim() || c?.name;
  // what Confirm does to the pub sheet, per song. Only the client's own share is ever written, and never to a
  // client whose tab can't be found: the push would claim an empty WRITER tab or copy TEMPLATE under their name
  // and the real tab would stay as it is. A share that changes what the sheet holds now is said before it's written
  const [sheetNow, setSheetNow] = useState({}); // placementId -> { found, share (null = blank) }; absent = not read
  const [reads, setReads] = useState(0);
  const pushes = (x) => !!(x.client && ownSplit({ splits: x.r.splits }, x.client) && !noSheetTab(songInfo, x.client));
  const readKey = [...new Set(assumed.filter(pushes).map((x) => x.client.id))].sort().join(",");
  useEffect(() => {
    if (!readKey) return;
    let off = false;
    const clients = readKey.split(",").map((id) => db.clients.find((c) => c.id === id)).filter(Boolean);
    fetch("/api/sheets-pull", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
      body: JSON.stringify({ clients: clients.map((c) => ({ id: c.id, name: c.name, sheetTabName: c.sheetTabName })) }),
    }).then((r) => (r.ok ? r.json() : null)).then((data) => {
      if (off || !data) return;
      const live = new Set(db.placements.map((p) => p.id));
      const out = {};
      for (const c of data.clients || []) {
        if (!c.tabFound) continue;
        for (const p of db.placements.filter((q) => q.clientId === c.clientId)) {
          const row = sheetRowOf(p, c.rows || [], live);
          out[p.id] = { found: !!row, share: row && Number(row.writerShare) > 0 ? Number(row.writerShare) : null };
        }
      }
      setSheetNow(out);
    }).catch(() => {}); // unread: every Confirm that writes then asks first
    return () => { off = true; };
  }, [readKey, reads]); // eslint-disable-line react-hooks/exhaustive-deps
  const plan = (x) => {
    const own = x.client && ownSplit({ splits: x.r.splits }, x.client);
    if (!own) return { kind: "none" };
    if (noSheetTab(songInfo, x.client)) return { kind: "tabless" };
    const will = Number(own.percent), now = sheetNow[x.p.id];
    if (!now) return { kind: "unread", will };
    if (!now.found) return { kind: "new", will };
    if (now.share == null || Math.abs(now.share - will) > 0.05) return { kind: "change", from: now.share, will };
    return { kind: "same", will };
  };
  const asks = (pl) => pl.kind === "change" || pl.kind === "new" || pl.kind === "unread";
  // the change in a few words, on the row and in the cards
  const changeWords = (pl) => pl.kind === "change" ? `sheet now ${pl.from == null ? "blank" : pctOf(pl.from)} → ${pctOf(pl.will)}`
    : pl.kind === "new" ? `not on the sheet yet → ${pctOf(pl.will)}`
    : pl.kind === "tabless" ? "set the sheet tab first" : null;
  const confirmSplits = async (items) => { // (not "confirm": that reads like the browser dialog)
    setNote(null);
    const plans = new Map(items.map((x) => [x.p.id, plan(x)]));
    const by = new Map(items.map((x) => [x.p.id, x.r.splits]));
    const done = await commit({ ...db, placements: db.placements.map((p) => (by.has(p.id) ? { ...p, splits: by.get(p.id) } : p)) });
    if (!done) return; // the save's own error banner says why, and nothing went to the sheet
    const live = done.placements.map((p) => p.id);
    const failed = [], wrote = [], changed = [], tabless = [];
    // one at a time: two pushes to the same tab at once could both pick the same empty row
    for (const x of items) {
      const saved = done.placements.find((p) => p.id === x.p.id);
      const client = done.clients?.find((c) => c.id === x.p.clientId) || x.client;
      if (!saved || !client || !ownSplit(saved, client)) continue; // not on their own split: nothing to write
      if (noSheetTab(songInfo, client)) { tabless.push(`${saved.song || "Untitled"} (${client.name})`); continue; }
      const err = await pushOwnShare(saved, client, live);
      if (err) { failed.push(`${saved.song || "Untitled"} (${err})`); continue; }
      wrote.push(x);
      const pl = plans.get(x.p.id);
      if (pl.kind === "change") changed.push(`${saved.song || "Untitled"} ${pl.from == null ? "blank" : pctOf(pl.from)} → ${pctOf(pl.will)}`);
      if (pl.kind === "new") changed.push(`${saved.song || "Untitled"} added at ${pctOf(pl.will)}`);
    }
    setReads((k) => k + 1);
    const tabNote = tabless.length ? ` Not written to the pub sheet, because the client's sheet tab isn't set: ${tabless.join(", ")}. Set the sheet tab first, then open the song and Save.` : "";
    if (failed.length) return setNote({ warn: true, text: `Confirmed on the site, but the pub sheet wasn't updated for ${failed.join(", ")}. Open the song and Save again.${tabNote}` });
    if (items.length === 1) {
      const x = items[0], pl = plans.get(x.p.id);
      const sheet = !wrote.length ? "" : pl.kind === "change" ? ` ${x.client.name}'s writer share on the ${tabOf(x.client)} tab went from ${pl.from == null ? "blank" : pctOf(pl.from)} to ${pctOf(pl.will)}.`
        : pl.kind === "new" ? ` It was added to the ${tabOf(x.client)} tab with ${x.client.name}'s writer share at ${pctOf(pl.will)}.`
        : ` ${x.client.name}'s writer share on the ${tabOf(x.client)} tab is ${pctOf(pl.will)}.`;
      return setNote({ warn: !!tabless.length, text: `Confirmed "${x.p.song || "Untitled"}": ${splitWords(x.r.splits, null, { confirmed: true })}.${sheet}${tabNote}` });
    }
    const w = wrote.length;
    setNote({ warn: !!tabless.length, text: `Confirmed ${items.length} even splits.${w ? ` ${w} writer share${w === 1 ? " is" : "s are"} on the sheet${changed.length ? `; ${changed.length} changed (${changed.join(", ")})` : ""}.` : ""}${tabNote}` });
  };
  const one = async (x) => { setBusy(x.p.id); try { await confirmSplits([x]); } finally { setBusy(null); } };
  const allWrites = assumed.filter(pushes);
  const allChanges = assumed.filter((x) => { const k = plan(x).kind; return k === "change" || k === "new"; });
  const allTabless = assumed.filter((x) => plan(x).kind === "tabless");
  const tabs = new Set(allWrites.map((x) => x.client.id)).size;
  const row = (x, acts, mid) => (
    <div className="fix-row" key={x.p.id} data-song={x.p.id} data-kind={x.r.status === "assumed" ? "assumed" : "look"}>
      <span className="fix-song"><span className="fix-who">{x.client?.name || "A deleted client"} · </span>{x.p.song || "Untitled"}</span>
      {mid}
      <span className="fix-streams">{fmt(x.p.streams || 0)} streams</span>
      <span className="fix-acts">{acts}</span>
    </div>
  );
  const oneAsk = askOne && plan(askOne);
  return (
    <div className={`fix-panel${focus ? " flash" : ""}`} ref={box} data-sec="splits">
      <div className="fix-head">
        <h3>{n ? `Splits to confirm (${n})` : "Splits"}</h3>
        <span className="hint">{n ? "Even by default: 50% artist side, 50% producer side. Confirm writes only the client's own share to the sheet." : "All splits add up."}</span>
      </div>
      <DropNote note={note} />
      <HeldDupes dupes={dupes} onDupe={onDupe} />
      {n > 0 && (
        <div className="fix-group" data-group="all">
          {/* one flat list, biggest streams first: an even split has Confirm, one that needs a look has Fix */}
          <div className="fix-sub">
            <span className="fix-client" data-split-counts>{[assumed.length && `${assumed.length} assumed as an even split`, look.length && `${look.length} need${look.length === 1 ? "s" : ""} review`].filter(Boolean).join(" · ")}</span>
            {assumed.length > 0 && <button className="btn sm" data-confirm-all disabled={!!busy} onClick={() => setAll(true)}>Confirm all {assumed.length}</button>}
          </div>
          {flat.map((x) => {
            if (x.r.status !== "assumed") return row(x, <>
              <button className="btn sm" onClick={() => onFix(x.p.id)}>Fix</button>
              {x.client && <button className="quiet-act" data-not-ours onClick={() => { setNote(null); setAsk({ p: x.p, client: x.client }); }}>Remove from catalog</button>}
            </>, <span className="fix-mid"><span className="fix-words fix-why"><span className="split-warn fix-pct">{splitPct(x.p.splits)}%</span> {x.r.reason}</span></span>);
            const pl = plan(x), cw = changeWords(pl);
            return row(x,
              <button className="btn sm" data-confirm disabled={!!busy} onClick={() => (asks(pl) ? setAskOne(x) : one(x))}>{busy === x.p.id ? "Confirming…" : "Confirm"}</button>,
              <span className="fix-mid"><span className="fix-words">{splitWords(x.r.splits, x.p.splits)}</span>
                {cw && <span className={`fix-sheet${pl.kind === "tabless" ? " tabless" : ""}`} data-sheet-change={pl.kind}>{cw}</span>}</span>);
          })}
        </div>
      )}
      {all && (
        <AskCard title={`Confirm ${assumed.length} even split${assumed.length === 1 ? "" : "s"}?`} goLabel={`Confirm all ${assumed.length}`} busyLabel="Confirming…" plain
          go={async () => { await confirmSplits(assumed); setAll(false); }} onClose={() => setAll(false)}>
          <p data-ask-writes>{allWrites.length
            ? `Writes the writer share for ${allWrites.length} song${allWrites.length === 1 ? "" : "s"} on ${tabs} client${tabs === 1 ? "'s" : "s'"} sheet tab${tabs === 1 ? "" : "s"}.`
            : "Nothing is written to the pub sheet: none of these clients is on their own split."} Unnamed people are only kept on the site.</p>
          {allChanges.length > 0 && <p data-ask-changes>{allChanges.length === 1 ? "1 of them changes" : `${allChanges.length} of them change`} the share on the sheet now, and that song's earnings change with it.</p>}
          {allTabless.length > 0 && <p data-ask-tabless>{allTabless.length === 1 ? "1 song is" : `${allTabless.length} songs are`} saved on the site only: set the client's sheet tab first.</p>}
          <ul className="ask-places">{assumed.map((x) => { const cw = changeWords(plan(x)); return <li key={x.p.id}>{x.p.song || "Untitled"} ({x.client?.name || "no client"}): {splitWords(x.r.splits, x.p.splits)}{cw && <b className="ask-change"> · {cw}</b>}</li>; })}</ul>
        </AskCard>
      )}
      {askOne && (
        <AskCard title={`Confirm "${askOne.p.song || "Untitled"}"?`} goLabel="Confirm" busyLabel="Confirming…" plain
          go={async () => { await one(askOne); setAskOne(null); }} onClose={() => setAskOne(null)}>
          <p>{splitWords(askOne.r.splits, askOne.p.splits)}.</p>
          <p data-ask-change>{oneAsk.kind === "change"
            ? `This changes ${askOne.client.name}'s writer share on the ${tabOf(askOne.client)} tab of the pub sheet from ${oneAsk.from == null ? "blank" : pctOf(oneAsk.from)} to ${pctOf(oneAsk.will)}. The song's earnings on the sheet change with it.`
            : oneAsk.kind === "new"
              ? `The ${tabOf(askOne.client)} tab of the pub sheet has no row for this song yet. Confirm adds it with ${askOne.client.name}'s writer share at ${pctOf(oneAsk.will)}.`
              : `This writes ${askOne.client.name}'s ${pctOf(oneAsk.will)} to the ${tabOf(askOne.client)} tab of the pub sheet. The share on the sheet now couldn't be read.`} Unnamed people stay on the site only.</p>
        </AskCard>
      )}
      {ask && (
        <NotOursAsk db={db} commit={commit} songInfo={songInfo} target={ask.p} client={ask.client} onClose={() => setAsk(null)}
          onDone={(r) => { setAsk(null); setNote(r); reloadSongInfo?.(); }} />
      )}
    </div>
  );
}

// Songs to update and Splits to confirm leave out the cards of a possible duplicate until it's reviewed: one line
// says so and opens the merge card, the single place that pair is handled
function HeldDupes({ dupes, onDupe }) {
  if (!dupes?.length || !onDupe) return null;
  return (
    <p className="hint fix-held" data-held>
      {dupes.length === 1 ? `${dupeName(dupes[0])} is a possible duplicate, so both of its cards are left out of this list until it's reviewed.` : `${dupes.length} possible duplicate songs are left out of this list until they're reviewed.`}
      {" "}<button className="inline-link" data-held-review onClick={onDupe}>Review</button>
    </p>
  );
}
const UPDATE_FIRST = 8;
// a row's chips, the money gaps first (no writer share, not on the sheet), as updateWords names them
const GAP_RANK = ["share", "sheet", "date", "link"];
const gapRank = (k) => (GAP_RANK.includes(k) ? GAP_RANK.indexOf(k) : GAP_RANK.length);
// Publishing › Songs to update: what each song is missing, one button that opens the song at the first gap
function SongsToUpdate({ db, songInfo, onFix, focus, dupes = [], onDupe }) {
  const list = useMemo(() => songsToUpdate(db, songInfo), [db, songInfo]);
  const box = useRef(null);
  useEffect(() => { if (focus) landOn(box.current); }, [focus]);
  // the biggest 8 first, so Overview's totals stay close; a gap chip narrows the list to that gap
  const [gap, setGap] = useState(null);
  const [more, setMore] = useState(false);
  const [opened, setOpened] = useState(() => new Set()); // phone rows whose "+N" was tapped: every chip shows
  const counts = useMemo(() => { const n = {}; for (const x of list) for (const g of x.gaps) if (GAP_WORDS[g.k]) n[g.k] = (n[g.k] || 0) + 1; return n; }, [list]);
  const shown = gap && counts[gap] ? list.filter((x) => x.gaps.some((g) => g.k === gap)) : list;
  const rows = more ? shown : shown.slice(0, UPDATE_FIRST);
  return (
    <div className={`fix-panel${focus ? " flash" : ""}`} ref={box} data-sec="update">
      <div className="fix-head">
        <h3>{list.length ? `Songs to update (${list.length})` : "Songs to update"}</h3>
        <span className="hint">{list.length ? "What each song is missing, from the last sheet pull. Update opens the song there." : "Every song has its sheet row, writer share, release date and link."}</span>
      </div>
      <HeldDupes dupes={dupes} onDupe={onDupe} />
      {Object.keys(counts).length > 1 && (
        <div className="upd-filters" data-upd-filters>
          <button className={`upd-filter${gap ? "" : " on"}`} aria-pressed={!gap} onClick={() => setGap(null)}>All ({list.length})</button>
          {Object.keys(GAP_WORDS).filter((k) => counts[k]).map((k) => (
            <button key={k} className={`upd-filter${gap === k ? " on" : ""}`} aria-pressed={gap === k} data-filter={k} onClick={() => { setGap(gap === k ? null : k); setMore(false); }}>{SONG_GAPS.find(([g]) => g === k)?.[1]} ({counts[k]})</button>
          ))}
        </div>
      )}
      {list.length > 0 && (
        <div className="fix-group" data-group="update">
          {rows.map((x) => { const gs = [...x.gaps].sort((a, b) => gapRank(a.k) - gapRank(b.k)), extra = gs.length + (x.splitSee ? 1 : 0) - 2, open = opened.has(x.p.id); return (
            <div className={`fix-row${open ? " upd-open" : ""}`} key={x.p.id} data-song={x.p.id}>
              <span className="fix-song"><span className="fix-who">{x.client?.name || "A deleted client"} · </span>{x.p.song || "Untitled"}</span>
              {/* money gaps first (as the To do names them); on phones the first two chips and a "+N" that shows the rest */}
              <span className="fix-mid upd-gaps">
                {gs.map((g, i) => <span key={g.k} className={`upd-gap${i >= 2 ? " upd-gap-x" : ""}`} data-gap={g.k}>{g.label}</span>)}
                {x.splitSee && <span className={`upd-gap upd-split${gs.length >= 2 ? " upd-gap-x" : ""}`} data-gap="split-see">Split: see Splits to confirm</span>}
                {/* m-tap-off: a chip-sized toggle so the row stays short; its ::after is the 44px tap area (mobile.css) */}
                {extra > 0 && <button type="button" className="upd-gap upd-gap-more m-tap-off" data-gap-more aria-expanded={open} aria-label={open ? "Show fewer" : `Show ${extra} more`}
                  onClick={() => setOpened((o) => { const n = new Set(o); if (n.has(x.p.id)) n.delete(x.p.id); else n.add(x.p.id); return n; })}>{open ? "Less" : `+${extra}`}</button>}
              </span>
              <span className="fix-streams">{fmt(x.p.streams || 0)} streams</span>
              <span className="fix-acts"><button className="btn sm" data-update onClick={() => onFix(x.p.id, (x.gaps[0] || {}).field)}>Update</button></span>
            </div>
          ); })}
          {shown.length > UPDATE_FIRST && <button className="inline-link upd-more" data-upd-more onClick={() => setMore(!more)}>{more ? `Show the first ${UPDATE_FIRST}` : `Show all ${shown.length}`}</button>}
        </div>
      )}
    </div>
  );
}

// The merge card (build H1): the two cards side by side and the card the merge leaves. The kept card is the one
// with the pub sheet row and the Luminate id; it keeps its title, streams, row and id, and takes what it lacks
// (release date, link, cover) and the split that adds up to 100% from the other. The other card comes off the
// site. It has no row, so nothing is written to the sheet for it; the kept card's row is written only when the
// client's own share changes (the song editor's Save step, pushOwnShare). (The Luminate id is the sheet row's
// own column M, which the sheet's formulas still read; the site never writes it.) "Not the same song" is kept
// (app_state, /api/songs) so the pair never comes back.
const splitLine = (splits) => {
  const list = orderSplits(splits || []);
  if (!list.length) return "No split yet";
  const t = splitTotal(list);
  return `${list.map((x) => `${x.name || x.label || "Unnamed"} ${splitPct([x])}%`).join(" · ")}${t === 100 ? "" : ` (adds up to ${splitPct(list)}%)`}`;
};
function DupeMerge({ db, commit, songInfo, reloadSongInfo, pair, onClose, onDone }) {
  const { keep, drop, client } = pair;
  const facts = db.sheetFacts?.songs || {};
  // the title it keeps (build I2), which staff can switch
  const pick = mergedTitle(keep, drop);
  const [title, setTitle] = useState(pick.title);
  const merged = { ...mergedCard(keep, drop), song: title };
  const tab = client?.sheetTabName?.trim() || client?.name || "";
  // the client's tab as it is now, read when the card opens and again at Merge (a read only, as Splits to confirm
  // does): the facts are from the last pull, and a row typed in, imported or added by a Save since then would make
  // the card being removed one that has a row. null = reading; { ok, keepRow, dropRow, share }
  const [fresh, setFresh] = useState(null);
  const [blocked, setBlocked] = useState(null);
  const readTab = async () => {
    try {
      const r = await fetch("/api/sheets-pull", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
        body: JSON.stringify({ clients: [{ id: client.id, name: client.name, sheetTabName: client.sheetTabName }] }),
      });
      const c = r.ok ? (await r.json())?.clients?.find((x) => x.clientId === client.id) : null;
      if (!c?.tabFound) return { ok: false };
      const live = new Set(db.placements.map((p) => p.id));
      const k = sheetRowOf(keep, c.rows || [], live), d = sheetRowOf(drop, c.rows || [], live);
      // byId: the push finds this row by itself (its Site Sync ID, or the merged card's Luminate id in M). A row
      // matched by its old title only is stamped first (/api/sheets-claim), or a push under the new title adds a row
      const byId = !!k && ((!!k.syncId && k.syncId.split(":")[0] === keep.id) || (!!merged.luminateId && (k.luminateId || "").trim() === merged.luminateId));
      return { ok: true, keepRow: k?.row ?? null, keepSong: k ? String(k.song ?? "") : null, keepById: byId, dropRow: d?.row ?? null, share: k && Number(k.writerShare) > 0 ? Number(k.writerShare) : null };
    } catch { return { ok: false }; }
  };
  useEffect(() => { let off = false; if (client) readTab().then((f) => { if (!off) setFresh(f); }); return () => { off = true; }; }, [keep.id, drop.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const row = fresh?.ok ? fresh.keepRow : facts[keep.id]?.row ?? null;
  // what the merge does to the client's writer share on their tab: only the kept card's row, and only on a change
  const own = client ? ownSplit(merged, client) : null;
  const will = own ? Number(own.percent) : null;
  const planFor = (f) => {
    const r = f?.ok ? f.keepRow : facts[keep.id]?.row ?? null, now = f?.ok ? f.share : facts[keep.id]?.share ?? null;
    return !own ? { kind: "none" } : r == null ? { kind: "norow" } : noSheetTab(songInfo, client) ? { kind: "tabless" }
      : now != null && Math.abs(now - will) <= 0.05 ? { kind: "same", will } : { kind: "change", from: now, will };
  };
  const share = planFor(fresh), now = share.from ?? null;
  // the kept row's song name changes with the title (the column Save writes); never with no own share to write back
  const renames = (f, kind) => (kind === "same" || kind === "change") && f?.ok && f.keepRow != null && f.keepSong != null && f.keepSong.trim() !== title.trim();
  const rename = renames(fresh, share.kind);
  const shareText = {
    none: `${client?.name || "The client"} isn't on the merged split, so nothing is written to the pub sheet.`,
    norow: `Neither card has a row on the ${tab} tab, so nothing is written to the pub sheet.`,
    tabless: `${client?.name}'s sheet tab isn't set, so nothing is written to the pub sheet.`,
    same: `${client?.name}'s writer share on the ${tab} tab stays ${pctOf(will)} (no change).${rename ? "" : " Nothing is written to the pub sheet."}`,
    change: `${client?.name}'s writer share on the ${tab} tab changes from ${now == null ? "blank" : pctOf(now)} to ${pctOf(will)}, and the song's earnings on the sheet change with it.`,
  }[share.kind];
  const fromOther = (k) => !keep[k] && !!drop[k];
  // the merged card takes another title (the other card's, "TRUST WHO #jerseyclub"): the card is told by its outcome, one
  // card with that title, since "X is removed" would read as the real song going (owner, Nov 2)
  const retitled = title.trim() !== (keep.song || "").trim();
  const and = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] || "");
  const keeps = [row != null && `row ${row} on the ${tab} tab`, keep.luminateId && "the Luminate id"].filter(Boolean);
  const takes = [fromOther("releaseDate") && "release date", fromOther("link") && "link", fromOther("cover") && "cover",
    fromOther("luminateId") && "Luminate id", merged.splits !== keep.splits && "split"].filter(Boolean);
  const outcome = `One card is left, titled "${title || "Untitled"}"${keeps.length ? `: it keeps ${and(keeps)}` : ""}${takes.length ? `${keeps.length ? "," : ""} and takes the ${and(takes)} from the other card` : ""}. The other card comes off the site.`;
  const keptHead = [row != null && "sheet row", keep.luminateId && "Luminate id"].filter(Boolean);
  // the second card's title is the one kept: not struck through
  const dropTitleKept = !!(drop.song || "").trim() && title.trim() === (drop.song || "").trim();
  // the merged card's title: two choices, the kept card's first
  const titleChoice = pick.other ? (
    <span className="dupe-title-pick" role="radiogroup" aria-label="Title after merging">
      {[[pick.title, "The kept card's title"],
        [pick.other, pick.other === (keep.song || "").trim() ? "The kept card's title" : "The other card's title"]].map(([t, why]) => (
        <label key={t} className={title === t ? "on" : ""}><input type="radio" name="dupe-title" checked={title === t} onChange={() => setTitle(t)} /><span><b>{t}</b><small>{why}</small></span></label>
      ))}
    </span>) : title || "Untitled";
  const fields = (p, side) => [
    ["Title", side === "merged" ? titleChoice : p.song || "Untitled"],
    ["Streams", fmt(p.streams || 0)],
    ["Pub sheet", side === "drop" ? (!fresh ? "Checking…" : !fresh.ok ? "Couldn't be checked" : fresh.dropRow != null ? `Row ${fresh.dropRow} on the ${tab} tab` : "No row")
      : row != null ? `Row ${row} on the ${tab} tab` : "No row"],
    ["Luminate id", p.luminateId || "None", side === "merged" && fromOther("luminateId")],
    ["Release date", p.releaseDate ? releaseDay(p.releaseDate) : "None", side === "merged" && fromOther("releaseDate")],
    ["Link", p.link ? <ExtLink className="inline-link" href={p.link}>Open track ↗</ExtLink> : "None", side === "merged" && fromOther("link")],
    ["Cover", p.cover ? <span className="dupe-cover"><Photo src={p.cover} alt="" /></span> : "None", side === "merged" && fromOther("cover")],
    ["Split", splitLine(p.splits), side === "merged" && p.splits !== keep.splits],
  ];
  const col = (p, side, head) => (
    <div className={`dupe-col ${side}${side === "drop" && dropTitleKept ? " title-kept" : ""}`} data-dupe-col={side}>
      <div className="dupe-col-head">{head}</div>
      {/* the cover is an image on its own line: its note goes under it without the leading dot */}
      <dl>{fields(p, side).map(([k, v, filled]) => <div key={k} className="dupe-f" data-f={k}><dt>{k}</dt><dd>{v}{filled && <em className="dupe-from">{k === "Cover" ? "From the other card" : " · from the other card"}</em>}</dd></div>)}</dl>
    </div>
  );
  const merge = async () => {
    // the tab once more, right before anything changes: a card that has a row now is never removed
    setBlocked(null);
    const f = await readTab();
    setFresh(f);
    if (!f.ok) return setBlocked(`The ${tab} tab of the pub sheet couldn't be read just now, so nothing was changed. Try again.`);
    if (f.dropRow != null) return setBlocked(`"${drop.song || "Untitled"}" now has its own row on the ${tab} tab (row ${f.dropRow}). Removing the card would leave that row counting on the sheet, so nothing was changed. Remove the row from the sheet first, or choose Not the same song.`);
    const share = planFor(f);
    const renameNow = renames(f, share.kind);
    // the kept row was found by its title only (typed in by hand, no Site Sync ID, no Luminate id in M): stamp its
    // Site Sync ID before anything else, so the push below writes that row, never a second one under the new title
    if ((share.kind === "change" || renameNow) && !f.keepById) {
      const who = (client?.sheetTabName || client?.name || "").trim();
      const ok = await fetch("/api/sheets-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
        body: JSON.stringify({ claims: [{ tab: who, row: f.keepRow, syncId: `${keep.id}:${who.toLowerCase()}` }] }),
      }).then((r) => r.ok).catch(() => false);
      if (!ok) return setBlocked(`Row ${f.keepRow} on the ${tab} tab couldn't be marked as this song's row just now, so nothing was changed. Try again.`);
    }
    const done = await commit({ ...db, placements: db.placements.filter((p) => p.id !== drop.id).map((p) => (p.id === keep.id ? merged : p)) });
    if (!done) return; // the save's own error banner says why; nothing went to the sheet
    const saved = done.placements.find((p) => p.id === keep.id);
    const c = done.clients?.find((x) => x.id === keep.clientId) || client;
    let err = null;
    if (share.kind === "change" && saved && ownSplit(saved, c)) err = await pushOwnShare(saved, c, done.placements.map((p) => p.id));
    // only the song name changes: the share goes back exactly as the sheet has it
    else if (renameNow && saved && ownSplit(saved, c)) err = await pushOwnShare(saved, c, done.placements.map((p) => p.id), f.share);
    reloadSongInfo?.();
    const n = done.placements.filter((p) => p.clientId === keep.clientId).length;
    onDone(err
      ? { warn: true, text: `Merged into "${title}", but the pub sheet wasn't updated (${err}). Open the song and Save again.` }
      : { text: `${title === keep.song ? `Merged "${drop.song || "Untitled"}" into "${keep.song || "Untitled"}".` : `Merged "${keep.song || "Untitled"}" and "${drop.song || "Untitled"}" into one card, "${title || "Untitled"}".`} ${client?.name || "The client"} has ${n} song${n === 1 ? "" : "s"}.${share.kind === "change" ? ` The writer share on the ${tab} tab is now ${pctOf(share.will)}.` : ""}${renameNow ? ` Row ${f.keepRow} on the ${tab} tab is now "${title}".` : ""}` });
  };
  const notSame = async () => {
    try { await songsPost({ action: "notDuplicate", ids: [keep.id, drop.id] }); } catch (e) { onDone({ warn: true, text: `Couldn't save that: ${e.message}` }); return; }
    reloadSongInfo?.();
    onDone({ text: `Kept both "${keep.song}" and "${drop.song}". They won't be asked about again.` });
  };
  return (
    <AskCard title="Merge these two cards?" goLabel="Merge cards" busyLabel="Working…" plain wide go={merge} onClose={onClose} alt={{ label: "Not the same song", run: notSame }}>
      <p data-dupe-why>{client?.name ? `${client.name}'s page has` : "These are"} two cards with {pair.why}.{retitled ? "" : " After merging, one card is left."}</p>
      {/* what happens, above the columns so it's in view at 1280x800 before Merge cards */}
      <p data-merge-drop>{retitled ? outcome : `"${drop.song || "Untitled"}" is removed from the site.`} {!fresh ? `Checking the ${tab} tab for its row…`
        : !fresh.ok ? `The ${tab} tab couldn't be checked just now; Merge checks it again first.`
        : fresh.dropRow != null ? `It has its own row on the ${tab} tab (row ${fresh.dropRow}), so it can't be merged here.`
        : `It has no row on the ${tab} tab (checked just now), so nothing is written there for it.`}</p>
      <p data-merge-share>{shareText}{rename && <> <span data-merge-rename>Row {fresh.keepRow} on the {tab} tab is renamed to "{title}".</span></>}</p>
      {/* the weekly ClickUp task counts the Publishing to-dos: it's checked at a Dashboard load (every 10 minutes at most) */}
      <p className="hint" data-merge-clickup>The weekly ClickUp task updates its counts at the next Dashboard load.</p>
      {blocked && <p className="warn-text" role="alert" data-merge-blocked>{blocked}</p>}
      <div className="dupe-cols">
        {col(keep, "keep", retitled && keptHead.length ? `Kept: ${keptHead.join(" and ")}` : "Keeps this card")}
        {col(drop, "drop", retitled ? "Folded in, then removed" : "Removed from the site")}
        {col(merged, "merged", "After merging")}
      </div>
    </AskCard>
  );
}

// (Splits to confirm, Songs to update and the merge card are To do's now, r7: PubFix there shows them)
function CatalogOverview({ db, commit, songInfo, reloadSongInfo, onSelectClient }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [streamSync, setStreamSync] = useState({ syncing: false, error: null }); // "Refresh numbers": the sheet pulled again
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

  // pulls every client's numbers from the pub sheet again (fullSiteSync) and re-reads MASTER, with the
  // "as of" line below reflecting that moment. Nothing is written to the sheet (list B #3: STREAM DATA
  // isn't rebuilt any more)
  const runStreamSync = async () => {
    setStreamSync({ syncing: true, error: null });
    try {
      const { missing } = await fullSiteSync(dbNow.current, commit);
      reloadSongInfo?.(); // the pull re-checked the sheet tabs: the task counts and badge follow
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
  const rate = state.data?.rate;
  // the writers' table: This week first (each writer's songs that have both weeks, added up, as
  // lib/weekly.js sumWeeks), biggest % first; any column head re-sorts. Writer, Songs, This week, Streams and
  // Our fee show; Net streams, Their earnings and the share of the roster's fee wait behind "More columns"
  // (r7: the 3-year forecast lives on the Advance calculator)
  const { growth } = useGrowthState();
  // auto: the opening order (This week); with no weekly numbers at all it falls back to Streams (list A 1)
  const [sort, setSort] = useState({ col: "week", dir: -1, auto: true });
  const [more, setMore] = useState(false);
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
  const MORE_COLS = ["net", "earn", "share"];
  const cols = [["writer", "Writer"], ["songs", "Songs"], ["week", "This week"], ["gross", "Streams"], ...(more ? [["net", "Net streams"], ["earn", "Their earnings"]] : []), ["fee", "Our fee"],
    ...(more ? [["share", "% of roster fee"]] : [])];
  const val = { songs: (x) => x.songs, gross: (x) => x.r.grossStreams, net: (x) => x.r.netStreams, earn: (x) => x.r.grossRevenue, fee: (x) => x.r.adminFee, share: (x) => Number(x.r.pctOfRoster) };
  const cell = { writer: null, songs: (r) => r.songs, gross: (r) => fmt(r.grossStreams), net: (r) => fmt(r.netStreams), earn: (r) => money(r.grossRevenue), fee: (r) => money(r.adminFee), share: (r) => `${r.pctOfRoster}%` };
  // Songs = the songs on the site for that writer (the client list's count beside it); the sheet's own
  // count, when it differs, is said under it (a song the site has that isn't on the writer's tab yet)
  const siteSongs = (client, r) => (client ? db.placements.filter((p) => p.clientId === client.id).length : r.songs);
  const rows = (state.data?.rows || []).map((r) => { const client = findClient(r); return { r, client, wk: weekOf(client), songs: siteSongs(client, r) }; });
  const name = (x) => (x.client ? x.client.name : x.r.writer).toLowerCase();
  const noWeeks = !rows.some((x) => x.wk);
  const by = sort.auto && sort.col === "week" && noWeeks ? { col: "gross", dir: -1 } : sort; // the column the rows follow
  // the days This week covers, said once in the source line (the Dashboard says the same)
  const weeks = rows.map((x) => x.wk?.weekOf).filter(Boolean);
  const span = weeks.length ? { from: weeks.map((w) => w.from).sort()[0], to: weeks.map((w) => w.to).sort().pop() } : null;
  rows.sort((a, b) => {
    if (by.col === "writer") return by.dir * name(a).localeCompare(name(b));
    if (by.col === "week") {
      // no % goes last either way, by this week's streams, then (no week at all) by all-time streams
      const pa = a.wk?.wowPct ?? null, pb = b.wk?.wowPct ?? null;
      if (pa == null || pb == null) return pa == null && pb == null ? (b.wk?.thisWeek ?? -1) - (a.wk?.thisWeek ?? -1) || (b.r.grossStreams || 0) - (a.r.grossStreams || 0) : pa == null ? 1 : -1;
      return by.dir * (pa - pb) || name(a).localeCompare(name(b));
    }
    return by.dir * ((Number(val[by.col](a)) || 0) - (Number(val[by.col](b)) || 0)) || name(a).localeCompare(name(b));
  });
  const songsTotal = rows.reduce((a, x) => a + (Number(x.songs) || 0), 0);
  return (
    <div>
      <div className="admin-head">
        <h2>Overview</h2>
        <div className="overview-links">
          <button className="btn ghost sm" onClick={runStreamSync} disabled={streamSync.syncing} title="Pull every client's numbers from the pub sheet again">
            <RefreshCw size={14} className={streamSync.syncing ? "spin" : ""} /> {streamSync.syncing ? "Refreshing numbers…" : "Refresh numbers"}
          </button>
          {links.folder && <ExtLink href={links.folder} className="btn ghost sm" title="Open the pub sheet's Drive folder"><Folder size={14} /> Folder</ExtLink>}
        </div>
      </div>
      <p className="hint overview-subhint">
        {streamsAsOf({ lumDay: songInfo?.lumLastDay, pulledAt: db.sheetSync?.lastSyncedAt, sheet: songInfo?.streamSheet })}
        {span && <span className="overview-week"> · This week = Spotify streams, {dayRange(span.from, span.to)} vs the week before</span>}
      </p>
      <p className="hint overview-subhint" data-stream-data-note>{songInfo?.streamSheet?.text || "Sheet streams: Luminate's last numbers"}</p>
      {streamSync.error && <p className="hint err-text overview-subhint">{streamSync.error}</p>}
      {state.loading && <p className="muted">Loading master sheet data…</p>}
      {state.error && <p className="hint err-text">{state.error}</p>}

      {state.data && (
        <>
          <div className="cat-summary">
            {/* three numbers (r7): the roster's streams, what they earned, and our fee so far (MASTER's own totals,
                in the words of each client's page and the Advance calculator); the 3-year forecast is on the calculator */}
            <div className="cat-summary-grid pub-tiles">
              {/* MASTER adds each writer's gross up: a song two roster writers share is in it twice */}
              <div className="cat-stat" data-stat="streams" title="Added up by writer: a song two writers share counts once for each"><span className="cat-stat-label">Gross streams</span><span className="cat-stat-val">{fmt(state.data.totals.rosterGrossStreams)}</span></div>
              <div className="cat-stat" data-stat="earnings"><span className="cat-stat-label">Their earnings</span><span className="cat-stat-val">{money(state.data.totals.grossRevenuePool)}</span></div>
              <div className="cat-stat" data-stat="fee"><span className="cat-stat-label">Our fee so far</span><span className="cat-stat-val">{money(state.data.totals.catalogToDate)}</span></div>
            </div>
            {/* the one place the money's explained: everything below (and each client's page) is the same estimate */}
            <p className="hint cat-asof money-hint" title="The rate is ASSUMPTIONS!B7 on the pub sheet">
              Estimates: streams × the writer's share × {rate ? `$${+rate.toFixed(6)} a stream` : "the sheet's rate"}.
            </p>
          </div>

          <div className="master-tools">
            <button className="btn ghost sm" data-more-cols aria-pressed={more} onClick={() => { setMore((f) => !f); if (more && MORE_COLS.includes(sort.col)) setSort({ col: "week", dir: -1, auto: true }); }}>{more ? "Fewer columns" : "More columns"}</button>
          </div>
          {/* phones: the table is a stack of cards (components/ui), so its sort is a picker */}
          <PhoneSort cols={cols.map(([id, label]) => ({ id, label }))} sort={by} onSort={(id) => setSort(() => ({ col: id, dir: by.col === id ? -by.dir : id === "writer" ? 1 : -1 }))} />
          <div className="master-table-wrap m-cards-wrap">
            <table className="master-table m-cards">
              <thead>
                <tr>
                  {cols.map(([id, label]) => (
                    <th key={id} data-col={id} aria-sort={by.col === id ? (by.dir < 0 ? "descending" : "ascending") : undefined}>
                      <button className={by.col === id ? "ar-sort on" : "ar-sort"} onClick={() => setSort(() => ({ col: id, dir: by.col === id ? -by.dir : id === "writer" ? 1 : -1 }))}>{label}{by.col === id ? (by.dir < 0 ? "\u00a0▼" : "\u00a0▲") : ""}</button>
                      {/* which week it is, right on the column */}
                      {id === "week" && span && <span className="master-week-of">{dayRange(span.from, span.to)} vs the week before</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ r, client, wk, songs }) => (
                  <tr
                    key={r.writer}
                    className={client ? "master-row-link" : ""}
                    onClick={client ? () => onSelectClient(client.id) : undefined}
                    title={client ? `Open ${client.name}` : "Not linked to a client on the site"}
                  >
                    {cols.map(([id, label]) => (id === "writer" ? <td key={id}>{client ? client.name : r.writer}</td>
                      : id === "songs" ? <td key={id} data-label={label} className="master-songs">{songs}{client && songs !== r.songs && <em data-sheet-songs={r.songs} title={`The pub sheet's ${client.name} tab has ${r.songs} song${r.songs === 1 ? "" : "s"}; the site has ${songs}`}>{songs > r.songs ? `${songs - r.songs} not on the sheet` : `sheet has ${r.songs}`}</em>}</td>
                      : id === "week" ? <td key={id} data-label={label} className="master-week">{wk ? <><WowPill pct={wk.wowPct} /><em>{fmt(wk.thisWeek)}</em></> : <span className="muted-dash" title="No last week to compare">—</span>}</td>
                      : <td key={id} data-label={label}>{cell[id](r)}</td>))}
                  </tr>
                ))}
              </tbody>
              {state.data.rosterTotal && (
                <tfoot>
                  <tr className="master-total-row">
                    {cols.map(([id, label]) => <td key={id} data-label={label}>{id === "writer" ? "Roster total" : id === "week" ? null : id === "songs" ? songsTotal : cell[id](state.data.rosterTotal)}</td>)}
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
function CatalogAdmin({ db, commit, songInfo, reloadSongInfo, sub, onGo, onSub, chip = null }) {
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
  const openFix = (id, field = null) => {
    const p = db.placements.find((x) => x.id === id);
    if (!p) return;
    setSec("overview"); setClientIdOnly(p.clientId); onSub?.(`client:${p.clientId}`); setFix({ id, n: ++fixN.current, field });
  };
  const toFix = useMemo(() => splitsToConfirm(db, songInfo).all.reduce((a, x) => ({ ...a, [x.p.clientId]: (a[x.p.clientId] || 0) + 1 }), {}), [db, songInfo]);
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
    // list B #7: what the pasted link filled in (a lasting photo link only, and every profile confirmed)
    const lk = newClientForm.links || {};
    const client = {
      id: uid(), name, role: newClientForm.role, credit: "", bio: "", photo: newClientForm.photo || "",
      spotify: lk.spotify || "", apple: "", instagram: lk.instagram || "", tiktok: lk.tiktok || "", youtube: lk.youtube || "", soundcloud: "",
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
        <h2>Publishing</h2>{chip}
      </div>
      <div className="subnav">
        <button className={sec === "overview" ? "subpill active" : "subpill"} onClick={pick("overview")}>Overview &amp; clients</button>
        <button className={sec === "advance" ? "subpill active" : "subpill"} onClick={pick("advance")}>Advance<span className="pill-long"> calculator</span></button>
      </div>
      {sec === "advance" && <AdvanceTab db={db} pick={sub?.startsWith("advance:") ? sub.slice(8) : null} />}
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
                  {toFix[c.id] > 0 && <span className="cc-fix" title="Songs in Splits to confirm: an even split to confirm, or one that needs review">{toFix[c.id]} to confirm</span>}</span>
                <span className="cc-count">{count(c.id)}</span>
              </button>
            </div>
          ))}
        </div>
        <div className="catalog-main">
          {clientId === null
            ? <CatalogOverview db={db} commit={commit} songInfo={songInfo} reloadSongInfo={reloadSongInfo} onSelectClient={setClientId} />
            : (client ? <SongManager db={db} commit={commit} clientId={clientId} isStaff songInfo={songInfo} reloadSongInfo={reloadSongInfo} fix={fix} onFix={openFix} onFixList={(to) => { setFix(null); onGo("todo", to === "update" ? "update" : "splits"); }} onGo={onGo} onDeleteClient={setDelAsk} />
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
              {/* list B #7: paste their Spotify, Instagram, TikTok or YouTube and the name, photo and links fill in */}
              {newClientForm.found ? (
                <div className="lb-picked" data-new-client-found>
                  <Avatar src={newClientForm.photo} name={newClientForm.name || "?"} size={40} />
                  <span className="lb-picked-t"><b>{newClientForm.found}</b><em>{["spotify", "instagram", "tiktok", "youtube"].filter((k) => newClientForm.links?.[k]).map((k) => ({ spotify: "Spotify", instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" })[k]).join(" · ")}</em></span>
                  <button type="button" className="inline-link" onClick={() => setNewClientForm({ name: newClientForm.name, role: newClientForm.role })}>Change</button>
                </div>
              ) : (
                <div className="fld"><span>Their link (optional)</span>
                  <LinkBox context="roster" addLabel="Use this" onAdd={(r) => setNewClientForm((f) => ({ ...f, name: f.name.trim() ? f.name : (r.card.name || "").replace(/^@/, ""), photo: r.card.photo || "", links: r.links, found: r.card.name || r.link.label }))} />
                </div>
              )}
              <Field label="Name" value={newClientForm.name} onChange={(ev) => setNewClientForm({ ...newClientForm, name: ev.target.value })} onKeyDown={(ev) => ev.key === "Enter" && addClient()} />
              {newNameTaken && <p className="hint err-text">{NAME_TAKEN}</p>}
              <label className="fld"><span>Role</span>
                <select value={newClientForm.role} onChange={(ev) => setNewClientForm({ ...newClientForm, role: ev.target.value })}>
                  <option>Producer</option><option>Artist</option><option>Producer / Artist</option>
                </select>
              </label>
              <p className="hint">Starts hidden from the public roster (Site › Website › Roster). Their sheet tab is made with their first song.</p>
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

/* staff: small shared helpers (days, numbers, each song's extra facts) ------------------------ */
const ago = (iso) => {
  if (!iso) return "";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};
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

// POST /api/songs (lib/song-info.js): an ISRC typed or picked, "This isn't ours", "Not the same song"
async function songsPost(body) {
  const res = await fetch("/api/songs", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
    body: JSON.stringify(body),
  }).catch(() => null);
  const data = res && await res.json().catch(() => null);
  if (!res?.ok) throw Object.assign(new Error(data?.error || "That didn't go through — check your connection and try again."), { data });
  return data;
}

// where an ISRC came from, in lib/isrc.js SOURCES' words (App.jsx can't import server code)
const ISRC_SOURCES = { "spotify-link": "the song's Spotify link", deezer: "Deezer", "deezer-artist": "the artist's Deezer page", musicbrainz: "MusicBrainz", manual: "typed in" };
// the finder's guesses for a song (any of its pages' ids), or []
const isrcPicksOf = (info, ids) => ids.map((id) => info?.isrcCandidates?.[id]).find((x) => x?.length) || [];
// A row's ⋯ menu (rule 3: one button per row; the rest goes here). Placed on the screen itself like the
// Board's, so a list that scrolls can't cut it off; it follows its button and closes on a tap elsewhere.
function RowMenu({ label, items }) {
  const [menu, setMenu] = useState(null);
  const box = useRef(null), dots = useRef(null);
  useEscape(() => setMenu(null), !!menu);
  const place = () => {
    const r = dots.current?.getBoundingClientRect();
    if (!r || r.bottom < 0 || r.top > window.innerHeight) return null;
    const up = window.innerHeight - r.bottom < 24 + items.length * 40;
    return { right: Math.max(8, window.innerWidth - r.right), ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) };
  };
  const isOpen = !!menu;
  useEffect(() => {
    if (!isOpen) return undefined;
    const follow = () => setMenu(place());
    const off = (e) => { if (!box.current?.contains(e.target)) setMenu(null); };
    window.addEventListener("scroll", follow, true); window.addEventListener("resize", follow);
    document.addEventListener("mousedown", off); document.addEventListener("touchstart", off);
    return () => { window.removeEventListener("scroll", follow, true); window.removeEventListener("resize", follow); document.removeEventListener("mousedown", off); document.removeEventListener("touchstart", off); };
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!items.length) return null;
  return (
    <span className="row-more" ref={box}>
      <button ref={dots} type="button" className="btn ghost sm row-dots" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={isOpen} onClick={() => setMenu(menu ? null : place())}>⋯</button>
      {menu && (
        <span className="arb-menu arb-menu-fixed row-menu" role="menu" style={menu}>
          {items.map((x) => (
            <button key={x.label} type="button" role="menuitem" className={x.className} title={x.title} disabled={x.disabled} {...(x.attrs || {})} onClick={() => { setMenu(null); x.onClick(); }}>{x.label}</button>
          ))}
        </span>
      )}
    </span>
  );
}

// The ISRC finder's guesses where it wasn't sure (up to 3, each with its cover, title, artist and where
// it came from): one tap saves that one
function IsrcPicks({ list, busy, onPick }) {
  return (
    <span className="isrc-picks" data-isrc-picks>
      <span className="hint">Is it one of these?</span>
      {list.map((c) => (
        <button key={`${c.isrc}:${c.source}`} type="button" className="isrc-pick" data-isrc-pick={c.isrc} disabled={busy} onClick={() => onPick(c)} title={`${c.isrc} · from ${ISRC_SOURCES[c.source] || c.source}`}>
          <span className="isrc-pick-cover">{c.cover ? <img src={c.cover} alt="" loading="lazy" /> : <Disc3 size={14} />}</span>
          <span className="isrc-pick-main"><b>{c.title}</b><em>{c.artist}{c.artist ? " · " : ""}{ISRC_SOURCES[c.source] || c.source}</em></span>
        </button>
      ))}
    </span>
  );
}

// Spotify stream history for the songs this session can see ({ [placementId]: growth }, the automated
// numbers). failed = it couldn't load (retry tries again); the song cards just go without.
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
    return () => { alive = false; };
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

// "+12K this week": this week's Spotify streams (the automated numbers), when there's a week of them
function GrowthChip({ g }) {
  if (!g || g.thisWeek == null || !(g.thisWeek > 0)) return null;
  return <span className="grow-chip" title={`${fmt(g.thisWeek)} Spotify streams${g.weekOf ? `, ${dayRange(g.weekOf.from, g.weekOf.to)}` : " this week"}`}>{compact(g.thisWeek)} this week</span>;
}

// What needs a person, across the whole company: a short headline each (t), an optional detail line
// under it (d), and the one place it's fixed ({ tab, sub } for onGo). Pure, so Publishing can count
// its own share (area "roster"). songInfo = null while each song's facts load: only what the db
// alone shows, until then. Every task has an area for its colour: roster | money | ar | clickup | site.
// the sheet-tab To do's names: tabs the last sync didn't find, only clients with songs (a brand-new
// client with no tab yet has no numbers to miss). Website › Roster marks the same clients.
const findTabClient = (db, n) => db.clients.find((x) => x.name === n || (x.sheetTabName || "").trim() === n);
const noTabNames = (db, songInfo) => (songInfo?.missingTabs || []).filter((n) => { const c = findTabClient(db, n); return !c || db.placements.some((p) => p.clientId === c.id); });
// Songs to update (build G2): every song the pub sheet or the site is missing something for, from what the
// last sheet pull read (db.sheetFacts, lib/sheet-facts.js). A split alone doesn't list a song (Splits to
// confirm has those); on a listed song its split shows as one more chip. Biggest streams first.
const GAP_WORDS = { share: "no writer share in the sheet", sheet: "not on the pub sheet", date: "no release date", link: "no link" };
function songsToUpdate(db, songInfo) {
  const facts = db.sheetFacts || { songs: {}, clients: {} };
  // a card in a possible duplicate pair is left out until the merge card is answered: Update and Save on the
  // card that would be removed adds a second row for the song to the pub sheet, and then the pair is never asked about
  const held = dupeIds(db, songInfo);
  // (r7) a blank share on the sheet with 100% here is To do's own "Fill in 100%" row, not a gap here
  const fillIds = new Set(shareFixesOf(db).sheet.map((x) => x.p.id));
  const out = [];
  for (const p of db.placements) {
    if (held.has(p.id)) continue;
    const split = splitTotal(p.splits) === 100 ? "ok" : evenSplit(p.splits).status;
    const gaps = songGaps({ p, fact: facts.songs?.[p.id], tabRead: facts.clients?.[p.clientId] != null, split }).filter((x) => !(x.k === "share" && fillIds.has(p.id)));
    if (!gaps.some((x) => GAP_WORDS[x.k])) continue;
    // a split to confirm or review is Splits to confirm's (build I3): listed here only for the other gaps, with a pointer
    out.push({ p, client: (db.clients || []).find((c) => c.id === p.clientId) || null, gaps: gaps.filter((x) => GAP_WORDS[x.k]), splitSee: gaps.some((x) => !GAP_WORDS[x.k]) });
  }
  return out.sort((a, b) => (b.p.streams || 0) - (a.p.streams || 0));
}
// Two cards that look like the same song (build H1, lib/duplicates.js): only once each song's facts are in (the ISRCs
// and the pairs staff marked "Not the same song" come with it), and only for clients whose tab the last pull read
function likelyDupes(db, songInfo) {
  if (!songInfo) return [];
  return likelyDuplicates(db.placements, { facts: db.sheetFacts || {}, isrcOf: (id) => songInfo.tracking?.[id]?.isrc || "", dismissed: songInfo.notDuplicates || [] })
    .map((x) => ({ ...x, client: (db.clients || []).find((c) => c.id === x.clientId) || null }));
}
// every card in a pair, both the kept one and the other: Songs to update and Splits to confirm leave them out
const dupeIds = (db, songInfo) => new Set(likelyDupes(db, songInfo).flatMap((x) => [x.keep.id, x.drop.id]));
// "TRUST WHO (Stack!e)": the To do and Publishing's line name the song once, without its version tags
const dupeName = (x) => `${plainTitle(x.keep.song) || "Untitled"} (${x.client?.name || "no client"})`;
const dupeWords = (list) => (list.length === 1 ? `Possible duplicate: ${dupeName(list[0])}` : `${list.length} possible duplicate songs`);
// the To do's detail (build I3): the gaps that matter for money first (no writer share, not on the sheet),
// then a missing date or link counted once per song; short words so it stays one line on a laptop
const UPDATE_WORDS_MAX = 60;
function updateWords(list) {
  const n = (f) => list.filter((x) => x.gaps.some(f)).length;
  const share = n((g) => g.k === "share"), sheet = n((g) => g.k === "sheet"), dl = n((g) => g.k === "date" || g.k === "link");
  const parts = [share && `${share} no writer share`, sheet && `${sheet} not on the sheet`, dl && `${dl} no date or link`].filter(Boolean);
  let out = parts[0] || "";
  for (const x of parts.slice(1)) if (`${out} · ${x}`.length <= UPDATE_WORDS_MAX) out = `${out} · ${x}`; else break;
  return out;
}
function dashTasks(db, songInfo) {
  // both groups of Splits to confirm, in plain words: the even default ready to confirm, and the ones to fix by hand
  const { assumed, look } = splitsToConfirm(db, songInfo);
  const nSplits = assumed.length + look.length;
  const splits = nSplits && {
    k: "splits", area: "roster", t: `${nSplits} song${nSplits === 1 ? "'s split needs" : "s' splits need"} confirming`,
    d: [assumed.length && `${assumed.length} assumed as an even split`, look.length && `${look.length} need${look.length === 1 ? "s" : ""} review`].filter(Boolean).join(" · "),
    tab: "catalog", sub: "splits", cta: "Review splits",
  };
  // one line for every song missing something on the sheet or the site (Publishing › Songs to update)
  const upd = songsToUpdate(db, songInfo);
  const update = upd.length > 0 && {
    k: "update", area: "roster", t: `${upd.length} song${upd.length === 1 ? " needs" : "s need"} updating`,
    d: updateWords(upd), tab: "catalog", sub: "update", cta: "Review",
  };
  const noTab = noTabNames(db, songInfo);
  const noTabOne = noTab.length === 1 ? findTabClient(db, noTab[0]) : null;
  const tabNames = noTab.length > 1 ? `${noTab.slice(0, -1).join(", ")} or ${noTab[noTab.length - 1]}` : noTab[0];
  if (!songInfo) return [splits, update].filter(Boolean);
  // one line for every pair of cards that look like the same song: Review opens the merge card
  const dupes = likelyDupes(db, songInfo);
  const dupe = dupes.length > 0 && {
    k: "dupes", area: "roster", t: dupeWords(dupes), d: dupes.length > 1 ? dupes.slice(0, 2).map(dupeName).join(" · ") : undefined,
    tab: "catalog", sub: "dupes", cta: "Review",
  };
  return [
    dupe,
    splits,
    update,
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
const weekWords = (r) => (r.unit === "listeners" ? `${fmt(r.thisWeek)} listeners` : `${fmt(r.thisWeek)} this week`);
function GainNum({ r }) {
  return r.ranked && r.wowPct != null
    ? <span className="gainer-num" data-wow={r.wowPct >= 0 ? "up" : "down"}><WowPill pct={r.wowPct} /><em>{weekWords(r)}</em></span>
    : <span className="gainer-num" data-wow="none"><em>{weekWords(r)}</em></span>;
}
function TopGainers({ db, onGo, arTop, arLoaded }) {
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
    : !rows.length && "Shows up once there's a week of daily Spotify numbers.";
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
        {span && <p className="gainer-sub">{dayRange(span.from, span.to)} · vs the week before · {isAR ? "Spotify monthly listeners" : "Spotify streams, global"}</p>}
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
const dashCache = {};
// sign-in and sign-out start clean (the same tab can sign in as someone else)
function clearDashCaches() { dashCache.home = null; dashCache.top = null; cuCache.d = null; syncCache.d = null; syncCache.at = 0; arPgCache.d = null; arPgCache.at = 0; }
function useHome() {
  const [home, setHome] = useState(() => dashCache.home || null);
  const [failed, setFailed] = useState(false);
  const loader = useRef(null);
  useEffect(() => {
    let alive = true;
    const load = (fresh = false) => { setFailed(false); return fetch(`/api/home${fresh ? "?fresh=1" : ""}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!alive) return; if (d?.money) { dashCache.home = d; setHome(d); } else setFailed(true); }).catch(() => alive && setFailed(true)); };
    loader.current = load;
    load();
    return () => { alive = false; };
  }, []);
  return { home, failed, retry: () => loader.current?.(), refresh: () => loader.current?.(true) };
}
const monthName = (ym) => (ym ? new Date(`${ym}-15T12:00:00`).toLocaleDateString(undefined, { month: "long" }) : "This month");

// A&R's counts (GET /api/ar?summary=1): follow-ups due, and Summary's top people for Home's This week. Loaded once by StaffDashboard for the A&R badge and the Dashboard's task,
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

// A card's calm line while /api/home is on its way, or when it couldn't load at all
function HomeWait({ failed, retry, what }) {
  return failed
    ? <p className="home-muted"><AlertTriangle size={15} /> <span>Couldn't load {what}. <button className="inline-link" onClick={retry}>Try again</button></span></p>
    : <p className="home-muted"><RefreshCw size={15} className="spin" /> Loading…</p>;
}

// "Nov", "Oct": this month and the one before, from the day the page is viewed
const monthShort = (offset) => { const d = new Date(); d.setDate(15); d.setMonth(d.getMonth() + offset); return d.toLocaleDateString("en-US", { month: "short" }); };
function MoneyRow({ money: m, failed, retry }) {
  if (!m || !m.connected || m.error) {
    return (
      <div className="home-money">
        <span className="cat-stat-label">This month ({monthShort(0)})</span>
        {!m ? <HomeWait failed={failed} retry={retry} what="the commission" />
          : !m.connected ? <p className="home-muted"><CircleDollarSign size={15} /> Connect Stripe to see your commission here.</p>
          : <p className="home-muted"><AlertTriangle size={15} /> {m.error}</p>}
      </div>
    );
  }
  // the months named from the day the page is viewed: "This month (Nov)", "Last month (Oct)" (Stripe: the (i))
  const stats = [["thisMonth", `This month (${monthShort(0)})`], ["lastMonth", `Last month (${monthShort(-1)})`], ["thisYear", "This year"]];
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
// the confirm's title follows the ticked rows (every row starts ticked, test payments too)
const logTitle = (n) => (n === 1 ? "Log this payment" : n === 0 ? "Log payments" : `Log ${n} payments`);
// details: {[id]: {type, client}}, the owner's own picks (Accounting › To log's Log with details);
// pay: the payment they're for, named above the row. onDetails(id): a skipped payment's Log with details.
function LogConfirm({ ids, canLog, onClose, onDone, details = null, pay = null, onDetails = null }) {
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
    post({ ids, dryRun: true, ...(details ? { details } : {}) }).then((d) => alive && setPlan(d));
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => { setBusy(true); const d = await post({ ids: ids.filter((id) => !off.has(id)), ...(details ? { details } : {}) }); setBusy(false); setDone(d); };
  const rowsN = plan?.rows?.length || 0;
  const n = (plan?.rows || []).filter((r) => !off.has(r.id)).length; // the ticked ones
  const tick = (id) => setOff((s) => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x; });
  // each skipped line names its payment ("Oct 6 · Payer · $X:"), and offers Log with details where that's the way
  const reasons = (list) => list?.length > 0 && <ul className="log-skipped">{list.map((x) => (
    <li key={x.id} data-skip={x.id}>{x.what && <strong>{x.what}: </strong>}{x.reason}
      {x.details && onDetails && !done && <> <button className="inline-link" data-skip-details={x.id} onClick={() => { onClose(); onDetails(x.id); }}>Log with details</button></>}</li>
  ))}</ul>;
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
        {pay && <p className="log-for" data-log-for>For the {shortDay(pay.at)} payment from {pay.client || pay.payer || "an unknown payer"}, {money(pay.amount)} paid.</p>}
        {rowsN > 0 && <p className="log-lead">{n === 0 ? "No rows are ticked, so nothing goes" : n === 1 ? "This row goes" : `These ${n} rows go`} on the Income tab, under its last row. The sheet works out the month, manager and shares, the same as a row typed by hand.{rowsN > 1 ? " Untick one to leave it out for now." : ""}</p>}
        {rowsN > 0 && (
          <div className="log-table" role="table" aria-label="Rows to add">
            <div className="log-tr log-th" role="row"><span role="columnheader">Date</span><span role="columnheader">Artist / Client</span><span role="columnheader">Revenue type</span><span role="columnheader" className="acct-amt">Gross commission</span></div>
            {plan.rows.map((r) => (
              <label key={r.id} className={off.has(r.id) ? "log-tr off" : "log-tr"} role="row" data-row={r.id}>
                <span role="cell" className="log-date"><input type="checkbox" checked={!off.has(r.id)} disabled={busy} onChange={() => tick(r.id)} aria-label={`Add ${r.client}, ${money(r.amount)}`} />{r.date}</span>
                <span role="cell" className="acct-who">{r.client || <span className="acct-blank">(blank)</span>}{r.test && <> <TestChip /></>}{r.notes ? <em> · {r.notes}</em> : null}</span><span role="cell">{r.type}</span><span role="cell" className="acct-amt">{money(r.amount)}</span>
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
        <div className="modal-head"><h3>{done ? "Logged" : logTitle(plan?.rows ? n : ids.length)}</h3><button onClick={close} aria-label="Close"><X size={18} /></button></div>
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

// Money (staff only, GET /api/accounting): Overview (the sheet's tiles and Stripe against the sheet
// month by month) and All payments. Its to-dos live in To do (r7), which shows this same component's
// part="log" (every payment the sheet doesn't have: Log all, Log it or Log with details; startLogAll
// opens the Log all preview at once) or part="check" (rows worth a look: Open row ↗ and Mark as OK).
// Nothing in the sheet is ever edited from here: problems are shown with a link to the row.
const ACCT_SECS = [["overview", "Overview"], ["payments", "All payments"]];
function AccountingAdmin({ sub, onSub, onCounts, part = null, startLogAll = false, chip = null, onGo }) {
  const sec = part || (ACCT_SECS.some(([k]) => k === sub) ? sub : "overview");
  const [d, setD] = useState(null);
  const [failed, setFailed] = useState(false);
  const [logIds, setLogIds] = useState(null); // Log it / Log all
  const [pick, setPick] = useState(null); // the payment Log with details is for
  const [detail, setDetail] = useState(null); // {ids, details, p}: the confirm after the picks
  const [okBusy, setOkBusy] = useState(null);
  const [okErr, setOkErr] = useState(null);
  const load = (fresh = false) => {
    setFailed(false);
    const got = (x) => { if (x?.connected !== undefined) { setD(x); if (x.counts) onCounts?.(x.counts); } else setFailed(true); };
    // the plain read is cached for the tab (drawn at once when Money opens again); a "fresh" read never is
    return (fresh ? fetch("/api/accounting?fresh=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(got)
      : swrJson("/api/accounting", got, { keep: (x) => x?.connected !== undefined }).then((x) => { if (x?.connected === undefined) setFailed(true); })).catch(() => setFailed(true));
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // To do's Log all: the preview of every payment Log it can place, as soon as they're read
  const started = useRef(false);
  useEffect(() => {
    if (!startLogAll || started.current || !d?.toLog?.items) return;
    started.current = true;
    const easy = d.toLog.items.filter((p) => !p.needsDetails);
    if (easy.length) setLogIds(easy.map((p) => p.id));
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  // the overview's "log them" / "see why" open those to-dos in To do
  const toSec = (k) => (k === "log" || k === "check" ? onGo?.("todo", k) : onSub?.(k === "overview" ? null : k));
  // a payment Log it skipped: straight to Log with details for it
  const pickById = (id) => { const p = d?.toLog?.items?.find((x) => x.id === id); if (p) setPick(p); };
  const markOk = async (key) => {
    setOkBusy(key); setOkErr(null);
    const r = await fetch("/api/accounting", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify({ ok: key }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) setOkErr(j.error || "Couldn't reach the server. Try again in a minute.");
    await load(true); setOkBusy(null);
  };
  let body;
  if (!d) body = failed ? <p className="home-muted"><AlertTriangle size={15} /> <span>Couldn't load the accounting numbers. <button className="inline-link" onClick={() => load()}>Try again</button></span></p>
    : <p className="home-muted"><RefreshCw size={15} className="spin" /> Loading…</p>;
  else if (!d.connected) body = <p className="home-muted">Accounting sheet: not connected yet. Once it's shared with the dashboard, this section fills in.</p>;
  else if (d.error) body = <p className="home-muted"><AlertTriangle size={15} /> {d.error}</p>;
  else if (sec === "overview") body = <AcctOverview d={d} onSec={toSec} />;
  else if (sec === "log") body = <AcctToLog d={d} onLog={setLogIds} onPick={setPick} />;
  else if (sec === "check") body = <AcctToCheck d={d} busy={okBusy} err={okErr} onOk={markOk} />;
  else body = !d.payments ? <p className="home-muted"><AlertTriangle size={15} /> {d.stripe?.error || "Stripe couldn't be read just now."}</p>
    : <div className="acct-panel" data-acct="payments"><p className="pay-legend">Green = Defied's share of each payment · {fmt(d.payments.total)} payments</p>{d.payments.items.map((p) => <PayRow key={p.id} p={p} onLog={(ids) => setLogIds(ids)} />)}</div>;
  const modals = (
    <>
      {logIds && <LogConfirm ids={logIds} canLog={!!d?.toLog?.canLog} onClose={() => setLogIds(null)} onDone={() => load(true)} onDetails={pickById} />}
      {pick && <LogDetails p={pick} options={d?.options} canLog={!!d?.toLog?.canLog} onClose={() => setPick(null)} onNext={(details) => { setPick(null); setDetail({ ids: [pick.id], details, p: pick }); }} />}
      {detail && <LogConfirm ids={detail.ids} details={detail.details} pay={detail.p} canLog={!!d?.toLog?.canLog} onClose={() => setDetail(null)} onDone={() => load(true)} />}
    </>
  );
  if (part) return <div className="acct-part" data-acct-part={part}>{body}{modals}</div>;
  return (
    <div className="acct-page">
      <div className="admin-head"><h2>Money</h2>{chip}{d?.readAt && <span className="home-src">Stripe and the {d.year} accounting sheet · read {clock(d.readAt)}</span>}
        {d?.sheetUrl && <ExtLink className="btn ghost sm acct-sheet-link" href={d.sheetUrl}>Open the sheet ↗</ExtLink>}</div>
      <div className="subnav" role="tablist" aria-label="Money">
        {ACCT_SECS.map(([k, l]) => <button key={k} role="tab" aria-selected={sec === k} data-acct-tab={k} className={sec === k ? "subpill active" : "subpill"} onClick={() => onSub(k === "overview" ? null : k)}>{l}</button>)}
      </div>
      {body}
      {modals}
    </div>
  );
}

// What's wrong first (one line: the year's gap, payments to log, rows to check), then the four balance
// tiles (the Money card's Accounting tab), then Stripe against the sheet by month with a This year row
const cents2 = (x) => Math.round(x * 100) / 100;
function AcctOverview({ d, onSec }) {
  const t = d.tiles, month = monthName(d.month), M = d.months;
  // a month with no rows yet says so, instead of "$0.00 in · $0.00 out" (list A 8)
  const monthEmpty = !t.monthRevenue && !t.monthExpenses;
  const stats = [["monthNet", `Net · ${month}`, monthEmpty ? "Nothing logged yet this month" : `${money(t.monthRevenue)} in · ${money(t.monthExpenses)} out`], ["yearNet", "Net this year"], ["checkingBalance", "Business Checking"], ["taxSetAside", "Tax set-aside (this quarter)"]];
  const latest = (d.payments?.items || []).slice(0, 5); // the newest payments, as records (Log it lives in To do and All payments)
  const yr = M && { stripe: cents2(M.reduce((a, m) => a + m.stripe, 0)), sheet: cents2(M.reduce((a, m) => a + m.sheet, 0)) };
  if (yr) yr.diff = cents2(yr.stripe - yr.sheet);
  const nLog = d.counts?.toLog || 0, nCheck = d.counts?.toCheck || 0;
  const partSum = (kind) => (M ? cents2(M.flatMap((m) => m.parts).filter((x) => x.kind === kind).reduce((a, x) => a + x.amount, 0)) : 0);
  const rounding = partSum("rounding");
  // co-managers' share of Stripe's fees (the Co-Management Cut): Stripe has it, the sheet books it on
  // its Stripe Fees tab, so it never makes the year look wrong
  const covered = partSum("covered");
  const coveredText = covered ? `${money(covered)} is co-managers' share of Stripe's fees (on the Stripe Fees tab)` : "";
  const checkRow = new Set((d.toCheck?.items || []).map((x) => x.row).filter(Boolean)); // rows with an open To check line
  const diffText = (v) => (v ? money(v).replace("$-", "-$") : "—");
  const clean = yr && !cents2(yr.diff - covered) && !nLog && !nCheck;
  const fold = foldMonths(M || [], { current: d.month });
  const [unfold, setUnfold] = useState(false); // the matching months' own rows, opened from the fold line
  const monthRow = (m) => (
    <div key={m.month} className="acct-mrow" role="row" data-month={m.month} data-explained={m.explained ? "1" : "0"}>
      <span role="cell" className="acct-mname">{m.label}</span>
      <span role="cell" className="acct-amt" data-col="stripe">{money(m.stripe)}</span>
      <span role="cell" className="acct-amt" data-col="sheet">{money(m.sheet)}</span>
      <span role="cell" className={m.diff ? "acct-amt acct-diff" : "acct-amt"} data-col="diff">{diffText(m.diff)}</span>
      <span role="cell" className="acct-why" data-col="why">
        {!m.diff && !m.parts.length ? <span className="acct-match"><CheckCircle2 size={14} /> Matches</span> : (
          <>{m.parts.map((x, i) => (
            <React.Fragment key={i}>{i ? " · " : ""}<span className={x.kind === "rounding" || x.kind === "covered" ? "acct-round" : undefined} data-part={x.kind}>{x.text}</span>
              {x.kind === "unlogged" && <> (<button className="inline-link" data-part-log onClick={() => onSec("log")}>log them</button>)</>}
              {(x.kind === "share" || x.kind === "extra") && x.url && <> (<ExtLink className="inline-link" href={x.url}>open row ↗</ExtLink>{checkRow.has(x.row) && <>, <button className="inline-link" onClick={() => onSec("check")}>see To check</button></>})</>}
            </React.Fragment>
          ))}
            {!m.explained && <>{m.parts.length ? " · " : ""}<span className="acct-unexplained">Not explained yet: {money(Math.abs(m.residual))} · <button className="inline-link" onClick={() => onSec("check")}>see To check</button></span></>}</>
        )}
      </span>
    </div>
  );
  return (
    <>
      {yr && (
        <p className={clean ? "acct-status ok" : "acct-status"} data-acct-status>
          {clean ? <><CheckCircle2 size={15} /> <span>Stripe and the sheet match for {d.year}{covered ? <span className="acct-round" data-status-covered> · {coveredText}</span> : null}.</span></> : (
            <><AlertTriangle size={15} /> <span>{yr.diff ? `${money(Math.abs(yr.diff))} apart for ${d.year}` : `Stripe and the sheet add up the same for ${d.year}`}
              {nLog > 0 && <>: {nLog === 1 ? "1 payment" : `${nLog} payments`} to log (<button className="inline-link" data-status-log onClick={() => onSec("log")}>log {nLog === 1 ? "it" : "them"}</button>)</>}
              {nCheck > 0 && <>{nLog ? " · " : ": "}{nCheck === 1 ? "1 row" : `${nCheck} rows`} to check (<button className="inline-link" data-status-check onClick={() => onSec("check")}>see why</button>)</>}
              {rounding ? <span className="acct-round">{nLog || nCheck ? " · " : ": "}{money(Math.abs(rounding))} is rounding</span> : null}
              {covered ? <span className="acct-round" data-status-covered>{nLog || nCheck || rounding ? " · " : ": "}{coveredText}</span> : null}.</span></>
          )}
        </p>
      )}
      <div className="cat-summary-grid acct-grid acct-tiles">
        {stats.map(([k, label, note]) => <div key={k} className="cat-stat" data-stat={k} data-empty={k === "monthNet" && monthEmpty ? "" : undefined}><span className="cat-stat-label">{label}</span><span className="cat-stat-val">{money(t[k])}</span>{note && <span className="acct-note">{note}</span>}</div>)}
      </div>
      <div className="fix-panel acct-panel" data-acct="months">
        <div className="fix-head"><h3>Stripe and the sheet, month by month</h3>
          <span className="hint">Defied's share: through Stripe, and on the Income tab by each row's date.</span></div>
        {!M ? <p className="home-muted"><AlertTriangle size={15} /> Stripe couldn't be read just now, so the months can't be compared.</p> : (
          <div className="acct-mtable" role="table" aria-label="Stripe and the sheet by month">
            <div className="acct-mrow acct-mhead" role="row"><span role="columnheader">Month</span><span role="columnheader" className="acct-amt">Through Stripe</span><span role="columnheader" className="acct-amt">In the sheet</span><span role="columnheader" className="acct-amt">Difference</span><span role="columnheader">Why</span></div>
            {/* only the months that differ get a row; the ones that match fold into one line (r7), which opens
                their own rows in place (r8: rarely needed, so behind the line) */}
            {fold.differ.map(monthRow)}
            {fold.matched > 0 && (
              <div className="acct-mrow acct-mfold" role="row">
                <span role="cell" className="acct-match" data-folded={fold.matched}><CheckCircle2 size={14} /> {fold.text}</span>
                <button type="button" className="inline-link acct-unfold" data-unfold aria-expanded={unfold} onClick={() => setUnfold((x) => !x)}>{unfold ? "Hide them" : `Show ${fold.matched === 1 ? "it" : `the ${fold.matched}`}`}</button>
              </div>
            )}
            {fold.quiet.length > 0 && <div className="acct-mrow acct-mfold acct-mquiet" role="row" data-quiet={fold.quiet.join(",")}><span role="cell" className="acct-round">{fold.quiet.join(", ")}: nothing yet</span></div>}
            {unfold && fold.rows.map(monthRow)}
            <div className="acct-mrow acct-mtotal" role="row" data-total="year">
              <span role="cell" className="acct-mname">This year</span>
              <span role="cell" className="acct-amt" data-col="stripe">{money(yr.stripe)}</span>
              <span role="cell" className="acct-amt" data-col="sheet">{money(yr.sheet)}</span>
              <span role="cell" className={yr.diff ? "acct-amt acct-diff" : "acct-amt"} data-col="diff">{diffText(yr.diff)}</span>
              <span role="cell" className="acct-why" data-col="why">{!yr.diff ? <span className="acct-match"><CheckCircle2 size={14} /> Matches</span> : "The months above explain it."}</span>
            </div>
          </div>
        )}
      </div>
      {latest.length > 0 && (
        <div className="fix-panel acct-panel acct-latest" data-acct="latest">
          <div className="fix-head"><h3>Latest payments</h3>
            <button className="inline-link acct-all" data-acct-all onClick={() => onSec("payments")}>All payments ({fmt(d.payments.total)}) ›</button></div>
          {latest.map((p) => <PayRow key={p.id} p={p} />)}
        </div>
      )}
    </>
  );
}

// Every payment the sheet doesn't have: Log it (the dashboard places it) or Log with details (the
// owner picks the Revenue Type and Artist / Client: studio work, a payer not on INFO, a first payment)
function AcctToLog({ d, onLog, onPick }) {
  const U = d.toLog?.items;
  if (!U) return <p className="home-muted"><AlertTriangle size={15} /> Stripe couldn't be read just now, so the payments missing from the sheet can't be checked.</p>;
  if (!U.length) return <p className="home-muted acct-clear"><CheckCircle2 size={15} /> Every Stripe payment is in the accounting sheet.</p>;
  // Log all takes only the ones Log it can place; the rest wait for Log with details
  const easy = U.filter((p) => !p.needsDetails), need = U.length - easy.length;
  return (
    <div className="fix-panel acct-panel" data-acct="log">
      <div className="fix-head"><h3>To log ({U.length})</h3>
        <span className="hint">{d.toLog.canLog ? "Log it shows the row, then adds it to the Income tab. Log with details is for studio work or a payer not on INFO." : "Logging from here isn't switched on yet. Add each one to the sheet as a new row with the full amount paid."}</span></div>
      <div className="fix-sub"><span className="fix-client">{money(d.toLog.total)} paid in total{need ? <span className="acct-via"> · {need} {need === 1 ? "needs" : "need"} details</span> : null}</span>
        {easy.length > 1 && <button className="btn sm" data-log-all onClick={() => onLog(easy.map((p) => p.id))}>Log all {easy.length}</button>}</div>
      {U.map((p) => (
        <div key={p.id} className="fix-row acct-lrow" data-pay={p.id}>
          <span className="fix-song"><span className="fix-who">{shortDay(p.at)} · </span>{p.client || p.payer || "Unknown payer"}{p.test && <> <TestChip /></>}<span className="acct-via"> · {viaText(p)}</span></span>
          <span className="fix-streams acct-paid">{money(p.amount)}</span>
          <span className="fix-acts">
            {/* Log it can't place this one (the server's own check): only Log with details, and why */}
            {p.needsDetails ? <span className="acct-need" data-needs-details={p.id} title={p.needsDetails}>Needs details</span>
              : <button className="btn sm" data-log={p.id} onClick={() => onLog([p.id])}>Log it</button>}
            <button className={p.needsDetails ? "btn sm" : "btn ghost sm"} data-log-details={p.id} onClick={() => onPick(p)}>Log with details</button>
          </span>
        </div>
      ))}
    </div>
  );
}

// Log with details: the Revenue Type (the Income tab's own list) and Artist / Client (INFO's list, or
// blank like the Other Income rows), then the same confirm, claim and read-back as Log it
function LogDetails({ p, options, canLog, onClose, onNext }) {
  const types = options?.types || [], clients = options?.clients || [];
  // a payer who is a client on INFO (Stripe's "Reallyindig0" is INFO's "reallyindig0"): their commission goes
  // in as Management Commission with INFO's spelling, so both start picked
  const onInfo = clients.find((c) => c.toLowerCase() === String(p.client || p.payer || "").trim().toLowerCase());
  const [type, setType] = useState(onInfo && types.includes("Management Commission") ? "Management Commission"
    : types.includes("Other Income") && !p.client ? "Other Income" : types[0] || "");
  const [client, setClient] = useState(onInfo || "");
  const need = type === "Management Commission" && !client;
  const offInfo = onInfo && (type !== "Management Commission" || !client);
  return (
    <AskCard title="Log with details" goLabel="Check the row" plain goDisabled={need || !type} onClose={onClose} go={() => { if (!need && type) onNext({ [p.id]: { type, client } }); }}>
      <p>{shortDay(p.at)} · {p.client || p.payer || "Unknown payer"} · {money(p.amount)} paid. The full amount goes in Gross Commission; the sheet works out the shares.</p>
      {!canLog && <p className="hint">Logging from the dashboard isn't switched on yet, so the next step only says so.</p>}
      <label className="fld"><span>Revenue Type</span>
        <select data-pick-type value={type} onChange={(e) => setType(e.target.value)}>{types.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
      <label className="fld"><span>Artist / Client</span>
        <select data-pick-client value={client} onChange={(e) => setClient(e.target.value)}><option value="">(blank, as on Other Income rows)</option>{clients.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      {need ? <p className="hint warn-text" data-pick-need>A Management Commission row needs an Artist / Client.</p>
        : offInfo && <p className="hint warn-text" data-pick-info>{onInfo} is a client on INFO: commission payments are Management Commission, with {onInfo} as Artist / Client.</p>}
    </AskCard>
  );
}

// To check: rows worth a look, each one sentence, Open row ↗ and Mark as OK (it comes back only if the row changes)
function AcctToCheck({ d, busy, err, onOk }) {
  const X = d.toCheck?.items || [];
  return (
    <div className="fix-panel acct-panel" data-acct="check">
      <div className="fix-head"><h3>{X.length ? `To check (${X.length})` : "To check"}</h3>
        <span className="hint">Read only. Fix it in the sheet, or mark it as OK.{d.toCheck?.okCount ? ` ${d.toCheck.okCount} marked as OK.` : ""}</span></div>
      {err && <p className="hint err-text">{err}</p>}
      {!X.length ? <p className="home-muted acct-clear"><CheckCircle2 size={15} /> Nothing to check in the Income tab.</p> : X.map((x) => (
        <div key={x.key} className="fix-row acct-crow" data-check={x.rule} data-row={x.row ?? ""}>
          <span className="fix-song acct-ctext"><span className="fix-who">{x.row ? `Row ${x.row} · ` : ""}</span>{x.text}</span>
          <span className="fix-acts">
            <ExtLink className="btn ghost sm" href={x.url}>{x.row ? "Open row ↗" : "Open the sheet ↗"}</ExtLink>
            <button className="quiet-act" data-ok={x.key} disabled={busy === x.key} onClick={() => onOk(x.key)}>{busy === x.key ? "Saving…" : "Mark as OK"}</button>
          </span>
        </div>
      ))}
    </div>
  );
}

// The phone tab bar's "More": Numbers and Site in a small menu above the bar (To do always stays in the
// bar, with the one count). Hidden on desktop, where the sidebar lists every section.
const PHONE_MORE = new Set(["numbers", "site"]);
function NavMore({ tabs, tab, badge, setTab }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const here = tabs.some(([id]) => id === tab);
  return (
    <div className="nav-more" ref={box}>
      <button type="button" className={here ? "active" : ""} aria-haspopup="menu" aria-expanded={open} data-nav-more onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal size={17} /> <span className="nav-label">More</span>
        {!!badge && <span className="nav-badge">{badge}</span>}
      </button>
      {open && (
        <div className="nav-more-menu" role="menu">
          {tabs.map(([id, label, Icon, n]) => (
            <button key={id} role="menuitem" className={tab === id ? "active" : ""} onClick={() => { setOpen(false); setTab(id); }}>
              <Icon size={17} /> <span>{label}</span>{!!n && <span className="nav-badge">{n}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* staff: To do (r7) — every to-do from every area, finished where it's listed ------------------ */
// ClickUp's open tasks on the dashboard's eight lists (GET /api/tasks), kept while the app is open and
// read again whenever Home or To do opens. Done ✓ takes a task off at once; a failed write puts it back.
const cuCache = { d: null };
function useCuTasks(tab) {
  const [data, setData] = useState(() => cuCache.d);
  const [failed, setFailed] = useState(false);
  const load = (fresh = false) => {
    setFailed(false);
    return fetch(`/api/tasks${fresh ? "?fresh=1" : ""}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.lists) { cuCache.d = d; setData(d); } else setFailed(true); }).catch(() => setFailed(true));
  };
  useEffect(() => { if (tab === "home" || tab === "todo" || !cuCache.d) load(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const drop = (id) => setData((d) => (d ? { ...d, tasks: d.tasks.filter((t) => t.id !== id) } : d));
  const add = (t) => setData((d) => (d ? { ...d, tasks: [...d.tasks, t] } : d));
  return { data, failed, load, drop, add };
}
// The Sync view's checks (GET /api/sync): Home's pill, To do's sync rows and Site › Sync. They read
// the sheets and Stripe, so a fresh answer is kept for two minutes.
const syncCache = { d: null, at: 0 };
function useSyncChecks(tab) {
  const [data, setData] = useState(() => syncCache.d);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = (force = false) => {
    if (!force && syncCache.d && Date.now() - syncCache.at < 120000) { setData(syncCache.d); return Promise.resolve(); }
    setFailed(false); setBusy(true);
    return fetch("/api/sync", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.checks) { syncCache.d = d; syncCache.at = Date.now(); setData(d); } else setFailed(true); }).catch(() => setFailed(true)).finally(() => setBusy(false));
  };
  // (any tab's first load reads them too: the sidebar's count and each tab's chip include the amber ones)
  useEffect(() => { if (tab === "home" || tab === "todo" || tab === "site" || !syncCache.d) load(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, failed, busy, load };
}

// Every to-do the dashboard knows about, from every area, as To do's rows: one sentence (t), at most
// one short detail (d), one button (cta), the panel it opens in place (panel), and its weight for
// Home's biggest tasks (rank, lib/todo-rank.js). tap = the button finishes it (after the preview the
// panel shows); the rest need a person. The Publishing rows are dashTasks' (the same words);
// lib/area-tasks.js keeps ClickUp's area tasks to the same list. seeds: what the old Luminate
// portfolios' starting list still needs (list B #3), one row per area.
const SYNC_ROWS = { pubSheet: ["roster", "Pull from the sheet"], info: ["money", "Review"] };
function todoItems({ db, songInfo, acct, ar, sync, seeds }) {
  const out = [];
  const nLog = acct?.toLog || 0, nCheck = acct?.toCheck || 0;
  // the test payments among them said once (they still count): "1 of them is a $2.00 test payment."
  const tN = acct?.toLogTests?.n || 0, tSum = acct?.toLogTests?.total || 0;
  const testD = !tN ? null : nLog === 1 ? `It's a ${money(tSum)} test payment.` : tN === 1 ? `1 of them is a ${money(tSum)} test payment.` : `${tN} of them are test payments (${money(tSum)}).`;
  if (nLog) out.push({ k: "log", area: "money", tap: true, t: `${nLog} payment${nLog === 1 ? "" : "s"} to log`, d: testD || (acct.toLogTotal ? `${money(acct.toLogTotal)} paid, not in the Income tab yet` : undefined),
    cta: nLog === 1 ? "Log it" : `Log all ${nLog}`, panel: "log", rank: { kind: "money", value: acct.toLogTotal || nLog } });
  if (nCheck) out.push({ k: "check", area: "money", t: `${nCheck} row${nCheck === 1 ? "" : "s"} in the Income tab to check`, cta: "Review", panel: "check", rank: { kind: "money", value: 0 } });
  const streams = (ps) => ps.reduce((a, p) => a + (p.streams || 0), 0);
  for (const it of dashTasks(db, songInfo)) {
    const base = { k: it.k, area: it.area, t: it.t, d: it.d, cta: it.cta };
    if (it.k === "dupes") out.push({ ...base, tap: true, cta: "Merge", panel: "dupes", rank: { kind: "fix", value: 0 } });
    else if (it.k === "splits") out.push({ ...base, panel: "splits", rank: { kind: "fix", value: streams(splitsToConfirm(db, songInfo).all.map((x) => x.p)) } });
    else if (it.k === "update") out.push({ ...base, panel: "update", rank: { kind: "fix", value: streams(songsToUpdate(db, songInfo).map((x) => x.p)) } });
    else if (it.k === "tabs") out.push({ ...base, d: "The pub sheet has no tab by that name. Type the right one here.", cta: it.sub === "roster" ? "Set the sheet tabs" : it.cta, panel: "tabs", rank: { kind: "other" } });
  }
  // (r7) the shares with one clear answer: One tap, each with its preview first (ShareFix)
  const fx = shareFixesOf(db);
  const few = (xs) => (xs.length > 3 ? `${xs.slice(0, 2).map((x) => x.p.song || "Untitled").join(", ")} and ${xs.length - 2} more` : xs.map((x) => `${x.p.song || "Untitled"} (${x.client.name})`).join(", "));
  if (fx.site.length) out.push({ k: "shareSite", area: "roster", tap: true, t: fx.site.length === 1 ? `"${fx.site[0].p.song || "Untitled"}" has no split here; the sheet has 100%` : `${fx.site.length} songs have no split here; the sheet has 100%`,
    d: fx.site.length > 1 ? few(fx.site) : `${fx.site[0].client.name}'s tab`, cta: "Use the sheet's split", panel: "shareSite", rank: { kind: "fix", value: streams(fx.site.map((x) => x.p)) } });
  if (fx.sheet.length) out.push({ k: "shareSheet", area: "roster", tap: true, t: fx.sheet.length === 1 ? `"${fx.sheet[0].p.song || "Untitled"}" has a blank share on the sheet` : `${fx.sheet.length} songs have a blank share on the sheet`,
    d: "100% here. A blank share earns nothing on the sheet.", cta: fx.sheet.length === 1 ? "Fill in 100%" : `Fill in ${fx.sheet.length}`, panel: "shareSheet", rank: { kind: "fix", value: streams(fx.sheet.map((x) => x.p)) } });
  const due = ar?.followUpsDue || 0;
  if (due) out.push({ k: "follow", area: "ar", t: `${due} A&R follow-up${due === 1 ? "" : "s"} due`, cta: "Review", panel: "follow", rank: { kind: "contacts", value: due } });
  // the old Luminate portfolios' songs and artists not tracked yet (list B #3): one row per area, each
  // one finished in the list it opens (Yes to a match, a pasted Spotify link, Not on Spotify)
  for (const [area, one, many] of [["roster", "Admin Catalog song", "Admin Catalog songs"], ["ar", "Artist or Song Tracker row", "Artist and Song Tracker rows"]]) {
    const list = (seeds?.todo || []).filter((r) => r.area === area);
    if (!list.length) continue;
    const check = list.filter((r) => r.status === "check").length, find = list.length - check;
    out.push({ k: `seeds:${area}`, area, t: `${list.length} old Luminate ${list.length === 1 ? one : many} to find on Spotify`,
      d: [check && `${check} ${check === 1 ? "match" : "matches"} to check`, find && `${find} to find`].filter(Boolean).join(" · "), cta: check ? "Check" : "Find", panel: "seeds", seedArea: area, rank: { kind: "fix", value: 0 } });
  }
  const unread = (db.submissions || []).filter((x) => !x.read).length;
  if (unread) out.push({ k: "messages", area: "site", t: `${unread} new website message${unread === 1 ? "" : "s"}`, cta: "Read", panel: "messages", rank: { kind: "other" } });
  // the sync checks that aren't a row already (Stripe = payments to log, ClickUp = its tasks)
  for (const c of sync?.checks || []) {
    if (c.ok !== false || !SYNC_ROWS[c.id]) continue;
    const [area, cta] = SYNC_ROWS[c.id];
    out.push({ k: `sync:${c.id}`, area, tap: c.fix?.kind === "pull", t: c.text.replace(/\.$/, ""), cta, panel: "syncfix", check: c, rank: { kind: "sync" } });
  }
  return out;
}

// One To do row: the sentence opens it, the button does its one thing; open, the panel below holds
// exactly the controls it needs (the same ones the tabs used to hold). Home's biggest tasks use it too.
// (a One tap row's button goes straight to its preview, "Log all 4" to the log preview; the sentence, or a
// link to the item, opens the list behind it)
function TodoRow({ it, open, onToggle, ctx }) {
  const [viaCta, setViaCta] = useState(false);
  return (
    <div className={open ? "todo-item open" : "todo-item"} data-item={it.k} data-area={it.area}>
      <div className="attn-row" data-task={it.k} data-area={it.area}>
        <button type="button" className="attn-main todo-open" aria-expanded={open} onClick={() => { setViaCta(false); onToggle(); }}>
          <b>{it.t}</b>{it.d && <em>{it.d}</em>}
        </button>
        <button type="button" className={it.tap && !open ? "btn sm" : "btn ghost sm"} data-cta={it.k} onClick={() => { setViaCta(!open && !!it.tap); onToggle(); }}>{open ? "Close" : it.cta}</button>
      </div>
      {open && <div className="todo-panel" data-panel={it.k}><TodoPanel it={it} ctx={ctx} onClose={onToggle} viaCta={viaCta} /></div>}
    </div>
  );
}
function TodoPanel({ it, ctx, onClose, viaCta = false }) {
  const { db, commit, onGo } = ctx;
  switch (it.panel) {
    case "splits": case "update": case "dupes": return <PubFix kind={it.panel} ctx={ctx} viaCta={viaCta} />;
    case "shareSite": case "shareSheet": return <ShareFix kind={it.panel} ctx={ctx} viaCta={viaCta} />;
    case "tabs": return <SheetTabFix ctx={ctx} />;
    case "log": case "check": return <AccountingAdmin part={it.panel} startLogAll={it.panel === "log" && viaCta} onCounts={(c) => ctx.setAcct((x) => ({ ...x, ...c }))} onGo={onGo} />;
    case "follow": return <ArFollowUps ctx={ctx} />;
    case "seeds": return <SeedList area={it.seedArea} ctx={ctx} />;
    case "messages": return <SubsAdmin db={db} commit={commit} />;
    case "syncfix": return <SyncFix check={it.check} ctx={ctx} />;
    default: return null;
  }
}

// Publishing's lists in place: Splits to confirm, Songs to update and the merge card. Fix / Update open
// the song's editor right here (SongManager's own editor, nothing else of the client's page)
// (Merge, the row's button, opens the merge card at once; the sentence or a link shows the line with Review)
function PubFix({ kind, ctx, viaCta = false }) {
  const { db, commit, songInfo, reloadSongInfo, onGo } = ctx;
  const dupes = useMemo(() => likelyDupes(db, songInfo), [db, songInfo]);
  const [edit, setEdit] = useState(null);
  const n = useRef(0);
  const openFix = (id, field = null) => { const p = db.placements.find((x) => x.id === id); if (p) setEdit({ id, field, n: ++n.current, clientId: p.clientId }); };
  const [dupeKey, setDupeKey] = useState(() => (kind === "dupes" && viaCta ? dupes[0]?.key || null : null));
  const [note, setNote] = useState(null);
  const dupeOpen = dupeKey && dupes.find((x) => x.key === dupeKey);
  const openDupe = () => { setNote(null); setDupeKey(dupes[0]?.key || null); };
  return (
    <>
      {kind === "splits" && <SplitsToFix db={db} commit={commit} songInfo={songInfo} reloadSongInfo={reloadSongInfo} onFix={openFix} onGo={onGo} dupes={dupes} onDupe={openDupe} />}
      {kind === "update" && <SongsToUpdate db={db} songInfo={songInfo} onFix={openFix} dupes={dupes} onDupe={openDupe} />}
      {kind === "dupes" && (dupes.length
        ? <p className="pub-tasks dupe-line" data-dupe-line>{dupeWords(dupes)} · <button className="inline-link" data-dupe-review onClick={openDupe}>Review</button></p>
        : <p className="home-muted acct-clear"><CheckCircle2 size={15} /> No possible duplicates left.</p>)}
      <DropNote note={note} />
      {/* a merge can clear the row this sits in: its result goes on To do's own line (ctx.flash) when there is one */}
      {dupeOpen && <DupeMerge db={db} commit={commit} songInfo={songInfo} reloadSongInfo={reloadSongInfo} pair={dupeOpen} onClose={() => setDupeKey(null)} onDone={(r) => { setDupeKey(null); if (ctx.flash) ctx.flash(r); else setNote(r); }} />}
      {edit && <SongManager editorOnly db={db} commit={commit} clientId={edit.clientId} isStaff songInfo={songInfo} reloadSongInfo={reloadSongInfo} fix={{ id: edit.id, n: edit.n, field: edit.field }} onFix={openFix} onFixList={() => setEdit(null)} onGo={onGo} />}
    </>
  );
}

// The two shares with one clear answer (lib/split-fixes.js), each One tap with its preview first:
//   shareSite  no split here while the sheet has 100%: the client at 100% on the site (DB only; the sheet has it)
//   shareSheet 100% here while the sheet's Writer Share is blank (it earns nothing there): 100% goes into that one
//              cell (PUB_SHARE_WRITES; off, the card says which cells to type it in)
function ShareFix({ kind, ctx, viaCta = false }) {
  const { db, commit, fixes } = ctx;
  const fx = useMemo(() => shareFixesOf(db), [db]);
  const items = kind === "shareSite" ? fx.site : fx.sheet;
  const [ask, setAsk] = useState(viaCta && items.length > 0);
  const tabOf = (c) => c.sheetTabName?.trim() || c.name;
  const writes = !!fixes?.data?.writes;
  const flash = (n) => (ctx.flash ? ctx.flash(n) : null);
  const useSheet = async () => {
    const by = new Map(items.map((x) => [x.p.id, x.splits]));
    const done = await commit({ ...db, placements: db.placements.map((p) => (by.has(p.id) ? { ...p, splits: by.get(p.id) } : p)) });
    setAsk(false);
    if (done) flash({ text: `Done. ${items.length === 1 ? `"${items[0].p.song || "Untitled"}" has` : `${items.length} songs have`} the sheet's split now (100%). Nothing was written to the sheet.` });
  };
  const fill = async () => {
    const ok = [], bad = [];
    for (const x of items) { // one at a time, each re-checked on the server just before its cell is written
      const r = await fetch("/api/split-fixes", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify({ action: "fill", placementId: x.p.id }) }).catch(() => null);
      const j = r ? await r.json().catch(() => ({})) : {};
      if (r?.ok) ok.push(`${j.tab} ${j.cell}`); else bad.push(`"${x.p.song || "Untitled"}": ${j.error || "no answer"}`);
    }
    setAsk(false);
    // the sheet's new earnings come back with a pull (it reads every tab again, as Pull from the sheet does)
    if (ok.length) await fullSiteSync(db, commit).catch(() => {});
    flash({ warn: !!bad.length, text: [ok.length && `Filled in 100% on the sheet (${ok.join(", ")}).`, bad.length && `Not written: ${bad.join("; ")}.`].filter(Boolean).join(" ") });
  };
  const cells = items.map((x) => `${tabOf(x.client)} tab, D${x.row}`);
  return (
    <div className="todo-sublist" data-share-fix={kind}>
      {items.map((x) => (
        <div key={x.p.id} className="fix-row" data-song={x.p.id}>
          <span className="fix-song"><span className="fix-who">{x.client.name} · </span>{x.p.song || "Untitled"}</span>
          <span className="fix-mid"><span className="fix-sheet" data-sheet-change={kind}>{kind === "shareSite" ? `no split here → ${x.client.name} 100%, as on the sheet` : `sheet blank (D${x.row}) → 100%, as here`}</span></span>
        </div>
      ))}
      {!items.length ? <p className="home-muted acct-clear"><CheckCircle2 size={15} /> Every share matches the sheet.</p>
        : <button className="btn sm" data-share-go={kind} onClick={() => setAsk(true)}>{kind === "shareSite" ? "Use the sheet's split" : items.length === 1 ? "Fill in 100%" : `Fill in ${items.length}`}</button>}
      {ask && kind === "shareSite" && (
        <AskCard title={items.length === 1 ? "Use the sheet's split?" : `Use the sheet's split for ${items.length} songs?`} goLabel="Use the sheet's split" busyLabel="Saving…" plain go={useSheet} onClose={() => setAsk(false)}>
          <p data-ask-writes>Saved on the site only. The sheet already says 100%, so nothing is written to it.</p>
          <ul className="ask-places">{items.map((x) => <li key={x.p.id}>{x.p.song || "Untitled"}: no split → {x.client.name} 100%</li>)}</ul>
        </AskCard>
      )}
      {ask && kind === "shareSheet" && (
        <AskCard title={items.length === 1 ? "Fill in the sheet's blank share?" : `Fill in ${items.length} blank shares?`} goLabel={items.length === 1 ? "Fill in 100%" : `Fill in ${items.length}`} busyLabel="Writing…" plain goDisabled={!writes} go={fill} onClose={() => setAsk(false)}>
          <p data-ask-writes>Writes 100% into the Writer Share cell only ({cells.join("; ")}). Nothing else on the sheet changes. The song's earnings on the sheet go up with it.</p>
          <ul className="ask-places">{items.map((x) => <li key={x.p.id}>{x.p.song || "Untitled"} ({x.client.name}): blank → 100%</li>)}</ul>
          {!writes && <p className="hint" data-ask-off>Writing to the pub sheet from here isn't switched on yet. Type 100% into {cells.length === 1 ? "that cell" : "those cells"} instead.{fixes?.data?.sheetUrl && <> <ExtLink className="inline-link" href={fixes.data.sheetUrl}>Open the sheet ↗</ExtLink></>}</p>}
        </AskCard>
      )}
    </div>
  );
}

// rule 5: an assumed even split whose client share already is the sheet's is confirmed by itself (DB only, no
// sheet write) and said once in "Done for you" with Undo. Undo puts the old split back and it's never confirmed by
// itself again (it's back in Splits to confirm). fixes = useSplitFixes()
async function splitFixPost(body) {
  const r = await fetch("/api/split-fixes", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify(body) }).catch(() => null);
  return r?.ok ? r.json().catch(() => ({})) : null;
}
function useSplitFixes() {
  const [data, setData] = useState(null);
  const load = () => fetch("/api/split-fixes", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => d?.auto && setData(d)).catch(() => {});
  useEffect(() => { load(); }, []);
  return { data, setData, load };
}
const AUTO_DAYS = 7; // how long "Done for you" names what was confirmed by itself
const sameSplits = (a, b) => JSON.stringify((a || []).map((s) => [s.name || "", Number(s.percent) || 0])) === JSON.stringify((b || []).map((s) => [s.name || "", Number(s.percent) || 0]));
function useAutoConfirm({ db, commit, songInfo, fixes }) {
  const tried = useRef("");
  useEffect(() => {
    if (!fixes.data || !songInfo || !db?.sheetFacts) return;
    const items = autoConfirms({ placements: db.placements, clients: db.clients, facts: db.sheetFacts, held: fixes.data.auto.held, skip: dupeIds(db, songInfo) });
    const key = items.map((x) => x.p.id).sort().join(",");
    if (!items.length || tried.current === key) return;
    tried.current = key;
    const by = new Map(items.map((x) => [x.p.id, x.after]));
    commit({ ...db, placements: db.placements.map((p) => (by.has(p.id) ? { ...p, splits: by.get(p.id) } : p)) }, undefined, { quiet: true })
      .then((saved) => saved && splitFixPost({ action: "auto", items: items.map((x) => ({ id: x.p.id, song: x.p.song, client: x.client.name, before: x.before, after: x.after })) }))
      .then(() => fixes.load()).catch(() => {});
  }, [db, songInfo, fixes.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const since = Date.now() - AUTO_DAYS * 864e5;
  const recent = (fixes.data?.auto?.done || []).filter((d) => Date.parse(d.at) > since);
  const undo = async () => {
    const ids = recent.map((d) => d.id);
    // held first, so the split put back isn't confirmed again on the next render
    fixes.setData((x) => x && { ...x, auto: { done: x.auto.done.filter((d) => !ids.includes(d.id)), held: [...new Set([...x.auto.held, ...ids])] } });
    await splitFixPost({ action: "undo", ids });
    const cur = new Map(db.placements.map((p) => [p.id, p]));
    const back = new Map(recent.filter((d) => cur.has(d.id) && sameSplits(cur.get(d.id).splits, d.after)).map((d) => [d.id, d.before]));
    if (back.size) await commit({ ...db, placements: db.placements.map((p) => (back.has(p.id) ? { ...p, splits: back.get(p.id) } : p)) });
    fixes.load();
  };
  return recent.length ? [{ k: "splitsAuto", text: autoWords(recent), undo }] : [];
}

// "X's numbers can't sync": each client's Sheet tab name, typed right here, then the sheet pull checks it
function SheetTabFix({ ctx }) {
  const { db, commit, songInfo, reloadSongInfo } = ctx;
  const names = noTabNames(db, songInfo);
  const [typed, setTyped] = useState({});
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const save = async (c) => {
    setBusy(c.id); setNote(null);
    try {
      const next = await commit({ ...db, clients: db.clients.map((x) => (x.id === c.id ? { ...x, sheetTabName: (typed[c.id] ?? "").trim() } : x)) });
      if (!next) return;
      const { missing } = await fullSiteSync(next, commit);
      await reloadSongInfo();
      setNote(missing.includes(c.name) ? { warn: true, text: `Saved, but the pub sheet still has no tab called ${(typed[c.id] ?? "").trim() || c.name}.` } : { text: `Saved. ${c.name}'s numbers sync from the ${(typed[c.id] ?? "").trim() || c.name} tab now.` });
    } finally { setBusy(null); }
  };
  return (
    <div className="todo-sublist">
      {names.map((n) => findTabClient(db, n)).filter(Boolean).map((c, i) => (
        <div key={c.id} className="fix-row" data-tab-client={c.id}>
          <span className="fix-song">{c.name}</span>
          <label className="fix-mid fld todo-tab-fld"><input className="todo-input" data-sheet-tab value={typed[c.id] ?? c.sheetTabName ?? ""} placeholder="Sheet tab name" aria-label={`${c.name}'s sheet tab name`} autoFocus={i === 0} onChange={(e) => setTyped((t) => ({ ...t, [c.id]: e.target.value }))} />
            <span className="hint">The pub sheet has no tab called {c.sheetTabName?.trim() || c.name}.</span></label>
          <span className="fix-acts"><button className="btn sm" disabled={busy === c.id || !(typed[c.id] ?? "").trim()} onClick={() => save(c)}>{busy === c.id ? "Saving…" : "Save"}</button></span>
        </div>
      ))}
      <DropNote note={note} />
    </div>
  );
}

// A&R follow-ups due today or late: each person, and Open shows their panel right here
function ArFollowUps({ ctx }) {
  const ar = useArAll();
  const { cards } = arCards(ar.data, ar.pg);
  const [open, setOpen] = useState(null);
  const due = cards.filter((c) => c.stage !== "passed" && c.stage !== "signed" && (c.followUp?.state === "overdue" || c.followUp?.state === "due"));
  return (
    <div className="todo-sublist">
      {!ar.pg ? <p className="home-muted"><RefreshCw size={15} className="spin" /> Loading…</p>
        : !due.length ? <p className="home-muted acct-clear"><CheckCircle2 size={15} /> No follow-ups due.</p>
        : due.map((c) => (
          <div key={c.key} className="fix-row" data-follow={c.id}>
            <span className="fix-song">{c.name}</span>
            <span className="fix-mid">{followChip(c.followUp)}</span>
            <span className="fix-acts"><button className="btn sm" onClick={() => setOpen(c.key.startsWith("p:") ? { type: "prospect", id: c.id } : { type: "tracked", id: c.id })}>Open</button></span>
          </div>
        ))}
      <ArPanels ar={ar} open={open} openPanel={setOpen} closePanel={() => setOpen(null)} onGo={ctx.onGo} />
    </div>
  );
}

// a sync check's fix, in place: pull the sheet, rebuild STREAM DATA, or what to do about INFO
function SyncFix({ check, ctx }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const run = () => syncFix(check, ctx, setBusy, setNote);
  return (
    <div className="todo-sublist">
      <p className="hint">{check.text}{check.detail ? ` ${check.detail}` : ""}</p>
      {check.fix?.kind === "url" ? <p className="hint">Add the missing names on INFO (or fix their spelling) so payments find their client. <ExtLink className="inline-link" href={check.fix.url}>Open the sheet ↗</ExtLink></p>
        : check.fix && <button className="btn sm" data-sync-fix={check.id} disabled={busy} onClick={run}>{busy ? "Working…" : check.fix.label}</button>}
      <DropNote note={note} />
    </div>
  );
}
async function syncFix(check, ctx, setBusy, setNote) {
  const { db, commit, reloadSongInfo, sync, onGo } = ctx;
  if (check.fix?.kind === "todo") return onGo("todo", check.fix.area);
  setBusy(true); setNote(null);
  try {
    const { missing } = await fullSiteSync(db, commit);
    await reloadSongInfo?.();
    await sync.load(true);
    setNote({ warn: !!missing.length, text: missing.length ? `Done. No sheet tab found for ${missing.join(", ")}.` : "Done. The numbers are pulled from the sheet again." });
  } catch (err) { setNote({ warn: true, text: err.message || "That didn't go through. Try again in a minute." }); } finally { setBusy(false); }
}

// The old Luminate portfolios as the numbers' starting list (list B #3, GET /api/data?seeds=1): the songs and
// artists not tracked yet. Read whenever Home or To do opens; an answer takes its line off at once.
const seedCache = { d: null };
function useSeeds(tab, on) {
  const [data, setData] = useState(() => seedCache.d);
  const load = () => (!on ? Promise.resolve() : fetch("/api/data?seeds=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (d?.todo) { seedCache.d = d; setData(d); } }).catch(() => {}));
  useEffect(() => { if (tab === "home" || tab === "todo" || !seedCache.d) load(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const drop = (lumId) => setData((d) => { const n = d ? { ...d, todo: d.todo.filter((r) => r.lumId !== lumId) } : d; seedCache.d = n; return n; });
  return { data, load, drop };
}
// To do's list for one area: each line finished right here (Yes to the match Spotify found, a pasted link,
// or Not on Spotify in its ⋯ menu); an artist can get their Instagram / TikTok / YouTube at the same time
function SeedList({ area, ctx }) {
  const rows = (ctx.seeds?.data?.todo || []).filter((r) => r.area === area);
  const [note, setNote] = useState(null);
  return (
    <div className="todo-sublist seed-list" data-seed-list={area}>
      <p className="hint">From the old Luminate {area === "ar" ? "Artist and Song Trackers" : "Admin Catalogs"}. Once one is on Spotify here, its numbers come in with the next daily update; its Luminate numbers stay as history.</p>
      {rows.map((r) => <SeedRow key={r.lumId} r={r} picks={r.kind !== "artist" && !r.isrc ? isrcPicksOf(ctx.songInfo, r.placementIds || []) : []}
        onDone={(text) => { const last = rows.length === 1; ctx.seeds.drop(r.lumId); if (last && ctx.flash) ctx.flash({ text }); else setNote({ text }); }} />)}
      {!rows.length && <p className="home-muted acct-clear"><CheckCircle2 size={15} /> All found.</p>}
      <DropNote note={note} />
    </div>
  );
}
const SOCIALS = [["instagram", "Instagram"], ["tiktok", "TikTok"], ["youtube", "YouTube"]];
// picks: the ISRC finder's guesses for a song with no ISRC (one tap: kept on the song, then looked up on Spotify)
function SeedRow({ r, picks = [], onDone }) {
  const artist = r.kind === "artist";
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [url, setUrl] = useState("");
  const [other, setOther] = useState(!r.spotify);
  const [so, setSo] = useState({ instagram: r.socials?.instagram || "", tiktok: r.socials?.tiktok || "", youtube: r.socials?.youtube || "" });
  const [isrc, setIsrc] = useState(r.isrc || "");
  const send = async (body, done) => {
    setBusy(true); setErr(null);
    try {
      // the socials first (they're kept whatever happens next), then the answer that takes the line off
      if (artist && body.op !== "skip" && SOCIALS.some(([k]) => so[k].trim() !== (r.socials?.[k] || ""))) await dataPost({ action: "seed", lumId: r.lumId, op: "socials", socials: so });
      const out = await dataPost({ action: "seed", lumId: r.lumId, ...body });
      // an ISRC Spotify has no song for: kept, and the line stays for a link
      if (body.op === "isrc" && out.match !== "matched") { setIsrc(out.isrc || body.isrc); setErr("Spotify has no song with that ISRC. Paste its Spotify link instead."); setBusy(false); return; }
      onDone(done);
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  const what = artist ? r.name : `"${r.name}"`;
  return (
    <div className="seed-row" data-seed={r.lumId} data-status={r.status}>
      <div className="seed-head">
        <span className="lm-cover">{r.spotify?.image && !other ? <img src={r.spotify.image} alt="" loading="lazy" decoding="async" /> : <Disc3 size={16} />}</span>
        <span className="lm-song-main"><strong>{r.name}</strong>
          <span>{[r.list, r.artist, r.atd != null && `Luminate: ${fmt(r.atd)} all-time on ${shortDay(r.atdOn)}`].filter(Boolean).join(" · ")}</span></span>
      </div>
      {!other ? (
        <div className="seed-acts">
          <span className="seed-match">Spotify has <ExtLink className="inline-link" href={r.spotify.url}>{r.spotify.name} ↗</ExtLink>. Is that {artist ? "them" : "it"}?</span>
          <span className="seed-btns">
            <button className="btn sm" data-seed-yes disabled={busy} onClick={() => send({ op: "confirm" }, `Tracking ${what} from the next update.`)}>{busy ? "Saving…" : "Yes"}</button>
            <button className="btn ghost sm" disabled={busy} onClick={() => setOther(true)}>No</button>
          </span>
        </div>
      ) : (
        <div className="seed-acts">
          <input className="seed-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={artist ? "Their Spotify artist link" : "The song's Spotify link"} aria-label={`Spotify link for ${r.name}`} />
          <span className="seed-btns">
            <button className="btn sm" data-seed-save disabled={busy || !url.trim()} onClick={() => send({ op: "link", url }, `Tracking ${what} from the next update.`)}>{busy ? "Saving…" : "Save"}</button>
            <RowMenu label={`More for ${r.name}`} items={[{ label: "Not on Spotify: don't track", onClick: () => send({ op: "skip" }, `${r.name} won't be tracked. Its Luminate numbers stay as history.`) }]} />
          </span>
        </div>
      )}
      {!artist && other && (isrc
        ? <p className="hint seed-isrc">ISRC <code>{isrc}</code> (Spotify has nothing under it yet)</p>
        : picks.length > 0 && <IsrcPicks list={picks} busy={busy} onPick={(c) => send({ op: "isrc", isrc: c.isrc, source: c.source }, `Found "${r.name}" on Spotify by its ISRC.`)} />)}
      {artist && (
        <div className="seed-socials">
          {SOCIALS.map(([k, label]) => <input key={k} value={so[k]} onChange={(e) => setSo((x) => ({ ...x, [k]: e.target.value }))} placeholder={`${label} (optional)`} aria-label={`${label} link for ${r.name}`} />)}
        </div>
      )}
      {err && <p className="hint err-text">{err}</p>}
    </div>
  );
}

// ClickUp: one open task. The name opens it in ClickUp; Done ✓ sets it to its list's done status.
const PRIORITY = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };
const CU_BUCKETS = [["overdue", "Overdue"], ["today", "Today"], ["week", "This week"], ["later", "Later"], ["none", "No date"]];
function CuTodoRow({ t, cu }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const writes = !!cu.data?.writes;
  const b = dueBucket(t.due);
  const list = (cu.data?.lists || []).find((l) => l.key === t.list);
  const done = async () => {
    setBusy(true); setErr(null);
    const r = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify({ action: "done", id: t.id }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r?.ok) return setErr(j.error || "Couldn't reach ClickUp. Try again in a minute.");
    cu.drop(t.id);
  };
  return (
    <div className="attn-row cu-todo" data-cu={t.id} data-area="clickup" data-bucket={b}>
      <span className="attn-main">
        <b><ExtLink href={t.url} className="cu-name" title="Open in ClickUp">{t.name} <span className="cu-ext" aria-hidden="true">↗</span></ExtLink></b>
        <em>{[list?.name, t.people?.length ? t.people.map((p) => p.name).join(", ") : null, t.due && `${b === "overdue" ? "Late · was due" : "Due"} ${shortDay(t.due)}`, t.priority && t.priority !== "normal" && `${PRIORITY[t.priority] || t.priority} priority`].filter(Boolean).join(" · ")}</em>
        {err && <em className="err-text" role="alert">{err}</em>}
      </span>
      <button type="button" className="btn ghost sm" data-done={t.id} disabled={busy || !writes} title={writes ? "Set it to done in ClickUp" : "Writing to ClickUp isn't switched on yet"} onClick={done}>{busy ? "Saving…" : "Done ✓"}</button>
    </div>
  );
}

// New task: name, list, due day and who, straight into ClickUp
function NewTaskCard({ cu, onClose }) {
  const lists = cu.data?.lists || [], people = cu.data?.people || [];
  const [f, setF] = useState({ name: "", list: "internal", due: "", assignee: "" });
  const [err, setErr] = useState(null);
  const go = async () => {
    setErr(null);
    const r = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify({ action: "create", ...f, assignee: f.assignee || null }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) return setErr(j.error || "Couldn't reach ClickUp. Try again in a minute.");
    cu.add(j.created);
    onClose();
  };
  return (
    <AskCard title="New ClickUp task" goLabel="Add task" busyLabel="Adding…" plain goDisabled={!f.name.trim() || !cu.data?.writes} go={go} onClose={onClose}>
      {!cu.data?.writes && <p className="hint">Writing to ClickUp isn't switched on yet.</p>}
      <Field label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-new-name autoFocus />
      <label className="fld"><span>List</span>
        <select data-new-list value={f.list} onChange={(e) => setF({ ...f, list: e.target.value })}>{lists.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}</select></label>
      <label className="fld"><span>Due</span><input type="date" data-new-due value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></label>
      <label className="fld"><span>Who</span>
        <select data-new-who value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })}><option value="">Nobody yet</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      {err && <p className="hint err-text" role="alert">{err}</p>}
    </AskCard>
  );
}

// ClickUp's part of To do: due groups, filtered by list and person
function CuSection({ cu, list, person, setList, setPerson, onNew }) {
  const d = cu.data;
  const tasks = (d?.tasks || []).filter((t) => (list === "all" || t.list === list) && (person === "all" || (t.people || []).some((p) => String(p.id) === person)));
  const people = d?.people || [];
  const down = (d?.lists || []).filter((l) => l.error);
  return (
    <div className="todo-cu" data-area="clickup">
      <div className="todo-group todo-cu-head" data-group="clickup">
        <span>ClickUp{d ? ` · ${tasks.length}` : ""}</span>
        <span className="todo-cu-tools">
          <select aria-label="List" data-cu-list value={list} onChange={(e) => setList(e.target.value)}>
            <option value="all">All lists</option>{(d?.lists || []).map((l) => <option key={l.key} value={l.key}>{l.name}{l.count ? ` (${l.count})` : ""}</option>)}
          </select>
          <select aria-label="Person" data-cu-person value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="all">Everyone</option>{people.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
          </select>
          <button type="button" className="btn ghost sm" data-new-task onClick={onNew}><Plus size={14} /> New task</button>
        </span>
      </div>
      {!d && !cu.failed && <p className="todo-line"><RefreshCw size={14} className="spin" /> Loading ClickUp…</p>}
      {cu.failed && !d && <p className="todo-line"><AlertTriangle size={14} /> Couldn't reach ClickUp. <button className="inline-link" onClick={() => cu.load(true)}>Try again</button></p>}
      {d && CU_BUCKETS.map(([b, label]) => {
        const xs = tasks.filter((t) => dueBucket(t.due) === b).sort((x, y) => (x.due ? Date.parse(x.due) : Infinity) - (y.due ? Date.parse(y.due) : Infinity));
        if (!xs.length) return null;
        return (
          <React.Fragment key={b}>
            <div className="todo-sub" data-bucket-head={b}>{label} · {xs.length}</div>
            {xs.map((t) => <CuTodoRow key={t.id} t={t} cu={cu} />)}
          </React.Fragment>
        );
      })}
      {d && !tasks.length && down.length < d.lists.length && <p className="todo-line">Nothing open{list !== "all" || person !== "all" ? " for this filter" : ""}.</p>}
      {down.length > 0 && <p className="todo-line"><AlertTriangle size={14} /> {down.length === d.lists.length ? "Couldn't reach ClickUp." : `Couldn't read ${down.map((l) => l.name).join(", ")}.`} <button className="inline-link" onClick={() => cu.load(true)}>Try again</button></p>}
    </div>
  );
}

const AREA_CHIPS = [["all", "All"], ["money", "Money"], ["roster", "Publishing"], ["ar", "A&R"], ["clickup", "ClickUp"], ["site", "Site"]];
function TodoPage({ ctx, todo, sub, onSub, areaN }) {
  const isArea = TODO_AREAS.includes(sub);
  const [area, setArea] = useState(isArea ? sub : "all");
  const [view, setView] = useState(sub === "calendar" ? "calendar" : "list");
  const [open, setOpen] = useState(() => new Set(sub && !isArea && sub !== "calendar" ? [sub] : []));
  const [list, setList] = useState("all"), [person, setPerson] = useState("all");
  const [newTask, setNewTask] = useState(false);
  // what an action just did, said once above the list (its own row may be gone with it)
  const [flash, setFlash] = useState(null);
  ctx = { ...ctx, flash: setFlash };
  // a link or Back / Forward to an area, an item or the calendar
  useEffect(() => {
    if (TODO_AREAS.includes(sub)) setArea(sub);
    else if (sub === "calendar") setView("calendar");
    else if (sub) { setArea("all"); setView("list"); setOpen((o) => (o.has(sub) ? o : new Set([...o, sub]))); }
  }, [sub]);
  // an opened item asked for by a link: brought into view once it's drawn
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || !sub || isArea || sub === "calendar") return;
    const el = document.querySelector(`.todo-page [data-item="${CSS.escape(sub)}"]`);
    if (el) { landed.current = true; el.scrollIntoView({ block: "start" }); }
  });
  const toggle = (k) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const pick = (a) => { setArea(a); onSub(a === "all" ? null : a); };
  const shown = todo.filter((it) => area === "all" || it.area === area);
  const tap = shown.filter((it) => it.tap), need = shown.filter((it) => !it.tap);
  const cuOn = area === "all" || area === "clickup";
  const { songInfo, songInfoErr, reloadSongInfo } = ctx;
  const allN = todo.length + areaN("clickup");
  return (
    <div className="todo-page">
      <div className="admin-head"><h2>To do</h2>
        <span className="gainer-tabs todo-view" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === "list"} className={view === "list" ? "active" : ""} data-view="list" onClick={() => { setView("list"); if (sub === "calendar") onSub(null); }}><ListIcon size={14} /> List</button>
          <button role="tab" aria-selected={view === "calendar"} className={view === "calendar" ? "active" : ""} data-view="calendar" onClick={() => { setView("calendar"); onSub("calendar"); }}><CalendarDays size={14} /> Calendar</button>
        </span>
      </div>
      {view === "calendar" ? <TodoCalendar ctx={ctx} /> : (
        <>
          <div className="todo-chips" role="tablist" aria-label="Area">
            {AREA_CHIPS.filter(([a]) => a === "all" || ctx.can(AREA_SECTION[a])).map(([a, label]) => { const n = a === "all" ? allN : areaN(a); return (n || a === "all" || a === area) && (
              <button key={a} role="tab" aria-selected={area === a} className={area === a ? "upd-filter on" : "upd-filter"} data-area-chip={a} data-area={a === "all" ? undefined : a} onClick={() => pick(a)}>{label} <span className="todo-chip-n">{n}</span></button>
            ); })}
          </div>
          <DropNote note={flash} />
          <div className="attn home-card todo">
            {tap.length > 0 && <div className="todo-group" data-group="tap">One tap</div>}
            {tap.map((it) => <TodoRow key={it.k} it={it} open={open.has(it.k)} onToggle={() => toggle(it.k)} ctx={ctx} />)}
            {need.length > 0 && <div className="todo-group" data-group="need">Needs you</div>}
            {need.map((it) => <TodoRow key={it.k} it={it} open={open.has(it.k)} onToggle={() => toggle(it.k)} ctx={ctx} />)}
            {!songInfo && !songInfoErr && !ctx.songInfoOff && area !== "clickup" && <p className="todo-line"><RefreshCw size={14} className="spin" /> Checking the songs…</p>}
            {songInfoErr && !songInfo && <p className="todo-line"><AlertTriangle size={14} /> Couldn't load the songs' to-dos. <button className="inline-link" onClick={reloadSongInfo}>Try again</button></p>}
            {!shown.length && (songInfo || ctx.songInfoOff || area === "clickup") && area !== "clickup" && <p className="todo-line todo-clear"><CheckCircle2 size={14} /> Nothing to do here.</p>}
            {cuOn && <CuSection cu={ctx.cu} list={list} person={person} setList={setList} setPerson={setPerson} onNew={() => setNewTask(true)} />}
          </div>
          <DoneForYou ctx={ctx} />
          {newTask && <NewTaskCard cu={ctx.cu} onClose={() => setNewTask(false)} />}
        </>
      )}
    </div>
  );
}

// "Done for you": what the dashboard did by itself, said once. Today that's the ClickUp tasks it keeps
// current (each area's checklist ticks itself); A2 adds what it confirms on its own (an even split the sheet
// already holds), each with Undo (ctx.doneForYou: [{ k, text, undo }]).
const OWN_NAMES = { payments: "Log new payments", "area:publishing": "Publishing", "area:ar": "A&R" };
function DoneForYou({ ctx }) {
  const own = (ctx.cu.data?.own || []).filter((t) => OWN_NAMES[t.kind]);
  const extra = ctx.doneForYou || [];
  if (!own.length && !extra.length) return null;
  return (
    <p className="todo-line todo-done-for-you" data-done-for-you>
      <CheckCircle2 size={14} /> <span>Done for you:{" "}
        {own.length > 0 && <>ClickUp's {own.map((t, i) => <React.Fragment key={t.taskId}>{i ? (i === own.length - 1 ? " and " : ", ") : ""}<ExtLink className="inline-link" href={t.url}>{OWN_NAMES[t.kind]}</ExtLink></React.Fragment>)} {own.length === 1 ? "task keeps itself" : "tasks keep themselves"} up to date.</>}
        {extra.map((x) => <React.Fragment key={x.k}> {x.text}{x.undo && <> <button className="inline-link" data-undo={x.k} onClick={x.undo}>Undo</button></>}</React.Fragment>)}
      </span>
    </p>
  );
}

// To do's Calendar: a month (a week on phones) with ClickUp's due dates and the dashboard's own days.
// Each source gives [{ day: "YYYY-MM-DD" (New York), label, kind, late?, task? }]; Opportunities (B)
// adds its deadlines by adding a source here.
const CAL_SOURCES = [
  // ClickUp: each open task on its due day
  ({ cu }) => (cu.data?.tasks || []).filter((t) => t.due).map((t) => ({ day: nyDay(t.due), label: t.name, kind: "clickup", late: dueBucket(t.due) === "overdue", task: t })),
  // Money: the days payments came in that the Income tab doesn't have yet
  ({ home }) => {
    const by = new Map();
    for (const p of home?.accounting?.unlogged || []) { const d = nyDay(p.at); by.set(d, [...(by.get(d) || []), p]); }
    return [...by].map(([day, ps]) => ({ day, label: `Log ${ps.length === 1 ? `${ps[0].client || ps[0].payer || "a payment"} ${money(ps[0].amount)}` : `${ps.length} payments`}`, kind: "money", late: true }));
  },
];
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function TodoCalendar({ ctx }) {
  const phone = useMedia("(max-width: 599px)");
  const { home } = useHome();
  const today = nyDay(Date.now());
  const [anchor, setAnchor] = useState(today);
  const [picked, setPicked] = useState(today);
  const dow = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
  const first = `${anchor.slice(0, 7)}-01`;
  const start = phone ? addDays(anchor, -dow(anchor)) : addDays(first, -dow(first));
  const days = [];
  if (phone) for (let i = 0; i < 7; i++) days.push(addDays(start, i));
  else for (let d = start; days.length < 42 && (days.length % 7 || d.slice(0, 7) <= anchor.slice(0, 7)); d = addDays(d, 1)) days.push(d);
  const from = days[0], to = days[days.length - 1];
  const events = CAL_SOURCES.flatMap((f) => f({ ...ctx, home }, from, to));
  const on = (d) => events.filter((e) => e.day === d);
  const step = (n) => setAnchor((a) => (phone ? addDays(a, 7 * n) : (() => { const [y, m] = a.split("-").map(Number); const x = new Date(Date.UTC(y, m - 1 + n, 1)); return x.toISOString().slice(0, 10); })()));
  const title = phone ? `${shortDay(from)} – ${shortDay(to)}` : new Date(`${first}T12:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  const chip = (e, i) => <span key={i} className={`cal-ev${e.late ? " late" : ""}`} data-kind={e.kind} data-area={e.kind}>{e.label}</span>;
  return (
    <div className="cal" data-cal={phone ? "week" : "month"}>
      <div className="cal-head">
        <button type="button" className="btn ghost sm" aria-label={phone ? "Last week" : "Last month"} onClick={() => step(-1)}><ChevronLeft size={16} /></button>
        <strong className="cal-title">{title}</strong>
        <button type="button" className="btn ghost sm" aria-label={phone ? "Next week" : "Next month"} onClick={() => step(1)}><ChevronRight size={16} /></button>
        <button type="button" className="inline-link cal-today" onClick={() => { setAnchor(today); setPicked(today); }}>Today</button>
      </div>
      {phone ? (
        <div className="cal-week">
          {days.map((d) => (
            <div key={d} className={`cal-wday${d === today ? " today" : ""}`} data-day={d}>
              <span className="cal-wname">{WEEKDAY_SHORT[dow(d)]} {Number(d.slice(8))}</span>
              <span className="cal-wevs">{on(d).length ? on(d).map(chip) : <span className="muted">—</span>}</span>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="cal-grid" role="grid">
            {WEEKDAY_SHORT.map((w) => <span key={w} className="cal-dow" role="columnheader">{w}</span>)}
            {days.map((d) => {
              const evs = on(d);
              return (
                <button type="button" key={d} role="gridcell" className={["cal-day", d.slice(0, 7) !== anchor.slice(0, 7) && "other", d === today && "today", d === picked && "picked"].filter(Boolean).join(" ")} data-day={d} onClick={() => setPicked(d)}>
                  <span className="cal-n">{Number(d.slice(8))}</span>
                  {evs.slice(0, 3).map(chip)}
                  {evs.length > 3 && <span className="cal-more">+{evs.length - 3} more</span>}
                </button>
              );
            })}
          </div>
          <div className="cal-list" data-picked={picked}>
            <h3 className="lm-h3">{new Date(`${picked}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}</h3>
            {!on(picked).length ? <p className="todo-line">Nothing on this day.</p> : on(picked).map((e, i) => (e.task ? <CuTodoRow key={e.task.id} t={e.task} cu={ctx.cu} />
              : <div key={i} className="attn-row" data-area={e.kind}><span className="attn-main"><b>{e.label}</b></span></div>))}
          </div>
        </>
      )}
    </div>
  );
}

// Home: the numbers, the sync pill, then the biggest tasks (at most five, ranked across ClickUp and the
// site by lib/todo-rank.js, each opening and finished right here; "See all N" opens To do) beside This
// week (the roster's biggest gainers), then this week's calendar and the newest payments (r8)
function HomeDashboard({ ctx, todo, cuTasks, todoN, onAcct }) {
  const { home, failed, retry, refresh } = useHome();
  const unlogged = home?.accounting?.unlogged, toCheck = home?.accounting?.toCheck || 0;
  useEffect(() => {
    if (!unlogged) return;
    const tests = unlogged.filter((p) => p.test);
    onAcct?.((x) => ({ ...x, toLog: unlogged.length, toCheck, toLogTotal: home.accounting.unloggedTotal, toLogTests: { n: tests.length, total: Math.round(tests.reduce((a, p) => a + p.amount, 0) * 100) / 100 } }));
  }, [unlogged, toCheck]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = home?.money;
  const { top } = useMemo(() => biggestTasks([...todo, ...cuTasks.map((t) => ({ ...t, kind: "clickup" }))]), [todo, cuTasks]);
  const [open, setOpen] = useState(() => new Set());
  const toggle = (k) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const settled = (ctx.songInfo || ctx.songInfoErr || ctx.songInfoOff) && ctx.ar && ctx.cu.data;
  const money = ctx.can("money"), syncOn = ctx.can("site") && !ctx.db.access?.ownOnly;
  return (
    <div className="home">
      <div className="admin-head"><h2>Home</h2>{syncOn && <SyncPill sync={ctx.sync} onGo={ctx.onGo} />}{money && m?.connected && !m.error && <span className="home-src">From Stripe · updated {clock(m.updatedAt)}</span>}</div>
      {money && <MoneyRow money={m} failed={failed} retry={retry} />}
      <div className="home-row">
        <div className="attn home-card todo home-top" data-home-top>
          <div className="attn-head"><ListChecks size={15} /> Biggest tasks
            {settled && <button type="button" className="inline-link home-all" data-see-all onClick={() => ctx.onGo("todo")}>{todoN ? `See all ${todoN}` : "Open To do"} ›</button>}</div>
          {!top.length ? (settled ? <p className="todo-line todo-clear"><CheckCircle2 size={14} /> All caught up.</p> : <p className="todo-line"><RefreshCw size={14} className="spin" /> Checking what needs doing…</p>)
            : top.map((it) => (it.kind === "clickup" ? <CuTodoRow key={`cu:${it.id}`} t={it} cu={ctx.cu} /> : <TodoRow key={it.k} it={it} open={open.has(it.k)} onToggle={() => toggle(it.k)} ctx={ctx} />))}
        </div>
        <TopGainers db={ctx.db} onGo={ctx.onGo} arTop={ctx.ar?.top} arLoaded={!!ctx.ar} />
      </div>
      {ctx.can("publishing") && <HomeNumbers onGo={ctx.onGo} />}
      {ctx.can("ar") && <HomeMomentum onGo={ctx.onGo} />}
      <HomeWeek ctx={ctx} home={home} todo={todo} />
      {/* the last card: on a phone it's drawn once it nears the screen (or the page is idle), after what's on screen */}
      {money && <LazySection minHeight={240}><HomePayments home={home} failed={failed} retry={retry} refresh={refresh} onGo={ctx.onGo} /></LazySection>}
    </div>
  );
}

// Home's week: Monday to Sunday with To do Calendar's own sources (ClickUp's due tasks, payments to log), today marked, at most two a day plus "+N". A day's items open right here, in a
// small panel under it: a ClickUp task with Done ✓, a site item as its To do row (opening in place). An
// empty day stays empty.
const HOME_WEEK_CHIPS = 2;
const SITE_ITEM_OF = { money: (it) => it.k === "log" };
function HomeWeek({ ctx, home, todo }) {
  const today = nyDay(Date.now());
  const dow = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
  const start = addDays(today, -((dow(today) + 6) % 7)); // Monday
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(start, i));
  const events = CAL_SOURCES.flatMap((f) => f({ ...ctx, home }, days[0], days[6]));
  const on = (d) => events.filter((e) => e.day === d);
  const [pick, setPick] = useState(null); // { day, at: the day's box } | null
  const [openK, setOpenK] = useState(null); // the site item open in the panel
  const close = () => { setPick(null); setOpenK(null); };
  useEscape(close, !!pick);
  const show = (day, el) => { const b = el.closest(".hw-day").getBoundingClientRect(); setOpenK(null); setPick(pick?.day === day ? null : { day, b }); };
  const loading = !ctx.cu.data && !ctx.cu.failed;
  const label = (e) => <><span className="hw-chip-t">{e.label}</span></>;
  return (
    <div className="home-card home-week" data-home-week>
      <div className="attn-head hw-head"><CalendarDays size={15} /> This week's calendar <span className="hw-range">{shortDay(days[0])} – {shortDay(days[6])}</span>
        <button type="button" className="inline-link home-all" data-open-cal onClick={() => ctx.onGo("todo", "calendar")}>Open calendar ›</button></div>
      <div className="hw-grid" role="list">
        {days.map((d) => {
          const evs = on(d), more = evs.length - HOME_WEEK_CHIPS;
          return (
            <div key={d} role="listitem" className={["hw-day", d === today && "today", d < today && "past", pick?.day === d && "picked"].filter(Boolean).join(" ")} data-day={d}>
              <span className="hw-name">{WEEKDAY_SHORT[dow(d)]} <b>{Number(d.slice(8))}</b>{d === today && <em className="hw-today">Today</em>}</span>
              {evs.slice(0, more > 0 ? HOME_WEEK_CHIPS - 1 : HOME_WEEK_CHIPS).map((e, i) => (
                <button key={i} type="button" className={`hw-chip${e.late ? " late" : ""}`} data-kind={e.kind} data-area={e.kind} title={e.label} onClick={(ev) => show(d, ev.currentTarget)}>{label(e)}</button>
              ))}
              {more > 0 && <button type="button" className="hw-more" data-more={d} onClick={(ev) => show(d, ev.currentTarget)}>+{more + 1} more</button>}
              {!evs.length && loading && d === today && <span className="hw-wait"><RefreshCw size={12} className="spin" /></span>}
            </div>
          );
        })}
      </div>
      {pick && (
        <HomeWeekPanel at={pick.b} onClose={close}>
          <div className="hw-panel-head"><strong>{new Date(`${pick.day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}</strong>
            <button type="button" className="hw-x" aria-label="Close" onClick={close}><X size={16} /></button></div>
          {on(pick.day).map((e, i) => {
            if (e.task) return <CuTodoRow key={e.task.id} t={e.task} cu={ctx.cu} />;
            const it = SITE_ITEM_OF[e.kind] && todo.find(SITE_ITEM_OF[e.kind]);
            return it ? <TodoRow key={it.k} it={it} open={openK === it.k} onToggle={() => setOpenK((k) => (k === it.k ? null : it.k))} ctx={ctx} />
              : <div key={i} className="attn-row" data-area={e.kind}><span className="attn-main"><b>{e.label}</b></span></div>;
          })}
          {!on(pick.day).length && <p className="todo-line">Nothing on this day.</p>}
        </HomeWeekPanel>
      )}
    </div>
  );
}
// the day's panel: placed under the day (or over it when there's no room below), inside the window;
// a click outside closes it
function HomeWeekPanel({ at, onClose, children }) {
  const box = useRef(null);
  useEffect(() => {
    const out = (e) => { if (box.current && !box.current.contains(e.target) && !e.target.closest?.(".hw-day, .modal")) onClose(); };
    document.addEventListener("mousedown", out);
    return () => document.removeEventListener("mousedown", out);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const vw = typeof window === "undefined" ? 1440 : window.innerWidth, vh = typeof window === "undefined" ? 900 : window.innerHeight;
  const w = Math.min(460, vw - 32), left = Math.max(16, Math.min(at.left, vw - w - 16));
  const below = vh - at.bottom - 16, above = at.top - 16;
  const pos = below >= 260 || below >= above ? { top: at.bottom + 6, maxHeight: below - 6 } : { bottom: vh - at.top + 6, maxHeight: above - 6 };
  return <div ref={box} className="hw-panel attn todo" role="dialog" aria-label="This day" style={{ left, width: w, ...pos }}>{children}</div>;
}

// Home's newest payments: the last five from Stripe (the same rows and Log it as Money › All payments),
// and the accounting sheet's four numbers as the card's second tab; "All payments ›" opens Money
const HOME_PAY_N = 5;
function HomePayments({ home, failed, retry, refresh, onGo }) {
  const [sec, setSec] = useState("payments");
  const [logIds, setLogIds] = useState(null);
  const P = home?.payments, A = home?.accounting;
  const rows = P?.items?.slice(0, HOME_PAY_N) || [];
  let body;
  if (!home) body = <HomeWait failed={failed} retry={retry} what="the payments" />;
  else if (sec === "accounting") {
    body = !A?.connected ? <p className="home-muted">Accounting sheet: not connected yet.</p>
      : A.error ? <p className="home-muted"><AlertTriangle size={15} /> {A.error}</p>
      : (
        <div className="cat-summary-grid acct-grid home-acct">
          {[["monthNet", `Net · ${monthName(A.month)}`, `${money(A.monthRevenue)} in · ${money(A.monthExpenses)} out`], ["yearNet", "Net this year"], ["checkingBalance", "Business Checking"], ["taxSetAside", "Tax set-aside (this quarter)"]].map(([k, l, note]) => (
            <div key={k} className="cat-stat" data-stat={k}><span className="cat-stat-label">{l}</span><span className="cat-stat-val">{money(A[k])}</span>{note && <span className="acct-note">{note}</span>}</div>
          ))}
        </div>
      );
  } else {
    body = !P?.connected ? <p className="home-muted"><CircleDollarSign size={15} /> Connect Stripe to see payments here.</p>
      : P.error ? <p className="home-muted"><AlertTriangle size={15} /> {P.error}</p>
      : !rows.length ? <p className="home-muted">No payments yet.</p>
      : (
        <div className="hp-list">
          {rows.map((p) => (
            <div key={p.id} className="hp-row" data-pay={p.id}>
              <span className="hp-day">{payDay(p.at)}</span>
              <span className="hp-who"><strong>{p.client || p.payer || "Unknown payer"}</strong>{p.test && <> <TestChip /></>}</span>
              <span className="hp-amt"><b>{money(p.fee)}</b>{p.fee !== p.amount && <em>of {money(p.amount)}</em>}</span>
              <span className="hp-act">{p.logged === false ? <button type="button" className="btn ghost sm pay-log" data-log={p.id} onClick={() => setLogIds([p.id])}>Log it</button>
                : p.logged ? <span className="hp-in" title="In the accounting sheet"><CheckCircle2 size={14} /> In the sheet</span> : null}</span>
            </div>
          ))}
        </div>
      );
  }
  return (
    <div className="home-card home-pay" data-home-pay>
      <div className="attn-head"><CircleDollarSign size={15} /> Recent payments
        <span className="gainer-tabs" role="tablist" aria-label="Money">
          {[["payments", "Payments"], ["accounting", "Accounting"]].map(([k, l]) => <button key={k} role="tab" aria-selected={sec === k} data-pay-tab={k} className={sec === k ? "active" : ""} onClick={() => setSec(k)}>{l}</button>)}
        </span>
        <button type="button" className="inline-link home-all" data-all-payments onClick={() => onGo("money", sec === "accounting" ? null : "payments")}>{sec === "accounting" ? "Open Money" : P?.total ? `All payments (${fmt(P.total)})` : "All payments"} ›</button></div>
      {body}
      {logIds && <LogConfirm ids={logIds} canLog={!!A?.canLog} onClose={() => setLogIds(null)} onDone={refresh} onDetails={() => onGo("todo", "log")} />}
    </div>
  );
}

// Home's sync pill: all good, or how many checks are amber; opens Site › Sync
function SyncPill({ sync, onGo }) {
  const d = sync.data, n = d?.outOfSync || 0;
  return (
    <button type="button" className={`sync-pill${!d ? "" : n ? " warn" : " ok"}`} data-sync-pill={!d ? "wait" : n ? "warn" : "ok"} onClick={() => onGo("site", "sync")}>
      <i className="sync-dot" aria-hidden="true" />{!d ? (sync.failed ? "Sync: couldn't check" : "Checking sync…") : n ? `${n} thing${n === 1 ? "" : "s"} out of sync` : "Synced · all good"}
    </button>
  );
}

// Site › Sync: every check, one line each, green or amber, with its fix
function SyncView({ ctx }) {
  const { sync } = ctx;
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const d = sync.data;
  return (
    <div className="sync-view">
      <p className="hint overview-subhint">{d ? <>Checked {clock(d.at)} · <button className="inline-link" disabled={sync.busy} onClick={() => sync.load(true)}>{sync.busy ? "Checking…" : "Check again"}</button></> : sync.failed ? <>Couldn't run the checks. <button className="inline-link" onClick={() => sync.load(true)}>Try again</button></> : "Checking…"}</p>
      <DropNote note={note} />
      {d && (
        <div className="attn home-card sync-list">
          {d.checks.map((c) => (
            <div key={c.id} className="attn-row sync-row" data-check={c.id} data-ok={c.ok === true ? "ok" : c.ok === false ? "warn" : "unknown"}>
              <i className="sync-dot" aria-hidden="true" />
              <span className="attn-main"><b>{c.text}</b>{c.detail && <em>{c.detail}</em>}</span>
              {c.ok === false && c.fix && (c.fix.kind === "url"
                ? <ExtLink className="btn ghost sm" href={c.fix.url}>{c.fix.label}</ExtLink>
                : <button type="button" className="btn ghost sm" data-sync-fix={c.id} disabled={!!busy} onClick={() => syncFix(c, ctx, (b) => setBusy(b ? c.id : null), setNote)}>{busy === c.id ? "Working…" : c.fix.label}</button>)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Site: the public website's content, the logins, the contact form's messages, and the Sync view
const SITE_SECS = [["website", "Website"], ["users", "Users"], ["messages", "Messages"], ["sync", "Sync"]];
function SiteAdmin({ ctx, sub, onSub, chip }) {
  const { db, commit, songInfo } = ctx;
  // Users is user management; the rest is Site's. Sync reads every artist at once.
  const secs = SITE_SECS.filter(([id]) => (id === "users" ? ctx.can("users") : ctx.can("site") && !(id === "sync" && db.access?.ownOnly)));
  const want = ["users", "messages", "sync"].includes(sub) ? sub : "website";
  const sec = secs.some(([id]) => id === want) ? want : secs[0]?.[0];
  return (
    <div className="site-page">
      <div className="admin-head"><h2>Site</h2>{chip}</div>
      <div className="subnav" role="tablist" aria-label="Site">
        {secs.map(([id, label]) => <button key={id} role="tab" aria-selected={sec === id} data-site-tab={id} className={sec === id ? "subpill active" : "subpill"} onClick={(e) => { onSub(id === "website" ? null : id); revealChip(e.currentTarget); }}>{label}</button>)}
      </div>
      {sec === "website" && <WebsiteAdmin db={db} commit={commit} sub={sub} onSub={onSub} songInfo={songInfo} embedded />}
      {sec === "users" && <UsersAdmin db={db} commit={commit} reloadDb={ctx.reloadDb} />}
      {sec === "messages" && <SubsAdmin db={db} commit={commit} />}
      {sec === "sync" && <SyncView ctx={ctx} />}
    </div>
  );
}

/* staff: website content (about, roster, staff, notable) -------------- */
const WEBSITE_SECS = [["roster", "Roster"], ["notable", "Notable releases"], ["staff", "Team"], ["about", "About page"]];
const WEB_SEC_KEY = "dm-web-sec";
// embedded: inside Site, which has the page's title
function WebsiteAdmin({ db, commit, sub, onSub, songInfo = null, embedded = false }) {
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
      {!embedded && <div className="admin-head website-head"><h2>Website</h2></div>}
      <div className="subnav">
        {secs.map(([id, label]) => (
          <button key={id} className={sec === id ? "subpill active" : "subpill"} onClick={(e) => { setSec(id); revealChip(e.currentTarget); }}>{label}</button>
        ))}
      </div>
      {sec === "about" && <AboutEditor db={db} commit={commit} />}
      {sec === "roster" && <ClientsAdmin db={db} commit={commit} openId={openId} songInfo={songInfo} />}
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
    { key: "cover", label: "", w: "44px", render: (r) => r.cover ? <img className="rel-thumb" src={r.cover} alt="" loading="lazy" decoding="async" /> : <span className="rel-thumb rel-thumb-empty" /> },
    { key: "song", label: "Song", w: "1.2fr" },
    { key: "artist", label: "Artist", w: "0.9fr" },
    { key: "client", label: "Client", w: "0.9fr" },
  ];
  return (
    <div>
      <p className="muted mb">The songs on the About page. Paste a Spotify link to fill in the details.</p>
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
