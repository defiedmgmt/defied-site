-- 2026-11-26 (review): the notable releases keep their order. The table had no order of its own, so the list came back in the order the rows
-- happen to be stored, and that order decides what the public site shows: the About page's first releases are its large featured cards, and an
-- artist's panel lists their releases in this order. A save writes a changed row again, which moved it to the end of the stored order, so fixing one
-- release's cover could take it out of the featured pair. sort_order is that order now: a save sends the list in order (Site › Website › Notable
-- releases, which can move a release up or down) and each row keeps its place. Filled once from the order they're stored in today (the order every
-- page shows now). NULL (a row from before, or one added another way) goes last. Additive and idempotent, as 022's sort_order on staff_bios.
ALTER TABLE notable_releases ADD COLUMN IF NOT EXISTS sort_order integer;
UPDATE notable_releases n SET sort_order = o.n FROM (SELECT id, (row_number() OVER (ORDER BY ctid))::int - 1 AS n FROM notable_releases) o WHERE n.id = o.id AND n.sort_order IS NULL;
