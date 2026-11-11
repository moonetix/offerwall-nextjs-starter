type Props = { src: string; title?: string; height?: string };

// The offerwall scrolls on its own, so it fills the height you give it.
// Keep the inline style: without it, browsers draw a 300 by 150 pixel box.
export function OfferwallFrame({ src, title = 'Offerwall', height = '100vh' }: Props) {
  return <iframe key={src} title={title} src={src} style={{ border: 0, width: '100%', height }} />;
}
