// SQLite database singleton with auto-migration
import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || join(__dirname, '..');

let _db = null;

/**
 * Get or create the SQLite database connection.
 * Auto-creates data dir and runs schema on first call.
 */
export function getDb() {
  if (_db) return _db;

  const dbDir = join(PLUGIN_ROOT, 'data');
  mkdirSync(dbDir, { recursive: true });

  _db = new Database(join(dbDir, 'skill-evolver.db'));
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  // Run schema migrations
  const schemaPath = join(PLUGIN_ROOT, 'db', 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  _db.exec(schema);

  return _db;
}

/** Close the database connection gracefully */
export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
