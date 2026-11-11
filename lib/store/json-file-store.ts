// JSON file store for local development. Zero setup: one file, read and written per event.
//
// Good for trying the starter. Not for production: it works in one Node process only,
// and serverless hosts have no lasting disk. Use a database store there (see types.ts).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fromUnits, toUnits } from '../moonetix-core.ts';
import type { RewardStore, StoreTx, TxRecord, TxStatus } from './types.ts';

type Data = {
  transactions: Record<string, TxRecord>;
  balances: Record<string, string>;
};

// Objects without a prototype, so IDs such as "__proto__" or "constructor" are plain keys.
function dict<V>(from?: Record<string, V>): Record<string, V> {
  return Object.assign(Object.create(null) as Record<string, V>, from ?? {});
}

export class JsonFileStore implements RewardStore {
  private readonly file: string;
  // Serializes transactions in this process, so two events never interleave.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(file: string) {
    this.file = path.resolve(file);
  }

  private async load(): Promise<Data> {
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<Data>;
      return { transactions: dict(data.transactions), balances: dict(data.balances) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { transactions: dict(), balances: dict() };
      throw err;
    }
  }

  private async save(data: Data): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    // Write a temporary file, then rename: a crash never leaves a half-written file.
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.file);
  }

  transaction<T>(fn: (tx: StoreTx) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const data = await this.load();
      let changed = false;
      const now = () => new Date().toISOString();
      const tx: StoreTx = {
        getTransaction: async (id) => {
          const row = data.transactions[id];
          return row ? { ...row } : null;
        },
        insertTransaction: async (row) => {
          if (Object.hasOwn(data.transactions, row.transactionId)) {
            throw new Error(`duplicate transaction_id ${row.transactionId}`);
          }
          data.transactions[row.transactionId] = { ...row, updatedAt: now() };
          changed = true;
        },
        setStatus: async (id: string, status: TxStatus) => {
          const row = data.transactions[id];
          if (!row) throw new Error(`unknown transaction_id ${id}`);
          data.transactions[id] = { ...row, status, updatedAt: now() };
          changed = true;
        },
        addToBalance: async (userId, amount) => {
          data.balances[userId] = fromUnits(toUnits(data.balances[userId] ?? '0') + toUnits(amount));
          changed = true;
        },
        subtractFromBalance: async (userId, amount) => {
          // This starter lets the balance go below zero when a user already spent a reversed reward.
          data.balances[userId] = fromUnits(toUnits(data.balances[userId] ?? '0') - toUnits(amount));
          changed = true;
        },
      };
      // Changes are kept in memory and written only if fn finishes without an error.
      const result = await fn(tx);
      if (changed) await this.save(data);
      return result;
    });
    // Keep the queue going after a failed transaction.
    this.queue = run.catch(() => {});
    return run;
  }

  async getBalance(userId: string): Promise<string> {
    await this.queue;
    return (await this.load()).balances[userId] ?? '0';
  }

  async listTransactions(userId: string, limit: number): Promise<TxRecord[]> {
    await this.queue;
    return Object.values((await this.load()).transactions)
      .filter((row) => row.userId === userId)
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
      .slice(0, limit);
  }
}
