// Resolves a Spotify track link to its title, artist, and cover art.
// Runs server-side because Spotify's track page doesn't send CORS headers,
// so the browser can't read it directly — only this route can fetch it.

// og tags arrive HTML-escaped: "Rock &amp; Roll", "&lt;3", "Beyonc&eacute;",
// "&#8217;". One pass, so "&amp;lt;" correctly stays "&lt;". Names are case
// sensitive (&Eacute; is É); an unknown one is left exactly as written.
// LATIN1 is every named character from 160 to 255, in code point order.
const LATIN1 = ("nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest "
  + "Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig "
  + "agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml").split(" ");
const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  ...Object.fromEntries(LATIN1.map((name, i) => [name, String.fromCharCode(160 + i)])),
  OElig: "\u0152", oelig: "\u0153", Scaron: "\u0160", scaron: "\u0161", Yuml: "\u0178", fnof: "\u0192", circ: "\u02C6", tilde: "\u02DC",
  ensp: "\u2002", emsp: "\u2003", thinsp: "\u2009", zwnj: "\u200C", zwj: "\u200D", lrm: "\u200E", rlm: "\u200F",
  ndash: "\u2013", mdash: "\u2014", lsquo: "\u2018", rsquo: "\u2019", sbquo: "\u201A", ldquo: "\u201C", rdquo: "\u201D", bdquo: "\u201E",
  dagger: "\u2020", Dagger: "\u2021", bull: "\u2022", hellip: "\u2026", permil: "\u2030", prime: "\u2032", Prime: "\u2033",
  lsaquo: "\u2039", rsaquo: "\u203A", oline: "\u203E", euro: "\u20AC", trade: "\u2122",
};

function decodeEntities(str) {
  return str.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z][a-z0-9]*));/gi, (m, dec, hex, name) => {
    if (name) return Object.hasOwn(ENTITIES, name) ? ENTITIES[name] : m;
    const cp = dec ? parseInt(dec, 10) : parseInt(hex, 16);
    // NUL, surrogates and anything past Unicode aren't characters: leave those alone too
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m;
  });
}

function metaContent(html, property) {
  const re = new RegExp(`<meta property="${property}" content="([^"]*)"`);
  const m = html.match(re);
  return m ? decodeEntities(m[1]) : "";
}

import { requireUser } from "../../lib/session";

export default async function handler(req, res) {
  // not sensitive data (public Spotify metadata), but gated anyway so this
  // doesn't sit open as a free-to-use proxy for anyone on the internet —
  // only used within the (staff or client) song-editing flow.
  if (!(await requireUser(req, res))) return;
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
