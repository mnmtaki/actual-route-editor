CREATE TABLE cloud_project_members (
    project_id UUID NOT NULL REFERENCES cloud_projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(project_id,user_id)
);
CREATE INDEX idx_cloud_project_members_user ON cloud_project_members(user_id);
