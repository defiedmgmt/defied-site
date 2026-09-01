// Server-only Postgres access — never imported from components/App.jsx
// directly, same boundary as lib/sheets.js. Uses Neon's HTTP driver (not raw
// `pg` over TCP) so this is safe to call from serverless functions without
// risking connection-pool exhaustion under concurrent invocations.
import { neon } from "@neondatabase/serverless";

let client = null;
function getClient() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not configured.");
    client = neon(url);
  }
  return client;
}
export function sql(strings, ...values) {
  return getClient()(strings, ...values);
}
// neon()'s own returned function carries a .transaction property (batches
// several sql`...` query objects into one atomic Postgres transaction over
// HTTP) — this wrapper is a different function object, so it doesn't get
// that for free and has to forward it explicitly.
sql.transaction = (...args) => getClient().transaction(...args);
