// One photo or cover from the dashboard's photo upload (the crop tool's JPEG, sent as the raw body):
// stored in Vercel Blob (lib/images.js), and the link comes back for the row to keep (list B #2).
// Staff who edit the site or songs use it, and so does a client editing their own songs' covers.
// Without BLOB_READ_WRITE_TOKEN it answers 503 "no-store", and the dashboard keeps the image inside the
// row as it did before.
import { requireSameOrigin } from "../../lib/session";
import { requireAccess } from "../../lib/access";
import { storeImage, blobConfigured } from "../../lib/images";
import { MAX_IMAGE_BYTES } from "../../lib/image-links";

// the body is the file itself, read here with its own limit
export const config = { api: { bodyParser: false }, maxDuration: 30 };

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0, over = false;
    req.on("data", (c) => { size += c.length; if (size > limit) over = true; else parts.push(c); });
    req.on("end", () => resolve(over ? null : Buffer.concat(parts)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!(await requireAccess(req, res, ["site", "publishing"], { clients: true }))) return;
  if (!requireSameOrigin(req, res)) return;
  if (!blobConfigured()) return res.status(503).json({ code: "no-store", error: "Image storage isn't set up." });
  let buf;
  try { buf = await readBody(req, MAX_IMAGE_BYTES); } catch { return res.status(400).json({ error: "The upload was cut off. Try again." }); }
  if (!buf) return res.status(413).json({ error: "That image is too big. Use one under 2 MB." });
  const r = await storeImage(buf);
  if (!r.url) return res.status(r.status).json({ error: r.error });
  return res.status(200).json({ url: r.url });
}
