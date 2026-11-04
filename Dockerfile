# Build dependencies stay in this stage; no development servers run in production.
FROM node:24-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --ignore-scripts && npm rebuild sqlite3
COPY . .
RUN npm run check && npm test -- --maxWorkers=1 --silent && npm run build:all && npm prune --omit=dev --ignore-scripts

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=5000 DATABASE_FILE=/app/data/restaurant.db
COPY --from=builder --chown=node:node /app/package*.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/server.js ./
COPY --from=builder --chown=node:node /app/lib ./lib
COPY --from=builder --chown=node:node /app/routes ./routes
COPY --from=builder --chown=node:node /app/scripts ./scripts
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/apps/customer-web/dist ./apps/customer-web/dist
COPY --from=builder --chown=node:node /app/apps/driver-web/dist ./apps/driver-web/dist
RUN mkdir -p /app/data /app/backups && chown -R node:node /app/data /app/backups
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:5000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
