CREATE TABLE IF NOT EXISTS auth_attempts (
  bucket_key TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_attempts_key_time ON auth_attempts(bucket_key, attempted_at);
