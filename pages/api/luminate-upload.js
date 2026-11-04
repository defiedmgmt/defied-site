// Luminate portfolio exports dropped on the dashboard: checked, kept, then
// the sheet and every client's numbers are updated (see lib/luminate-run.js).
// Replaces "drag the CSVs into the Drive folder, then press ⟳ UPDATE"; that
// route still works and writes the same STREAM DATA rows. One drop zone for
// every portfolio: the A&R ones' files are only kept, apart, for the A&R tab.
import { requireStaff, requireSameOrigin } from "../../lib/session";
import { parseExport, takeExports, previewLinks, areasFor, isAR } from "../../lib/luminate";
import { afterExports, arLines, markArKept, notifyArKept } from "../../lib/luminate-run";
import { afterAction } from "../../lib/area-tasks";

// a 100-song portfolio export is ~30-46 KB: 60 of them stay under the 4 MB a request can carry
export const config = { api: { bodyParser: { sizeLimit: "4mb" } }, maxDuration: 60 };
const MAX_FILES = 60;
const PICK = "Pick what this portfolio holds, then press Apply again.";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const session = await requireStaff(req, res);
  if (!session) return;
  if (!requireSameOrigin(req, res)) return;
  const sent = Array.isArray(req.body?.files) ? req.body.files : [];
  const files = sent.slice(0, MAX_FILES);
  if (!files.length) return res.status(400).json({ error: "No files came through. Drop the CSVs again." });

  const errors = [], parsed = [];
  if (sent.length > files.length) {
    const n = sent.length - files.length;
    errors.push({ fileName: "", leftOut: n, message: `Only ${MAX_FILES} files at a time: ${n} ${n === 1 ? "was" : "were"} left out. Drop ${n === 1 ? "it" : "them"} again.` });
  }
  for (const f of files) {
    const p = parseExport(String(f?.name || ""), String(f?.text || ""));
    if (p.error) errors.push({ fileName: f?.name || "", message: p.error });
    else parsed.push(p);
  }
  // the newest file of each portfolio in the drop is what STREAM DATA and the links go by; older ones
  // in the same drop (and the same file downloaded twice) only add growth history
  const newest = new Map();
  for (const p of parsed) {
    const cur = newest.get(p.portfolioId);
    if (!cur || String(p.exportedAt || "") > String(cur.exportedAt || "")) newest.set(p.portfolioId, p);
  }
  try {
    const by = session.user.name || session.user.email || "staff";
    const dryRun = !!req.body?.dryRun;
    // which part each file belongs to; a portfolio never seen before that looks like A&R waits for
    // staff to answer "What's in it?" (the preview shows the guess)
    const areas = await areasFor(parsed, req.body?.areas);
    const go = [], waiting = [];
    for (const p of parsed) {
      const a = areas.get(p.portfolioId);
      if (!a.area && !dryRun) { waiting.push(p); continue; }
      go.push({ ...p, area: a.area || a.guess, portfolioName: a.name });
    }
    const results = (await takeExports(go, { by, force: !!req.body?.force, dryRun })).map((r) => {
      const a = areas.get(r.portfolioId);
      return a.unknown ? { ...r, unknown: true, guess: a.guess, needsArea: a.needsArea && !a.answer, answer: a.answer } : r;
    });
    for (const p of waiting) {
      const a = areas.get(p.portfolioId);
      results.push({ fileName: p.fileName, portfolioId: p.portfolioId, exportedAt: p.exportedAt, unknown: true, guess: a.guess, needsArea: true, status: "needsArea", message: PICK });
    }
    // a dry run: what this drop would do, with nothing written anywhere
    if (dryRun) {
      const ready = [...newest.values()].filter((p) => results.some((r) => r.fileName === p.fileName && r.status === "ready" && !isAR(r.area)));
      const links = ready.length ? await previewLinks(ready.map((p) => ({ ...p, area: "clients" }))) : [];
      return res.status(200).json({ preview: true, results, errors, links: links.filter((l) => !l.copied), copied: links.filter((l) => l.copied) });
    }
    const taken = results.filter((r) => r.status === "taken" && !isAR(r.area));
    const kept = results.filter((r) => r.status === "taken" && isAR(r.area));
    const arUpload = kept.length ? await markArKept(kept, by) : null;
    if (!taken.length) {
      if (kept.length) { await notifyArKept(kept); await afterAction(["ar"]); }
      return res.status(200).json({ results, errors, updated: false, kept: kept.length, arUpload });
    }
    const run = await afterExports({ taken, by, extraLines: arLines(kept) });
    if (!run.error) await afterAction(["luminate", "publishing", "ar"]);
    return res.status(run.error ? 502 : 200).json({ results, errors, updated: !run.error, kept: kept.length, arUpload, ...run, error: run.error || undefined });
  } catch (err) {
    console.error("luminate upload failed:", err);
    return res.status(502).json({ error: err.message || "The upload failed. Nothing was changed.", errors });
  }
}
