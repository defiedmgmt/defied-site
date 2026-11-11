// The page a set-password link opens (pages/set-password.jsx). Public: the token is the proof.
//   GET ?t=…                      { ok, name, email } while the link works, else 410
//   POST { token, password }      sets it (8+ characters), ends the link and any other sign-ins, signs this one in
import bcrypt from "bcryptjs";
import { sql } from "../../../lib/db";
import { getSession, requireSameOrigin, clientIp, passwordStamp } from "../../../lib/session";
import { linkFor, useLink } from "../../../lib/password-links";

const GONE = "This link has expired or was already used. Ask a Founder for a new one.";
const tooMany = async (ip) => (await sql`SELECT count(*)::int AS n FROM login_attempts WHERE ip = ${ip} AND email = 'set-password' AND success = false AND attempted_at > now() - interval '15 minutes'`)[0].n >= 10;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const ip = clientIp(req);
  try {
    if (req.method === "GET") {
      if (await tooMany(ip)) return res.status(429).json({ error: "Too many tries. Wait 15 minutes." });
      const l = await linkFor(req.query.t);
      if (!l) { await sql`INSERT INTO login_attempts (email, ip, success) VALUES ('set-password', ${ip}, false)`; return res.status(410).json({ error: GONE }); }
      return res.status(200).json({ ok: true, name: l.name || "", email: l.email });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    if (!requireSameOrigin(req, res)) return;
    if (await tooMany(ip)) return res.status(429).json({ error: "Too many tries. Wait 15 minutes." });
    const { token, password } = req.body || {};
    const pw = String(password || "");
    if (pw !== pw.trim()) return res.status(400).json({ error: "Take out the space at the start or end." });
    if (pw.length < 8) return res.status(400).json({ error: "Use at least 8 characters." });
    const l = await linkFor(token);
    if (!l) { await sql`INSERT INTO login_attempts (email, ip, success) VALUES ('set-password', ${ip}, false)`; return res.status(410).json({ error: GONE }); }
    const hash = await bcrypt.hash(pw, 12);
    if (!(await useLink(l.id, l.user_id, hash))) return res.status(410).json({ error: GONE });
    // signed in straight away (a new password ends every other sign-in: the session's stamp follows the hash)
    const session = await getSession(req, res);
    session.user = { id: l.user_id, role: l.role, name: l.name, clientId: l.client_id };
    session.pw = passwordStamp(hash);
    await session.save();
    await sql`INSERT INTO login_attempts (email, ip, success) VALUES (${String(l.email).toLowerCase()}, ${ip}, true)`;
    return res.status(200).json({ ok: true, role: l.role });
  } catch (err) {
    console.error("set-password failed:", err);
    return res.status(502).json({ error: "Couldn't save that. Try again." });
  }
}
