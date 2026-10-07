-- "Monetized" label Meta shows beside "See post" on some Content Protection matches. 1 when the
-- label was on the page at the latest pull, NULL otherwise (its absence isn't treated as a
-- confirmed "not monetized"). Always the latest pull's value, like takedown_status.
ALTER TABLE data_pulls ADD COLUMN is_monetized INTEGER;
