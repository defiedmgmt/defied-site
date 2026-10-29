// Luminate portfolio exports dropped on the dashboard: checked, kept, then
// the sheet and every client's numbers are updated (see lib/luminate-run.js).
// Replaces "drag the CSVs into the Drive folder, then press ⟳ UPDATE"; that
// route still works and writes the same STREAM DATA rows.
import { requireStaff, requireSameOrigin } from "../../lib/session";
import { parseExport, takeExports, previewLinks } from "../../lib/luminate";
import { afterExports } from "../../lib/luminate-run";

// a 100-song portfolio export is ~30 KB; this leaves room for several at once
export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const session = await requireStaff(req, res);
  if (!session) return;
  if (!requireSameOrigin(req, res)) return;
  const files = Array.isArray(req.body?.files) ? req.body.files.slice(0, 20) : [];
  if (!files.length) return res.status(400).json({ error: "No files came through. Drop the CSVs again." });

  const errors = [], parsed = [];
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
    const results = await takeExports(parsed, { by, force: !!req.body?.force, dryRun });
    // a dry run: what this drop would do, with nothing written anywhere
    if (dryRun) {
      const ready = [...newest.values()].filter((p) => results.some((r) => r.fileName === p.fileName && r.status === "ready"));
      const links = ready.length ? await previewLinks(ready) : [];
      return res.status(200).json({ preview: true, results, errors, links: links.filter((l) => !l.copied), copied: links.filter((l) => l.copied) });
    }
    const taken = results.filter((r) => r.status === "taken");
    if (!taken.length) return res.status(200).json({ results, errors, updated: false });
    const run = await afterExports({ taken, by });
    return res.status(run.error ? 502 : 200).json({ results, errors, updated: !run.error, ...run, error: run.error || undefined });
  } catch (err) {
    console.error("luminate upload failed:", err);
    return res.status(502).json({ error: err.message || "The upload failed. Nothing was changed.", errors });
  }
}
