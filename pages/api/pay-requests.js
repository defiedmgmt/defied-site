// Request payment (2026-11-26), staff with Money only (a co-manager without it is refused; the owner: Money accounts for now).
//   POST { action: "create", clientId, key, cents?, paydayId? }  records a pay link the page just shared or copied
//        (key: the pay.defiedmgmt.com/<key> the link used; cents: the amount it asked for, or none)
// (2026-11-26 owner: paydays only) Not now ({ action: "snooze" }) went with To do's "gone quiet" reminders: it's an unknown action now (400).
// Whether a request is paid is worked out on every read from Stripe (lib/pay-requests.js settleRequests): nothing here marks one paid.
// A preview build says saves are off (the share itself already went out).
import { requireSameOrigin } from "../../lib/session";
import { requireAccess } from "../../lib/access";
import { PREVIEW, PREVIEW_OFF } from "../../lib/preview";
import { KEY_RE, MAX_CENTS } from "../../lib/pay-requests";
import { PAYDAY_ID, validDay, isSource } from "../../lib/paydays";
import { createRequest, clientExists } from "../../lib/payers-store";

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export default async function handler(req, res) {
  const session = await requireAccess(req, res, "money");
  if (!session) return;
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!requireSameOrigin(req, res)) return;
  const body = req.body || {}, by = session.user.name || session.user.email || "staff";
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  if (!ID_RE.test(clientId)) return res.status(400).json({ error: "Which client?" });
  try {
    if (body.action === "create") {
      const key = typeof body.key === "string" ? body.key : "";
      if (!KEY_RE.test(key)) return res.status(400).json({ error: "That pay link isn't one of ours." });
      const cents = body.cents == null || body.cents === "" ? null : Number(body.cents);
      if (cents !== null && !(Number.isInteger(cents) && cents > 0 && cents <= MAX_CENTS)) return res.status(400).json({ error: "$1,000,000 at most." });
      const pid = typeof body.paydayId === "string" ? body.paydayId : "";
      const m = pid ? PAYDAY_ID.exec(pid) : null;
      if (pid && !(m && validDay(m[2]) && isSource(m[1]))) return res.status(400).json({ error: "Unknown payday." });
      if (PREVIEW) return res.status(503).json({ error: PREVIEW_OFF, off: true });
      if (!(await clientExists(clientId))) return res.status(404).json({ error: "That client isn't on the site any more." });
      const r = await createRequest({ clientId, key, cents, paydayId: pid, by });
      return res.status(200).json({ ok: true, request: { id: r.id, clientId, at: r.at } });
    }
    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    console.error("pay-requests failed:", err);
    return res.status(500).json({ error: "Couldn't save that. Try again in a minute." });
  }
}
