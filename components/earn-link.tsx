// Your own button that opens the offerwall pop-up. Needs embed.js on the page once
// (<MoonetixEmbed> in app/layout.tsx loads it). If the script is blocked, the href still opens the wall as a page.
//
// JSX note: write data-moonetix-open="" (an empty string). A bare data-moonetix-open
// also works, React renders it as "true", but the empty string keeps the markup explicit.
export function EarnLink({ href, children = 'Earn coins', className }: { href: string; children?: React.ReactNode; className?: string }) {
  return (
    <a href={href} data-moonetix-open="" className={className}>
      {children}
    </a>
  );
}
