-- Extra tables for deeper MCP coaching (mirror of local poker_hands + coach_memory).

CREATE TABLE IF NOT EXISTS ai_analysis (
  hand_id TEXT PRIMARY KEY,
  llm_provider TEXT,
  play_style TEXT,
  mistakes_found INTEGER,
  tags TEXT,
  summary TEXT,
  ev_estimate TEXT,
  raw_response TEXT,
  analyzed_at TEXT
);

CREATE TABLE IF NOT EXISTS coach_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hero TEXT,
  kind TEXT,
  user_text TEXT,
  assistant_text TEXT,
  provider TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS schema_catalog (
  table_name TEXT PRIMARY KEY,
  database_name TEXT NOT NULL DEFAULT 'poker_hands',
  description TEXT,
  columns_json TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_provider ON ai_analysis(llm_provider);
CREATE INDEX IF NOT EXISTS idx_coach_memory_hero ON coach_memory(hero);
CREATE INDEX IF NOT EXISTS idx_coach_memory_created ON coach_memory(created_at DESC);
