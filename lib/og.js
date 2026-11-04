// A page's og tags (Spotify's track and artist pages, an Instagram profile), read server-side.
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

export function decodeEntities(str) {
  return str.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z][a-z0-9]*));/gi, (m, dec, hex, name) => {
    if (name) return Object.hasOwn(ENTITIES, name) ? ENTITIES[name] : m;
    const cp = dec ? parseInt(dec, 10) : parseInt(hex, 16);
    // NUL, surrogates and anything past Unicode aren't characters: leave those alone too
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m;
  });
}

export function metaContent(html, property) {
  const re = new RegExp(`<meta property="${property}" content="([^"]*)"`);
  const m = html.match(re);
  return m ? decodeEntities(m[1]) : "";
}
