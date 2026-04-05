/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // All routes served under /admin — nginx proxies /admin/ to this app
  basePath: '/admin',
  // Allow images from any domain (for user avatars etc.)
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
}

export default nextConfig
