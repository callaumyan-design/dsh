// A tiny async database interface implemented by node:sqlite (self-hosted) and Cloudflare D1.

export type SqlValue = string | number | null;

export interface Statement {
  sql: string;
  params?: SqlValue[];
}

export interface DB {
  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T | null>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  /** Runs all statements atomically. */
  batch(statements: Statement[]): Promise<void>;
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  user_agent TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entities (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, kind, id)
);
CREATE INDEX IF NOT EXISTS idx_entities_sync ON entities(user_id, updated_at);
CREATE TABLE IF NOT EXISTS messages (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(user_id, conversation_id, updated_at);
CREATE TABLE IF NOT EXISTS jobs (
  user_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, message_id)
);
CREATE TABLE IF NOT EXISTS secrets (
  user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, provider_id)
);
`;

export function schemaStatements(): string[] {
  return SCHEMA.split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

let migrated: Promise<void> | null = null;

/** Creates tables once per process / isolate. */
export function ensureSchema(db: DB): Promise<void> {
  if (!migrated) {
    migrated = db.batch(schemaStatements().map((sql) => ({ sql }))).catch((err) => {
      migrated = null;
      throw err;
    });
  }
  return migrated;
}
