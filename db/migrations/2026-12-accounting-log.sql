-- One-click logging of Stripe payments into the accounting sheet (dashboard, lib/accounting-log.js).
-- One new table only, so running it again is harmless. One row per Stripe payment id: the claim that
-- stops a double click or a second tab from logging it twice, then the Income row it went to. No
-- foreign keys, and nothing into placements.
CREATE TABLE IF NOT EXISTS accounting_log (
  payment_id text PRIMARY KEY,                -- Stripe's id: an application fee (fee_…) or a charge (ch_…)
  claim text NOT NULL,                        -- the request holding it; a takeover must name the old one
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  day text NOT NULL,                          -- the payment's New York day, YYYY-MM-DD
  amount_cents integer NOT NULL,              -- the Gross Commission written (the full amount paid)
  client text NOT NULL DEFAULT '',            -- as written in Artist / Client
  sheet_row integer,                          -- the Income row it was written to
  row_values jsonb,                           -- A:J as sent (null = a formula cell left alone)
  by_name text NOT NULL DEFAULT '',
  claimed_at timestamptz NOT NULL DEFAULT now(),
  logged_at timestamptz
);
