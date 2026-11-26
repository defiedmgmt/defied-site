// (2026-11-26, books-1126) Each year's accounting book, the Founders' setting (lib/accounting-books.js). GET: the years worth showing with
// their links, the year to set now (To do's "Set the 2027 book") and whether Money shows its Books button. POST {year, link}: the pasted
// book is checked (this year's tabs and headers, rows of that year, edit access for the site's Google account) and saved; a 400 says what's
// wrong. Founders only (Money access and the Founder role); anyone else 403, clients 401.
import { requireSameOrigin } from "../../lib/session";
import { requireAccess } from "../../lib/access";
import { withSheetsQuick } from "../../lib/sheets";
import { booksState, saveBook } from "../../lib/accounting-books";

// the check reads the pasted book and this year's
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const session = await requireAccess(req, res, "money");
  if (!session) return;
  if (req.access?.role !== "founder") return res.status(403).json({ error: "Only a Founder can set the accounting books." });
  try {
    if (req.method === "GET") return res.status(200).json(await withSheetsQuick(() => booksState()));
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    if (!requireSameOrigin(req, res)) return;
    const r = await saveBook({ year: Number(req.body?.year), link: String(req.body?.link ?? "").slice(0, 500), by: session.user.name || session.user.email || "a Founder" });
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    return res.status(200).json(r);
  } catch (err) {
    console.error("accounting-books failed:", err);
    return res.status(500).json({ error: req.method === "GET" ? "Couldn't load the accounting books. Try again in a minute." : "Couldn't check that book just now. Try again in a minute." });
  }
}
