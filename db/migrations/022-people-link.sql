-- 2026-11-14 (the owner: one person, same info everywhere): the site's logins, the public site (the roster and the
-- team page) and the accounting sheet's INFO tab kept in step both ways (lib/people-link.js). Someone added in one
-- place appears in the others hidden, with no login, until a Founder turns them on. Additive and idempotent:
--   users.email / users.password_hash may be empty (NULL): a person with no login yet. Login, the set-password link
--     and Site › Users treat them that way. Every login that exists keeps both.
--   created_at on users, clients and staff_bios: a dashboard save deletes a row missing from what it sent only when
--     the row is older than the copy the save was built on, so a row the server added meanwhile is never wiped.
--     Rows that exist get the time this runs.
--   clients.info_name: the client's name on INFO once paired, so renaming them on the site doesn't lose their row.
--   staff_bios.user_id: the login a team page entry belongs to ('' = none yet).
--   staff_bios.visible: shown on the public team page. Every entry that exists stays shown.
--   staff_bios.sort_order: the team page's order. A save used to delete every entry and insert them again in order, and
--     the page showed them as stored; a save updates them in place now, so the order is kept here, filled once from
--     the order they're stored in today (the order the page shows). NULL (a row from before, or one the server added)
--     goes last.
-- (DROP NOT NULL only relaxes a rule: it removes no data. scripts/migrate.mjs allows exactly that form.)
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE clients ADD COLUMN IF NOT EXISTS info_name text NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE staff_bios ADD COLUMN IF NOT EXISTS user_id text NOT NULL DEFAULT '';
ALTER TABLE staff_bios ADD COLUMN IF NOT EXISTS visible boolean NOT NULL DEFAULT true;
ALTER TABLE staff_bios ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE staff_bios ADD COLUMN IF NOT EXISTS sort_order integer;
UPDATE staff_bios s SET sort_order = o.n FROM (SELECT id, (row_number() OVER (ORDER BY ctid))::int - 1 AS n FROM staff_bios) o WHERE s.id = o.id AND s.sort_order IS NULL;
