/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  // Type errors still fail the build; ESLint isn't part of this project.
  eslint: { ignoreDuringBuilds: true },
  // In production Traefik sends /api/* straight to the API container.
  // For local development, set API_INTERNAL_URL (e.g. http://localhost:47814).
  async rewrites() {
    const api = process.env.API_INTERNAL_URL;
    return api ? [{ source: '/api/:path*', destination: `${api}/api/:path*` }] : [];
  },
  async headers() {
    const common = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    ];
    return [
      { source: '/:path*', headers: [...common, { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }] },
      // Task links carry a secret in the URL: never leak it in a Referer header.
      { source: '/t/:token*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'X-Robots-Tag', value: 'noindex' }] },
      { source: '/reset/:token*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
      { source: '/invite/:token*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
    ];
  },
};

export default nextConfig;
