import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { Mail, X, Plus, Trash2, Check, AlertTriangle, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { songSplit, splitWords, orderSplits } from "../../lib/splits";
import { Photo, prefersReducedMotion, thumb } from "../shared/ui";
import { findByName } from "../site/data";

/* ---- the brand font is /public/fonts/suntage.otf (preloaded in PageShell, so it downloads alongside
   this bundle instead of inside it). The chrome wordmark + D live in /public/brand as transparent
   files — same-origin, cacheable, and usable as CSS masks for the shine. ---- */

export const uid = () => Math.random().toString(36).slice(2, 10);

/* ------------------------------------------------------------------ */
/*  logo — real embedded brand assets                                  */
/* ------------------------------------------------------------------ */
export function Wordmark({ height = 34, hero = false }) {
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
// a password box (type="password") gets an eye to show what's typed (2026-11-10)
export function Field({ label, hint, ...p }) {
  const [show, setShow] = useState(false);
  const input = p.type === "password"
    ? <span className="fld-pw"><input {...p} type={show ? "text" : "password"} /><button type="button" className="fld-show" onClick={(e) => { e.preventDefault(); setShow((v) => !v); }} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button></span>
    : <input {...p} />;
  return <label className="fld"><span>{label}</span>{input}{hint && <span className="hint">{hint}</span>}</label>;
}
// a share typed in a confirm card (r11 todoedit, the look of "Fill in the sheet's blank share?"): a short box with the
// % beside it, the number keypad on phones, its text selected on focus so one tap and a number replaces it
export const PctInput = ({ invalid = false, ...p }) => (
  <span className="ask-share-in"><input inputMode="decimal" autoComplete="off" aria-invalid={invalid} onFocus={(e) => e.target.select()} {...p} />%</span>
);
export const Area = ({ label, ...p }) => (
  <label className="fld"><span>{label}</span><textarea rows={3} {...p} /></label>
);
export const Avatar = ({ src, name, size = 56 }) =>
  src
    ? <Photo className="avatar" src={thumb(src, size > 60 ? 128 : 96)} alt={name} style={{ width: size, height: size }} />
    : <div className="avatar avatar-ph" style={{ width: size, height: size, fontSize: size * 0.4 }}>{(name || "?")[0].toUpperCase()}</div>;

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
export function useEscape(onClose, active = true, first = false) {
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

export function PhotoUpload({ label, value, onChange }) {
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

export const fmt = (n) => Number(n || 0).toLocaleString();
// fmt(x.toFixed(2)) can drop a trailing zero (43510.90 -> "43,510.9") since
// toLocaleString() doesn't pad fraction digits on its own — force exactly 2.
export const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Email action that actually works everywhere: copies the address to the clipboard
// with visible feedback, and also attempts to open the mail client.
export function EmailButton({ email, size = 18, inline = false }) {
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

/* ------------------------------------------------------------------ */
/*  splits: pie chart + editor                                          */
/* ------------------------------------------------------------------ */
// (2026-11-11, the owner: "can we add color to this so its better looking") one colour per person, in the split's own
// order, from a categorical palette checked for colour-blind separation and contrast on the dark panel; a share
// whose person isn't known yet (unnamed) is gray, and past six people the rest are too (no colour is used twice)
const SPLIT_HUES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9"];
const SPLIT_GRAY = "#5f5f61";
export function splitColors(splits) {
  const out = new Map();
  let i = 0;
  for (const s of splits || []) if (Number(s.percent) > 0) out.set(s, s.unnamed || i >= SPLIT_HUES.length ? SPLIT_GRAY : SPLIT_HUES[i++]);
  return out;
}
export const splitTotal = (splits) => (splits || []).reduce((a, s) => a + Number(s.percent || 0), 0);
export const splitPct = (splits) => Math.round(splitTotal(splits) * 10) / 10;
// the songs whose splits don't add up to 100%, by client: the clients whose songs have the most streams
// first, and in each the biggest songs first (Publishing's Splits to fix list, its Next →, the chips)
export function splitsToFix(db) {
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
// (2026-11-10, the owner: "i dont need all that info"): just the day the site last read the pub sheet
export function streamsAsOf({ pulledAt }) {
  return pulledAt ? `Updated ${new Date(pulledAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "";
}
// the one line staff see about it (Publishing's overview and a client's page): the owner decides what feeds the sheet next

// recharts (~350KB min / ~90KB gzip) is only drawn in the song-splits view (staff Clients tab +
// client portal) — loaded on demand so the public pages never carry it
const SplitsPieChart = dynamic(() => import("../SplitsPieChart"), { ssr: false });
export function SplitsPie({ splits, size = 220 }) {
  const colors = splitColors(splits);
  const data = (splits || []).filter((s) => Number(s.percent) > 0)
    .map((s) => ({ name: s.name || s.label || s.role || "—", value: Number(s.percent) || 0, color: colors.get(s) }));
  if (data.length === 0) return <p className="muted">No splits entered yet.</p>;
  return <div style={{ height: size }}><SplitsPieChart data={data} size={size} /></div>;
}

// forClient: a client's own Add song (the hint in their words, no sheet tabs)
export function SplitsEditor({ splits, onChange, focusPct = 0, assume = true, owner = null, artist = "", forClient = false }) {
  const all = splits || [];
  // the even default (lib/splits.js), live: a 25 typed for a producer shows the unnamed producer at 25 and the
  // artist side at once, and Save writes exactly these rows. While the total is off the unnamed people are the
  // rule's own, so only the named ones are typed into. A client's own editor (assume = false) never fills:
  // the even default is the owner's to confirm, so a client saves exactly what they typed
  // (2026-11-10) with no share typed in, the default from the song's artist line (lib/splits.js songSplit)
  const fill = assume ? songSplit({ splits: all, artist }, owner) : { status: splitTotal(all) === 100 ? "ok" : "look", splits: all, added: [], reason: "" };
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
  // the rule's own people (unnamed, or named from the artist line) are shown only: Save keeps them
  const list = fill.status === "assumed" ? [...named, ...orderSplits(fill.added).map((r, i) => ({ ...r, key: `unnamed-${i}`, shownOnly: true }))] : named;
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
      <div className="splits-ed-head"><span>Publishing splits</span><span className={total === 100 ? "split-ok" : "split-warn"}>{splitPct(shown)}%</span></div>
      {list.map((r) => r.unnamed || r.shownOnly ? (
        <div key={r.key || r.id} className="splits-ed-row split-assumed" data-unnamed>
          {/* one box over the name and role columns: "Producer 2 (unnamed)" already says the role, and is never cut */}
          <span className="split-unnamed" title={r.unnamed ? r.label || `${r.role} (unnamed)` : `${r.name} (${String(r.role || "").toLowerCase()})`}>{r.unnamed ? r.label || `${r.role} (unnamed)` : `${r.name} (${String(r.role || "").toLowerCase()})`}</span>
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
      {fill.status === "assumed" && (forClient
        ? <p className="split-hint split-even" data-even>{fill.rule ? "Default split" : "Even split"}: {splitWords(fill.splits, rows)}. Type a different % if yours isn't {mine ? splitPct([mine]) : 50}%, or add the others on the song.</p>
        : <p className="split-hint split-even" data-even>{fill.rule ? "Default split" : "Even split"} assumed: {splitWords(fill.splits, rows)}. Save keeps this split{mine ? ` and writes ${owner.name}'s ${splitPct([mine])}% to the ${owner.sheetTabName?.trim() || owner.name} tab of the pub sheet` : ""}. Unnamed people stay on the site only.</p>)}
      {fill.status === "look" && rows.length > 0 && <p className="split-hint">Splits should total 100% (currently {splitPct(rows)}%).{fill.reason ? ` ${fill.reason}.` : ""}</p>}
    </div>
  );
}

// a dashboard chip row that scrolls sideways (the sub-navs and the client chooser on phones and
// tablets): the chosen chip comes fully into view instead of staying cut at the edge. The client
// chooser snaps chips to its start, which would snap one only just brought in back out of view, so
// a cut chip goes to the start there. "auto" is instant (the rows set no scroll-behavior, and
// reduced motion turns html's smooth off)
export function revealChip(el) {
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
export function landOn(el) {
  if (!el) return;
  const top = el.getBoundingClientRect().top;
  if (top >= 0 && top <= window.innerHeight * 0.6) return;
  el.scrollIntoView({ block: "start" });
}

// the line a Delete, "This isn't ours" or a To do answer leaves
export function DropNote({ note }) {
  if (!note) return null;
  return (
    <p className={note.warn ? "hint del-note warn" : "hint del-note"} role="status">
      {note.warn ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />} <span>{note.text}</span>
    </p>
  );
}
