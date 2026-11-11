// Framework-free Moonetix logic: signed links, postback checks, and the credit rules.
// No Next.js imports, so it runs in plain Node (see test/) and in any other server.
// Secrets are passed in as arguments. lib/moonetix.ts reads them from the environment.

import crypto from 'node:crypto';
import type { RewardStore } from './store/types.ts';

export const WALL_BASE = 'https://wall.moonetix.com/';

const USER_ID = /^[A-Za-z0-9._@:+-]{1,100}$/;
const SUB_VALUE = /^[A-Za-z0-9._~:@+-]{1,100}$/;
const APP_ID = /^[A-Za-z0-9]{1,64}$/;
// {reward} is never negative and has at most 5 decimals, for example 150, 0.75 or 1.23456.
const REWARD = /^\d{1,15}(\.\d{1,5})?$/;

export type SubKey = 'sub1' | 'sub2' | 'sub3' | 'sub4' | 'sub5';
export type Subs = Partial<Record<SubKey, string>>;

export function isValidUserId(userId: string): boolean {
  return USER_ID.test(userId);
}

/** HMAC-SHA256 of the user ID with the link hash salt, as lowercase hex. */
export function linkHash(linkSalt: string, userId: string): string {
  return crypto.createHmac('sha256', linkSalt).update(userId).digest('hex');
}

/**
 * Builds the signed offerwall link for one user. Call it on the server only,
 * with the ID of the signed-in user from your session, never with an ID from the browser.
 */
export function buildWallUrl(opts: { appId: string; linkSalt: string; userId: string | number; subs?: Subs }): string {
  const id = String(opts.userId);
  if (!APP_ID.test(opts.appId)) throw new Error('MOONETIX_APP_ID is not a valid App ID');
  if (!opts.linkSalt) throw new Error('MOONETIX_LINK_SALT is empty');
  if (!isValidUserId(id)) throw new Error('user ID not accepted by the offerwall (1 to 100 of A-Z a-z 0-9 . _ @ : + -)');
  let url = `${WALL_BASE}${opts.appId}?user_id=${encodeURIComponent(id)}&hash=${linkHash(opts.linkSalt, id)}`;
  for (const key of ['sub1', 'sub2', 'sub3', 'sub4', 'sub5'] as const) {
    const value = opts.subs?.[key];
    if (value && SUB_VALUE.test(value)) url += `&${key}=${encodeURIComponent(value)}`;
  }
  return url;
}

export type Postback = { tx: string; user: string; reward: string; status: string; hash: string };
const KEYS = ['tx', 'user', 'reward', 'status', 'hash'] as const;

/**
 * Reads the five parameters of the postback URL registered on the Postback page:
 * ?tx={transaction_id}&user={user_id}&reward={reward}&status={status}&hash={hash}
 * Each one must appear exactly once. A missing or repeated parameter returns null.
 */
export function readPostback(params: URLSearchParams): Postback | null {
  const p = {} as Postback;
  for (const key of KEYS) {
    const values = params.getAll(key);
    if (values.length !== 1) return null;
    p[key] = values[0];
  }
  return p;
}

/** Checks {hash}: HMAC-SHA256 of tx:user:reward:status with the postback secret key, compared in constant time. */
export function verifyPostback(p: Postback, postbackKey: string): boolean {
  if (!postbackKey) throw new Error('MOONETIX_POSTBACK_KEY is empty');
  const expected = Buffer.from(
    crypto.createHmac('sha256', postbackKey).update(`${p.tx}:${p.user}:${p.reward}:${p.status}`).digest('hex')
  );
  const given = Buffer.from(p.hash);
  // timingSafeEqual throws on different lengths, so check the length first.
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// Amounts are handled as fixed point (5 decimals) so 0.1 + 0.2 stays 0.3.
const SCALE = 100000n;

export function isValidReward(reward: string): boolean {
  return REWARD.test(reward);
}

export function toUnits(amount: string): bigint {
  const negative = amount.startsWith('-');
  const [whole, frac = ''] = (negative ? amount.slice(1) : amount).split('.');
  const units = BigInt(whole || '0') * SCALE + BigInt((frac + '00000').slice(0, 5));
  return negative ? -units : units;
}

export function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const frac = (abs % SCALE).toString().padStart(5, '0').replace(/0+$/, '');
  return (negative ? '-' : '') + (abs / SCALE).toString() + (frac ? '.' + frac : '');
}

export type ApplyResult = 'credited' | 'reversed' | 'duplicate' | 'reversal_before_credit';

/**
 * The credit rules from the Moonetix docs, in one place for every store:
 * - status 1 credits once per transaction_id,
 * - status 2 takes back exactly what was credited for that transaction_id, once,
 * - a status 2 for a transaction you never credited is recorded, so a late credit cannot pay.
 * Runs inside store.transaction(), so the check and the change happen together.
 */
export async function applyEvent(store: RewardStore, p: { tx: string; user: string; reward: string; status: 1 | 2 }): Promise<ApplyResult> {
  return store.transaction(async (t) => {
    const row = await t.getTransaction(p.tx);
    if (p.status === 1) {
      if (row) return 'duplicate';
      await t.insertTransaction({ transactionId: p.tx, userId: p.user, reward: p.reward, status: 1 });
      await t.addToBalance(p.user, p.reward);
      return 'credited';
    }
    if (!row) {
      await t.insertTransaction({ transactionId: p.tx, userId: p.user, reward: p.reward, status: 2 });
      return 'reversal_before_credit';
    }
    if (row.status !== 1) return 'duplicate';
    await t.setStatus(p.tx, 2);
    // Use the stored user and amount: take back only what this transaction credited.
    await t.subtractFromBalance(row.userId, row.reward);
    return 'reversed';
  });
}

export type PostbackOutcome = { httpStatus: 200 | 403; result: ApplyResult | 'bad_request' | 'bad_hash' | 'test' | 'ignored' };

/**
 * The whole postback handler without the web framework. Returns the HTTP status to answer.
 * Errors from the store are thrown, so the caller answers 500 and Moonetix retries later.
 */
export async function handlePostback(
  params: URLSearchParams,
  opts: { postbackKey: string; store: RewardStore; log?: (msg: string, data?: unknown) => void }
): Promise<PostbackOutcome> {
  const log = opts.log ?? (() => {});
  const p = readPostback(params);
  if (!p) return { httpStatus: 403, result: 'bad_request' };
  // Verify the signature before anything else.
  if (!verifyPostback(p, opts.postbackKey)) return { httpStatus: 403, result: 'bad_hash' };

  // Signed by Moonetix from here on. Answer 200 even when we skip, so the event is not retried.
  if (p.tx.startsWith('test_')) {
    log('moonetix: test postback, not credited', { tx: p.tx, user: p.user, reward: p.reward, status: p.status });
    return { httpStatus: 200, result: 'test' };
  }
  if ((p.status !== '1' && p.status !== '2') || !isValidReward(p.reward) || !isValidUserId(p.user) || !p.tx) {
    log('moonetix: signed postback with unexpected values, skipped', p);
    return { httpStatus: 200, result: 'ignored' };
  }
  const result = await applyEvent(opts.store, { tx: p.tx, user: p.user, reward: p.reward, status: p.status === '1' ? 1 : 2 });
  log(`moonetix: ${result}`, { tx: p.tx, user: p.user, reward: p.reward });
  return { httpStatus: 200, result };
}
