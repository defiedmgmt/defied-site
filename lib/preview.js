// r11 fix: whether this build is a preview (anything but the live site's Vercel production build). next.config.js
// sets DEFIED_PREVIEW at build time from VERCEL_ENV, so the browser and the server agree. On a preview a write the
// gates keep off says so plainly (it isn't broken: real saves only happen on the live site); the live site keeps its
// own "isn't switched on yet" text for a gate that is still off there.
export const PREVIEW = process.env.DEFIED_PREVIEW === "1";
export const PREVIEW_OFF = "Saves are off in this preview. They turn on when we go live.";
export const offText = (live) => (PREVIEW ? PREVIEW_OFF : live);
