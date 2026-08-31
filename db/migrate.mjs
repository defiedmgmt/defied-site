// One-time migration: loads a real "Export data" JSON dump (see the staff
// sidebar button in components/App.jsx) into the Postgres schema (db/schema.sql).
// Usage: node db/migrate.mjs path/to/export.json
import { readFileSync } from "fs";
import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
  if (m) process.env[m[1]] = m[2].replace(/\\n/g, "\n");
}

const path = process.argv[2];
if (!path) { console.error("usage: node db/migrate.mjs path/to/export.json"); process.exit(1); }
const data = JSON.parse(readFileSync(path, "utf8"));
const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log("wiping existing rows (idempotent — safe to re-run)...");
  await sql`TRUNCATE placements, users, submissions, notable_releases, staff_bios, clients RESTART IDENTITY CASCADE`;

  console.log(`inserting ${data.clients.length} clients...`);
  for (let i = 0; i < data.clients.length; i++) {
    const c = data.clients[i];
    await sql`
      INSERT INTO clients (id, name, role, credit, bio, photo, spotify, apple, instagram, tiktok, youtube, soundcloud, sheet_tab_name, total_streams, on_roster, roster_order)
      VALUES (${c.id}, ${c.name}, ${c.role || ""}, ${c.credit || ""}, ${c.bio || ""}, ${c.photo || ""}, ${c.spotify || ""}, ${c.apple || ""}, ${c.instagram || ""}, ${c.tiktok || ""}, ${c.youtube || ""}, ${c.soundcloud || ""}, ${c.sheetTabName || ""}, ${c.totalStreams || 0}, ${!!c.onRoster}, ${i})
    `;
  }

  console.log(`inserting ${data.placements.length} placements...`);
  for (const p of data.placements) {
    await sql`
      INSERT INTO placements (id, client_id, song, artist, release_date, link, cover, notable, luminate_id, streams, revenue, admin_fee, splits)
      VALUES (${p.id}, ${p.clientId}, ${p.song || ""}, ${p.artist || ""}, ${p.releaseDate || ""}, ${p.link || ""}, ${p.cover || ""}, ${!!p.notable}, ${p.luminateId || ""}, ${p.streams || 0}, ${p.revenue || 0}, ${p.adminFee || 0}, ${JSON.stringify(p.splits || [])})
    `;
  }

  console.log(`inserting ${data.staff.length} staff bios...`);
  for (const s of data.staff) {
    await sql`
      INSERT INTO staff_bios (id, name, role, credit, bio, photo, email, instagram)
      VALUES (${s.id}, ${s.name || ""}, ${s.role || ""}, ${s.credit || ""}, ${s.bio || ""}, ${s.photo || ""}, ${s.email || ""}, ${s.instagram || ""})
    `;
  }

  console.log(`inserting ${data.users.length} users (hashing passwords)...`);
  for (const u of data.users) {
    const hash = await bcrypt.hash(u.password, 12);
    await sql`
      INSERT INTO users (id, email, password_hash, role, name, client_id)
      VALUES (${u.id}, ${u.email.toLowerCase()}, ${hash}, ${u.role}, ${u.name || ""}, ${u.clientId || null})
    `;
  }

  console.log(`inserting ${data.submissions.length} submissions...`);
  for (const s of data.submissions) {
    await sql`
      INSERT INTO submissions (id, name, email, subject, message, created_at, read)
      VALUES (${s.id}, ${s.name || ""}, ${s.email || ""}, ${s.subject || ""}, ${s.message || ""}, ${s.at || new Date().toISOString()}, ${!!s.read})
    `;
  }

  console.log(`inserting ${data.notableReleases.length} notable releases...`);
  for (const n of data.notableReleases) {
    await sql`
      INSERT INTO notable_releases (id, song, artist, client, cover, release_date, link)
      VALUES (${n.id}, ${n.song || ""}, ${n.artist || ""}, ${n.client || ""}, ${n.cover || ""}, ${n.releaseDate || ""}, ${n.link || ""})
    `;
  }

  console.log("updating site settings...");
  await sql`UPDATE site_settings SET about_text = ${data.site?.about || ""}, last_synced_at = ${data.sheetSync?.lastSyncedAt || null} WHERE id = 1`;

  console.log("done.");
}

main().catch((err) => { console.error(err); process.exit(1); });
