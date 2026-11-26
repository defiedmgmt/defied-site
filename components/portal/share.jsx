import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { X, Share2, Download, RefreshCw, AlertTriangle } from "lucide-react";
import { useEscape } from "../dash/ui";
import { thumb } from "../shared/ui";
import { shareFileName, topSongs } from "../../lib/portal-streams";

// The share card (2026-11-13, the owner: "a share button that captures only their gross streams … a cool image that
// they can save w like defied logo and branding"): a button by the client's streams, and a small window with the card
// (GET /api/share-card draws it: their total streams and top songs, nothing else), Story or Post, Save image, and on a
// phone Share. A client sees "Share my stats"; staff on an artist's page "Share card".
// (2026-11-26, the owner: "make it load way quicker") The window shows the card at once, drawn by the page itself from the
// numbers the portal already has (preview: the same top songs and total, laid out by lib/share-card-layout.js, the
// server's own layout and font measurements), while the server makes the full-size PNG that Save image and Share use;
// the PNG takes the preview's place when it comes. Both sizes are asked for as soon as the window opens (the one shown
// first, then the other), each only once, and the page keeps the cards it got for the day: opening the window again
// shows them straight away and only asks the server whether they're still right (a 304 when they are).
export function ShareStats({ clientId, name, isStaff, preview }) {
  const [open, setOpen] = useState(false);
  const opener = useRef(null);
  const close = () => { setOpen(false); opener.current?.focus(); };
  // the preview's fonts and layout, a moment after the button shows (~35 KB, kept by the browser); the card itself as the
  // finger comes down, a beat before the tap opens the window
  useEffect(() => {
    const t = setTimeout(() => { warmPreview(); }, 1200);
    return () => clearTimeout(t);
  }, []);
  const early = () => { warmPreview(); loadCard(clientId, "story", isStaff, shareFileName(name)).catch(() => {}); };
  return (
    <>
      <button ref={opener} type="button" className="btn ghost sm share-open" data-share-open aria-haspopup="dialog" onPointerDown={early} onClick={() => setOpen(true)}>
        <Share2 size={14} aria-hidden="true" /> {isStaff ? "Share card" : "Share my stats"}
      </button>
      {open && <ShareDialog clientId={clientId} name={name} isStaff={isStaff} preview={preview} onClose={close} />}
    </>
  );
}

const FORMATS = [["story", "Story"], ["post", "Post"]];
const SIZE = { story: { width: 1080, height: 1920 }, post: { width: 1080, height: 1350 } };

// what to say for an answer that isn't a card: the route's own short line where it has one
function failWords(status, said) {
  const line = String(said || "").trim();
  const own = line && line.length <= 140 && !/^</.test(line) ? line : "";
  if (status === 401) return "Your sign-in has ended. Sign in again, then try again.";
  if (status === 403 || status === 404 || status === 409 || status === 422) return own || "This card can't be made.";
  return "Couldn't make the card just now. Try again in a minute.";
}
// etag: the card the page already has (If-None-Match); then a 304 is { same: true }
async function getCard(clientId, format, isStaff, etag) {
  const q = new URLSearchParams({ format });
  if (isStaff) q.set("client", clientId);
  let res;
  try {
    res = await fetch(`/api/share-card?${q}`, { cache: "no-store", ...(etag ? { headers: { "If-None-Match": etag } } : {}) });
  } catch {
    throw new Error("Couldn't reach the site. Check your connection and try again.");
  }
  if (res.status === 304) return { same: true };
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let said = text;
    try { said = JSON.parse(text).error || ""; } catch { /* plain text */ }
    throw Object.assign(new Error(failWords(res.status, said)), { final: [403, 404, 409, 422].includes(res.status) });
  }
  const blob = await res.blob();
  if (!blob.size) throw new Error("Couldn't make the card just now. Try again in a minute.");
  // top songs whose titles use letters the card can't draw are left off its list (GET /api/share-card says how many);
  // the ETag comes only with a whole card (every picture it should have), so only a whole card is kept
  return { blob, leftOff: Number(res.headers.get("X-Share-Left-Off")) || 0, etag: res.headers.get("ETag") || null };
}
// "1 song is left off the list: its title uses letters the card can't draw yet."
export const leftOffWords = (n) => (n > 0 ? `${n === 1 ? "1 song is" : `${n} songs are`} left off the list: ${n === 1 ? "its title uses" : "their titles use"} letters the card can't draw yet.` : "");
// the preview is a data: URL (the site's CSP lets images come from data:, not blob:, as the photo upload's preview does)
const dataUrlOf = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error("Couldn't show the card. Try again."));
  r.readAsDataURL(blob);
});
// a phone's share sheet takes the PNG itself (navigator.canShare with files); elsewhere it's Save image only
// (2026-11-25, mobile) opened from the home screen: an installed iPhone app has handled a blob download badly (nothing, or the window turns
// into the image with no way back), so there "Save image" opens the share sheet, whose Save Image puts it in Photos
const installedApp = () => typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true);
const shareable = (file) => {
  try { return typeof navigator !== "undefined" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] }); } catch { return false; }
};

// ---- the cards this page has (2026-11-26) ---------------------------------------------------------------------------------
// The day the card says, in New York: the same words as the server's (lib/share-card-layout.js cardDay, which isn't loaded
// until the preview is), so a card kept from yesterday is never shown as today's.
const NY_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
export const today = (now = Date.now()) => NY_DAY.format(new Date(now));
// client|format|day -> { src, url, file, canShare, leftOff, etag }: a few whole cards, for this page's life only (never stored)
const kept = new Map();
const asking = new Map(); // the same key -> the request already on its way
const KEEP = 4;
function keep(k, card) {
  const old = kept.get(k);
  if (old && old.url !== card.url) { try { URL.revokeObjectURL(old.url); } catch { /* gone */ } }
  kept.delete(k);
  kept.set(k, card);
  while (kept.size > KEEP) {
    const [k0, c0] = kept.entries().next().value;
    kept.delete(k0);
    try { URL.revokeObjectURL(c0.url); } catch { /* gone */ }
  }
}
async function cardOf({ blob, leftOff, etag }, fileName) {
  const src = await dataUrlOf(blob);
  const url = URL.createObjectURL(blob);
  const file = typeof File !== "undefined" ? new File([blob], fileName, { type: "image/png" }) : null;
  return { src, url, file, canShare: !!file && shareable(file), leftOff, etag };
}
// The card for one size, today: the one this page has, or the one already on its way, or a new request (never two at
// once for the same card). check: ask the server whether the kept one is still right (it answers 304 when it is, and the
// kept one stays; otherwise the new one replaces it)
export function loadCard(clientId, format, isStaff, fileName, { check = false } = {}) {
  const k = `${clientId}|${format}|${today()}`;
  const have = kept.get(k);
  if (have && !check) return Promise.resolve(have);
  if (asking.has(k)) return asking.get(k);
  const work = getCard(clientId, format, isStaff, have?.etag).then(async (got) => {
    if (got.same) return kept.get(k) || have;
    const card = await cardOf(got, fileName);
    if (card.etag) keep(k, card);
    return card;
  }).finally(() => asking.delete(k));
  asking.set(k, work);
  return work;
}

// ---- the preview the page draws itself (2026-11-26) --------------------------------------------------------------------------
// lib/share-card-layout.js (loaded only now) and the two fonts' files, measured as the server measures them; the page's
// own font faces draw the words (styles/app.css Suntage, styles/share.css Share Noto: the same files)
let kit = null;
export function warmPreview() {
  if (typeof window === "undefined" || typeof fetch !== "function") return Promise.resolve(null);
  if (!kit) {
    const bytes = (url) => fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(url))));
    kit = Promise.all([import("../../lib/share-card-layout"), bytes("/fonts/suntage.otf"), bytes("/fonts/share-noto.ttf")])
      .then(async ([layout, suntage, noto]) => {
        await Promise.all(["16px Suntage", '16px "Share Noto"'].map((f) => Promise.resolve(document.fonts?.load?.(f)).catch(() => null)));
        return {
          layout,
          assets: { display: layout.fontInfo(new Uint8Array(suntage)), body: layout.fontInfo(new Uint8Array(noto)), wordmark: "/brand/wordmark.webp", wordmarkRatio: 1100 / 365, mark: "/brand/d.png", markRatio: 180 / 144 },
        };
      })
      .catch(() => { kit = null; return null; });
  }
  return kit;
}
// the numbers the portal shows, as the card's stats: the same top songs and total as the server's (lib/portal-streams.js
// topSongs on the same rows), with the pictures the page already has (the photo as the avatar's resized copy, each cover
// as the song list shows it), and today. null without numbers
const secure = (src) => (/^http:\/\//i.test(src || "") ? `https://${src.slice(7)}` : src || "");
export function previewStats(name, preview, day = today()) {
  if (!preview || !(Number(preview.gross) > 0)) return null;
  return {
    name: String(name || ""),
    photo: preview.photo ? thumb(secure(preview.photo), 96) : null,
    grossStreams: Math.round(Number(preview.gross)),
    songs: topSongs(preview.songs || [], 5).map((s) => ({ ...s, cover: s.cover ? secure(s.cover) : null })),
    asOf: day,
  };
}
// The card at full size (1080 px wide), scaled down to the frame it sits in
// (under the PNG once that's in: an image still loading shows nothing, so the preview shows through until it's drawn)
function LiveCard({ kit: k, stats, format, label, hidden }) {
  const box = useRef(null);
  const [scale, setScale] = useState(0);
  const { width, height } = SIZE[format];
  const card = useMemo(() => k.layout.cardElement(stats, format, k.assets, { web: true }), [k, stats, format]);
  useLayoutEffect(() => {
    const frame = box.current?.parentElement;
    if (!frame) return undefined;
    const fit = () => setScale(frame.clientWidth / width);
    fit();
    if (typeof ResizeObserver === "undefined") { window.addEventListener("resize", fit); return () => window.removeEventListener("resize", fit); }
    const ro = new ResizeObserver(fit);
    ro.observe(frame);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={box} className="share-live" {...(hidden ? { "aria-hidden": true } : { role: "img", "aria-label": label })} data-share-live={format} style={{ width, height, transform: `scale(${scale})` }}>
      {card}
    </div>
  );
}

export function ShareDialog({ clientId, name, isStaff, preview, onClose }) {
  const [format, setFormat] = useState("story");
  // per format: { loading } | { src (the preview), url (Save image's download link), file, canShare, leftOff } | { error, final }
  const [cards, setCards] = useState({});
  const [shareMsg, setShareMsg] = useState(null);
  const [live, setLive] = useState(null);
  const alive = useRef(true);
  const fileName = shareFileName(name);
  const title = isStaff ? "Share card" : "Share my stats";
  useEscape(onClose, true, true);
  useEffect(() => {
    alive.current = true;
    warmPreview().then((k) => { if (alive.current && k) setLive(k); });
    return () => { alive.current = false; };
  }, []);
  // The card for one size, asked for once per window (Try again asks again): a kept one is shown at once and checked with
  // the server in the background (replaced only if it changed); otherwise it's fetched. Resolves when it's in (or failed)
  const asked = useRef(new Map());
  const want = (f) => {
    if (asked.current.has(f)) return asked.current.get(f);
    const have = kept.get(`${clientId}|${f}|${today()}`);
    let work;
    if (have) {
      setCards((c) => ({ ...c, [f]: have }));
      loadCard(clientId, f, isStaff, fileName, { check: true })
        .then((card) => { if (alive.current && card && card.src !== have.src) setCards((c) => ({ ...c, [f]: card })); })
        .catch(() => { /* the kept one stays */ });
      work = Promise.resolve();
    } else {
      setCards((c) => ({ ...c, [f]: { loading: true } }));
      work = loadCard(clientId, f, isStaff, fileName)
        .then((card) => { if (alive.current) setCards((c) => ({ ...c, [f]: card })); })
        .catch((e) => { if (alive.current) setCards((c) => ({ ...c, [f]: { error: e.message, final: !!e.final } })); });
    }
    asked.current.set(f, work);
    return work;
  };
  // the size shown, then the other one, so switching to it is instant (switching early asks for it at once)
  useEffect(() => {
    want(format).then(() => { if (alive.current) want(format === "story" ? "post" : "story"); });
    setShareMsg(null);
  }, [format]); // eslint-disable-line react-hooks/exhaustive-deps
  const retry = (f) => { asked.current.delete(f); want(f); };
  const card = cards[format] || { loading: true };
  const stats = useMemo(() => previewStats(name, preview), [name, preview]);
  // the page draws it only when it says what the server's will: a name the fonts can draw (else the server answers 422)
  const drawn = !!(live && stats && !live.layout.cardText(stats, live.assets).nameIssue);
  const state = card.src ? "ready" : card.error ? "error" : drawn ? "preview" : "loading";
  const share = async () => {
    setShareMsg(null);
    try {
      await navigator.share({ files: [card.file], title: `${name || "My"} streams` });
    } catch (e) {
      if (e?.name !== "AbortError") setShareMsg("Couldn't open sharing on this device. Use Save image instead.");
    }
  };
  // the toggle: arrow keys move between Story and Post, as a radio group does
  const onToggleKey = (e) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const next = FORMATS[(FORMATS.findIndex(([k]) => k === format) + 1) % FORMATS.length][0];
    setFormat(next);
    e.currentTarget.querySelector(`[data-share-format="${next}"]`)?.focus();
  };
  const alt = `${title}: ${name || "your"} total streams and top songs, as a ${format === "story" ? "story (tall)" : "post"} image`;

  return (
    <div className="modal ask-modal share-modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card share-card" role="dialog" aria-modal="true" aria-labelledby="share-card-title" data-share-card>
        <div className="modal-head"><h3 id="share-card-title">{title}</h3><button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-body share-body">
          <div className="share-formats" role="radiogroup" aria-label="Card size" onKeyDown={onToggleKey}>
            {FORMATS.map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={format === k} tabIndex={format === k ? 0 : -1} autoFocus={format === k}
                className={format === k ? "active" : undefined} data-share-format={k} onClick={() => setFormat(k)}>{label}</button>
            ))}
          </div>
          <div className={`share-frame share-frame-${format}`} data-share-state={state} aria-live="polite" aria-busy={state === "preview" || state === "loading"}>
            {card.error ? (
              <div className="share-state" role="alert">
                <AlertTriangle size={18} aria-hidden="true" />
                <p>{card.error}</p>
                {!card.final && <button type="button" className="btn ghost sm" data-share-retry onClick={() => retry(format)}>Try again</button>}
              </div>
            ) : (
              <>
                {drawn && <LiveCard key={format} kit={live} stats={stats} format={format} label={alt} hidden={!!card.src} />}
                {card.src
                  ? <img key={card.src} className="share-png" src={card.src} alt={alt} data-share-png />
                  : !drawn && <div className="share-state"><RefreshCw size={18} className="spin" aria-hidden="true" /><p>Making your card…</p></div>}
              </>
            )}
          </div>
          {/* (2026-11-25 declutter) the size only, with no line on what the card holds (it shows it) */}
          <p className="hint share-note">{format === "story" ? "Story size, 1080 × 1920." : "Post size, 1080 × 1350."}</p>
          {card.src && card.leftOff > 0 && <p className="hint share-note" data-share-left-off={card.leftOff}>{leftOffWords(card.leftOff)}</p>}
          {shareMsg && <p className="hint err-text share-note" role="alert">{shareMsg}</p>}
        </div>
        <div className="modal-foot">
          {card.src && card.canShare && <button type="button" className="btn ghost sm" data-share-native onClick={share}><Share2 size={14} aria-hidden="true" /> Share</button>}
          {card.src && card.canShare && installedApp()
            ? <button type="button" className="btn sm" data-share-save onClick={share}><Download size={14} aria-hidden="true" /> Save image</button>
            : card.src
            ? <a className="btn sm" href={card.url} download={fileName} data-share-save><Download size={14} aria-hidden="true" /> Save image</a>
            : <button type="button" className="btn sm" disabled data-share-save>{state === "preview" ? <RefreshCw size={14} className="spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />} Save image</button>}
        </div>
      </div>
    </div>
  );
}
