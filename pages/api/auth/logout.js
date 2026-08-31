import { getSession, requireSameOrigin } from "../../../lib/session";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!requireSameOrigin(req, res)) return;
  const session = await getSession(req, res);
  session.destroy();
  return res.status(200).json({ ok: true });
}
