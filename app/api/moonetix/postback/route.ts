// Moonetix postback endpoint. Register this URL on the Postback page of your dashboard:
//
//   https://yoursite.com/api/moonetix/postback?tx={transaction_id}&user={user_id}&reward={reward}&status={status}&hash={hash}
//
// 200: applied, or skipped on purpose (duplicate, test). 403: missing parameter or bad hash.
// 500: our own failure (store down, key missing), so Moonetix retries up to 5 times.
import { handlePostback } from '@/lib/moonetix-core';
import { postbackKey } from '@/lib/moonetix';
import { getStore } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const outcome = await handlePostback(new URL(request.url).searchParams, {
      postbackKey: postbackKey(),
      store: getStore(),
      log: (msg, data) => console.info(msg, data ?? ''),
    });
    if (outcome.httpStatus === 403) console.warn(`moonetix: rejected postback (${outcome.result})`);
    return new Response(null, { status: outcome.httpStatus, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('moonetix: postback failed', err);
    return new Response(null, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
