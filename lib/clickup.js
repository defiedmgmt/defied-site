// Pings the "Website Messages" ClickUp channel whenever a new contact-form
// submission comes in, so staff don't have to keep /dashboard open to notice
// one. Best-effort only — a ClickUp outage or bad token must never block a
// real visitor's message from saving, so this never throws; failures just
// get logged server-side.
const WORKSPACE_ID = "90141502305"; // Defied Management
const CHANNEL_ID = "2kydmav1-2154"; // Website Messages channel (private)

// the post: who, how to reach them, their music link and files (2026-11-10), the message
export function contactContent({ name, email, instagram, subject, message, musicLink = "", files = null, filesNote = "" }) {
  // instagram is free text — staff sometimes type it with a leading "@" and
  // sometimes without, so normalize to exactly one instead of showing
  // "@@handle" or a bare handle depending on how the visitor typed it.
  const handle = String(instagram || "").replace(/^@+/, "").trim();
  const fileLines = Array.isArray(files) && files.length
    ? [`**Files (${files.length}):** ${files.map((f) => `[${String(f.name).replace(/([[\]])/g, "\\$1")}](${f.url})${f.sizeText ? ` (${f.sizeText})` : ""}`).join(" · ")}`]
    : filesNote ? [`**Files:** ${filesNote}`] : [];
  return [
    `**New website message** — ${subject || "General Inquiry"}`,
    `**Name:** ${name}`,
    `**Email:** ${email}`,
    ...(handle ? [`**Instagram:** @${handle}`] : []),
    ...(String(musicLink || "").trim() ? [`**Music link:** ${String(musicLink).trim()}`] : []),
    ...fileLines,
    "",
    `**Message:**`,
    message,
    "",
    "[Open dashboard](https://www.defiedmgmt.com/dashboard/site/messages)",
  ].join("\n");
}

// -> the post's id ("" when it couldn't post), so the files' links can be put on it once they're up
export async function notifyClickUpNewMessage(sub) {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) {
    console.error("notifyClickUpNewMessage: CLICKUP_API_TOKEN is not configured.");
    return "";
  }
  try {
    const res = await fetch(
      `https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/chat/channels/${CHANNEL_ID}/messages`,
      {
        method: "POST",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "message", content: contactContent(sub), content_format: "text/md" }),
      }
    );
    if (!res.ok) {
      console.error("notifyClickUpNewMessage failed:", res.status, await res.text());
      return "";
    }
    const j = await res.json().catch(() => null);
    return String(j?.data?.id || j?.id || "");
  } catch (err) {
    console.error("notifyClickUpNewMessage failed:", err);
    return "";
  }
}

// the files are up: the post gets their links (edited in place), or, if it can't be edited, a second post under it
export async function clickUpFilesReady(messageId, sub) {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) return false;
  const content = contactContent(sub);
  const headers = { Authorization: token, "Content-Type": "application/json" };
  try {
    if (messageId) {
      const r = await fetch(`https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/chat/messages/${encodeURIComponent(messageId)}`, { method: "PATCH", headers, body: JSON.stringify({ content, content_format: "text/md" }) });
      if (r.ok) return true;
      console.error("clickUpFilesReady edit failed:", r.status);
    }
    const files = (sub.files || []).map((f) => `[${f.name}](${f.url})`).join(" · ");
    const r2 = await fetch(`https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/chat/channels/${CHANNEL_ID}/messages`, { method: "POST", headers,
      body: JSON.stringify({ type: "message", content: `**Files from ${sub.name}** (${sub.subject || "General Inquiry"}): ${files || sub.filesNote || "none arrived"}`, content_format: "text/md" }) });
    return r2.ok;
  } catch (err) {
    console.error("clickUpFilesReady failed:", err);
    return false;
  }
}

// Dashboard alerts (the nightly sync failed, …) go to their own channel, never Website Messages: ALERTS_CHANNEL_ID
// below, or CLICKUP_ALERTS_CHANNEL_ID when set. With neither, they're only
// logged. Best-effort like the above: never throws, returns whether ClickUp
// took it.
const ALERTS_CHANNEL_ID = "2kydmav1-2194"; // "Dashboard Alerts" channel (private; Defied Bot, who owns the token, is in it)
export const alertsChannel = () => process.env.CLICKUP_ALERTS_CHANNEL_ID || ALERTS_CHANNEL_ID;

export async function notifyClickUp(content) {
  const token = process.env.CLICKUP_API_TOKEN;
  const channel = alertsChannel();
  if (!channel) {
    console.log("notifyClickUp: no alerts channel set, not sent:", content.split("\n")[0]);
    return false;
  }
  if (!token) {
    console.error("notifyClickUp: CLICKUP_API_TOKEN is not configured.");
    return false;
  }
  try {
    const res = await fetch(`https://api.clickup.com/api/v3/workspaces/${WORKSPACE_ID}/chat/channels/${channel}/messages`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "message", content, content_format: "text/md" }),
    });
    if (!res.ok) console.error("notifyClickUp failed:", res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.error("notifyClickUp failed:", err);
    return false;
  }
}
