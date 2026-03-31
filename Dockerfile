# Minimal Dockerfile - Pure Bun + sql.js (no native deps)
FROM oven/bun:1-alpine

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies (sql.js is pure JS, no compilation needed)
RUN bun install --frozen-lockfile || bun install

# Copy source
COPY src ./src
COPY tsconfig.json ./

# Create data directory
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/bot.db

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD pgrep -f "bun" || exit 1

# Run
CMD ["bun", "run", "src/main.ts"]
