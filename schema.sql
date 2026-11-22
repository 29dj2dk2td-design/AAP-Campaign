CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, phone TEXT, sector TEXT, type TEXT, message TEXT NOT NULL,
  created_at INTEGER NOT NULL, is_read INTEGER NOT NULL DEFAULT 0, ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);

CREATE TABLE IF NOT EXISTS voters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  epic TEXT, epic_norm TEXT, name TEXT NOT NULL, relative TEXT, age INTEGER, gender TEXT,
  house TEXT, sector TEXT, part TEXT, serial TEXT, booth TEXT, booth_address TEXT
);
CREATE INDEX IF NOT EXISTS idx_voters_epic ON voters(epic_norm);
CREATE INDEX IF NOT EXISTS idx_voters_sector ON voters(sector);
CREATE TABLE IF NOT EXISTS rate (ip_hash TEXT, kind TEXT, ts INTEGER);
CREATE INDEX IF NOT EXISTS idx_rate ON rate(ip_hash, kind, ts);
