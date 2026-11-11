import Script from 'next/script';
import { getCurrentUser } from '@/lib/auth';
import { wallUrl } from '@/lib/moonetix';

const EMBED_JS = 'https://wall.moonetix.com/embed.js';

// Loads the Moonetix embed script once, for signed-in users. It does two things:
//  1. Opens the offerwall in a pop-up for any link with data-moonetix-open (see <EarnLink>).
//  2. Optional: draws a floating "Earn coins" button in the corner.
//     Turn the button off with MOONETIX_FLOATING_BUTTON=off in .env.local.
//
// Next.js loads a script once per page load, and the button keeps the link it started with.
// If users can switch accounts without a full page load, turn the button off and use <EarnLink>,
// which always renders the current user's link.
export async function MoonetixEmbed() {
  const user = await getCurrentUser();
  if (!user) return null;
  if (process.env.MOONETIX_FLOATING_BUTTON === 'off') {
    return <Script src={EMBED_JS} strategy="afterInteractive" />;
  }
  return (
    <Script
      src={EMBED_JS}
      strategy="afterInteractive"
      data-button-url={wallUrl(user.id, { sub1: 'button' })}
      data-button-text="Earn coins"
      data-button-color="#004ABB"
      data-button-position="right"
    />
  );
}
