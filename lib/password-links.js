// One-time set-password links (2026-11-10): a Founder makes one in Site › Users and texts it; the person opens
// /set-password?t=…, chooses their own password and is signed in. Nobody else ever sees it. A link works once, for 24
// hours; making a new one for the same person ends any older one. Only the token's SHA-256 is stored. Server only.
import crypto from "node:crypto";
import { sql } from "./db";
import { uid } from "./id";

export const LINK_HOURS = 24;
const hashOf = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
export const SITE = process.env.SITE_URL || "https://www.defiedmgmt.com";

export async function makeLink(userId, by = "") {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + LINK_HOURS * 3600 * 1000).toISOString();
  await sql.transaction([
    sql`UPDATE password_links SET used_at = now() WHERE user_id = ${userId} AND used_at IS NULL`,
    sql`INSERT INTO password_links (id, user_id, token_hash, created_by, expires_at) VALUES (${uid()}, ${userId}, ${hashOf(token)}, ${String(by).slice(0, 120)}, ${expires})`,
  ]);
  return { url: `${SITE}/set-password?t=${token}`, expiresAt: expires };
}
// the live link for this token (not used, not expired) and its login, or null
export async function linkFor(token) {
  if (!token || String(token).length < 20) return null;
  const [r] = await sql`SELECT l.id, l.user_id, l.expires_at, u.email, u.name, u.role, u.client_id FROM password_links l JOIN users u ON u.id = l.user_id
    WHERE l.token_hash = ${hashOf(token)} AND l.used_at IS NULL AND l.expires_at > now()`;
  return r || null;
}
export async function useLink(linkId, userId, hash) {
  const done = await sql`UPDATE password_links SET used_at = now() WHERE id = ${linkId} AND used_at IS NULL RETURNING id`;
  if (!done.length) return false; // used a moment ago (a double tap): nothing changes twice
  await sql`UPDATE users SET password_hash = ${hash}, password_changed_at = now() WHERE id = ${userId}`;
  return true;
}
