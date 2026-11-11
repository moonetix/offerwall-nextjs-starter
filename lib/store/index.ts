// Picks the store the app uses. Swap this one function to move to your database.
import 'server-only';
import { JsonFileStore } from './json-file-store.ts';
import type { RewardStore } from './types.ts';

// Next.js dev reloads modules; keep one store per process so its write queue is shared.
const globalForStore = globalThis as unknown as { moonetixStore?: RewardStore };

export function getStore(): RewardStore {
  if (!globalForStore.moonetixStore) {
    // Replace with your own store for production, for example:
    // globalForStore.moonetixStore = new PrismaStore(prisma);
    globalForStore.moonetixStore = new JsonFileStore(process.env.MOONETIX_STORE_FILE || '.data/moonetix-store.json');
  }
  return globalForStore.moonetixStore;
}

export type { RewardStore, StoreTx, TxRecord } from './types.ts';
