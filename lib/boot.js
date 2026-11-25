// (2026-11-24, speed) One request for a dashboard page's first reads. A page made 12-14 calls in three steps (the sign-in, then the
// dataset, then the counts and the section's own reads), each its own function that could wake up cold (1-2 s on 11-24). GET /api/boot
// takes the reads the page is about to make (?u=/api/home&u=/api/tasks…, only the ones its table lists) and runs THE ROUTES THEMSELVES
// in-process, side by side: each one's own handler with this request's cookie, method GET and that URL's query, so every role check,
// limit and redaction is that route's own code, unchanged. The answer is one JSON line per read, written as soon as that read is done
// (application/x-ndjson): { u, s (its status), ms, b (its JSON) }. A read that never answers (the function ended) is simply missing: the
// page then makes that call itself, as before. Server-only.
import { SESSION_MEMO, getCurrentSession } from "./session";
import { ACCESS_MEMO, loadAccess } from "./access";

export const MAX_PARTS = 16;

// the table a route hands runBoot: each listed URL -> [its handler, the query that URL gives (as Next parses it)]
export function partTable(list) {
  return Object.fromEntries(list.map(([url, handler]) => [url, [handler, Object.fromEntries(new URL(url, "http://boot.local").searchParams)]]));
}

// the reads a request lists, each one the table has, once, in the order asked; anything else is dropped
export function partsOf(query, table) {
  const out = [];
  for (const u of [].concat(query?.u ?? []).map(String)) if (Object.prototype.hasOwnProperty.call(table, u) && !out.includes(u)) out.push(u);
  return out.slice(0, MAX_PARTS);
}

// what one read answers when it runs in-process: its status and its JSON text, nothing sent anywhere. Cookies a read sets are not
// passed on (the session check that can end a cookie runs once, on the boot request itself, before any read starts).
export function partRes() {
  const headers = {};
  let text, done = false, settle;
  const settled = new Promise((r) => { settle = r; });
  const chunks = [];
  const finish = () => { if (!done) { done = true; settle(); } };
  const res = {
    statusCode: 200,
    settled,
    get done() { return done; },
    get text() { return text; },
    get headersSent() { return done; },
    get writableEnded() { return done; },
    status(code) { res.statusCode = Number(code) || 500; return res; },
    setHeader(k, v) { headers[String(k).toLowerCase()] = v; return res; },
    getHeader(k) { return headers[String(k).toLowerCase()]; },
    getHeaders() { return { ...headers }; },
    hasHeader(k) { return Object.prototype.hasOwnProperty.call(headers, String(k).toLowerCase()); },
    removeHeader(k) { delete headers[String(k).toLowerCase()]; return res; },
    writeHead(code, h) { res.status(code); if (h && typeof h === "object") for (const [k, v] of Object.entries(h)) res.setHeader(k, v); return res; },
    // as Next's res.json: the JSON is taken when it's called (a later change to the object isn't sent)
    json(body) { if (!done) { text = body === undefined ? undefined : JSON.stringify(body); finish(); } return res; },
    send(body) {
      if (done) return res;
      if (body !== null && typeof body === "object" && !Buffer.isBuffer(body)) return res.json(body);
      const t = body == null ? "" : String(body);
      try { JSON.parse(t); text = t; } catch { text = t ? JSON.stringify({ text: t }) : undefined; }
      finish();
      return res;
    },
    write(c) { if (!done && c != null) chunks.push(String(c)); return true; },
    end(c) { if (done) return res; if (c != null) chunks.push(String(c)); return chunks.length ? res.send(chunks.join("")) : (finish(), res); },
    flush() {},
  };
  return res;
}

// one read: its own handler, this request's headers (the cookie), method GET and the URL's own query, and the boot's one session check
export async function runPart(url, entry, req, memo) {
  const t0 = Date.now();
  const [handler, query] = entry;
  const preq = { method: "GET", url, query: { ...query }, headers: req.headers, cookies: req.cookies || {}, body: undefined, socket: req.socket, connection: req.socket, [SESSION_MEMO]: memo.session, [ACCESS_MEMO]: memo.access };
  const pres = partRes();
  try {
    await handler(preq, pres);
  } catch (err) {
    console.error(`boot: ${url} failed:`, err);
    if (!pres.done) pres.status(500).json({ error: "Couldn't load that. Try again in a minute." });
  }
  if (!pres.done) return { u: url, s: 500, ms: Date.now() - t0, text: JSON.stringify({ error: "That read didn't answer." }) };
  return { u: url, s: pres.statusCode, ms: Date.now() - t0, text: pres.text };
}
export const lineOf = (p) => `{"u":${JSON.stringify(p.u)},"s":${Number(p.s) || 500},"ms":${Number(p.ms) || 0}${p.text !== undefined ? `,"b":${p.text}` : ""}}\n`;

export async function runBoot(req, res, table) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const urls = partsOf(req.query, table);
  if (!urls.length) return res.status(400).json({ error: "Nothing to read." });
  // the session, once, on this request: an account that's gone (or a password changed since) clears the cookie on this answer,
  // before anything is written. A check that failed (the database) is each read's own 503, as on its own request.
  const session = getCurrentSession(req, res);
  await session.catch(() => null);
  // the account's access, read once and only if a read asks (a staff session), a fresh copy for each read
  let access = null;
  const memo = {
    session,
    access: async (user) => {
      const s = await session;
      if (!s?.user || !user || s.user.id !== user.id) return loadAccess(user);
      access = access || loadAccess(s.user);
      return structuredClone(await access);
    },
  };
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store");
  res.statusCode = 200;
  await Promise.all(urls.map((u) => runPart(u, table[u], req, memo).then((p) => {
    try { res.write(lineOf(p)); res.flush?.(); } catch (err) { console.error("boot: couldn't write", u, err?.message || err); }
  })));
  res.end();
}
