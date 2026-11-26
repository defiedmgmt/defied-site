// Money › Paydays (2026-11-26): the royalty payout tracker. Staff with Money; the schedule and the clients grid are a Founder's to edit.
//   GET                                         the sources and their dates, the clients each one pays, the open paydays (who's paid since,
//                                               who was asked) and the coming ones (lib/payers-store.js paydaysView)
//   POST { action: "done" | "undo", id }        Got it (or take it back) on a payday ("bmi:2026-11-20")
//   POST { action: "dates", source, text }      a Founder adds dates ("Jan 14, Feb 12, 2027-03-16"; ≈ in front marks an estimate)
//   POST { action: "removeDate", source, day }  a Founder takes one off
//   POST { action: "who", clientId, sources }   a Founder sets which sources pay a client
// Stripe or the accounting sheet not answering leaves the statuses unknown (never "paid"). A preview build says saves are off.
import { withSheetsQuick } from "../../lib/sheets";
import { requireSameOrigin } from "../../lib/session";
import { requireAccess } from "../../lib/access";
import { PREVIEW, PREVIEW_OFF } from "../../lib/preview";
import { moneyState, payerNamer } from "../../lib/money";
import { PAYDAY_ID, isSource, validDay, parseDates, normalizePaydays } from "../../lib/paydays";
import { nyDay } from "../../lib/stripe";
import { paydaysView, readPaydays, savePaydays, removePayday, clientExists } from "../../lib/payers-store";

export const config = { maxDuration: 60 };
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

async function view() {
  let m = { pay: null, acct: null, match: null }, namer = null;
  try { m = await moneyState(); namer = await payerNamer(m.match); } catch (err) { console.error("paydays: money read failed", err); }
  return paydaysView({ pay: m.pay, acct: m.acct?.error ? null : m.acct, match: m.match, namer });
}

export default async function handler(req, res) {
  const session = await requireAccess(req, res, "money");
  if (!session) return;
  const founder = req.access?.role === "founder";
  try {
    if (req.method === "GET") return res.status(200).json({ ...(await withSheetsQuick(view)), canEdit: founder });
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    if (!requireSameOrigin(req, res)) return;
    const body = req.body || {}, by = session.user.name || session.user.email || "staff";
    const act = body.action;
    if (act === "done" || act === "undo") {
      const m = PAYDAY_ID.exec(String(body.id || ""));
      if (!m || !isSource(m[1]) || !validDay(m[2])) return res.status(400).json({ error: "Unknown payday." });
      if (PREVIEW) return res.status(503).json({ error: PREVIEW_OFF, off: true });
      const s = await readPaydays();
      if (!s.dates[m[1]].some((d) => d.day === m[2])) return res.status(404).json({ error: "That payday isn't on the schedule any more." });
      if (act === "done") await savePaydays({ [`done:${body.id}`]: { by, at: new Date().toISOString() } });
      else await removePayday(`done:${body.id}`);
      return res.status(200).json({ ok: true });
    }
    if (!["dates", "removeDate", "who"].includes(act)) return res.status(400).json({ error: "Unknown action." });
    if (!founder) return res.status(403).json({ error: "Only a Founder can change the paydays." });
    if (act === "dates") {
      if (!isSource(body.source)) return res.status(400).json({ error: "Unknown source." });
      const { days, bad } = parseDates(String(body.text || "").slice(0, 2000), nyDay(new Date()));
      if (!days.length) return res.status(400).json({ error: bad.length ? `Couldn't read ${bad.slice(0, 3).map((b) => `"${b}"`).join(", ")}. Type dates like Jan 14 or 2027-01-14.` : "Type a date." });
      if (PREVIEW) return res.status(503).json({ error: PREVIEW_OFF, off: true });
      const have = new Set((await readPaydays()).dates[body.source].map((d) => d.day));
      const add = days.filter((d) => !have.has(d.day));
      if (add.length) await savePaydays(Object.fromEntries(add.map((d) => [`date:${body.source}:${d.day}`, d.approx ? { approx: true } : {}])));
      return res.status(200).json({ ok: true, added: add.map((d) => d.day), bad });
    }
    if (act === "removeDate") {
      if (!isSource(body.source) || !validDay(body.day)) return res.status(400).json({ error: "Unknown date." });
      if (PREVIEW) return res.status(503).json({ error: PREVIEW_OFF, off: true });
      await removePayday(`date:${body.source}:${body.day}`);
      return res.status(200).json({ ok: true });
    }
    // who
    const clientId = typeof body.clientId === "string" ? body.clientId : "";
    const list = Array.isArray(body.sources) ? body.sources : null;
    if (!ID_RE.test(clientId) || !list || !list.every(isSource)) return res.status(400).json({ error: "Unknown client or source." });
    if (PREVIEW) return res.status(503).json({ error: PREVIEW_OFF, off: true });
    if (!(await clientExists(clientId))) return res.status(404).json({ error: "That client isn't on the site any more." });
    const sources = normalizePaydays({ [`who:${clientId}`]: list }).who[clientId] || [];
    if (sources.length) await savePaydays({ [`who:${clientId}`]: sources });
    else await removePayday(`who:${clientId}`);
    return res.status(200).json({ ok: true, sources });
  } catch (err) {
    console.error("paydays failed:", err);
    return res.status(500).json({ error: req.method === "GET" ? "Couldn't load the paydays. Try again in a minute." : "Couldn't save that. Try again in a minute." });
  }
}
