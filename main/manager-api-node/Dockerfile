# ===========================================
# Cheeko Manager API (Node.js) - Dockerfile
# ===========================================
# Multi-stage build for production deployment
#
# Build:   docker build -t cheeko-manager-api .
# Run:     docker run -p 8002:8002 --env-file .env cheeko-manager-api
# ===========================================

# Stage 1: Build stage (install dependencies including dev)
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install all dependencies (including devDependencies for build/test)
RUN npm ci

# Copy source code
COPY . .

# Run linting and tests (optional - can be skipped in CI if already done)
# RUN npm run lint && npm test

# Stage 2: Production stage
FROM node:20-alpine AS production

# Set production environment
ENV NODE_ENV=production

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs \
    && adduser -S nodeuser -u 1001 -G nodejs

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production \
    && npm cache clean --force

# Copy application code from builder
COPY --from=builder /app/src ./src
COPY --from=builder /app/server.js ./
COPY --from=builder /app/supabase ./supabase

# Create logs directory
RUN mkdir -p logs && chown -R nodeuser:nodejs /app

# Switch to non-root user
USER nodeuser

# Expose the API port
EXPOSE 8002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8002/toy/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start the application
CMD ["node", "server.js"]
