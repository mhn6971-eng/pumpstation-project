-- 0006: keep alert history, but close duplicate open rows before enforcing uniqueness.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tag, param, day
           ORDER BY (seen_at <> '') DESC, id DESC
         ) AS rn
  FROM alerts
  WHERE acted_at = '' AND resolved_at = ''
)
UPDATE alerts AS a
SET resolved_at = COALESCE(NULLIF(a.at, ''), 'deduplicated')
FROM ranked AS r
WHERE a.id = r.id AND r.rn > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS alerts_open_cell_uq
  ON alerts (tag, param, day)
  WHERE acted_at = '' AND resolved_at = '';
