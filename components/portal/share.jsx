import { useEffect, useRef, useState } from "react";
import { X, Share2, Download, RefreshCw, AlertTriangle } from "lucide-react";
import { useEscape } from "../dash/ui";
import { shareFileName } from "../../lib/portal-streams";

// The share card (2026-11-13, the owner: "a share button that captures only their gross streams … a cool image that
// they can save w like defied logo and branding"): a button by the client's streams, and a small window with the card
// (GET /api/share-card draws it: their total streams and top songs, nothing else), Story or Post, Save image, and on a
// phone Share. A client sees "Share my stats"; staff on an artist's page "Share card".
export function ShareStats({ clientId, name, isStaff }) {
  const [open, setOpen] = useState(false);
  const opener = useRef(null);
  const close = () => { setOpen(false); opener.current?.focus(); };
  return (
    <>
      <button ref={opener} type="button" className="btn ghost sm share-open" data-share-open aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Share2 size={14} aria-hidden="true" /> {isStaff ? "Share card" : "Share my stats"}
      </button>
      {open && <ShareDialog clientId={clientId} name={name} isStaff={isStaff} onClose={close} />}
    </>
  );
}

const FORMATS = [["story", "Story"], ["post", "Post"]];

// what to say for an answer that isn't a card: the route's own short line where it has one
function failWords(status, said) {
  const line = String(said || "").trim();
  const own = line && line.length <= 140 && !/^</.test(line) ? line : "";
  if (status === 401) return "Your sign-in has ended. Sign in again, then try again.";
  if (status === 403 || status === 404 || status === 409) return own || "This card can't be made.";
  return "Couldn't make the card just now. Try again in a minute.";
}
async function getCard(clientId, format, isStaff) {
  const q = new URLSearchParams({ format });
  if (isStaff) q.set("client", clientId);
  let res;
  try {
    res = await fetch(`/api/share-card?${q}`, { cache: "no-store" });
  } catch {
    throw new Error("Couldn't reach the site. Check your connection and try again.");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let said = text;
    try { said = JSON.parse(text).error || ""; } catch { /* plain text */ }
    throw Object.assign(new Error(failWords(res.status, said)), { final: res.status === 409 || res.status === 403 || res.status === 404 });
  }
  const blob = await res.blob();
  if (!blob.size) throw new Error("Couldn't make the card just now. Try again in a minute.");
  return blob;
}
// the preview is a data: URL (the site's CSP lets images come from data:, not blob:, as the photo upload's preview does)
const dataUrlOf = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error("Couldn't show the card. Try again."));
  r.readAsDataURL(blob);
});
// a phone's share sheet takes the PNG itself (navigator.canShare with files); elsewhere it's Save image only
const shareable = (file) => {
  try { return typeof navigator !== "undefined" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] }); } catch { return false; }
};

export function ShareDialog({ clientId, name, isStaff, onClose }) {
  const [format, setFormat] = useState("story");
  // per format: { loading } | { src (the preview), url (Save image's download link), file, canShare } | { error, final }
  const [cards, setCards] = useState({});
  const [shareMsg, setShareMsg] = useState(null);
  const alive = useRef(true);
  const urls = useRef([]);
  const fileName = shareFileName(name);
  const title = isStaff ? "Share card" : "Share my stats";
  useEscape(onClose, true, true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; urls.current.forEach((u) => URL.revokeObjectURL(u)); urls.current = []; };
  }, []);
  const load = (f) => {
    setCards((c) => ({ ...c, [f]: { loading: true } }));
    getCard(clientId, f, isStaff).then(async (blob) => {
      const src = await dataUrlOf(blob);
      if (!alive.current) return;
      const url = URL.createObjectURL(blob);
      urls.current.push(url);
      const file = typeof File !== "undefined" ? new File([blob], fileName, { type: "image/png" }) : null;
      setCards((c) => ({ ...c, [f]: { src, url, file, canShare: !!file && shareable(file) } }));
    }).catch((e) => { if (alive.current) setCards((c) => ({ ...c, [f]: { error: e.message, final: !!e.final } })); });
  };
  useEffect(() => { if (!cards[format]) load(format); setShareMsg(null); }, [format]); // eslint-disable-line react-hooks/exhaustive-deps
  const card = cards[format] || { loading: true };
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
          <div className={`share-frame share-frame-${format}`} data-share-state={card.src ? "ready" : card.error ? "error" : "loading"} aria-live="polite">
            {card.src ? <img src={card.src} alt={`${title}: ${name || "your"} total streams and top songs, as a ${format === "story" ? "story (tall)" : "post"} image`} />
              : card.error ? (
                <div className="share-state" role="alert">
                  <AlertTriangle size={18} aria-hidden="true" />
                  <p>{card.error}</p>
                  {!card.final && <button type="button" className="btn ghost sm" data-share-retry onClick={() => load(format)}>Try again</button>}
                </div>
              ) : (
                <div className="share-state"><RefreshCw size={18} className="spin" aria-hidden="true" /><p>Making your card…</p></div>
              )}
          </div>
          <p className="hint share-note">{format === "story" ? "Story size, 1080 × 1920." : "Post size, 1080 × 1350."} Streams and top songs only.</p>
          {shareMsg && <p className="hint err-text share-note" role="alert">{shareMsg}</p>}
        </div>
        <div className="modal-foot">
          {card.src && card.canShare && <button type="button" className="btn ghost sm" data-share-native onClick={share}><Share2 size={14} aria-hidden="true" /> Share</button>}
          {card.src
            ? <a className="btn sm" href={card.url} download={fileName} data-share-save><Download size={14} aria-hidden="true" /> Save image</a>
            : <button type="button" className="btn sm" disabled data-share-save><Download size={14} aria-hidden="true" /> Save image</button>}
        </div>
      </div>
    </div>
  );
}
