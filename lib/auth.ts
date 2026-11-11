import 'server-only';
import { connection } from 'next/server';

// =====================================================================================
//  REPLACE THIS FUNCTION WITH YOUR REAL AUTH BEFORE YOU DEPLOY.
//
//  It returns a fixed demo user so the starter runs out of the box. In production that
//  would give every visitor the same account and the same coins.
//
//  Return the signed-in user from your session, for example:
//    NextAuth / Auth.js:  const session = await auth(); return session?.user ? { id: session.user.id } : null;
//    Clerk:               const { userId } = await auth(); return userId ? { id: userId } : null;
//    Your own cookie:     look up the session cookie in your database.
//
//  Rules:
//    - id is your database ID: stable, 1 to 100 of A-Z a-z 0-9 . _ @ : + -
//    - never an email or a username (they change), never a value from the URL or a form.
//    - return null when nobody is signed in.
// =====================================================================================

export type CurrentUser = { id: string; name: string };

export async function getCurrentUser(): Promise<CurrentUser | null> {
  // Real auth reads cookies, which makes every page that calls it render per request.
  // The demo user reads nothing, so connection() does the same here: a page with a
  // signed link must never be built once and cached for everyone.
  await connection();
  if (process.env.NODE_ENV === 'production' && process.env.MOONETIX_DEMO_USER !== 'allow') {
    throw new Error('lib/auth.ts still returns the demo user. Connect your auth library first.');
  }
  return { id: 'demo-user-1', name: 'Demo user' };
}
