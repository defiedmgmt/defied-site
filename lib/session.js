// Server-only session handling — stateless, encrypted+signed httpOnly
// cookies via iron-session (no session store needed, fits serverless).
// SESSION_SECRET must be >= 32 chars; generated once, never rotates unless
// every logged-in user should be forced out.
import { getIronSession } from "iron-session";

const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32) {
  // fail loudly at import time rather than silently issuing weak sessions
  throw new Error("SESSION_SECRET must be set and at least 32 characters.");
}

export const sessionOptions = {
  password: secret,
  cookieName: "defied_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days — matches the site's existing "remember me" expectation
  },
};

// session.user is undefined until login() sets it; shape: { id, role, name, clientId }
export async function getSession(req, res) {
  return getIronSession(req, res, sessionOptions);
}

// Use at the top of any API route that requires a signed-in staff member.
// Returns the session on success; writes a 401 and returns null on failure —
// callers should `if (!session) return;` immediately after.
export async function requireStaff(req, res) {
  const session = await getSession(req, res);
  if (!session.user || session.user.role !== "staff") {
    res.status(401).json({ error: "Staff sign-in required." });
    return null;
  }
  return session;
}

// Use at the top of any API route a signed-in client (or staff) may call.
export async function requireUser(req, res) {
  const session = await getSession(req, res);
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
