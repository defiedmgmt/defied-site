// The public site's data (list B #11: shared by /api/public-data and the public pages'
// getServerSideProps, which render it into the page's HTML). Unauthenticated — served to every visitor
// of the public marketing pages (Home/About/Roster/Staff). Only ever returns fields those pages actually
// render: on-roster client bios/socials, each client's *notable* placements
// (title/artist/cover/link only — never splits, streams, revenue, or any
// other client's data), staff bios, the About text, and the curated notable-
// releases list. No splits, no financials, no user data, ever, by construction
// — there is no code path here that could accidentally leak them.
import { sql } from "./db";

function toPublicClient(row) {
  return {
    id: row.id, name: row.name, role: row.role, bio: row.bio, photo: row.photo,
    spotify: row.spotify, apple: row.apple, instagram: row.instagram,
    tiktok: row.tiktok, youtube: row.youtube, soundcloud: row.soundcloud,
  };
}

export async function loadPublicData() {
  const [clients, notablePlacements, staff, notableReleases, [settings]] = await Promise.all([
    sql`SELECT * FROM clients WHERE on_roster = true ORDER BY roster_order`,
    sql`SELECT id, client_id, song, artist, cover, link FROM placements WHERE notable = true`,
    sql`SELECT id, name, role, bio, photo, email, instagram FROM staff_bios`,
    sql`SELECT id, song, artist, client, cover, release_date, link FROM notable_releases`,
    sql`SELECT about_text FROM site_settings WHERE id = 1`,
  ]);
  // an off-roster client's songs are never shown, so they never leave the
  // server (their covers alone were most of this payload)
  const onRoster = new Set(clients.map((c) => c.id));
  return {
    clients: clients.map(toPublicClient),
    notablePlacements: notablePlacements.filter((p) => onRoster.has(p.client_id)).map((p) => ({ id: p.id, clientId: p.client_id, song: p.song, artist: p.artist, cover: p.cover, link: p.link })),
    staff,
    notableReleases: notableReleases.map((n) => ({ id: n.id, song: n.song, artist: n.artist, client: n.client, cover: n.cover, releaseDate: n.release_date, link: n.link })),
    about: settings.about_text,
  };
}

// a public page's getServerSideProps: the same payload /api/public-data sends (JSON round trip, so dates
// are the same strings the browser gets from the API). A failed read draws the page the way it was before
// server rendering: without data, which the browser then fetches itself (and says so if it can't).
export async function publicPageProps() {
  try {
    return { props: { publicData: JSON.parse(JSON.stringify(await loadPublicData())) } };
  } catch (err) {
    console.error("public page data failed:", err);
    return { props: { publicData: null } };
  }
}
