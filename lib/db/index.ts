/**
 * Tiny async database interface. Everything else in the app talks to `Db`, never to
 * better-sqlite3 directly, so moving to hosted Postgres later means writing one new
 * adapter (e.g. with `pg`, converting `?` placeholders to `$1..$n`), not a rewrite.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { migrations } from "./migrations";

export type Param = string | number | bigint | null;

export interface Db {
  all<T = Record<string, unknown>>(sql: string, params?: Param[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: Param[]): Promise<T | undefined>;
  run(sql: string, params?: Param[]): Promise<{ changes: number }>;
  /** Runs fn inside a transaction. Keep network calls OUT of fn. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

class SqliteDb implements Db {
  private depth = 0;
  constructor(private readonly conn: Database.Database) {}

  async all<T>(sql: string, params: Param[] = []) {
    return this.conn.prepare(sql).all(...params) as T[];
  }
  async get<T>(sql: string, params: Param[] = []) {
    return this.conn.prepare(sql).get(...params) as T | undefined;
  }
  async run(sql: string, params: Param[] = []) {
    const r = this.conn.prepare(sql).run(...params);
    return { changes: r.changes };
  }
  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    // Nested calls join the outer transaction.
    if (this.depth > 0) return fn(this);
    this.depth++;
    this.conn.exec("BEGIN IMMEDIATE");
    try {
      const out = await fn(this);
      this.conn.exec("COMMIT");
      return out;
    } catch (e) {
      this.conn.exec("ROLLBACK");
      throw e;
    } finally {
      this.depth--;
    }
  }
  close() {
    this.conn.close();
  }
  migrate() {
    this.conn.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)",
    );
    const done = new Set(
      (this.conn.prepare("SELECT id FROM schema_migrations").all() as { id: number }[]).map((r) => r.id),
    );
    for (const m of migrations) {
      if (done.has(m.id)) continue;
      this.conn.transaction(() => {
        this.conn.exec(m.sql);
        this.conn
          .prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)")
          .run(m.id, m.name, new Date().toISOString());
      })();
    }
  }
}

export function openSqlite(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new Database(file);
  conn.pragma("journal_mode = WAL"); // lets the sync script and the web server share the file
  conn.pragma("busy_timeout = 5000");
  conn.pragma("foreign_keys = ON");
  conn.defaultSafeIntegers(false);
  const db = new SqliteDb(conn);
  db.migrate();
  return db;
}

const g = globalThis as unknown as { __financeDb?: Db };

/** Shared connection for the web server and CLI scripts. */
export function getDb(): Db {
  if (!g.__financeDb) {
    g.__financeDb = openSqlite(dbPath());
  }
  return g.__financeDb;
}

/** The database file in use (DATABASE_PATH, or data/finance.db). */
export function dbPath() {
  return process.env.DATABASE_PATH || path.join(process.cwd(), "data", "finance.db");
}

/** Close the shared connection so the file can be replaced (data upload). The next getDb() reopens it. */
export function closeDb() {
  const d = g.__financeDb as unknown as { close?: () => void } | undefined;
  d?.close?.();
  g.__financeDb = undefined;
}

export const newId = () => randomUUID();
export const nowIso = () => new Date().toISOString();
export const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
