import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // pnpm monorepo: tell Next.js file tracer the workspace root so it
  // correctly bundles all dependencies into the standalone output.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // All routes served under /admin — nginx proxies /admin/ to this app
  basePath: '/admin',
  // Allow images from any domain (for user avatars etc.)
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
}

export default nextConfig
