// The storage interface. Implement it for your database to replace the JSON file store.
//
// The credit rules live in applyEvent() in lib/moonetix-core.ts and stay the same for
// every store. A store only has to do four small things inside one atomic transaction.
//
// SQL schema that fits (PostgreSQL, MySQL, SQLite; Prisma and Drizzle map it 1:1):
//
//   CREATE TABLE moonetix_tx (
//     transaction_id VARCHAR(191) PRIMARY KEY,  -- the unique constraint that stops double credits
//     user_id        VARCHAR(100) NOT NULL,
//     reward         DECIMAL(20,5) NOT NULL,
//     status         SMALLINT NOT NULL,         -- 1 credited, 2 reversed
//     updated_at     TIMESTAMP NOT NULL
//   );
//   -- plus a balance column on your users table, for example users.coins DECIMAL(20,5)
//
// With Prisma: transaction() is prisma.$transaction(async (db) => fn(adapter(db))), and
// insertTransaction() is db.moonetixTx.create(). If two copies of the same postback race,
// the primary key makes one insert fail, the whole transaction rolls back, the route answers
// 500, and the Moonetix retry then sees the row and skips it. No double credit either way.
// lib/store/sqlite-store.ts is a complete SQL example you can run.

export type TxStatus = 1 | 2;

export type TxRecord = {
  transactionId: string;
  userId: string;
  /** Decimal string with up to 5 decimals, never negative, for example "150" or "0.75". */
  reward: string;
  status: TxStatus;
  /** ISO time of the last change. Set by the store. */
  updatedAt?: string;
};

/** Operations available inside one atomic transaction. */
export interface StoreTx {
  getTransaction(transactionId: string): Promise<TxRecord | null>;
  /** Must fail if the transaction_id already exists (unique constraint). */
  insertTransaction(row: TxRecord): Promise<void>;
  setStatus(transactionId: string, status: TxStatus): Promise<void>;
  /** amount is a non-negative decimal string. Use exact decimal math, not floats. */
  addToBalance(userId: string, amount: string): Promise<void>;
  /** Your choice whether a balance may go below zero. See the README. */
  subtractFromBalance(userId: string, amount: string): Promise<void>;
}

export interface RewardStore {
  /**
   * Runs fn atomically: all changes are stored together or not at all, and no other
   * event can change the same transaction in between. In SQL, one database transaction.
   * Resolve only after the changes are stored: the route answers 200 right after.
   */
  transaction<T>(fn: (tx: StoreTx) => Promise<T>): Promise<T>;
  /** The user's balance as a decimal string, "0" if unknown. */
  getBalance(userId: string): Promise<string>;
  /** Most recent transactions of a user, newest first. */
  listTransactions(userId: string, limit: number): Promise<TxRecord[]>;
}
