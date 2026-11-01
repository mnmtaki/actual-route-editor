-- Line topology append is a strict exact-revision operation, never rebased.
-- Preserve earlier Flyway checksums by introducing a new migration.
ALTER TABLE cloud_project_operations DROP CONSTRAINT cloud_project_operations_action_check;
ALTER TABLE cloud_project_operations ADD CONSTRAINT cloud_project_operations_action_check
    CHECK (action IN ('station.create','station.rename','station.move',
                     'segment.waypoint.move','line.append-existing'));
