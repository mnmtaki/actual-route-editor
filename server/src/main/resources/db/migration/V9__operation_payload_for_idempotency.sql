-- Preserve Flyway V8 checksum for environments already upgraded.
-- Old operation records without payload cannot be safely replayed; the
-- synthetic empty payload causes a conflict on retry instead of silently
-- accepting a different operation with the same ID.
ALTER TABLE cloud_project_operations
    ADD COLUMN payload JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE cloud_project_operations
    ALTER COLUMN payload DROP DEFAULT;
