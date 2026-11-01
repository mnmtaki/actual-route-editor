-- AARC-style per-user allow/deny rules overlay the visibility shortcuts.
CREATE TABLE cloud_project_access_rules (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES cloud_projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    action VARCHAR(8) NOT NULL CHECK (action IN ('view','edit')),
    allowed BOOLEAN NOT NULL,
    UNIQUE(project_id,user_id,action)
);
CREATE INDEX idx_project_access_rules_user ON cloud_project_access_rules(user_id,project_id);

-- Rule precedence: owner > explicit per-user view denial > explicit edit
-- grant/denial > public default. Explicit edit grant also grants visibility
-- unless a view denial exists. Anonymous users never receive edit access.
CREATE FUNCTION project_can_access(project UUID, requester UUID, operation TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
    SELECT CASE
      WHEN p.owner_id = requester THEN TRUE
      WHEN operation = 'view' THEN
        COALESCE(v.allowed, COALESCE(e.allowed,FALSE) OR p.visibility IN ('public_view','public_edit'))
      WHEN operation = 'edit' THEN
        requester IS NOT NULL AND COALESCE(v.allowed, TRUE)
          AND COALESCE(e.allowed, p.visibility='public_edit')
      ELSE FALSE END
    FROM cloud_projects p
    LEFT JOIN cloud_project_access_rules v
       ON v.project_id=p.id AND v.user_id=requester AND v.action='view'
    LEFT JOIN cloud_project_access_rules e
       ON e.project_id=p.id AND e.user_id=requester AND e.action='edit'
    WHERE p.id=project;
$$;
