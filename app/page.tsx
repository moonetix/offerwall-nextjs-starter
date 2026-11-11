import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { wallUrl } from '@/lib/moonetix';
import { getStore } from '@/lib/store';
import { EarnLink } from '@/components/earn-link';

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <main>
        <h1>Welcome</h1>
        <p>Sign in to earn coins.</p>
      </main>
    );
  }
  const balance = await getStore().getBalance(user.id);
  return (
    <main>
      <h1>Hi, {user.name}</h1>
      <p className="muted">Your coins</p>
      <p className="balance">{balance}</p>
      <div className="row" style={{ marginTop: 16 }}>
        <Link className="button" href="/earn">Go to the Earn page</Link>
        {/* Your own button: opens the offerwall in a pop-up over this page. */}
        <EarnLink href={wallUrl(user.id, { sub1: 'home_button' })}>Open the offerwall in a pop-up</EarnLink>
      </div>
      <p className="muted" style={{ marginTop: 24 }}>
        Users earn coins by completing offers. Rewards are only for completed offers, and users must be 16 or older.
      </p>
    </main>
  );
}
