// Server-only session handling — stateless, encrypted+signed httpOnly
// cookies via iron-session (no session store needed, fits serverless).
// SESSION_SECRET must be >= 32 chars; generated once, never rotates unless
// every logged-in user should be forced out.
import { getIronSession } from "iron-session";
import { sql } from "./db";

const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32) {
  // fail loudly at import time rather than silently issuing weak sessions
  throw new Error("SESSION_SECRET must be set and at least 32 characters.");
}

const THIRTY_DAYS = 60 * 60 * 24 * 30;

export const sessionOptions = {
  password: secret,
  cookieName: "defied_session",
  // the seal's own expiry is what really ends a session (iron-session's
  // default is 14 days, whatever the cookie says) — keep it on the cookie's
  ttl: THIRTY_DAYS,
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: THIRTY_DAYS, // 30 days — matches the site's existing "remember me" expectation
  },
};

// session.user is undefined until login() sets it; shape: { id, role, name, clientId }
export async function getSession(req, res) {
  return getIronSession(req, res, sessionOptions);
}

// The cookie is stateless, so the role and client it was issued with would
// otherwise stand for its whole 30 days: a staff account deleted or demoted
// on the dashboard kept full access, and its next save even re-added it.
// Re-read the account on every check (one primary-key lookup): gone means
// signed out, and the database's role/name/client win over the cookie's.
// Throws when the database can't be reached.
export async function getCurrentSession(req, res) {
  const session = await getSession(req, res);
  if (!session.user) return session;
  const [row] = await sql`SELECT id, role, name, client_id FROM users WHERE id = ${session.user.id}`;
  if (!row) session.destroy();
  else session.user = { id: row.id, role: row.role, name: row.name, clientId: row.client_id };
  return session;
}

// a database that's down is a 503, never a crash and never a pass on the
// cookie's word alone
async function checkedSession(req, res) {
  try {
    return await getCurrentSession(req, res);
  } catch (err) {
    console.error("session check failed:", err);
    res.status(503).json({ error: "Couldn't check your sign-in — try again in a minute." });
    return null;
  }
}

// Use at the top of any API route that requires a signed-in staff member.
// Returns the session on success; writes a 401 (503 if the database is down)
// and returns null on failure — callers should `if (!session) return;`
// immediately after.
export async function requireStaff(req, res) {
  const session = await checkedSession(req, res);
  if (!session) return null;
  if (!session.user || session.user.role !== "staff") {
    res.status(401).json({ error: "Staff sign-in required." });
    return null;
  }
  return session;
}

// Use at the top of any API route a signed-in client (or staff) may call.
export async function requireUser(req, res) {
  const session = await checkedSession(req, res);
  if (!session) return null;
  if (!session.user) {
    res.status(401).json({ error: "Sign-in required." });
    return null;
  }
  return session;
}

// Mutating routes (POST/PUT/DELETE) check this in addition to the session
// cookie, as CSRF defense-in-depth beyond the cookie's own sameSite=lax —
// a cross-site form post can't set a custom header, only same-origin fetch()
// calls (which is how this site's own client code always calls its API) can.
export function requireSameOrigin(req, res) {
  if (req.headers["x-requested-with"] !== "defied-site") {
    res.status(403).json({ error: "Cross-site request blocked." });
    return false;
  }
  return true;
}

// Shared by login lockout and contact-form rate limiting. x-forwarded-for
// can carry a client-supplied value on some proxies, but on Vercel the
// first entry is always the actual connecting client — good enough for
// rate limiting (not an identity check).
export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  return (Array.isArray(fwd) ? fwd[0] : fwd || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
}
