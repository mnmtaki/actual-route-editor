-- Keep the immutable V1-V15 Flyway history unchanged. New native topology
-- commands must be represented in the operation journal's check constraint.
-- PostgreSQL rewrites the permitted action list as one transactional migration.
ALTER TABLE cloud_project_operations
    DROP CONSTRAINT cloud_project_operations_action_check;

ALTER TABLE cloud_project_operations
    ADD CONSTRAINT cloud_project_operations_action_check
    CHECK (action IN (
        'station.create', 'station.rename', 'station.move',
        'segment.waypoint.move', 'line.append-existing',
        'segment.split-station', 'line.remove-middle-station',
        'station.undo', 'station.redo', 'project.save', 'project.restore',
        'line.create', 'line.append-new', 'line.loop-close',
        'line.compound', 'project.atomic'
    ));
