# Dockerfile for MQTT Gateway Node.js service
FROM node:18-bullseye

# Set working directory
WORKDIR /app

# Install system dependencies for native modules
RUN apt-get update && apt-get install -y \
  git \
  python3 \
  make \
  g++ \
  libasound2-dev \
  libasound2 \
  alsa-utils \
  libpulse-dev \
  libpulse0 \
  && ldconfig \
  && ln -sf /usr/lib/x86_64-linux-gnu/libasound.so.2 /usr/lib/libasound.so.2 \
  && rm -rf /var/lib/apt/lists/*

# Copy source code
COPY . .

# Downgrade @discordjs/opus to 0.9.0 to avoid prebuild issues with node 18
RUN sed -i 's/"@discordjs\/opus": "github:discordjs\/opus"/"@discordjs\/opus": "^0.9.0"/' package.json

# Remove package-lock.json to ensure we use the modified package.json
RUN rm -f package-lock.json

# Install dependencies
RUN npm install --production --unsafe-perm

# Create necessary directories
RUN mkdir -p logs config

# Expose ports
EXPOSE 8004
EXPOSE 8884/udp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8004/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))" || exit 1

# Start the service
CMD ["node", "app.js"]