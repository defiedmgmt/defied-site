// Unauthenticated — anyone can reach this (it's the public contact form),
// so it needs its own spam defenses rather than relying on a session:
// a honeypot field real visitors never see or fill in, and a minimum
// time-since-page-load check (a form submitted within a second of loading
// is a bot, not someone who read the form).
import { sql } from "../../lib/db";
import { uid } from "../../lib/id";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { name, email, subject, message, website, loadedAt } = req.body || {};

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
