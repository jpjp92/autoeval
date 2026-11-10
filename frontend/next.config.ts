import type { NextConfig } from 'next';

// Rewrites are fixed at build time for production; Docker supplies this build arg.
const backendUrl = (process.env.BACKEND_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

const nextConfig: NextConfig = {
  output: 'standalone',
  experimental: {
    // Preserve the previous nginx limits for document upload and sync tagging.
    proxyTimeout: 300_000,
    proxyClientMaxBodySize: '200mb',
  },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${backendUrl}/api/:path*` },
      { source: '/health', destination: `${backendUrl}/health` },
    ];
  },
};

export default nextConfig;
