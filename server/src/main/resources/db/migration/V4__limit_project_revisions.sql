-- Retain the latest ten snapshots per project for pre-existing data.
-- Revision counters in cloud_projects never change: missing revision numbers
-- refer to deliberately pruned historical snapshots (HTTP 404 on read).
WITH ordered AS (
    SELECT project_id, revision,
           ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY revision DESC) AS rank
    FROM cloud_project_revisions
)
DELETE FROM cloud_project_revisions AS history
USING ordered
WHERE history.project_id = ordered.project_id
  AND history.revision = ordered.revision
  AND ordered.rank > 10;
