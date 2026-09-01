import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Pin the workspace root: a package-lock.json in the parent directory
  // otherwise makes Turbopack guess wrong about where the project starts.
  turbopack: { root: __dirname },
}

export default nextConfig
