// Server-only: puts one image into the Vercel Blob store and gives back its public link
// (list B #2). The store ("defied-images", public) is reached with BLOB_READ_WRITE_TOKEN. Without the
// token there's no store, and the dashboard keeps the image inside the row the way it always has.
import crypto from "node:crypto";
import { put } from "@vercel/blob";
import { sniffImage, MAX_IMAGE_BYTES } from "./image-links.js"; // with .js: the migration script imports this file under plain node

export const blobConfigured = () => !!String(process.env.BLOB_READ_WRITE_TOKEN || "").trim();

// The file's name is its content's hash: the same image saved twice is one file with one link, and a
// re-run of the migration lands on the files it already made.
export function imagePath(buf, ext) {
  return `images/${crypto.createHash("sha256").update(buf).digest("hex").slice(0, 32)}.${ext}`;
}

// The bytes of a data: URI ({ bytes, type }), or null when it isn't one
export function decodeDataUri(v) {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(String(v || ""));
  if (!m) return null;
  const base64 = /;base64/i.test(m[2]);
  try {
    const bytes = base64 ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8");
    return { bytes, type: (m[1] || "").toLowerCase() };
  } catch {
    return null;
  }
}

// { url } or { status, error } (a plain line the dashboard can show). `put` is @vercel/blob's, or a
// stand-in in tests. Nothing is stored that isn't a JPEG, PNG, WebP or GIF under the size limit.
export async function storeImage(buf, { putFile = put, timeoutMs = 25000 } = {}) {
  if (!buf?.length) return { status: 400, error: "That file is empty." };
  if (buf.length > MAX_IMAGE_BYTES) return { status: 413, error: "That image is too big. Use one under 2 MB." };
  const kind = sniffImage(buf);
  if (!kind) return { status: 415, error: "That file isn't a photo we can use. Use a JPG, PNG, WebP or GIF." };
  try {
    const blob = await putFile(imagePath(buf, kind.ext), buf, {
      access: "public",
      contentType: kind.type,
      // the name is the content's hash, so overwriting can only write the same bytes again
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31536000,
      // the library retries a busy store for minutes; the person waiting gets an answer sooner
      abortSignal: AbortSignal.timeout(timeoutMs),
    });
    return { url: blob.url };
  } catch (err) {
    console.error("image upload to Blob failed:", err?.message || err);
    return { status: 502, error: "Couldn't store that image right now. Try again in a minute." };
  }
}
