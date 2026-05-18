# Dockerfile for MQTT Gateway

# Use Node.js 20 Bullseye as the base image
# Bullseye includes build tools like make, g++, and python3 which are required for native modules
FROM node:20-bullseye

# Create app directory
WORKDIR /usr/src/app

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

# Copy source code (includes config directory)
COPY . .

# Downgrade @discordjs/opus to 0.9.0 to avoid prebuild issues with node 18
RUN sed -i 's/"@discordjs\/opus": "github:discordjs\/opus"/"@discordjs\/opus": "^0.9.0"/' package.json

# Remove package-lock.json to ensure we use the modified package.json
RUN rm -f package-lock.json

# Install dependencies
RUN npm install --production --unsafe-perm

# Create necessary directories (config is already copied from source)
RUN mkdir -p logs

# Expose ports
EXPOSE 8004
EXPOSE 8884/udp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8091/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))" || exit 1

# Make entrypoint executable
RUN chmod +x docker-entrypoint.sh

# Start the service using entrypoint
ENTRYPOINT ["./docker-entrypoint.sh"]
