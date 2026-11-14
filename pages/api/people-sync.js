// People sync (lib/people-sync.js; owner 2026-11-13: "i just want an easier way to add the managers and clients and
// stuff on the site and have it all sync to the sheets"). Staff only.
//   GET  -> { info: { roster, managers, problem } | null, annualCovered, freeTabs, noTab, writes: { accounting, pub },
//           off: { accounting, pub } }. INFO's data needs Money; the pub sheet's free tabs and the clients with no tab
//           need Publishing. Reads only (one accounting read, two pub sheet reads).
//   POST { action: "client", clientId, rate, manager, cut, newManager? }  Money: the client's row on INFO. rate and cut
//           are percents (20, 67), as the form shows them
//   POST { action: "manager", name }  Money: one more name on INFO's managers list
//   POST { action: "tab", clientId }  Publishing: a free WRITER tab on the pub sheet for the client
// 503 with the gate's sentence when that sheet's writes are off, 409 with the sentence when it was refused (nothing
// written), 502 when Google said no (403: the sheet isn't shared with the dashboard's account as Editor). A save that
// landed but read back differently answers 200 with `alarm`.
import { requireSameOrigin } from "../../lib/session";
import { requireAccess, mayUseClient, limited, ownSet } from "../../lib/access";
import { accountingSheetId } from "../../lib/accounting";
import { logWritesOn } from "../../lib/accounting-log";
import { shareWritesOn } from "../../lib/split-fixes-store";
import { loadClientTabNames } from "../../lib/sheets";
import { readPeople, readTabs, saveClientToInfo, addManagerToInfo, createClientTab, googleDenied, noEditText, ACCOUNTING_OFF, PUB_OFF } from "../../lib/people-sync";

const has = (req, k) => req.access?.sections?.includes(k);
const pctIn = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v) / 100);
const by = (session) => session.user?.name || session.user?.email || "staff";

async function get(req, res) {
  const clients = await loadClientTabNames();
  const out = { info: null, annualCovered: null, freeTabs: null, noTab: null, writes: { accounting: logWritesOn(), pub: shareWritesOn() }, off: { accounting: ACCOUNTING_OFF, pub: PUB_OFF } };
  const jobs = [];
  if (has(req, "money")) {
    jobs.push((async () => {
      if (!accountingSheetId()) { out.info = { problem: "The accounting sheet isn't connected yet.", roster: [], managers: [] }; return; }
      try {
        const p = await readPeople({ clients });
        // an account limited to its own artists sees only their rows
        if (limited(req)) { const own = ownSet(req); p.info.roster = p.info.roster.filter((r) => r.clientId && own.has(r.clientId)); }
        Object.assign(out, p);
      } catch (err) { console.error("people sync: read INFO", err); out.info = { problem: "Couldn't read the accounting sheet just now. Try again in a minute.", roster: [], managers: [] }; }
    })());
  }
  if (has(req, "publishing")) {
    jobs.push(readTabs({ clients }).then((t) => Object.assign(out, t)).catch((err) => { console.error("people sync: read pub tabs", err); }));
  }
  await Promise.all(jobs);
  return res.status(200).json(out);
}

// a result from lib/people-sync.js as the answer
function answer(res, r) {
  if (r.refused) return res.status(r.off ? 503 : 409).json({ error: r.refused, ...(r.busy ? { busy: true } : {}) });
  return res.status(200).json(r);
}
function googleError(res, err, sheet) {
  console.error("people sync failed:", err);
  if (err?.sentence) return res.status(502).json({ error: err.message });
  if (googleDenied(err)) return res.status(502).json({ error: noEditText(sheet) });
  return res.status(502).json({ error: `Couldn't write to ${sheet} just now, so nothing was changed. Try again in a minute.` });
}

export default async function handler(req, res) {
  const session = await requireAccess(req, res, null);
  if (!session) return;
  if (req.method === "GET") return get(req, res);
  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  if (!requireSameOrigin(req, res)) return;
  const b = req.body || {};
  const need = b.action === "tab" ? "publishing" : "money";
  if (!["client", "manager", "tab"].includes(b.action)) return res.status(400).json({ error: "Unknown action." });
  if (!has(req, need)) return res.status(403).json({ error: need === "money" ? "Your account can't use Money, so it can't change the accounting sheet." : "Your account can't use Clients, so it can't change the pub sheet." });
  if (b.clientId != null && !mayUseClient(req, String(b.clientId))) return res.status(403).json({ error: "That client isn't one of your artists." });
  const sheet = need === "money" ? "the accounting sheet" : "the pub sheet";
  try {
    if (b.action === "client") {
      return answer(res, await saveClientToInfo({ clientId: String(b.clientId || ""), rate: pctIn(b.rate), cut: pctIn(b.cut), manager: String(b.manager ?? "").slice(0, 80), newManager: String(b.newManager ?? "").slice(0, 80) }, { by: by(session) }));
    }
    if (b.action === "manager") return answer(res, await addManagerToInfo(String(b.name ?? "").slice(0, 80), { by: by(session) }));
    return answer(res, await createClientTab(String(b.clientId || ""), { by: by(session) }));
  } catch (err) { return googleError(res, err, sheet); }
}
