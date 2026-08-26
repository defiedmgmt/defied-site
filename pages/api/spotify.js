// Resolves a Spotify track link to its title, artist, and cover art.
// Runs server-side because Spotify's track page doesn't send CORS headers,
// so the browser can't read it directly — only this route can fetch it.

function decodeEntities(str) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function metaContent(html, property) {
  const re = new RegExp(`<meta property="${property}" content="([^"]*)"`);
  const m = html.match(re);
  return m ? decodeEntities(m[1]) : "";
}

export default async function handler(req, res) {
  const raw = req.query.url;
  if (!raw || typeof raw !== "string") {
    return res.status(400).json({ error: "Missing Spotify link." });
  }

  const match = raw.match(/track[/:]([a-zA-Z0-9]{22})/);
  if (!match) {
    return res.status(400).json({ error: "That doesn't look like a Spotify song link." });
  }
  const trackId = match[1];
  const canonical = `https://open.spotify.com/track/${trackId}`;

  try {
    const pageRes = await fetch(canonical, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DefiedSite/1.0)" },
    });
    if (!pageRes.ok) {
      return res.status(404).json({ error: "Couldn't find that track on Spotify." });
    }
    const html = await pageRes.text();

    const title = metaContent(html, "og:title");
    const description = metaContent(html, "og:description");
    const image = metaContent(html, "og:image");

    if (!title) {
      return res.status(404).json({ error: "Couldn't read that track's details." });
    }

    // og:description looks like "Artist · Album · Song · 2017"
    const parts = description.split("·").map((s) => s.trim());
    const artist = parts[0] || "";
    const yearMatch = description.match(/\b(19|20)\d{2}\b/);

    return res.status(200).json({
      title,
      artist,
      cover: image || "",
      releaseDate: yearMatch ? `${yearMatch[0]}-01-01` : "",
      link: canonical,
    });
  } catch (err) {
    return res.status(502).json({ error: "Spotify lookup failed." });
  }
}
