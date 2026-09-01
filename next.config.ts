import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Pin the workspace root: a package-lock.json in the parent directory
  // otherwise makes Turbopack guess wrong about where the project starts.
  turbopack: { root: __dirname },

  experimental: {
    /**
     * Server Actions carry their own origin check. Pinning the list here means
     * it is configuration rather than an inference from the Host header, which
     * a misconfigured proxy would let an attacker control.
     */
    serverActions: {
      allowedOrigins: [
        ...(process.env.SIGN_PUBLIC_URL ? [new URL(process.env.SIGN_PUBLIC_URL).host] : []),
        ...(process.env.SIGN_EXTRA_ORIGINS?.split(',')
          .map((v) => v.trim())
          .filter(Boolean)
          .map((v) => new URL(v).host) ?? []),
      ],
      bodySizeLimit: '2mb',
    },
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // A response must never be re-interpreted as a type it did not declare.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },
}

export default nextConfig
