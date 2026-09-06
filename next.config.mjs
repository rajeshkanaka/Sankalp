/** @type {import('next').NextConfig} */
const config = {
  poweredByHeader: false,
  // Incoming URLs can contain sign-in tokens or private journal search text.
  logging: false,
  // Preserve absolute canonical redirects between local loopback aliases.
  skipProxyUrlNormalize: true,
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};
export default config;
