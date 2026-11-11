import { useState, useRef } from "react";
import { X } from "lucide-react";
import { Field, useEscape } from "./ui";
import { ExtLink, ICONS, instagramLink, tiktokLink } from "../shared/ui";
import { MY_LINKS, myLinkHint } from "../../lib/my-links";
import { PLATFORM_LABEL } from "../../lib/links/parse";

// (2026-11-11, the owner) a client's portal: their Spotify, Instagram, TikTok and YouTube, under Your numbers, each
// added or swapped here (POST /api/my-links, lib/my-links.js).
// edit / setEdit: the platform being added or changed, shared with the numbers card's "Add your link"
const shown = (p, v) => (!v ? "" : p === "instagram" || p === "tiktok" ? `@${String(v).replace(/^@/, "").replace(/^https?:\/\/(www\.)?[^/]+\/@?/i, "").replace(/\/.*$/, "")}` : String(v).replace(/^https?:\/\/(www\.)?/i, "").replace(/\?.*$/, ""));
const hrefOf = (p, v) => (p === "instagram" ? instagramLink(v) : p === "tiktok" ? tiktokLink(v) : /^https?:\/\//i.test(String(v)) ? v : `https://${v}`);

export function MyLinks({ client, links, edit, setEdit, onSaved }) {
  const [note, setNote] = useState(null);
  return (
    <div className="cat-summary as-card ml-card" data-my-links>
      <div className="as-head">
        <h3>Your links</h3>
        <span className="hint">Your numbers are read from these</span>
      </div>
      <ul className="ml-list">
        {MY_LINKS.map((p) => {
          const v = links[p] || "";
          return (
            <li key={p} className="ml-row" data-my-link={p} data-has={v ? "" : undefined}>
              <span className="ml-ic" aria-hidden="true">{ICONS[p](18)}</span>
              <span className="ml-text">
                <span className="ml-name">{PLATFORM_LABEL[p]}</span>
                {v ? <ExtLink href={hrefOf(p, v)} className="ml-val" label={`${client?.name || "You"} on ${PLATFORM_LABEL[p]}`}>{shown(p, v)}</ExtLink> : <span className="ml-val ml-none">None on file</span>}
              </span>
              <button className={`btn sm${v ? " ghost" : ""}`} onClick={() => { setNote(null); setEdit(p); }} data-my-link-edit={p}>{v ? "Change" : "Add"}</button>
            </li>
          );
        })}
      </ul>
      {note && <p className="hint ok-text" role="status" data-my-link-saved>{note}</p>}
      {edit && <LinkCard platform={edit} was={links[edit] || ""} onClose={() => setEdit(null)}
        onDone={(out) => { setEdit(null); setNote(out.same ? `That's already your ${PLATFORM_LABEL[out.platform]}.` : `Saved${out.name ? ` (${out.name})` : ""}. ${out.swapped ? `Your ${PLATFORM_LABEL[out.platform]} ${out.platform === "spotify" ? "numbers and songs start over from the new artist page" : "numbers start over from the new account"}` : `Your ${PLATFORM_LABEL[out.platform]} numbers start`} with the next daily update.`); onSaved(out); }} />}
    </div>
  );
}

function LinkCard({ platform, was, onClose, onDone }) {
  const label = PLATFORM_LABEL[platform];
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const running = useRef(false);
  const close = () => { if (!busy) onClose(); };
  useEscape(close, true, true);
  const save = async () => {
    if (running.current) return;
    setErr(null);
    if (!text.trim()) return setErr(`Paste your ${label} link.`);
    running.current = true; setBusy(true);
    try {
      const res = await fetch("/api/my-links", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify({ platform, value: text }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Couldn't save your link. Try again.");
      onDone(data);
    } catch (e) {
      setErr(e.message === "Failed to fetch" ? "Couldn't reach the site. Check your connection." : e.message);
    } finally {
      running.current = false; setBusy(false);
    }
  };
  return (
    <div className="modal ask-modal" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="modal-card ask-card" role="dialog" aria-modal="true" aria-label={`${was ? "Change" : "Add"} your ${label}`} data-my-link-card={platform}>
        <div className="modal-head"><h3>{was ? "Change" : "Add"} your {label}</h3><button onClick={close} aria-label="Close"><X size={18} /></button></div>
        <form onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div className="modal-body ask-body">
            {was && <p className="hint">Now: {shown(platform, was)}. {platform === "spotify" ? "Your Spotify numbers, and the songs we find from your artist page, start over from the new one." : `Your ${label} numbers start over from the new account.`}</p>}
            <Field label={`${label} link${platform === "spotify" ? "" : " or handle"}`} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} autoFocus
              autoComplete="off" autoCapitalize="none" spellCheck={false} inputMode={platform === "spotify" ? "url" : undefined} placeholder={platform === "spotify" ? "https://open.spotify.com/artist/…" : platform === "youtube" ? "youtube.com/@yourchannel" : "@yourhandle"} hint={myLinkHint(platform)} />
            {err && <p className="hint err-text" role="alert" data-my-link-error>{err}</p>}
          </div>
          <div className="modal-foot">
            <button type="button" className="btn ghost sm" onClick={close} disabled={busy}>Cancel</button>
            <button type="submit" className="btn sm" disabled={busy} data-my-link-save>{busy ? "Saving…" : "Save"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
