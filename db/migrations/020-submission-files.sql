-- 2026-11-10 (the owner: music files on website submissions, "maybe like 5 max", kept in Dropbox): a message's optional
-- music link, its files ([{ name, size, url }] once uploaded: shared links to the Defied Submissions app folder),
-- where the upload got to ('' none, 'uploading', 'done', 'partial', 'failed') and the ClickUp post to update with
-- the links. contact_attempts.files counts the files each attempt asked for (a per-visitor daily cap).
-- Additive and idempotent: new columns with defaults on two old tables, no backfill.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS music_link text NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS files jsonb NOT NULL DEFAULT '[]';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS files_status text NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS clickup_message_id text NOT NULL DEFAULT '';
ALTER TABLE contact_attempts ADD COLUMN IF NOT EXISTS files integer NOT NULL DEFAULT 0;
