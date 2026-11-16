// (2026-11-16) Site › Instagram's video upload: the browser sends the file straight to Vercel Blob (@vercel/blob/client
// upload, up to ~300 MB; a request through the site is capped at 4.5 MB) and this only hands it a one-time token. The
// public link is what Instagram fetches. Staff with Site only; no upload-finished callback is asked for, so every call
// here is the signed-in browser's.
import { handleUpload } from "@vercel/blob/client";
import { requireAccess } from "../../../lib/access";
import { requireSameOrigin } from "../../../lib/session";
import { blobConfigured } from "../../../lib/images";

const IG_UPLOAD_TYPES = ["video/mp4", "video/quicktime", "image/jpeg"];
const IG_UPLOAD_MAX = 300 * 1024 * 1024;
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!(await requireAccess(req, res, "site", { whole: true }))) return;
  if (!requireSameOrigin(req, res)) return;
  if (!blobConfigured()) return res.status(503).json({ code: "no-store", error: "File storage isn't set up (BLOB_READ_WRITE_TOKEN)." });
  if (req.body?.type !== "blob.generate-client-token") return res.status(400).json({ error: "Only an upload token is handed out here." });
  try {
    const out = await handleUpload({
      body: req.body, request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!/^instagram\/[A-Za-z0-9._-]{1,120}$/.test(String(pathname))) throw new Error("bad name");
        return { allowedContentTypes: IG_UPLOAD_TYPES, maximumSizeInBytes: IG_UPLOAD_MAX, addRandomSuffix: true };
      },
    });
    return res.status(200).json(out);
  } catch (err) {
    console.error("instagram upload token failed:", String(err?.message || err).slice(0, 160));
    return res.status(400).json({ error: "Couldn't start that upload. Try again." });
  }
}
