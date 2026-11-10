// The website form's second step (2026-11-10): the browser has sent its files straight to Dropbox (pages/api/submit-
// contact.js gave it one-time links); this checks what arrived (lib/dropbox.js finishFolder: over 50 MB or not audio is
// deleted), keeps each file's shared link on the message and puts them on its ClickUp post. Public, like the form:
// it only acts for the message whose token (an HMAC of its id) the browser was given, and only once.
import { sql } from "../../lib/db";
import { finishFolder, folderFor, fileToken, sizeWords } from "../../lib/dropbox";
import { clickUpFilesReady } from "../../lib/clickup";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { id, token } = req.body || {};
  if (typeof id !== "string" || !id || token !== fileToken(id)) return res.status(403).json({ error: "That upload isn't one this form started." });
  try {
    const [s] = await sql`SELECT id, name, email, instagram, subject, message, music_link, files_status, clickup_message_id, created_at FROM submissions WHERE id = ${id}`;
    if (!s) return res.status(404).json({ error: "That message isn't here any more." });
    if (s.files_status !== "uploading") return res.status(200).json({ ok: true, already: true });
    const { files, removed } = await finishFolder(folderFor({ id, name: s.name, subject: s.subject, at: s.created_at }));
    const st = files.length && !removed.length ? "done" : files.length ? "partial" : "failed";
    await sql`UPDATE submissions SET files = ${JSON.stringify(files)}, files_status = ${st} WHERE id = ${id} AND files_status = 'uploading'`;
    const note = !files.length ? `none arrived${removed.length ? ` (${removed.map((r) => `${r.name}: ${r.why}`).join(", ")})` : ""}` : removed.length ? `also sent and removed: ${removed.map((r) => `${r.name} (${r.why})`).join(", ")}` : "";
    await clickUpFilesReady(s.clickup_message_id, { name: s.name, email: s.email, instagram: s.instagram, subject: s.subject, message: s.message, musicLink: s.music_link,
      files: files.map((f) => ({ ...f, sizeText: sizeWords(f.size) })), filesNote: note });
    return res.status(200).json({ ok: true, files: files.length, removed: removed.map((r) => r.name) });
  } catch (err) {
    console.error("submit-files failed:", err);
    return res.status(502).json({ error: "Your message was sent, but the files couldn't be checked. You can email them instead." });
  }
}
