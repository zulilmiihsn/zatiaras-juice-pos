CREATE TABLE IF NOT EXISTS auth_sessions (
	id TEXT PRIMARY KEY NOT NULL,
	branch_id TEXT NOT NULL,
	user_id TEXT NOT NULL,
	username TEXT NOT NULL,
	role TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions (branch_id, user_id);
