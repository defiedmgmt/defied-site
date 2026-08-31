// Server-only Postgres access — never imported from components/App.jsx
// directly, same boundary as lib/sheets.js. Uses Neon's HTTP driver (not raw
// `pg` over TCP) so this is safe to call from serverless functions without
// risking connection-pool exhaustion under concurrent invocations.
import { neon } from "@neondatabase/serverless";

let client = null;
export function sql(strings, ...values) {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not configured.");
    client = neon(url);
  }
  return client(strings, ...values);
}
