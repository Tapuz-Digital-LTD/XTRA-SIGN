import type { NextConfig } from 'next'
import { buildCsp } from './src/lib/content-security-policy'

const isProd = process.env.NODE_ENV === 'production'

const csp = buildCsp({ isProd })

const nextConfig: NextConfig = {
  // Pin the workspace root: a package-lock.json in the parent directory
  // otherwise makes Turbopack guess wrong about where the project starts.
  turbopack: { root: __dirname },

  /**
   * The Hebrew font the signed PDF embeds.
   *
   * A function bundle only carries files the tracer can see, and this one is
   * read by path at runtime rather than imported. Without it the signed PDF
   * renders every Hebrew character as a box — and that failure only shows up on
   * a document someone has already signed.
   */
  outputFileTracingIncludes: {
    '/api/sign/**': ['./src/server/signing/assets/**'],
    // The same font, for the opposite direction: the CRM template renderer
    // embeds it so headless Chromium — which ships no Hebrew font at all — has
    // glyphs to draw with.
    //
    // The browser itself has to be listed too. `serverExternalPackages` keeps
    // the bundler's hands off the package, but the tracer still only carries
    // files it can see being imported, and these archives are opened by path at
    // runtime. Without them the function deploys perfectly and then reports
    // that /var/task/node_modules/@sparticuz/chromium/bin does not exist.
    // Every route that renders HTML to PDF needs the browser and the font.
    // Listing only the CRM route once meant a second renderer deployed cleanly
    // and then failed at runtime with the bin directory missing.
    '/api/crm/**': [
      './src/server/signing/assets/**',
      './node_modules/@sparticuz/chromium/bin/**',
    ],
    '/api/companies/**': [
      './src/server/signing/assets/**',
      './node_modules/@sparticuz/chromium/bin/**',
    ],
    '/api/documents/**': [
      './src/server/signing/assets/**',
      './node_modules/@sparticuz/chromium/bin/**',
    ],
  },

  /**
   * The headless browser used to convert a Fireberry template to PDF.
   *
   * Left to the bundler, the Chromium binary inside this package is treated as
   * something to trace and rewrite, which either bloats the bundle or breaks
   * the extraction at runtime. Both packages are loaded from node_modules at
   * runtime instead.
   */
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],

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
