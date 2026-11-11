import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { wallUrl } from '@/lib/moonetix';
import { getStore } from '@/lib/store';
import { OfferwallFrame } from '@/components/offerwall-frame';
import { RefreshOnReturn } from '@/components/refresh-on-return';

export default async function EarnPage() {
  // The user comes from your session (lib/auth.ts), never from the URL or a form.
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // Signed on the server. The salt never reaches the browser, only the finished link.
  const src = wallUrl(user.id, { sub1: 'earn_page' });
  const store = getStore();
  const [balance, history] = await Promise.all([store.getBalance(user.id), store.listTransactions(user.id, 5)]);

  return (
    <main>
      <h1>Earn coins</h1>
      <div className="row">
        <p className="balance">{balance} coins</p>
        <span className="muted">Coins usually arrive a few minutes after an offer is confirmed.</span>
      </div>
      {history.length > 0 && (
        <table className="history">
          <thead>
            <tr><th>Transaction</th><th>Coins</th><th>Status</th></tr>
          </thead>
          <tbody>
            {history.map((row) => (
              <tr key={row.transactionId}>
                <td>{row.transactionId}</td>
                <td>{row.reward}</td>
                <td>{row.status === 1 ? 'Credited' : 'Reversed'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted">
        The offerwall only loads in a frame on https pages of the website registered for your app.
        On localhost, <a href={src} target="_blank" rel="noopener">open it in a new tab</a> instead.
      </p>
      <div className="wall">
        <OfferwallFrame src={src} height="calc(100vh - 64px)" />
      </div>
      <RefreshOnReturn />
    </main>
  );
}
