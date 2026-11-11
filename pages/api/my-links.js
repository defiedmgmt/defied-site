// POST { platform, value }: a client adds or swaps one of their own links (lib/my-links.js), on their own profile
// only. The tracked links follow at once (syncEntities), so the first reading comes with the next daily update and a
// swapped account's numbers start over (lib/data/engine.js linkSince; a new Spotify artist page, its songs too). Not
// another artist's account.
import { requireUser, requireSameOrigin } from "../../lib/session";
import { sql } from "../../lib/db";
import { myLinkOf, MY_LINKS } from "../../lib/my-links";
import { openShort, shortError } from "../../lib/links/resolve";
import { spotifyId, handleOf, youtubeRef } from "../../lib/data/sources";
import { syncEntities } from "../../lib/data/engine";
import * as D from "../../lib/data/direct";

const refOf = (platform, v) => (platform === "spotify" ? spotifyId(v, "artist") : platform === "youtube" ? youtubeRef(v) : handleOf(v, `${platform}.com`)).toLowerCase();

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const session = await requireUser(req, res);
  if (!session) return;
  if (!requireSameOrigin(req, res)) return;
  const { role, clientId } = session.user;
  if (role !== "client" || !clientId) return res.status(403).json({ error: "This is a client's own page." });
  const { platform, value } = req.body || {};
  if (!MY_LINKS.includes(platform)) return res.status(400).json({ error: "That isn't a link we keep." });
  try {
    let got = myLinkOf(platform, value);
    if (got.short) {
      const o = await openShort(got.short);
      got = o.link ? myLinkOf(platform, o.link.url) : { error: shortError(got.short, o) };
    }
    if (got.error) return res.status(200).json({ ok: false, error: got.error });
    const clients = await sql`SELECT id, name, spotify, instagram, tiktok, youtube FROM clients`;
    const me = clients.find((c) => c.id === clientId);
    if (!me) return res.status(404).json({ error: "Client record not found." });
    const ref = got.ref.toLowerCase();
    if (refOf(platform, me[platform]) === ref) return res.status(200).json({ ok: true, platform, value: me[platform], url: got.url, same: true });
    if (clients.some((c) => c.id !== clientId && refOf(platform, c[platform]) === ref)) return res.status(200).json({ ok: false, error: "That account is on another artist's profile. If it's yours, ask your manager." });
    let name = "";
    if (platform === "spotify" && D.spotifyConfigured()) {
      const a = await D.spotifyGet(`/artists/${got.ref}`).catch((err) => (/404|not found|invalid/i.test(String(err?.message)) ? { missing: true } : null));
      if (a?.missing || (a && !a.id)) return res.status(200).json({ ok: false, error: "Spotify doesn't know that artist. Copy the link from your artist page again." });
      name = a?.name || "";
    }
    const was = me[platform] || "";
    // one column, picked from the four above (never from the request's text)
    if (platform === "spotify") await sql`UPDATE clients SET spotify = ${got.store} WHERE id = ${clientId}`;
    else if (platform === "instagram") await sql`UPDATE clients SET instagram = ${got.store} WHERE id = ${clientId}`;
    else if (platform === "tiktok") await sql`UPDATE clients SET tiktok = ${got.store} WHERE id = ${clientId}`;
    else await sql`UPDATE clients SET youtube = ${got.store} WHERE id = ${clientId}`;
    console.log(`my-links: client ${clientId} ${was ? "swapped" : "added"} ${platform}`);
    await syncEntities().catch((err) => console.error("my-links sync:", err));
    return res.status(200).json({ ok: true, platform, value: got.store, url: got.url, name, swapped: !!was });
  } catch (err) {
    console.error("my-links failed:", err);
    return res.status(503).json({ error: "Couldn't save your link. Try again in a minute." });
  }
}
