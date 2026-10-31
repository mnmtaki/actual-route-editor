ALTER TABLE auth_tokens ADD COLUMN csrf_hash CHAR(64);
CREATE TABLE auth_rate_limits (
  rate_key CHAR(64) PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts >= 1)
);
CREATE INDEX idx_auth_rate_limits_window_start ON auth_rate_limits(window_start);
