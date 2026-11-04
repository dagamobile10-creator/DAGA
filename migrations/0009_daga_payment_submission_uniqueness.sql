PRAGMA foreign_keys = ON;

-- A single order can have at most one payment awaiting owner review.
-- Partial uniqueness avoids blocking historical rows that were already reviewed.
CREATE UNIQUE INDEX IF NOT EXISTS daga_payment_one_pending_submission_per_order
  ON daga_payment_submissions(order_id)
  WHERE status = 'pending_review';
