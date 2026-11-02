-- Append-only compensations; snapshots are retained independently of the
-- ten most recent full-document revisions.
CREATE TABLE cloud_station_undo_entries (
    project_id UUID NOT NULL REFERENCES cloud_projects(id) ON DELETE CASCADE,
    operation_id UUID NOT NULL,
    actor_id UUID NOT NULL REFERENCES app_users(id),
    station_id VARCHAR(128) NOT NULL,
    action VARCHAR(40) NOT NULL CHECK (action IN ('station.rename','station.move')),
    before_station JSONB NOT NULL,
    after_station JSONB NOT NULL,
    undone BOOLEAN NOT NULL DEFAULT FALSE,
    state_revision BIGINT NOT NULL,
    PRIMARY KEY (project_id, operation_id)
);
CREATE INDEX idx_cloud_station_undo_actor
    ON cloud_station_undo_entries(project_id,actor_id,state_revision DESC);
ALTER TABLE cloud_project_operations DROP CONSTRAINT cloud_project_operations_action_check;
ALTER TABLE cloud_project_operations ADD CONSTRAINT cloud_project_operations_action_check
    CHECK (action IN ('station.create','station.rename','station.move',
                     'segment.waypoint.move','line.append-existing','segment.split-station',
                     'line.remove-middle-station','station.undo','station.redo'));
