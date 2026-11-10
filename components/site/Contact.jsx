import { useState, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/router";
import { RefreshCw, Copy, Upload, X, Music } from "lucide-react";
import { ExtLink, jumpIntoView, withViewTransition } from "../shared/ui";
import { bySlug, copyText, toast } from "./data";
import { SplitHead } from "./motion";
import { ChipGroup } from "./people";

/* ------------------------------------------------------------------ */
/*  CONTACT                                                             */
/* ------------------------------------------------------------------ */
const CONTACT_SUBJECTS = ["General Inquiry", "Artist Management", "Booking", "Publishing / Admin", "Sync Licensing", "Press / Media", "Other"];
// (2026-11-10) the required fields carry a red star; Instagram and the music link are optional
const Req = () => <span className="ct-req" aria-hidden="true">*</span>;
// music files (shown once Dropbox is connected, GET /api/contact-config): each goes straight from here to Dropbox
const sizeText = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const extOf = (n) => (String(n).match(/\.([a-z0-9]{2,5})$/i)?.[1] || "").toLowerCase();
const sendFile = (url, file, onP) => new Promise((ok, no) => {
  const x = new XMLHttpRequest();
  x.open("POST", url);
  x.setRequestHeader("Content-Type", "application/octet-stream");
  x.upload.onprogress = (e) => { if (e.lengthComputable) onP(e.loaded / e.total); };
  x.onload = () => (x.status >= 200 && x.status < 300 ? ok() : no(new Error(`upload ${x.status}`)));
  x.onerror = () => no(new Error("upload failed"));
  x.send(file);
});

export function Contact({ publicData }) {
  const router = useRouter();
  const blank = { name: "", email: "", instagram: "", musicLink: "", subject: "General Inquiry", message: "" };
  const [f, setF] = useState(blank);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [website, setWebsite] = useState(""); // honeypot — real visitors never see or fill this in
  const [cfg, setCfg] = useState(null); // { files, maxFiles, maxMB, types }: files only once Dropbox is connected
  const [files, setFiles] = useState([]); // [{ file, p }] p = upload progress 0..1
  const [fileErr, setFileErr] = useState(null);
  const [phase, setPhase] = useState(null); // "Uploading 1 of 2 · 40%"
  const [sentNote, setSentNote] = useState(null);
  useEffect(() => { fetch("/api/contact-config").then((r) => (r.ok ? r.json() : null)).then((c) => c && setCfg(c)).catch(() => {}); }, []);
  const addFiles = (list) => {
    setFileErr(null);
    const max = cfg?.maxFiles || 5, mb = cfg?.maxMB || 50, types = cfg?.types || [];
    const next = [...files];
    for (const file of list) {
      if (next.length >= max) { setFileErr(`Up to ${max} files.`); break; }
      if (!types.includes(extOf(file.name))) { setFileErr(`"${file.name}" isn't an audio file (MP3, WAV, M4A, AIFF, FLAC).`); continue; }
      if (file.size > mb * 1048576) { setFileErr(`"${file.name}" is over ${mb} MB. Send a link to it instead.`); continue; }
      if (!next.some((x) => x.file.name === file.name && x.file.size === file.size)) next.push({ file, p: 0 });
    }
    setFiles(next);
  };
  const loadedAt = useRef(Date.now());
  const cardRef = useRef(null);
  const sentHead = useRef(null);
  const submitRef = useRef(null);
  // r11 launch: the form is in the HTML before the code runs; a disabled submit stops a native GET with the fields
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
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
    if (!f.name || !f.email || !f.message) return;
    setBusy(true); setErr(null); setSentNote(null);
    try {
      const res = await fetch("/api/submit-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" },
        body: JSON.stringify({ ...f, website, loadedAt: loadedAt.current, files: files.map((x) => ({ name: x.file.name, size: x.file.size })) }),
      });
      // an HTML error page (a gateway timeout) has no JSON to read: that's a failure, never a success
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(data?.error || "Couldn't send that — try again.");
      // the message is saved: now each file goes to its one-time Dropbox link, then the site checks what arrived
      if (data.uploads?.length) {
        let failed = 0;
        for (let i = 0; i < data.uploads.length; i++) {
          const x = files[i];
          setPhase(`Uploading ${i + 1} of ${data.uploads.length}`);
          try { await sendFile(data.uploads[i].link, x.file, (p) => { setFiles((cur) => cur.map((y, j) => (j === i ? { ...y, p } : y))); setPhase(`Uploading ${i + 1} of ${data.uploads.length} · ${Math.round(p * 100)}%`); }); }
          catch { failed++; }
        }
        setPhase("Finishing");
        const fin = await fetch("/api/submit-files", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "defied-site" }, body: JSON.stringify({ id: data.id, token: data.token }) })
          .then((r) => r.json()).catch(() => null);
        if (failed || !fin?.ok || fin.removed?.length) setSentNote(`Your message was sent, but ${failed || fin?.removed?.length || "some"} file${(failed || fin?.removed?.length) === 1 ? "" : "s"} didn't make it. You can email them to submissions@defiedmgmt.com.`);
      } else if (data.filesSkipped) setSentNote("Your message was sent. The files couldn't be attached right now: you can email them to submissions@defiedmgmt.com.");
      setPhase(null);
      // busy stays on until the swap, so the morph starts from "Sending…", never a flash of "Send message"
      withViewTransition("sent", () => {
        flushSync(() => { setSent(true); setF(blank); setFiles([]); setBusy(false); });
        // the card just got ~500px shorter — bring it (and the check drawing in) to the middle of the screen
        jumpIntoView(cardRef.current);
      });
    } catch (e2) {
      // a dropped connection rejects fetch with a TypeError ("Failed to fetch") — not a sentence for visitors
      setErr(e2 instanceof TypeError ? "Couldn't reach the server. Check your connection and try again." : e2.message || "Couldn't send that — try again.");
      setBusy(false); setPhase(null);
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
            {sentNote && <p className="ct-file-note" data-sent-note>{sentNote}</p>}
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
              <label className="ct-fld"><span>Name<Req /></span><input name="name" autoComplete="name" required value={f.name} onChange={set("name")} /></label>
              <label className="ct-fld"><span>Email<Req /></span><input name="email" type="text" inputMode="email" autoComplete="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} required pattern="\s*[^@\s]+@[^@\s]+\.[^@\s]+\s*" title="An email address, like name@example.com" value={f.email} onChange={set("email")} /></label>
            </div>
            <div className="ct-row">
              <label className="ct-fld"><span>Instagram</span><input name="instagram" placeholder="@yourhandle" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={f.instagram} onChange={set("instagram")} /></label>
              <label className="ct-fld"><span>Music link</span><input name="musicLink" inputMode="url" placeholder="SoundCloud, Spotify, Drive…" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={f.musicLink} onChange={set("musicLink")} /></label>
            </div>
            <div className="ct-fld">
              <span id="ct-subject">Subject<Req /></span>
              <ChipGroup name="subject" label="Subject" options={CONTACT_SUBJECTS.map((s) => ({ value: s, label: s }))} value={f.subject} onChange={(v) => setF((cur) => ({ ...cur, subject: v }))} className="ct-chips" />
            </div>
            <label className="ct-fld"><span>Message<Req /></span><textarea name="message" rows={5} required value={f.message} onChange={set("message")} /></label>
            {cfg?.files && (
              <div className="ct-fld ct-files" data-ct-files>
                <span>Music files <em>up to {cfg.maxFiles} · {cfg.maxMB} MB each</em></span>
                {files.length < cfg.maxFiles && (
                  <label className="ct-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!busy) addFiles([...e.dataTransfer.files]); }}>
                    <input type="file" multiple accept={cfg.types.map((t) => `.${t}`).join(",") + ",audio/*"} disabled={busy} onChange={(e) => { addFiles([...e.target.files]); e.target.value = ""; }} />
                    <Upload size={16} /> <span>Add MP3, WAV, M4A, AIFF or FLAC</span>
                  </label>
                )}
                {files.map((x, i) => (
                  <div key={`${x.file.name}-${x.file.size}`} className="ct-file" data-ct-file>
                    <Music size={14} aria-hidden="true" />
                    <span className="ct-file-name">{x.file.name}</span>
                    <span className="ct-file-size">{sizeText(x.file.size)}</span>
                    {busy ? <span className="ct-file-bar" aria-hidden="true"><i style={{ width: `${Math.round(x.p * 100)}%` }} /></span>
                      : <button type="button" className="ct-file-x" aria-label={`Remove ${x.file.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={14} /></button>}
                  </div>
                ))}
                {fileErr && <p className="ct-err" role="alert">{fileErr}</p>}
              </div>
            )}
            {err && <p className="ct-err" role="alert">{err} You can also email submissions@defiedmgmt.com.</p>}
            <button ref={submitRef} className="pill pill-solid pill-full" type="submit" disabled={busy || !ready}>
              {busy ? <><RefreshCw size={15} className="spin" /> {phase ? `${phase}…` : "Sending…"}</> : "Send message"}
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
