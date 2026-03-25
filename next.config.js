/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb', // For voice uploads
    },
  },
};

module.exports = nextConfig;
