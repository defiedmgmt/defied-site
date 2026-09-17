// Pings the "Website Messages" ClickUp channel whenever a new contact-form
// submission comes in, so staff don't have to keep /dashboard open to notice
// one. Best-effort only — a ClickUp outage or bad token must never block a
// real visitor's message from saving, so this never throws; failures just
// get logged server-side.
const WORKSPACE_ID = "90141502305"; // Defied Management
const CHANNEL_ID = "2kydmav1-2154"; // Website Messages channel (private)

export async function notifyClickUpNewMessage({ name, email, instagram, subject, message }) {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) {
    console.error("notifyClickUpNewMessage: CLICKUP_API_TOKEN is not configured.");
    return;
  }

  // instagram is free text — staff sometimes type it with a leading "@" and
  // sometimes without, so normalize to exactly one instead of showing
  // "@@handle" or a bare handle depending on how the visitor typed it.
  const handle = String(instagram || "").replace(/^@+/, "");

  const content = [
    `**New website message** — ${subject || "General Inquiry"}`,
    `**Name:** ${name}`,
    `**Email:** ${email}`,
    `**Instagram:** @${handle}`,
    "",
    `**Message:**`,
    message,
    "",
    "[Open dashboard](https://www.defiedmgmt.com/dashboard)",
  ].join("\n");

  try {
    const res = await fetch(
      `https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/chat/channels/${CHANNEL_ID}/messages`,
      {
        method: "POST",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "message", content, content_format: "text/md" }),
      }
    );
    if (!res.ok) {
      console.error("notifyClickUpNewMessage failed:", res.status, await res.text());
    }
  } catch (err) {
    console.error("notifyClickUpNewMessage failed:", err);
  }
}
