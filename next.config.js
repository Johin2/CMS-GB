// next.config.js  (CommonJS)
// If you want ESM, rename to next.config.mjs and use `export default { ... }`

const API_TARGET = process.env.API_TARGET || 'http://127.0.0.1:8000';

/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  async rewrites() {
    const base = API_TARGET.replace(/\/+$/, '');
    return [
      { source: '/api/:path*', destination: `${base}/api/:path*` },
      { source: '/health',     destination: `${base}/health` }, // optional
    ];
  },
};
