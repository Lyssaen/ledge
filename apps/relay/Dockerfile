# Build context: the repository root (docker build -f apps/relay/Dockerfile .).
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @ledge/relay... --filter @ledge/mobile...
RUN pnpm --filter @ledge/relay build
RUN pnpm --filter @ledge/mobile build
# The relay bundles its workspace packages; only pg, ws and zod are needed at runtime.
RUN pnpm --filter @ledge/relay deploy --prod --legacy /prod/relay

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV LEDGE_RELAY_WEB_DIR=/app/apps/mobile/dist
WORKDIR /app
COPY --from=build /prod/relay/node_modules ./node_modules
COPY --from=build /repo/apps/relay/dist ./apps/relay/dist
COPY --from=build /repo/apps/mobile/dist ./apps/mobile/dist
USER node
CMD ["node", "apps/relay/dist/main.js"]
