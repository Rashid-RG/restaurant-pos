# Production image: compile the three React apps once, then serve their static
# bundles through Express. Vite development servers are never started in production.
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:all

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5000
ENV DATABASE_FILE=/app/data/restaurant.db

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/server.js ./
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/routes ./routes
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/apps/customer-web/dist ./apps/customer-web/dist
COPY --from=builder /app/apps/driver-web/dist ./apps/driver-web/dist

RUN addgroup -S gastroflow && adduser -S gastroflow -G gastroflow && mkdir -p /app/data && chown -R gastroflow:gastroflow /app
USER gastroflow

EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:5000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
