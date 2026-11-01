CREATE TABLE cloud_project_operations (
    project_id UUID NOT NULL REFERENCES cloud_projects(id) ON DELETE CASCADE,
    operation_id UUID NOT NULL,
    revision BIGINT NOT NULL,
    actor_id UUID NOT NULL REFERENCES app_users(id),
    action VARCHAR(40) NOT NULL CHECK (action IN ('station.create','station.rename','station.move')),
    station_id VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, operation_id)
);
CREATE INDEX idx_cloud_project_operations_project_revision
    ON cloud_project_operations(project_id,revision DESC);
