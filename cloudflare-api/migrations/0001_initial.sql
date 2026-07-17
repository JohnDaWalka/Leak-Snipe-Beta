CREATE TABLE IF NOT EXISTS hands (
  hand_id TEXT PRIMARY KEY, site TEXT NOT NULL, hand_number TEXT, date TEXT, game_type TEXT,
  is_tournament INTEGER DEFAULT 0, tournament_id TEXT, buy_in TEXT, table_name TEXT,
  max_seats INTEGER DEFAULT 0, button_seat INTEGER DEFAULT 0, hero_cards TEXT, board_cards TEXT,
  pot REAL DEFAULT 0, rake REAL DEFAULT 0, hero_won REAL DEFAULT 0, hero_position TEXT,
  raw_text TEXT, source_file TEXT, imported_at TEXT
);
CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY AUTOINCREMENT, hand_id TEXT NOT NULL, seat INTEGER, name TEXT, stack REAL DEFAULT 0, is_hero INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS actions (id INTEGER PRIMARY KEY AUTOINCREMENT, hand_id TEXT NOT NULL, street TEXT, sequence INTEGER, player TEXT, action TEXT, amount REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS winners (id INTEGER PRIMARY KEY AUTOINCREMENT, hand_id TEXT NOT NULL, player_name TEXT, amount REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS ocr_imports (id INTEGER PRIMARY KEY AUTOINCREMENT, image_path TEXT, ocr_text TEXT, parsed_cards TEXT, parsed_pot REAL, parsed_bets TEXT, parsed_blinds TEXT, notes TEXT, hand_id TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS hand_tags (hand_id TEXT NOT NULL, tag TEXT NOT NULL, created_at TEXT, PRIMARY KEY (hand_id, tag));
CREATE TABLE IF NOT EXISTS player_types (name TEXT PRIMARY KEY, site TEXT DEFAULT '', auto_type TEXT DEFAULT 'Unknown', manual_type TEXT DEFAULT '', hands INTEGER DEFAULT 0, vpip REAL DEFAULT 0, pfr REAL DEFAULT 0, af REAL DEFAULT 0, fold_cbet REAL DEFAULT 0, wtsd REAL DEFAULT 0, updated_at TEXT, three_bet REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS tournament_summaries (tournament_id TEXT PRIMARY KEY, site TEXT NOT NULL, buy_in_raw TEXT, buy_in_value REAL DEFAULT 0, rake_value REAL DEFAULT 0, player_count INTEGER DEFAULT 0, finish_position INTEGER, prize REAL DEFAULT 0, hero_name TEXT, imported_at TEXT);
CREATE TABLE IF NOT EXISTS player_position_facts (hand_id TEXT NOT NULL, player TEXT NOT NULL COLLATE NOCASE, position TEXT NOT NULL, vpip INTEGER NOT NULL DEFAULT 0 CHECK (vpip IN (0, 1)), pfr INTEGER NOT NULL DEFAULT 0 CHECK (pfr IN (0, 1)), updated_at TEXT NOT NULL, PRIMARY KEY (hand_id, player));
CREATE INDEX IF NOT EXISTS idx_hands_date ON hands(date DESC);
CREATE INDEX IF NOT EXISTS idx_players_hand_id ON players(hand_id);
CREATE INDEX IF NOT EXISTS idx_actions_hand_id_seq ON actions(hand_id, sequence);
CREATE INDEX IF NOT EXISTS idx_position_facts_player_position ON player_position_facts(player, position);
