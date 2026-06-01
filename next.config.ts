import type {NextConfig} from 'next';

const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://placehold.co",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  typescript:         { ignoreBuildErrors: true },
  eslint:             { ignoreDuringBuilds: true },

  // Keep Node.js-only packages out of the Edge Runtime bundle.
  // Next.js middleware runs in Edge Runtime which has no Node.js APIs.
  // These packages use fs, path, process, setImmediate etc — Edge-incompatible.
  serverExternalPackages: [
    'better-sqlite3',
    'bcryptjs',
    'bcrypt',
    'nodemailer',
    'pdf-lib',
    'exceljs',
    'dotenv',
  ],

  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'placehold.co', port: '', pathname: '/**' }],
  },

  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },

  experimental: {
    serverActions: { bodySizeLimit: '20mb' },
  },

  webpack: (config) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    return config;
  },
};

export default nextConfig;
