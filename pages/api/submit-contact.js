// Unauthenticated — anyone can reach this (it's the public contact form),
// so it needs its own spam defenses rather than relying on a session:
// a honeypot field real visitors never see or fill in, a minimum
// time-since-page-load check (a form submitted within a second of loading
// is a bot, not someone who read the form), AND a real per-IP rate limit —
// the first two are silent by design (no visible CAPTCHA friction for real
// visitors) but neither stops a scripted bot that just sets loadedAt to a
// few seconds in the past and leaves the honeypot blank; the rate limit is
// what actually caps a flood regardless of how "correct" each request looks.
import { sql } from "../../lib/db";
import { uid } from "../../lib/id";
import { clientIp } from "../../lib/session";

const MAX_ATTEMPTS = 4;
const WINDOW_MINUTES = 30;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { name, email, subject, message, website, loadedAt } = req.body || {};
  const ip = clientIp(req);

  try {
    const [{ count }] = await sql`
      SELECT count(*)::int FROM contact_attempts
      WHERE ip = ${ip} AND attempted_at > now() - (${WINDOW_MINUTES} || ' minutes')::interval
    `;
    if (count >= MAX_ATTEMPTS) {
      return res.status(429).json({ error: "Too many messages sent. Try again later." });
    }
    // logged before the honeypot/timing checks below so a bot that passes
    // them (or one that doesn't) still counts against the limit either way.
    await sql`INSERT INTO contact_attempts (ip) VALUES (${ip})`;
  } catch (err) {
    return res.status(502).json({ error: err.message || "Failed to send message." });
  }

  if (website) return res.status(200).json({ ok: true }); // honeypot tripped — pretend success, don't tip off the bot
  if (!loadedAt || Date.now() - Number(loadedAt) < 2500) {
    return res.status(400).json({ error: "Please try again." }); // submitted too fast to be a human
  }
  if (!name || !email || !message) return res.status(400).json({ error: "Name, email, and message are required." });

  try {
    const id = uid();
    await sql`
      INSERT INTO submissions (id, name, email, subject, message)
      VALUES (${id}, ${String(name).slice(0, 200)}, ${String(email).slice(0, 200)}, ${String(subject || "General Inquiry").slice(0, 200)}, ${String(message).slice(0, 5000)})
    `;
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Failed to send message." });
  }
}
