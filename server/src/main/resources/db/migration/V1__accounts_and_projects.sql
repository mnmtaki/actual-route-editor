CREATE TABLE app_users (
  id UUID PRIMARY KEY,
  username VARCHAR(40) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE auth_tokens (
  token_hash CHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_auth_tokens_user ON auth_tokens(user_id);
CREATE TABLE cloud_projects (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  document JSONB NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cloud_projects_owner_updated ON cloud_projects(owner_id, updated_at DESC);
