// The one authenticated data endpoint the whole staff/client dashboard reads
// from and writes through — replaces the old client-side `db` object that
// used to ship in the JS bundle and live in localStorage. A client session
// only ever receives their own client record + their own placements, with
// revenue/admin_fee/luminate_id stripped (the old client UI just didn't
// *render* those fields — the data was always present regardless of role,
// which is exactly the gap this closes). Nothing here is reachable without
// a valid session.
import bcrypt from "bcryptjs";
import { sql } from "../../lib/db";
import { requireUser, requireSameOrigin } from "../../lib/session";

function toClient(row) {
  return {
    id: row.id, name: row.name, role: row.role, credit: row.credit, bio: row.bio, photo: row.photo,
    spotify: row.spotify, apple: row.apple, instagram: row.instagram, tiktok: row.tiktok,
    youtube: row.youtube, soundcloud: row.soundcloud, sheetTabName: row.sheet_tab_name,
    totalStreams: Number(row.total_streams), onRoster: row.on_roster,
  };
}
function toPlacement(row, { redact } = {}) {
  const base = {
    id: row.id, clientId: row.client_id, song: row.song, artist: row.artist,
    releaseDate: row.release_date, link: row.link, cover: row.cover, notable: row.notable,
    splits: row.splits, streams: Number(row.streams),
  };
  if (redact) return base; // no revenue, admin_fee, or luminate_id for a client session
  return { ...base, luminateId: row.luminate_id, revenue: Number(row.revenue), adminFee: Number(row.admin_fee) };
}
function toStaffBio(row) {
  return { id: row.id, name: row.name, role: row.role, credit: row.credit, bio: row.bio, photo: row.photo, email: row.email, instagram: row.instagram };
}
function toUser(row) {
  // never send password_hash to the client, ever — not even to a staff session
  return { id: row.id, email: row.email, role: row.role, name: row.name, clientId: row.client_id };
}
function toSubmission(row) {
  return { id: row.id, name: row.name, email: row.email, subject: row.subject, message: row.message, at: row.created_at, read: row.read };
}
function toNotable(row) {
  return { id: row.id, song: row.song, artist: row.artist, client: row.client, cover: row.cover, releaseDate: row.release_date, link: row.link };
}

async function handleGet(req, res, session) {
  const { role, clientId } = session.user;

  if (role === "staff") {
    const [clients, placements, staff, users, submissions, notableReleases, [settings]] = await Promise.all([
      sql`SELECT * FROM clients ORDER BY roster_order`,
      sql`SELECT * FROM placements`,
      sql`SELECT * FROM staff_bios`,
      sql`SELECT * FROM users`,
      sql`SELECT * FROM submissions ORDER BY created_at DESC`,
      sql`SELECT * FROM notable_releases`,
      sql`SELECT about_text, last_synced_at FROM site_settings WHERE id = 1`,
    ]);
    return res.status(200).json({
      role: "staff",
      clients: clients.map(toClient),
      placements: placements.map((p) => toPlacement(p)),
      staff: staff.map(toStaffBio),
      users: users.map(toUser),
      submissions: submissions.map(toSubmission),
      notableReleases: notableReleases.map(toNotable),
      site: { about: settings.about_text },
      sheetSync: { lastSyncedAt: settings.last_synced_at },
    });
  }

  // client: own record + own placements only, redacted
  const [clients, placements, [settings]] = await Promise.all([
    sql`SELECT * FROM clients WHERE id = ${clientId}`,
    sql`SELECT * FROM placements WHERE client_id = ${clientId}`,
    sql`SELECT last_synced_at FROM site_settings WHERE id = 1`,
  ]);
  if (!clients[0]) return res.status(404).json({ error: "Client record not found." });
  return res.status(200).json({
    role: "client",
    client: toClient(clients[0]),
    placements: placements.map((p) => toPlacement(p, { redact: true })),
    sheetSync: { lastSyncedAt: settings.last_synced_at },
  });
}

// Mirrors the old commit({...db, someKey: newValue}) shape: the body may
// contain any subset of these keys, each fully replacing that table (or,
// for a client session, just their own slice of placements). Low write
// volume, small dataset, single-writer-at-a-time in practice — full-table
// replace per key is simpler and safer here than diffing/patching, and is
// still strictly more consistent than the old one-copy-per-browser model.
async function handlePost(req, res, session) {
  if (!requireSameOrigin(req, res)) return;
  const { role, clientId } = session.user;
  const body = req.body || {};

  if (role !== "staff") {
    // the frontend's commit() always sends the full {...db, changedKey}
    // spread, so other keys (role, client, sheetSync) will be present —
    // that's fine, only placements is ever actually written for a client;
    // everything else in the body is silently ignored, never applied.
    if (!Array.isArray(body.placements)) return res.status(400).json({ error: "placements[] is required." });
    // reject outright rather than silently filtering: a payload carrying
    // someone else's clientId (forged, or a stale/buggy client state) must
    // never be allowed to fall through to a full delete-and-replace of this
    // client's own rows with an incomplete list — that would silently wipe
    // real placements instead of just failing loudly.
    if (body.placements.some((p) => p.clientId !== clientId)) {
      return res.status(403).json({ error: "Placement clientId mismatch." });
    }
    const mine = body.placements;
    await sql`DELETE FROM placements WHERE client_id = ${clientId}`;
    for (const p of mine) {
      await sql`
        INSERT INTO placements (id, client_id, song, artist, release_date, link, cover, notable, luminate_id, streams, revenue, admin_fee, splits)
        VALUES (${p.id}, ${clientId}, ${p.song || ""}, ${p.artist || ""}, ${p.releaseDate || ""}, ${p.link || ""}, ${p.cover || ""}, ${!!p.notable}, ${p.luminateId || ""}, ${p.streams || 0}, ${p.revenue || 0}, ${p.adminFee || 0}, ${JSON.stringify(p.splits || [])})
      `;
    }
    return res.status(200).json({ ok: true });
  }

  if ("placements" in body) {
    await sql`DELETE FROM placements`;
    for (const p of body.placements) {
      await sql`
        INSERT INTO placements (id, client_id, song, artist, release_date, link, cover, notable, luminate_id, streams, revenue, admin_fee, splits)
        VALUES (${p.id}, ${p.clientId}, ${p.song || ""}, ${p.artist || ""}, ${p.releaseDate || ""}, ${p.link || ""}, ${p.cover || ""}, ${!!p.notable}, ${p.luminateId || ""}, ${p.streams || 0}, ${p.revenue || 0}, ${p.adminFee || 0}, ${JSON.stringify(p.splits || [])})
      `;
    }
  }
  if ("clients" in body) {
    await sql`DELETE FROM clients`;
    for (let i = 0; i < body.clients.length; i++) {
      const c = body.clients[i];
      await sql`
        INSERT INTO clients (id, name, role, credit, bio, photo, spotify, apple, instagram, tiktok, youtube, soundcloud, sheet_tab_name, total_streams, on_roster, roster_order)
        VALUES (${c.id}, ${c.name}, ${c.role || ""}, ${c.credit || ""}, ${c.bio || ""}, ${c.photo || ""}, ${c.spotify || ""}, ${c.apple || ""}, ${c.instagram || ""}, ${c.tiktok || ""}, ${c.youtube || ""}, ${c.soundcloud || ""}, ${c.sheetTabName || ""}, ${c.totalStreams || 0}, ${!!c.onRoster}, ${i})
      `;
    }
  }
  if ("staff" in body) {
    await sql`DELETE FROM staff_bios`;
    for (const s of body.staff) {
      await sql`
        INSERT INTO staff_bios (id, name, role, credit, bio, photo, email, instagram)
        VALUES (${s.id}, ${s.name || ""}, ${s.role || ""}, ${s.credit || ""}, ${s.bio || ""}, ${s.photo || ""}, ${s.email || ""}, ${s.instagram || ""})
      `;
    }
  }
  if ("users" in body) {
    // password_hash is never sent to the client (see toUser), so UsersAdmin's
    // edit form only ever carries a plaintext `password` field when someone
    // actually typed a new one — blank means "keep the existing hash". A
    // brand-new user (no existing hash) requires a password to be created at
    // all; one submitted with no password is silently skipped rather than
    // created with no way to log in.
    const existing = await sql`SELECT id, password_hash FROM users`;
    const hashById = Object.fromEntries(existing.map((u) => [u.id, u.password_hash]));
    await sql`DELETE FROM users`;
    for (const u of body.users) {
      let hash = hashById[u.id];
      if (u.password && u.password.trim()) hash = await bcrypt.hash(u.password.trim(), 12);
      if (!hash) continue;
      await sql`
        INSERT INTO users (id, email, password_hash, role, name, client_id)
        VALUES (${u.id}, ${u.email.toLowerCase()}, ${hash}, ${u.role}, ${u.name || ""}, ${u.clientId || null})
      `;
    }
  }
  if ("submissions" in body) {
    await sql`DELETE FROM submissions`;
    for (const s of body.submissions) {
      await sql`
        INSERT INTO submissions (id, name, email, subject, message, created_at, read)
        VALUES (${s.id}, ${s.name || ""}, ${s.email || ""}, ${s.subject || ""}, ${s.message || ""}, ${s.at || new Date().toISOString()}, ${!!s.read})
      `;
    }
  }
  if ("notableReleases" in body) {
    await sql`DELETE FROM notable_releases`;
    for (const n of body.notableReleases) {
      await sql`
        INSERT INTO notable_releases (id, song, artist, client, cover, release_date, link)
        VALUES (${n.id}, ${n.song || ""}, ${n.artist || ""}, ${n.client || ""}, ${n.cover || ""}, ${n.releaseDate || ""}, ${n.link || ""})
      `;
    }
  }
  if (body.site) {
    await sql`UPDATE site_settings SET about_text = ${body.site.about || ""} WHERE id = 1`;
  }
  if (body.sheetSync) {
    await sql`UPDATE site_settings SET last_synced_at = ${body.sheetSync.lastSyncedAt || null} WHERE id = 1`;
  }

  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  const session = await requireUser(req, res);
  if (!session) return;
  if (req.method === "GET") return handleGet(req, res, session);
  if (req.method === "POST") return handlePost(req, res, session);
  return res.status(405).json({ error: "GET or POST only" });
}
