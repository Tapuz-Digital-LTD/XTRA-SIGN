import type { NextConfig } from 'next'

const isProd = process.env.NODE_ENV === 'production'

/**
 * Content Security Policy.
 *
 * `'unsafe-inline'` on styles is Tailwind's inlined critical CSS and Next's
 * style injection; removing it needs a nonce plumbed through every render, and
 * an injected stylesheet is a far smaller problem than an injected script.
 *
 * Scripts get no `'unsafe-eval'` in production. Development needs it for React
 * Refresh, which is exactly the sort of gap that should not exist in the build
 * that faces the internet.
 *
 * `img-src 'self' data: blob:` — page previews come from our own routes, and
 * the signature pad produces a data/blob URL before it is uploaded.
 *
 * `connect-src 'self'` — the browser never talks to InforU or to storage
 * directly; every outbound call goes through the server, which is what keeps
 * credentials and signed URLs off the client.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  // Storage is private and signed URLs are followed by a redirect the browser
  // makes itself, so no third-party origin needs to be reachable from a page.
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  ...(isProd ? ['upgrade-insecure-requests'] : []),
].join('; ')

const nextConfig: NextConfig = {
  // Emits a self-contained server bundle, so the runtime image carries only
  // what the app actually imports rather than the whole node_modules tree.
  output: 'standalone',

  // Pin the workspace root: a package-lock.json in the parent directory
  // otherwise makes Turbopack guess wrong about where the project starts.
  turbopack: { root: __dirname },

  // The version banner tells an attacker which advisories to try.
  poweredByHeader: false,

  experimental: {
    /**
     * Server Actions carry their own origin check. Pinning the list means it is
     * configuration rather than an inference from the Host header, which a
     * misconfigured proxy would let an attacker control.
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
          { key: 'Content-Security-Policy', value: csp },
          // A response must never be re-interpreted as a type it did not declare.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // A signing URL must not leak to a third party through a referrer.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          },
          ...(isProd
            ? [
                {
                  // Two years, subdomains included. Only ever sent over HTTPS,
                  // so it cannot lock out a plain-HTTP development server.
                  key: 'Strict-Transport-Security',
                  value: 'max-age=63072000; includeSubDomains; preload',
                },
              ]
            : []),
        ],
      },
      {
        // Nothing under /api is cacheable: every response is either private
        // document data or a state change.
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }],
      },
    ]
  },
}

export default nextConfig
