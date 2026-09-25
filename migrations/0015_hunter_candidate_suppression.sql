-- Phase 2 (Manual Hunt) needs a way to record WHY a candidate is being kept out of normal review
-- without losing the discovery history -- two cases from the Phase 2 spec: the source's own YouTube
-- upload showing up as a "candidate" of itself, and a candidate whose channel is on the allowlist.
-- Neither fits review_status (that column is reserved for human review decisions -- automation must
-- never write into it), so this is a separate, orthogonal column. NULL means "not suppressed."
ALTER TABLE hunter_candidates ADD COLUMN suppressed_reason TEXT
  CHECK (suppressed_reason IN ('self_source', 'allowlisted_channel'));

CREATE INDEX idx_hunter_candidates_suppressed_reason ON hunter_candidates(suppressed_reason);
