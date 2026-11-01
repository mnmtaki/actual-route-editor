-- Replace invitation-based collaboration with project-wide visibility.
-- Existing invitations are deliberately discarded; access is now governed
-- exclusively by the owner-controlled visibility setting.
ALTER TABLE cloud_projects ADD COLUMN visibility VARCHAR(20) NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private','public_view','public_edit'));
DROP TABLE IF EXISTS cloud_project_members;
CREATE INDEX idx_cloud_projects_public ON cloud_projects(updated_at DESC)
    WHERE visibility IN ('public_view','public_edit');
