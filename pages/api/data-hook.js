// Apify calls this when one of our runs ends (list B #4), so its numbers land without waiting for the
// next cron. It needs ?secret=$DATA_HOOK_SECRET (set on the run when it's started, lib/data/direct.js).
// Nothing in the call is trusted but the run's id: the run must be one we started, and its status and
// items are read back from Apify with our own token.
import crypto from "node:crypto";
import { collectApifyRun } from "../../lib/data/engine";

const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const secret = String(process.env.DATA_HOOK_SECRET || "").trim();
  if (!secret) return res.status(503).json({ error: "DATA_HOOK_SECRET is not configured." });
  if (!same(req.query.secret || req.headers["x-data-hook-secret"] || "", secret)) return res.status(401).json({ error: "Not authorized." });
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const runId = body.eventData?.actorRunId || body.resource?.id;
  if (!runId || !/^[A-Za-z0-9]{8,40}$/.test(String(runId))) return res.status(400).json({ error: "No run id." });
  try {
    const r = await collectApifyRun(runId);
    return res.status(r.unknown ? 404 : 200).json(r);
  } catch (err) {
    console.error("data hook failed:", err);
    return res.status(502).json({ error: "Couldn't read that run from Apify. The next cron will." });
  }
}
