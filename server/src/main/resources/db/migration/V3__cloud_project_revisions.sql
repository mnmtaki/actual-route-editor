-- Backfill existing current snapshots. Revisions older than this migration
-- cannot be reconstructed because the old schema stored only the latest JSON.
CREATE TABLE cloud_project_revisions (
    project_id UUID NOT NULL REFERENCES cloud_projects(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL CHECK (revision >= 1),
    name VARCHAR(200) NOT NULL,
    document JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, revision)
);
INSERT INTO cloud_project_revisions(project_id, revision, name, document, created_at)
SELECT id, revision, name, document, updated_at FROM cloud_projects;
