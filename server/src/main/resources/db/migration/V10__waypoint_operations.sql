-- Existing operation journal is intentionally reused for resource-scoped commands.
-- For segment operations station_id stores "segment:<segment-id>".
ALTER TABLE cloud_project_operations DROP CONSTRAINT cloud_project_operations_action_check;
ALTER TABLE cloud_project_operations ADD CONSTRAINT cloud_project_operations_action_check
    CHECK (action IN ('station.create','station.rename','station.move','segment.waypoint.move'));
