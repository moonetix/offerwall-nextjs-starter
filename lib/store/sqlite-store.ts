// SQL example store on node:sqlite (built into Node 22.13 and later, no package needed).
// It shows how a database store maps the interface in types.ts: one SQL transaction,
// and a PRIMARY KEY on transaction_id. Port the same SQL to Prisma, Drizzle, pg or mysql2.
//
// To use it: in lib/store/index.ts, return new SqliteStore('.data/moonetix.db').
// node:sqlite is still marked experimental by Node and prints a warning once.

import { DatabaseSync } from 'node:sqlite';
import { fromUnits, toUnits } from '../moonetix-core.ts';
import type { RewardStore, StoreTx, TxRecord, TxStatus } from './types.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS moonetix_tx (
  transaction_id TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  reward         TEXT NOT NULL,
  status         INTEGER NOT NULL CHECK (status IN (1, 2)),
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS moonetix_tx_user ON moonetix_tx (user_id, updated_at);
-- In your app this is your users table. Amounts are stored as integer units of 0.00001.
CREATE TABLE IF NOT EXISTS balances (
  user_id TEXT PRIMARY KEY,
  units   INTEGER NOT NULL DEFAULT 0
);`;

type Row = { transaction_id: string; user_id: string; reward: string; status: number; updated_at: string };

function toRecord(row: Row): TxRecord {
  return {
    transactionId: row.transaction_id,
    userId: row.user_id,
    reward: row.reward,
    status: row.status as TxStatus,
    updatedAt: row.updated_at,
  };
}

export class SqliteStore implements RewardStore {
  private readonly db: DatabaseSync;
  // One connection: run one transaction at a time.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
  }

  private addUnits(userId: string, units: bigint): void {
    this.db
      .prepare('INSERT INTO balances (user_id, units) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET units = units + excluded.units')
      .run(userId, units);
  }

  transaction<T>(fn: (tx: StoreTx) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const db = this.db;
      const tx: StoreTx = {
        getTransaction: async (id) => {
          const row = db.prepare('SELECT * FROM moonetix_tx WHERE transaction_id = ?').get(id) as Row | undefined;
          return row ? toRecord(row) : null;
        },
        insertTransaction: async (row) => {
          // Fails with a constraint error if the transaction_id exists.
          db.prepare('INSERT INTO moonetix_tx (transaction_id, user_id, reward, status, updated_at) VALUES (?, ?, ?, ?, ?)')
            .run(row.transactionId, row.userId, row.reward, row.status, new Date().toISOString());
        },
        setStatus: async (id, status) => {
          db.prepare('UPDATE moonetix_tx SET status = ?, updated_at = ? WHERE transaction_id = ?')
            .run(status, new Date().toISOString(), id);
        },
        addToBalance: async (userId, amount) => this.addUnits(userId, toUnits(amount)),
        subtractFromBalance: async (userId, amount) => this.addUnits(userId, -toUnits(amount)),
      };
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(tx);
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    });
    this.queue = run.catch(() => {});
    return run;
  }

  async getBalance(userId: string): Promise<string> {
    const stmt = this.db.prepare('SELECT units FROM balances WHERE user_id = ?');
    stmt.setReadBigInts(true);
    const row = stmt.get(userId) as { units: bigint } | undefined;
    return fromUnits(row?.units ?? 0n);
  }

  async listTransactions(userId: string, limit: number): Promise<TxRecord[]> {
    const rows = this.db
      .prepare('SELECT * FROM moonetix_tx WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?')
      .all(userId, limit) as Row[];
    return rows.map(toRecord);
  }

  close(): void {
    this.db.close();
  }
}
