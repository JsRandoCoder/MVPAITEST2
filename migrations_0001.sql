-- migrations/0001.sql
-- D1 schema (SQLite)
-- Tasks + events are the durable source of truth.

CREATE TABLE IF NOT EXISTS ara_tasks (
id TEXT PRIMARY KEY,
status TEXT NOT NULL,
prompt TEXT NOT NULL,
result TEXT,
error TEXT,
attempts INTEGER NOT NULL DEFAULT 0,
max_attempts INTEGER NOT NULL DEFAULT 5,
retry_at TEXT,
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status_retry_at ON ara_tasks(status, retry_at);

CREATE TABLE IF NOT EXISTS ara_task_events (
id INTEGER PRIMARY KEY AUTOINCREMENT,
task_id TEXT NOT NULL,
type TEXT NOT NULL,
data TEXT,
created_at TEXT NOT NULL,
FOREIGN KEY(task_id) REFERENCES ara_tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_events_task_id_id ON ara_task_events(task_id, id);
