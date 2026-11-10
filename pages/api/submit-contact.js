// Unauthenticated — anyone can reach this (it's the public contact form),
// so it needs its own spam defenses rather than relying on a session:
// a honeypot field real visitors never see or fill in, a minimum
// time-since-page-load check (a form submitted within a second of loading
// is a bot, not someone who read the form), AND a real per-IP rate limit —
// the first two are silent by design (no visible CAPTCHA friction for real
// visitors) but neither stops a scripted bot that just sets loadedAt to a
// few seconds in the past and leaves the honeypot blank; the rate limit is
// what actually caps a flood regardless of how "correct" each request looks.
import { sql } from "../../lib/db";
import { uid } from "../../lib/id";
import { clientIp } from "../../lib/session";
import { notifyClickUpNewMessage } from "../../lib/clickup";
import { status as dropboxStatus, uploadLinks, folderFor, fileName, fileToken, extOf, AUDIO, MAX_FILES, MAX_BYTES, MAX_MB } from "../../lib/dropbox";

const MAX_ATTEMPTS = 4;
const WINDOW_MINUTES = 30;
// music files (2026-11-10): up to 5 a message, 50 MB each; a visitor 15 a day, the whole site 150 a day
const FILES_PER_IP_DAY = 15, FILES_PER_DAY = 150;
// a music link: one http(s) address
const linkOf = (v) => { const t = String(v || "").trim().slice(0, 500); if (!t) return ""; const u = /^https?:\/\//i.test(t) ? t : `https://${t}`; try { return new URL(u).hostname.includes(".") ? u : ""; } catch { return ""; } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { name, email, instagram, subject, message, website, loadedAt, musicLink } = req.body || {};
  // the files the browser is about to send: [{ name, size }] (checked again once they're in Dropbox)
  const asked = (Array.isArray(req.body?.files) ? req.body.files : []).slice(0, MAX_FILES + 1);
  const ip = clientIp(req);

  try {
    const [{ count }] = await sql`
      SELECT count(*)::int FROM contact_attempts
      WHERE ip = ${ip} AND attempted_at > now() - (${WINDOW_MINUTES} || ' minutes')::interval
    `;
    if (count >= MAX_ATTEMPTS) {
      return res.status(429).json({ error: "Too many messages sent. Try again later." });
    }
    // logged before the honeypot/timing checks below so a bot that passes
    // them (or one that doesn't) still counts against the limit either way.
    await sql`INSERT INTO contact_attempts (ip, files) VALUES (${ip}, ${Math.min(asked.length, MAX_FILES)})`;
  } catch (err) {
    // unauthenticated route — never echo the raw error to an anonymous caller
    console.error("submit-contact rate-limit check failed:", err);
    return res.status(502).json({ error: "Failed to send message." });
  }

  if (website) return res.status(200).json({ ok: true }); // honeypot tripped — pretend success, don't tip off the bot
  if (!loadedAt || Date.now() - Number(loadedAt) < 2500) {
    return res.status(400).json({ error: "Please try again." }); // submitted too fast to be a human
  }
  // (2026-11-10) Instagram and the music link are optional now
  if (!name || !email || !message) {
    return res.status(400).json({ error: "Name, email and message are required." });
  }
  if (String(musicLink || "").trim() && !linkOf(musicLink)) return res.status(400).json({ error: "That music link doesn't look like a web address." });
  if (asked.length > MAX_FILES) return res.status(400).json({ error: `Up to ${MAX_FILES} files.` });
  const bad = asked.find((f) => !AUDIO.includes(extOf(f?.name)) || !(Number(f?.size) > 0) || Number(f.size) > MAX_BYTES);
  if (bad) return res.status(400).json({ error: `"${String(bad?.name || "A file").slice(0, 80)}" ${Number(bad?.size) > MAX_BYTES ? `is over ${MAX_MB} MB` : "isn't an audio file (MP3, WAV, M4A, AIFF, FLAC)"}.` });

  try {
    const id = uid();
    const sub = { name: String(name).slice(0, 200), email: String(email).trim().slice(0, 200), instagram: String(instagram || "").slice(0, 200), subject: String(subject || "General Inquiry").slice(0, 200), message: String(message).slice(0, 5000), musicLink: linkOf(musicLink) };
    // files: one-time upload links into this message's own Dropbox folder, if Dropbox is connected and today's caps allow
    let uploads = [], filesNote = "";
    if (asked.length) {
      const [{ mine, all }] = await sql`SELECT coalesce(sum(files) FILTER (WHERE ip = ${ip}), 0)::int AS mine, coalesce(sum(files), 0)::int AS all
        FROM contact_attempts WHERE attempted_at > now() - interval '1 day'`;
      if (!(await dropboxStatus().catch(() => ({}))).connected) filesNote = "the sender attached files, but Dropbox isn't connected";
      else if (mine > FILES_PER_IP_DAY || all > FILES_PER_DAY) filesNote = "the sender attached files, but today's upload limit was reached";
      else {
        const used = new Set();
        const names = asked.map((f, i) => { let n = fileName(f.name, i); while (used.has(n.toLowerCase())) n = n.replace(/(\.[a-z0-9]+)$/i, ` (2)$1`); used.add(n.toLowerCase()); return n; });
        try { uploads = await uploadLinks(folderFor({ id, name: sub.name, subject: sub.subject }), names); }
        catch (err) { console.error("submit-contact upload links failed:", err?.message); filesNote = "the sender attached files, but Dropbox couldn't take them"; }
      }
    }
    const pending = uploads.length > 0;
    await sql`
      INSERT INTO submissions (id, name, email, instagram, subject, message, music_link, files, files_status)
      VALUES (${id}, ${sub.name}, ${sub.email}, ${sub.instagram}, ${sub.subject}, ${sub.message}, ${sub.musicLink},
        ${JSON.stringify(uploads.map((u) => ({ name: u.name, size: asked.find((f, i) => fileName(f.name, i) === u.name)?.size || 0 })))}, ${pending ? "uploading" : filesNote ? "failed" : ""})
    `;
    const msgId = await notifyClickUpNewMessage({ ...sub, filesNote: pending ? `${uploads.length} uploading…` : filesNote });
    if (msgId) await sql`UPDATE submissions SET clickup_message_id = ${msgId} WHERE id = ${id}`;
    return res.status(200).json({ ok: true, ...(pending ? { id, token: fileToken(id), uploads } : {}), ...(filesNote ? { filesSkipped: true } : {}) });
  } catch (err) {
    console.error("submit-contact insert failed:", err);
    return res.status(502).json({ error: "Failed to send message." });
  }
}
