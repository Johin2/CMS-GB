// next.config.js
const API_TARGET = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000';

/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  // IMPORTANT: do not set output: 'export'
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_TARGET.replace(/\/+$/, '')}/api/:path*` },
      { source: '/health',     destination: `${API_TARGET.replace(/\/+$/, '')}/health` },
    ];
  },
};
