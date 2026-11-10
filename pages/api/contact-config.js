// What the public contact form may offer (no secrets): music files only once a Founder has connected Dropbox
import { status, MAX_FILES, MAX_MB, AUDIO } from "../../lib/dropbox";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const s = await status().catch(() => ({ connected: false }));
  res.setHeader("Cache-Control", "no-store"); // one small read a page view: the form follows a connect right away
  return res.status(200).json({ files: !!s.connected, maxFiles: MAX_FILES, maxMB: MAX_MB, types: AUDIO });
}
