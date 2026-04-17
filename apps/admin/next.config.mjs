/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static export — served by nginx:alpine, no Node.js runtime needed.
  // Eliminates OOM crashes; nginx uses ~8MB vs 300MB+ for Next.js standalone.
  output: 'export',
  // All routes served under /admin — nginx proxies /admin/* to this container
  basePath: '/admin',
  // Static export doesn't optimise images server-side; use unoptimised remote images
  images: {
    unoptimized: true,
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
  trailingSlash: true,
}

export default nextConfig
