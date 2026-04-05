/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Allow images from any domain (for user avatars etc.)
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
}

export default nextConfig
