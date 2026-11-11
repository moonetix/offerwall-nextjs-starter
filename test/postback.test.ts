// Tests for the framework-free logic. Run: npm test (plain Node, no Next.js needed).
//
// By default the test signs postbacks itself with the documented formula.
// Set MOONETIX_GEN_CMD to a command that prints {"postback": url, "wall": url} for the args
// <template> <tx> <user> <reward> <status> <secret> <salt> <app_id> to test against another signer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildWallUrl, handlePostback, fromUnits, toUnits } from '../lib/moonetix-core.ts';
import { JsonFileStore } from '../lib/store/json-file-store.ts';
import type { RewardStore } from '../lib/store/types.ts';

const APP = 'demoapp0000000000000001';
const KEY = 'test_postback_key_not_secret';
const SALT = 'test_link_salt_not_secret';
const TEMPLATE = 'https://example.com/api/moonetix/postback?tx={transaction_id}&user={user_id}&reward={reward}&status={status}&hash={hash}';

function gen(tx: string, user: string, reward: string, status: 1 | 2, secret = KEY): { postback: string; wall: string } {
  const cmd = process.env.MOONETIX_GEN_CMD;
  if (cmd) {
    const [bin, ...pre] = cmd.split(' ');
    const out = execFileSync(bin, [...pre, TEMPLATE, tx, user, reward, String(status), secret, SALT, APP], { encoding: 'utf8' });
    return JSON.parse(out);
  }
  const hash = crypto.createHmac('sha256', secret).update(`${tx}:${user}:${reward}:${status}`).digest('hex');
  const vars: Record<string, string> = { transaction_id: tx, user_id: user, reward, status: String(status), hash };
  const postback = TEMPLATE.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(vars[k] ?? ''));
  const wall = `https://wall.moonetix.com/${APP}?user_id=${encodeURIComponent(user)}&hash=${crypto.createHmac('sha256', SALT).update(user).digest('hex')}`;
  return { postback, wall };
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moonetix-starter-'));
let n = 0;
function freshJsonStore(): JsonFileStore {
  return new JsonFileStore(path.join(tmpDir, `store-${++n}.json`));
}

async function deliver(store: RewardStore, url: string) {
  return handlePostback(new URL(url).searchParams, { postbackKey: KEY, store });
}

test('fixed point amounts', () => {
  assert.equal(fromUnits(toUnits('0.1') + toUnits('0.2')), '0.3');
  assert.equal(fromUnits(toUnits('150') - toUnits('150.5')), '-0.5');
  assert.equal(fromUnits(toUnits('1.23456')), '1.23456');
  assert.equal(fromUnits(0n), '0');
});

test('wall link equals the one Moonetix builds', () => {
  for (const user of ['42', 'a.b_c@d:e+f-g', '550e8400-e29b-41d4-a716-446655440000']) {
    const mine = buildWallUrl({ appId: APP, linkSalt: SALT, userId: user });
    assert.equal(mine, gen('tx_w', user, '1', 1).wall, `user ${user}`);
  }
  const withSubs = buildWallUrl({ appId: APP, linkSalt: SALT, userId: 42, subs: { sub1: 'earn_page', sub2: 'bad value!' } });
  assert.ok(withSubs.endsWith('&sub1=earn_page'), 'valid sub kept, invalid sub dropped');
  assert.throws(() => buildWallUrl({ appId: APP, linkSalt: SALT, userId: 'has space' }));
  assert.throws(() => buildWallUrl({ appId: APP, linkSalt: '', userId: '42' }));
});

// Runs the same credit rules against every store, to show any store behaves the same.
async function creditSuite(name: string, makeStore: () => RewardStore) {
  await test(`${name}: credit, retry, reversal, retry`, async () => {
    const store = makeStore();
    assert.deepEqual(await deliver(store, gen('tx_1', '42', '150', 1).postback), { httpStatus: 200, result: 'credited' });
    assert.equal(await store.getBalance('42'), '150');
    assert.deepEqual(await deliver(store, gen('tx_1', '42', '150', 1).postback), { httpStatus: 200, result: 'duplicate' });
    assert.equal(await store.getBalance('42'), '150');
    assert.equal((await deliver(store, gen('tx_2', '42', '0.75', 1).postback)).result, 'credited');
    assert.equal((await deliver(store, gen('tx_3', '42', '1.23456', 1).postback)).result, 'credited');
    assert.equal(await store.getBalance('42'), '151.98456');
    assert.equal((await deliver(store, gen('tx_1', '42', '150', 2).postback)).result, 'reversed');
    assert.equal(await store.getBalance('42'), '1.98456');
    assert.equal((await deliver(store, gen('tx_1', '42', '150', 2).postback)).result, 'duplicate');
    assert.equal(await store.getBalance('42'), '1.98456');
    // A credit for an already reversed transaction never pays again.
    assert.equal((await deliver(store, gen('tx_1', '42', '150', 1).postback)).result, 'duplicate');
    assert.equal(await store.getBalance('42'), '1.98456');
    const history = await store.listTransactions('42', 10);
    assert.equal(history.length, 3);
    assert.equal(history.find((r) => r.transactionId === 'tx_1')?.status, 2);
  });

  await test(`${name}: reversal before credit is recorded, late credit does not pay`, async () => {
    const store = makeStore();
    assert.equal((await deliver(store, gen('tx_r', '7', '50', 2).postback)).result, 'reversal_before_credit');
    assert.equal(await store.getBalance('7'), '0');
    assert.equal((await deliver(store, gen('tx_r', '7', '50', 1).postback)).result, 'duplicate');
    assert.equal(await store.getBalance('7'), '0');
  });

  await test(`${name}: a reversal takes back what was credited, to the credited user`, async () => {
    const store = makeStore();
    await deliver(store, gen('tx_a', '8', '10', 1).postback);
    await deliver(store, gen('tx_b', '8', '5', 1).postback);
    // A signed reversal with another amount still takes back only the stored 10.
    assert.equal((await deliver(store, gen('tx_a', '9', '999', 2).postback)).result, 'reversed');
    assert.equal(await store.getBalance('8'), '5');
    assert.equal(await store.getBalance('9'), '0');
  });

  await test(`${name}: the same credit arriving 10 times at once pays once`, async () => {
    const store = makeStore();
    const url = gen('tx_c', 'u1', '25', 1).postback;
    const results = await Promise.all(Array.from({ length: 10 }, () => deliver(store, url)));
    assert.equal(results.filter((r) => r.result === 'credited').length, 1);
    assert.equal(await store.getBalance('u1'), '25');
  });

  await test(`${name}: special user IDs`, async () => {
    const store = makeStore();
    for (const user of ['a.b_c@d:e+f-g', '__proto__', 'constructor']) {
      assert.equal((await deliver(store, gen(`tx_${user}`, user, '3', 1).postback)).result, 'credited', user);
      assert.equal(await store.getBalance(user), '3', user);
    }
  });
}

test('postback rejections (403) change nothing', async () => {
  const store = freshJsonStore();
  const good = gen('tx_t', '42', '150', 1).postback;
  const tamper = (fn: (q: URLSearchParams) => void) => {
    const u = new URL(good);
    fn(u.searchParams);
    return u.toString();
  };
  const cases: Record<string, string> = {
    'reward changed': tamper((q) => q.set('reward', '1500')),
    'user changed': tamper((q) => q.set('user', '43')),
    'status changed': tamper((q) => q.set('status', '2')),
    'tx changed': tamper((q) => q.set('tx', 'tx_other')),
    'hash flipped': tamper((q) => q.set('hash', q.get('hash')!.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')))),
    'hash uppercase': tamper((q) => q.set('hash', q.get('hash')!.toUpperCase())),
    'hash short': tamper((q) => q.set('hash', q.get('hash')!.slice(0, 63))),
    'hash empty': tamper((q) => q.set('hash', '')),
    'hash missing': tamper((q) => q.delete('hash')),
    'reward missing': tamper((q) => q.delete('reward')),
    'tx repeated': tamper((q) => q.append('tx', 'tx_t')),
    'wrong key': gen('tx_t', '42', '150', 1, 'another_secret').postback,
  };
  for (const [name, url] of Object.entries(cases)) {
    assert.equal((await deliver(store, url)).httpStatus, 403, name);
  }
  assert.equal(await store.getBalance('42'), '0');
  assert.equal((await deliver(store, good)).result, 'credited');
});

test('test postbacks are answered 200 and not credited', async () => {
  const store = freshJsonStore();
  assert.deepEqual(await deliver(store, gen('test_abc123', '42', '100', 1).postback), { httpStatus: 200, result: 'test' });
  assert.deepEqual(await deliver(store, gen('test_abc123', '42', '100', 2).postback), { httpStatus: 200, result: 'test' });
  assert.equal(await store.getBalance('42'), '0');
});

test('signed but unexpected values are skipped with 200', async () => {
  const store = freshJsonStore();
  const sign = (tx: string, user: string, reward: string, status: string) =>
    `https://x/p?tx=${tx}&user=${encodeURIComponent(user)}&reward=${reward}&status=${status}&hash=` +
    crypto.createHmac('sha256', KEY).update(`${tx}:${user}:${reward}:${status}`).digest('hex');
  assert.deepEqual(await deliver(store, sign('tx_s', '42', '5', '3')), { httpStatus: 200, result: 'ignored' });
  assert.deepEqual(await deliver(store, sign('tx_s', '42', '-5', '1')), { httpStatus: 200, result: 'ignored' });
  assert.deepEqual(await deliver(store, sign('tx_s', '42', '1e3', '1')), { httpStatus: 200, result: 'ignored' });
  assert.deepEqual(await deliver(store, sign('tx_s', 'a b', '5', '1')), { httpStatus: 200, result: 'ignored' });
  assert.equal(await store.getBalance('42'), '0');
});

test('JSON file store keeps data across restarts and writes nothing on failure', async () => {
  const file = path.join(tmpDir, 'persist.json');
  const a = new JsonFileStore(file);
  await deliver(a, gen('tx_p', '42', '12.5', 1).postback);
  const b = new JsonFileStore(file);
  assert.equal(await b.getBalance('42'), '12.5');
  assert.equal((await deliver(b, gen('tx_p', '42', '12.5', 1).postback)).result, 'duplicate');
  const before = fs.readFileSync(file, 'utf8');
  await assert.rejects(
    b.transaction(async (t) => {
      await t.addToBalance('42', '100');
      throw new Error('boom');
    })
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(await b.getBalance('42'), '12.5');
});

await creditSuite('JsonFileStore', freshJsonStore);

let sqliteOk = true;
try {
  await import('node:sqlite');
} catch {
  sqliteOk = false;
}
if (sqliteOk) {
  const { SqliteStore } = await import('../lib/store/sqlite-store.ts');
  await creditSuite('SqliteStore', () => new SqliteStore(path.join(tmpDir, `db-${++n}.sqlite`)));
}
