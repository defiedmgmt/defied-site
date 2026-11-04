import { useState, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/router";
import { RefreshCw, Copy } from "lucide-react";
import { ExtLink, jumpIntoView, withViewTransition } from "../shared/ui";
import { bySlug, copyText, toast } from "./data";
import { SplitHead } from "./motion";
import { ChipGroup } from "./people";

/* ------------------------------------------------------------------ */
/*  CONTACT                                                             */
/* ------------------------------------------------------------------ */
const CONTACT_SUBJECTS = ["General Inquiry", "Artist Management", "Booking", "Publishing / Admin", "Sync Licensing", "Press / Media", "Other"];

export function Contact({ publicData }) {
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
