# ── deps ───────────────────────────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` rather than `install`: the lockfile is the input, so a build cannot
# quietly pick up a different version than the one that was tested.
RUN npm ci

# ── build ──────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time only. Real secrets arrive from Secrets Manager at runtime; baking
# one into a layer would ship it inside the image.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── runtime ────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime
WORKDIR /app

# UTC everywhere. A signature time that is silently offset is not a record.
ENV NODE_ENV=production \
    TZ=UTC \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN apk add --no-cache curl tzdata \
 && addgroup -g 10001 -S app \
 && adduser -u 10001 -S app -G app

# Only the standalone bundle and static assets. No source, no dev dependencies,
# no build toolchain in the image that faces the internet.
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
# The Hebrew font the signed PDF embeds. Without it every stamped value renders
# as boxes, and the failure only shows up on a signed document.
COPY --from=build --chown=app:app /app/src/server/signing/assets ./src/server/signing/assets

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
