// The dashboard's in-memory caches (kept while the app is open), here on their own so the app shell can
// clear them at sign-in and sign-out without loading the dashboard itself (list B #11).
// /api/ar's last answer: Summary, Watchlist and Board share it while it's under 30s old; a save
// always reads it again (loadPg() with no argument)
export const arPgCache = { d: null, at: 0 };

// The Dashboard's last answers, kept while the app is open: coming back to it draws them at once and a
// fresh copy loads quietly ("updated 7:34 PM" says how fresh the money is). Only good answers are kept.
export const dashCache = {};
// sign-in and sign-out start clean (the same tab can sign in as someone else)
export function clearDashCaches() { dashCache.home = null; dashCache.top = null; cuCache.d = null; syncCache.d = null; syncCache.at = 0; arPgCache.d = null; arPgCache.at = 0; }

// ClickUp's open tasks on the dashboard's eight lists (GET /api/tasks), kept while the app is open and
// read again whenever Home or To do opens. Done ✓ takes a task off at once; a failed write puts it back.
export const cuCache = { d: null };
// The Sync view's checks (GET /api/sync): Home's pill, To do's sync rows and Site › Sync. They read
// the sheets and Stripe, so a fresh answer is kept for two minutes.
export const syncCache = { d: null, at: 0 };
