-- Keep historical orders intact while removing deleted plans from the owner pricing list.
ALTER TABLE daga_plans ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0,1));
