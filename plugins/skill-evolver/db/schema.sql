-- Skill Evolver database schema

CREATE TABLE IF NOT EXISTS skill_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_name TEXT NOT NULL,
  session_id TEXT NOT NULL,
  triggered_at DATETIME DEFAULT (datetime('now')),
  trigger_type TEXT NOT NULL DEFAULT 'explicit',
  arguments TEXT,
  tokens_used INTEGER DEFAULT 0,
  tool_calls INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  files_involved TEXT,
  output_tokens INTEGER DEFAULT 0,
  skill_version_hash TEXT,
  model TEXT,
  completed INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_run_id INTEGER NOT NULL REFERENCES skill_runs(id),
  reaction_type TEXT NOT NULL,
  user_message TEXT,
  detected_at DATETIME DEFAULT (datetime('now')),
  time_after_skill_ms INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS skill_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_name TEXT NOT NULL,
  version_hash TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  line_count INTEGER NOT NULL,
  created_at DATETIME DEFAULT (datetime('now')),
  parent_version_id INTEGER REFERENCES skill_versions(id)
);

CREATE TABLE IF NOT EXISTS ab_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_name TEXT NOT NULL,
  version_a_hash TEXT NOT NULL,
  version_b_hash TEXT NOT NULL,
  started_at DATETIME DEFAULT (datetime('now')),
  ended_at DATETIME,
  target_runs INTEGER DEFAULT 20,
  status TEXT NOT NULL DEFAULT 'running'
);

CREATE TABLE IF NOT EXISTS ab_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ab_test_id INTEGER NOT NULL REFERENCES ab_tests(id),
  skill_run_id INTEGER NOT NULL REFERENCES skill_runs(id),
  assigned_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guard_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_name TEXT NOT NULL UNIQUE,
  baseline_line_count INTEGER,
  baseline_avg_tokens INTEGER,
  baseline_step_count INTEGER,
  max_line_drift_pct REAL DEFAULT 0.3,
  max_token_drift_pct REAL DEFAULT 0.5,
  max_step_drift INTEGER DEFAULT 3
);

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_skill_runs_name ON skill_runs(skill_name);
CREATE INDEX IF NOT EXISTS idx_skill_runs_session ON skill_runs(session_id);
CREATE INDEX IF NOT EXISTS idx_skill_runs_triggered ON skill_runs(triggered_at);
CREATE INDEX IF NOT EXISTS idx_skill_runs_completed ON skill_runs(completed);
CREATE INDEX IF NOT EXISTS idx_reactions_run ON reactions(skill_run_id);
CREATE INDEX IF NOT EXISTS idx_reactions_type ON reactions(reaction_type);
CREATE INDEX IF NOT EXISTS idx_skill_versions_name ON skill_versions(skill_name);
CREATE INDEX IF NOT EXISTS idx_ab_tests_skill ON ab_tests(skill_name);
CREATE INDEX IF NOT EXISTS idx_ab_tests_status ON ab_tests(status);
