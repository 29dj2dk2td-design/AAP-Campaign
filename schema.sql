CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, phone TEXT, sector TEXT, type TEXT, message TEXT NOT NULL,
  created_at INTEGER NOT NULL, is_read INTEGER NOT NULL DEFAULT 0, ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);
