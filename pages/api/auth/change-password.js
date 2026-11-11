// Lets a signed-in user (staff or client) change their own password. Staff
// already have UsersAdmin (reset anyone's password by typing a new one) —
// this is the self-service path so a client isn't dependent on staff to
// change theirs. Requires the current password, same as any account
// settings page, so a hijacked-but-unlocked session can't silently lock the
// real owner out.
import bcrypt from "bcryptjs";
import { sql } from "../../../lib/db";
import { requireUser, requireSameOrigin, restampSession, clientIp } from "../../../lib/session";

const MIN_PASSWORD_LENGTH = 8;
// a wrong current password counts as a failed sign-in (login.js's login_attempts, same limit): an
// unlocked session can't be used to guess it
const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const session = await requireUser(req, res);
  if (!session) return;
  if (!requireSameOrigin(req, res)) return;

  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Current and new password are required." });
  }
  if (newPassword.trim().length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
  }

  try {
    const [row] = await sql`SELECT email, password_hash FROM users WHERE id = ${session.user.id}`;
    if (!row) return res.status(401).json({ error: "Current password is incorrect." });
    const email = String(row.email || "").trim().toLowerCase();
    const [{ count: misses }] = await sql`
      SELECT count(*)::int FROM login_attempts
      WHERE email = ${email} AND success = false AND attempted_at > now() - (${WINDOW_MINUTES} || ' minutes')::interval
    `;
    if (misses >= MAX_ATTEMPTS) {
      return res.status(429).json({ error: `Too many wrong passwords. Try again in ${WINDOW_MINUTES} minutes.` });
    }
    if (!(await bcrypt.compare(currentPassword, row.password_hash))) {
      await sql`INSERT INTO login_attempts (email, ip, success) VALUES (${email}, ${clientIp(req)}, false)`;
      return res.status(401).json({ error: "Current password is incorrect." });
    }
    const hash = await bcrypt.hash(newPassword.trim(), 12);
    await sql`UPDATE users SET password_hash = ${hash}, password_changed_at = now() WHERE id = ${session.user.id}`;
    // every other session on this account ends; this one stays signed in
    await restampSession(session, hash);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("change-password failed:", err);
    return res.status(502).json({ error: "Couldn't change your password — try again." });
  }
}
