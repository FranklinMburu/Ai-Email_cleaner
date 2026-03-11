import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/app.sqlite');

// Ensure data directory exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db = null;

export function initializeDatabase() {
  if (db) {
    // If already initialized, close and reinitialize
    try {
      db.close();
    } catch (e) {
      // Ignore errors on close
    }
    db = null;
  }
  
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  createTables();
  return db;
}

export function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL UNIQUE,
      refresh_token TEXT NOT NULL,
      access_token TEXT NOT NULL,
      token_expiry_ms INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      revoked_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      FOREIGN KEY (user_email) REFERENCES oauth_tokens(user_email) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_email);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS message_metadata (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      message_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      from_addr TEXT,
      to_addr TEXT,
      subject TEXT,
      snippet TEXT,
      internal_date_ms INTEGER,
      size_estimate INTEGER,
      label_ids TEXT,
      is_unread INTEGER DEFAULT 0,
      is_starred INTEGER DEFAULT 0,
      synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_email) REFERENCES oauth_tokens(user_email) ON DELETE CASCADE,
      UNIQUE(user_email, message_id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_user ON message_metadata(user_email);
    CREATE INDEX IF NOT EXISTS idx_messages_date ON message_metadata(internal_date_ms);
    CREATE INDEX IF NOT EXISTS idx_messages_from ON message_metadata(from_addr);

    CREATE TABLE IF NOT EXISTS sync_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL UNIQUE,
      history_id TEXT,
      last_sync_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_internal_date_ms INTEGER,
      FOREIGN KEY (user_email) REFERENCES oauth_tokens(user_email) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS categorization_cache (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      message_id TEXT NOT NULL,
      category_name TEXT,
      category_id TEXT,
      confidence REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_email) REFERENCES oauth_tokens(user_email) ON DELETE CASCADE,
      UNIQUE(user_email, message_id)
    );

    CREATE TABLE IF NOT EXISTS operations (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      operation_type TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      categories TEXT,
      dry_run_results TEXT,
      execution_results TEXT,
      affected_message_ids TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      executed_at DATETIME,
      completed_at DATETIME,
      FOREIGN KEY (user_email) REFERENCES oauth_tokens(user_email) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      operation_id TEXT,
      event_type TEXT NOT NULL,
      summary TEXT,
      message_ids TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_email) REFERENCES oauth_tokens(user_email) ON DELETE CASCADE,
      FOREIGN KEY (operation_id) REFERENCES operations(id)
    );

    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_email);
    CREATE INDEX IF NOT EXISTS idx_audit_operation ON audit_log(operation_id);
    CREATE INDEX IF NOT EXISTS idx_operations_user ON operations(user_email);
  `);
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}
