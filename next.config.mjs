// next.config.mjs (or next.config.js)
const API_TARGET = process.env.API_TARGET || "http://127.0.0.1:8000";

export default {
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_TARGET}/api/:path*` },
      { source: "/health", destination: `${API_TARGET}/health` }, // optional
    ];
  },
};
