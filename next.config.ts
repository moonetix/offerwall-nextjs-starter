import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Moonetix does not follow redirects. Keep the postback path exactly as registered.
  trailingSlash: false,
  poweredByHeader: false,
};

export default nextConfig;
