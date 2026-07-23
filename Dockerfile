# Production Dockerfile for GastroFlow SaaS Suite
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci

# Copy full application code
COPY . .

# Build all web apps
RUN npm run build
RUN npm run customer:build
RUN npm run driver:build

# Production runtime stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app ./

EXPOSE 5000 3000 3001 3002

CMD ["npm", "run", "start:all"]
