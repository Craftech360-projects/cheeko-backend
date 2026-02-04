#!/bin/bash

# OpenClaw Service Setup Script
# This script sets up the OpenClaw service for Cheeko

set -e

echo "🚀 Setting up OpenClaw Service for Cheeko..."
echo ""

# Navigate to openclaw-service directory
cd "$(dirname "$0")"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

echo "✅ Node.js version: $(node --version)"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "⚠️  Please edit .env file with your configuration before starting the service."
else
    echo "✅ .env file already exists"
fi

# Create logs directory
mkdir -p logs
echo "✅ Created logs directory"

# Create memory directory
mkdir -p memory/history
echo "✅ Created memory directory"

echo ""
echo "✅ OpenClaw Service setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your configuration:"
echo "   - Set WHATSAPP_ENABLED=true to enable WhatsApp"
echo "   - Set MANAGER_API_URL and MANAGER_API_SECRET"
echo ""
echo "2. Start the service:"
echo "   npm run dev"
echo ""
echo "3. Scan WhatsApp QR code (if enabled)"
echo ""
echo "4. Test the API:"
echo "   curl http://localhost:8003/health"
echo ""
