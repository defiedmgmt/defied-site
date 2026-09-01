// Real server-side login — verifies against bcrypt-hashed passwords in
// Postgres and issues a signed httpOnly session cookie. Server-enforced
// lockout via the login_attempts table: keyed by BOTH email and IP, since
// email-only lockout allows guessing across many accounts from one IP.
import bcrypt from "bcryptjs";
import { sql } from "../../../lib/db";
import { getSession, requireSameOrigin, clientIp } from "../../../lib/session";

const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!requireSameOrigin(req, res)) return;

  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });
  const normEmail = String(email).trim().toLowerCase();
  const ip = clientIp(req);

  try {
    const [{ count: byEmail }] = await sql`
      SELECT count(*)::int FROM login_attempts
      WHERE email = ${normEmail} AND success = false AND attempted_at > now() - (${WINDOW_MINUTES} || ' minutes')::interval
    `;
    const [{ count: byIp }] = await sql`
      SELECT count(*)::int FROM login_attempts
      WHERE ip = ${ip} AND success = false AND attempted_at > now() - (${WINDOW_MINUTES} || ' minutes')::interval
    `;
    if (byEmail >= MAX_ATTEMPTS || byIp >= MAX_ATTEMPTS) {
      return res.status(429).json({ error: `Too many failed attempts. Try again in ${WINDOW_MINUTES} minutes.` });
    }

    const rows = await sql`SELECT id, email, password_hash, role, name, client_id FROM users WHERE email = ${normEmail}`;
    const user = rows[0];
    const valid = user && (await bcrypt.compare(password, user.password_hash));

    await sql`INSERT INTO login_attempts (email, ip, success) VALUES (${normEmail}, ${ip}, ${!!valid})`;

    if (!valid) return res.status(401).json({ error: "Incorrect email or password." });

    const session = await getSession(req, res);
    session.user = { id: user.id, role: user.role, name: user.name, clientId: user.client_id };
    await session.save();

    return res.status(200).json({ ok: true, user: session.user });
  } catch (err) {
    // unauthenticated route — never echo the raw error to an anonymous caller
    console.error("login failed:", err);
    return res.status(502).json({ error: "Login failed." });
  }
}
