-- Roles and permissions (list B #1). Additive only, and safe to run again: every column is
-- ADD COLUMN IF NOT EXISTS, and the two UPDATEs only fill a role that isn't set yet.
--
-- users.role stays "staff" / "client" (the sign-in and the session don't change). A staff account
-- also gets one of three presets (lib/access.js):
--   founder    everything
--   comanager  everything except Money and Users (user management); optionally only their own artists
--   intern     Site only
-- NULL means "not set yet": a Co-manager once any Founder exists, else a Founder (so a database where
-- nobody is a Founder yet, the harness's for one, keeps working exactly as before).
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_role text;
-- Per-user changes on top of the preset, set by a Founder in Site > Users:
--   { "sections": { "money": true, "ar": false, ... }, "ownOnly": true }
ALTER TABLE users ADD COLUMN IF NOT EXISTS access jsonb NOT NULL DEFAULT '{}'::jsonb;
-- Each client's manager, from the accounting sheet's INFO tab ("Assigned Manager"): what a
-- Co-manager limited to their own artists is matched on (their account's name). '' = none.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS manager text NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS manager_at timestamptz;

-- The owner's decision (2026-11-04): the Founders are Devin, Burny and Hank; every other staff account
-- is a Co-manager. Matched by the live accounts' ids and emails, and only where no role is set yet,
-- so a role a Founder changes later is never put back.
UPDATE users SET staff_role = 'founder'
  WHERE role = 'staff' AND staff_role IS NULL
    AND (id IN ('jcypmfil', 'wo3ufb3w', '1l4mirtq')
      OR lower(email) IN ('devin@defiedmgmt.com', 'hank@defiedmgmt.com', 'burnymadeit@gmail.com'));
UPDATE users SET staff_role = 'comanager'
  WHERE role = 'staff' AND staff_role IS NULL
    AND EXISTS (SELECT 1 FROM users f WHERE f.staff_role = 'founder');
