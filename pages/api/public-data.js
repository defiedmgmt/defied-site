// Unauthenticated — served to every visitor of the public marketing pages
// (Home/About/Roster/Staff). Only ever returns fields those pages actually
// render: on-roster client bios/socials, each client's *notable* placements
// (title/artist/cover/link only — never splits, streams, revenue, or any
// other client's data), staff bios, the About text, and the curated notable-
// releases list. No splits, no financials, no user data, ever, by construction
// — there is no code path here that could accidentally leak them.
import { loadPublicData } from "../../lib/public-data";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  try {
    return res.status(200).json(await loadPublicData());
  } catch (err) {
    // this route is unauthenticated — never echo the real error (could be a
    // raw Postgres error revealing schema/connection details) to an anonymous
    // caller; log it server-side for debugging instead.
    console.error("public-data failed:", err);
    return res.status(502).json({ error: "Failed to load public data." });
  }
}
