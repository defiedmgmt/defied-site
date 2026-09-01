// Lets a signed-in user (staff or client) change their own password. Staff
// already have UsersAdmin (reset anyone's password by typing a new one) —
// this is the self-service path so a client isn't dependent on staff to
// change theirs. Requires the current password, same as any account
// settings page, so a hijacked-but-unlocked session can't silently lock the
// real owner out.
import bcrypt from "bcryptjs";
import { sql } from "../../../lib/db";
import { requireUser, requireSameOrigin } from "../../../lib/session";

const MIN_PASSWORD_LENGTH = 8;

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
    const [row] = await sql`SELECT password_hash FROM users WHERE id = ${session.user.id}`;
    if (!row || !(await bcrypt.compare(currentPassword, row.password_hash))) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }
    const hash = await bcrypt.hash(newPassword.trim(), 12);
    await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${session.user.id}`;
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("change-password failed:", err);
    return res.status(502).json({ error: "Couldn't change your password — try again." });
  }
}
