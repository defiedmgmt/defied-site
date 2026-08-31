// Tells the client who's signed in (if anyone), without ever sending any
// sensitive data — just enough to know which role/dashboard to render.
import { getSession } from "../../../lib/session";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const session = await getSession(req, res);
  if (!session.user) return res.status(200).json({ user: null });
  return res.status(200).json({ user: session.user });
}
