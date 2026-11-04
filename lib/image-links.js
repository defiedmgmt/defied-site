// Photos and covers (list B #2): new uploads go to file storage (Vercel Blob, the "defied-images" store)
// and the row keeps only the link. Rows from before still hold the image itself as a data: URI until
// scripts/migrate-images-to-blob.mjs has moved them; everything that shows an image takes both.
// Shared by the dashboard, the API and the migration script, so no server-only imports here.

// Every column that holds a photo or a cover. The first four are what the dashboard's photo upload
// fills; the A&R ones come from Spotify / Deezer links, and are only checked to be sure.
export const IMAGE_COLUMNS = [
  { table: "clients", column: "photo" },
  { table: "placements", column: "cover" },
  { table: "staff_bios", column: "photo" },
  { table: "notable_releases", column: "cover" },
  { table: "ar_tracking", column: "cover" },
  { table: "ar_tracked", column: "photo" },
];

// a public Blob file's link: https://<store id>.public.blob.vercel-storage.com/<path>
export const BLOB_HOST = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i;
export const isBlobLink = (v) => BLOB_HOST.test(String(v || ""));
// the image itself, stored inside the row (the old way)
export const isInline = (v) => /^data:image\//i.test(String(v || ""));

// The dashboard loads everything in one reply, and Vercel won't send one over 4.5 MB. With photos as
// links the whole thing is a few hundred KB, so this is only a guard against that hard limit: a save
// that would take the reply past it is refused (one that shrinks it always goes). It was 3.5 MB while
// every photo was inside the data.
export const MAX_DATA_BYTES = 4200000;

// One upload's limit. The crop tool sends a 520 x 520 JPEG (about 50-150 KB), so this is generous.
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// What a file's first bytes say it is: { type, ext }, or null for anything that isn't a JPEG, PNG,
// WebP or GIF (SVG and the rest are refused: they can carry scripts)
export function sniffImage(bytes) {
  const b = bytes || [];
  const at = (i) => b[i];
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return { type: "image/jpeg", ext: "jpg" };
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return { type: "image/png", ext: "png" };
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return { type: "image/gif", ext: "gif" };
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return { type: "image/webp", ext: "webp" };
  return null;
}
