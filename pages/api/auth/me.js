// Tells the client who's signed in (if anyone), without ever sending any
// sensitive data — just enough to know which role/dashboard to render. The
// account as it is now, not as the cookie remembers it (see getCurrentSession).
import { getCurrentSession } from "../../../lib/session";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  try {
    const session = await getCurrentSession(req, res);
    return res.status(200).json({ user: session.user || null });
  } catch (err) {
    console.error("auth/me failed:", err);
    return res.status(503).json({ error: "Couldn't check your sign-in — try again in a minute." });
  }
}
