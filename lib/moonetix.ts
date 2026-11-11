// Server-only entry point: reads the keys from the environment and calls the core logic.
// 'server-only' makes the build fail if a Client Component imports this file,
// so the salt and the postback key can never end up in browser JavaScript.
import 'server-only';
import { buildWallUrl, type Subs } from './moonetix-core.ts';

function env(name: string): string {
  // Read when a link is built, not at import time: `next build` works without the keys,
  // and a server with a missing key fails loudly instead of signing with an empty string.
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env.local and fill it in.`);
  return value;
}

/** Signed offerwall link for a user ID from your session. Never pass an ID from the browser. */
export function wallUrl(userId: string | number, subs: Subs = {}): string {
  return buildWallUrl({ appId: env('MOONETIX_APP_ID'), linkSalt: env('MOONETIX_LINK_SALT'), userId, subs });
}

export function postbackKey(): string {
  return env('MOONETIX_POSTBACK_KEY');
}
